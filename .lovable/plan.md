## Goal

Lift F1 from ~46% toward 60–68% by replacing the fixed top-K=5 selector in `rag-query` with an adaptive K driven by a fast intent classifier, plus a confidence-threshold safety net.

## Where the change lands

Single file: `supabase/functions/rag-query/index.ts`, in the "Standard mode" branch (currently lines ~662–675) that selects `topChunks`. All retrieval/rerank logic before it stays unchanged (we already retrieve 200 candidates and rerank — plenty of headroom).

## Design

### 1. Intent classifier (new helper)

A tiny pre-pass using `google/gemini-2.5-flash-lite` via the Lovable AI gateway. ~50 ms, ~$0.0001/query.

Input: the (already-rewritten) `retrievalQuery`.
Output (JSON, via `response_format: json_object`):
```json
{ "intent": "lookup" | "synthesis" | "enumerate", "k": 3 | 8 | 20 }
```

Mapping:
- `lookup` → k=3 (single fact, value, definition)
- `synthesis` → k=8 (procedures, comparisons, "how do I…")
- `enumerate` → k=20 (lists, counts, "all X", tables)

Heuristic short-circuit before the LLM call to save latency on obvious cases:
- Regex match on `\b(list|all|every|count|how many|enumerate|each)\b` → `enumerate`/k=20 without calling the model
- Very short factual queries (≤6 tokens, contains `what is|value of|spec`) → `lookup`/k=3

Failure mode: if the classifier call errors or returns invalid JSON, fall back to current behaviour (k=5).

### 2. Confidence-threshold safety net

After picking K from the classifier, apply the existing similarity-floor logic but also a relative reranker-score floor:
- Keep chunks with `similarity ≥ 0.55` (existing floor) **and** `finalScore ≥ 0.6 × topScore`
- Floor result count at 3, cap at the classifier's K
- If everything is filtered out, keep the single best chunk (existing safety net)

This prevents the classifier from forcing 20 weak chunks into a `lookup` answer.

### 3. Telemetry

Add to `query_logs` insertion (or the existing log payload) so we can see classifier behaviour in the next benchmark:
- `intent` (string)
- `selected_k` (int)
- `chunks_returned` (int, post-threshold)
- `classifier_latency_ms` (int)

If those columns don't exist yet, log them via `console.log` only — the next benchmark script can read them from edge function logs. (No DB migration needed for the first iteration.)

## Code shape

```text
// in rag-query/index.ts, inside Standard mode branch (~line 663)

const { intent, k: targetK, classifierMs } = await classifyIntent(retrievalQuery)
const topScore = rankedChunks[0]?.finalScore ?? 0
const SIM_FLOOR = 0.55
const REL_FLOOR = 0.6 * topScore

const eligible = rankedChunks.filter(c =>
  (c.similarity ?? 0) >= SIM_FLOOR &&
  (c.finalScore ?? 0) >= REL_FLOOR
)
const pool = eligible.length > 0 ? eligible : rankedChunks.slice(0, 1)
topChunks = pool.slice(0, Math.max(3, Math.min(targetK, pool.length)))
console.log(`Adaptive: intent=${intent} k=${targetK} returned=${topChunks.length} clsMs=${classifierMs}`)
```

New helper at bottom of file:

```text
async function classifyIntent(query: string):
  Promise<{intent: string, k: number, classifierMs: number}>
```

Uses heuristic short-circuit, otherwise calls Lovable AI gateway with a 5-second timeout.

## What stays the same

- Retrieval pool (200), reranker, table-aware section window, all filters
- The `useSectionWindow` branch (table queries already get up to 50 chunks) is untouched
- Auth, RBAC, error responses

## Validation plan

1. Deploy `rag-query` only.
2. Smoke-test 3 queries (one per intent) via `curl_edge_functions` and confirm logs show the classifier picked the right k.
3. Re-run the same stratified 100-question benchmark (script already in `/tmp/run_bench.py`).
4. Compare F1, recall-by-tier, latency vs. baseline (Hit@5 85%, P@5 51%, R@5 42%, F1 46%).

Expected: F1 62–68%, with recall on edge tier jumping from ~30% → ~85%. Median latency increase: +100–200ms (mostly classifier round-trip; heuristic short-circuits cut this for ~40% of queries).

## Rollback / iteration

If results disappoint, the change is gated to a single block. Switching to Option 3 (hybrid threshold-only, no classifier) is removing the `classifyIntent` call and using a fixed k=15 with the same threshold logic — ~15 minutes.