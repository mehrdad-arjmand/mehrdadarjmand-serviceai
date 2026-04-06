
Goal: explain the real failure mode shown in your screenshots, then outline the fix before changing anything.

What the screenshots are telling us
- The stuck document is already at 500/940 chunks, so upload and chunk creation succeeded. The failure is in the embedding stage, not in the initial upload stage.
- The graph shows repeated 429 TooManyRequests errors on the free API, which means the system is still re-hitting the embedding API too aggressively during the same document lifecycle.
- So the current “retry” logic did not solve the real bottleneck. It only changed some queue behavior around uploads, while the large-document embedding path still breaks.

Root cause in the current code
1. Free-tier uploads are serial, but free-tier embeddings are still not truly “small-step” serial.
   - `supabase/functions/ingest/index.ts` triggers `generate-embeddings` with `mode: 'full'` for each free-tier document.
   - `supabase/functions/generate-embeddings/index.ts` then tries to process the whole document in one long-running function call.

2. Large documents are too big for that design.
   - Free tier currently uses `BATCH_EMBED_SIZE_FREE = 10` and loops until all remaining chunks are embedded.
   - A 940-chunk document needs about 94 embedding API calls minimum, plus delays and retries.
   - That is exactly the kind of workload that can stall, timeout, or get abandoned mid-run in an edge-function environment.

3. The current recovery logic makes the free-tier problem worse.
   - `src/components/RepositoryCard.tsx` watches for no progress for 180s and then re-triggers `generate-embeddings`.
   - But during 429 backoff, the original run may still be alive or waiting.
   - So the client can start a second embedding run for the same document while the first one has not truly finished.
   - That explains the graph: more requests, more 429s, and still no clean completion.

4. Recovery is still too “restart-oriented” instead of “resume-oriented”.
   - The free-tier upload monitor can delete/retry or defer entire files.
   - That is the wrong recovery unit for a big document that already has hundreds of embedded chunks.
   - The right unit is: resume only the remaining unembedded chunks, without duplicating work.

Why the previous fix did not help
- It improved the upload queue shape, but it did not change the core issue that a big free-tier document is still embedded inside one long, retry-heavy function run.
- So once the document is large enough, the same failure pattern remains: partial progress, 429 loops, then abandonment.

Implementation plan
1. Rebuild the free-tier embedding flow as incremental slices
- Change `generate-embeddings` so free tier does only a small slice per invocation, then returns immediately.
- Example shape: process only the next 1-3 API requests worth of chunks, save progress, stop.
- Keep the paid-tier path unchanged.

2. Add a document-level lock/heartbeat for free-tier embedding
- Prevent overlapping free-tier embedding runs on the same document.
- Use a lightweight backend claim mechanism so only one worker can own a document at a time.
- If a document is already being worked on, later retries should skip instead of launching another run.

3. Convert free-tier recovery from “restart file” to “resume remaining chunks”
- In `RepositoryCard`, stop treating a large partially indexed document like a fresh upload problem.
- The monitor should only:
  - poll status,
  - wait for the retry window,
  - trigger the next small embedding slice if the document is idle and incomplete.
- Do not auto-delete partially processed docs/chunks for this case.

4. Treat 429 as a waiting state, not a failed state
- When the embedding API returns rate-limit guidance, store that as an internal wait/retry condition.
- The document should remain in processing/waiting, not flip into failure logic that causes duplicate retries.
- The client supervisor should respect that wait window before invoking the next slice.

5. Reduce free-tier aggressiveness based on the graph evidence
- Lower the free-tier embedding batch size from the current 10 to a safer value.
- Increase or make adaptive the delay between free-tier calls.
- The graph clearly shows the current free-tier throughput is still too aggressive for large documents.

6. Leave paid-tier workflow alone
- No behavioral changes to paid-tier recovery logic unless there is a shared helper that must be touched safely.
- This work should be scoped specifically to the free-tier path shown in your screenshots.

7. Secondary hardening
- Align `ingest` auth verification with the newer local-claims approach already used in `generate-embeddings`.
- This is not the root cause shown by the graph, but it removes a remaining fragile auth path.

Technical details
Files to update
- `supabase/functions/generate-embeddings/index.ts`
  - split free-tier “full document” processing into bounded slices
  - add lock/heartbeat/retry-after handling
  - keep paid path as-is
- `src/components/RepositoryCard.tsx`
  - change free-tier monitor to resume slices instead of launching overlapping full reruns
  - remove destructive retry behavior for partially indexed large docs
- `supabase/functions/ingest/index.ts`
  - free-tier should queue/trigger only the first bounded embedding step, not assume a full-run worker
  - harden auth verification
- `supabase/migrations/...`
  - add minimal state needed for free-tier lock/heartbeat/retry scheduling if current schema does not already support it

Success criteria
- A very large free-tier document can pause and resume without ever restarting from zero.
- Only one free-tier embedding worker can run per document at a time.
- 429s no longer create overlapping retries.
- The document keeps progressing after waits instead of freezing at a partial count like 500/940.
- The free-tier API error graph should show fewer spikes and materially fewer repeated 429 bars for the same upload run.
