
ALTER TABLE public.documents 
ADD COLUMN IF NOT EXISTS ingestion_stage text DEFAULT 'queued';

-- Update existing documents to have correct stage based on current status
UPDATE public.documents SET ingestion_stage = 'complete' WHERE ingestion_status = 'complete';
UPDATE public.documents SET ingestion_stage = 'failed' WHERE ingestion_status = 'failed';
UPDATE public.documents SET ingestion_stage = 'embedding' WHERE ingestion_status = 'processing_embeddings';
UPDATE public.documents SET ingestion_stage = 'extracting' WHERE ingestion_status = 'in_progress' AND (total_chunks IS NULL OR total_chunks = 0);
UPDATE public.documents SET ingestion_stage = 'embedding' WHERE ingestion_status = 'in_progress' AND total_chunks > 0;
