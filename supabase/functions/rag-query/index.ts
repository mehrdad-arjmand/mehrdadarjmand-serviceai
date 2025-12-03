import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface RAGQueryRequest {
  question: string
  // Optional document filters
  documentType?: string
  uploadDate?: string
  filterSite?: string
  equipmentMake?: string
  equipmentModel?: string
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

    const { 
      question, 
      documentType,
      uploadDate,
      filterSite,
      equipmentMake,
      equipmentModel
    }: RAGQueryRequest = await req.json()
    
    console.log('RAG Query:', { 
      question, 
      filters: { documentType, uploadDate, filterSite, equipmentMake, equipmentModel }
    })

    // Use question directly for embedding
    const fullQuery = question
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

    // Apply document filters if provided
    let filteredChunks = chunks || []
    
    if (documentType || uploadDate || filterSite || equipmentMake || equipmentModel) {
      // Get matching document IDs based on filters
      let docQuery = supabase.from('documents').select('id')
      
      if (documentType) docQuery = docQuery.eq('doc_type', documentType)
      if (uploadDate) docQuery = docQuery.eq('upload_date', uploadDate)
      if (filterSite) docQuery = docQuery.eq('site', filterSite)
      if (equipmentMake) docQuery = docQuery.eq('equipment_make', equipmentMake)
      if (equipmentModel) docQuery = docQuery.eq('equipment_model', equipmentModel)
      
      const { data: matchingDocs, error: filterError } = await docQuery
      
      if (filterError) {
        console.error('Filter error:', filterError)
        throw filterError
      }
      
      if (!matchingDocs || matchingDocs.length === 0) {
        return new Response(
          JSON.stringify({ 
            success: true,
            answer: 'No documents match the selected filters. Try broadening your filters or searching all documents.',
            sources: []
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200 
          }
        )
      }
      
      const matchingDocIds = new Set(matchingDocs.map(d => d.id))
      filteredChunks = filteredChunks.filter((chunk: any) => matchingDocIds.has(chunk.document_id))
      
      console.log(`Filtered to ${filteredChunks.length} chunks from ${matchingDocs.length} matching documents`)
    }

    // Merge semantic search results with keyword-based fallback chunks
    const combinedChunks = await enrichWithKeywordFallback(supabase, question, filteredChunks)

    // Build context from retrieved chunks
    const context = combinedChunks
      .map((chunk: any, idx: number) => 
        `[Source ${idx + 1}: ${chunk.filename || 'Unknown'} | Chunk ${chunk.chunk_index} | Similarity: ${chunk.similarity ? (chunk.similarity * 100).toFixed(1) : 'N/A'}%]\n${chunk.text}`
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

    const userPrompt = `Technician Question: ${question}

Context from documents:
${context}

Please provide a clear, concise answer based on the context above.`

    const answer = await generateAnswer(systemPrompt, userPrompt)

    return new Response(
      JSON.stringify({ 
        success: true,
        answer,
        sources: combinedChunks.map((chunk: any) => ({
          filename: chunk.filename || 'Unknown',
          chunkIndex: chunk.chunk_index,
          text: chunk.text,
          similarity: chunk.similarity
        }))
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

const STOP_WORDS = new Set<string>([
  'the','and','for','with','that','this','from','have','what','when','where','which','will','would','could','should',
  'about','your','into','over','under','after','before','while','there','here','such','than','then','every','years','year'
])

async function enrichWithKeywordFallback(supabase: any, question: string, initialChunks: any[]): Promise<any[]> {
  try {
    const tokens = (question.toLowerCase().match(/[a-z0-9]+/g) || []).filter(
      (word) => word.length >= 4 && !STOP_WORDS.has(word)
    )

    if (tokens.length === 0) {
      return initialChunks
    }

    // Use multiple keywords for better matching
    const sortedTokens = [...tokens].sort((a, b) => b.length - a.length).slice(0, 3)
    console.log('Keyword fallback search using:', sortedTokens)

    // Query chunks with document join to get filename
    const { data, error } = await supabase
      .from('chunks')
      .select('id, document_id, chunk_index, text, site, equipment, fault_code, documents!inner(filename)')
      .or(sortedTokens.map(kw => `text.ilike.%${kw}%`).join(','))
      .limit(30)

    if (error) {
      console.error('Keyword fallback search error:', error)
      return initialChunks
    }

    const existingIds = new Set(initialChunks.map((c: any) => c.id))
    const mergedChunks = [...initialChunks]

    for (const row of data || []) {
      if (!existingIds.has(row.id)) {
        mergedChunks.push({
          ...row,
          similarity: 0.5, // Assign moderate similarity for keyword matches
          filename: row.documents?.filename ?? 'Unknown',
        })
      }
    }

    console.log(`Keyword fallback added ${(data || []).length} chunks (after dedup: ${mergedChunks.length})`)

    return mergedChunks
  } catch (error) {
    console.error('Keyword fallback search unexpected error:', error)
    return initialChunks
  }
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