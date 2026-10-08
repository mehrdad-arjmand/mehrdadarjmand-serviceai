# Architecture rules

- rag-query selects a uniform K=10 from the hybrid pool after an exact entity/config-token rerank over the top 60, with a 2-chunks-per-document cap when the question names no product — keeps single-product spec tables from crowding out others.
- rag-query normalizes configuration tokens in queries (".25 P" → "0.25P") and ingest normalizes split numbers/tokens in PDF text — embeddings and BM25 must see the same token form.
- rag-query abstains deterministically when a queried configuration token exists nowhere in the project, and replaces answers whose numbers are not in a chunk naming the queried entity/config — prevents cross-product value borrowing.
- query_logs.upstream_inference_cost uses the gateway cost field when present, otherwise a token × price-table estimate in rag-query — keeps the cost tile populated.
- Regression cases from external briefs live in their own eval_dataset benchmark_name, never in the locked 100-question Gold set.
