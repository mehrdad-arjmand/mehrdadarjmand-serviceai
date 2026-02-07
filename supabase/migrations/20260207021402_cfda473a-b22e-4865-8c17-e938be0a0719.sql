-- Add allowed_roles column to documents table for role-based access control
-- This will be a text array storing which roles can access each document

ALTER TABLE public.documents
ADD COLUMN allowed_roles text[] DEFAULT ARRAY['admin']::text[];

-- Add comment explaining the column
COMMENT ON COLUMN public.documents.allowed_roles IS 'Array of role names that can access this document. If contains "all", all roles can access.';

-- Update RLS policy to filter documents by role
DROP POLICY IF EXISTS "Authenticated users can read documents" ON public.documents;

CREATE POLICY "Users can read documents based on role"
ON public.documents
FOR SELECT
TO authenticated
USING (
  -- Check if user's role is in the allowed_roles array OR if 'all' is in allowed_roles
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
    AND (
      ur.role = ANY(allowed_roles)
      OR 'all' = ANY(allowed_roles)
    )
  )
  -- Fallback: admin can always see everything
  OR is_admin()
);