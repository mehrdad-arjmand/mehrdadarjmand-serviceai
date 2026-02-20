import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

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
  // Allow any length — we'll truncate later
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
    const startTime = Date.now()
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
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      }
    })
    
    const { data: { user }, error: authError } = await authClient.auth.getUser(token)
    
    if (authError || !user) {
      console.error('Auth error:', authError?.message || 'No user found')
      return new Response(
        JSON.stringify({ error: 'Unauthorized: Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`RAG query from user: ${user.id}`)

    // Use service role client for database operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Check permission: assistant.write required for querying
    const { data: hasPermission, error: permError } = await supabase.rpc('has_permission', {
      p_tab: 'assistant',
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
      console.log(`User ${user.id} denied: assistant.write permission required`)
      return new Response(
        JSON.stringify({ error: 'Forbidden: You do not have permission to query the assistant' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get the user's role to filter accessible documents
    const { data: userRoleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single()

    const userRole = userRoleData?.role || 'demo'
    const isAdmin = userRole === 'admin'

    // Get IDs of documents this user can access based on allowed_roles
    let accessibleDocIds: Set<string> | null = null
    if (!isAdmin) {
      const { data: accessibleDocs, error: accessError } = await supabase
        .from('documents')
        .select('id')
        .or(`allowed_roles.cs.{${userRole}},allowed_roles.cs.{all}`)

      if (accessError) {
        console.error('Error fetching accessible documents:', accessError)
        return new Response(
          JSON.stringify({ error: 'Failed to check document access' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      accessibleDocIds = new Set((accessibleDocs || []).map(d => d.id))
      console.log(`User role: ${userRole}, accessible documents: ${accessibleDocIds.size}`)

      if (accessibleDocIds.size === 0) {
        return new Response(
          JSON.stringify({
            success: true,
            answer: 'You do not have access to any documents. Please contact an administrator to get access.',
            sources: []
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      }
    } else {
      console.log('User is admin, access to all documents')
    }

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
      throw new Error(`history must be an array of messages with valid role and content`)
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
      history: rawRequest.history ? (rawRequest.history as ConversationMessage[]).slice(-MAX_HISTORY_LENGTH) : undefined,
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

    // Generate embedding for the query using Lovable AI
    const queryEmbedding = await generateEmbedding(question)

    // Perform vector similarity search with high count to ensure we get diverse results
    const embeddingStr = `[${queryEmbedding.join(',')}]`
    
    const { data: chunks, error: searchError } = await supabase.rpc(
      'match_chunks',
      {
        query_embedding: embeddingStr,
        match_threshold: 0.15, // Very low threshold
        match_count: 50, // Get many chunks to ensure we find actual content
        p_user_id: user.id // Enforce document-level access control within the function
      }
    )

    if (searchError) {
      console.error('Search error:', searchError)
      return new Response(
        JSON.stringify({ error: 'Search failed. Please try again.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Found ${chunks?.length || 0} semantic chunks`)

    // Filter chunks by user's accessible documents (RBAC enforcement)
    let accessFilteredChunks = chunks || []
    if (accessibleDocIds) {
      accessFilteredChunks = accessFilteredChunks.filter((chunk: any) => accessibleDocIds.has(chunk.document_id))
      console.log(`After access filter: ${accessFilteredChunks.length} chunks (from ${chunks?.length || 0})`)
    }

    // Apply document filters if provided
    let filteredChunks = accessFilteredChunks
    
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
        return new Response(
          JSON.stringify({ error: 'Filter query failed. Please try again.' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
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
      equipmentType,
      accessibleDocIds
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
    const citationInstructions = `
CITATION INSTRUCTIONS (MANDATORY):
- You MUST cite every factual claim, measurement, procedure, or specific detail with its source using the format (Source N) immediately after the relevant sentence or phrase.
- Use ALL relevant sources - do not limit yourself to one source. If multiple sources support a claim, cite all of them: (Source 1, Source 3).
- Every sentence that conveys information from the documents MUST have at least one citation.
- If the answer draws from multiple sources, cite each part to its specific source.
- Do NOT list sources at the end. Citations must be inline only.
- Do NOT omit citations. A response with zero citations when sources are available is WRONG.
- Example: "The recommended clearance is 30 cm (Source 2). A DC breaker is required for each terminal (Source 5, Source 7)."
`

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
- Always mention safety warnings when relevant.
${citationInstructions}`
      : `You are a field technician assistant for industrial energy systems. 

CRITICAL INSTRUCTIONS:
- Answer based on the provided context from documents
- Search thoroughly through ALL provided sources - the actual content you need may be in later sources, not just the first few
- IGNORE table of contents entries that just list page numbers - look for actual procedural content with specific instructions
- If a source contains actual step-by-step instructions, specific values, or detailed procedures, prioritize that over TOC entries
- Quote specific details, numbers, procedures, measurements, and warnings from the context
- Look for sections that contain actual maintenance steps, not just section headings
- Always prioritize safety - mention safety warnings when relevant.
${citationInstructions}`

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

Provide a clear, concise answer based on the actual procedural content in the context above. Ignore table of contents entries. REMEMBER: You MUST include inline citations (Source N) for every factual claim. Every sentence with document-derived information needs a citation.`

    const { content: answer, usage } = await generateAnswer(systemPrompt, userPrompt)

    const executionTimeMs = Date.now() - startTime

    // Build sources/citations
    const sources = topChunks.map((chunk: any) => ({
      filename: chunk.filename || 'Unknown',
      chunkIndex: chunk.chunk_index,
      text: chunk.text,
      similarity: chunk.similarity,
      documentId: chunk.document_id || ''
    }))

    // Log to query_logs and trigger background retrieval evaluation
    const chunkIds = topChunks.map((c: any) => c.id)
    const similarities = topChunks.map((c: any) => c.similarity ?? 0)
    const chunkTexts = topChunks.map((c: any) => ({ id: c.id, text: c.text }))
    const topK = topChunks.length

    const logPayload = {
      user_id: user.id,
      query_text: question,
      retrieved_chunk_ids: chunkIds,
      retrieved_similarities: similarities,
      response_text: answer,
      citations_json: sources,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      total_tokens: usage.total_tokens,
      execution_time_ms: executionTimeMs,
      top_k: topK,
      upstream_inference_cost: usage.upstream_inference_cost ?? 0,
    }

    // Background: insert log then evaluate retrieval quality
    const bgTask = (async () => {
      try {
        const { data: inserted, error: logError } = await supabase
          .from('query_logs')
          .insert(logPayload)
          .select('id')
          .single()

        if (logError || !inserted) {
          console.error('Failed to log query:', logError)
          return
        }

        console.log(`Query logged: ${executionTimeMs}ms, ${usage.total_tokens} tokens, cost: $${usage.upstream_inference_cost ?? 0}`)

        // LLM-based retrieval evaluation
        await evaluateRetrievalBackground(supabase, inserted.id, question, chunkTexts, topK)
      } catch (e) {
        console.error('Background eval error:', e)
      }
    })()

    // Use EdgeRuntime.waitUntil if available, otherwise fire-and-forget
    if (typeof (globalThis as any).EdgeRuntime?.waitUntil === 'function') {
      (globalThis as any).EdgeRuntime.waitUntil(bgTask)
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        answer,
        sources,
        usage,
        execution_time_ms: executionTimeMs,
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )
  } catch (error) {
    console.error('Error processing RAG query:', error)
    return new Response(
      JSON.stringify({ error: 'An error occurred processing your request. Please try again.' }),
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
  equipmentType?: string,
  accessibleDocIds?: Set<string> | null
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
      
      // APPLY ACCESS CONTROL FILTER
      if (accessibleDocIds && !accessibleDocIds.has(row.document_id)) continue
      
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

// Generate embedding using Google's Gemini Embedding API
async function generateEmbedding(text: string): Promise<number[]> {
  const apiKey = Deno.env.get('GOOGLE_API_KEY')
  if (!apiKey) {
    throw new Error('GOOGLE_API_KEY is not configured')
  }

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

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to generate embedding: ${error}`)
  }

  const data = await response.json()
  return data.embedding.values
}

async function generateAnswer(systemPrompt: string, userPrompt: string): Promise<{ content: string; usage: { input_tokens: number; output_tokens: number; total_tokens: number; upstream_inference_cost: number } }> {
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
  return {
    content: data.choices[0].message.content,
    usage: {
      input_tokens: data.usage?.prompt_tokens ?? 0,
      output_tokens: data.usage?.completion_tokens ?? 0,
      total_tokens: data.usage?.total_tokens ?? 0,
      upstream_inference_cost: data.usage?.cost_details?.upstream_inference_cost ?? 0,
    }
  }
}

const EVAL_MODEL = 'google/gemini-2.5-flash-lite'

async function evaluateChunkRelevance(
  queryText: string,
  chunkText: string
): Promise<{ relevant: boolean; reasoning: string }> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY')
  if (!apiKey) return { relevant: false, reasoning: 'LOVABLE_API_KEY not configured' }

  const prompt = `You are a retrieval evaluation judge. Given a user query and a retrieved document chunk, determine if the chunk contains information that is necessary or helpful to answer the query.

Respond with ONLY a JSON object: {"relevant": true/false, "reasoning": "one sentence explanation"}

User Query: "${queryText}"

Retrieved Chunk:
"""
${chunkText.slice(0, 2000)}
"""

Is this chunk relevant to answering the query?`

  try {
    const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: EVAL_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 200,
      }),
    })

    if (!res.ok) return { relevant: false, reasoning: 'LLM evaluation failed' }

    const data = await res.json()
    const text = data.choices?.[0]?.message?.content?.trim() ?? ''

    // Strip markdown code fences if present
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()

    const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0])
        return { relevant: !!parsed.relevant, reasoning: parsed.reasoning || '' }
      } catch (parseErr) {
        console.error('JSON parse failed for eval response:', jsonMatch[0].slice(0, 200))
      }
    }

    // Fallback: check for yes/true keywords in plain text
    const lower = cleaned.toLowerCase()
    if (lower.includes('"relevant": true') || lower.includes('"relevant":true')) {
      return { relevant: true, reasoning: 'Parsed from text fallback' }
    }

    console.error('Could not parse eval LLM response:', text.slice(0, 300))
  } catch (err) {
    console.error('Eval chunk error:', err)
  }

  return { relevant: false, reasoning: 'Parse error' }
}

async function evaluateRetrievalBackground(
  supabase: any,
  queryLogId: string,
  queryText: string,
  chunkTexts: { id: string; text: string }[],
  topK: number
) {
  const labels: { chunk_id: string; relevant: boolean; reasoning: string; rank: number }[] = []
  let firstRelevantRank: number | null = null

  for (let i = 0; i < chunkTexts.length; i++) {
    const { id: chunkId, text: chunkText } = chunkTexts[i]
    const result = await evaluateChunkRelevance(queryText, chunkText)
    labels.push({ chunk_id: chunkId, relevant: result.relevant, reasoning: result.reasoning, rank: i + 1 })

    if (result.relevant && firstRelevantRank === null) {
      firstRelevantRank = i + 1
    }
  }

  const totalRelevant = labels.filter(l => l.relevant).length
  const relevantInTopK = totalRelevant
  const precisionAtK = topK > 0 ? relevantInTopK / topK : 0
  const recallAtK = totalRelevant > 0 ? relevantInTopK / totalRelevant : 0
  const hitRate = relevantInTopK > 0 ? 1 : 0

  const { error: updateError } = await supabase.from('query_logs').update({
    total_relevant_chunks: totalRelevant,
    relevant_in_top_k: relevantInTopK,
    precision_at_k: parseFloat(precisionAtK.toFixed(4)),
    recall_at_k: parseFloat(recallAtK.toFixed(4)),
    hit_rate_at_k: hitRate,
    first_relevant_rank: firstRelevantRank,
    relevance_labels: labels,
    eval_model: EVAL_MODEL,
    evaluated_at: new Date().toISOString(),
  }).eq('id', queryLogId)

  if (updateError) {
    console.error('Failed to update retrieval eval:', updateError)
  } else {
    console.log(`Retrieval eval complete for ${queryLogId}: P@K=${precisionAtK.toFixed(3)}, R@K=${recallAtK.toFixed(3)}, HR=${hitRate}, MRR_rank=${firstRelevantRank}`)
  }
}
