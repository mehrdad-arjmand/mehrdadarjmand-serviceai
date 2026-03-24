
Goal: fix the two real regressions instead of tuning around them:
1) retrieval is still answering from the wrong chunks
2) mobile mute/restart still diverges from desktop behavior

What I found

Do I know what the issue is? Yes.

1. The “200 chunks” change only affected evaluation, not the answer context.
- In `supabase/functions/rag-query/index.ts`, `retrievalCount = 200` and `top_k_eval = 200` are active.
- But the answer is still generated from `topChunks = rankedChunks.slice(0, 20)`.
- Your logs confirm this: `top_k = 20`, `top_k_eval = 200`, `retrieved_ids_count = 20`.
- So the assistant still only sees 20 chunks when answering. The extra 180 are judge-only.

2. Natural-language document scoping is missing.
- The query “look at the 2023 document…” does not become `filterDocumentIds`.
- So search still runs across all project documents.
- The database confirms the bad citations are coming from `model-year-2021-vehicles.pdf`, `model-year-2025-vehicles.pdf`, and `model-year-2023-vehicles.pdf` together.
- That is why Volvo/Volkswagen from the 2023 EV table can be missed while other years leak in.

3. The reranker is optimized for manuals/procedures, not tabular year-specific queries.
- `rerankChunks()` boosts procedural terms like `replace`, `inspect`, `warning`, `step`, `pressure`.
- It does not strongly reward:
  - requested year/document match
  - requested table/section match
  - chunk continuity inside one table
  - exact make/model keyword hits
  - penalties for wrong year/wrong section
- For this use case, that ranking logic is fundamentally wrong.

4. The current confusion-matrix row is not proving answer quality.
- Recent rows show `top_k_eval = 200`, `total_relevant_chunks = 76/77`, but only `relevant_in_top_k = 10/12`.
- That means the evaluator is seeing many relevant chunks in the candidate pool, but the answer context still excludes most of them.
- So the bug is retrieval-to-context selection, not ingestion.

5. The mobile mute path still has mobile-only blockers that desktop does not rely on.
- `stopConversationSpeaking()` now clears cooldown refs, which was good.
- But restart still goes through `scheduleListeningRestart()` plus:
  - `isSpeechOutputBlocked()`
  - mobile state gating
  - async `speechSynthesis.cancel()` settling
- On Android Chrome, that is still fragile. Desktop succeeds because its restart path is effectively less constrained.

Implementation plan

A. Fix retrieval the right way in `supabase/functions/rag-query/index.ts`
1. Add query-time document inference before vector search.
- When the user names a year/document in natural language, infer the target document from project docs.
- Examples:
  - “2023 document” → `model-year-2023-vehicles.pdf`
  - exact filename mention → direct match
- If one document is confidently inferred, treat it as an implicit document filter.

2. Scope both semantic and keyword retrieval to that inferred document.
- Use the inferred doc ID for:
  - `match_chunks_by_docs`
  - `enrichWithKeywordFallback`
  - any fallback retrieval
- This prevents 2021/2025 chunks from entering the candidate pool for a 2023-only request.

3. Add a table-aware retrieval mode for document-scoped analytical questions.
- Detect intents like: `count`, `list all`, `number of rows`, `table`, `models`, `all-electric vehicles`.
- For those queries, do not rely only on semantic ranking.
- Retrieve the matching document’s relevant section plus adjacent chunk windows by `chunk_index`, so a full table can be assembled across continuation chunks.

4. Replace the current generic reranker with an intent-aware reranker.
- Strong boost for:
  - exact year match
  - exact document match
  - section/table heading match (`All-Electric Vehicles`)
  - make/model token hits (`Volkswagen`, `Volvo`)
  - nearby continuation chunks from the same section
- Strong penalty for:
  - wrong year
  - wrong section (`PHEV`, `HEV`) when the question says EV
  - generic “related” chunks from other documents

5. Keep `top_k_eval = 200`, but separate evaluation scope from answer scope more explicitly.
- Answer context stays controlled and relevant.
- Judge still evaluates up to 200 candidates.
- Add logging so we can see:
  - inferred target doc
  - answer-scope chunk IDs
  - eval-scope chunk IDs
  - whether table-mode was activated

B. Fix the misleading evaluation signals
1. Make evaluation document-aware when the query is document-specific.
- If the query is clearly about one document, only evaluate candidates from that document.
- This stops `total_relevant_chunks` from being inflated by nearby-but-wrong years.

2. Add retrieval diagnostics to logs.
- Persist:
  - inferred document ID(s)
  - rerank reason summary
  - count of chunks from the target doc vs other docs
- This gives a direct audit trail when answers are wrong.

C. Fix mobile mute/restart by matching desktop behavior, not tuning around it
Files:
- `src/components/TechnicianChat.tsx`
- `src/components/RepositoryCard.tsx` if shared voice/dictation helpers need parity

1. Create a dedicated “manual interrupt” restart path.
- When the user presses mute during assistant speech:
  - cancel TTS
  - fully tear down recognition
  - bypass mobile cooldown/state blockers for that one path
  - restart listening directly after the same settled delay desktop uses

2. Remove mobile-only blockers from explicit user interrupt flow.
- Keep protection for automatic restarts after TTS completion.
- But for manual mute, do not re-check the long speech-block path that is meant for echo prevention.
- User interruption should be treated as “restart now,” not “wait for mobile cooldown logic.”

3. Unify desktop and mobile restart logic into one shared helper.
- Right now the same feature is split by mobile guards.
- I would consolidate:
  - TTS stop
  - recognition teardown
  - pending timer cleanup
  - restart trigger
- Then keep only the minimum mobile-specific behavior required by Android Chrome.

4. Keep instrumentation on the manual mute path.
- Log:
  - user mute clicked
  - TTS cancel complete
  - restart requested
  - restart blocked reason
  - recognition started
- That gives a hard proof whether the restart is being blocked by synth state, token state, or mobile state.

Files to update

1. `supabase/functions/rag-query/index.ts`
- add natural-language document inference
- apply inferred doc scoping to semantic + keyword + fallback retrieval
- add table-aware retrieval mode
- replace procedural reranking with intent-aware ranking
- improve debug logging

2. `src/components/TechnicianChat.tsx`
- add dedicated manual-interrupt restart path
- remove mobile-only blockers from explicit mute restart
- unify desktop/mobile restart sequence

3. `src/components/RepositoryCard.tsx`
- align dictation restart behavior with the same shared mobile/desktop rules if needed for parity and regression prevention

Expected outcome

1. A question like:
- “look at the 2023 document… count rows in the all-electric vehicles table… list Volkswagen and Volvo”
will search only the 2023 vehicle document, assemble the EV table across continuation chunks, and stop leaking 2021/2025 chunks.

2. The answer context will finally reflect the relevant document/table instead of just a generic top-20 semantic slice.

3. Mobile mute in conversation mode will restart the mic using the same effective flow as desktop, instead of being trapped behind mobile-only cooldown/state checks.
