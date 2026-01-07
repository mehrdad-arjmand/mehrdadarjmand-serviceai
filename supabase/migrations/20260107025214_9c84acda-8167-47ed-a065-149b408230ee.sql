-- Add ingestion status tracking columns to documents table
ALTER TABLE public.documents
ADD COLUMN IF NOT EXISTS page_count integer,
ADD COLUMN IF NOT EXISTS ingested_chunks integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS ingestion_status text DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS ingestion_error text;

-- Add RLS policy for UPDATE on documents (needed for status updates)
CREATE POLICY "Allow public update on documents"
ON public.documents
FOR UPDATE
USING (true)
WITH CHECK (true);