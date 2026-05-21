You set 5 ground rules / asks. Below is the exact plan. Nothing will be changed until you reply "approved". No scope will be expanded beyond what is listed here.

---

### 0. Ground rule (acknowledged, permanent)
No code, SQL, config, or benchmark run will be executed without your written approval per item. I will quote each item back and wait for "approved" on each before touching it. I'm logging this as a hard project rule in memory.

### 1. Model running behind the scenes
- Coding/chat agent driving this conversation: a Lovable-managed model (mix; not user-selectable). Lovable rotates these; I cannot self-identify the exact version.
- RAG answer model used by the app's Assistant (`rag-query` edge function): `google/gemini-2.5-flash` via Lovable AI Gateway.
- Judge model used by the benchmark (`run-eval`): `google/gemini-2.5-flash`.
- Embeddings: `gemini-embedding-001` via Google API.

No change proposed here — informational only.

### 2. Revert benchmark hypothesis to K = 4 / 8
- Remove any default that flips `run-eval` into `adaptive=1`.
- Default benchmark path uses **per-question `k_target`** from `eval_dataset` (the 4/8 values you originally set).
- `adaptive` remains a manual opt-in flag only; never auto-applied.
- No other retrieval logic touched (hybrid search, HNSW, judge prompt all stay).

### 3. Pin main-page Accuracy = Query Analytics Accuracy
Today the landing/Projects KPI is computed from a different slice than the Query Analytics page, which is why they diverge. Fix:
- Single source of truth: a SQL view (or one shared client query) that both screens call.
- Scope: **non-benchmark `query_logs` rows only** (exclude rows tagged as benchmark in `eval_model`/response marker), so benchmark runs cannot drift the headline number.
- Same formula on both screens: `Accuracy = (TP + TN) / (TP + FP + FN + TN)` aggregated across the same row set.
- Add a short comment in code stating "main-page Accuracy MUST equal Query Analytics Accuracy — do not diverge".

### 4. Re-run benchmark + fix confusion-matrix numbers
Order of operations after items 2 & 3 are approved and merged:
1. Delete **all** prior benchmark rows from `query_logs` (any row whose `eval_model` matches `benchmark`, `benchmark:*`, or has the benchmark marker in `response_text`). Keeps DB clean per your earlier instruction.
2. Run benchmark once on the same 100 questions, judge on, `k_target` 4/8 path, no adaptive.
3. Confusion-matrix display fix: today TP+FP+FN+TN collapses to `top_k_eval` (= pool size) by construction, which is why every row sums to 20 while K shows 3 or 15. Two-part fix:
   - Per-row math uses `top_k_eval = top_k` for the k_target path (so the matrix sums to K, matching what the user actually sees).
   - Column header changes from `K=N` to `K_used=N, Pool=M` so the two K's are never confused again.
4. Report: overall metrics + per-tier breakdown (the 4 question categories) + side-by-side vs the previous k_target baseline.

### 5. Mobile voice cutoff after first turn
Symptom: Android browser stops listening after the first reply. Desktop works.
Root cause (confirmed pattern): on mobile, the `SpeechRecognition`/`SpeechSynthesis` user-gesture context is lost across the async TTS → recognition handoff, so `recognition.start()` after TTS ends silently fails.
Fix scope (frontend only, no backend changes):
- Pre-create the next `SpeechSynthesisUtterance` inside the original tap handler (gesture-preserving pattern from the project's known-good approach).
- On TTS `onend`, restart recognition inside a `setTimeout(..., 250)` and wrap in try/catch; on `NotAllowedError` show a one-tap "Tap to continue listening" button.
- Use `useRef` for the recognition instance + handlers so callbacks stay stable across renders.
- No changes to desktop path behavior.

---

### What I need from you
Reply with which items you approve. You can approve all 5, a subset, or ask for changes. I will not touch anything until then.

- [ ] Item 2 — revert to k_target 4/8
- [ ] Item 3 — pin main-page Accuracy to Query Analytics
- [ ] Item 4 — purge old benchmark rows, re-run, fix matrix headers + per-row math
- [ ] Item 5 — mobile voice restart fix
