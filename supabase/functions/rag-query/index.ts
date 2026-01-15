import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ConversationMessage {
  role: "user" | "assistant"
  content: string
}

interface RAGQueryRequest {
  question: string
  // Optional document filters
  documentType?: string
  uploadDate?: string
  filterSite?: string
  equipmentType?: string
  equipmentMake?: string
  equipmentModel?: string
  // Conversation mode
  history?: ConversationMessage[]
  isConversationMode?: boolean
}

// Input validation constants
const MAX_QUESTION_LENGTH = 2000
const MAX_FILTER_LENGTH = 200
const MAX_HISTORY_LENGTH = 20
const MAX_HISTORY_CONTENT_LENGTH = 5000

// Validation helpers
function isValidString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength
}

function isValidOptionalString(value: unknown, maxLength: number): boolean {
  return value === undefined || value === null || isValidString(value, maxLength)
}

function isValidDate(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value !== 'string') return false
  // Basic ISO date format check (YYYY-MM-DD)
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function isValidHistory(history: unknown): history is ConversationMessage[] {
  if (!Array.isArray(history)) return false
  if (history.length > MAX_HISTORY_LENGTH) return false
  return history.every(item => 
    typeof item === 'object' && 
    item !== null &&
    (item.role === 'user' || item.role === 'assistant') &&
    typeof item.content === 'string' &&
    item.content.length <= MAX_HISTORY_CONTENT_LENGTH
  )
}

function sanitizeString(value: string | undefined | null): string | undefined {
  if (value === undefined || value === null) return undefined
  return value.trim().slice(0, MAX_FILTER_LENGTH)
}

