
Goal: provide a root-cause analysis of the free-tier workflow before making any more changes.

Do I know what the issue is?
Yes.

What I reviewed
- Current free-tier frontend orchestration in `src/components/RepositoryCard.tsx`
- Current free-tier backend flow in `supabase/functions/ingest/index.ts`
- Current embedding worker in `supabase/functions/generate-embeddings/index.ts`
- Recent database state for the failed batch

Confirmed evidence
- In the recent failed batch, only the first 3 documents completed.
- The remaining documents were left as:
  - `ingestion_status = 'in_progress'`
  - `total_chunks = 0`
  - `ingested_chunks = 0`
  - no retry timestamps, no locks, no explicit error
- That means the queue is not dying in embeddings for those later files.
- It is dying earlier, during free-tier extraction/chunking.

Root cause analysis
1. The real bottleneck is still inside `ingest`, not the embedding slicer
- Free tier currently registers all docs, then processes `workItems` one-by-one inside a single background `waitUntil` loop in `supabase/functions/ingest/index.ts`.
- If that worker stalls, gets reclaimed, times out, or hangs on one document, the later documents never start.
- Those later documents remain forever at `in_progress + total_chunks=0`, which is exactly what the database shows.

2. The free-tier “retry/monitor” logic that was supposed to protect this is mostly dead code
- `RepositoryCard.tsx` still contains `uploadFreeTierFile()` and `monitorFreeTierDocument()`.
- But `handleUpload()` no longer uses that path for free tier.
- It now does a single `uploadBatch(filesToUpload)` call for the whole batch.
- So the file-level extraction watchdog/retry logic is not actually running.

3. The active free-tier recovery loop ignores the documents that are truly stuck
- The free queue recovery only considers docs with `total_chunks > 0`.
- `maybeResumeFreeTierDocument()` also exits immediately when `total_chunks === 0`.
- So once a document gets stuck before chunk creation, it is invisible to recovery.
- Worse: because the queue is FIFO, that zero-chunk document blocks every later document behind it.

4. Previous fixes were aimed at the wrong stage
- The recent work improved embedding slicing, lock handling, and 429 cooldowns.
- That may help once a document reaches `processing_embeddings`.
- But the latest failures are happening before that stage.
- So the main failure mode was misdiagnosed as “embedding retry logic” when the current batch evidence shows “extraction/chunking queue death”.

5. Observability is too weak
- Recent function logs were not available.
- The system has no durable free-tier job ledger showing:
  - which document is currently being extracted
  - last heartbeat
  - last successful stage
  - why the queue stopped
- That is why repeated “surface fixes” have been hard to validate.

Why the current design keeps failing
```text
Upload 21 docs
-> ingest registers all rows
-> ingest background loop starts doc 1, doc 2, doc 3...
-> one doc stalls/hangs/fails before chunks are written
-> later docs are never reached
-> frontend recovery only resumes docs with total_chunks > 0
-> blocked doc is never resumed
-> queue appears to "die out"
```

What needs to be fixed
1. Stop treating free-tier extraction/chunking as one long background loop
- Free tier needs a durable one-document-at-a-time queue, not a single `waitUntil` batch runner.

2. Persist queue state for free tier
- Each document needs explicit stage state such as:
  - `queued`
  - `extracting`
  - `chunking`
  - `embedding`
  - `cooldown`
  - `complete`
  - `failed`
- Also store heartbeat / started_at / last_error / retry_after.

3. Make recovery include zero-chunk stuck documents
- The supervisor must detect documents stuck in `queued/extracting` with `total_chunks=0`.
- Those are currently the blind spot causing the queue to freeze.

4. Move free-tier orchestration to a true resume model
- Register all docs immediately.
- Process exactly one free-tier document at a time.
- When it finishes extraction/chunking, then start embedding slices.
- If it stalls, retry that document from its current stage instead of abandoning the queue.

5. Remove the split-brain orchestration
- Right now some logic lives in `ingest`, some in the UI poller, and part of the older retry logic is unused.
- Free-tier orchestration should have one clear owner.

Files that need to change
- `src/components/RepositoryCard.tsx`
  - remove/replace the current broken free-tier control flow
  - stop relying on batch upload as the effective orchestrator
  - poll queue state instead of guessing from partial document fields
- `supabase/functions/ingest/index.ts`
  - stop running the whole free-tier batch inside one fragile sequential background loop
  - turn it into per-document stage execution
- `supabase/functions/generate-embeddings/index.ts`
  - keep paid path unchanged
  - keep free-tier slice behavior, but make it run only after extraction/chunking state is ready
- database migration
  - add proper free-tier queue state / heartbeat / retry metadata

Implementation direction I recommend
- Keep paid workflow untouched.
- Rebuild only the free-tier pipeline as:
  1. enqueue all documents immediately
  2. backend claims the oldest queued free-tier doc
  3. extract/chunk that one doc
  4. embed it in 15-chunk slices with 60s cooldown on 429
  5. when complete, backend advances to the next queued doc
  6. if a doc stalls, mark it retryable and continue deterministic recovery

Success criteria
- All uploaded free-tier documents appear immediately in the list.
- Only one free-tier document is actively processed at a time.
- If a document stalls before chunk creation, it is detected and retried.
- Later documents do not disappear behind a stuck zero-chunk document.
- 429 handling remains limited to embedding cooldowns, not repeated queue restarts.
- Paid API behavior remains unchanged.

Bottom line
- The main root cause is not “free-tier embeddings are too fast”.
- The main root cause is that the free-tier batch still depends on a fragile single background `ingest` loop, while the active recovery logic cannot see or recover the documents that stall before chunk creation.
- That is why the first few documents finish and the rest die out.
