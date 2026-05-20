WITH stats AS (
  SELECT
    q.id,
    COUNT(l.value) AS labels,
    COUNT(*) FILTER (
      WHERE l.value->>'reasoning' IN ('LLM evaluation failed', 'Parse error', 'LOVABLE_API_KEY not configured', 'Chunk not found')
    ) AS failed_labels
  FROM public.query_logs q
  LEFT JOIN LATERAL jsonb_array_elements(COALESCE(q.relevance_labels, '[]'::jsonb)) AS l(value) ON TRUE
  WHERE q.evaluated_at IS NOT NULL
  GROUP BY q.id
),
polluted AS (
  SELECT id FROM stats
  WHERE labels > 0 AND failed_labels::float / labels >= 0.5
)
UPDATE public.query_logs q
SET
  evaluated_at = NULL,
  first_relevant_rank = NULL,
  relevant_in_top_k = NULL,
  total_relevant_chunks = NULL,
  precision_at_k = NULL,
  recall_at_k = NULL,
  hit_rate_at_k = NULL,
  top_k_eval = NULL,
  eval_model = CASE
    WHEN q.eval_model LIKE '%(judge_failed)%' THEN q.eval_model
    ELSE COALESCE(q.eval_model, 'unknown') || ' (judge_failed)'
  END
FROM polluted p
WHERE q.id = p.id;