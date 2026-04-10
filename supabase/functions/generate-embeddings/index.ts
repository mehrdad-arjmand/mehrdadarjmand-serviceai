import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

// ── Paid tier config (unchanged) ──
const BATCH_EMBED_SIZE_PAID = 100
const CHUNKS_PER_FETCH = 500
const MAX_CHUNK_TEXT_LENGTH = 6000

// ── Free tier config (serial + resumable) ──
const BATCH_EMBED_SIZE_FREE = 15
const FREE_CHUNKS_PER_SLICE = BATCH_EMBED_SIZE_FREE
const FREE_TIER_DOC_DELAY_MS = 4000
const FREE_LOCK_DURATION_MS = 5 * 60_000   // 5 minute lock window
const FREE_TIER_RATE_LIMIT_WAIT_MS = 60_000

function isValidUUID(value: unknown): value is string {
  if (typeof value !== 'string') return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ error: 'Missing or invalid authorization header' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } }
  })
  const token = authHeader.replace('Bearer ', '')
  const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(token)
  if (claimsError || !claimsData?.claims?.sub) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: Invalid token' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
  const user = { id: claimsData.claims.sub as string }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const { data: hasPermission, error: permError } = await supabase.rpc('has_permission', {
    p_tab: 'repository', p_action: 'write', p_user_id: user.id
  })
  if (permError || !hasPermission) {
    return new Response(
      JSON.stringify({ error: 'Forbidden: repository.write permission required' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const contentType = req.headers.get('content-type')
    if (!contentType?.includes('application/json')) throw new Error('Content-Type must be application/json')

    const body = await req.json()
    const { documentId, documentIds, mode } = body as { documentId?: unknown; documentIds?: unknown[]; mode?: string }

    const docIds: string[] = []
    if (Array.isArray(documentIds)) {
      for (const id of documentIds) {
        if (isValidUUID(id)) docIds.push(id)
      }
    }
    if (isValidUUID(documentId) && !docIds.includes(documentId)) {
      docIds.push(documentId)
    }
    if (docIds.length === 0) throw new Error('documentId or documentIds must contain valid UUIDs')

    const isFullMode = mode === 'full'

    const { data: userApiTier } = await supabase.rpc('get_user_api_tier', { p_user_id: user.id })
    const apiTier = userApiTier || 'free'

    const apiKey = apiTier === 'paid'
      ? Deno.env.get('GOOGLE_API_KEY')
      : Deno.env.get('GOOGLE_API_KEY_FREE')
    if (!apiKey) throw new Error('No Google API key configured')

    const isFree = apiTier === 'free'

    if (isFree) {
      // ═══════════════════════════════════════════════════════════════════
      // FREE TIER: Small bounded slice per invocation, with lock mechanism
      // ═══════════════════════════════════════════════════════════════════
      const results = await processFreeTier(supabase, apiKey, docIds, user.id)
      return new Response(
        JSON.stringify({ success: true, tier: 'free', documents: results }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    } else {
      // ═══════════════════════════════════════════════════════════════════
      // PAID TIER: Original full-document processing (unchanged)
      // ═══════════════════════════════════════════════════════════════════
      const results = await processPaidTier(supabase, apiKey, docIds, isFullMode, user.id)
      return new Response(
        JSON.stringify({ success: true, tier: 'paid', documents: results }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
  } catch (error) {
    console.error('Error generating embeddings:', error)
    return new Response(
      JSON.stringify({ success: false, error: 'Embedding generation failed. Please try again.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// FREE TIER: Process a small slice of chunks per document, then return.
// The client supervisor will call again for the next slice.
// ═══════════════════════════════════════════════════════════════════════════════
async function processFreeTier(
  supabase: ReturnType<typeof createClient>,
  apiKey: string,
  docIds: string[],
  userId: string,
) {
  const results: { documentId: string; processed: number; embedded: number; total: number; complete: boolean; locked: boolean; retryAfterMs: number }[] = []

  for (const docId of docIds) {
    // Check retry_after — if rate-limited, skip and tell client when to come back
    const { data: docMeta } = await supabase
      .from('documents')
      .select('embedding_locked_until, embedding_retry_after, total_chunks, ingestion_status')
      .eq('id', docId)
      .single()

    if (!docMeta) {
      results.push({ documentId: docId, processed: 0, embedded: 0, total: 0, complete: false, locked: false, retryAfterMs: 0 })
      continue
    }

    const now = new Date()

    // If retry_after is set and in the future, tell client to wait
    if (docMeta.embedding_retry_after) {
      const retryAfter = new Date(docMeta.embedding_retry_after)
      if (retryAfter > now) {
        const waitMs = retryAfter.getTime() - now.getTime()
        console.log(`Document ${docId}: rate-limited, retry after ${waitMs}ms`)
        results.push({ documentId: docId, processed: 0, embedded: 0, total: docMeta.total_chunks || 0, complete: false, locked: false, retryAfterMs: waitMs })
        continue
      }
    }

    // Check lock — if another worker is active, skip
    if (docMeta.embedding_locked_until) {
      const lockUntil = new Date(docMeta.embedding_locked_until)
      if (lockUntil > now) {
        console.log(`Document ${docId}: locked by another worker until ${lockUntil.toISOString()}`)
        results.push({ documentId: docId, processed: 0, embedded: 0, total: docMeta.total_chunks || 0, complete: false, locked: true, retryAfterMs: 0 })
        continue
      }
    }

    // Acquire lock
    const lockUntil = new Date(now.getTime() + FREE_LOCK_DURATION_MS).toISOString()
    await supabase
      .from('documents')
      .update({ embedding_locked_until: lockUntil, embedding_retry_after: null })
      .eq('id', docId)

    let totalProcessed = 0
    let hitRateLimit = false
    let retryAfterMs = 0

    try {
      // Fetch only a small slice of un-embedded chunks
      const { data: chunks, error: chunksError } = await supabase
        .from('chunks')
        .select('id, text')
        .eq('document_id', docId)
        .is('embedding', null)
        .order('chunk_index')
        .limit(FREE_CHUNKS_PER_SLICE)

      if (chunksError) throw chunksError

      if (chunks && chunks.length > 0) {
        const batch = chunks.slice(0, BATCH_EMBED_SIZE_FREE)
        const texts = batch.map(c => {
          const text = c.text
          if (typeof text !== 'string' || text.trim().length === 0) return 'empty chunk'
          return text.slice(0, MAX_CHUNK_TEXT_LENGTH)
        })

        const embedResult = await batchEmbedTexts(apiKey, texts, { maxRetries: 1 })

        if (embedResult.rateLimited) {
          // ── Exponential backoff for consecutive 429s ──
          // If ingested_chunks is still 0, we've never made progress — increase wait exponentially
          const { count: currentEmbedded } = await supabase
            .from('chunks')
            .select('id', { count: 'exact', head: true })
            .eq('document_id', docId)
            .not('embedding', 'is', null)

          const embedded = currentEmbedded || 0
          const totalChunks = docMeta.total_chunks || 0

          // Calculate consecutive failure backoff based on document age
          const { data: docCreated } = await supabase
            .from('documents')
            .select('uploaded_at')
            .eq('id', docId)
            .single()

          const docAgeMs = docCreated?.uploaded_at
            ? Date.now() - new Date(docCreated.uploaded_at).getTime()
            : 0

          // If zero progress and doc has been around for > 30 minutes, mark as failed
          const MAX_ZERO_PROGRESS_AGE_MS = 30 * 60_000
          if (embedded === 0 && docAgeMs > MAX_ZERO_PROGRESS_AGE_MS) {
            console.log(`Document ${docId}: zero embedding progress after ${Math.round(docAgeMs / 60_000)}min — marking as failed`)
            await supabase
              .from('documents')
              .update({
                ingestion_status: 'failed',
                ingestion_stage: 'failed',
                ingestion_error: 'Embedding rate limit exceeded repeatedly. Please retry later.',
                embedding_locked_until: null,
                embedding_retry_after: null,
              })
              .eq('id', docId)
            results.push({ documentId: docId, processed: 0, embedded: 0, total: totalChunks, complete: false, locked: false, retryAfterMs: 0 })
            continue
          }

          // Exponential backoff: 60s, 120s, 240s, 480s, capped at 15 min
          // Use doc age as a proxy for how many times we've retried
          let backoffMultiplier = 1
          if (embedded === 0 && docAgeMs > 10 * 60_000) backoffMultiplier = 8  // 8 min
          else if (embedded === 0 && docAgeMs > 5 * 60_000) backoffMultiplier = 4  // 4 min
          else if (embedded === 0 && docAgeMs > 2 * 60_000) backoffMultiplier = 2  // 2 min

          retryAfterMs = Math.min(
            15 * 60_000,  // Cap at 15 minutes
            Math.max(embedResult.retryAfterMs, FREE_TIER_RATE_LIMIT_WAIT_MS) * backoffMultiplier
          )

          const retryAt = new Date(Date.now() + retryAfterMs).toISOString()
          await supabase
            .from('documents')
            .update({ embedding_retry_after: retryAt, embedding_locked_until: null })
            .eq('id', docId)
          hitRateLimit = true
          console.log(`Document ${docId}: hit rate limit (${embedded}/${totalChunks} embedded, age ${Math.round(docAgeMs / 60_000)}min), backoff ${backoffMultiplier}x, retry after ${retryAfterMs}ms`)
        } else {
          if (!embedResult.embeddings) throw new Error('Embedding failed without rate limit')

          await Promise.all(
            batch.map((chunk, idx) =>
              supabase
                .from('chunks')
                .update({ embedding: embedResult.embeddings![idx] })
                .eq('id', chunk.id)
                .then(({ error }) => { if (error) throw error })
            )
          )

          totalProcessed += batch.length
        }
      }

      // Update progress
      const { count: embeddedCount } = await supabase
        .from('chunks')
        .select('id', { count: 'exact', head: true })
        .eq('document_id', docId)
        .not('embedding', 'is', null)

      const totalChunks = docMeta.total_chunks || 0
      const embedded = embeddedCount || 0
      const isComplete = embedded >= totalChunks && totalChunks > 0

      await supabase
        .from('documents')
        .update({
          ingested_chunks: embedded,
          ingestion_status: isComplete ? 'complete' : 'processing_embeddings',
          ingestion_stage: isComplete ? 'complete' : 'embedding',
          ingestion_error: null,
          embedding_locked_until: null, // Release lock
        })
        .eq('id', docId)

      console.log(`Free-tier slice: ${embedded}/${totalChunks} chunks for ${docId} (processed ${totalProcessed} this call)`)

      results.push({
        documentId: docId,
        processed: totalProcessed,
        embedded,
        total: totalChunks,
        complete: isComplete,
        locked: false,
        retryAfterMs,
      })
    } catch (docError) {
      console.error(`Error embedding document ${docId}:`, docError)
      // On error: release lock, set status but do NOT set failed (let client retry)
      await supabase
        .from('documents')
        .update({
          embedding_locked_until: null,
          ingestion_status: 'processing_embeddings', // Keep as processing so client can retry
          ingestion_error: docError instanceof Error ? docError.message.slice(0, 1000) : 'Unknown error'
        })
        .eq('id', docId)

      results.push({
        documentId: docId,
        processed: totalProcessed,
        embedded: 0,
        total: docMeta.total_chunks || 0,
        complete: false,
        locked: false,
        retryAfterMs: 15000, // Tell client to wait before retrying
      })
    }
  }

  return results
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAID TIER: Original full-document processing (unchanged from before)
// ═══════════════════════════════════════════════════════════════════════════════
async function processPaidTier(
  supabase: ReturnType<typeof createClient>,
  apiKey: string,
  docIds: string[],
  isFullMode: boolean,
  userId: string,
) {
  const CONCURRENT_API_CALLS = 10
  const results: { documentId: string; processed: number; embedded: number; total: number; complete: boolean }[] = []

  for (let docIndex = 0; docIndex < docIds.length; docIndex++) {
    const currentDocId = docIds[docIndex]
    console.log(`[${docIndex + 1}/${docIds.length}] Paid tier: generating embeddings for document ${currentDocId}`)

    let totalProcessed = 0
    let isComplete = false

    try {
      do {
        const { data: chunks, error: chunksError } = await supabase
          .from('chunks')
          .select('id, text')
          .eq('document_id', currentDocId)
          .is('embedding', null)
          .order('chunk_index')
          .limit(CHUNKS_PER_FETCH)

        if (chunksError) throw chunksError
        if (!chunks || chunks.length === 0) { isComplete = true; break }

        const apiBatches: typeof chunks[] = []
        for (let i = 0; i < chunks.length; i += BATCH_EMBED_SIZE_PAID) {
          apiBatches.push(chunks.slice(i, i + BATCH_EMBED_SIZE_PAID))
        }

        for (let i = 0; i < apiBatches.length; i += CONCURRENT_API_CALLS) {
          const concurrentBatches = apiBatches.slice(i, i + CONCURRENT_API_CALLS)

          const batchResults = await Promise.all(
            concurrentBatches.map(async (batch) => {
              const texts = batch.map(c => {
                const text = c.text
                if (typeof text !== 'string' || text.trim().length === 0) return 'empty chunk'
                return text.slice(0, MAX_CHUNK_TEXT_LENGTH)
              })

              const result = await batchEmbedTexts(apiKey, texts)
              if (!result.embeddings) throw new Error('Batch embedding failed')

              await Promise.all(
                batch.map((chunk, idx) =>
                  supabase
                    .from('chunks')
                    .update({ embedding: result.embeddings![idx] })
                    .eq('id', chunk.id)
                    .then(({ error }) => { if (error) throw error })
                )
              )

              return batch.length
            })
          )

          totalProcessed += batchResults.reduce((a, b) => a + b, 0)
        }

        const { count: embeddedCount } = await supabase
          .from('chunks')
          .select('id', { count: 'exact', head: true })
          .eq('document_id', currentDocId)
          .not('embedding', 'is', null)

        const { data: doc } = await supabase
          .from('documents')
          .select('total_chunks')
          .eq('id', currentDocId)
          .single()

        const totalChunks = doc?.total_chunks || 0
        const embedded = embeddedCount || 0
        isComplete = embedded >= totalChunks

        await supabase
          .from('documents')
          .update({ ingested_chunks: embedded })
          .eq('id', currentDocId)

        console.log(`Paid progress: ${embedded}/${totalChunks} chunks for ${currentDocId}`)

        if (!isFullMode) break
      } while (!isComplete)

      if (isComplete) {
        await supabase
          .from('documents')
          .update({ ingestion_status: 'complete' })
          .eq('id', currentDocId)
      }

      const { count: finalEmbedded } = await supabase
        .from('chunks')
        .select('id', { count: 'exact', head: true })
        .eq('document_id', currentDocId)
        .not('embedding', 'is', null)

      const { data: finalDoc } = await supabase
        .from('documents')
        .select('total_chunks')
        .eq('id', currentDocId)
        .single()

      results.push({
        documentId: currentDocId,
        processed: totalProcessed,
        embedded: finalEmbedded || 0,
        total: finalDoc?.total_chunks || 0,
        complete: isComplete,
      })
    } catch (docError) {
      console.error(`Error embedding document ${currentDocId}:`, docError)
      await supabase
        .from('documents')
        .update({
          ingestion_status: 'failed',
          ingestion_error: docError instanceof Error ? docError.message.slice(0, 1000) : 'Unknown error'
        })
        .eq('id', currentDocId)

      results.push({
        documentId: currentDocId,
        processed: totalProcessed,
        embedded: 0,
        total: 0,
        complete: false,
      })
    }
  }

  return results
}

// ═══════════════════════════════════════════════════════════════════════════════
// Batch embed with rate-limit awareness
// Returns { embeddings, rateLimited, retryAfterMs }
// ═══════════════════════════════════════════════════════════════════════════════
interface BatchEmbedResult {
  embeddings: string[] | null
  rateLimited: boolean
  retryAfterMs: number
}

async function batchEmbedTexts(
  apiKey: string,
  texts: string[],
  options?: { maxRetries?: number }
): Promise<BatchEmbedResult> {
  const maxRetries = Math.max(1, options?.maxRetries ?? 5)

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: texts.map(text => ({
              model: 'models/gemini-embedding-001',
              content: { parts: [{ text }] },
              outputDimensionality: 768
            }))
          })
        }
      )

        if (response.status === 429) {
        const errorData = await response.json().catch(() => ({}))
        const retryDelay = errorData?.error?.details?.find(
          (d: { '@type': string }) => d['@type']?.includes('RetryInfo')
        )?.retryDelay

        let waitMs = attempt * 15000
        if (retryDelay) {
          const seconds = parseFloat(retryDelay.replace('s', ''))
          if (!isNaN(seconds)) waitMs = Math.ceil(seconds * 1000) + 1000
        }
        waitMs = Math.min(waitMs, 60000)

        // On last attempt, return rate-limited instead of throwing
          if (attempt === maxRetries) {
            console.log(`Rate limited after ${maxRetries} attempt(s), returning rate-limited status`)
          return { embeddings: null, rateLimited: true, retryAfterMs: waitMs }
        }

          console.log(`Rate limited on batch of ${texts.length}, waiting ${waitMs}ms (attempt ${attempt}/${maxRetries})`)
        await new Promise(r => setTimeout(r, waitMs))
        continue
      }

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`Batch embedding API error (status ${response.status}):`, errorText)
        throw new Error(`Batch embedding API returned status ${response.status}`)
      }

      const data = await response.json()
      const embeddings = data.embeddings.map((e: { values: number[] }) => `[${e.values.join(',')}]`)
      return { embeddings, rateLimited: false, retryAfterMs: 0 }

    } catch (err) {
      if (attempt === maxRetries) {
        // Check if it's a rate limit that bubbled up
        if (err instanceof Error && err.message.includes('429')) {
          return { embeddings: null, rateLimited: true, retryAfterMs: 60000 }
        }
        throw err
      }
      console.log(`Batch embed attempt ${attempt} failed: ${err instanceof Error ? err.message : err}`)
      await new Promise(r => setTimeout(r, attempt * 2000))
    }
  }

  throw new Error('All retries exhausted for batch embedding')
}
