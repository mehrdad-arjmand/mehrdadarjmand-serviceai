

# Fix Mobile Voice Text Duplication — Root Cause & Plan

## The actual problem (not echo — duplication)

The issue you are reporting now is **text duplication**, not audio echo. Every sentence or phrase you say on Android Chrome gets repeated multiple times in the text field. This is a different bug from the TTS echo we have been chasing.

## Root cause

All three dictation paths use `recognition.continuous = true` and reconstruct the full transcript by iterating `event.results[0..N]` on every `onresult` event. On desktop Chrome this works correctly. **On Android Chrome, `continuous = true` is unreliable** — the browser internally restarts recognition sessions, replays finalized results, or resets the results array unpredictably. This causes the reconstruction loop to produce duplicated text when combined with the `baseText` anchor pattern.

This is a well-documented Android WebSpeech API limitation. No amount of token guards, state machines, or cooldowns can fix it because the duplication happens inside the browser's own `event.results` array behavior.

## Why previous fixes did not help

Every previous attempt targeted:
- TTS-to-mic timing (cooldowns, teardowns, keep-alive)
- State machine transitions
- Generation tokens for stale callbacks

None of these address the core issue: **`continuous = true` produces corrupt results on Android Chrome**.

## Solution: Hybrid approach

**Mobile**: Switch to `continuous = false`. Each recognition session produces exactly ONE final result. Auto-restart on `onend` for a seamless experience. Accumulate results in a ref across restarts.

**Desktop**: Keep `continuous = true` — it works fine there.

This is the simplest possible fix and eliminates the duplication at its source.

## Changes

**All changes in 2 files:**

### 1. `src/components/TechnicianChat.tsx` — 3 dictation/voice paths

**Conversation mode** (`startConversationListeningInternal`, ~line 467):
```
recognition.continuous = isMobileDevice ? false : true;
```
On mobile with `continuous = false`, each `onresult` delivers one final result. Accumulate into `finalTranscript` across restart cycles instead of reconstructing from `event.results`. On `onend`, auto-restart if conversation is still active.

**Dictation mode** (`startDictation`, ~line 684):
Same change: `continuous = false` on mobile. Track accumulated text in a ref. On `onend`, capture the current `finalTranscript` into the question state and restart.

### 2. `src/components/RepositoryCard.tsx` — 2 dictation paths

**New document dictation** (`startDictation`, ~line 585):
```
recognition.continuous = isMobileDevice ? false : true;
```
Use a ref to accumulate final results across restart cycles. `baseText` stays as the anchor from before dictation started. Each restart appends only new text.

**Edit document dictation** (`startEditContentDictation`, ~line 746):
Same pattern. Accumulate `newDictatedText` in a ref across restarts. Cursor position management stays the same.

### Mobile `onresult` handler pattern (all paths)

```typescript
// Mobile: continuous=false, one final result per session
recognition.onresult = (event: any) => {
  const result = event.results[0];
  if (result.isFinal) {
    accumulatedRef.current += result[0].transcript + ' ';
  }
  const interim = result.isFinal ? '' : result[0].transcript;
  setContent(baseText + accumulatedRef.current + interim);
};
recognition.onend = () => {
  // Auto-restart for seamless experience
  if (stillActive) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new SR();
    r.continuous = false;
    // ... reattach handlers, start
  }
};
```

### Desktop `onresult` handler (unchanged)

Desktop keeps the existing reconstruction loop with `continuous = true`.

## What this does NOT change

- TTS playback logic (keep-alive guard, sentence chunking) — untouched
- Generation tokens and state machine — kept as safety nets
- Voice instrumentation logging — kept for debugging
- Desktop behavior — completely unchanged

## Why this will work permanently

The duplication comes from `continuous = true` on Android. By switching to `continuous = false`, each session produces exactly one result entry. There is no array to reconstruct, no stale results to replay, no browser-internal restart to corrupt state. The auto-restart on `onend` provides the same user experience as continuous mode.

