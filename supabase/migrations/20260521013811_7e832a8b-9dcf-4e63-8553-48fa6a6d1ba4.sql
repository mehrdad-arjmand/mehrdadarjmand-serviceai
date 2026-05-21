ALTER TABLE public.eval_dataset
  ADD COLUMN IF NOT EXISTS benchmark_name text NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS tier text,
  ADD COLUMN IF NOT EXISTS answer_hint text,
  ADD COLUMN IF NOT EXISTS source_doc text,
  ADD COLUMN IF NOT EXISTS source_chunk_id uuid,
  ADD COLUMN IF NOT EXISTS k_target integer,
  ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_eval_dataset_benchmark_name ON public.eval_dataset (benchmark_name);
CREATE INDEX IF NOT EXISTS idx_eval_dataset_tier ON public.eval_dataset (tier);
CREATE INDEX IF NOT EXISTS idx_eval_dataset_k_target ON public.eval_dataset (k_target);