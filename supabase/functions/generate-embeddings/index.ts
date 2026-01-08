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

    // Get chunks without embeddings for this document
    const { data: chunks, error: fetchError } = await supabase
      .from('chunks')
      .select('id, text')
      .eq('document_id', documentId)
      .is('embedding', null)
      .order('chunk_index')
      .limit(BATCH_SIZE)

    if (fetchError) throw fetchError

    if (!chunks || chunks.length === 0) {
      // All chunks have embeddings, mark as complete
      await supabase
        .from('documents')
        .update({ ingestion_status: 'complete' })
        .eq('id', documentId)

      return new Response(
        JSON.stringify({ success: true, processed: 0, complete: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Generating embeddings for ${chunks.length} chunks of document ${documentId}`)

    // Generate embeddings using Lovable API
    const embeddings = await generateEmbeddings(chunks.map(c => c.text))

    // Update each chunk with its embedding
    for (let i = 0; i < chunks.length; i++) {
      const { error: updateError } = await supabase
        .from('chunks')
        .update({ embedding: embeddings[i] })
        .eq('id', chunks[i].id)

      if (updateError) {
        console.error(`Failed to update chunk ${chunks[i].id}:`, updateError)
      }
    }

    // Check if more chunks need processing
    const { count } = await supabase
      .from('chunks')
      .select('id', { count: 'exact', head: true })
      .eq('document_id', documentId)
      .is('embedding', null)

    const hasMore = (count ?? 0) > 0

    if (!hasMore) {
      await supabase
        .from('documents')
        .update({ ingestion_status: 'complete' })
        .eq('id', documentId)
    }

    console.log(`Processed ${chunks.length} embeddings, ${count ?? 0} remaining`)

    return new Response(
      JSON.stringify({ 
        success: true, 
        processed: chunks.length, 
        remaining: count ?? 0,
        complete: !hasMore 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error generating embeddings:', error)
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const response = await fetch('https://api.lovable.app/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${Deno.env.get('LOVABLE_API_KEY')}`
    },
    body: JSON.stringify({
      input: texts,
      model: 'text-embedding-004'
    })
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to generate embeddings: ${error}`)
  }

  const data = await response.json()
  return data.data.map((item: { embedding: number[] }) => item.embedding)
}
