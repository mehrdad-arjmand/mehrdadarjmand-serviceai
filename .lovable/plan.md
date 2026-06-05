## What went wrong

You asked for 100 **live** questions that flow through the assistant's real query path so they appear in the **Judge** tab. I instead built them as a benchmark (`benchmark_100_v4`) with synthesized Gold labels and ran them through `run-eval`. That's why you saw both Gold and Judge columns and aggregate Precision/Recall — those only exist because I (wrongly) gave it a curated expected set.

## Gold vs Judge — quick reference

- **Gold** = `eval_dataset.expected_chunk_ids` curated up front. Only exists for benchmark runs. Enables Recall (we know the full positive set).
- **Judge** = LLM grades each retrieved chunk at query time. Works for any query (live or benchmark). No Recall (we don't know total relevant in corpus). TN can be > 0 because judge can mark retrieved chunks as not-relevant.
- A query can have both (benchmark with judge on) or Judge only (live `rag-query` call). Live queries should **never** have Gold.

## Plan

### 1. Clean up the bad benchmark
- Delete the 100 rows from `eval_dataset` where `benchmark_name = 'benchmark_100_v4'`.
- Delete the matching `query_logs` rows from that run (identified by created_at window + benchmark user id).
- Confirm `/admin/analytics` no longer lists `benchmark_100_v4`.

### 2. Re-run as live queries (Judge-only)
- Reuse the 100 question texts I already generated (same 4-tier distribution: 25 lookup, 25 edge, 25 enumerate, 25 synthesis) — no need to regenerate.
- Call `rag-query` (not `run-eval`) once per question, in small concurrent batches, with `judge=1` so the judge writes TP/FP/TN into `query_logs`.
- Auth: use the `bench_secrets` service-role key + `x-benchmark-user-id` header pattern (per the sandbox-benchmark-auth memory) so they're tagged as the bench user and don't pollute your personal Judge view.
- These rows will have **only** Judge metrics. Gold columns will be empty/N/A for them — that's correct.

### 3. Report back
A single table, Judge-only:

| Tier | n | Judge Hit Rate | Judge P@10 | Avg latency |
|---|---|---|---|---|
| lookup | 25 | … | … | … |
| edge | 25 | … | … | … |
| enumerate | 25 | … | … | … |
| synthesis | 25 | … | … | … |
| **Total** | 100 | … | … | … |

No Gold column. No Recall (not computable without ground truth). Aggregate is just the row-weighted mean of Judge metrics.

### 4. Verify in UI
Open `/admin/analytics` → Judge tab, filter to the bench user / time window, confirm 100 new rows appear and the per-row Judge TP/FP/TN sums to the retrieved K (≤10) — i.e. the confusion-matrix completeness fix from earlier still holds.

## Out of scope
- No code changes to `run-eval`, `rag-query`, or `QueryAnalytics.tsx`.
- No new dataset, no Gold labels, no benchmark row.
- No K or retrieval-pipeline tuning.

Reply "approved" to proceed.