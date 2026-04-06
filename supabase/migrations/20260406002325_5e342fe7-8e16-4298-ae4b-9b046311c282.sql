
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS embedding_locked_until timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS embedding_retry_after timestamptz DEFAULT NULL;
