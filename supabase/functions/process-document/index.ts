import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ProcessDocumentRequest {
  documentId: string
  filename: string
  content: string
  pageCount?: number
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

  let documentId = ''
  
  try {
    // Validate JWT authentication
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Verify the user's JWT token using getUser
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    })
    
    const { data: { user }, error: authError } = await authClient.auth.getUser()
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized: Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Processing document for user: ${user.id}`)

    // Use service role client for database operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const { documentId: docId, filename, content, pageCount }: ProcessDocumentRequest = await req.json()
    documentId = docId
    
    console.log(`Processing document: ${filename} (ID: ${documentId}), content length: ${content.length}, pages: ${pageCount || 'unknown'}`)

    // Update status to in_progress
    await supabase
      .from('documents')
      .update({ 
        ingestion_status: 'in_progress',
        page_count: pageCount || null
      })
      .eq('id', documentId)

    // Chunk text - 800 chars with 200 overlap
    const chunks = chunkText(content, 800, 200)
    console.log(`Created ${chunks.length} chunks from ${content.length} characters`)

    // PHASE 1: Save all chunks WITHOUT embeddings (fast, avoids CPU timeout)
    const BATCH_SIZE = 50
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE).map((text, idx) => ({
        document_id: documentId,
        chunk_index: i + idx,
        text,
        embedding: null
      }))
      
      const { error } = await supabase.from('chunks').insert(batch)
      if (error) throw error
    }

    // Update status - chunks saved, embeddings pending
    await supabase
      .from('documents')
      .update({ 
        ingestion_status: 'processing_embeddings',
        ingested_chunks: chunks.length
      })
      .eq('id', documentId)

    console.log(`Saved ${chunks.length} chunks, embeddings will be generated separately`)

    return new Response(
      JSON.stringify({ 
        success: true, 
        chunksCount: chunks.length,
        status: 'processing_embeddings'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error processing document:', error)
    const message = error instanceof Error ? error.message : 'Unknown error occurred'
    
    if (documentId) {
      // Recreate supabase client for error handling
      const supabaseForError = createClient(supabaseUrl, supabaseServiceKey)
      await supabaseForError
        .from('documents')
        .update({ 
          ingestion_status: 'failed',
          ingestion_error: message
        })
        .eq('id', documentId)
    }
    
    return new Response(
      JSON.stringify({ error: message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

function chunkText(text: string, chunkSize: number, overlap: number): string[] {
  const chunks: string[] = []
  let start = 0

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length)
    chunks.push(text.slice(start, end))
    start = end - overlap
    if (start <= 0) start = end
  }

  return chunks
}
