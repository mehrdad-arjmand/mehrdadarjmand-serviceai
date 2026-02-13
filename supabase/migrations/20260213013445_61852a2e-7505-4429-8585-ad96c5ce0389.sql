
-- Add top_k and upstream_inference_cost to query_logs
ALTER TABLE public.query_logs 
  ADD COLUMN IF NOT EXISTS top_k integer DEFAULT 30,
  ADD COLUMN IF NOT EXISTS upstream_inference_cost double precision DEFAULT 0;

-- Create eval_dataset table for ground-truth evaluation
CREATE TABLE public.eval_dataset (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  query_text text NOT NULL,
  expected_chunk_ids uuid[] NOT NULL DEFAULT '{}',
  description text,
  created_by uuid
);

-- Enable RLS
ALTER TABLE public.eval_dataset ENABLE ROW LEVEL SECURITY;

-- Only admins can manage eval datasets
CREATE POLICY "Admins can manage eval_dataset"
  ON public.eval_dataset FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());
