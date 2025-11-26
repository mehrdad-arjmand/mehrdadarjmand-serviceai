-- Create documents table to store uploaded PDFs
CREATE TABLE public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  doc_type TEXT DEFAULT 'unknown',
  uploaded_at TIMESTAMPTZ DEFAULT now()
);

-- Create chunks table with vector embeddings
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE public.chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  embedding vector(384),
  site TEXT,
  equipment TEXT,
  fault_code TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create index for vector similarity search
CREATE INDEX ON public.chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Enable RLS
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chunks ENABLE ROW LEVEL SECURITY;

-- Public access policies (since this is a demo without auth)
CREATE POLICY "Allow public read on documents" ON public.documents FOR SELECT USING (true);
CREATE POLICY "Allow public insert on documents" ON public.documents FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public delete on documents" ON public.documents FOR DELETE USING (true);

CREATE POLICY "Allow public read on chunks" ON public.chunks FOR SELECT USING (true);
CREATE POLICY "Allow public insert on chunks" ON public.chunks FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public delete on chunks" ON public.chunks FOR DELETE USING (true);