
-- Add per-query retrieval evaluation columns to query_logs
ALTER TABLE public.query_logs
  ADD COLUMN IF NOT EXISTS total_relevant_chunks integer,
  ADD COLUMN IF NOT EXISTS relevant_in_top_k integer,
  ADD COLUMN IF NOT EXISTS precision_at_k double precision,
  ADD COLUMN IF NOT EXISTS recall_at_k double precision,
  ADD COLUMN IF NOT EXISTS hit_rate_at_k smallint,
  ADD COLUMN IF NOT EXISTS first_relevant_rank integer,
  ADD COLUMN IF NOT EXISTS relevance_labels jsonb,
  ADD COLUMN IF NOT EXISTS eval_model text,
  ADD COLUMN IF NOT EXISTS evaluated_at timestamp with time zone;

-- Create eval_runs table for aggregate evaluation results
CREATE TABLE IF NOT EXISTS public.eval_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by uuid,
  total_queries integer NOT NULL DEFAULT 0,
  avg_precision_at_k double precision NOT NULL DEFAULT 0,
  avg_recall_at_k double precision NOT NULL DEFAULT 0,
  avg_hit_rate_at_k double precision NOT NULL DEFAULT 0,
  mrr double precision NOT NULL DEFAULT 0,
  k_used text NOT NULL DEFAULT 'per-query top_k',
  eval_model text NOT NULL DEFAULT 'unknown',
  notes text
);

-- Enable RLS on eval_runs
ALTER TABLE public.eval_runs ENABLE ROW LEVEL SECURITY;

-- Only admins can read/write eval_runs
CREATE POLICY "Admins can manage eval_runs"
  ON public.eval_runs
  FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());
