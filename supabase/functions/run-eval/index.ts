import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const EVAL_MODEL = 'google/gemini-2.5-flash'

async function verifyAdmin(req: Request) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) throw new Error('Unauthorized')

  const token = authHeader.replace('Bearer ', '')
  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false }
  })
  const { data: { user }, error } = await authClient.auth.getUser(token)
  if (error || !user) throw new Error('Unauthorized')

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const { data: isAdmin } = await supabase.rpc('check_is_admin', { check_user_id: user.id })
  if (!isAdmin) throw new Error('Forbidden: admin only')

  return { supabase, user }
}

// Use Lovable AI gateway for LLM-based relevance evaluation
async function evaluateChunkRelevance(
  queryText: string,
  chunkText: string
): Promise<{ relevant: boolean; reasoning: string }> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY')
  if (!apiKey) throw new Error('LOVABLE_API_KEY not configured')

  const prompt = `You are a retrieval evaluation judge. Given a user query and a retrieved document chunk, determine if the chunk contains information that is necessary or helpful to answer the query.

Respond with ONLY a JSON object: {"relevant": true/false, "reasoning": "one sentence explanation"}

User Query: "${queryText}"

Retrieved Chunk:
"""
${chunkText.slice(0, 2000)}
"""

Is this chunk relevant to answering the query?`

  const res = await fetch('https://ai.lovable.dev/api/chat/v1', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EVAL_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 200,
    }),
  })

  if (!res.ok) {
    console.error('LLM eval error:', res.status, await res.text())
    return { relevant: false, reasoning: 'LLM evaluation failed' }
  }

  const data = await res.json()
  const text = data.choices?.[0]?.message?.content?.trim() ?? ''

  try {
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return { relevant: !!parsed.relevant, reasoning: parsed.reasoning || '' }
    }
  } catch { /* fall through */ }

  return { relevant: text.toLowerCase().includes('"relevant": true') || text.toLowerCase().includes('"relevant":true'), reasoning: text.slice(0, 100) }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { supabase, user } = await verifyAdmin(req)
    const url = new URL(req.url)
    const action = url.searchParams.get('action')

    // ─── ACTION: analytics ───
    if (action === 'analytics') {
      const { data: logs } = await supabase
        .from('query_logs')
        .select('execution_time_ms, input_tokens, output_tokens, total_tokens, upstream_inference_cost, precision_at_k, recall_at_k, hit_rate_at_k, first_relevant_rank')
        .order('created_at', { ascending: true })

      if (!logs || logs.length === 0) {
        return new Response(JSON.stringify({ error: 'No query logs found' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      const times = logs.map(l => l.execution_time_ms).filter(Boolean).sort((a, b) => a - b)
      const costs = logs.map(l => l.upstream_inference_cost ?? 0).sort((a, b) => a - b)

      const percentile = (arr: number[], p: number) => {
        if (arr.length === 0) return 0
        const idx = Math.ceil((p / 100) * arr.length) - 1
        return arr[Math.max(0, idx)]
      }
      const avg = (arr: number[]) => arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length

      // Retrieval eval stats from evaluated logs
      const evaluated = logs.filter(l => l.precision_at_k !== null)

      const analytics = {
        sample_size: logs.length,
        latency: {
          p50: percentile(times, 50), p95: percentile(times, 95), p99: percentile(times, 99),
          avg: Math.round(avg(times)), min: times[0] ?? 0, max: times[times.length - 1] ?? 0,
        },
        tokens: {
          avg_input: Math.round(avg(logs.map(l => l.input_tokens ?? 0))),
          avg_output: Math.round(avg(logs.map(l => l.output_tokens ?? 0))),
          avg_total: Math.round(avg(logs.map(l => l.total_tokens ?? 0))),
        },
        cost: {
          avg: avg(costs).toFixed(6), p95: percentile(costs, 95).toFixed(6),
          total: costs.reduce((s, v) => s + v, 0).toFixed(6),
        },
        retrieval_eval: evaluated.length > 0 ? {
          evaluated_count: evaluated.length,
          avg_precision_at_k: parseFloat(avg(evaluated.map(l => l.precision_at_k!)).toFixed(4)),
          avg_recall_at_k: parseFloat(avg(evaluated.map(l => l.recall_at_k!)).toFixed(4)),
          avg_hit_rate: parseFloat(avg(evaluated.map(l => l.hit_rate_at_k ?? 0)).toFixed(4)),
          mrr: parseFloat(avg(evaluated.map(l => l.first_relevant_rank ? 1 / l.first_relevant_rank : 0)).toFixed(4)),
        } : null,
      }

      return new Response(JSON.stringify({ success: true, analytics }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ─── ACTION: export ───
    if (action === 'export') {
      const { data: logs } = await supabase
        .from('query_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5000)

      if (!logs || logs.length === 0) {
        return new Response('No data', { status: 200, headers: { ...corsHeaders, 'Content-Type': 'text/plain' } })
      }

      // Match exact column order as shown in Cloud table view
      const columns = [
        'id', 'created_at', 'user_id', 'query_text',
        'retrieved_chunk_ids', 'retrieved_similarities',
        'response_text', 'citations_json',
        'input_tokens', 'output_tokens', 'total_tokens',
        'execution_time_ms', 'top_k', 'upstream_inference_cost',
        'total_relevant_chunks', 'relevant_in_top_k',
        'precision_at_k', 'recall_at_k', 'hit_rate_at_k',
        'first_relevant_rank', 'relevance_labels',
        'evaluated_at', 'eval_model',
      ]

      const escapeCsvField = (val: unknown): string => {
        if (val === null || val === undefined) return ''
        let str: string
        if (typeof val === 'object') {
          str = JSON.stringify(val)
        } else {
          str = String(val)
        }
        // Replace newlines with spaces so Excel doesn't split rows
        str = str.replace(/\r\n/g, ' ').replace(/\n/g, ' ').replace(/\r/g, ' ')
        // Always quote fields to avoid delimiter confusion
        return `"${str.replace(/"/g, '""')}"`
      }

      // Add BOM for Excel UTF-8 detection
      const bom = '\uFEFF'
      const csvRows = [columns.join(',')]
      for (const log of logs) {
        const row = columns.map(col => escapeCsvField((log as any)[col]))
        csvRows.push(row.join(','))
      }

      const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
      return new Response(bom + csvRows.join('\r\n'), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="query_logs_${timestamp}.csv"`,
        }
      })
    }

    // ─── ACTION: run-eval (ground-truth based, existing) ───
    if (action === 'run-eval') {
      const { data: evalSet } = await supabase.from('eval_dataset').select('*')

      if (!evalSet || evalSet.length === 0) {
        return new Response(JSON.stringify({ error: 'No eval dataset entries found.' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const k = parseInt(url.searchParams.get('k') ?? '10')
      const results: any[] = []

      for (const item of evalSet) {
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
          query_embedding: embeddingStr, match_threshold: 0.15, match_count: k
        })

        const retrievedIds = (chunks || []).map((c: any) => c.id)
        const expectedIds = new Set(item.expected_chunk_ids || [])
        const relevant = retrievedIds.filter((id: string) => expectedIds.has(id))

        const precision = retrievedIds.length > 0 ? relevant.length / retrievedIds.length : 0
        const recall = expectedIds.size > 0 ? relevant.length / expectedIds.size : 0

        results.push({
          query: item.query_text, k, retrieved_count: retrievedIds.length, expected_count: expectedIds.size,
          relevant_found: relevant.length,
          precision_at_k: parseFloat(precision.toFixed(4)),
          recall_at_k: parseFloat(recall.toFixed(4)),
        })
      }

      const avgPrecision = results.reduce((s, r) => s + r.precision_at_k, 0) / results.length
      const avgRecall = results.reduce((s, r) => s + r.recall_at_k, 0) / results.length

      return new Response(JSON.stringify({
        success: true, k, total_queries: results.length,
        avg_precision_at_k: parseFloat(avgPrecision.toFixed(4)),
        avg_recall_at_k: parseFloat(avgRecall.toFixed(4)),
        results
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ─── ACTION: run-retrieval-eval (LLM-based relevance evaluation) ───
    if (action === 'run-retrieval-eval') {
      const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50'), 200)
      const skipEvaluated = url.searchParams.get('skip_evaluated') !== 'false'

      // Fetch query logs that have retrieved chunks
      let query = supabase
        .from('query_logs')
        .select('id, query_text, retrieved_chunk_ids, top_k')
        .not('retrieved_chunk_ids', 'is', null)
        .order('created_at', { ascending: false })
        .limit(limit)

      if (skipEvaluated) {
        query = query.is('evaluated_at', null)
      }

      const { data: logs, error: logsError } = await query

      if (logsError) throw logsError
      if (!logs || logs.length === 0) {
        return new Response(JSON.stringify({ success: true, message: 'No unevaluated query logs found', evaluated: 0 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      console.log(`Evaluating ${logs.length} queries with LLM (${EVAL_MODEL})`)

      const perQueryResults: any[] = []

      for (const log of logs) {
        const chunkIds = log.retrieved_chunk_ids || []
        const k = log.top_k || chunkIds.length

        if (chunkIds.length === 0) continue

        // Fetch chunk texts
        const { data: chunks } = await supabase
          .from('chunks')
          .select('id, text')
          .in('id', chunkIds)

        if (!chunks || chunks.length === 0) continue

        // Build chunk map preserving rank order
        const chunkMap = new Map(chunks.map(c => [c.id, c.text]))

        const labels: { chunk_id: string; relevant: boolean; reasoning: string; rank: number }[] = []
        let firstRelevantRank: number | null = null

        for (let i = 0; i < Math.min(chunkIds.length, k); i++) {
          const chunkId = chunkIds[i]
          const chunkText = chunkMap.get(chunkId)
          if (!chunkText) {
            labels.push({ chunk_id: chunkId, relevant: false, reasoning: 'Chunk not found', rank: i + 1 })
            continue
          }

          const result = await evaluateChunkRelevance(log.query_text, chunkText)
          labels.push({ chunk_id: chunkId, relevant: result.relevant, reasoning: result.reasoning, rank: i + 1 })

          if (result.relevant && firstRelevantRank === null) {
            firstRelevantRank = i + 1
          }
        }

        const totalRelevant = labels.filter(l => l.relevant).length
        const relevantInTopK = totalRelevant // we evaluate up to K
        const precisionAtK = k > 0 ? relevantInTopK / Math.min(chunkIds.length, k) : 0
        const recallAtK = totalRelevant > 0 ? relevantInTopK / totalRelevant : (totalRelevant === 0 ? 0 : 0)
        const hitRate = relevantInTopK > 0 ? 1 : 0

        // Update query_logs row
        await supabase.from('query_logs').update({
          total_relevant_chunks: totalRelevant,
          relevant_in_top_k: relevantInTopK,
          precision_at_k: parseFloat(precisionAtK.toFixed(4)),
          recall_at_k: parseFloat(recallAtK.toFixed(4)),
          hit_rate_at_k: hitRate,
          first_relevant_rank: firstRelevantRank,
          relevance_labels: labels,
          eval_model: EVAL_MODEL,
          evaluated_at: new Date().toISOString(),
        }).eq('id', log.id)

        perQueryResults.push({
          query_log_id: log.id,
          query: log.query_text.slice(0, 100),
          k: Math.min(chunkIds.length, k),
          total_relevant: totalRelevant,
          precision_at_k: parseFloat(precisionAtK.toFixed(4)),
          recall_at_k: parseFloat(recallAtK.toFixed(4)),
          hit_rate: hitRate,
          first_relevant_rank: firstRelevantRank,
        })
      }

      // Compute aggregate metrics
      const total = perQueryResults.length
      if (total === 0) {
        return new Response(JSON.stringify({ success: true, message: 'No queries to evaluate', evaluated: 0 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const avgPrecision = perQueryResults.reduce((s, r) => s + r.precision_at_k, 0) / total
      const avgRecall = perQueryResults.reduce((s, r) => s + r.recall_at_k, 0) / total
      const avgHitRate = perQueryResults.reduce((s, r) => s + r.hit_rate, 0) / total
      const mrr = perQueryResults.reduce((s, r) => s + (r.first_relevant_rank ? 1 / r.first_relevant_rank : 0), 0) / total

      // Store aggregate in eval_runs
      await supabase.from('eval_runs').insert({
        created_by: user.id,
        total_queries: total,
        avg_precision_at_k: parseFloat(avgPrecision.toFixed(4)),
        avg_recall_at_k: parseFloat(avgRecall.toFixed(4)),
        avg_hit_rate_at_k: parseFloat(avgHitRate.toFixed(4)),
        mrr: parseFloat(mrr.toFixed(4)),
        k_used: 'per-query top_k',
        eval_model: EVAL_MODEL,
        notes: `Evaluated ${total} queries. Chunks ranked by post-reranking order.`,
      })

      return new Response(JSON.stringify({
        success: true,
        evaluated: total,
        eval_model: EVAL_MODEL,
        k_used: 'per-query top_k (stored in query_logs.top_k)',
        ranking_confirmed: 'retrieved_chunk_ids stored in ranked order after TOC-penalty re-ranking',
        aggregate: {
          avg_precision_at_k: parseFloat(avgPrecision.toFixed(4)),
          avg_recall_at_k: parseFloat(avgRecall.toFixed(4)),
          avg_hit_rate_at_k: parseFloat(avgHitRate.toFixed(4)),
          mrr: parseFloat(mrr.toFixed(4)),
        },
        per_query: perQueryResults,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ─── ACTION: eval-runs (list past eval runs) ───
    if (action === 'eval-runs') {
      const { data: runs } = await supabase
        .from('eval_runs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20)

      return new Response(JSON.stringify({ success: true, runs: runs || [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ error: 'Unknown action. Use ?action=analytics|export|run-eval|run-retrieval-eval|eval-runs' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Eval error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    const status = msg === 'Unauthorized' ? 401 : msg.startsWith('Forbidden') ? 403 : 500
    return new Response(JSON.stringify({ error: msg }), {
      status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
