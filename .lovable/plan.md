

# Plan: Fix Retrieval Count, Mobile Mute Stuck, and Landing Page Metric

## Issue 1: Retrieval count must always be 200 (not conditional)

**Current bug**: Line 463 in `rag-query/index.ts` sets `retrievalCount = 200` only when document filters are manually selected, otherwise 50. The eval scope (line 748) is `rankedChunks.slice(0, 200)` but can only evaluate what was retrieved — so with 50 retrieved, eval caps at 50.

**Fix in `supabase/functions/rag-query/index.ts`**:
- Line 463: Remove the conditional. Set `retrievalCount = 200` always for project-scoped queries
- Line 483: Set global `match_count` to 200 as well
- This ensures the LLM-as-judge always has up to 200 chunks to evaluate

```
// Before (line 463):
const retrievalCount = (filterDocumentIds && filterDocumentIds.length > 0 && filterDocumentIds.length <= 5) ? 200 : 50

// After:
const retrievalCount = 200
```

## Issue 2: Mobile mute button causes stuck state

**Root cause**: `stopConversationSpeaking` calls `markSpeechOutputCooldown()` which sets a 3500ms mobile cooldown. Then it schedules restart at 1500ms. But `isSpeechOutputBlocked()` checks `ttsRecentlyEnded` using the same 3500ms window — so the restart is blocked and re-polls every 500ms until 3500ms total elapses. The user perceives the mic as stuck for ~2 seconds after pressing mute.

This was already fixed for desktop — the desktop cooldown is only 500ms with an 800ms restart delay, so it works fine. The mobile path has the same logic but with 3500ms/1500ms, creating the gap.

**Fix in `src/components/TechnicianChat.tsx`**:
- In `stopConversationSpeaking` (after line 779), after `markSpeechOutputCooldown()`, immediately override the cooldown by setting `speechOutputEndRef` and `speechOutputCooldownUntilRef` to 0. This is a user-initiated cancel — the cooldown is unnecessary because TTS was just forcefully stopped
- Reduce mobile restart delay from 1500ms to 800ms (matching desktop)

```typescript
// After markSpeechOutputCooldown() in stopConversationSpeaking:
speechOutputCooldownUntilRef.current = 0;
ttsEndTimestampRef.current = 0;
```

And change line 797 from `isMobileDevice ? 1500 : 800` to just `800`.

## Issue 3: Landing page first metric — Precision to Accuracy

**Fix in `src/pages/Projects.tsx`**:
- Change the first metric label from "Precision" to "Accuracy"
- Update the computation to use the accuracy formula: `(TP + TN) / top_k_eval`
  - `TP = relevant_in_top_k`
  - `FP = top_k - TP`
  - `FN = total_relevant_chunks - TP`
  - `TN = max(0, top_k_eval - top_k - FN)`
- Requires fetching `top_k_eval` in the query (in addition to existing columns)

## Summary

| File | Change |
|------|--------|
| `supabase/functions/rag-query/index.ts` | Set `retrievalCount = 200` always (remove conditional); set global `match_count` to 200 |
| `src/components/TechnicianChat.tsx` | Clear cooldown refs after explicit mute; reduce mobile restart to 800ms |
| `src/pages/Projects.tsx` | Replace Precision with Accuracy as first metric |

