
-- Create query_logs table for evaluation metrics
CREATE TABLE public.query_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  user_id uuid,
  query_text text NOT NULL,
  retrieved_chunk_ids uuid[] DEFAULT '{}',
  retrieved_similarities double precision[] DEFAULT '{}',
  response_text text,
  citations_json jsonb DEFAULT '[]',
  input_tokens integer DEFAULT 0,
  output_tokens integer DEFAULT 0,
  total_tokens integer DEFAULT 0,
  execution_time_ms integer DEFAULT 0
);

-- Enable RLS
ALTER TABLE public.query_logs ENABLE ROW LEVEL SECURITY;

-- Only admins can read query logs (evaluation data)
CREATE POLICY "Admins can read query logs"
  ON public.query_logs FOR SELECT
  USING (is_admin());

-- Service role inserts (from edge function), no user INSERT policy needed
-- Edge function uses service role client which bypasses RLS

-- Index for time-based queries
CREATE INDEX idx_query_logs_created_at ON public.query_logs (created_at DESC);
