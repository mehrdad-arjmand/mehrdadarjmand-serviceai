import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const BATCH_EMBED_SIZE_PAID = 100   // Google batchEmbedContents max
const BATCH_EMBED_SIZE_FREE = 100   // Same batch size for free tier (baseline)
const CHUNKS_PER_FETCH = 500
const MAX_CHUNK_TEXT_LENGTH = 10000

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

  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: supabaseAnonKey },
  })
  if (!userRes.ok) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: Invalid token' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
  const user = await userRes.json()
  if (!user?.id) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: Invalid token' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

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
    const { documentId, mode } = body as { documentId?: unknown; mode?: string }

    if (!isValidUUID(documentId)) throw new Error('documentId must be a valid UUID')

    const isFullMode = mode === 'full'

    // Get user's API tier from their role
    const { data: userApiTier } = await supabase.rpc('get_user_api_tier', { p_user_id: user.id })
    const apiTier = userApiTier || 'free'

    // Pick API key based on tier
    const apiKey = apiTier === 'paid'
      ? (Deno.env.get('GOOGLE_API_KEY') || Deno.env.get('GOOGLE_API_KEY_FREE'))
      : (Deno.env.get('GOOGLE_API_KEY_FREE') || Deno.env.get('GOOGLE_API_KEY'))
    if (!apiKey) throw new Error('No Google API key configured')

    // Free tier: small batches with pacing to stay under ~100 chunks/min rate limit
    // Paid tier: large batches with high concurrency for max throughput
    // Free tier: serialize requests (concurrency 1) and let retry logic handle occasional 429s
    // Paid tier: high concurrency for max throughput
    const CONCURRENT_API_CALLS = apiTier === 'paid' ? 10 : 1
    const BATCH_EMBED_SIZE = apiTier === 'paid' ? BATCH_EMBED_SIZE_PAID : BATCH_EMBED_SIZE_FREE
    console.log(`API tier: ${apiTier} (from role) | concurrency: ${CONCURRENT_API_CALLS} | batchSize: ${BATCH_EMBED_SIZE}`)
    console.log(`Generating embeddings for document ${documentId}, mode=${isFullMode ? 'full' : 'batch'}, user=${user.id}`)

    let totalProcessed = 0
    let isComplete = false

    do {
      const { data: chunks, error: chunksError } = await supabase
        .from('chunks')
        .select('id, text')
        .eq('document_id', documentId)
        .is('embedding', null)
        .order('chunk_index')
        .limit(CHUNKS_PER_FETCH)

      if (chunksError) throw chunksError
      if (!chunks || chunks.length === 0) { isComplete = true; break }

      // Split into batches for batchEmbedContents API (size depends on tier)
      const apiBatches: typeof chunks[] = []
      for (let i = 0; i < chunks.length; i += BATCH_EMBED_SIZE) {
        apiBatches.push(chunks.slice(i, i + BATCH_EMBED_SIZE))
      }

      // Process with detected concurrency
      for (let i = 0; i < apiBatches.length; i += CONCURRENT_API_CALLS) {
        const concurrentBatches = apiBatches.slice(i, i + CONCURRENT_API_CALLS)

        const results = await Promise.all(
          concurrentBatches.map(async (batch) => {
            const texts = batch.map(c => {
              const text = c.text
              if (typeof text !== 'string' || text.trim().length === 0) return 'empty chunk'
              return text.slice(0, MAX_CHUNK_TEXT_LENGTH)
            })

            const embeddings = await batchEmbedTexts(apiKey, texts)

            // Bulk update
            await Promise.all(
              batch.map((chunk, idx) =>
                supabase
                  .from('chunks')
                  .update({ embedding: embeddings[idx] })
                  .eq('id', chunk.id)
                  .then(({ error }) => { if (error) throw error })
              )
            )

            return batch.length
          })
        )

        totalProcessed += results.reduce((a, b) => a + b, 0)
      }

      // Update document progress
      const { count: embeddedCount } = await supabase
        .from('chunks')
        .select('id', { count: 'exact', head: true })
        .eq('document_id', documentId)
        .not('embedding', 'is', null)

      const { data: doc } = await supabase
        .from('documents')
        .select('total_chunks')
        .eq('id', documentId)
        .single()

      const totalChunks = doc?.total_chunks || 0
      const embedded = embeddedCount || 0
      isComplete = embedded >= totalChunks

      await supabase
        .from('documents')
        .update({ ingested_chunks: embedded })
        .eq('id', documentId)

      console.log(`Progress: ${embedded}/${totalChunks} chunks embedded`)

      if (!isFullMode) break

    } while (!isComplete)

    if (isComplete) {
      await supabase
        .from('documents')
        .update({ ingestion_status: 'complete' })
        .eq('id', documentId)
    }

    const { count: finalEmbedded } = await supabase
      .from('chunks')
      .select('id', { count: 'exact', head: true })
      .eq('document_id', documentId)
      .not('embedding', 'is', null)

    const { data: finalDoc } = await supabase
      .from('documents')
      .select('total_chunks')
      .eq('id', documentId)
      .single()

    return new Response(
      JSON.stringify({
        success: true,
        tier: apiTier,
        processed: totalProcessed,
        embedded: finalEmbedded || 0,
        total: finalDoc?.total_chunks || 0,
        complete: isComplete,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error generating embeddings:', error)

    try {
      const bodyClone = await req.clone().json()
      const documentId = bodyClone?.documentId
      if (isValidUUID(documentId)) {
        await supabase
          .from('documents')
          .update({
            ingestion_status: 'failed',
            ingestion_error: error instanceof Error ? error.message.slice(0, 1000) : 'Unknown error'
          })
          .eq('id', documentId)
      }
    } catch {}

    return new Response(
      JSON.stringify({ success: false, error: 'Embedding generation failed. Please try again.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

/**
 * Use Google's batchEmbedContents API to embed up to 100 texts in a single call.
 * Retries with exponential backoff on rate-limit.
 */
async function batchEmbedTexts(apiKey: string, texts: string[]): Promise<string[]> {
  const MAX_RETRIES = 5

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
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

      let waitMs = attempt * 15000  // 15s, 30s, 45s, 60s, 75s
        if (retryDelay) {
          const seconds = parseFloat(retryDelay.replace('s', ''))
          if (!isNaN(seconds)) waitMs = Math.ceil(seconds * 1000) + 1000
        }
        // Cap wait time at 60s (baseline)
        waitMs = Math.min(waitMs, 60000)

        console.log(`Rate limited on batch of ${texts.length}, waiting ${waitMs}ms (attempt ${attempt}/${MAX_RETRIES})`)
        await new Promise(r => setTimeout(r, waitMs))
        continue
      }

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`Batch embedding API error (status ${response.status}):`, errorText)
        throw new Error(`Batch embedding API returned status ${response.status}`)
      }

      const data = await response.json()
      return data.embeddings.map((e: { values: number[] }) => `[${e.values.join(',')}]`)

    } catch (err) {
      if (attempt === MAX_RETRIES) throw err
      console.log(`Batch embed attempt ${attempt} failed: ${err instanceof Error ? err.message : err}`)
      await new Promise(r => setTimeout(r, attempt * 2000))
    }
  }

  throw new Error('All retries exhausted for batch embedding')
}
