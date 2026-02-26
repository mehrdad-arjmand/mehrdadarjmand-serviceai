-- Create a security definer function to check project access without RLS recursion
CREATE OR REPLACE FUNCTION public.user_has_project_access(p_project_id uuid, p_user_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  target_user_id uuid;
BEGIN
  target_user_id := COALESCE(p_user_id, auth.uid());
  
  -- Admin always has access
  IF check_is_admin(target_user_id) THEN
    RETURN true;
  END IF;
  
  -- Check if user created the project
  IF EXISTS (SELECT 1 FROM public.projects WHERE id = p_project_id AND created_by = target_user_id) THEN
    RETURN true;
  END IF;
  
  -- Check if user is in project_allowed_users
  IF EXISTS (SELECT 1 FROM public.project_allowed_users WHERE project_id = p_project_id AND user_id = target_user_id) THEN
    RETURN true;
  END IF;
  
  -- Check if project has 'all' in allowed_roles
  IF EXISTS (SELECT 1 FROM public.projects WHERE id = p_project_id AND 'all' = ANY(allowed_roles)) THEN
    RETURN true;
  END IF;
  
  RETURN false;
END;
$$;

-- Update projects SELECT policy to use the function
DROP POLICY IF EXISTS "Users can read accessible projects" ON public.projects;
CREATE POLICY "Users can read accessible projects"
ON public.projects
FOR SELECT
TO authenticated
USING (user_has_project_access(id));

-- Update project_allowed_users SELECT policy to use the function too
DROP POLICY IF EXISTS "Users can read project allowed users" ON public.project_allowed_users;
CREATE POLICY "Users can read project allowed users"
ON public.project_allowed_users
FOR SELECT
TO authenticated
USING (user_has_project_access(project_id) OR is_admin());

-- Update project_metadata_fields SELECT policy
DROP POLICY IF EXISTS "Users can read metadata fields of accessible projects" ON public.project_metadata_fields;
CREATE POLICY "Users can read metadata fields of accessible projects"
ON public.project_metadata_fields
FOR SELECT
TO authenticated
USING (user_has_project_access(project_id) OR is_admin());

-- Fix the UPDATE policy on projects to avoid recursion too
DROP POLICY IF EXISTS "Users with landing write can update projects" ON public.projects;
CREATE POLICY "Users with landing write can update projects"
ON public.projects
FOR UPDATE
TO authenticated
USING (
  has_permission('landing', 'write', auth.uid())
  AND user_has_project_access(id)
)
WITH CHECK (
  has_permission('landing', 'write', auth.uid())
);