-- Also update documents policy to respect project-level user access
DROP POLICY IF EXISTS "Users can read documents based on role" ON public.documents;

CREATE POLICY "Users can read documents based on role"
ON public.documents
FOR SELECT
TO authenticated
USING (
  is_admin()
  OR (
    -- User must have access to the parent project
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = documents.project_id
        AND (
          p.created_by = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.project_allowed_users pau
            WHERE pau.project_id = p.id AND pau.user_id = auth.uid()
          )
          OR ('all' = ANY(p.allowed_roles))
        )
    )
    -- AND user's role must match document's allowed_roles
    AND (
      EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid()
          AND (ur.role = ANY(documents.allowed_roles) OR 'all' = ANY(documents.allowed_roles))
      )
    )
  )
);