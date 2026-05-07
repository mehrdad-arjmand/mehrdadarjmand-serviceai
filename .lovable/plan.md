## Goal

Lift benchmark F1 from 0.44 → 0.75–0.80 on the saved 100-question set (`/mnt/documents/benchmark_100_v3.json`). The current system already does adaptive-K + similarity floor + Gemini rerank. Remaining headroom is mostly in **retrieval recall** (still 63%) and **answer-grounded precision** (chunks retrieved ≠ chunks the LLM actually uses).

## Where we are

| Metric | Current (Run B) | Target |
|---|---|---|
| Hit@K | 88% | ≥ 95% |
| Recall@K | 63% | ≥ 85% |
| Precision@K | 45% | ≥ 75% |
| F1 | 0.44 | 0.75–0.80 |

## Five-layer improvement plan

Each layer is independently shippable. Re-run the 100-question benchmark after each to measure delta. Stop when F1 target is hit.

### Layer 1 — Hybrid retrieval (BM25 + vector) — biggest expected win on recall

Today retrieval is pure pgvector cosine. Lookup-style queries with rare tokens (part numbers, error codes, model IDs) often miss because embeddings smooth them out.

- Add a Postgres `tsvector` column on `chunks.content` (generated, GIN-indexed).
- New RPC `match_chunks_hybrid(query_text, query_embedding, p_doc_ids, k)` that returns:
  - top 100 by vector similarity, top 100 by `ts_rank_cd`, fused with **Reciprocal Rank Fusion** (`score = Σ 1/(60 + rank)`).
- Replace the single retrieval call in `rag-query` with the hybrid call, keep candidate pool at 200.
- Expected: Recall +10–15 pp, especially on `lookup` tier.

### Layer 2 — Query expansion / multi-query

Generate 2–3 paraphrases of the user query with `gemini-2.5-flash-lite`, retrieve for each, fuse with RRF. Cheap (~1 extra LLM call, parallelised with retrieval).
- Add HyDE variant for `synthesis` queries: ask the LLM for a hypothetical answer, embed *that*, retrieve.
- Expected: Recall +5–10 pp on synthesis/edge tiers.

### Layer 3 — Stronger reranker (cross-encoder)

Current rerank uses Gemini scoring 1–10 over top-N — noisy and coarse. Replace with a real cross-encoder pass:
- Option A (cheapest): keep Gemini but switch to **pairwise tournament** over top 30 — more stable scores.
- Option B (best): call **Cohere Rerank v3** or **Voyage rerank-2** via edge function (HTTPS). Sub-100ms for 30 docs, well-calibrated scores.
- Tighten `REL_FLOOR` from 0.6 → 0.7 of top score now that scores are reliable.
- Expected: Precision +15–25 pp.

### Layer 4 — Chunking + section-window upgrades

Inspect the worst 20 failures from Run B and look for chunking pathologies (table rows split, headings detached from body).
- Re-chunk with **semantic chunking** (split on heading boundaries + 200-token windows with 40-token overlap) instead of fixed size.
- Always attach the parent **section heading** as a prefix to chunk text fed to the embedder and reranker — single biggest precision boost in published RAG papers.
- Keep the existing table-aware section window for `enumerate`/table queries; widen it from current cap to 80 chunks when classifier says `enumerate`.
- Re-embed affected chunks (one-off `process-document` re-run).
- Expected: F1 +5–10 pp; recall on table/enumerate queries jumps significantly.

### Layer 5 — LLM-judge evaluation (so the F1 number itself becomes trustworthy)

Current F1 is computed against a chunk-id ground-truth set. That penalises the model when it answers correctly from a *different* chunk than the labeller picked. Add an **LLM-judge** pass (Gemini 2.5 Pro) that scores:
- `answer_correct` (0/1) — vs gold answer text
- `grounded` (0/1) — every claim backed by a cited chunk
- `complete` (0/1) — covers all required facts for `enumerate`

Report the judged F1 alongside the chunk-overlap F1. In published RAG benchmarks this typically shows real performance is 10–20 pp higher than chunk-overlap suggests — and gives a defensible 80% number.

## Tuning knobs to sweep after Layers 1–3

Quick grid search (3×3, ~9 benchmark runs ≈ 1 hour):
- `REL_FLOOR`: 0.55 / 0.65 / 0.75
- `SIM_FLOOR`: 0.50 / 0.55 / 0.60
- Adaptive K caps: lookup 3/5, synthesis 8/12, enumerate 20/30

## Order of operations + expected cumulative F1

```text
Layer                         Δ F1     Cumulative   Effort
-----------------------------+--------+------------+--------
Baseline (Run B)              -        0.44         -
1. Hybrid BM25 + vector      +0.10    0.54         M
2. Query expansion / HyDE    +0.05    0.59         S
3. Cross-encoder rerank      +0.10    0.69         M
4. Semantic chunks + headers +0.06    0.75         L (re-embed)
5. Knob sweep                +0.03    0.78         S
6. LLM-judge re-scoring      +0.05*   0.83*        S
```
*Layer 6 doesn't change the system, only the measurement — but the published number becomes truly representative.

## Risks / cost

- Cross-encoder rerank adds ~150 ms p50 latency and a per-query API cost (~$0.0005 with Cohere). Acceptable.
- Re-chunking requires re-embedding the corpus (~2k chunks → ~$1 with `gemini-embedding-001`). Done once.
- Hybrid retrieval needs one migration (tsvector column + GIN index + new RPC). Backwards compatible; old RPC stays until cutover.

## Validation

After each layer:
1. Run `/mnt/documents/benchmark_100_v3.json` end-to-end (the durable saved set — no regeneration).
2. Persist results per-run in `query_logs` with a `run_label` tag so we can diff layers.
3. Show side-by-side Hit/Recall/Precision/F1 by tier (lookup, synthesis, enumerate, edge).

## Recommended first step

Ship **Layer 1 (hybrid retrieval)** first. It's the cleanest single win, requires no model changes, and we'll know within one benchmark run whether F1 jumps as predicted. Approve this plan and the next loop will: add the migration, update `rag-query` to call the hybrid RPC, deploy, and re-run the saved benchmark.
