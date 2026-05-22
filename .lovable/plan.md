## Scope
Repair the benchmark to exactly **100 questions, same tier composition**, using only docs that still exist in the repository:
- `Hyundai-complete.pdf` (940 chunks)
- `CATL-complete.pdf` (218 chunks)
- `LG-complete.pdf` (135 chunks)
- `model-year-2024-vehicles.pdf` (134 chunks)

## Tier accounting

| Tier | Target | Keep (existing, repairable) | New to author |
|---|---|---|---|
| lookup | 25 | 15 | **10** |
| edge | 25 | 16 | **9** |
| enumerate | 25 | 15 | **10** |
| synthesis | 25 | 19 | **6** |
| **Total** | **100** | **65** | **35** |

Tier definitions stay as previously discussed: lookup = single fact (k_target=4), edge = exception/edge-case lookup (k_target=4), enumerate = "list all X" (k_target=8), synthesis = multi-source reasoning (k_target=8).

## Execution steps

### Step 1 — Author 35 new questions
Pull representative chunks from the 4 surviving docs (weighted by chunk count: ~22 Hyundai, ~6 CATL, ~4 LG, ~3 model-year-2024). For each new question, the LLM author script will produce:
- `query_text` (natural question)
- `tier` (one of the 4)
- `k_target` (4 or 8 by tier rule)
- `answer_hint` (the literal answer string as it appears in the document — this is what powers gold-chunk lookup)
- `source_doc` (filename)

Authoring uses `google/gemini-2.5-flash` via Lovable AI Gateway with a strict prompt: hint must be a verbatim substring of a real chunk, no paraphrasing.

### Step 2 — Re-map gold chunk IDs for all 100
A single SQL pass on `eval_dataset` rows where `benchmark_name='benchmark_100_v3_multigold'`:
- For each row, find chunks of `documents.filename = source_doc` whose `text ILIKE '%<answer_hint>%'`.
- Take the top 3 shortest matching chunks (shortest = most precise) and overwrite `expected_chunk_ids`.
- Rows for which zero matches are found get reported (none expected since hints are verbatim, but I'll flag any).

### Step 3 — Delete the 35 orphaned rows, insert the 35 new ones
- Delete the 35 questions whose `source_doc` is one of the 4 missing PDFs.
- Insert the 35 newly authored rows with freshly mapped gold IDs.
- Final count verified at exactly 100, distributed 25/25/25/25.

### Step 4 — Purge prior benchmark rows from `query_logs`
Per standing rule (plan.md item 4): delete every `query_logs` row tagged as benchmark (`eval_model` matches `benchmark%` or response marker present). Keeps analytics clean.

### Step 5 — Deploy & run
- No edge-function code change needed (`run-eval` already reads `k_target` from the row).
- Hit `POST /functions/v1/run-eval?action=run-eval&judge=1&limit=100` from the sandbox using the `bench_secrets` service-role key + `x-benchmark-user-id` header.

### Step 6 — Report
- Overall hit rate, P@K, R@K, F1@K, judge precision
- Per-tier breakdown
- Side-by-side vs the last run (the 3/100 hit-rate baseline) so the gold-repair impact is visible

## Guardrails
- Will NOT touch any of the 4 surviving source PDFs or their chunks.
- Will NOT change `run-eval` logic, K rules, judge model, or retrieval pipeline.
- Will NOT inflate scope beyond the 100-question dataset.
- Every new question's `answer_hint` will be verified as a verbatim substring of at least one current chunk before insert — questions failing that check get re-generated, not silently weakened.

Reply "approved" to proceed.
