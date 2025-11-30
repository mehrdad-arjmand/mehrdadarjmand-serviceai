-- Fix search path security issue for match_chunks function
DROP FUNCTION IF EXISTS match_chunks(vector(768), double precision, integer);

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
STABLE
SECURITY DEFINER
SET search_path = public
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