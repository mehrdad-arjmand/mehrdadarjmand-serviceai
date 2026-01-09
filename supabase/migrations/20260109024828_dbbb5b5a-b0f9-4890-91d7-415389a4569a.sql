-- Add total_chunks column to track expected vs actual chunks for accurate completion status
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS total_chunks integer DEFAULT 0;

-- Update existing documents to have total_chunks match their actual chunk count
UPDATE public.documents d 
SET total_chunks = (
  SELECT COUNT(*) FROM public.chunks c WHERE c.document_id = d.id
)
WHERE total_chunks = 0 OR total_chunks IS NULL;