-- Fix vector search for RAG: properly configure embeddings and match function
-- Google's text-embedding-004 produces 768-dimensional vectors

-- Step 1: Drop existing function to allow signature change
DROP FUNCTION IF EXISTS match_chunks(vector, double precision, integer);

-- Step 2: Recreate the embedding column with correct dimension
ALTER TABLE chunks DROP COLUMN IF EXISTS embedding;
ALTER TABLE chunks ADD COLUMN embedding vector(768);

-- Step 3: Create the match_chunks function with proper vector similarity search
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
  fault_code text,
  filename text
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.document_id,
    c.chunk_index,
    c.text,
    1 - (c.embedding <=> query_embedding) as similarity,
    c.site,
    c.equipment,
    c.fault_code,
    d.filename
  FROM chunks c
  LEFT JOIN documents d ON c.document_id = d.id
  WHERE c.embedding IS NOT NULL
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Step 4: Create an index for faster vector similarity search
CREATE INDEX IF NOT EXISTS chunks_embedding_idx ON chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);