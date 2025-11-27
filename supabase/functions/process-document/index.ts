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

    // Limit content size to stay within Edge function compute limits
    const MAX_TEXT_LENGTH = 40000
    const trimmedContent = content.length > MAX_TEXT_LENGTH 
      ? content.slice(0, MAX_TEXT_LENGTH) 
      : content

    // Chunk the text content (simple chunking with overlap)
    const chunks = chunkText(trimmedContent, 1000, 200)
    console.log(`Created ${chunks.length} chunks from ${trimmedContent.length} characters (original length: ${content.length})`)

    // Process chunks in batches to avoid memory and compute limits
    const MAX_CHUNKS = 80
    const totalChunks = Math.min(chunks.length, MAX_CHUNKS)
    const chunksToProcess = chunks.slice(0, totalChunks)

    if (totalChunks < chunks.length) {
      console.log(`Limiting chunks from ${chunks.length} to ${totalChunks} to stay within compute limits`)
    }

    const BATCH_SIZE = 10
    let totalProcessed = 0
    
    for (let batchStart = 0; batchStart < totalChunks; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, totalChunks)
      const batchChunks = chunksToProcess.slice(batchStart, batchEnd)
      
      console.log(`Processing batch ${Math.floor(batchStart / BATCH_SIZE) + 1}/${Math.ceil(totalChunks / BATCH_SIZE)}`)
      
      // Generate embeddings for this batch in a single API call
      const embeddings = await generateEmbeddings(batchChunks)
      const chunksWithEmbeddings = []
      
      for (let i = 0; i < batchChunks.length; i++) {
        const globalIndex = batchStart + i
        const chunk = batchChunks[i]
        const embedding = embeddings[i]
        console.log(`Processing chunk ${globalIndex + 1}/${totalChunks}`)
        
        chunksWithEmbeddings.push({
          document_id: documentId,
          chunk_index: globalIndex,
          text: chunk,
          embedding: embedding,
        })
      }

      // Insert this batch into database
      const { error: insertError } = await supabase
        .from('chunks')
        .insert(chunksWithEmbeddings)

      if (insertError) {
        console.error(`Error inserting batch at index ${batchStart}:`, insertError)
        throw insertError
      }
      
      totalProcessed += chunksWithEmbeddings.length
      console.log(`Batch complete. Total processed: ${totalProcessed}/${totalChunks}`)
    }

    console.log(`Successfully indexed ${totalProcessed} chunks`)

    return new Response(
      JSON.stringify({ 
        success: true, 
        chunksCount: totalProcessed 
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

async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  // Use Lovable AI's free models via LOVABLE_API_KEY
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
    console.error('Embedding API error:', error)
    throw new Error(`Failed to generate embeddings: ${error}`)
  }

  const data = await response.json()
  return data.data.map((item: { embedding: number[] }) => item.embedding)
}