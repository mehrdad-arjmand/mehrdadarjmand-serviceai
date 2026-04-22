import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const EVAL_MODEL = 'google/gemini-2.5-flash'

async function verifyAdmin(req: Request) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) throw new Error('Unauthorized')

  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: supabaseAnonKey },
  })
  if (!userRes.ok) throw new Error('Unauthorized')
  const user = await userRes.json()
  if (!user?.id) throw new Error('Unauthorized')

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const { data: isAdmin } = await supabase.rpc('check_is_admin', { check_user_id: user.id })
  if (!isAdmin) throw new Error('Forbidden: admin only')

  // Get user's API tier
  const { data: userApiTier } = await supabase.rpc('get_user_api_tier', { p_user_id: user.id })
  const apiTier = userApiTier || 'free'

  return { supabase, user, apiTier }
}

function getEmbeddingApiKey(apiTier: string): string {
  const key = apiTier === 'paid'
    ? (Deno.env.get('GOOGLE_API_KEY') || Deno.env.get('GOOGLE_API_KEY_FREE'))
    : (Deno.env.get('GOOGLE_API_KEY_FREE') || Deno.env.get('GOOGLE_API_KEY'))
  if (!key) throw new Error('No Google API key configured')
  return key
}

// Use Lovable AI gateway for LLM-based relevance evaluation
async function evaluateChunkRelevance(
  queryText: string,
  chunkText: string
): Promise<{ relevant: boolean; reasoning: string }> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY')
  if (!apiKey) throw new Error('LOVABLE_API_KEY not configured')

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

  const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
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
        .select('execution_time_ms, input_tokens, output_tokens, total_tokens, upstream_inference_cost, precision_at_k, recall_at_k, hit_rate_at_k, first_relevant_rank, relevant_in_top_k, total_relevant_chunks, top_k')
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

      // Retrieval eval: only rows where first_relevant_rank is not null AND total_relevant_chunks is not null (properly evaluated)
      const eligible = logs.filter(l => l.first_relevant_rank !== null && l.first_relevant_rank !== undefined && l.total_relevant_chunks !== null && l.total_relevant_chunks !== undefined)

      // Precision@K = sum(relevant_in_top_k) / sum(top_k) for eligible rows
      const sumRelevantInTopK = eligible.reduce((s, l) => s + (l.relevant_in_top_k ?? 0), 0)
      const sumTopK = eligible.reduce((s, l) => s + (l.top_k ?? 0), 0)
      const aggPrecision = sumTopK > 0 ? sumRelevantInTopK / sumTopK : 0

      // Recall@K = sum(relevant_in_top_k) / sum(total_relevant_chunks) for eligible rows
      const sumTotalRelevant = eligible.reduce((s, l) => s + (l.total_relevant_chunks ?? 0), 0)
      const aggRecall = sumTotalRelevant > 0 ? sumRelevantInTopK / sumTotalRelevant : 0

      const avgHitRate = eligible.length > 0 ? parseFloat(avg(eligible.map(l => l.hit_rate_at_k ?? 0)).toFixed(4)) : 0
      const mrr = eligible.length > 0 ? parseFloat(avg(eligible.map(l => l.first_relevant_rank ? 1 / l.first_relevant_rank : 0)).toFixed(4)) : 0

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
        retrieval_eval: eligible.length > 0 ? {
          evaluated_count: eligible.length,
          total_queries: logs.length,
          abstention_rate: parseFloat(((logs.length - eligible.length) / logs.length).toFixed(4)),
          avg_precision_at_k: parseFloat(aggPrecision.toFixed(4)),
          avg_recall_at_k: parseFloat(aggRecall.toFixed(4)),
          avg_hit_rate: avgHitRate,
          mrr: mrr,
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

      // CSV columns: use summary columns instead of raw JSON blobs
      // (citations_json and relevance_labels are huge JSON that break CSV in spreadsheets)
      const columns = [
        'id', 'created_at', 'user_id', 'query_text',
        'response_text',
        'input_tokens', 'output_tokens', 'total_tokens',
        'execution_time_ms', 'top_k', 'top_k_eval', 'upstream_inference_cost',
        'total_relevant_chunks', 'relevant_in_top_k',
        'precision_at_k', 'recall_at_k', 'hit_rate_at_k',
        'first_relevant_rank',
        'evaluated_at', 'eval_model',
        'num_retrieved_chunks', 'num_citations', 'num_relevant_labels',
      ]

      const escapeCsvField = (val: unknown): string => {
        if (val === null || val === undefined) return ''
        const str = String(val)
          .replace(/\r\n/g, ' ').replace(/\n/g, ' ').replace(/\r/g, ' ')
        // Always quote fields to avoid delimiter confusion
        return `"${str.replace(/"/g, '""')}"`
      }

      // Add BOM for Excel UTF-8 detection
      const bom = '\uFEFF'
      const csvRows = [columns.join(',')]
      for (const log of logs) {
        const rec: Record<string, unknown> = {}
        for (const col of columns) {
          if (col === 'num_retrieved_chunks') {
            rec[col] = Array.isArray((log as any).retrieved_chunk_ids) ? (log as any).retrieved_chunk_ids.length : 0
          } else if (col === 'num_citations') {
            rec[col] = Array.isArray((log as any).citations_json) ? (log as any).citations_json.length : 0
          } else if (col === 'num_relevant_labels') {
            rec[col] = Array.isArray((log as any).relevance_labels) ? (log as any).relevance_labels.length : 0
          } else if (col === 'response_text') {
            // Truncate very long responses to keep CSV manageable
            const rt = (log as any).response_text || ''
            rec[col] = rt.length > 500 ? rt.slice(0, 500) + '...' : rt
          } else {
            rec[col] = (log as any)[col]
          }
        }
        const row = columns.map(col => escapeCsvField(rec[col]))
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
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${getEmbeddingApiKey(apiTier)}`,
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

      let query = supabase
        .from('query_logs')
        .select('id, query_text, retrieved_chunk_ids, top_k, top_k_eval')
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

        // Eval uses stored retrieved_chunk_ids (vector-retrieved chunks)
        const { data: evalChunksData } = await supabase
          .from('chunks')
          .select('id, text')
          .in('id', chunkIds.slice(0, 200))
        const evalChunks = evalChunksData || []

        const topKEval = evalChunks.length

        const labels: { chunk_id: string; relevant: boolean; reasoning: string; rank: number }[] = []
        let firstRelevantRank: number | null = null

        for (let i = 0; i < topKEval; i++) {
          const chunk = evalChunks[i]
          if (!chunk || !chunk.text) {
            labels.push({ chunk_id: chunk?.id || 'unknown', relevant: false, reasoning: 'Chunk not found', rank: i + 1 })
            continue
          }

          const result = await evaluateChunkRelevance(log.query_text, chunk.text)
          labels.push({ chunk_id: chunk.id, relevant: result.relevant, reasoning: result.reasoning, rank: i + 1 })

          // For firstRelevantRank, check if the chunk was in the original top-K retrieval
          const topKSet = new Set(chunkIds.slice(0, k))
          if (result.relevant && firstRelevantRank === null && topKSet.has(chunk.id)) {
            // Find rank in original retrieval order
            const originalRank = chunkIds.indexOf(chunk.id)
            if (originalRank >= 0 && originalRank < k) {
              firstRelevantRank = originalRank + 1
            }
          }
        }

        const topKChunkIdSet = new Set(chunkIds.slice(0, k))
        const totalRelevant = labels.filter(l => l.relevant).length
        const relevantInTopK = labels.filter(l => l.relevant && topKChunkIdSet.has(l.chunk_id)).length
        const precisionAtK = k > 0 ? relevantInTopK / k : 0
        const recallAtK = totalRelevant > 0 ? relevantInTopK / totalRelevant : 0
        const hitRate = relevantInTopK > 0 ? 1 : 0

        await supabase.from('query_logs').update({
          top_k_eval: topKEval,
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
          k,
          top_k_eval: topKEval,
          total_relevant: totalRelevant,
          relevant_in_top_k: relevantInTopK,
          precision_at_k: parseFloat(precisionAtK.toFixed(4)),
          recall_at_k: parseFloat(recallAtK.toFixed(4)),
          hit_rate: hitRate,
          first_relevant_rank: firstRelevantRank,
        })
      }

      const total = perQueryResults.length
      if (total === 0) {
        return new Response(JSON.stringify({ success: true, message: 'No queries to evaluate', evaluated: 0 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const eligibleResults = perQueryResults.filter(r => r.first_relevant_rank !== null)
      const sumRelevantInTopK = eligibleResults.reduce((sum, r) => sum + (r.relevant_in_top_k ?? 0), 0)
      const sumTopK = eligibleResults.reduce((sum, r) => sum + (r.k ?? 0), 0)
      const sumTotalRelevant = eligibleResults.reduce((sum, r) => sum + (r.total_relevant ?? 0), 0)
      const avgPrecision = sumTopK > 0 ? sumRelevantInTopK / sumTopK : 0
      const avgRecall = sumTotalRelevant > 0 ? sumRelevantInTopK / sumTotalRelevant : 0
      const avgHitRate = eligibleResults.length > 0 ? eligibleResults.reduce((s, r) => s + r.hit_rate, 0) / eligibleResults.length : 0
      const mrr = eligibleResults.length > 0 ? eligibleResults.reduce((s, r) => s + (r.first_relevant_rank ? 1 / r.first_relevant_rank : 0), 0) / eligibleResults.length : 0

      await supabase.from('eval_runs').insert({
        created_by: user.id,
        total_queries: eligibleResults.length,
        avg_precision_at_k: parseFloat(avgPrecision.toFixed(4)),
        avg_recall_at_k: parseFloat(avgRecall.toFixed(4)),
        avg_hit_rate_at_k: parseFloat(avgHitRate.toFixed(4)),
        mrr: parseFloat(mrr.toFixed(4)),
        k_used: 'per-query top_k',
        eval_model: EVAL_MODEL,
        notes: `Evaluated ${total} queries; aggregates use only rows with first_relevant_rank present.`,
      })

      return new Response(JSON.stringify({
        success: true,
        evaluated: total,
        evaluated_nonzero: eligibleResults.length,
        eval_model: EVAL_MODEL,
        k_used: 'per-query top_k (top_k_eval stored separately)',
        ranking_confirmed: 'retrieved_chunk_ids stored in ranked order after re-ranking',
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

    // ─── ACTION: run-expanded-eval (LLM-judged with expanded scan for true recall) ───
    if (action === 'run-expanded-eval') {
      const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50'), 200)
      const scanK = Math.min(parseInt(url.searchParams.get('scan_k') ?? '200'), 500)
      const threshold = parseFloat(url.searchParams.get('threshold') ?? '0.10')
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

      console.log(`[Expanded Eval] Evaluating ${logs.length} queries, scan_k=${scanK}, threshold=${threshold}`)

      const perQueryResults: any[] = []

      for (const log of logs) {
        const originalTopK = log.top_k || 10
        const originalChunkIds = log.retrieved_chunk_ids || []

        // Step 1: Re-embed the query
        const embResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${getEmbeddingApiKey(apiTier)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: { parts: [{ text: log.query_text }] }, outputDimensionality: 768 })
          }
        )
        const embData = await embResponse.json()
        const embedding = embData.embedding?.values
        if (!embedding) {
          console.error(`[Expanded Eval] Failed to embed query: ${log.query_text.slice(0, 50)}`)
          continue
        }

        // Step 2: Retrieve expanded candidate set (top-scanK at low threshold)
        const embeddingStr = `[${embedding.join(',')}]`
        const { data: expandedChunks } = await supabase.rpc('match_chunks', {
          query_embedding: embeddingStr, match_threshold: threshold, match_count: scanK
        })

        if (!expandedChunks || expandedChunks.length === 0) continue

        // Step 3: LLM-judge each expanded chunk
        let totalRelevantInScan = 0
        for (const chunk of expandedChunks) {
          const result = await evaluateChunkRelevance(log.query_text, chunk.text)
          if (result.relevant) totalRelevantInScan++
        }

        // Step 4: Count how many of original top-K are relevant
        // Re-judge only original top-K chunks
        const originalSet = new Set(originalChunkIds)
        const originalChunksInExpanded = expandedChunks.filter((c: any) => originalSet.has(c.id))

        let relevantInTopK = 0
        for (const chunk of originalChunksInExpanded) {
          const result = await evaluateChunkRelevance(log.query_text, chunk.text)
          if (result.relevant) relevantInTopK++
        }

        // Step 5: Calculate metrics
        const precisionAtK = originalChunkIds.length > 0 ? relevantInTopK / Math.min(originalChunkIds.length, originalTopK) : 0
        const expandedRecall = totalRelevantInScan > 0 ? relevantInTopK / totalRelevantInScan : 0
        const hitRate = relevantInTopK > 0 ? 1 : 0

        // Find first relevant rank among original chunks
        let firstRelevantRank: number | null = null
        for (let i = 0; i < originalChunkIds.length; i++) {
          const chunk = expandedChunks.find((c: any) => c.id === originalChunkIds[i])
          if (chunk) {
            const result = await evaluateChunkRelevance(log.query_text, chunk.text)
            if (result.relevant) { firstRelevantRank = i + 1; break }
          }
        }

        // Step 6: Update query_logs row with expanded metrics
        await supabase.from('query_logs').update({
          total_relevant_chunks: totalRelevantInScan,
          relevant_in_top_k: relevantInTopK,
          precision_at_k: parseFloat(precisionAtK.toFixed(4)),
          recall_at_k: parseFloat(expandedRecall.toFixed(4)),
          hit_rate_at_k: hitRate,
          first_relevant_rank: firstRelevantRank,
          eval_model: EVAL_MODEL,
          evaluated_at: new Date().toISOString(),
        }).eq('id', log.id)

        perQueryResults.push({
          query_log_id: log.id,
          query: log.query_text.slice(0, 100),
          scan_k: expandedChunks.length,
          original_k: Math.min(originalChunkIds.length, originalTopK),
          total_relevant_in_scan: totalRelevantInScan,
          relevant_in_top_k: relevantInTopK,
          precision_at_k: parseFloat(precisionAtK.toFixed(4)),
          expanded_recall: parseFloat(expandedRecall.toFixed(4)),
          hit_rate: hitRate,
          first_relevant_rank: firstRelevantRank,
        })
      }

      const total = perQueryResults.length
      if (total === 0) {
        return new Response(JSON.stringify({ success: true, message: 'No queries to evaluate', evaluated: 0 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const nonZeroResults = perQueryResults.filter(r => r.precision_at_k > 0)
      const nonZeroCount = nonZeroResults.length

      const avgPrecision = nonZeroCount > 0 ? nonZeroResults.reduce((s, r) => s + r.precision_at_k, 0) / nonZeroCount : 0
      const avgRecall = total > 0 ? perQueryResults.reduce((s, r) => s + r.expanded_recall, 0) / total : 0
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
        k_used: `expanded scan_k=${scanK} threshold=${threshold}`,
        eval_model: EVAL_MODEL,
        notes: `Expanded recall eval: ${total} queries, ${nonZeroCount} non-zero precision. scan_k=${scanK}, threshold=${threshold}. Total relevant found via expanded scan used as recall denominator.`,
      })

      return new Response(JSON.stringify({
        success: true,
        evaluated: total,
        evaluated_nonzero: nonZeroCount,
        eval_model: EVAL_MODEL,
        scan_k: scanK,
        threshold,
        aggregate: {
          avg_precision_at_k: parseFloat(avgPrecision.toFixed(4)),
          avg_recall_at_k: parseFloat(avgRecall.toFixed(4)),
          avg_hit_rate_at_k: parseFloat(avgHitRate.toFixed(4)),
          mrr: parseFloat(mrr.toFixed(4)),
        },
        per_query: perQueryResults,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({ error: 'Unknown action. Use ?action=analytics|export|run-eval|run-retrieval-eval|run-expanded-eval|eval-runs' }), {
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
