ALTER TABLE public.query_logs
ADD COLUMN IF NOT EXISTS top_k_eval integer;

UPDATE public.query_logs
SET top_k_eval = LEAST(
  200,
  COALESCE(jsonb_array_length(relevance_labels), array_length(retrieved_chunk_ids, 1), top_k, 0)
)
WHERE top_k_eval IS NULL;