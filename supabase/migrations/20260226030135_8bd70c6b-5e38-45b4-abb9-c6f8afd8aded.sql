-- Drop and recreate the SELECT policy on projects to check project_allowed_users
DROP POLICY IF EXISTS "Users can read accessible projects" ON public.projects;

CREATE POLICY "Users can read accessible projects"
ON public.projects
FOR SELECT
TO authenticated
USING (
  is_admin()
  OR created_by = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.project_allowed_users pau
    WHERE pau.project_id = projects.id
      AND pau.user_id = auth.uid()
  )
  OR ('all' = ANY(allowed_roles))
);