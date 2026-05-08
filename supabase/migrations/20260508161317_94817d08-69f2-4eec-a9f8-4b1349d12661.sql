CREATE OR REPLACE FUNCTION public.match_chunks_hybrid(query_text text, query_embedding vector, doc_ids uuid[], match_count integer DEFAULT 60, vec_pool integer DEFAULT 100, kw_pool integer DEFAULT 100, rrf_k integer DEFAULT 60)
 RETURNS TABLE(id uuid, document_id uuid, chunk_index integer, text text, site text, equipment text, fault_code text, filename text, similarity double precision, kw_rank double precision, rrf_score double precision)
 LANGUAGE sql
 STABLE
AS $function$
  WITH
  q AS (SELECT websearch_to_tsquery('english', coalesce(query_text, '')) AS tsq),
  vec_all AS MATERIALIZED (
    SELECT c.id,
      (1 - (c.embedding <=> query_embedding))::double precision AS similarity,
      (c.embedding <=> query_embedding) AS dist
    FROM public.chunks c
    WHERE c.embedding IS NOT NULL AND c.document_id = ANY(doc_ids)
  ),
  vec AS (
    SELECT id, similarity,
      ROW_NUMBER() OVER (ORDER BY dist) AS rnk
    FROM vec_all
    ORDER BY dist
    LIMIT vec_pool
  ),
  kw AS (
    SELECT c.id,
      ts_rank_cd(c.text_tsv, (SELECT tsq FROM q))::double precision AS kw_rank,
      ROW_NUMBER() OVER (ORDER BY ts_rank_cd(c.text_tsv, (SELECT tsq FROM q)) DESC) AS rnk
    FROM public.chunks c, q
    WHERE c.document_id = ANY(doc_ids) AND q.tsq IS NOT NULL AND c.text_tsv @@ q.tsq
    ORDER BY ts_rank_cd(c.text_tsv, q.tsq) DESC
    LIMIT kw_pool
  ),
  fused AS (
    SELECT COALESCE(v.id, k.id) AS id,
      (COALESCE(1.0 / (rrf_k + v.rnk), 0) + COALESCE(1.0 / (rrf_k + k.rnk), 0))::double precision AS rrf_score,
      v.similarity, k.kw_rank
    FROM vec v FULL OUTER JOIN kw k ON v.id = k.id
  )
  SELECT c.id, c.document_id, c.chunk_index, c.text, c.site, c.equipment, c.fault_code, d.filename,
    COALESCE(f.similarity, (1 - (c.embedding <=> query_embedding))::double precision) AS similarity,
    COALESCE(f.kw_rank, 0::double precision) AS kw_rank,
    f.rrf_score
  FROM fused f
  JOIN public.chunks c ON c.id = f.id
  JOIN public.documents d ON d.id = c.document_id
  ORDER BY f.rrf_score DESC
  LIMIT match_count;
$function$;