UPDATE public.query_logs
SET evaluated_at = NULL,
    precision_at_k = NULL,
    recall_at_k = NULL,
    hit_rate_at_k = NULL,
    first_relevant_rank = NULL,
    relevant_in_top_k = NULL,
    total_relevant_chunks = NULL,
    top_k_eval = NULL,
    eval_model = COALESCE(eval_model, '') || ' (judge_failed)'
WHERE evaluated_at IS NOT NULL
  AND relevance_labels IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(relevance_labels) e
    WHERE e->>'reasoning' IN ('Parse error','LLM evaluation failed','LOVABLE_API_KEY not configured','Chunk not found')
  );