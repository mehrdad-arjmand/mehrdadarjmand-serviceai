import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

interface ConversationMessage {
  role: "user" | "assistant"
  content: string
}

interface RAGQueryRequest {
  question: string
  projectId?: string
  sessionId?: string
  documentType?: string
  uploadDate?: string
  filterSite?: string
  equipmentType?: string
  equipmentMake?: string
  equipmentModel?: string
  documentIds?: string[]
  dynamicMetadata?: Record<string, string>
  accessRole?: string
  history?: ConversationMessage[]
  isConversationMode?: boolean
  model?: string
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
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function isValidHistory(history: unknown): history is ConversationMessage[] {
  if (!Array.isArray(history)) return false
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

    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: authHeader, apikey: supabaseAnonKey },
    })

    if (!userRes.ok) {
      const errText = await userRes.text()
      console.error('Auth error:', errText)
      return new Response(
        JSON.stringify({ error: 'Unauthorized: Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const user = await userRes.json()
    if (!user?.id) {
      console.error('Auth error: No user ID in response')
      return new Response(
        JSON.stringify({ error: 'Unauthorized: Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`RAG query from user: ${user.id}`)

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Check permission
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

    // Get the user's role
    const { data: userRoleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single()

    const userRole = userRoleData?.role || 'demo'
    const isAdmin = userRole === 'admin'

    // Get accessible doc IDs for non-admin
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

    if (!isValidString(rawRequest.question, MAX_QUESTION_LENGTH)) {
      throw new Error(`Question must be a string with max ${MAX_QUESTION_LENGTH} characters`)
    }

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

    if (rawRequest.history !== undefined && !isValidHistory(rawRequest.history)) {
      throw new Error(`history must be an array of messages with valid role and content`)
    }

    if (rawRequest.isConversationMode !== undefined && typeof rawRequest.isConversationMode !== 'boolean') {
      throw new Error('isConversationMode must be a boolean')
    }

    if (rawRequest.projectId !== undefined && !isValidOptionalString(rawRequest.projectId, 100)) {
      throw new Error('projectId must be a valid string')
    }

    if (rawRequest.documentIds !== undefined) {
      if (!Array.isArray(rawRequest.documentIds) || rawRequest.documentIds.length > 100) {
        throw new Error('documentIds must be an array of at most 100 strings')
      }
      if (!rawRequest.documentIds.every((id: unknown) => typeof id === 'string' && id.length <= 100)) {
        throw new Error('Each documentId must be a valid string')
      }
    }

    if (rawRequest.dynamicMetadata !== undefined) {
      if (typeof rawRequest.dynamicMetadata !== 'object' || rawRequest.dynamicMetadata === null || Array.isArray(rawRequest.dynamicMetadata)) {
        throw new Error('dynamicMetadata must be an object')
      }
    }

    if (rawRequest.accessRole !== undefined && !isValidOptionalString(rawRequest.accessRole, MAX_FILTER_LENGTH)) {
      throw new Error('accessRole must be a valid string')
    }

    const validModels = ['google/gemini-2.5-flash-lite', 'google/gemini-3-flash-preview']
    const requestedModel = typeof rawRequest.model === 'string' && validModels.includes(rawRequest.model) 
      ? rawRequest.model 
      : 'google/gemini-2.5-flash-lite'

    const request: RAGQueryRequest = {
      question: (rawRequest.question as string).trim().slice(0, MAX_QUESTION_LENGTH),
      projectId: rawRequest.projectId as string | undefined,
      sessionId: rawRequest.sessionId as string | undefined,
      documentType: sanitizeString(rawRequest.documentType as string | undefined),
      uploadDate: rawRequest.uploadDate as string | undefined,
      filterSite: sanitizeString(rawRequest.filterSite as string | undefined),
      equipmentType: sanitizeString(rawRequest.equipmentType as string | undefined),
      equipmentMake: sanitizeString(rawRequest.equipmentMake as string | undefined),
      equipmentModel: sanitizeString(rawRequest.equipmentModel as string | undefined),
      documentIds: rawRequest.documentIds as string[] | undefined,
      dynamicMetadata: rawRequest.dynamicMetadata as Record<string, string> | undefined,
      accessRole: sanitizeString(rawRequest.accessRole as string | undefined),
      history: rawRequest.history ? (rawRequest.history as ConversationMessage[]).slice(-MAX_HISTORY_LENGTH) : undefined,
      isConversationMode: rawRequest.isConversationMode as boolean | undefined,
      model: requestedModel,
    }

    const { 
      question, 
      projectId: requestProjectId,
      sessionId,
      documentType,
      uploadDate,
      filterSite,
      equipmentType,
      equipmentMake,
      equipmentModel,
      documentIds: filterDocumentIds,
      dynamicMetadata,
      accessRole,
      history,
      isConversationMode,
      model: selectedModel
    } = request

    // Load conversation history
    let conversationHistory: ConversationMessage[] = []
    let sessionSummary: string | null = null
    
    if (isConversationMode && sessionId) {
      try {
        const { data: sessionData } = await supabase
          .from('chat_sessions')
          .select('summary')
          .eq('id', sessionId)
          .single()
        
        sessionSummary = sessionData?.summary || null

        const { data: dbMessages, error: msgError } = await supabase
          .from('chat_messages')
          .select('role, content')
          .eq('session_id', sessionId)
          .order('created_at', { ascending: false })
          .limit(12)

        if (!msgError && dbMessages && dbMessages.length > 0) {
          conversationHistory = dbMessages.reverse().map((m: any) => ({
            role: m.role,
            content: m.content
          }))
        }
        
        console.log(`Loaded ${conversationHistory.length} messages from session ${sessionId}, summary: ${sessionSummary ? 'yes' : 'no'}`)
        
        // Generate summary if history is getting long
        if (!sessionSummary) {
          const { count } = await supabase
            .from('chat_messages')
            .select('*', { count: 'exact', head: true })
            .eq('session_id', sessionId)
          
          if (count && count > 20) {
            const { data: olderMessages } = await supabase
              .from('chat_messages')
              .select('role, content')
              .eq('session_id', sessionId)
              .order('created_at', { ascending: true })
              .limit(20)
            
            if (olderMessages && olderMessages.length > 0) {
              const summaryText = olderMessages.map((m: any) => `${m.role}: ${m.content.slice(0, 200)}`).join('\n')
              try {
                const summaryResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${Deno.env.get('LOVABLE_API_KEY')}`
                  },
                  body: JSON.stringify({
                    model: 'google/gemini-2.5-flash-lite',
                    messages: [
                      { role: 'system', content: 'Summarize this conversation in 2-3 sentences, capturing key topics discussed and any important context. Be concise.' },
                      { role: 'user', content: summaryText }
                    ],
                    temperature: 0.2,
                    max_tokens: 200,
                  })
                })
                
                if (summaryResponse.ok) {
                  const summaryData = await summaryResponse.json()
                  sessionSummary = summaryData.choices?.[0]?.message?.content || null
                  
                  if (sessionSummary) {
                    await supabase
                      .from('chat_sessions')
                      .update({ summary: sessionSummary })
                      .eq('id', sessionId)
                    console.log('Generated and stored conversation summary')
                  }
                }
              } catch (e) {
                console.error('Failed to generate summary:', e)
              }
            }
          }
        }
      } catch (e) {
        console.error('Error loading session history:', e)
      }
    } else if (isConversationMode && history && history.length > 0) {
      conversationHistory = history.slice(-12)
    }

    // ── STANDALONE QUERY REWRITE for follow-up questions ──
    // If conversation history exists, rewrite the question into a standalone search query
    let retrievalQuery = question
    let wasRewritten = false
    if (conversationHistory.length > 0 && isConversationMode) {
      const rewritten = await rewriteFollowUpQuery(question, conversationHistory, sessionSummary)
      if (rewritten && rewritten !== question) {
        retrievalQuery = rewritten
        wasRewritten = true
        console.log(`Query rewritten for retrieval: "${question.slice(0, 60)}" → "${retrievalQuery.slice(0, 100)}"`)
      }
    }
    
    console.log('RAG Query:', { 
      question: question.slice(0, 100), 
      retrievalQuery: wasRewritten ? retrievalQuery.slice(0, 100) : '(same)',
      projectId: requestProjectId,
      sessionId,
      filters: { documentType, uploadDate, filterSite, equipmentType, equipmentMake, equipmentModel, documentIds: filterDocumentIds?.length, dynamicMetadata, accessRole },
      isConversationMode,
      historyLength: conversationHistory.length
    })

    // Get user's API tier
    const { data: userApiTier } = await supabase.rpc('get_user_api_tier', { p_user_id: user.id })
    const apiTier = userApiTier || 'free'
    console.log(`User API tier: ${apiTier}`)

    // Generate embedding using the RETRIEVAL query (rewritten if follow-up)
    const queryEmbedding = await generateEmbedding(retrievalQuery, apiTier)

    // Build project-scoped document ID set
    let projectDocIds: Set<string> | null = null
    let projectDocIdArray: string[] = []
    let projectDocsWithNames: { id: string; filename: string }[] = []
    if (requestProjectId) {
      const { data: projectDocs, error: projError } = await supabase
        .from('documents')
        .select('id, filename')
        .eq('project_id', requestProjectId)

      if (projError) {
        console.error('Error fetching project documents:', projError)
      } else {
        projectDocsWithNames = (projectDocs || []).map((d: any) => ({ id: d.id, filename: d.filename }))
        projectDocIdArray = projectDocsWithNames.map(d => d.id)
        projectDocIds = new Set(projectDocIdArray)
        console.log(`Project ${requestProjectId} has ${projectDocIds.size} documents`)
      }
    }

    // ── Natural-language document inference — run against RETRIEVAL query ──
    let inferredDocIds: string[] | null = null
    if (!filterDocumentIds?.length && projectDocsWithNames.length > 0) {
      inferredDocIds = inferDocumentFromQuery(retrievalQuery, projectDocsWithNames)
      if (inferredDocIds && inferredDocIds.length > 0) {
        console.log(`Inferred ${inferredDocIds.length} document(s) from query: ${inferredDocIds.join(', ')}`)
      }
    }

    // Effective document scope
    const effectiveDocIds = (filterDocumentIds && filterDocumentIds.length > 0) 
      ? filterDocumentIds 
      : (inferredDocIds && inferredDocIds.length > 0) 
        ? inferredDocIds 
        : projectDocIdArray

    // Perform vector similarity search
    const embeddingStr = `[${queryEmbedding.join(',')}]`
    let chunks: any[] = []
    let searchError: any = null

    if (requestProjectId && projectDocIdArray.length > 0) {
      const retrievalCount = 200
      const { data, error } = await supabase.rpc(
        'match_chunks_by_docs',
        {
          query_embedding: embeddingStr,
          doc_ids: effectiveDocIds,
          match_threshold: 0.10,
          match_count: retrievalCount,
        }
      )
      chunks = data || []
      searchError = error
      console.log(`Project-scoped search found ${chunks.length} chunks`)
    } else {
      const { data, error } = await supabase.rpc(
        'match_chunks',
        {
          query_embedding: embeddingStr,
          match_threshold: 0.15,
          match_count: 200,
          p_user_id: user.id
        }
      )
      chunks = data || []
      searchError = error
    }

    if (searchError) {
      console.error('Search error:', searchError)
      return new Response(
        JSON.stringify({ error: 'Search failed. Please try again.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Found ${chunks.length} semantic chunks`)

    // Filter by access
    let accessFilteredChunks = chunks
    if (accessibleDocIds) {
      accessFilteredChunks = accessFilteredChunks.filter((chunk: any) => accessibleDocIds.has(chunk.document_id))
      console.log(`After access filter: ${accessFilteredChunks.length} chunks (from ${chunks.length})`)
    }

    let filteredChunks = accessFilteredChunks

    // Apply explicit document ID filter
    if (filterDocumentIds && filterDocumentIds.length > 0) {
      const docIdSet = new Set(filterDocumentIds)
      filteredChunks = filteredChunks.filter((chunk: any) => docIdSet.has(chunk.document_id))
      console.log(`After documentIds filter: ${filteredChunks.length} chunks (selected ${filterDocumentIds.length} documents)`)
    }
    
    if (documentType || uploadDate || filterSite || equipmentMake || equipmentModel || accessRole || (dynamicMetadata && Object.values(dynamicMetadata).some(v => v))) {
      let docQuery = supabase.from('documents').select('id, metadata, allowed_roles')
      
      if (requestProjectId) docQuery = docQuery.eq('project_id', requestProjectId)
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

      let filteredDocs = matchingDocs || []
      
      if (dynamicMetadata) {
        for (const [field, value] of Object.entries(dynamicMetadata)) {
          if (value) {
            filteredDocs = filteredDocs.filter((d: any) => d.metadata && d.metadata[field] === value)
          }
        }
      }

      if (accessRole) {
        filteredDocs = filteredDocs.filter((d: any) => {
          const roles: string[] = d.allowed_roles || []
          return roles.includes(accessRole) || roles.includes('all')
        })
      }
      
      if (filteredDocs.length === 0) {
        return new Response(
          JSON.stringify({ 
            success: true,
            answer: 'No documents match the selected filters. Try broadening your filters or searching all documents.',
            sources: []
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      }
      
      const matchingDocIds = new Set(filteredDocs.map((d: any) => d.id))
      filteredChunks = filteredChunks.filter((chunk: any) => matchingDocIds.has(chunk.document_id))
      
      console.log(`Filtered to ${filteredChunks.length} chunks from ${filteredDocs.length} matching documents`)
    }

    // Apply equipment type filter
    if (equipmentType) {
      filteredChunks = filteredChunks.filter((chunk: any) => chunk.equipment === equipmentType)
      console.log(`After equipment type filter: ${filteredChunks.length} chunks`)
    }

    // Get matching document IDs for keyword fallback
    let matchingDocIds: Set<string> | null = null
    if (documentType || uploadDate || filterSite || equipmentMake || equipmentModel || filterDocumentIds?.length || accessRole || (dynamicMetadata && Object.values(dynamicMetadata).some(v => v))) {
      if (filterDocumentIds && filterDocumentIds.length > 0) {
        matchingDocIds = new Set(filterDocumentIds)
      } else {
        let docQuery = supabase.from('documents').select('id, metadata, allowed_roles')
        if (requestProjectId) docQuery = docQuery.eq('project_id', requestProjectId)
        if (documentType) docQuery = docQuery.eq('doc_type', documentType)
        if (uploadDate) docQuery = docQuery.eq('upload_date', uploadDate)
        if (filterSite) docQuery = docQuery.eq('site', filterSite)
        if (equipmentMake) docQuery = docQuery.eq('equipment_make', equipmentMake)
        if (equipmentModel) docQuery = docQuery.eq('equipment_model', equipmentModel)
        
        const { data: matchingDocs } = await docQuery
        if (matchingDocs && matchingDocs.length > 0) {
          let filteredDocs = matchingDocs
          if (dynamicMetadata) {
            for (const [field, value] of Object.entries(dynamicMetadata)) {
              if (value) filteredDocs = filteredDocs.filter((d: any) => d.metadata && d.metadata[field] === value)
            }
          }
          if (accessRole) {
            filteredDocs = filteredDocs.filter((d: any) => {
              const roles: string[] = d.allowed_roles || []
              return roles.includes(accessRole) || roles.includes('all')
            })
          }
          if (filteredDocs.length > 0) matchingDocIds = new Set(filteredDocs.map((d: any) => d.id))
        }
      }
    }

    // Merge with keyword search — use RETRIEVAL query for better tokens
    const combinedChunks = await enrichWithKeywordFallback(
      supabase, 
      retrievalQuery, 
      filteredChunks, 
      matchingDocIds,
      equipmentType,
      accessibleDocIds,
      projectDocIds,
      inferredDocIds
    )

    // Fallback for empty results
    let retrievalChunks = combinedChunks
    if (retrievalChunks.length === 0 && (filterDocumentIds?.length || inferredDocIds?.length)) {
      const fallbackDocIds = filterDocumentIds?.length ? filterDocumentIds : inferredDocIds!
      retrievalChunks = await fetchDocScopedFallbackChunks(
        supabase,
        retrievalQuery,
        fallbackDocIds,
        accessibleDocIds,
        projectDocIds,
        equipmentType
      )
      console.log(`Document-scoped fallback returned ${retrievalChunks.length} chunks`)
    }

    // ── Table-aware retrieval: detect list/count intent and fetch adjacent chunks ──
    const tableIntent = detectTableIntent(retrievalQuery)
    if (tableIntent && (inferredDocIds?.length || filterDocumentIds?.length)) {
      const targetDocIds = filterDocumentIds?.length ? filterDocumentIds : inferredDocIds!
      const adjacentChunks = await fetchAdjacentTableChunks(
        supabase, retrievalChunks, targetDocIds, retrievalQuery
      )
      if (adjacentChunks.length > 0) {
        const existingIds = new Set(retrievalChunks.map((c: any) => c.id))
        for (const ac of adjacentChunks) {
          if (!existingIds.has(ac.id)) {
            retrievalChunks.push(ac)
            existingIds.add(ac.id)
          }
        }
        console.log(`Table-aware retrieval added ${adjacentChunks.length} adjacent chunks, total: ${retrievalChunks.length}`)
      }
    }

    // Re-rank chunks
    const rankedChunks = rerankChunks(retrievalChunks, retrievalQuery, inferredDocIds || filterDocumentIds || null)

    // ── Context window: use section-window for table queries, standard top-K otherwise ──
    let topChunks: any[]
    const useSectionWindow = tableIntent && (inferredDocIds?.length || filterDocumentIds?.length)
    if (useSectionWindow) {
      topChunks = selectSectionWindow(rankedChunks, inferredDocIds || filterDocumentIds || null, 50)
      console.log(`Section-window mode: selected ${topChunks.length} contiguous chunks`)
    } else {
      const contextLimit = 20
      topChunks = rankedChunks.slice(0, Math.min(rankedChunks.length, contextLimit))
      console.log(`Standard mode: ${topChunks.length} top-ranked chunks`)
    }

    console.log('Top ranked chunks:', topChunks.slice(0, 5).map((c: any) => ({
      chunk: c.chunk_index,
      score: c.finalScore?.toFixed(3),
      doc: c.document_id?.slice(0, 8),
      preview: c.text.slice(0, 80)
    })))

    // Build context
    const context = topChunks
      .map((chunk: any, idx: number) => 
        `[Source ${idx + 1}: ${chunk.filename || 'Unknown'} | Chunk ${chunk.chunk_index}]\n${chunk.text}`
      )
      .join('\n\n---\n\n') || 'No relevant context found.'

    // Generate answer
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

CRITICAL RETRIEVAL AND ANALYTICAL INSTRUCTIONS:
- Answer the SPECIFIC question asked. Do not give a general overview unless asked for one.
- If the question asks about a specific measurement, value, distance, spacing, or parameter, find and report that exact value from the sources.
- "Spacing" and "clearance" are synonyms - a question about "spacing" should be answered with clearance/distance information if available.
- Search through ALL provided sources - actual content may be in later sources
- IGNORE table of contents entries - look for actual procedural content
- Quote specific details, numbers, procedures when relevant
- Always mention safety warnings when relevant.
- ANALYTICAL TASKS: When the user asks you to calculate, compare, sort, rank, divide, multiply, average, or perform any mathematical operation on data from the documents, you MUST perform those calculations accurately. Extract the relevant numbers from the sources, show your work, and present the results clearly. Do NOT refuse to perform calculations — you have all the data in the provided context.
- DATA AGGREGATION: When asked to list all items, count entries, summarize across categories, or compile data from multiple sources, be thorough and include ALL matching entries from the provided context, not just a subset.
- MATHEMATICAL ACCURACY: When performing summation, counting, or arithmetic, you MUST enumerate each item explicitly, then add them up step by step. Do NOT estimate or approximate. If you are summing a list of numbers, write out each number and compute the total carefully. Double-check your arithmetic before presenting the final answer.
${citationInstructions}`
      : `You are a field technician assistant for industrial energy systems. 

CRITICAL INSTRUCTIONS:
- Answer the SPECIFIC question asked. Do not give a general overview or tangential information unless directly relevant.
- If the question asks about a specific measurement, value, distance, spacing, clearance, or parameter, find and report that exact value from the sources. Do NOT answer with "maintenance-free" when the user asks about physical spacing or clearance distances.
- Treat synonyms as equivalent: "spacing" = "clearance" = "distance", "maintenance spacing" = "clearance required for maintenance access".
- Answer based on the provided context from documents
- Search thoroughly through ALL provided sources - the actual content you need may be in later sources, not just the first few
- IGNORE table of contents entries that just list page numbers - look for actual procedural content with specific instructions
- If a source contains actual step-by-step instructions, specific values, or detailed procedures, prioritize that over TOC entries
- Quote specific details, numbers, procedures, measurements, and warnings from the context
- Look for sections that contain actual maintenance steps, not just section headings
- Always prioritize safety - mention safety warnings when relevant.
- ANALYTICAL TASKS: When the user asks you to calculate, compare, sort, rank, divide, multiply, average, or perform any mathematical operation on data from the documents, you MUST perform those calculations accurately. Extract the relevant numbers from the sources, show your work step by step, and present the results in a clear table or list format. Do NOT refuse or say you cannot calculate — you have all the data in the provided context.
- DATA AGGREGATION: When asked to list ALL items of a type (e.g., all SUV models, all prices), be thorough and include EVERY matching entry from ALL provided sources. Count them and confirm the total. If you find fewer than expected, explicitly state how many you found and from which sources.
- MATHEMATICAL ACCURACY: When performing summation, counting, or arithmetic, you MUST enumerate each item explicitly, then add them up step by step. Do NOT estimate or approximate. If you are summing a list of numbers, write out each number and compute the total carefully. Double-check your arithmetic before presenting the final answer.
${citationInstructions}`

    // Build conversation context
    let conversationContext = ''
    if (sessionSummary) {
      conversationContext += `\n\nConversation summary so far:\n${sessionSummary}`
    }
    if (conversationHistory.length > 0) {
      const recentMsgs = conversationHistory.slice(-12)
      conversationContext += '\n\nRecent conversation:\n' + recentMsgs
        .map(m => `${m.role === 'user' ? 'Technician' : 'Assistant'}: ${m.content.slice(0, 500)}`)
        .join('\n')
    }

    const userPrompt = `Technician Question: ${question}
${conversationContext}
Context from documents (search ALL sources carefully - actual content may be in later chunks):
${context}

Provide a clear, concise answer based on the actual procedural content in the context above. Ignore table of contents entries. REMEMBER: You MUST include inline citations (Source N) for every factual claim. Every sentence with document-derived information needs a citation.`

    const { content: answer, usage } = await generateAnswer(systemPrompt, userPrompt, selectedModel)

    const executionTimeMs = Date.now() - startTime

    // Build sources/citations
    const sources = topChunks.map((chunk: any) => ({
      filename: chunk.filename || 'Unknown',
      chunkIndex: chunk.chunk_index,
      text: chunk.text,
      similarity: chunk.similarity,
      documentId: chunk.document_id || ''
    }))

    // Eval uses rankedChunks up to 200
    const evalSlice = rankedChunks.slice(0, Math.min(200, rankedChunks.length))
    const evalChunkTexts = evalSlice.map((c: any) => ({ id: c.id, text: c.text }))
    const topKEval = evalSlice.length
    console.log(`Eval scope: ${topKEval} vector-retrieved chunks`)

    const topK = topChunks.length

    const logPayload = {
      user_id: user.id,
      query_text: question,
      retrieved_chunk_ids: topChunks.map((c: any) => c.id),
      retrieved_similarities: topChunks.map((c: any) => c.similarity ?? 0),
      response_text: answer,
      citations_json: sources,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      total_tokens: usage.total_tokens,
      execution_time_ms: executionTimeMs,
      top_k: topK,
      top_k_eval: topKEval,
      upstream_inference_cost: usage.upstream_inference_cost ?? 0,
    }

    // Background: insert log then evaluate
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

        await evaluateRetrievalBackground(supabase, inserted.id, question, evalChunkTexts, topK, topKEval)
      } catch (e) {
        console.error('Background eval error:', e)
      }
    })()

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
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error) {
    console.error('Error processing RAG query:', error)
    return new Response(
      JSON.stringify({ error: 'An error occurred processing your request. Please try again.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

const STOP_WORDS = new Set<string>([
  'the','and','for','with','that','this','from','have','what','when','where','which','will','would','could','should',
  'about','your','into','over','under','after','before','while','there','here','such','than','then','tell','know',
  'look','does','like','also','just','very','some','many','much','more','most','been','were','they','them','their',
  'these','those','only','other','same','each','every','both','either','neither','between','through','during',
  'can','you','see','list','give','number','find','show','want','need','please','could','would','should',
])

// Known high-value short tokens (automotive makes, abbreviations, etc.)
const SHORT_ENTITY_TOKENS = new Set<string>([
  'bmw', 'kia', 'gmc', 'byd', 'mg', 'ev', 'suv', 'phev', 'hev', 'bev', 'ice',
  'gv60', 'eq', 'id4', 'id.4', 'ex30', 'ex40', 'ex90', 'xc40', 'xc60', 'xc90',
  'i4', 'i5', 'i7', 'ix', 'eq6', 'eq8', 'e6', 'c40', 'v60', 'v90', 's60', 's90',
  'ram', 'vw', 'awd', 'fwd', 'rwd', '4wd', 'mpg', 'kwh', 'mph', 'hp', 'rpm',
])

// Detect if a chunk looks like a table of contents entry
function isTOCChunk(text: string): boolean {
  const dotPattern = /\.{4,}/g
  const dotMatches = text.match(dotPattern)
  const dotCount = dotMatches ? dotMatches.length : 0
  
  const words = text.split(/\s+/).filter(w => w.length > 2 && !w.match(/^[\d.]+$/))
  const contentRatio = words.length / (text.length / 10)
  
  if (dotCount >= 3 && contentRatio < 2) return true
  
  const pageNumPattern = /\.{3,}\s*\d{1,3}\s/g
  const pageNumMatches = text.match(pageNumPattern)
  if (pageNumMatches && pageNumMatches.length >= 2) return true
  
  return false
}

// ── Standalone query rewrite for follow-up questions ──
async function rewriteFollowUpQuery(
  question: string,
  conversationHistory: ConversationMessage[],
  sessionSummary: string | null
): Promise<string | null> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY')
  if (!apiKey) return null

  // Quick heuristic: if the question already has enough context, skip rewrite
  const qLower = question.toLowerCase()
  const hasYear = /\b(20[0-2]\d|19\d{2})\b/.test(qLower)
  const hasDocument = /document|file|pdf|report/i.test(qLower)
  const isLong = question.split(/\s+/).length > 15
  if (hasYear && (hasDocument || isLong)) return null // Already self-contained

  // Build compact history for the rewrite prompt
  const recentHistory = conversationHistory.slice(-6)
  const historyText = recentHistory
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 300)}`)
    .join('\n')

  const summaryPart = sessionSummary ? `\nConversation context: ${sessionSummary.slice(0, 200)}` : ''

  const prompt = `Given this conversation history and the latest user question, rewrite ONLY the user's latest question into a standalone search query that preserves all relevant context (document names, years, topics, entities).

Rules:
- Keep it concise (under 50 words)
- Preserve specific entity names, years, document references from prior messages
- If the user asks a follow-up about something discussed earlier, include that context
- If the question is already self-contained, return it unchanged
- Return ONLY the rewritten query, nothing else

${summaryPart}
Recent conversation:
${historyText}

Latest question: "${question}"

Rewritten standalone query:`

  try {
    const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-lite',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 100,
      }),
    })

    if (!res.ok) return null
    const data = await res.json()
    const rewritten = data.choices?.[0]?.message?.content?.trim()
    if (rewritten && rewritten.length > 5 && rewritten.length < 500) {
      return rewritten
    }
  } catch (e) {
    console.error('Query rewrite failed:', e)
  }
  return null
}

// Infer target documents from natural-language query
function inferDocumentFromQuery(
  question: string,
  projectDocs: { id: string; filename: string }[]
): string[] | null {
  const qLower = question.toLowerCase()
  
  const yearMatches = qLower.match(/\b(20[0-2]\d|19\d{2})\b/g)
  
  // Check for explicit filename mentions
  const matchedByName: string[] = []
  for (const doc of projectDocs) {
    const fnLower = doc.filename.toLowerCase()
    const baseName = fnLower.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')
    if (qLower.includes(baseName) || qLower.includes(fnLower)) {
      matchedByName.push(doc.id)
    }
  }
  if (matchedByName.length > 0) return matchedByName
  
  // Match by year in filename
  if (yearMatches && yearMatches.length > 0) {
    const matchedByYear: string[] = []
    for (const year of yearMatches) {
      for (const doc of projectDocs) {
        if (doc.filename.includes(year) && !matchedByYear.includes(doc.id)) {
          matchedByYear.push(doc.id)
        }
      }
    }
    if (matchedByYear.length > 0) return matchedByYear
  }
  
  return null
}

// Detect if the query has a table/list/count intent
function detectTableIntent(question: string): boolean {
  const qLower = question.toLowerCase()
  const tablePatterns = [
    /\bcount\b/, /\bhow many\b/, /\bnumber of\b/, /\blist\s+all\b/, /\btable\b/,
    /\ball\s+.*\bmodels?\b/, /\ball\s+.*\bvehicles?\b/, /\ball\s+.*\bentries?\b/,
    /\brows?\s+of\s+data\b/, /\btotal\s+rows?\b/, /\bhow\s+many\s+rows?\b/,
    /\bevery\s+/, /\beach\s+/, /\bentire\s+/,
    /\blist\b.*\b(electric|ev|phev|hev)\b/, /\b(electric|ev|phev|hev)\b.*\blist\b/,
    /\bcan you (list|show|give)\b/,
  ]
  return tablePatterns.some(p => p.test(qLower))
}

// Fetch adjacent chunks by chunk_index to assemble full tables
async function fetchAdjacentTableChunks(
  supabase: any,
  existingChunks: any[],
  targetDocIds: string[],
  question: string
): Promise<any[]> {
  try {
    const targetChunks = existingChunks.filter((c: any) => targetDocIds.includes(c.document_id))
    if (targetChunks.length === 0) return []
    
    const indices = targetChunks.map((c: any) => c.chunk_index)
    // Expand the window significantly for table queries
    const minIdx = Math.max(0, Math.min(...indices) - 10)
    const maxIdx = Math.max(...indices) + 20
    
    const { data, error } = await supabase
      .from('chunks')
      .select('id, document_id, chunk_index, text, site, equipment, fault_code, documents!inner(filename)')
      .in('document_id', targetDocIds)
      .gte('chunk_index', minIdx)
      .lte('chunk_index', maxIdx)
      .order('chunk_index', { ascending: true })
      .limit(100)
    
    if (error || !data) return []
    
    return data.map((row: any) => ({
      ...row,
      similarity: 0.45,
      filename: row.documents?.filename ?? 'Unknown',
    }))
  } catch (e) {
    console.error('Adjacent chunk fetch failed:', e)
    return []
  }
}

// ── Section-window selection for table/list queries ──
// Instead of taking top-K scattered chunks, find the best contiguous section in the target document
function selectSectionWindow(rankedChunks: any[], targetDocIds: string[] | null, maxChunks: number): any[] {
  if (!targetDocIds || targetDocIds.length === 0) {
    return rankedChunks.slice(0, maxChunks)
  }

  const targetDocIdSet = new Set(targetDocIds)
  
  // Separate target-doc chunks from other chunks
  const targetChunks = rankedChunks.filter((c: any) => targetDocIdSet.has(c.document_id))
  const otherChunks = rankedChunks.filter((c: any) => !targetDocIdSet.has(c.document_id))

  if (targetChunks.length === 0) {
    return rankedChunks.slice(0, maxChunks)
  }

  // Sort target chunks by chunk_index for contiguity
  const sorted = [...targetChunks].sort((a, b) => {
    if (a.document_id !== b.document_id) return a.document_id.localeCompare(b.document_id)
    return a.chunk_index - b.chunk_index
  })

  // Take all target-doc chunks (sorted by index for coherent reading), up to maxChunks
  const selectedTarget = sorted.slice(0, maxChunks)
  
  // Fill remaining slots with highest-ranked other chunks
  const remaining = maxChunks - selectedTarget.length
  const selectedOther = remaining > 0 ? otherChunks.slice(0, remaining) : []

  return [...selectedTarget, ...selectedOther]
}

// Re-rank chunks with intent-aware scoring
function rerankChunks(chunks: any[], question: string, targetDocIds: string[] | null): any[] {
  const questionLower = question.toLowerCase()
  // Include short tokens if they're known entities
  const allTokens = questionLower.match(/[a-z0-9.]+/g) || []
  const keywords = allTokens.filter(w => 
    (w.length >= 4 && !STOP_WORDS.has(w)) || SHORT_ENTITY_TOKENS.has(w)
  )
  
  const queryYears = questionLower.match(/\b(20[0-2]\d|19\d{2})\b/g) || []
  
  // Extract potential make/model keywords (capitalized words from original question)
  const makeModelTokens = question.match(/\b[A-Z][a-z]+\b/g)?.map(w => w.toLowerCase()) || []
  // Also extract all-caps tokens like BMW, KIA, GMC
  const allCapsTokens = question.match(/\b[A-Z]{2,6}\b/g)?.map(w => w.toLowerCase()) || []
  const combinedMakeModel = [...new Set([...makeModelTokens, ...allCapsTokens])]
  
  return chunks.map(chunk => {
    const text = chunk.text.toLowerCase()
    const filename = (chunk.filename || '').toLowerCase()
    const isTOC = isTOCChunk(chunk.text)
    
    let score = chunk.similarity || 0.3
    
    if (isTOC) {
      score *= 0.3
    }
    
    // ── Document match boost/penalty ──
    if (targetDocIds && targetDocIds.length > 0) {
      if (targetDocIds.includes(chunk.document_id)) {
        score += 0.2
      } else {
        score *= 0.4
      }
    }
    
    // ── Year match boost/penalty ──
    if (queryYears.length > 0) {
      const hasMatchingYear = queryYears.some(y => text.includes(y) || filename.includes(y))
      const hasWrongYear = !hasMatchingYear && /\b(20[0-2]\d|19\d{2})\b/.test(text)
      if (hasMatchingYear) score += 0.15
      if (hasWrongYear) score *= 0.5
    }
    
    // ── Make/model keyword boost (including short tokens like BMW) ──
    const makeModelHits = combinedMakeModel.filter(t => text.includes(t)).length
    if (makeModelHits > 0) score += makeModelHits * 0.15
    
    // ── General keyword boost ──
    const keywordMatches = keywords.filter(kw => text.includes(kw)).length
    if (!isTOC && keywordMatches > 0) {
      score += keywordMatches * 0.08
    }
    
    // ── Procedural content boost (lower weight) ──
    const proceduralIndicators = [
      'replace', 'check', 'inspect', 'warning', 'caution', 'procedure', 'step',
      'value', 'temperature', 'pressure'
    ]
    const proceduralMatches = proceduralIndicators.filter(ind => text.includes(ind)).length
    score += proceduralMatches * 0.03
    
    // ── Table/data content boost ──
    const hasTableContent = /\|.*\|/.test(chunk.text) || /\t/.test(chunk.text) || /\d+\s+(mi|km|mpg|kwh|hp)\b/i.test(chunk.text)
    if (hasTableContent && detectTableIntent(question)) {
      score += 0.1
    }
    
    // ── Specific values/measurements boost ──
    const hasSpecificValues = /\d+\s*(ppm|%|°C|°F|years?|months?|days?|hours?|mi|km|mpg|kwh)/i.test(chunk.text)
    if (hasSpecificValues) {
      score += 0.1
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
  accessibleDocIds?: Set<string> | null,
  projectDocIds?: Set<string> | null,
  inferredDocIds?: string[] | null
): Promise<any[]> {
  try {
    // Extract ALL meaningful tokens, including short entity tokens
    const allTokens = (question.toLowerCase().match(/[a-z0-9.]+/g) || [])
    
    // Keep tokens that are: long enough + not stop words, OR known short entities
    const meaningfulTokens = allTokens.filter(word => 
      (word.length >= 4 && !STOP_WORDS.has(word)) || 
      (word.length >= 2 && SHORT_ENTITY_TOKENS.has(word))
    )
    
    // Also extract all-caps from original question (BMW, KIA, etc.)
    const capsTokens = (question.match(/\b[A-Z]{2,6}\b/g) || []).map(w => w.toLowerCase())
    
    // Merge and deduplicate
    const allMeaningful = [...new Set([...meaningfulTokens, ...capsTokens])]

    if (allMeaningful.length === 0) {
      return initialChunks
    }

    // Prioritize: short entity tokens first, then by length
    const sortedTokens = [...allMeaningful].sort((a, b) => {
      const aIsEntity = SHORT_ENTITY_TOKENS.has(a) ? 1 : 0
      const bIsEntity = SHORT_ENTITY_TOKENS.has(b) ? 1 : 0
      if (aIsEntity !== bIsEntity) return bIsEntity - aIsEntity
      return b.length - a.length
    }).slice(0, 6) // Allow up to 6 tokens now
    
    const sanitizedTokens = sortedTokens.map(sanitizeLikePattern)
    console.log('Keyword fallback search using:', sanitizedTokens)

    // If we have inferred docs, scope keyword search to those docs too
    let query = supabase
      .from('chunks')
      .select('id, document_id, chunk_index, text, site, equipment, fault_code, documents!inner(filename)')
      .or(sanitizedTokens.map(kw => `text.ilike.%${kw}%`).join(','))
    
    if (inferredDocIds && inferredDocIds.length > 0) {
      query = query.in('document_id', inferredDocIds)
    }
    
    query = query.limit(80) // Increased limit for broader coverage

    const { data, error } = await query

    if (error) {
      console.error('Keyword fallback search error:', error)
      return initialChunks
    }

    const existingIds = new Set(initialChunks.map((c: any) => c.id))
    const mergedChunks = [...initialChunks]

    // Score keyword matches by how many query tokens they contain
    const scoredResults = (data || []).map((row: any) => {
      const textLower = row.text.toLowerCase()
      const hits = sanitizedTokens.filter(t => textLower.includes(t)).length
      return { row, hits }
    }).sort((a, b) => b.hits - a.hits)

    for (const { row, hits } of scoredResults) {
      if (existingIds.has(row.id)) continue
      if (accessibleDocIds && !accessibleDocIds.has(row.document_id)) continue
      if (projectDocIds && !projectDocIds.has(row.document_id)) continue
      if (matchingDocIds && !matchingDocIds.has(row.document_id)) continue
      if (equipmentType && row.equipment !== equipmentType) continue
      
      // Score based on number of keyword hits
      const similarity = Math.min(0.55, 0.3 + hits * 0.08)
      
      mergedChunks.push({
        ...row,
        similarity,
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

async function fetchDocScopedFallbackChunks(
  supabase: any,
  question: string,
  documentIds: string[],
  accessibleDocIds?: Set<string> | null,
  projectDocIds?: Set<string> | null,
  equipmentType?: string
): Promise<any[]> {
  try {
    const broadIntent = /(summar|overview|task|action|todo|list)/i.test(question)
    // Use improved tokenization with short entity support
    const allTokens = (question.toLowerCase().match(/[a-z0-9.]+/g) || [])
    const tokens = allTokens.filter(word => 
      (word.length >= 4 && !STOP_WORDS.has(word)) || 
      (word.length >= 2 && SHORT_ENTITY_TOKENS.has(word))
    )

    const { data, error } = await supabase
      .from('chunks')
      .select('id, document_id, chunk_index, text, site, equipment, fault_code, documents!inner(filename)')
      .in('document_id', documentIds)
      .order('chunk_index', { ascending: true })
      .limit(120)

    if (error || !data) {
      console.error('Document-scoped fallback query error:', error)
      return []
    }

    const perDocCount = new Map<string, number>()
    const filtered = data.filter((row: any) => {
      if (accessibleDocIds && !accessibleDocIds.has(row.document_id)) return false
      if (projectDocIds && !projectDocIds.has(row.document_id)) return false
      if (equipmentType && row.equipment !== equipmentType) return false

      if (broadIntent) {
        const current = perDocCount.get(row.document_id) || 0
        if (current >= 6) return false
        perDocCount.set(row.document_id, current + 1)
        return true
      }

      if (tokens.length === 0) return true
      const text = String(row.text || '').toLowerCase()
      return tokens.some(token => text.includes(token))
    }).slice(0, 30)

    return filtered.map((row: any) => ({
      ...row,
      similarity: 0.35,
      filename: row.documents?.filename ?? 'Unknown',
    }))
  } catch (error) {
    console.error('Document-scoped fallback failed:', error)
    return []
  }
}

// Generate embedding
async function generateEmbedding(text: string, apiTier: string = 'free'): Promise<number[]> {
  const apiKey = apiTier === 'paid'
    ? (Deno.env.get('GOOGLE_API_KEY') || Deno.env.get('GOOGLE_API_KEY_FREE'))
    : (Deno.env.get('GOOGLE_API_KEY_FREE') || Deno.env.get('GOOGLE_API_KEY'))
  if (!apiKey) {
    throw new Error('No Google API key configured')
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

async function generateAnswer(systemPrompt: string, userPrompt: string, model: string = 'google/gemini-2.5-flash-lite'): Promise<{ content: string; usage: { input_tokens: number; output_tokens: number; total_tokens: number; upstream_inference_cost: number } }> {
  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${Deno.env.get('LOVABLE_API_KEY')}`
    },
    body: JSON.stringify({
      model,
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

  const prompt = `You are a strict retrieval evaluation judge. Given a user query and a retrieved document chunk, determine if the chunk contains specific data, facts, or information that would need to be included in a complete answer to the query.

STRICT RULES:
- A chunk is relevant ONLY if it contains specific data/facts that directly answer or are necessary for answering the query.
- Chunks from the same document but different sections/tables than the one asked about are NOT relevant.
- Headers, footers, table of contents entries, footnotes, and general introductory text are NOT relevant unless they contain answerable content.
- Be strict: when in doubt, mark as NOT relevant.

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
  topK: number,
  topKEval: number
) {
  const labels: { chunk_id: string; relevant: boolean; reasoning: string; rank: number }[] = []
  let firstRelevantRank: number | null = null

  for (let i = 0; i < Math.min(chunkTexts.length, topKEval); i++) {
    const { id: chunkId, text: chunkText } = chunkTexts[i]
    const result = await evaluateChunkRelevance(queryText, chunkText)
    labels.push({ chunk_id: chunkId, relevant: result.relevant, reasoning: result.reasoning, rank: i + 1 })

    if (result.relevant && firstRelevantRank === null && i < topK) {
      firstRelevantRank = i + 1
    }
  }

  const totalRelevant = labels.filter(l => l.relevant).length
  const relevantInTopK = labels.filter(l => l.relevant && l.rank <= topK).length
  const precisionAtK = topK > 0 ? relevantInTopK / topK : 0
  const recallAtK = totalRelevant > 0 ? relevantInTopK / totalRelevant : 0
  const hitRate = relevantInTopK > 0 ? 1 : 0

  const { error: updateError } = await supabase.from('query_logs').update({
    top_k_eval: Math.min(topKEval, labels.length, 200),
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
    console.log(`Retrieval eval complete for ${queryLogId}: P@K=${precisionAtK.toFixed(3)}, R@K=${recallAtK.toFixed(3)}, HR=${hitRate}, topKEval=${Math.min(topKEval, labels.length, 200)}`)
  }
}
