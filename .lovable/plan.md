## Direct answer: which of the two cases is it?

**Case 1 — bad question generation.** I generated questions from vendor names + general battery/inverter domain knowledge, not from your actual corpus. The judge then correctly found 0 relevant chunks among the top‑200 retrieved, so they were flagged as abstentions.

Evidence from the 17 abstaining queries (all have `judge_tp = 0`, most pulled the full 200‑chunk pool and still found nothing):

- *"What is the energy density of the CATL EnerC module?"*
- *"What is the round-trip efficiency of the Samsung SDI E3 battery?"*
- *"What is the cycle life of the Deka Fahrenheit AGM battery at 50% DoD?"*
- *"What is the self-discharge rate of the LG home battery per month?"*
- *"How do the MPPT designs of Sunsynk and Hyundai PV inverters compare?"* (cross-vendor synthesis — neither doc contains a direct comparison)
- *"Enumerate all spare parts available for the LG RESU system."*

These are textbook spec-sheet / cross-vendor items I assumed would be in the PDFs. They aren't. That's a question-authoring failure, not a retriever failure.

It is **not** Case 2: the retriever pulled up to 200 candidates and the judge graded zero of them relevant. If the chunks existed, the judge would have found at least one in a pool that large.

## Why it kept happening

The previous runs used the same "imagine a plausible question from the vendor name" generator. That generator has no grounding step — it never reads a real chunk before writing a question. So abstentions are baked in by construction, and your instruction to drive them to zero couldn't be satisfied without changing the generator.

## Plan: corpus-grounded 100-question batch, 0 abstentions by construction

### 1. Sample real chunks from the corpus
- For each tier, pull a stratified random sample of `chunks.text` across the relevant document set (exclude `Career.docx`, `Portfolio.docx`, and `model-year-*-vehicles.pdf` — those aren't field-assistant content).
- Target counts: 25 lookup, 25 edge, 25 enumerate, 25 synthesis (synthesis pulls 2+ chunks from the **same** document so the answer is actually present).

### 2. Generate each question from the chunk text (grounded)
- Prompt Gemini Flash with the chunk text and a tier-specific instruction:
  - **lookup** → "Write one factual question whose answer is a single value/phrase that appears verbatim in this chunk."
  - **edge** → "Write one question about a limit, threshold, fault, or boundary condition that is explicitly stated in this chunk."
  - **enumerate** → "Write one question that asks to list items that are explicitly enumerated in this chunk."
  - **synthesis** → "Given these 2–3 chunks from the same document, write one question that requires combining facts stated across them."
- Reject any generated question that names a vendor/model not present in the source chunk. Also reject cross-vendor comparisons.
- Record the source `chunk_id`(s) per question as expected ground truth (used only for our own pre-flight check, not pushed to `eval_dataset` — we keep this Judge-only as previously agreed).

### 3. Pre-flight filter
- Before running, do a quick BM25/embedding lookup for each candidate question against the corpus and confirm the source chunk is recoverable. Drop and resample any question where the source chunk isn't in the top-50.
- This guarantees the answerable set ≥ 100; we keep generating until we have 25 valid per tier.

### 4. Run all 100 through `rag-query` with `judge=1`
- Same auth pattern as before: `bench_secrets` service-role key + `x-benchmark-user-id` header so they land in the Judge view under the bench user.
- Run in one go, no early stop.

### 5. Report
A single table, Judge-only, plus per-tier breakdown:

| Tier | n | Hit Rate | Precision | Recall | Avg K | Abstentions |
|---|---|---|---|---|---|---|
| lookup | 25 | … | … | … | … | **0 expected** |
| edge | 25 | … | … | … | … | **0 expected** |
| enumerate | 25 | … | … | … | … | **0 expected** |
| synthesis | 25 | … | … | … | … | **0 expected** |
| **Total** | 100 | … | … | … | … | **0 expected** |

If any abstentions still appear, they're now genuine retriever failures (Case 2) and we'll list each one with the source `chunk_id` so you can see exactly which grounded question the retriever missed.

## Out of scope
- No app code changes (no edits to `QueryAnalytics.tsx`, `rag-query`, or `run-eval`).
- No new benchmark row in `eval_dataset`.
- No K or retrieval-pipeline tuning.

Reply "approved" to proceed.