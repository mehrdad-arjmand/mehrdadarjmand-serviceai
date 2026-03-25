
Goal: fix the two remaining real issues:
1) retrieval still misses obvious exact matches like BMW
2) mobile dictation is functional but noticeably slower/clunkier than desktop

What I found

1. The current “keyword search” is not BM25 or TF-IDF.
- It is a simple `ILIKE` substring fallback in `enrichWithKeywordFallback()`.
- It only keeps up to 4 tokens and only tokens with length >= 4.
- That means `BMW` is dropped completely because it is 3 letters.
- This is the clearest reason the BMW follow-up is failing.

2. Follow-up retrieval is using the raw follow-up question, not a rewritten standalone search query.
- The answer prompt gets conversation history, but retrieval does not.
- So a query like “do you see BMW in the list” loses the prior “2023 all-electric vehicles” scope during search.
- That is why the system can answer against the wrong retrieval set even when the chat context is correct.

3. Table retrieval is still being squeezed by the final answer context.
- The system may retrieve 53 relevant chunks and add adjacent chunks, but the final answer still only sees `topChunks.slice(0, 20)`.
- For table enumeration/counting tasks, that 20-chunk cap is too aggressive unless the selected chunks are made contiguous and section-specific.

4. Mobile voice is now restarting correctly, but desktop/mobile dictation still uses different effective behavior.
- Desktop benefits from `continuous=true`.
- Mobile still relies on short recognition sessions plus restart loops.
- The clunky feel is likely coming from timing/state differences, not from the mute fix anymore.

Implementation plan

A. Fix retrieval for exact-match follow-ups in `supabase/functions/rag-query/index.ts`
1. Add a retrieval-only “standalone query rewrite” step.
- Rewrite follow-up questions into a short standalone search query using recent conversation context.
- Example:
  - “do you see BMW in the list”
  - becomes
  - “In the 2023 all-electric vehicles list, is BMW present?”
- Use that rewritten query for:
  - document inference
  - semantic embedding
  - keyword fallback
- Keep the original user question for the final answer prompt.

2. Replace the weak keyword fallback with a better lexical retrieval path.
- Keep substring search as a backup, but improve tokenization:
  - allow 2–3 letter high-value tokens like `bmw`, `ev`, `gv60`
  - prioritize repeated exact terms
  - prefer tokens from rewritten standalone query over filler words
- Add exact-match boosts for:
  - make/model names
  - year terms
  - document-title terms
  - section header terms
- If feasible within the current backend shape, add a proper weighted lexical score instead of flat `similarity: 0.4`.

3. Make document scoping conversation-aware.
- Run document inference against the rewritten standalone query, not just the raw follow-up.
- This preserves “2023 document” scope across multi-turn conversation even when the follow-up does not repeat the year.

4. Make table/list queries use section continuity, not just top-ranked fragments.
- For count/list/model questions, group chunks into contiguous windows within the inferred document.
- Prefer a dense contiguous section containing EV rows over isolated high-similarity fragments.
- Then build the answer context from the best section window rather than arbitrary top 20 chunks.

5. Add better retrieval diagnostics to logs.
- Log:
  - original question
  - rewritten retrieval query
  - inferred document ids
  - keyword tokens actually used
  - whether a 3-letter exact token like BMW was retained
  - whether table-window mode was used

B. Fix evaluation so the confusion matrix matches the real retrieval task
1. Evaluate using the rewritten/document-scoped query when the query is a follow-up.
- This prevents the eval from judging the wrong universe for multi-turn follow-up questions.

2. Add per-row retrieval metadata for debugging.
- Persist enough info to explain why TP is low:
  - inferred doc count
  - target doc hit count in top-K
  - lexical-hit count in top-K
  - section-window mode on/off

C. Make mobile dictation behavior match desktop more closely
Files:
- `src/components/TechnicianChat.tsx`
- `src/components/RepositoryCard.tsx`

1. Extract shared speech-recognition timing/config.
- Put the desktop/mobile recognition settings behind shared helpers/constants so both flows stop drifting.
- Use the same restart timings, transcript accumulation rules, and watchdog strategy everywhere.

2. Reduce the perceived lag on mobile text rendering.
- Keep the Android-safe recognition mode, but tune for earlier visible updates:
  - faster restart after `onend`
  - faster restart after `no-speech`
  - avoid any unnecessary reset of accumulated transcript between short sessions
  - tighten the silence/submit thresholds where safe

3. Align conversation mode and plain dictation mode.
- The same mobile speech parameters should drive:
  - conversation listening
  - text dictation
  - repository/edit dictation
- This avoids the current situation where one mobile path feels smooth and another feels delayed.

4. Add debug logs for speech timing.
- Log:
  - recognition start
  - first interim token time
  - final token time
  - restart delay
  - gap between sessions
- That will let us compare mobile vs desktop directly and remove guesswork.

Files to update

1. `supabase/functions/rag-query/index.ts`
- add standalone retrieval-query rewrite
- improve keyword token selection to keep short exact entity tokens like BMW
- apply document inference to rewritten query
- switch table/list retrieval to contiguous section-window selection
- improve retrieval diagnostics

2. `supabase/functions/run-eval/index.ts`
- align eval inputs with rewritten/document-scoped retrieval behavior
- add retrieval diagnostics to analytics payload if needed

3. `src/components/TechnicianChat.tsx`
- unify mobile/desktop speech timing and transcript accumulation behavior
- reduce mobile perceived typing lag

4. `src/components/RepositoryCard.tsx`
- apply the same shared speech timing/config so repository/edit dictation behaves like desktop too

Expected outcome

1. A follow-up like “Do you see BMW?” will retain the 2023 EV-table scope during retrieval.
2. BMW will no longer be dropped from keyword matching just because it is a 3-letter token.
3. List/count questions will pull a coherent EV table section instead of scattered fragments.
4. Mobile dictation will feel much closer to desktop in how quickly words appear on screen.