// Sanitize query for LIKE patterns to prevent wildcard injection
function sanitizeLikePattern(query: string): string {
  return query.replace(/[%_\\]/g, (char) => `\\${char}`)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
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

    console.log(`RAG query from user: ${user.id}`)

    // Use service role client for database operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Validate content-type
    const contentType = req.headers.get('content-type')
    if (!contentType?.includes('application/json')) {
      throw new Error('Content-Type must be application/json')
    }

    // Parse request body with error handling
    let body: unknown
    try {
      body = await req.json()
    } catch {
      throw new Error('Invalid JSON body')
    }

    if (typeof body !== 'object' || body === null) {
      throw new Error('Request body must be an object')
    }

    const rawRequest = body as Record<string, unknown>

    // Validate question (required)
    if (!isValidString(rawRequest.question, MAX_QUESTION_LENGTH)) {
      throw new Error(`Question must be a string with max ${MAX_QUESTION_LENGTH} characters`)
    }

    // Validate optional filters
    if (!isValidOptionalString(rawRequest.documentType, MAX_FILTER_LENGTH)) {
      throw new Error(`documentType must be a string with max ${MAX_FILTER_LENGTH} characters`)
    }
    if (!isValidDate(rawRequest.uploadDate)) {
      throw new Error('uploadDate must be a valid date in YYYY-MM-DD format')
    }
    if (!isValidOptionalString(rawRequest.filterSite, MAX_FILTER_LENGTH)) {
      throw new Error(`filterSite must be a string with max ${MAX_FILTER_LENGTH} characters`)
    }
    if (!isValidOptionalString(rawRequest.equipmentType, MAX_FILTER_LENGTH)) {
      throw new Error(`equipmentType must be a string with max ${MAX_FILTER_LENGTH} characters`)
    }
    if (!isValidOptionalString(rawRequest.equipmentMake, MAX_FILTER_LENGTH)) {
      throw new Error(`equipmentMake must be a string with max ${MAX_FILTER_LENGTH} characters`)
    }
    if (!isValidOptionalString(rawRequest.equipmentModel, MAX_FILTER_LENGTH)) {
      throw new Error(`equipmentModel must be a string with max ${MAX_FILTER_LENGTH} characters`)
    }

    // Validate history if provided
    if (rawRequest.history !== undefined && !isValidHistory(rawRequest.history)) {
      throw new Error(`history must be an array of max ${MAX_HISTORY_LENGTH} messages with valid role and content`)
    }

    // Validate isConversationMode
    if (rawRequest.isConversationMode !== undefined && typeof rawRequest.isConversationMode !== 'boolean') {
      throw new Error('isConversationMode must be a boolean')
    }

    // Build validated request
    const request: RAGQueryRequest = {
      question: (rawRequest.question as string).trim().slice(0, MAX_QUESTION_LENGTH),
      documentType: sanitizeString(rawRequest.documentType as string | undefined),
      uploadDate: rawRequest.uploadDate as string | undefined,
      filterSite: sanitizeString(rawRequest.filterSite as string | undefined),
      equipmentType: sanitizeString(rawRequest.equipmentType as string | undefined),
      equipmentMake: sanitizeString(rawRequest.equipmentMake as string | undefined),
      equipmentModel: sanitizeString(rawRequest.equipmentModel as string | undefined),
      history: rawRequest.history as ConversationMessage[] | undefined,
      isConversationMode: rawRequest.isConversationMode as boolean | undefined
    }

    const { 
      question, 
      documentType,
      uploadDate,
      filterSite,
      equipmentType,
      equipmentMake,
      equipmentModel,
      history,
      isConversationMode
    } = request
    
    console.log('RAG Query:', { 
      question: question.slice(0, 100), 
      filters: { documentType, uploadDate, filterSite, equipmentType, equipmentMake, equipmentModel },
      isConversationMode,
      historyLength: history?.length || 0
    })

    // Generate embedding for the query
    const queryEmbedding = await generateEmbedding(question)

    // Perform vector similarity search with high count to ensure we get diverse results
    const embeddingStr = `[${queryEmbedding.join(',')}]`
    
    const { data: chunks, error: searchError } = await supabase.rpc(
      'match_chunks',
      {
        query_embedding: embeddingStr,
        match_threshold: 0.15, // Very low threshold
        match_count: 50 // Get many chunks to ensure we find actual content
      }
    )

    if (searchError) {
      console.error('Search error:', searchError)
      throw searchError
    }

    console.log(`Found ${chunks?.length || 0} semantic chunks`)

    // Apply document filters if provided
    let filteredChunks = chunks || []
    
    if (documentType || uploadDate || filterSite || equipmentMake || equipmentModel) {
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

    // Apply equipment type filter on chunks (this field is on chunks table)
    if (equipmentType) {
      filteredChunks = filteredChunks.filter((chunk: any) => chunk.equipment === equipmentType)
      console.log(`After equipment type filter: ${filteredChunks.length} chunks`)
    }

    // Get matching document IDs for filters (to pass to keyword fallback)
    let matchingDocIds: Set<string> | null = null
    if (documentType || uploadDate || filterSite || equipmentMake || equipmentModel) {
      let docQuery = supabase.from('documents').select('id')
      if (documentType) docQuery = docQuery.eq('doc_type', documentType)
      if (uploadDate) docQuery = docQuery.eq('upload_date', uploadDate)
      if (filterSite) docQuery = docQuery.eq('site', filterSite)
      if (equipmentMake) docQuery = docQuery.eq('equipment_make', equipmentMake)
      if (equipmentModel) docQuery = docQuery.eq('equipment_model', equipmentModel)
      
      const { data: matchingDocs } = await docQuery
      if (matchingDocs && matchingDocs.length > 0) {
        matchingDocIds = new Set(matchingDocs.map(d => d.id))
      }
    }

    // Merge with aggressive keyword search - PASS FILTERS to ensure keyword fallback respects them
    const combinedChunks = await enrichWithKeywordFallback(
      supabase, 
      question, 
      filteredChunks, 
      matchingDocIds,
      equipmentType
    )
    // Re-rank chunks: prioritize substantive content over TOC/index entries
    const rankedChunks = rerankChunks(combinedChunks, question)

    // Take top chunks for context
    const topChunks = rankedChunks.slice(0, 30)

    console.log('Top ranked chunks:', topChunks.slice(0, 5).map((c: any) => ({
      chunk: c.chunk_index,
      score: c.finalScore?.toFixed(3),
      isTOC: c.isTOC,
      preview: c.text.slice(0, 80)
    })))

    // Build context from retrieved chunks
    const context = topChunks
      .map((chunk: any, idx: number) => 
        `[Source ${idx + 1}: ${chunk.filename || 'Unknown'} | Chunk ${chunk.chunk_index}]\n${chunk.text}`
      )
      .join('\n\n---\n\n') || 'No relevant context found.'

    // Generate answer using Lovable AI (Gemini Flash)
    const systemPrompt = isConversationMode 
      ? `You are a voice assistant for field technicians working on industrial energy systems.

VOICE MODE INSTRUCTIONS:
- Answer in concise, spoken language suitable for being read aloud
- Avoid reading out bullet points, asterisks, colons, or formatting syntax
- Use short paragraphs and natural sentence flow
- Do not say "asterisk" or describe formatting - speak naturally
- Keep answers brief and actionable - under 150 words when possible
- If the topic is complex, offer to provide more detail: "Would you like me to explain further?"

CRITICAL RETRIEVAL INSTRUCTIONS:
- Answer based on the provided context from documents
- Search through ALL provided sources - actual content may be in later sources
- IGNORE table of contents entries - look for actual procedural content
- Quote specific details, numbers, procedures when relevant
- Always mention safety warnings when relevant.`
      : `You are a field technician assistant for industrial energy systems. 

CRITICAL INSTRUCTIONS:
- Answer based on the provided context from documents
- Search thoroughly through ALL provided sources - the actual content you need may be in later sources, not just the first few
- IGNORE table of contents entries that just list page numbers - look for actual procedural content with specific instructions
- If a source contains actual step-by-step instructions, specific values, or detailed procedures, prioritize that over TOC entries
- Quote specific details, numbers, procedures, measurements, and warnings from the context
- Look for sections that contain actual maintenance steps, not just section headings

Always prioritize safety - mention safety warnings when relevant.`

    // Build conversation context if in conversation mode
    let conversationContext = ''
    if (isConversationMode && history && history.length > 0) {
      // Include last 4 exchanges for context
      const recentHistory = history.slice(-8)
      conversationContext = '\n\nRecent conversation:\n' + recentHistory
        .map(m => `${m.role === 'user' ? 'Technician' : 'Assistant'}: ${m.content}`)
        .join('\n')
    }

    const userPrompt = `Technician Question: ${question}
${conversationContext}
Context from documents (search ALL sources carefully - actual content may be in later chunks):
${context}

Please provide a clear, concise answer based on the actual procedural content in the context above. Ignore table of contents entries.`

    const answer = await generateAnswer(systemPrompt, userPrompt)

    return new Response(
      JSON.stringify({ 
        success: true,
        answer,
        sources: topChunks.map((chunk: any) => ({
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
  'about','your','into','over','under','after','before','while','there','here','such','than','then','tell','know'
])

// Detect if a chunk looks like a table of contents entry
function isTOCChunk(text: string): boolean {
  // TOC patterns: lots of dots, page numbers, section numbers without content
  const dotPattern = /\.{4,}/g
  const dotMatches = text.match(dotPattern)
  const dotCount = dotMatches ? dotMatches.length : 0
  
  // Count actual word content vs formatting
  const words = text.split(/\s+/).filter(w => w.length > 2 && !w.match(/^[\d.]+$/))
  const contentRatio = words.length / (text.length / 10) // words per 10 chars
  
  // TOC entries have lots of dots and low content ratio
  if (dotCount >= 3 && contentRatio < 2) return true
  
  // Check for page number patterns like "... 88" or "...... 92"
  const pageNumPattern = /\.{3,}\s*\d{1,3}\s/g
  const pageNumMatches = text.match(pageNumPattern)
  if (pageNumMatches && pageNumMatches.length >= 2) return true
  
  return false
}

// Re-rank chunks to prioritize substantive content
function rerankChunks(chunks: any[], question: string): any[] {
  const questionLower = question.toLowerCase()
  const keywords = questionLower.match(/[a-z]{4,}/g) || []
  
  return chunks.map(chunk => {
    const text = chunk.text.toLowerCase()
    const isTOC = isTOCChunk(chunk.text)
    
    // Base score from similarity
    let score = chunk.similarity || 0.3
    
    // Heavily penalize TOC chunks
    if (isTOC) {
      score *= 0.3
    }
    
    // Boost chunks with actual procedural content
    const proceduralIndicators = [
      'replace', 'every', 'years', 'check', 'inspect', 'clean', 'ensure',
      'warning', 'caution', 'must', 'should', 'procedure', 'step',
      'value', 'concentration', 'level', 'temperature', 'pressure'
    ]
    const proceduralMatches = proceduralIndicators.filter(ind => text.includes(ind)).length
    score += proceduralMatches * 0.05
    
    // Boost chunks that contain question keywords in actual content (not just headings)
    const keywordMatches = keywords.filter(kw => text.includes(kw)).length
    if (!isTOC && keywordMatches > 0) {
      score += keywordMatches * 0.1
    }
    
    // Boost chunks with specific values/measurements
    const hasSpecificValues = /\d+\s*(ppm|%|°C|°F|years?|months?|days?|hours?)/i.test(chunk.text)
    if (hasSpecificValues) {
      score += 0.15
    }
    
    return { ...chunk, finalScore: score, isTOC }
  }).sort((a, b) => b.finalScore - a.finalScore)
}

async function enrichWithKeywordFallback(
  supabase: any, 
  question: string, 
  initialChunks: any[],
  matchingDocIds: Set<string> | null,
  equipmentType?: string
): Promise<any[]> {
  try {
    const tokens = (question.toLowerCase().match(/[a-z0-9]+/g) || []).filter(
      (word) => word.length >= 4 && !STOP_WORDS.has(word)
    )

    if (tokens.length === 0) {
      return initialChunks
    }

    // Use multiple keywords - sanitize each for LIKE patterns
    const sortedTokens = [...tokens].sort((a, b) => b.length - a.length).slice(0, 4)
    const sanitizedTokens = sortedTokens.map(sanitizeLikePattern)
    console.log('Keyword fallback search using:', sanitizedTokens)

    // Query chunks with document join to get filename
    // Build the OR filter with sanitized tokens
    let query = supabase
      .from('chunks')
      .select('id, document_id, chunk_index, text, site, equipment, fault_code, documents!inner(filename)')
      .or(sanitizedTokens.map(kw => `text.ilike.%${kw}%`).join(','))
      .limit(50)

    const { data, error } = await query

    if (error) {
      console.error('Keyword fallback search error:', error)
      return initialChunks
    }

    const existingIds = new Set(initialChunks.map((c: any) => c.id))
    const mergedChunks = [...initialChunks]

    for (const row of data || []) {
      if (existingIds.has(row.id)) continue
      
      // APPLY DOCUMENT FILTERS to keyword results
      if (matchingDocIds && !matchingDocIds.has(row.document_id)) continue
      
      // APPLY EQUIPMENT TYPE FILTER
      if (equipmentType && row.equipment !== equipmentType) continue
      
      mergedChunks.push({
        ...row,
        similarity: 0.4, // Moderate similarity for keyword matches
        filename: row.documents?.filename ?? 'Unknown',
      })
    }

    console.log(`Keyword fallback: found ${(data || []).length}, after filter: ${mergedChunks.length - initialChunks.length} new, total: ${mergedChunks.length}`)

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
