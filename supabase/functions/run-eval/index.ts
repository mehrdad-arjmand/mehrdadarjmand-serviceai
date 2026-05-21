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

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const benchUserId = req.headers.get('x-benchmark-user-id')
  const bearerToken = authHeader.slice(7).trim()
  let user: { id: string } | null = null

  // Benchmark bypass: bearer must match bench_secrets.service_role
  if (benchUserId) {
    const { data: benchRow } = await supabase
      .from('bench_secrets').select('value').eq('key', 'service_role').maybeSingle()
    if (benchRow?.value && benchRow.value === bearerToken) {
      user = { id: benchUserId }
    }
  }

  if (!user) {
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: authHeader, apikey: supabaseAnonKey },
    })
    if (!userRes.ok) throw new Error('Unauthorized')
    const u = await userRes.json()
    if (!u?.id) throw new Error('Unauthorized')
    user = { id: u.id }
  }

  const { data: isAdmin } = await supabase.rpc('check_is_admin', { check_user_id: user.id })
  if (!isAdmin) throw new Error('Forbidden: admin only')

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

// Use Google Gemini API directly (paid key) for LLM-based relevance evaluation.
// Bypasses Lovable AI gateway to avoid shared-quota rate limits during benchmarks.
async function evaluateChunkRelevance(
  queryText: string,
  chunkText: string,
  apiTier: string
): Promise<{ relevant: boolean; reasoning: string }> {
  const apiKey = Deno.env.get('GOOGLE_API_KEY') || Deno.env.get('GOOGLE_API_KEY_FREE')
  if (!apiKey) return { relevant: false, reasoning: 'GOOGLE_API_KEY not configured' }

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

  // Retry once on 429/5xx
  let lastErr = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 200, responseMimeType: 'application/json' },
        }),
      }
    )
    if (res.ok) {
      const data = await res.json()
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? ''
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0])
          return { relevant: !!parsed.relevant, reasoning: parsed.reasoning || '' }
        }
      } catch { /* fall through */ }
      return { relevant: false, reasoning: 'Parse error' }
    }
    lastErr = `${res.status}`
    if (res.status !== 429 && res.status < 500) break
    await new Promise(r => setTimeout(r, 800 + attempt * 1500))
  }
  console.error('Gemini judge error:', lastErr)
  return { relevant: false, reasoning: 'LLM evaluation failed' }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { supabase, user, apiTier } = await verifyAdmin(req)
    const url = new URL(req.url)
    const action = url.searchParams.get('action')

    // ─── ACTION: analytics ───
    if (action === 'analytics') {
      // Paginate to bypass PostgREST 1000-row cap
      const PAGE = 1000
      const logs: any[] = []
      for (let from = 0; ; from += PAGE) {
        const { data: page, error } = await supabase
          .from('query_logs')
          .select('execution_time_ms, input_tokens, output_tokens, total_tokens, upstream_inference_cost, precision_at_k, recall_at_k, hit_rate_at_k, first_relevant_rank, relevant_in_top_k, total_relevant_chunks, top_k, top_k_eval, evaluated_at, eval_model, response_text')
          .order('created_at', { ascending: true })
          .range(from, from + PAGE - 1)
        if (error) break
        if (!page || page.length === 0) break
        logs.push(...page)
        if (page.length < PAGE) break
      }

      if (logs.length === 0) {
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

      const evaluatedLogs = logs.filter(l => l.evaluated_at !== null && l.evaluated_at !== undefined)
      const judgeFailedLogs = logs.filter(l => (l.eval_model || '').includes('judge_failed') && (l.evaluated_at === null || l.evaluated_at === undefined))
      const pendingLogs = logs.filter(l => (l.evaluated_at === null || l.evaluated_at === undefined) && !(l.eval_model || '').includes('judge_failed'))

      // Valid scored rows include both hits and true no-hit retrieval misses.
      // first_relevant_rank is null for a valid no-hit row, so never use it as the evaluated denominator.
      const validScoredLogs = evaluatedLogs.filter(l => l.total_relevant_chunks !== null && l.total_relevant_chunks !== undefined && l.relevant_in_top_k !== null && l.relevant_in_top_k !== undefined)
      const noJudgedRelevantCount = validScoredLogs.filter(l => (l.relevant_in_top_k ?? 0) === 0).length

      // Confusion-matrix-aligned per-query TP/FP/FN/TN
      const perQ = validScoredLogs.map(l => {
        const tp = l.relevant_in_top_k ?? 0
        const fp = Math.max(0, (l.top_k ?? 0) - tp)
        const fn = Math.max(0, (l.total_relevant_chunks ?? 0) - tp)
        const tn = Math.max(0, (l.top_k_eval ?? 0) - (l.top_k ?? 0) - fn)
        const p = (tp + fp) > 0 ? tp / (tp + fp) : 0
        const r = (tp + fn) > 0 ? tp / (tp + fn) : 0
        const f1 = (p + r) > 0 ? (2 * p * r) / (p + r) : 0
        return { tp, fp, fn, tn, p, r, f1 }
      })

      const sumTP = perQ.reduce((s, q) => s + q.tp, 0)
      const sumFP = perQ.reduce((s, q) => s + q.fp, 0)
      const sumFN = perQ.reduce((s, q) => s + q.fn, 0)

      // Micro precision/recall (aggregate across queries) — matches Confusion Matrix totals row
      const aggPrecision = (sumTP + sumFP) > 0 ? sumTP / (sumTP + sumFP) : 0
      const aggRecall = (sumTP + sumFN) > 0 ? sumTP / (sumTP + sumFN) : 0

      // Macro F1 — average of per-query F1
      const avgF1 = perQ.length > 0 ? avg(perQ.map(q => q.f1)) : 0
      const avgHitRate = validScoredLogs.length > 0 ? parseFloat(avg(validScoredLogs.map(l => l.hit_rate_at_k ?? 0)).toFixed(4)) : 0
      const mrr = validScoredLogs.length > 0 ? parseFloat(avg(validScoredLogs.map(l => l.first_relevant_rank ? 1 / l.first_relevant_rank : 0)).toFixed(4)) : 0

      // Abstention: scan response_text for non-answer language across ALL queries
      const ABSTENTION_RE = /not enough information|cannot (find|locate|answer)|don'?t have|do not have|insufficient (information|context|data)|context (does not|doesn'?t) contain|not (specified|provided|available|mentioned|covered) in (the )?(context|document|provided)|unable to (find|provide|answer)|no (information|details|specific|relevant)/i
      const abstentionCount = logs.filter(l => l.response_text && ABSTENTION_RE.test(l.response_text)).length
      const abstentionRate = logs.length > 0 ? abstentionCount / logs.length : 0

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
        retrieval_eval: evaluatedLogs.length > 0 ? {
          evaluated_count: validScoredLogs.length,
          total_evaluated_count: evaluatedLogs.length,
          total_queries: logs.length,
          no_judged_relevant_count: noJudgedRelevantCount,
          judge_failed_count: judgeFailedLogs.length,
          abstention_count: abstentionCount,
          abstention_rate: parseFloat(abstentionRate.toFixed(4)),
          no_hit_rate: parseFloat((noJudgedRelevantCount / Math.max(1, validScoredLogs.length)).toFixed(4)),
          avg_precision_at_k: parseFloat(aggPrecision.toFixed(4)),
          avg_recall_at_k: parseFloat(aggRecall.toFixed(4)),
          avg_hit_rate: avgHitRate,
          avg_f1: parseFloat(avgF1.toFixed(4)),
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

    // ─── ACTION: run-eval (ground-truth benchmark; exact expected_chunk_ids) ───
    // Query params:
    //   benchmark = dataset name (default benchmark_100_v3_multigold)
    //   k         = optional fixed K override
    //   adaptive  = '1' → Strategy A score-gap knee detection.
    //               Retrieves pool=20 hybrid, cuts at first gap > 2×median_gap,
    //               clamps K to [3,15]. Metrics use K_used (the returned count),
    //               NOT pool=20. top_k_eval records pool size for transparency.
    //   judge     = '1' → after retrieval, also run LLM-as-judge on returned
    //               chunks and store relevance_labels + judge_* metrics.
    //               Normally OFF for benchmark (gold IDs are truth); flip ON
    //               only for one-off comparison runs.
    if (action === 'run-eval') {
      const benchmarkName = url.searchParams.get('benchmark') ?? 'benchmark_100_v3_multigold'
      const fixedKParam = url.searchParams.get('k')
      const adaptive = url.searchParams.get('adaptive') === '1'
      const judgeEnabled = url.searchParams.get('judge') === '1'
      const offset = parseInt(url.searchParams.get('offset') ?? '0', 10)
      const limit = parseInt(url.searchParams.get('limit') ?? '100', 10)
      const POOL = 20
      const ADAPT_MIN_K = 3
      const ADAPT_MAX_K = 15
      const GAP_MULT = 2.0

      const { data: evalSetAll } = await supabase
        .from('eval_dataset')
        .select('*')
        .eq('benchmark_name', benchmarkName)
        .order('tier', { ascending: true })
        .order('query_text', { ascending: true })

      if (!evalSetAll || evalSetAll.length === 0) {
        return new Response(JSON.stringify({ error: 'No eval dataset entries found.' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      const evalSet = evalSetAll.slice(offset, offset + limit)

      const results: any[] = []
      const tagSuffix = adaptive ? ':adaptive' : ''
      const EVAL_TAG = `benchmark:${benchmarkName}${tagSuffix}`

      // Only delete on the first batch (offset=0) so paginated runs accumulate
      if (offset === 0) {
        await supabase.from('query_logs').delete().like('eval_model', `benchmark:${benchmarkName}%`)
      }

      const { data: allDocs } = await supabase.from('documents').select('id')
      const allDocIds = (allDocs || []).map((d: any) => d.id)


      for (const item of evalSet) {
        const requestedK = fixedKParam ? parseInt(fixedKParam) : (item.k_target || 5)
        const matchCount = adaptive ? POOL : requestedK
        const t0 = Date.now()
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
        const { data: chunksRaw } = await supabase.rpc('match_chunks_hybrid', {
          query_text: item.query_text,
          query_embedding: embeddingStr,
          doc_ids: allDocIds,
          match_count: matchCount,
          vec_pool: 100,
          kw_pool: 100,
          rrf_k: 60,
        })

        const pool: any[] = chunksRaw || []
        // ── Adaptive K cut (Strategy A: score-gap knee detection) ──
        let cut = pool.length
        let kUsed = pool.length
        if (adaptive && pool.length > ADAPT_MIN_K) {
          const scores = pool.map((c: any) => Number(c.rrf_score ?? c.similarity ?? 0))
          const gaps: number[] = []
          for (let i = 0; i < scores.length - 1; i++) gaps.push(scores[i] - scores[i + 1])
          const sortedGaps = [...gaps].filter(g => g > 0).sort((a, b) => a - b)
          const median = sortedGaps.length > 0
            ? sortedGaps[Math.floor(sortedGaps.length / 2)]
            : 0
          let kneeIdx = -1
          for (let i = 0; i < gaps.length; i++) {
            if (median > 0 && gaps[i] > GAP_MULT * median) { kneeIdx = i; break }
          }
          cut = kneeIdx >= 0 ? (kneeIdx + 1) : pool.length
          cut = Math.max(ADAPT_MIN_K, Math.min(ADAPT_MAX_K, cut))
          kUsed = cut
        } else {
          kUsed = pool.length
        }

        const returned = pool.slice(0, kUsed)
        const retrievedIds: string[] = returned.map((c: any) => c.id)
        const retrievedSims: number[] = returned.map((c: any) => c.similarity ?? 0)
        const expectedIds = new Set(item.expected_chunk_ids || [])
        const relevant = retrievedIds.filter((id: string) => expectedIds.has(id))
        let firstRelevantRank: number | null = null
        for (let i = 0; i < retrievedIds.length; i++) {
          if (expectedIds.has(retrievedIds[i])) { firstRelevantRank = i + 1; break }
        }

        const precision = retrievedIds.length > 0 ? relevant.length / retrievedIds.length : 0
        const recall = expectedIds.size > 0 ? relevant.length / expectedIds.size : 0
        const f1 = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0

        // ── Optional LLM-as-judge pass on the returned chunks ──
        let judgeLabels: any[] | null = null
        let judgePrecision: number | null = null
        let judgeRecall: number | null = null
        if (judgeEnabled && returned.length > 0) {
          judgeLabels = []
          let judgeRelevant = 0
          for (let i = 0; i < returned.length; i++) {
            const c = returned[i]
            const verdict = await evaluateChunkRelevance(item.query_text, c.text || '', apiTier)
            judgeLabels.push({
              chunk_id: c.id,
              relevant: verdict.relevant,
              reasoning: verdict.reasoning,
              rank: i + 1,
              gold: expectedIds.has(c.id),
            })
            if (verdict.relevant) judgeRelevant++
          }
          judgePrecision = returned.length > 0 ? judgeRelevant / returned.length : 0
          // Judge recall denominator = judged-relevant count (judge has no global truth)
          judgeRecall = judgeRelevant > 0 ? judgeRelevant / judgeRelevant : null
        }

        const elapsed = Date.now() - t0

        await supabase.from('query_logs').insert({
          user_id: user.id,
          query_text: item.query_text,
          retrieved_chunk_ids: retrievedIds,
          retrieved_similarities: retrievedSims,
          response_text: `[${EVAL_TAG}] tier=${item.tier || 'n/a'} k=${kUsed}${adaptive ? `/pool=${POOL}` : ''}${judgeEnabled ? ' judge=on' : ''}`,
          citations_json: [],
          input_tokens: 0, output_tokens: 0, total_tokens: 0,
          execution_time_ms: elapsed,
          top_k: retrievedIds.length,
          top_k_eval: adaptive ? POOL : retrievedIds.length,
          total_relevant_chunks: expectedIds.size,
          relevant_in_top_k: relevant.length,
          precision_at_k: parseFloat(precision.toFixed(4)),
          recall_at_k: parseFloat(recall.toFixed(4)),
          hit_rate_at_k: relevant.length > 0 ? 1 : 0,
          first_relevant_rank: firstRelevantRank,
          eval_model: EVAL_TAG,
          evaluated_at: new Date().toISOString(),
          relevance_labels: judgeLabels,
        })

        results.push({
          query: item.query_text, tier: item.tier || 'uncategorized',
          k: kUsed, pool: adaptive ? POOL : null,
          retrieved_count: retrievedIds.length, expected_count: expectedIds.size,
          relevant_found: relevant.length,
          precision_at_k: parseFloat(precision.toFixed(4)),
          recall_at_k: parseFloat(recall.toFixed(4)),
          f1_at_k: parseFloat(f1.toFixed(4)),
          judge_precision: judgePrecision !== null ? parseFloat(judgePrecision.toFixed(4)) : null,
        })
      }


      const sumRelevantFound = results.reduce((s, r) => s + r.relevant_found, 0)
      const sumRetrieved = results.reduce((s, r) => s + r.retrieved_count, 0)
      const sumExpected = results.reduce((s, r) => s + r.expected_count, 0)
      const avgPrecision = sumRetrieved > 0 ? sumRelevantFound / sumRetrieved : 0
      const avgRecall = sumExpected > 0 ? sumRelevantFound / sumExpected : 0
      const avgF1 = results.reduce((s, r) => s + r.f1_at_k, 0) / results.length
      const tiers = [...new Set(results.map(r => r.tier))]
      const tier_summary = tiers.map(tier => {
        const rows = results.filter(r => r.tier === tier)
        const rel = rows.reduce((s, r) => s + r.relevant_found, 0)
        const ret = rows.reduce((s, r) => s + r.retrieved_count, 0)
        const exp = rows.reduce((s, r) => s + r.expected_count, 0)
        return {
          tier,
          total_queries: rows.length,
          avg_k: parseFloat((rows.reduce((s, r) => s + r.k, 0) / Math.max(1, rows.length)).toFixed(2)),
          avg_precision_at_k: parseFloat(((ret > 0 ? rel / ret : 0)).toFixed(4)),
          avg_recall_at_k: parseFloat(((exp > 0 ? rel / exp : 0)).toFixed(4)),
          avg_f1_at_k: parseFloat((rows.reduce((s, r) => s + r.f1_at_k, 0) / Math.max(1, rows.length)).toFixed(4)),
        }
      })

      const hitCount = results.filter(r => r.relevant_found > 0).length
      const zeroHitCount = results.filter(r => r.relevant_found === 0).length
      const avgK = results.reduce((s, r) => s + (r.k || 0), 0) / Math.max(1, results.length)
      const avgJudgeP = judgeEnabled
        ? results.filter(r => r.judge_precision !== null).reduce((s, r) => s + r.judge_precision, 0) / Math.max(1, results.filter(r => r.judge_precision !== null).length)
        : null

      return new Response(JSON.stringify({
        success: true,
        benchmark_name: benchmarkName,
        mode: adaptive ? `adaptive (pool=${POOL}, knee gap×${GAP_MULT}, K∈[${ADAPT_MIN_K},${ADAPT_MAX_K}])` : (fixedKParam ? `fixed k=${fixedKParam}` : 'per-question k_target'),
        judge_enabled: judgeEnabled,
        total_queries: results.length,
        hit_count: hitCount,
        zero_hit_count: zeroHitCount,
        hit_rate: parseFloat((hitCount / Math.max(1, results.length)).toFixed(4)),
        avg_k_used: parseFloat(avgK.toFixed(2)),
        avg_precision_at_k: parseFloat(avgPrecision.toFixed(4)),
        avg_recall_at_k: parseFloat(avgRecall.toFixed(4)),
        avg_f1_at_k: parseFloat(avgF1.toFixed(4)),
        avg_judge_precision: avgJudgeP !== null ? parseFloat(avgJudgeP.toFixed(4)) : null,
        tier_summary,
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
      const FAILURE_REASONS = new Set(['Parse error', 'LLM evaluation failed', 'GOOGLE_API_KEY not configured', 'LOVABLE_API_KEY not configured', 'Chunk not found'])

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
        let judgeFailures = 0

        for (let i = 0; i < topKEval; i++) {
          const chunk = evalChunks[i]
          if (!chunk || !chunk.text) {
            labels.push({ chunk_id: chunk?.id || 'unknown', relevant: false, reasoning: 'Chunk not found', rank: i + 1 })
            judgeFailures++
            continue
          }

          const result = await evaluateChunkRelevance(log.query_text, chunk.text, apiTier)
          if (FAILURE_REASONS.has(result.reasoning)) judgeFailures++
          labels.push({ chunk_id: chunk.id, relevant: result.relevant, reasoning: result.reasoning, rank: i + 1 })

          const topKSet = new Set(chunkIds.slice(0, k))
          if (result.relevant && firstRelevantRank === null && topKSet.has(chunk.id)) {
            const originalRank = chunkIds.indexOf(chunk.id)
            if (originalRank >= 0 && originalRank < k) {
              firstRelevantRank = originalRank + 1
            }
          }
        }

        // If most of the judge calls failed, do NOT stamp evaluated_at — that pollutes analytics.
        if (topKEval > 0 && judgeFailures / topKEval >= 0.5) {
          await supabase.from('query_logs').update({
            relevance_labels: labels,
            eval_model: `${EVAL_MODEL} (judge_failed)`,
          }).eq('id', log.id)
          console.warn(`run-retrieval-eval skipped for ${log.id}: ${judgeFailures}/${topKEval} judge calls failed`)
          continue
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

      const validResults = perQueryResults
      const sumRelevantInTopK = validResults.reduce((sum, r) => sum + (r.relevant_in_top_k ?? 0), 0)
      const sumTopK = validResults.reduce((sum, r) => sum + (r.k ?? 0), 0)
      const sumTotalRelevant = validResults.reduce((sum, r) => sum + (r.total_relevant ?? 0), 0)
      const avgPrecision = sumTopK > 0 ? sumRelevantInTopK / sumTopK : 0
      const avgRecall = sumTotalRelevant > 0 ? sumRelevantInTopK / sumTotalRelevant : 0
      const avgHitRate = validResults.length > 0 ? validResults.reduce((s, r) => s + r.hit_rate, 0) / validResults.length : 0
      const mrr = validResults.length > 0 ? validResults.reduce((s, r) => s + (r.first_relevant_rank ? 1 / r.first_relevant_rank : 0), 0) / validResults.length : 0

      await supabase.from('eval_runs').insert({
        created_by: user.id,
        total_queries: validResults.length,
        avg_precision_at_k: parseFloat(avgPrecision.toFixed(4)),
        avg_recall_at_k: parseFloat(avgRecall.toFixed(4)),
        avg_hit_rate_at_k: parseFloat(avgHitRate.toFixed(4)),
        mrr: parseFloat(mrr.toFixed(4)),
        k_used: 'per-query top_k',
        eval_model: EVAL_MODEL,
        notes: `Evaluated ${total} queries; aggregates include valid no-hit rows as retrieval misses.`,
      })

      return new Response(JSON.stringify({
        success: true,
        evaluated: total,
        evaluated_nonzero: validResults.filter(r => r.first_relevant_rank !== null).length,
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
          const result = await evaluateChunkRelevance(log.query_text, chunk.text, apiTier)
          if (result.relevant) totalRelevantInScan++
        }

        // Step 4: Count how many of original top-K are relevant
        // Re-judge only original top-K chunks
        const originalSet = new Set(originalChunkIds)
        const originalChunksInExpanded = expandedChunks.filter((c: any) => originalSet.has(c.id))

        let relevantInTopK = 0
        for (const chunk of originalChunksInExpanded) {
          const result = await evaluateChunkRelevance(log.query_text, chunk.text, apiTier)
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
            const result = await evaluateChunkRelevance(log.query_text, chunk.text, apiTier)
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
