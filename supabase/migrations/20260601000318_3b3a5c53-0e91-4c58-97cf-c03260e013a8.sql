ALTER TABLE public.query_logs
  ADD COLUMN IF NOT EXISTS judge_tp integer,
  ADD COLUMN IF NOT EXISTS judge_fp integer;

-- Backfill from existing relevance_labels jsonb arrays.
-- judge_tp = number of labels with relevant=true within rank <= top_k.
-- judge_fp = top_k - judge_tp.
WITH derived AS (
  SELECT
    ql.id,
    ql.top_k,
    COALESCE((
      SELECT count(*)::int
      FROM jsonb_array_elements(ql.relevance_labels) lbl
      WHERE (lbl->>'relevant')::boolean = true
        AND COALESCE((lbl->>'rank')::int, 0) <= COALESCE(ql.top_k, 0)
    ), 0) AS tp
  FROM public.query_logs ql
  WHERE ql.relevance_labels IS NOT NULL
    AND jsonb_typeof(ql.relevance_labels) = 'array'
)
UPDATE public.query_logs ql
SET judge_tp = d.tp,
    judge_fp = GREATEST(COALESCE(ql.top_k, 0) - d.tp, 0)
FROM derived d
WHERE ql.id = d.id;