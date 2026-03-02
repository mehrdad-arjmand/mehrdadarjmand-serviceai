
-- Fix SELECT policy to be permissive
DROP POLICY IF EXISTS "Users can read accessible projects" ON public.projects;
CREATE POLICY "Users can read accessible projects"
ON public.projects
FOR SELECT
TO authenticated
USING (user_has_project_access(id));

-- Fix UPDATE policy to be permissive
DROP POLICY IF EXISTS "Users with landing write can update projects" ON public.projects;
CREATE POLICY "Users with landing write can update projects"
ON public.projects
FOR UPDATE
TO authenticated
USING (has_permission('landing', 'write', auth.uid()) AND user_has_project_access(id))
WITH CHECK (has_permission('landing', 'write', auth.uid()));
