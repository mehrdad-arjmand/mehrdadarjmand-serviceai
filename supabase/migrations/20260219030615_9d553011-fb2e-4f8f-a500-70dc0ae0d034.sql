
-- Fix 1: Replace permissive chunks RLS policy with document-level access control
DROP POLICY IF EXISTS "Authenticated users can read chunks" ON public.chunks;

CREATE POLICY "Users can read chunks from accessible documents"
ON public.chunks
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.documents d
    INNER JOIN public.user_roles ur ON ur.user_id = auth.uid()
    WHERE d.id = chunks.document_id
    AND (ur.role = ANY(d.allowed_roles) OR 'all' = ANY(d.allowed_roles))
  )
  OR is_admin()
);

-- Fix 2: Update match_chunks() to enforce document-level access control within the function
CREATE OR REPLACE FUNCTION public.match_chunks(
  query_embedding vector,
  match_threshold double precision DEFAULT 0.5,
  match_count integer DEFAULT 5,
  p_user_id uuid DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  document_id uuid,
  chunk_index integer,
  text text,
  similarity double precision,
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
DECLARE
  target_user_id uuid;
  user_role text;
  is_user_admin boolean;
BEGIN
  target_user_id := COALESCE(p_user_id, auth.uid());

  -- Get user's role
  SELECT ur.role INTO user_role
  FROM public.user_roles ur
  WHERE ur.user_id = target_user_id
  LIMIT 1;

  -- Check if user is admin
  SELECT check_is_admin(target_user_id) INTO is_user_admin;

  RETURN QUERY
  SELECT
    c.id,
    c.document_id,
    c.chunk_index,
    c.text,
    1 - (c.embedding <=> query_embedding) AS similarity,
    c.site,
    c.equipment,
    c.fault_code,
    d.filename
  FROM public.chunks c
  LEFT JOIN public.documents d ON c.document_id = d.id
  WHERE c.embedding IS NOT NULL
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
    AND (
      is_user_admin
      OR user_role = ANY(d.allowed_roles)
      OR 'all' = ANY(d.allowed_roles)
    )
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
