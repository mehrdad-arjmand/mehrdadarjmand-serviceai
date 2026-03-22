

# Plan: Fix RAG Eval Regressions, Add Confusion Matrix, Fix Mobile Voice

Three distinct issues to address.

---

## Issue 1: Revert Exhaustive Eval Scan (RAG regressions)

### What went wrong

The "exhaustive eval scan" introduced in the last change fetches ALL chunks from documents referenced in the top-K results (up to 200), then evaluates each one via LLM. This caused:

1. **Delays**: Evaluating 50-200 chunks via LLM takes minutes, explaining why eval results don't appear promptly.
2. **Incorrect retrieval**: The core retrieval (top_k=20) was not changed — it still works. But the eval scan polluted `retrieved_chunk_ids` in query_logs with ALL doc chunks instead of just the retrieved ones, making the logs misleading.
3. **Irrelevant query_log rows**: The `retrieved_chunk_ids` field now stores up to 200 chunk IDs from the exhaustive scan instead of the actual 20 retrieved chunks, creating confusion.
4. **Incorrect search results**: The actual answer generation uses the correct top 20 chunks. The Volvo search failure is likely a retrieval quality issue (similarity threshold too high or embedding mismatch), not caused by this change. Need to verify.

### Fix

**File: `supabase/functions/rag-query/index.ts`**

- **Revert eval scan to use only vector-retrieved chunks** (lines 747-782): Instead of fetching all document chunks, evaluate only the `rankedChunks` that were actually retrieved (up to 200). This was the working behavior before the exhaustive scan.
- **Store only actual retrieved chunk IDs** in `retrieved_chunk_ids`: Use the top-K chunks' IDs, not the eval set.
- **Separate `retrieved_chunk_ids` from eval chunk IDs**: Store the actual retrieval in one field, use a separate variable for eval scope.

Specifically:
```
evalChunkIds = rankedChunks (up to 200) — for evaluation
retrieved_chunk_ids in log = topChunks (top 20) — actual retrieval
```

**File: `supabase/functions/run-eval/index.ts`**

- Mirror the revert: evaluate the stored `retrieved_chunk_ids` (which are the vector-retrieved chunks), not an exhaustive doc scan.

### Why this fixes all three sub-issues
- Eval completes quickly (evaluating 20-50 chunks, not 200)
- `retrieved_chunk_ids` correctly reflects what was actually retrieved
- No spurious/irrelevant rows — the log payload is clean

---

## Issue 2: Confusion Matrix Metrics (TP, TN, FP, FN)

### Current state

The `query_logs` table already has: `top_k`, `top_k_eval`, `total_relevant_chunks`, `relevant_in_top_k`, `precision_at_k`, `recall_at_k`, `hit_rate_at_k`, `first_relevant_rank`.

### Definitions using existing data

For each query row, given:
- `top_k` = number of chunks in the retrieval window (K)
- `top_k_eval` = total chunks evaluated (the evaluation universe)
- `relevant_in_top_k` = chunks in top-K that are relevant
- `total_relevant_chunks` = total relevant chunks in the eval set

The confusion matrix:
- **TP** = `relevant_in_top_k` (retrieved AND relevant)
- **FP** = `top_k - relevant_in_top_k` (retrieved but NOT relevant)
- **FN** = `total_relevant_chunks - relevant_in_top_k` (relevant but NOT retrieved in top-K)
- **TN** = `top_k_eval - top_k - FN` = `(top_k_eval - top_k) - (total_relevant_chunks - relevant_in_top_k)` (not retrieved AND not relevant)

Derived KPIs:
- **Accuracy** = (TP + TN) / (TP + TN + FP + FN) = (TP + TN) / top_k_eval
- **Precision** = TP / (TP + FP) = relevant_in_top_k / top_k
- **Recall** = TP / (TP + FN) = relevant_in_top_k / total_relevant_chunks

### Implementation

No database changes needed — all values are computable from existing columns.

**File: `src/pages/QueryAnalytics.tsx`**

Add a new "Confusion Matrix" card in the analytics dashboard that shows:
- Per-query breakdown table with columns: Query, TP, FP, FN, TN, Accuracy, Precision, Recall
- Aggregate row at the bottom with sums and computed aggregate KPIs
- The three KPIs prominently displayed: Accuracy, Precision, Recall

**File: `supabase/functions/run-eval/index.ts`** (analytics action)

Add confusion matrix aggregates to the analytics response so the dashboard can display them without client-side recomputation from raw logs.

---

## Issue 3: Mobile Voice — Different Voice & Cut-Off

### Problem 1: Different voice on mobile

The `selectBestVoice()` function in `ttsUtils.ts` prefers Google voices first, then Microsoft. On Android Chrome, Google voices are available and get selected — but they are different (lower quality, different accent) than the voices used on desktop Chrome (which may select Microsoft neural voices or Google UK voices).

**Fix**: The voice selection already prioritizes the same patterns for both. The actual difference is that Android Chrome has a different set of available voices. We should log the selected voice on mobile and ensure we pick the best available Android voice. We'll add Android-specific preferred patterns (e.g., `en-us-x-iom-local`, `en-us-x-iol-network`) that are higher quality on Android.

### Problem 2: Mobile cuts off while talking

This is the `recognition.continuous = false` fix we implemented. With `continuous = false`, each recognition session ends after one final result. The auto-restart in `onend` should provide seamless experience, but there's a gap between sessions where the user perceives being "cut off."

**Fix**: Reduce the auto-restart delay from 100-150ms to near-zero, and ensure the `onend` restart is immediate. Also, on the `no-speech` error restart, reduce delay from 1000ms to 300ms to match desktop.

### Implementation

**File: `src/lib/ttsUtils.ts`**
- Add Android-specific voice patterns to `selectBestVoice()` to pick the highest-quality available voice on Android

**File: `src/components/TechnicianChat.tsx`**
- Reduce mobile auto-restart delay in conversation mode `onend` handler
- Reduce `no-speech` restart delay on mobile

**File: `src/components/RepositoryCard.tsx`**
- Same restart delay reduction for dictation paths

---

## Summary

| File | Changes |
|------|---------|
| `supabase/functions/rag-query/index.ts` | Revert exhaustive eval scan; eval uses rankedChunks only; fix retrieved_chunk_ids |
| `supabase/functions/run-eval/index.ts` | Revert exhaustive doc scan in batch eval; add confusion matrix to analytics response |
| `src/pages/QueryAnalytics.tsx` | Add confusion matrix card with TP/FP/FN/TN per query + aggregate Accuracy/Precision/Recall |
| `src/lib/ttsUtils.ts` | Add Android-specific voice preferences |
| `src/components/TechnicianChat.tsx` | Reduce mobile voice restart delays |
| `src/components/RepositoryCard.tsx` | Reduce mobile dictation restart delays |

