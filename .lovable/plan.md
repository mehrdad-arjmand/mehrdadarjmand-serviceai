

## Root Cause Analysis — Three Distinct Bugs

### Evidence from logs (live, right now)

The `generate-embeddings` logs show this repeating pattern for Hyundai-complete.pdf (doc `dce3bfbc`):

```text
1. Rate limited after 1 attempt(s), returning rate-limited status
2. Document dce3bfbc: hit rate limit (555/940 embedded, consecutive=1), backoff 1x, retry after 60000ms
3. Free-tier slice: 555/940 chunks ... (processed 0 this call)
   ... ~20 seconds later ...
4. Rate limited after 1 attempt(s), returning rate-limited status
5. Document dce3bfbc: 30 consecutive rate-limit failures — marking as failed
   ... ~10 seconds later ...
6. Back to step 1 — cycle repeats
```

This loop has been running continuously. Here are the three bugs causing it:

---

### Bug 1: Consecutive failure counter always resets to 1

**Location:** `generate-embeddings/index.ts`, lines 177 and 220-237

When the function acquires the lock (line 177), it does:
```typescript
.update({ embedding_locked_until: lockUntil, embedding_retry_after: null })
```

It **clears `embedding_retry_after`** before attempting the embed. Then, when a 429 occurs, the consecutive failure detection (line 221) checks:
```typescript
if (docMeta.embedding_retry_after) { // <-- always null because we just cleared it!
```

Since it was just cleared, `consecutiveFailures` always equals 1. The exponential backoff (`backoff 1x`) never escalates. Every single call waits only 60 seconds regardless of how many times it has failed.

### Bug 2: Circuit breaker triggers via wrong heuristic, then gets immediately overridden

The circuit breaker at line 241 checks `consecutiveFailures >= 15`. Since the counter is always 1 (Bug 1), the circuit breaker should never fire. But it does fire — with `consecutive=30` — because of the fallback heuristic at line 236:
```typescript
consecutiveFailures = Math.max(2, Math.floor(Math.min(docAgeMs, 30 * 60_000) / 60_000))
```

This estimates failures from the **document age**, not actual failure count. For a document uploaded hours ago, it computes 30 and immediately trips the breaker. So the document oscillates between "1 consecutive failure" (backoff 1x = 60s) and "30 consecutive failures" (instant fail) on alternating calls.

### Bug 3: Client poller auto-retries `failed` documents every 10 seconds

**Location:** `RepositoryCard.tsx`, lines 900-912

The background polling loop runs every 10 seconds and picks up documents for retry:
```typescript
const freeQueueDoc = [...docs]
  .filter((doc) => (
    doc.ingestionStatus === 'failed'  // <-- failed docs get auto-retried!
  ))
```

When a document is marked `failed` by the circuit breaker (Bug 2), the poller immediately calls `triggerEmbeddingRecovery`, which:
- Sets `ingestion_status = 'processing_embeddings'` and clears `ingestion_error`
- Calls `generate-embeddings` again
- That call gets 429 (API still exhausted)
- Backend marks it failed again
- Poller picks it up 10 seconds later → infinite loop

### Why 429s happen even after API limits reset

The Gemini Embedding API free tier has a **1,000 Requests Per Day (RPD)** rolling window. Processing 11+ documents with 15-chunk batches can consume 500+ requests. Even after "a few hours," the RPD hasn't fully rolled over (it's a 24-hour window). The RPM chart showing 0/100 only shows per-minute usage, not the daily quota.

---

## Fix Plan

### Change 1: Add persistent failure counter (database migration)

Add an `embedding_failure_count` integer column to `documents`. This replaces the broken heuristic that tries to infer consecutive failures from stale timestamps.

```sql
ALTER TABLE public.documents
ADD COLUMN IF NOT EXISTS embedding_failure_count integer DEFAULT 0;
```

### Change 2: Fix the backend consecutive failure tracking (`generate-embeddings/index.ts`)

- **Stop clearing `embedding_retry_after` on lock acquisition.** Instead, only clear it after a successful embed.
- **Use the new `embedding_failure_count` column** instead of the broken timestamp heuristic.
- On 429: increment `embedding_failure_count`, compute backoff from it.
- On success: reset `embedding_failure_count` to 0.
- Circuit breaker: after 10 consecutive failures, mark as `failed` and stop.

### Change 3: Stop auto-retrying `failed` documents from the client poller (`RepositoryCard.tsx`)

Remove `ingestionStatus === 'failed'` from the free-tier background queue filter (line 906). A `failed` document should only be retried via the manual "Reprocess" button. This is the single most important change — it breaks the infinite loop.

### Change 4: Reprocess clears the failure counter

When the user clicks "Reprocess," reset `embedding_failure_count` to 0 and clear `embedding_retry_after` so the document starts fresh.

---

### What is different from previous attempts

| Previous approach | Why it failed | This fix |
|---|---|---|
| Estimated consecutive failures from timestamps | `embedding_retry_after` gets cleared before the check, so count is always 1 | Persistent integer counter in DB |
| Exponential backoff on retry_after | Backoff never escalated because counter was always 1 | Counter survives across invocations |
| Circuit breaker after 15 failures | Fired via doc-age heuristic (wrong), then client immediately retried | Circuit breaker uses real counter + client stops retrying failed docs |
| 30s client buffer (`FREE_RATE_LIMIT_EXTRA_WAIT_MS`) | Client poller bypasses this via `triggerEmbeddingRecovery` for failed docs | Failed docs are excluded from auto-retry entirely |

### Testing plan

1. Upload 21 documents on free tier
2. Verify all appear immediately in the list
3. Watch the first 11 process serially to completion
4. When the 12th (large) document hits rate limits, verify:
   - Failure count increments (1, 2, 3...) in logs
   - Backoff escalates (60s, 120s, 240s...)
   - After 10 failures, document shows as "Failed" and **stays** failed
   - No infinite retry loop in console logs
5. Click "Reprocess" after waiting for API reset
6. Verify it resumes from chunk 555 (not from 0) and completes

### Files to change

- New migration: add `embedding_failure_count` column
- `supabase/functions/generate-embeddings/index.ts`: use persistent counter, stop clearing retry_after on lock
- `src/components/RepositoryCard.tsx`: remove `failed` from auto-retry filter, reset counter on Reprocess
- Paid tier: untouched

