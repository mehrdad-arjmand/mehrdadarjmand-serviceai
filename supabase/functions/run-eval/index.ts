import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

    // Verify JWT
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const token = authHeader.replace('Bearer ', '')
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false }
    })
    const { data: { user }, error: authError } = await authClient.auth.getUser(token)
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Check admin
    const { data: isAdmin } = await supabase.rpc('check_is_admin', { check_user_id: user.id })
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Forbidden: admin only' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const url = new URL(req.url)
    const action = url.searchParams.get('action')

    // Action: analytics — return percentiles and token/cost stats
    if (action === 'analytics') {
      const { data: logs } = await supabase
        .from('query_logs')
        .select('execution_time_ms, input_tokens, output_tokens, total_tokens, upstream_inference_cost')
        .order('created_at', { ascending: true })

      if (!logs || logs.length === 0) {
        return new Response(JSON.stringify({ error: 'No query logs found' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      const times = logs.map(l => l.execution_time_ms).sort((a, b) => a - b)
      const costs = logs.map(l => l.upstream_inference_cost ?? 0).sort((a, b) => a - b)

      const percentile = (arr: number[], p: number) => {
        const idx = Math.ceil((p / 100) * arr.length) - 1
        return arr[Math.max(0, idx)]
      }
      const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length

      const analytics = {
        sample_size: logs.length,
        latency: {
          p50: percentile(times, 50),
          p95: percentile(times, 95),
          p99: percentile(times, 99),
          avg: Math.round(avg(times)),
          min: times[0],
          max: times[times.length - 1],
        },
        tokens: {
          avg_input: Math.round(avg(logs.map(l => l.input_tokens ?? 0))),
          avg_output: Math.round(avg(logs.map(l => l.output_tokens ?? 0))),
          avg_total: Math.round(avg(logs.map(l => l.total_tokens ?? 0))),
        },
        cost: {
          avg: avg(costs).toFixed(6),
          p95: percentile(costs, 95).toFixed(6),
          total: costs.reduce((s, v) => s + v, 0).toFixed(6),
        }
      }

      return new Response(JSON.stringify({ success: true, analytics }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Action: export — CSV export of query_logs
    if (action === 'export') {
      const { data: logs } = await supabase
        .from('query_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5000)

      if (!logs || logs.length === 0) {
        return new Response('No data', { status: 200, headers: { ...corsHeaders, 'Content-Type': 'text/plain' } })
      }

      const headers = ['id','created_at','query_text','response_text','retrieved_chunk_ids','retrieved_similarities','input_tokens','output_tokens','total_tokens','execution_time_ms','top_k','upstream_inference_cost']
      const csvRows = [headers.join(',')]
      for (const log of logs) {
        const row = headers.map(h => {
          const val = (log as any)[h]
          if (val === null || val === undefined) return ''
          const str = Array.isArray(val) ? JSON.stringify(val) : String(val)
          return `"${str.replace(/"/g, '""')}"`
        })
        csvRows.push(row.join(','))
      }

      return new Response(csvRows.join('\n'), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename=query_logs.csv',
        }
      })
    }

    // Action: run-eval — run precision@k / recall@k evaluation
    if (action === 'run-eval') {
      const { data: evalSet } = await supabase.from('eval_dataset').select('*')

      if (!evalSet || evalSet.length === 0) {
        return new Response(JSON.stringify({ error: 'No eval dataset entries found. Add query_text + expected_chunk_ids rows to eval_dataset table.' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const k = parseInt(url.searchParams.get('k') ?? '10')
      const results: any[] = []

      for (const item of evalSet) {
        // Generate embedding for eval query
        const embResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${Deno.env.get('GOOGLE_API_KEY')}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: { parts: [{ text: item.query_text }] }, outputDimensionality: 768 })
          }
        )
        const embData = await embResponse.json()
        const embedding = embData.embedding?.values

        if (!embedding) {
          results.push({ query: item.query_text, error: 'Failed to generate embedding', precision_at_k: 0, recall_at_k: 0 })
          continue
        }

        const embeddingStr = `[${embedding.join(',')}]`
        const { data: chunks } = await supabase.rpc('match_chunks', {
          query_embedding: embeddingStr,
          match_threshold: 0.15,
          match_count: k
        })

        const retrievedIds = (chunks || []).map((c: any) => c.id)
        const expectedIds = new Set(item.expected_chunk_ids || [])
        const relevant = retrievedIds.filter((id: string) => expectedIds.has(id))

        const precision = retrievedIds.length > 0 ? relevant.length / retrievedIds.length : 0
        const recall = expectedIds.size > 0 ? relevant.length / expectedIds.size : 0

        results.push({
          query: item.query_text,
          k,
          retrieved_count: retrievedIds.length,
          expected_count: expectedIds.size,
          relevant_found: relevant.length,
          precision_at_k: parseFloat(precision.toFixed(4)),
          recall_at_k: parseFloat(recall.toFixed(4)),
        })
      }

      const avgPrecision = results.reduce((s, r) => s + r.precision_at_k, 0) / results.length
      const avgRecall = results.reduce((s, r) => s + r.recall_at_k, 0) / results.length

      return new Response(JSON.stringify({
        success: true,
        k,
        total_queries: results.length,
        avg_precision_at_k: parseFloat(avgPrecision.toFixed(4)),
        avg_recall_at_k: parseFloat(avgRecall.toFixed(4)),
        results
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({ error: 'Unknown action. Use ?action=analytics|export|run-eval' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Eval error:', error)
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
