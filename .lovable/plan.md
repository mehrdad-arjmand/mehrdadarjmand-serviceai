## Goal
Test whether raising K from 5 → 10 on **lookup** and **edge** tiers produces the same recall lift we saw on enumerate/synthesis, and quantify the precision/F1 cost. Diagnose whether lookup has a structural ceiling beyond K alone.

## Change
**One file, one constant block.**

`supabase/functions/run-eval/index.ts` (around lines 394–396): change the per-tier K map from
```
lookup: 5, edge: 5, enumerate: 10, synthesis: 10
```
to
```
lookup: 10, edge: 10, enumerate: 10, synthesis: 10
```
i.e. uniform K=10 across all tiers. This isolates the K effect on lookup/edge while keeping enumerate/synthesis as a control (they should be unchanged vs the previous run).

No retrieval-pipeline changes. No pool changes (stays at 200). No judge changes.

## Run
1. Deploy `run-eval`.
2. Call `POST /functions/v1/run-eval?action=run-eval&judge=1&limit=100` with the `bench_secrets` service-role key + `x-benchmark-user-id` header (per `sandbox-benchmark-auth` memory).
3. Wait for completion (~50–80s expected).

## Report
Side-by-side vs the previous run (K=5/5/10/10):

**Aggregate**
| Metric | Prev (5/5/10/10) | New (10/10/10/10) | Δ |

**Per tier** — for each of lookup, edge, enumerate, synthesis:
| Tier | K | Precision (Δ) | Recall (Δ) | F1 (Δ) |

Enumerate/synthesis rows act as the **control** — they should be flat (same K=10). Lookup/edge rows show the isolated K effect.

## Decision framework after the run
- **If lookup recall lifts to ≥0.65 and edge ≥0.80:** K=10 uniform is the new production config. Done.
- **If lookup stays ≤0.55 even at K=10:** confirms structural ceiling (reasons 2 & 3 above). Next levers, in order of ROI:
  1. **Pool-side boost for short chunks** — penalize chunk-length normalization in RRF so table cells aren't drowned out.
  2. **Cross-encoder rerank** of top-50 of fused pool (the #4 suggestion previously deferred). Highest expected lift for lookup specifically because rerankers excel at exact-fact matching.
  3. **Hybrid query expansion** — generate 1–2 keyword-heavy paraphrases per lookup query and union the pools.
- **If F1 drops below ~0.20:** consider tier-specific K cap (e.g. lookup K=8) — diminishing-returns territory you flagged.

## Out of scope
- No K above 10 (your diminishing-returns guidance).
- No reranking yet — we want clean signal on the K=10 step first.
- No changes to live `rag-query`. We'll only port the K change after the benchmark confirms the win.

Reply "approved" to proceed.