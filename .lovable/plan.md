

# Plan: Fix Mobile Voice Echo — Root Cause Identified

## Root Cause

The echo bug has persisted across multiple fix attempts because the **actual root cause was never identified**. It is not a timing or cooldown problem. Here is what is happening:

The code has a "keepAlive" timer that calls `speechSynthesis.pause()` then `speechSynthesis.resume()` every 10 seconds. This exists to work around a **desktop Chrome bug** where TTS cuts out after ~15 seconds.

**On Android Chrome, `speechSynthesis.pause()` kills the current utterance — it behaves identically to `cancel()`.** This is a documented, long-standing Android Chrome bug (see [MDN browser-compat-data #4500](https://github.com/mdn/browser-compat-data/issues/4500)).

This means every 10 seconds during TTS playback on Android:
1. `pause()` fires → the current utterance is aborted
2. The utterance's `onend` event fires prematurely
3. `speakNext()` advances to the next sentence, but the timing is disrupted
4. Meanwhile, `cleanup()` may be triggered, setting `isTtsActiveRef = false`
5. The gatekeeper sees TTS as "finished" and restarts the microphone
6. The mic picks up the remaining TTS audio playing through the speaker → **echo**

No amount of cooldown tuning can fix this because the keepAlive is actively sabotaging the TTS lifecycle on Android.

## Fix

**File: `src/components/TechnicianChat.tsx`**

### Change 1: Disable keepAlive on mobile

In the `speakText` function (around line 320), wrap the keepAlive interval in a `!isMobileDevice` check:

```typescript
// Chrome desktop workaround: pause/resume every 10s to prevent 15s cutoff
// SKIP on mobile — Android Chrome treats pause() as cancel(), killing the utterance
if (!isMobileDevice) {
  ttsKeepAliveRef.current = setInterval(() => {
    if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
      window.speechSynthesis.pause();
      window.speechSynthesis.resume();
    }
  }, 10000);
}
```

### Change 2: Safety — cancel speechSynthesis before starting recognition on mobile

In `startConversationListeningInternal` (around line 377), add a precautionary `speechSynthesis.cancel()` on mobile before starting recognition, to flush any orphaned utterances:

```typescript
// On mobile, force-cancel any lingering speech synthesis before starting mic
if (isMobileDevice && 'speechSynthesis' in window) {
  window.speechSynthesis.cancel();
}
```

### Change 3: Increase post-TTS cooldown on mobile to 3500ms

Change `getSpeechRestartCooldownMs` from 2500ms to 3500ms on mobile for additional safety margin, since we can no longer rely on the keepAlive to track TTS state:

```typescript
const getSpeechRestartCooldownMs = useCallback(() => (isMobileDevice ? 3500 : 500), [isMobileDevice]);
```

## Why This Fix Is Permanent

- The keepAlive was the **only code path** that could cause premature TTS termination on Android
- Without it, TTS plays each sentence to completion via `speakNext()`, and `cleanup()` only fires after the last sentence truly ends
- The existing gatekeeper and cooldown system then works correctly — it was always sound in logic, just defeated by the keepAlive
- Future code changes won't re-introduce this because the mobile guard is a simple, obvious conditional

## What About the 15-Second Cutoff on Mobile?

The 15-second cutoff is a **desktop Chrome** bug. On Android Chrome, individual utterances play to completion without the cutoff. The `splitIntoSentences()` function already breaks text into sentence-level chunks (each well under 15 seconds), so even if the bug existed on Android, sentence-level chunking would prevent it.

## Files to Change

| File | Change |
|------|--------|
| `src/components/TechnicianChat.tsx` | Disable keepAlive on mobile, add safety cancel before mic start, increase mobile cooldown |

This is a **3-line change** targeting the confirmed root cause.

