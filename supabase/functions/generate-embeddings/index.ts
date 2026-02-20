import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Batch sizes and concurrency settings
const BATCH_SIZE = 10 // Chunks per embedding batch call
const MAX_CHUNK_TEXT_LENGTH = 10000
const CONCURRENT_BATCHES = 3 // Process 3 batches concurrently for throughput
const DELAY_BETWEEN_BATCHES_MS = 200 // Minimal delay between concurrent batch starts

// UUID validation
function isValidUUID(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  return uuidRegex.test(value)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

  // Validate JWT authentication
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ error: 'Missing or invalid authorization header' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const token = authHeader.replace('Bearer ', '')
  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false }
  })
  
  const { data: { user }, error: authError } = await authClient.auth.getUser(token)
  
  if (authError || !user) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: Invalid token' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Check permission
  const { data: hasPermission, error: permError } = await supabase.rpc('has_permission', {
    p_tab: 'repository',
    p_action: 'write',
    p_user_id: user.id
  })

  if (permError || !hasPermission) {
    return new Response(
      JSON.stringify({ error: 'Forbidden: repository.write permission required' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const contentType = req.headers.get('content-type')
    if (!contentType?.includes('application/json')) {
      throw new Error('Content-Type must be application/json')
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      throw new Error('Invalid JSON body')
    }

    if (typeof body !== 'object' || body === null) {
      throw new Error('Request body must be an object')
    }

    const { documentId, mode } = body as { documentId?: unknown; mode?: string }

    if (!isValidUUID(documentId)) {
      throw new Error('documentId must be a valid UUID')
    }

    // mode=full: server-side orchestration loop (processes ALL chunks until done)
    // mode=batch (default): process one batch and return (legacy frontend-driven mode)
    const isFullMode = mode === 'full'

    console.log(`Generating embeddings for document ${documentId}, mode=${isFullMode ? 'full' : 'batch'}, user=${user.id}`)

    const fetchWithRetry = async <T>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> => {
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          return await fn()
        } catch (err) {
          if (attempt === retries) throw err
          console.log(`Attempt ${attempt} failed, retrying in ${delay}ms...`)
          await new Promise(resolve => setTimeout(resolve, delay))
          delay *= 2
        }
      }
      throw new Error('All retries exhausted')
    }

    let totalProcessed = 0
    let isComplete = false

    // Loop: process batches until all chunks have embeddings
    do {
      // Get chunks without embeddings
      const { data: chunks, error: chunksError } = await supabase
        .from('chunks')
        .select('id, text')
        .eq('document_id', documentId)
        .is('embedding', null)
        .order('chunk_index')
        .limit(BATCH_SIZE * CONCURRENT_BATCHES)

      if (chunksError) throw chunksError

      if (!chunks || chunks.length === 0) {
        isComplete = true
        break
      }

      // Split into concurrent sub-batches
      const subBatches: typeof chunks[] = []
      for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        subBatches.push(chunks.slice(i, i + BATCH_SIZE))
      }

      // Process sub-batches with controlled concurrency
      for (const batch of subBatches) {
        const textsToEmbed = batch.map(c => {
          const text = c.text
          if (typeof text !== 'string' || text.trim().length === 0) return 'empty chunk'
          return text.slice(0, MAX_CHUNK_TEXT_LENGTH)
        })

        const embeddings = await generateEmbeddings(textsToEmbed)

        // Update chunks with embeddings
        for (let i = 0; i < batch.length; i++) {
          await fetchWithRetry(async () => {
            const { error: updateError } = await supabase
              .from('chunks')
              .update({ embedding: embeddings[i] })
              .eq('id', batch[i].id)
            if (updateError) throw updateError
          })
        }

        totalProcessed += batch.length

        // Brief delay between sub-batches to stay within rate limits
        if (subBatches.indexOf(batch) < subBatches.length - 1) {
          await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES_MS))
        }
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

      // Update ingested_chunks for live progress tracking
      await supabase
        .from('documents')
        .update({ ingested_chunks: embedded })
        .eq('id', documentId)

      console.log(`Progress: ${embedded}/${totalChunks} chunks embedded`)

      if (!isFullMode) break // Legacy mode: return after one iteration

    } while (!isComplete)

    // Mark complete or still in progress
    if (isComplete) {
      await supabase
        .from('documents')
        .update({ ingestion_status: 'complete' })
        .eq('id', documentId)
    }

    // Get final counts
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

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Generate embeddings using Google's Gemini Embedding API with rate limiting
async function generateEmbeddings(texts: string[]): Promise<string[]> {
  const apiKey = Deno.env.get('GOOGLE_API_KEY')
  if (!apiKey) {
    throw new Error('GOOGLE_API_KEY is not configured')
  }

  const embeddings: string[] = []
  const DELAY_BETWEEN_REQUESTS_MS = 400 // Reduced from 700ms — safe at ~150 req/min with 10-chunk batches
  const MAX_RETRIES = 3

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i]
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: { parts: [{ text }] },
              outputDimensionality: 768
            })
          }
        )

        if (response.status === 429) {
          const errorData = await response.json().catch(() => ({}))
          const retryDelay = errorData?.error?.details?.find(
            (d: { '@type': string }) => d['@type']?.includes('RetryInfo')
          )?.retryDelay

          let waitMs = attempt * 10000
          if (retryDelay) {
            const seconds = parseFloat(retryDelay.replace('s', ''))
            if (!isNaN(seconds)) waitMs = Math.ceil(seconds * 1000) + 1000
          }

          console.log(`Rate limited on chunk ${i + 1}/${texts.length}, waiting ${waitMs}ms (attempt ${attempt}/${MAX_RETRIES})`)
          await delay(waitMs)
          continue
        }

        if (!response.ok) {
          const errorText = await response.text()
          console.error(`Embedding API error (status ${response.status}):`, errorText)
          throw new Error(`Embedding API returned status ${response.status}`)
        }

        const data = await response.json()
        const embedding = data.embedding.values
        embeddings.push(`[${embedding.join(',')}]`)

        // Delay between requests to avoid rate limits
        if (i < texts.length - 1) {
          await delay(DELAY_BETWEEN_REQUESTS_MS)
        }

        lastError = null
        break
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        if (attempt < MAX_RETRIES) {
          console.log(`Error on chunk ${i + 1}, attempt ${attempt}: ${lastError.message}`)
          await delay(attempt * 2000)
        }
      }
    }

    if (lastError) throw lastError
  }

  return embeddings
}
