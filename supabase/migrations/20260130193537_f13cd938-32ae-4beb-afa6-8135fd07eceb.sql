-- Fix: Restrict chunks INSERT to users with repository.write permission
-- This prevents unauthorized content injection into the knowledge base

-- Drop the existing overly permissive INSERT policy
DROP POLICY IF EXISTS "Authenticated users can insert chunks" ON public.chunks;

-- Create new policy that restricts INSERT to users with repository.write permission
CREATE POLICY "Users with repository write can insert chunks"
ON public.chunks
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_permission('repository', 'write', auth.uid())
);

-- Also fix documents table INSERT policy to be consistent
DROP POLICY IF EXISTS "Authenticated users can insert documents" ON public.documents;

CREATE POLICY "Users with repository write can insert documents"
ON public.documents
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_permission('repository', 'write', auth.uid())
);

-- Fix documents UPDATE policy as well - should require write permission
DROP POLICY IF EXISTS "Authenticated users can update documents" ON public.documents;

CREATE POLICY "Users with repository write can update documents"
ON public.documents
FOR UPDATE
TO authenticated
USING (public.has_permission('repository', 'write', auth.uid()))
WITH CHECK (public.has_permission('repository', 'write', auth.uid()));