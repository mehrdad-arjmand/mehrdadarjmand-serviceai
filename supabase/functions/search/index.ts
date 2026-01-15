import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Input validation helpers
function sanitizeQuery(query: string): string {
  // Trim and limit length
  const trimmed = query.trim().slice(0, 500)
  // Escape LIKE pattern special characters to prevent wildcard injection
  return trimmed.replace(/[%_\\]/g, (char) => `\\${char}`)
}

function isValidQuery(query: unknown): query is string {
  return typeof query === 'string' && query.trim().length > 0 && query.length <= 1000
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!

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

    console.log(`Search query from user: ${user.id}`)

    // Use service role client for database operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Validate content-type
    const contentType = req.headers.get('content-type')
    if (!contentType?.includes('application/json')) {
      throw new Error('Content-Type must be application/json')
    }

    // Parse and validate request body
    let body: unknown
    try {
      body = await req.json()
    } catch {
      throw new Error('Invalid JSON body')
    }

    if (typeof body !== 'object' || body === null) {
      throw new Error('Request body must be an object')
    }

    const { query } = body as { query?: unknown }

    // Validate query input
    if (!isValidQuery(query)) {
      throw new Error('Query must be a non-empty string with max 1000 characters')
    }

    // Sanitize query for LIKE pattern use
    const sanitizedQuery = sanitizeQuery(query)

    console.log(`Searching for: "${sanitizedQuery.slice(0, 50)}..."`)

    // Search for chunks containing the query (case-insensitive)
    // Use escaped pattern to prevent wildcard injection
    const { data: chunks, error } = await supabase
      .from('chunks')
      .select(`
        id,
        text,
        chunk_index,
        equipment,
        document_id,
        documents!inner(filename)
      `)
      .ilike('text', `%${sanitizedQuery}%`)
      .limit(10)

    if (error) {
      throw error
    }

    // Format results with snippets
    const results = chunks.map((chunk: any) => {
      const text = chunk.text
      const queryLower = query.toLowerCase()
      const textLower = text.toLowerCase()
      const matchIndex = textLower.indexOf(queryLower)

      // Extract snippet around the match (~200 chars)
      let snippetStart = Math.max(0, matchIndex - 100)
      let snippetEnd = Math.min(text.length, matchIndex + query.length + 100)

      // Adjust to word boundaries
      if (snippetStart > 0) {
        const spaceIndex = text.lastIndexOf(' ', snippetStart)
        if (spaceIndex > snippetStart - 20) snippetStart = spaceIndex + 1
      }
      if (snippetEnd < text.length) {
        const spaceIndex = text.indexOf(' ', snippetEnd)
        if (spaceIndex > 0 && spaceIndex < snippetEnd + 20) snippetEnd = spaceIndex
      }

      let snippet = text.slice(snippetStart, snippetEnd)
      if (snippetStart > 0) snippet = '...' + snippet
      if (snippetEnd < text.length) snippet = snippet + '...'

      return {
        fileName: chunk.documents.filename,
        snippet,
        position: matchIndex,
        equipment: chunk.equipment,
      }
    })

    // Sort by position (earlier matches first)
    results.sort((a, b) => a.position - b.position)

    return new Response(
      JSON.stringify({ 
        success: true,
        results,
        count: results.length,
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )
  } catch (error) {
    console.error('Error in search:', error)
    const message = error instanceof Error ? error.message : 'Unknown error occurred'
    return new Response(
      JSON.stringify({ 
        success: false,
        error: message 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    )
  }
})
