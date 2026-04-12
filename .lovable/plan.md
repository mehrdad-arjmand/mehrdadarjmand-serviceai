
Goal: identify why free-tier documents still hit immediate 429 loops after an apparent pause, and define a fix that applies only to the free API workflow.

Do I know what the issue is?
Yes.

What I reviewed
- `src/components/RepositoryCard.tsx`
- `supabase/functions/generate-embeddings/index.ts`
- `supabase/functions/ingest/index.ts`
- live `generate-embeddings` logs
- live browser network requests
- Gemini rate-limit docs

Confirmed evidence
- The backend is still receiving free-tier embedding requests for the same failed document even after backoff/failure:
  - logs show document `c00cc69f...` climbing to 7, 8, 9 consecutive 429s, then 10 and 11, and being marked failed
  - browser network still shows new `POST /functions/v1/generate-embeddings` calls for that same document afterwards
- Those requests return HTTP 200 with:
  ```text
  complete: false
  retryAfterMs: 0
  ```
  even when the backend has just marked the document failed.
- So the loop is not just “provider quota did not reset”. The app is still actively re-sending embedding requests.

Root cause analysis
1. Client resurrects failed free-tier docs before every retry
- In `triggerEmbeddingRecovery()` the client updates the row to:
  ```ts
  ingestion_status: 'processing_embeddings',
  ingestion_error: null
  ```
  before it even knows whether the backend accepted more work.
- That means a document the backend just failed can be flipped back into “processing” by the client.

2. Backend circuit-breaker failure is invisible to the client
- In `generate-embeddings`, when consecutive 429s hit the threshold, the backend marks the row failed.
- But the function still responds with a normal success payload and `retryAfterMs: 0`.
- So the caller cannot distinguish:
  - “document failed, stop retrying”
  from
  - “document still processing, try again soon”

3. The upload monitor keeps retrying failed docs
- `monitorFreeTierDocument()` does not stop when `ingestion_status === 'failed'`.
- It can continue for up to 6 hours and keep calling `maybeResumeFreeTierDocument()` on a terminally failed doc.
- This is a separate retry path from the 10-second background poller, which explains why the loop can still happen even though failed docs were removed from the background filter.

4. FIFO logic is being fed the wrong timestamp during free-tier monitoring
- `monitorFreeTierDocument()` passes:
  ```ts
  createdAt: new Date().toISOString()
  ```
  instead of the document’s real creation/upload timestamp.
- That breaks the free-tier “oldest incomplete doc first” logic and can let the wrong document re-enter recovery.

5. “Limits reset” is being inferred incorrectly
- Right now the system behaves like “chart shows low/zero usage” means “safe to retry”.
- That is not reliable. The provider docs explicitly say rate limits are not guaranteed and actual capacity may vary.
- For this workflow, the only valid definition of “reset” is: a fresh embedding call is actually accepted and makes progress.
- So the system must stop auto-assuming reset and stop auto-retrying terminal free-tier failures.

What needs to change
1. Fix the free-tier response contract in `generate-embeddings`
- When the circuit breaker marks a doc failed, return an explicit terminal result, for example:
  ```ts
  status: 'failed'
  stopRetrying: true
  retryAfterMs: 0
  ```
- Also short-circuit early if the document is already failed, so the function does not attempt another embedding call for terminal free-tier docs.
- Paid path remains unchanged.

2. Stop pre-emptively rewriting failed docs to “processing” on the client
- In `triggerEmbeddingRecovery()` for free tier:
  - do not update `ingestion_status` to `processing_embeddings` before the backend confirms real work/progress
  - use local in-memory flags/spinners instead of mutating the database first
- Only clear error state / mark processing when the backend response says the doc is actively resumable.

3. Make free-tier monitors respect terminal failure
- In `monitorFreeTierDocument()`:
  - if `ingestion_status === 'failed'`, stop immediately
  - do not keep re-entering resume logic for failed docs
- In `maybeResumeFreeTierDocument()`:
  - immediately return if `doc.ingestionStatus === 'failed'`

4. Fix FIFO ordering bug
- Pass the document’s real `createdAt` from the database into `maybeResumeFreeTierDocument()`
- Never use `new Date().toISOString()` as a substitute for queue ordering

5. Tighten manual Reprocess for free tier
- Free-tier Reprocess should:
  - reset failure metadata
  - clear retry/lock timestamps
  - resume from remaining unembedded chunks
- It should not blindly recreate the same auto-loop conditions.
- Paid reprocess behavior stays untouched.

Why this is different from previous attempts
- Previous fixes focused on backoff math only.
- The deeper bug is now clear: free-tier retries still have multiple client-side paths that can re-animate a terminally failed document.
- This plan fixes the contract between backend and client, not just the delay values.

Files to change
- `supabase/functions/generate-embeddings/index.ts`
  - return explicit terminal failure state for free-tier circuit-breaker
  - short-circuit already-failed free-tier docs
- `src/components/RepositoryCard.tsx`
  - stop writing `processing_embeddings` before backend acceptance
  - stop free-tier monitoring when status is failed
  - fix FIFO timestamp usage
  - make Reprocess resume safely for free tier
- No paid-tier logic changes

Testing plan
1. Reproduce with a free-tier doc that hits 429s.
2. Verify logs show the document being marked failed once.
3. Verify no further `generate-embeddings` network requests are sent for that doc after failure.
4. Leave the tab open for at least 20-30 minutes:
   - no repeated free-tier embedding calls
   - status remains failed
5. Close the browser, wait, reopen:
   - document should stay failed
   - no automatic request should fire just because the page reopened
6. Click Reprocess manually:
   - exactly one new free-tier resume attempt starts
   - if provider still rejects, it fails once and stays failed
   - if provider accepts, progress resumes
7. Run the 21-document benchmark again on free tier.
8. Confirm paid upload/embedding flow is unchanged.

Bottom line
The current bug is not simply “the provider still thinks quota is exhausted”.
The actual bug is that the free-tier client and backend still disagree about terminal failure: the backend marks a doc failed, but the client can revive it and keep sending more embedding requests. That is why you can still see immediate 429s after an apparent pause, and that is the part I would fix next without touching the paid workflow.
