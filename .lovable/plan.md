## Diagnosis

The problem is real, and the earlier explanation was incomplete.

Current database truth:

- Total query logs: **2,949**
- Rows with `evaluated_at`: **2,948**
- Rows with a relevant chunk in top-K: **1,770**
- Rows marked evaluated but with no relevant chunk in top-K: **1,178**
- Of those, **1,093** have `total_relevant_chunks = 0`
- Today is the smoking gun: **401 evaluated rows, 375 no relevant-in-top-K, 374 zero relevant anywhere scanned**

The main cause is not that evaluation is still running. The main cause is that the evaluator stamped failed judge calls as completed evaluations.

I found many rows where every relevance label says:

```text
LLM evaluation failed
```

Those failures were stored as `relevant: false`, then written with `evaluated_at`, which made them look like legitimate “no relevant chunk” retrieval results. That is invalid scoring.

So the 40% is polluted by evaluator failure, especially from recent runs. It is not a valid statement that 40% of queries truly have no relevant chunk.

There is also a separate benchmark-design issue: answer-text abstentions around 27–38% should not have been accepted for a zero-abstention benchmark. Those rows should be failed/rerun, not treated as acceptable benchmark questions.

## Plan

1. **Repair evaluator semantics**
   - Treat `LLM evaluation failed`, parse errors, missing API key, and non-OK judge responses as evaluator failures, not irrelevant chunks.
   - Do not set `evaluated_at` when the judge fails for a row.
   - Store diagnostic labels only, with an explicit failure marker.

2. **Clean polluted historical rows**
   - Find rows where the relevance labels are all or majority judge failures.
   - Clear their retrieval metrics and `evaluated_at` so they return to pending/failed status instead of counting as valid no-hit retrieval results.
   - Keep the raw labels for auditability unless you want them deleted.

3. **Add explicit evaluation status fields or equivalent reporting logic**
   - Distinguish:
     - Pending evaluation
     - Evaluation failed
     - Evaluation complete with relevant chunk
     - Evaluation complete with no judged relevant chunk
   - The analytics card should never collapse evaluator failures into “no relevant chunk.”

4. **Rerun benchmark scoring using exact labels for benchmark rows**
   - For benchmark datasets, use `expected_chunk_ids` as the source of truth instead of the background LLM judge.
   - This gives deterministic Hit@K / Precision@K / Recall@K / F1.
   - The LLM judge can remain for ad hoc production analytics, but not for benchmark truth.

5. **Add a zero-abstention benchmark gate**
   - For benchmark generation/runs, a query is only accepted if:
     - it has gold expected chunk IDs,
     - the expected answer exists in the corpus,
     - the assistant produces a substantive answer,
     - and it does not use non-answer language like “not enough information,” “not specified,” or “context does not contain.”
   - Any abstaining response is counted as a failed query/run candidate and must be rewritten or rerun.

6. **Publish a corrected benchmark table**
   - Include separate columns for:
     - total queries,
     - valid exact-label scored rows,
     - evaluator-failed rows,
     - real no-hit rows,
     - answer-text abstentions,
     - Hit@K / Precision@K / Recall@K / F1.
   - Explicitly mark the current 40% figure as invalid/polluted until the failed judge rows are excluded or rescored.

## Technical details

- `run-eval` currently returns `LLM evaluation failed` as `relevant: false`; this must become a failure state.
- `rag-query` was partially patched to avoid stamping failures, but historical rows already contain polluted `evaluated_at` values.
- The analytics UI should show `total_evaluated_count`, `pending_evaluation_count`, `evaluation_failed_count`, and `valid_scored_count` separately.
- Benchmark rows should be scored by joining retrieved chunk IDs against `eval_dataset.expected_chunk_ids`, not by relying on the LLM judge.

## Expected outcome

After implementation, the dashboard will stop saying that 40% of queries have no judged-relevant chunk when the judge actually failed. The benchmark report will separate retrieval failure, evaluator failure, and answer abstention, and zero-abstention will become an enforced benchmark requirement rather than an after-the-fact observation.