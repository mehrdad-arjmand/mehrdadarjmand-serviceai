import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { query } = await req.json()

    if (!query || query.trim().length === 0) {
      throw new Error('Query is required')
    }

    console.log(`Searching for: "${query}"`)

    // Search for chunks containing the query (case-insensitive)
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
      .ilike('text', `%${query}%`)
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
