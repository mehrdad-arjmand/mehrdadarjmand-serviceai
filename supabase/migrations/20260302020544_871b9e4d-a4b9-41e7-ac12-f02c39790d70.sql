
-- Drop the restrictive repo-write INSERT policy (redundant now)
DROP POLICY IF EXISTS "Users with repo write can create projects" ON public.projects;

-- Drop and recreate the admin ALL policy as permissive
DROP POLICY IF EXISTS "Admins can manage projects" ON public.projects;
CREATE POLICY "Admins can manage projects"
ON public.projects
FOR ALL
TO authenticated
USING (is_admin())
WITH CHECK (is_admin());
