DROP INDEX IF EXISTS public.idx_eval_dataset_query_text_normalized;

CREATE UNIQUE INDEX IF NOT EXISTS idx_eval_dataset_benchmark_query_normalized
ON public.eval_dataset (
  benchmark_name,
  lower(regexp_replace(btrim(query_text), '\s+', ' ', 'g'))
);