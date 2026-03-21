

# Plan: Fix RAG Retrieval, Evaluation, and Context Window Issues

## Summary of Root Causes Found

After investigating the logs and code, here are the four bugs and their confirmed root causes:

### Bug 1: Context window stuck at 10 chunks (not 30 as intended)

**Root cause**: The adaptive context window code (line 647) only increases from 10 to 30 when `filterDocumentIds?.length > 0`, meaning the user must explicitly select documents in the filter dropdown. When the user says "look at the 2023 document" in natural language without using the filter, `documentIds` is `undefined` and the context stays at 10.

**Logs confirm**: `Context window: 10 chunks (limit: 10, filtered docs: 0)` — the conditional never fired.

**Fix**: Remove the conditional. Set a blanket `top_k = 20` for all queries.

### Bug 2: `top_k_eval` capped at 50 instead of reaching all document chunks (e.g., 53)

**Root cause**: The evaluation scan (`evalChunks = rankedChunks.slice(0, min(200, rankedChunks.length))`) can only evaluate chunks that were retrieved. The vector search `match_count` is 50 for non-document-filtered queries. Since the project has 6 documents and the search returns 50 chunks across all of them, it never retrieves all 53 chunks from the target document.

**Fix**: For evaluation purposes, after the LLM response is generated, fetch ALL chunks from the documents that appear in the top-K context (i.e., the documents the answer actually references). This gives the evaluator access to every chunk in those documents for a true recall calculation. Cap at 200 as before.

### Bug 3: `total_relevant_chunks` inflated (e.g., 40 when the actual relevant section is ~15 chunks)

**Root cause**: The LLM evaluator judges relevance too loosely. A query about "all-electric vehicles table rows" gets chunks from PHEV, HEV, and footnote sections marked as "relevant" because they tangentially relate to vehicle data. The evaluator prompt does not enforce strict topical precision.

**Fix**: Tighten the evaluation prompt to require the chunk to **directly answer** the query, not merely be related to the same topic. Add instruction: "A chunk is only relevant if it contains data or information that would need to be included in a complete answer. General headers, footers, TOC entries, and data from different sections/tables than the one asked about are NOT relevant."

### Bug 4: Blanket top_k should be 20

**Fix**: Change the context limit from the current conditional (10 or 30) to a flat 20.

---

## Implementation

### File 1: `supabase/functions/rag-query/index.ts`

**Change A — Blanket top_k = 20** (lines 645-651):
Replace the adaptive context window logic with:
```typescript
const contextLimit = 20
const topChunks = rankedChunks.slice(0, Math.min(rankedChunks.length, contextLimit))
```

**Change B — Exhaustive eval scan** (lines 750-756):
After generating the answer, for evaluation, fetch ALL chunks from the documents that appear in `topChunks`:
1. Collect unique `document_id` values from `topChunks`
2. Query all chunks from those documents directly from the `chunks` table (not vector search)
3. Use those as the evaluation set instead of `rankedChunks`
4. Set `top_k_eval = min(200, total fetched chunks)`
5. Store all chunk IDs in `retrieved_chunk_ids` for audit

**Change C — Stricter evaluation prompt** (lines 1096-1107):
Update `evaluateChunkRelevance` prompt to:
```
"A chunk is relevant ONLY if it contains specific data, facts, or information 
that would need to be included in a complete answer to the query. 
Chunks that are merely from the same document, same topic area, or contain 
headers/footers/TOC/footnotes are NOT relevant unless they directly contain 
answerable content. Be strict."
```

### File 2: `supabase/functions/run-eval/index.ts`

**Change D — Exhaustive eval scan for batch eval** (lines 319-351):
When evaluating, instead of using `chunkIds.slice(0, topKEval)` from the stored `retrieved_chunk_ids`, fetch all chunks from the documents referenced in the query's top-K. This mirrors the fix in rag-query.

### Files unchanged
- `src/pages/QueryAnalytics.tsx` — no changes needed, it already reads the metrics correctly
- CSV export — already includes all columns

| File | Changes |
|------|---------|
| `supabase/functions/rag-query/index.ts` | Blanket top_k=20, exhaustive doc-scoped eval scan, stricter eval prompt |
| `supabase/functions/run-eval/index.ts` | Match the exhaustive eval scan pattern |

