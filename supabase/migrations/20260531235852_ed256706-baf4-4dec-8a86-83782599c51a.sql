UPDATE public.query_logs
SET top_k_eval = 200
WHERE evaluated_at IS NOT NULL
  AND relevant_in_top_k IS NOT NULL
  AND response_text LIKE 'tier=%'
  AND top_k_eval <= 10;