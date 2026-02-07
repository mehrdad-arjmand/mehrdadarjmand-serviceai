import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Process embeddings in small batches to avoid CPU timeout
const BATCH_SIZE = 15
const MAX_CHUNK_TEXT_LENGTH = 10000 // Maximum text length per chunk for embedding

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

  // Verify the user's JWT token using getUser
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

  console.log(`Generating embeddings for user: ${user.id}`)

  // Use service role client for database operations
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Check permission: repository.write required for embedding generation
  const { data: hasPermission, error: permError } = await supabase.rpc('has_permission', {
    p_tab: 'repository',
    p_action: 'write',
    p_user_id: user.id
  })

  if (permError) {
    console.error('Permission check error:', permError)
    return new Response(
      JSON.stringify({ error: 'Permission check failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  if (!hasPermission) {
    console.log(`User ${user.id} denied: repository.write permission required`)
    return new Response(
      JSON.stringify({ error: 'Forbidden: You do not have permission to generate embeddings' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    // Validate content-type
    const contentType = req.headers.get('content-type')
    if (!contentType?.includes('application/json')) {
      throw new Error('Content-Type must be application/json')
    }

    // Parse and validate request body
    let body: unknown
    try {
      body = await req.json()
    } catch {
      throw new Error('Invalid JSON body')
    }

    if (typeof body !== 'object' || body === null) {
      throw new Error('Request body must be an object')
    }

    const { documentId } = body as { documentId?: unknown }

    // Validate documentId
    if (!isValidUUID(documentId)) {
      throw new Error('documentId must be a valid UUID')
    }

    // Retry logic for transient connection errors
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

    // Get chunks without embeddings for this document
    const chunks = await fetchWithRetry(async () => {
      const { data, error } = await supabase
        .from('chunks')
        .select('id, text')
        .eq('document_id', documentId)
        .is('embedding', null)
        .order('chunk_index')
        .limit(BATCH_SIZE)
      if (error) throw error
      return data
    })

    // Get document info for progress tracking
    const { data: doc } = await supabase
      .from('documents')
      .select('total_chunks')
      .eq('id', documentId)
      .single()

    const totalChunks = doc?.total_chunks || 0

    // Count chunks that already have embeddings
    const { count: embeddedCount } = await supabase
      .from('chunks')
      .select('id', { count: 'exact', head: true })
      .eq('document_id', documentId)
      .not('embedding', 'is', null)

    const chunksWithEmbeddings = embeddedCount || 0

    if (!chunks || chunks.length === 0) {
      // All chunks have embeddings, mark as complete
      await supabase
        .from('documents')
        .update({ ingestion_status: 'complete' })
        .eq('id', documentId)

      return new Response(
        JSON.stringify({ 
          success: true, 
          processed: 0, 
          embedded: totalChunks,
          total: totalChunks,
          complete: true 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Generating embeddings for ${chunks.length} chunks of document ${documentId} (${chunksWithEmbeddings}/${totalChunks} done)`)

    // Validate and truncate chunk text before sending to API
    const textsToEmbed = chunks.map(c => {
      const text = c.text
      if (typeof text !== 'string' || text.trim().length === 0) {
        return 'empty chunk' // Fallback for invalid text
      }
      // Truncate if too long
      return text.slice(0, MAX_CHUNK_TEXT_LENGTH)
    })

    // Generate embeddings using Lovable AI gateway
    const embeddings = await generateEmbeddings(textsToEmbed)

    // Update each chunk with its embedding
    for (let i = 0; i < chunks.length; i++) {
      await fetchWithRetry(async () => {
        const { error: updateError } = await supabase
          .from('chunks')
          .update({ embedding: embeddings[i] })
          .eq('id', chunks[i].id)
        if (updateError) throw updateError
      })
    }

    // Get updated count of chunks with embeddings
    const { count: newEmbeddedCount } = await supabase
      .from('chunks')
      .select('id', { count: 'exact', head: true })
      .eq('document_id', documentId)
      .not('embedding', 'is', null)

    const newChunksWithEmbeddings = newEmbeddedCount || 0
    const remaining = totalChunks - newChunksWithEmbeddings
    const isComplete = remaining === 0

    if (isComplete) {
      await supabase
        .from('documents')
        .update({ ingestion_status: 'complete' })
        .eq('id', documentId)
    }

    console.log(`Processed ${chunks.length} embeddings, ${newChunksWithEmbeddings}/${totalChunks} complete`)

    return new Response(
      JSON.stringify({ 
        success: true, 
        processed: chunks.length, 
        embedded: newChunksWithEmbeddings,
        total: totalChunks,
        remaining,
        complete: isComplete 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error generating embeddings:', error)
    
    // Try to mark document as failed
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
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

// Generate embeddings using Google's Embedding API (text-embedding-004)
async function generateEmbeddings(texts: string[]): Promise<string[]> {
  const apiKey = Deno.env.get('GOOGLE_API_KEY')
  if (!apiKey) {
    throw new Error('GOOGLE_API_KEY is not configured')
  }

  const embeddings: string[] = []

  // Process each text individually with Google's batch embedding
  for (const text of texts) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'models/text-embedding-004',
          content: { parts: [{ text }] }
        })
      }
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to generate embedding: ${error}`)
    }

    const data = await response.json()
    // Convert to pgvector format string
    const embedding = data.embedding.values
    embeddings.push(`[${embedding.join(',')}]`)
  }

  return embeddings
}
