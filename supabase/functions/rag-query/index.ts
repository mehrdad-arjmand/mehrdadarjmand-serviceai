import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface RAGQueryRequest {
  question: string
  site?: string
  equipment?: string
  faultCode?: string
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

    const { question, site, equipment, faultCode }: RAGQueryRequest = await req.json()
    
    console.log('RAG Query:', { question, site, equipment, faultCode })

    // Build context-aware query
    const fullQuery = buildFullQuery(question, site, equipment, faultCode)
    console.log('Full query:', fullQuery)

    // Generate embedding for the query
    const queryEmbedding = await generateEmbedding(fullQuery)

    // Perform vector similarity search
    // Format embedding as PostgreSQL vector string
    const embeddingStr = `[${queryEmbedding.join(',')}]`
    
    const { data: chunks, error: searchError } = await supabase.rpc(
      'match_chunks',
      {
        query_embedding: embeddingStr,
        match_threshold: 0.20, // Very low threshold to catch all potentially relevant content
        match_count: 20 // Retrieve many chunks to ensure we find the right content
      }
    )

    if (searchError) {
      console.error('Search error:', searchError)
      throw searchError
    }

    console.log(`Found ${chunks?.length || 0} relevant chunks`)
    if (chunks && chunks.length > 0) {
      console.log('Top chunk similarities:', chunks.map((c: any) => ({
        filename: c.filename,
        chunk: c.chunk_index,
        similarity: (c.similarity * 100).toFixed(1) + '%',
        preview: c.text.slice(0, 100)
      })))
    }

    // Build context from retrieved chunks
    const context = chunks
      ?.map((chunk: any, idx: number) => 
        `[Source ${idx + 1}: ${chunk.filename || 'Unknown'} | Chunk ${chunk.chunk_index} | Similarity: ${(chunk.similarity * 100).toFixed(1)}%]\n${chunk.text}`
      )
      .join('\n\n---\n\n') || 'No relevant context found.'

    // Generate answer using Lovable AI (Gemini Flash)
    const systemPrompt = `You are a field technician assistant for industrial energy systems. 

CRITICAL INSTRUCTIONS:
- Answer based on the provided context from documents
- Search thoroughly through ALL provided sources - relevant information may appear in any chunk
- If you find PARTIAL or RELATED information in the context, use it to answer the question
- Some chunks may contain table of contents or headers - look past these to find actual content
- Quote or reference specific details, numbers, procedures, and warnings from the context
- Only say "no information available" if you have thoroughly checked all sources and found nothing relevant
- Even if information seems incomplete, provide what you found with appropriate disclaimers
- Pay close attention to technical details, maintenance procedures, safety warnings, and specifications

Always prioritize safety - mention lock-out/tag-out procedures and safety warnings when relevant.`

    const userPrompt = `Site: ${site || 'Not specified'}
Equipment: ${equipment || 'Not specified'}
Fault Code: ${faultCode || 'Not specified'}

Technician Question: ${question}

Context from documents:
${context}

Please provide a clear, concise answer based on the context above.`

    const answer = await generateAnswer(systemPrompt, userPrompt)

    return new Response(
      JSON.stringify({ 
        success: true,
        answer,
        sources: chunks?.map((chunk: any) => ({
          filename: chunk.filename || 'Unknown',
          chunkIndex: chunk.chunk_index,
          text: chunk.text,
          similarity: chunk.similarity
        })) || []
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )
  } catch (error) {
    console.error('Error processing RAG query:', error)
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

function buildFullQuery(question: string, site?: string, equipment?: string, faultCode?: string): string {
  const parts = [question]
  if (site) parts.push(`Site: ${site}`)
  if (equipment) parts.push(`Equipment: ${equipment}`)
  if (faultCode) parts.push(`Fault code: ${faultCode}`)
  return parts.join(' ')
}

async function generateEmbedding(text: string): Promise<number[]> {
  const GOOGLE_API_KEY = Deno.env.get('GOOGLE_API_KEY')
  if (!GOOGLE_API_KEY) {
    throw new Error('GOOGLE_API_KEY not configured')
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${GOOGLE_API_KEY}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: {
          parts: [{ text }]
        }
      })
    }
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to generate embedding: ${error}`)
  }

  const data = await response.json()
  return data.embedding.values
}

async function generateAnswer(systemPrompt: string, userPrompt: string): Promise<string> {
  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${Deno.env.get('LOVABLE_API_KEY')}`
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3
    })
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to generate answer: ${error}`)
  }

  const data = await response.json()
  return data.choices[0].message.content
}