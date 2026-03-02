
-- Drop ALL existing policies on projects table
DROP POLICY IF EXISTS "Authenticated users can create projects" ON public.projects;
DROP POLICY IF EXISTS "Admins can manage projects" ON public.projects;
DROP POLICY IF EXISTS "Users can read accessible projects" ON public.projects;
DROP POLICY IF EXISTS "Users with landing write can update projects" ON public.projects;

-- Recreate ALL as PERMISSIVE (explicit)
CREATE POLICY "Admins can manage projects"
ON public.projects AS PERMISSIVE
FOR ALL TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

CREATE POLICY "Authenticated users can create projects"
ON public.projects AS PERMISSIVE
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can read accessible projects"
ON public.projects AS PERMISSIVE
FOR SELECT TO authenticated
USING (user_has_project_access(id));

CREATE POLICY "Users with landing write can update projects"
ON public.projects AS PERMISSIVE
FOR UPDATE TO authenticated
USING (has_permission('landing', 'write', auth.uid()) AND user_has_project_access(id))
WITH CHECK (has_permission('landing', 'write', auth.uid()));
