# Diagnose the apparent regression before reverting

## TL;DR

The May 6 baseline (Hit@5 = 0.92, F1 = 0.585) was scored at **fixed K=5**. Today's Run C (Hit@K = 0.56, F1 = 0.21) was scored at the **per-tier post-rerank top-K** stored in `query_logs` (3 / 8 / 20 / per-tier). These are not comparable — precision in particular collapses when K grows from 5 to 20, dragging F1 down even with identical retrieval.

On top of that, the runner did not pass `project_id`, so the hybrid path (`match_chunks_hybrid`) never fired and the request fell through to vector-only `match_chunks`. That is a real, but separate, retrieval issue.

**No revert is needed yet.** First we re-score Run C at fixed K=5 to see how much of the gap is measurement vs. real regression. Then we decide.

## What we know

May 6 baseline (`bench100_4tier_metrics_20260501.json`, n=100, K=5):
- Overall: P@5 = 0.46, R@5 = 0.805, **F1 = 0.585, Hit@5 = 0.92**
- Tiers (easy/medium/hard/edge): F1 = 0.596 / 0.660 / 0.558 / 0.522

Run C today (n=99, scored at per-query top_k = 3/8/20):
- Overall: **F1 = 0.214, Hit@K = 0.556**
- Tiers (lookup/synthesis/enumerate/edge): F1 = 0.281 / 0.188 / 0.117 / 0.247

Two confounders stacked:
1. **K mismatch** — denominator changed from 5 to up to 20. Precision is bounded by relevant_count/K, so larger K mechanically lowers P and F1.
2. **Hybrid path silent fallback** — runner sent no `project_id`, so server used global vector-only retrieval. Real, but smaller, effect.

## Plan (no benchmark rerun, no code edits in app)

### Step 1 — Re-score Run C at fixed K=5
- Take the 99 stored `query_logs` rows for the Run C question set.
- Score against the same gold `source_chunk_id` set used May 6, **truncating retrieved chunks to the first 5** (matching May 6 methodology exactly).
- Produce overall + per-tier Hit@5 / P@5 / R@5 / F1@5.
- Write `/mnt/documents/bench_run_C_rescored_at5.json`.

### Step 2 — Side-by-side comparison
Build a single table: tier × {May 6, Run C @ per-tier-K, Run C @ K=5}.
This isolates how much of the drop is the K change vs. a real regression.

### Step 3 — Decide
- **If Run C @ K=5 is within ~3 pp of May 6** → no regression. The "drop" was a scoring change. We proceed with tomorrow's patched Run D (with `project_id`) and report against May 6 normally. **No revert.**
- **If Run C @ K=5 is materially below May 6 (>5 pp Hit or >0.05 F1)** → real regression. Next loop: bisect commits since May 6 affecting ingestion/embeddings/`rag-query` retrieval, and quantify how much hybrid-vs-vector accounts for. Revert is a last resort, only if bisect points at an unfixable change.

### Step 4 — Tomorrow
Independent of the above, run patched Run D (`project_id` wired) and score at fixed K=5 so it is directly comparable to May 6.

## Out of scope
- No edits to `rag-query`, no migrations, no edge function deploys.
- No new benchmark execution this loop — only re-scoring stored Run C results.
- No revert until Step 3 says so.

## Technical notes
- Re-score script: copy of `/mnt/documents/scripts/score3.py` with `K_BY_TIER` replaced by constant `5` and the `retrieved[:K]` slice forced to 5. Save as `/mnt/documents/scripts/score_at5.py`.
- Gold set: `eval_dataset.expected_chunk_ids` joined by `query_text`, same as May 6.
- Output JSON shape mirrors `bench100_4tier_metrics_20260501.json` for direct diffing.
