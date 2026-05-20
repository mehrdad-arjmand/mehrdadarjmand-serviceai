## Diagnosis

The high “abstention” number in the analytics UI is not the same metric as the benchmark F1 report.

### What happened

1. **The 400-run ablation was intentionally forced to fixed K=5**
   - The benchmark runner sent `x-bench-fixed-k: 5` for all four configs.
   - That bypassed the adaptive K policy so the four configs could be compared apples-to-apples against May 6.
   - In the 400 ablation logs:
     - Hybrid-only and hybrid+rerank: **100/100 rows each at K=5**.
     - Vector-only and rerank-only: mostly K=5, but a few K=0/1/2/3 because fewer than five chunks survived retrieval/filtering.

2. **Production adaptive K was not removed**
   - Normal non-benchmark requests still use adaptive K:
     - default/fallback: K=5
     - enumerate: K=8
     - synthesis: K=8
     - lookup currently often lands at K=4 because of the minimum-K floor
   - Older K=20 rows are from the earlier policy before enumerate was capped down to 8.

3. **The F1 table I reported was not computed from the UI’s `precision_at_k` / `recall_at_k` fields**
   - It was computed by `score_ablation.py` using:
     - the 400 stored `query_log_id`s,
     - each row’s `retrieved_chunk_ids`,
     - the multigold benchmark labels in `benchmark_100_v3_multigold.json`.
   - So the reported ablation F1/Hit/P/R is exact-label benchmark scoring, not the background LLM judge scoring shown in analytics.

4. **The analytics “abstention” field is misleading / effectively wrong for this benchmark**
   - The UI currently calls a row an “abstention” if `first_relevant_rank` is null.
   - That really means “the background LLM relevance judge did not mark any retrieved chunk relevant,” not “the assistant abstained from answering.”
   - For the ablation rows, the background judge appears to have failed or rate-limited badly: for hybrid-only, it marked obvious answered/cited rows as `total_relevant_chunks = 0`.
   - Example checked from the hybrid-only run: the answer correctly returned the CATL address with citations, but the DB-side LLM judge recorded zero relevant chunks.

5. **The 400 ablation rows are currently scored in the database, but many look unscored because the key fields are null/zero**
   - Current check against the 400 ablation IDs: **400/400 have `evaluated_at` set**.
   - But **374/400 have `first_relevant_rank` null**, so the UI treats them as abstentions/no relevant result.
   - That is a background-evaluator/reporting problem, not proof that the benchmark F1 calculation was missing rows.

### Why answer abstention is still a real concern

A separate text scan of the 400 response bodies found about **126/400 possible answer-abstention phrases**. By config:

| Config | Possible answer abstentions |
|---|---:|
| Vector-only | 38/100 |
| Hybrid-only | 28/100 |
| Rerank-only | 33/100 |
| Hybrid+rerank | 27/100 |

So the answer-abstention issue is real, but it is closer to the high-20s / low-30s in the ablation outputs, not the UI’s inflated retrieval-abstention number.

## Plan to clean this up

1. **Separate the metrics in analytics**
   - Rename the current UI “Abstention” concept to something like “No judged relevant chunk.”
   - Add separate counts for:
     - unscored rows,
     - zero-hit rows,
     - true answer abstentions,
     - benchmark exact-label scores.

2. **Stop using the background LLM judge as the source of truth for benchmark runs**
   - For known benchmark datasets, score by exact `expected_chunk_ids` / multigold labels only.
   - Keep LLM judging only for ad-hoc production queries where no gold label exists.

3. **Fix the background evaluator failure mode**
   - Do not write `evaluated_at` with all-false labels when judge calls fail or rate-limit.
   - Track judge failures distinctly so failed evaluation is not confused with “retrieval found nothing relevant.”

4. **Publish a corrected benchmark table**
   - Include the four ablation configs with exact-label F1/Hit/P/R.
   - Add answer-abstention counts from the response text.
   - Add K distribution per config so the “fixed K=5 but some rows <5” behavior is explicit.

5. **Optional follow-up benchmark**
   - If we want true zero-abstention validation, rerun hybrid-only with a stricter answer prompt that says every benchmark question is answerable and should not abstain unless no cited source is present.