

# Plan: Mobile Echo Fix, Document Editor Scroll Fix, and LLM-Judged Expanded Recall

## Bug 1: Mobile Browser Voice Echo (Regression Analysis & Permanent Fix)

### Why This Keeps Regressing

The echo problem has been "fixed" and broken at least 3 times. Here is the structural root cause:

**There are 5 independent mic-restart paths**, each of which can bypass the TTS guard under different timing conditions:

1. `recognition.onend` handler (line 425-432)
2. `recognition.onerror` with `no-speech` (line 401-406)
3. `recognition.onerror` catch-all (line 417-423)
4. Watchdog timer (line 441-453)
5. `speakText` onComplete callback (line 486-494)

The current guard `isSpeechOutputBlocked()` checks three things: `isTtsActiveRef`, `speechSynthesis.speaking`, and a 1.5s cooldown. On mobile browsers (especially Chrome Android and Safari iOS), `speechSynthesis.speaking` can briefly flicker to `false` between sentences or during the pause/resume keepalive cycle. When this happens, any of the 5 restart paths fires, the mic activates, picks up the tail of the TTS audio, and creates an echo loop.

**Why previous fixes didn't hold**: Each fix patched one or two restart paths but left the others. New features or refactors then added or modified restart logic without the guard.

### Permanent Solution

**Architecture change: centralize mic restart through a single gatekeeper function**, eliminating the 5 independent restart paths.

Changes to `src/components/TechnicianChat.tsx`:

1. **Create `scheduleListeningRestart(delayMs)`** — the ONLY function that can restart the mic. It:
   - Clears any pending restart timer
   - Checks `isSpeechOutputBlocked()` with an extended mobile cooldown (2.5s instead of 1.5s)
   - On mobile, additionally checks `window.speechSynthesis.speaking` AND `window.speechSynthesis.pending`
   - If blocked, re-schedules itself after 500ms (poll until safe)
   - If safe, calls `startConversationListening()`

2. **Replace all 5 restart sites** with calls to `scheduleListeningRestart()` — no direct calls to `startConversationListening()` from onend/onerror/watchdog/onComplete.

3. **Increase mobile cooldown** from 1.5s to 2.5s in `getSpeechRestartCooldownMs`.

4. **Add a `ttsEndTimestampRef`** set in `speakText`'s cleanup callback. The gatekeeper checks `Date.now() - ttsEndTimestampRef > cooldown` as an additional guard independent of `speechSynthesis.speaking`.

This is regression-proof because future code changes cannot accidentally bypass the guard — there is only one restart entry point.

---

## Bug 2: Edit Document Modal Auto-Scroll

### Problem

The current `useEffect` on `editContentText` (line 370-377) unconditionally scrolls the textarea to the bottom whenever text changes. This works for dictation (appending at the end) but breaks editing in the middle of a document — the viewport jumps to the bottom, hiding the cursor context.

### Fix

Changes to `src/components/RepositoryCard.tsx`:

1. **Remove the unconditional scroll-to-bottom** for the edit content textarea.
2. **Only auto-scroll when dictating** (when `isEditContentDictating` is true AND text is being appended at the cursor position). The existing `useEffect` already has the `isEditContentDictating` guard, but the problem is that `editContentText` changes from manual typing also trigger it because React state updates from `onresult` cause the effect to fire. The fix: track whether the text change came from dictation vs manual edit using a ref (`editChangeSourceRef`), and only scroll when the source is dictation.
3. **For manual editing**: no auto-scroll — let the browser's native textarea behavior maintain cursor position.

---

## Feature: LLM-Judged Expanded Recall Estimation

### Current Problem

The current recall calculation is circular: `recall = relevant_in_top_k / total_relevant`, but `total_relevant` is counted only from the same top-K chunks being evaluated. This means recall is always 100% when any chunk is relevant, making it a useless metric.

### Approach: Expanded Scan

For each query, retrieve a much larger candidate set (top-200 at a low similarity threshold), have the LLM judge all of them, and use the total relevant count as the denominator for recall.

### Implementation Plan (Phased)

**Phase 1: Admin Batch Evaluation (run-eval edge function)**

Changes to `supabase/functions/run-eval/index.ts`:

1. Add new action `run-expanded-eval`:
   - Accept params: `limit` (number of past queries to evaluate), `scan_k` (default 200), `threshold` (default 0.10)
   - For each query log:
     a. Re-embed the query text
     b. Retrieve top-`scan_k` chunks at the low threshold via `match_chunks_by_docs` or `match_chunks`
     c. LLM-judge each chunk for relevance (reuse existing `evaluateChunkRelevance`)
     d. Count `total_relevant_in_scan` (the expanded denominator)
     e. Calculate `expanded_recall = relevant_in_top_k / total_relevant_in_scan`
     f. Update the query_log row with new fields

2. **No schema changes needed** — store the expanded metrics in the existing `query_logs` columns:
   - `total_relevant_chunks` → updated to the expanded scan count
   - `recall_at_k` → recalculated using expanded denominator
   - Add a note in `relevance_labels` JSON indicating scan parameters

   Wait — the user chose "Summary only" storage. So we store:
   - `total_relevant_chunks` = total relevant found in expanded scan
   - `relevant_in_top_k` = how many of the original top-K were relevant
   - `recall_at_k` = `relevant_in_top_k / total_relevant_chunks`
   - `precision_at_k` stays the same

3. Store aggregate results in `eval_runs` with a note like "Expanded scan K=200, threshold=0.10"

**Phase 2 (future): Background on new queries**

Add the expanded scan to `evaluateRetrievalBackground` in `rag-query/index.ts`. This would be toggled by a flag/config.

### Changes to Analytics UI

Changes to `src/pages/QueryAnalytics.tsx`:

1. Add a new button "Expanded Recall Eval" that calls `run-expanded-eval`
2. Show the expanded recall metric separately in the Retrieval Quality card (e.g., "Recall@K (expanded)" alongside the existing metric)

### Cost & Time Estimate

- Scanning 200 chunks per query × 200 LLM calls per query × 50 queries = ~10,000 LLM calls per batch run
- At Gemini Flash rates, this is manageable but takes ~15-30 minutes per batch
- The `limit` parameter controls how many queries to evaluate per run

### Files to Change

| File | Changes |
|------|---------|
| `src/components/TechnicianChat.tsx` | Centralize mic restart, increase mobile cooldown, add ttsEndTimestamp guard |
| `src/components/RepositoryCard.tsx` | Fix edit-content auto-scroll to only scroll during dictation |
| `supabase/functions/run-eval/index.ts` | Add `run-expanded-eval` action with wide-scan retrieval and LLM judging |
| `src/pages/QueryAnalytics.tsx` | Add button and display for expanded recall results |

