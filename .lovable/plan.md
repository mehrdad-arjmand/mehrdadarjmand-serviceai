You’re right: the benchmark runner drifted away from the original policy. It currently deletes only the exact `eval_model` tag it is about to run, so older benchmark variants remain in `query_logs` and get mixed into the global Query Analytics / confusion matrix.

Current database check:

| Scope | Rows | Accuracy | Precision | Recall | Hit rate |
|---|---:|---:|---:|---:|---:|
| Non-benchmark production/ad-hoc rows only | 278 | 86.6% | 22.3% | 40.1% | 49.6% |
| Benchmark rows only | 304 | 31.5% | 16.0% | 77.3% | 90.5% |
| All scored rows mixed together | 582 | 78.1% | 18.9% | 51.3% | 71.0% |

Why the confusion matrix went down: benchmark rows have high recall/hit rate, but their confusion-matrix accuracy is low because `top_k_eval` is often equal to `top_k`, which creates almost no true negatives. When those rows are mixed into the global confusion matrix, they can lower accuracy even while increasing hit rate/recall. That is a metric-definition problem plus a data-scope problem, not a real retrieval regression.

Plan:

1. Restore benchmark replacement behavior
   - In `run-eval`, when `action=run-eval` and `offset=0`, delete/clear all previous rows for the same benchmark family, not just the exact current `eval_model` string.
   - Match rows via the benchmark marker in `response_text` and legacy `eval_model` values like:
     - `benchmark`
     - `benchmark:<name>`
     - `benchmark:<name>:judge`
     - `benchmark:<name>:adaptive`
   - Keep only the most recent benchmark run as the benchmark truth.

2. Keep `eval_model` semantics simple
   - Default benchmark run: `eval_model = benchmark`.
   - Explicit LLM-judge run: `eval_model = google/gemini-2.5-flash`.
   - Keep `judge_used` in CSV as an additional boolean helper, but do not rely on it as the primary mode label.

3. Stop benchmark rows from polluting global analytics
   - Query Analytics / confusion matrix should default to production/ad-hoc query logs only.
   - Benchmark results should appear in the benchmark section/history, not the global portfolio metrics.
   - Add filtering logic so rows marked as benchmark in `eval_model` or benchmark marker text are excluded from global cards unless explicitly viewing benchmark results.

4. Fix confusion-matrix denominator for benchmark rows
   - For benchmark exact-label scoring, report benchmark metrics as Precision@K / Recall@K / Hit@K / zero-hit / MRR.
   - Do not interpret benchmark exact-label rows as a global binary confusion matrix unless `top_k_eval` has a meaningful candidate universe. Otherwise accuracy is mathematically misleading.

5. Clean current polluted historical benchmark rows
   - Remove or mark old duplicate benchmark rows so the current global analytics stop mixing the 304 accumulated benchmark rows.
   - Preserve the latest baseline benchmark result: ~83% recall, 90% hit rate, ~22% precision.

6. Verify with SQL before reporting
   - After implementation, run the same grouped checks:
     - benchmark-only
     - non-benchmark-only
     - all-scored
   - Confirm global analytics use non-benchmark rows by default and benchmark table shows only the latest benchmark run.