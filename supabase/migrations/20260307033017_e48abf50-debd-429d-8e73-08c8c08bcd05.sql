
CREATE OR REPLACE FUNCTION public.match_chunks_by_docs(
  query_embedding vector(768),
  doc_ids uuid[],
  match_threshold float DEFAULT 0.15,
  match_count int DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  chunk_index int,
  text text,
  site text,
  equipment text,
  fault_code text,
  filename text,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    c.id,
    c.document_id,
    c.chunk_index,
    c.text,
    c.site,
    c.equipment,
    c.fault_code,
    d.filename,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM public.chunks c
  JOIN public.documents d ON d.id = c.document_id
  WHERE c.embedding IS NOT NULL
    AND c.document_id = ANY(doc_ids)
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;
