ALTER TABLE public.documents
ADD COLUMN IF NOT EXISTS embedding_failure_count integer DEFAULT 0;