
Goal: produce a reliable, history-based recovery plan for the Android Chrome mobile echo issue, instead of another blind fix cycle.

## Table 1 — What has been tried so far

| Attempt | What was tried | Where it appears in code/history | Intended effect | Outcome based on your feedback |
|---|---|---|---|---|
| 1 | Generic restart delays after speech output | `TechnicianChat.tsx` restart scheduling and cooldown logic | Prevent mic from reopening too quickly after TTS | Did not solve the issue permanently |
| 2 | Centralized mic restart gatekeeper | `scheduleListeningRestart()` in `TechnicianChat.tsx` | Make one controlled path for mic reactivation | Helpful structurally, but not sufficient |
| 3 | Explicit recognition teardown before TTS | `teardownRecognitionForSpeech()` in `TechnicianChat.tsx` | Release mic before speaker starts | Did not eliminate mobile echo |
| 4 | Stronger speech-output blocking checks | `isSpeechOutputBlocked()` using `speaking`, `pending`, cooldown, end timestamp | Stop mic restart while TTS is still active | Still not enough on Android Chrome |
| 5 | Longer mobile cooldowns | `getSpeechRestartCooldownMs()` now returns 3500ms on mobile | Add hardware/browser settle time | Still not fully resolved |
| 6 | Mobile-specific restart delays on `onerror` / `onend` | `TechnicianChat.tsx` mobile branches for 1000–1200ms delays | Reduce restart races | Did not fully resolve |
| 7 | Pre-start `speechSynthesis.cancel()` on mobile | `startConversationListeningInternal()` lines 401–404 | Flush orphaned speech before starting mic | Added as safety, but issue still reported |
| 8 | Disable TTS keep-alive on mobile | `speakText()` lines 319–328 with `if (!isMobileDevice)` | Avoid Android Chrome bug where `pause()` acts like cancel | This is the one fix that aligns with the identified root cause, but regression/remaining bug means the full voice flow is still not reliably solved in practice |
| 9 | Transcript reconstruction to avoid duplication | `onresult` rebuilds from `event.results` in chat/editor flows | Prevent repeated transcript accumulation | Solves duplication class of bugs, not the echo root cause |
| 10 | Hide conflicting per-message voice controls in conversation mode | Mentioned in project memory/history | Reduce UI/state conflicts between manual and auto voice | Good hardening, not root-cause fix |

## Table 2 — Assessment: what did not work vs what likely did work

| Item | Status | Why |
|---|---|---|
| Cooldown-only tuning | Did not work | Symptom mitigation only; does not fix incorrect state transitions |
| Restart timing changes (`onend`, `onerror`, watchdogs) | Did not work | Helps with resilience, but still relies on browser state being truthful |
| Recognition teardown before TTS | Did not work alone | Good hygiene, but insufficient if TTS lifecycle itself is wrong |
| Speech-blocking checks (`speaking`, `pending`, cooldown) | Did not work alone | Android browser behavior can be inconsistent; these checks are not authoritative enough |
| Pre-start mobile `cancel()` | Did not work alone | Only cleans leftovers before mic start; does not prove output truly finished |
| Disable keep-alive on mobile | Best candidate for the previously working fix | It directly addresses the Android Chrome-specific failure mode that was identified: `pause()` behaving like `cancel()` and causing premature `onend` / mic restart |
| Current full implementation | Not yet trustworthy | Your latest feedback says the mobile recording/echo issue still exists, so the current bundle of fixes is not enough as-shipped |

## What likely worked before

The strongest candidate for the previously working solution is:

1. Desktop-only TTS keep-alive
2. No mobile `pause()/resume()` pulse
3. Conversation restart allowed only after true speech completion

That matches both:
- the identified Android Chrome behavior
- the remembered history that the problem had been fixed before and later regressed when the platform evolved

The likely regression pattern is that later voice-flow changes kept the mobile keep-alive guard, but reintroduced another path that restarts recognition too early or leaves overlapping recognition instances alive.

## Future roadmap

### Priority 1 — Recover the known-good mobile behavior
Re-audit the full Android Chrome conversation lifecycle and treat the old “mobile keep-alive disabled” behavior as the baseline to preserve. Specifically verify there is no path that:
- starts recognition while `speechSynthesis` is still winding down
- leaves an old recognition instance alive
- triggers both `onend` and a scheduled restart for the same cycle

### Priority 2 — Instrument before changing behavior again
Add temporary voice-lifecycle logging for:
- TTS start
- utterance `onend`
- utterance `onerror`
- recognition `start`
- recognition `end`
- recognition `error`
- every `scheduleListeningRestart()` call and reason

This should produce a timeline table so the next fix is based on evidence, not guesses.

### Priority 3 — Enforce a stricter duplex state machine
Refactor mobile voice into an explicit one-owner state machine:
`idle -> listening -> processing -> speaking -> cooldown -> listening`

Rules:
- only one recognition instance may exist
- only one restart token may exist
- TTS completion must advance state once
- mic restart must be denied unless state is exactly `cooldown_complete`

### Priority 4 — Add mobile-specific “generation token” guards
Every recognition session and every TTS cycle should carry an incrementing token. Any stale callback must self-ignore. This protects against old `onend`/`onerror` handlers reopening the mic after a newer cycle already started.

### Priority 5 — Separate mobile from desktop voice logic more clearly
Right now desktop and mobile share most of the flow with branches. For this bug, mobile should have its own stricter branch for:
- TTS handling
- recognition teardown
- restart timing
- echo prevention rules

That reduces future regressions when desktop-specific workarounds are added.

### Priority 6 — Validate with an internal test matrix before claiming a fix
Before declaring success, test these cases against Android Chrome:
- conversation mode, short answer
- conversation mode, long answer
- stop/mute during TTS
- repeated back-to-back voice turns
- dictation after conversation mode
- page reload and first voice interaction

## Implementation plan I would follow next

1. Audit all recognition start paths in `TechnicianChat.tsx`
2. Add temporary instrumentation and event sequencing logs
3. Identify duplicate restart paths or stale callbacks
4. Convert mobile flow to tokenized state machine
5. Keep the mobile keep-alive disabled permanently
6. Test Android Chrome voice scenarios end-to-end before shipping

## Technical notes

- The current code already shows the mobile keep-alive guard in `speakText()` and the mobile pre-start cancel in `startConversationListeningInternal()`.
- That means the remaining issue is likely no longer the original keep-alive bug alone; it is more likely a regression in lifecycle coordination.
- So the next fix should not be “another timing tweak.” It should be a state-management fix backed by instrumentation.

