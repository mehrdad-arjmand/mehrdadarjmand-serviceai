import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ProcessDocumentRequest {
  documentId: string
  filename: string
  content: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { documentId, filename, content }: ProcessDocumentRequest = await req.json()
    
    console.log(`Processing document: ${filename} (ID: ${documentId})`)

    // Chunk the text content (simple chunking with overlap)
    const chunks = chunkText(content, 1000, 200)
    console.log(`Created ${chunks.length} chunks`)

    // Generate embeddings for each chunk
    const chunksWithEmbeddings = []
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      console.log(`Processing chunk ${i + 1}/${chunks.length}`)
      
      // Generate embedding using Google's free text-embedding model
      const embedding = await generateEmbedding(chunk)
      
      chunksWithEmbeddings.push({
        document_id: documentId,
        chunk_index: i,
        text: chunk,
        embedding: embedding,
      })
    }

    // Insert all chunks into database
    const { error: insertError } = await supabase
      .from('chunks')
      .insert(chunksWithEmbeddings)

    if (insertError) {
      throw insertError
    }

    console.log(`Successfully indexed ${chunksWithEmbeddings.length} chunks`)

    return new Response(
      JSON.stringify({ 
        success: true, 
        chunksCount: chunksWithEmbeddings.length 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )
  } catch (error) {
    console.error('Error processing document:', error)
    const message = error instanceof Error ? error.message : 'Unknown error occurred'
    return new Response(
      JSON.stringify({ error: message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
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

async function generateEmbedding(text: string): Promise<number[]> {
  // Use Lovable AI's free models via LOVABLE_API_KEY
  const response = await fetch('https://api.lovable.app/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${Deno.env.get('LOVABLE_API_KEY')}`
    },
    body: JSON.stringify({
      input: text,
      model: 'text-embedding-004'
    })
  })

  if (!response.ok) {
    const error = await response.text()
    console.error('Embedding API error:', error)
    throw new Error(`Failed to generate embedding: ${error}`)
  }

  const data = await response.json()
  return data.data[0].embedding
}