-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create documents table
CREATE TABLE IF NOT EXISTS public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  doc_type TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT now()
);

-- Create chunks table with vector embeddings
CREATE TABLE IF NOT EXISTS public.chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  embedding vector(768),
  site TEXT,
  equipment TEXT,
  fault_code TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chunks ENABLE ROW LEVEL SECURITY;

-- Public access policies (no auth required for demo)
CREATE POLICY "Allow public read access to documents" ON public.documents FOR SELECT USING (true);
CREATE POLICY "Allow public insert access to documents" ON public.documents FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public delete access to documents" ON public.documents FOR DELETE USING (true);

CREATE POLICY "Allow public read access to chunks" ON public.chunks FOR SELECT USING (true);
CREATE POLICY "Allow public insert access to chunks" ON public.chunks FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public delete access to chunks" ON public.chunks FOR DELETE USING (true);

-- Create index on embeddings for faster similarity search
CREATE INDEX IF NOT EXISTS chunks_embedding_idx ON public.chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Create function for vector similarity search
CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding vector(768),
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  chunk_index int,
  text text,
  similarity float,
  site text,
  equipment text,
  fault_code text
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    chunks.id,
    chunks.document_id,
    chunks.chunk_index,
    chunks.text,
    1 - (chunks.embedding <=> query_embedding) AS similarity,
    chunks.site,
    chunks.equipment,
    chunks.fault_code
  FROM chunks
  WHERE chunks.embedding IS NOT NULL
    AND 1 - (chunks.embedding <=> query_embedding) > match_threshold
  ORDER BY chunks.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;