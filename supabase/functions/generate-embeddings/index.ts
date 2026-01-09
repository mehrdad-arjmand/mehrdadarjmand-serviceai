import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Process embeddings in small batches to avoid CPU timeout
const BATCH_SIZE = 15

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  try {
    const { documentId } = await req.json()

    if (!documentId) {
      throw new Error('documentId is required')
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

    // Generate embeddings using Google API directly
    const embeddings = await generateEmbeddings(chunks.map(c => c.text))

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
      const { documentId } = await req.clone().json()
      if (documentId) {
        await supabase
          .from('documents')
          .update({ 
            ingestion_status: 'failed',
            ingestion_error: error instanceof Error ? error.message : 'Unknown error'
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

async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const apiKey = Deno.env.get('GOOGLE_API_KEY')
  if (!apiKey) {
    throw new Error('GOOGLE_API_KEY is not configured')
  }

  // Use Google's batch embedding endpoint
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: texts.map(text => ({
          model: 'models/text-embedding-004',
          content: { parts: [{ text }] }
        }))
      })
    }
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to generate embeddings: ${error}`)
  }

  const data = await response.json()
  return data.embeddings.map((item: { values: number[] }) => item.values)
}
