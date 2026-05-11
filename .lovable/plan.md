## Goal

Make the saved benchmark runner exercise the Layer 1 hybrid retrieval path (BM25 ∪ vector + RRF) so the next run produces an apples-to-apples comparison vs Run B. No benchmark execution in this step — just wire the change.

## What's wrong today

`/tmp/run_bench.py` POSTs `{"question": ...}` with no `project_id`. In `supabase/functions/rag-query/index.ts` (line 475), the hybrid RPC only fires when `requestProjectId && projectDocIdArray.length > 0` is true. Without `project_id`, the function falls through to the global `match_chunks` RPC — so Run C never touched the new hybrid code.

The "test - paid API" project (`9ff90211-ff02-4138-819a-7b60e88884aa`) already contains all 21 documents the benchmark questions reference (Hyundai-complete.pdf, CATL-complete.pdf, etc.).

## Changes

1. **Patch `/tmp/run_bench.py`** — single-line change to the request body:
   ```python
   body = json.dumps({
       "question": q["question"],
       "project_id": "9ff90211-ff02-4138-819a-7b60e88884aa"
   }).encode()
   ```
   Same change to `/tmp/retry2.py` and `/tmp/retry_serial.py` so re-runs stay consistent.

2. **Persist the runner durably.** Copy the patched scripts to `/mnt/documents/scripts/` (`run_bench.py`, `retry2.py`, `score3.py`) so they survive sandbox resets and tomorrow's session can run them without rebuilding.

3. **Save a memory** at `mem://infra/sandbox-benchmark-auth` (referenced from the index but missing) capturing:
   - Benchmark project id `9ff90211-...`
   - Bypass header contract (`Bearer <bench_secrets.service_role>` + `x-benchmark-user-id`)
   - Script locations under `/mnt/documents/scripts/`
   - Saved question set: `/mnt/documents/benchmark_100_v3.json`

4. **No benchmark run, no edge function deploys, no DB migrations.** Strictly wiring + documentation.

## Out of scope (next loop, on your say-so)

- Running the patched benchmark to produce Run D and comparing to Run B.
- Tuning hybrid knobs (`vec_pool`, `kw_pool`, `rrf_k`) if Run D underperforms.
- Layers 2–5 from `.lovable/plan.md`.

## Validation

- Diff the three scripts to confirm only the body payload changed.
- `cat /mnt/documents/scripts/run_bench.py | grep project_id` returns the new line.
- Memory file readable via `code--view mem://infra/sandbox-benchmark-auth`.
