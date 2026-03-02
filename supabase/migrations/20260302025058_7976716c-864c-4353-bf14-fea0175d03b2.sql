
-- ============================================
-- FIX 1: Force all project policies to PERMISSIVE
-- Drop ALL existing policies on projects (regardless of name)
-- ============================================
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname FROM pg_policies WHERE tablename = 'projects' AND schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.projects', pol.policyname);
    END LOOP;
END $$;

-- Recreate as PERMISSIVE (explicitly)
CREATE POLICY "admin_manage_projects"
ON public.projects AS PERMISSIVE
FOR ALL TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

CREATE POLICY "users_insert_own_projects"
ON public.projects AS PERMISSIVE
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "users_read_accessible_projects"
ON public.projects AS PERMISSIVE
FOR SELECT TO authenticated
USING (user_has_project_access(id));

CREATE POLICY "users_update_accessible_projects"
ON public.projects AS PERMISSIVE
FOR UPDATE TO authenticated
USING (has_permission('landing', 'write', auth.uid()) AND user_has_project_access(id))
WITH CHECK (has_permission('landing', 'write', auth.uid()));

-- ============================================
-- FIX 2: Update user_has_project_access logic
-- When project_allowed_users has entries, ONLY those users get access
-- Roles are just a filter for the user picker, not standalone access
-- ============================================
CREATE OR REPLACE FUNCTION public.user_has_project_access(p_project_id uuid, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  target_user_id uuid;
  has_specific_users boolean;
BEGIN
  target_user_id := COALESCE(p_user_id, auth.uid());
  
  -- Admin always has access
  IF check_is_admin(target_user_id) THEN
    RETURN true;
  END IF;
  
  -- Creator always has access
  IF EXISTS (SELECT 1 FROM public.projects WHERE id = p_project_id AND created_by = target_user_id) THEN
    RETURN true;
  END IF;
  
  -- Check if 'all' is in allowed_roles (open to everyone)
  IF EXISTS (SELECT 1 FROM public.projects WHERE id = p_project_id AND 'all' = ANY(allowed_roles)) THEN
    RETURN true;
  END IF;
  
  -- Check if there are specific users assigned to this project
  SELECT EXISTS (SELECT 1 FROM public.project_allowed_users WHERE project_id = p_project_id) INTO has_specific_users;
  
  IF has_specific_users THEN
    -- When specific users are set, ONLY those users get access (roles are just a filter)
    RETURN EXISTS (
      SELECT 1 FROM public.project_allowed_users 
      WHERE project_id = p_project_id AND user_id = target_user_id
    );
  ELSE
    -- No specific users set: fall back to role-based access
    RETURN EXISTS (
      SELECT 1 FROM public.projects p
      JOIN public.user_roles ur ON ur.user_id = target_user_id
      WHERE p.id = p_project_id AND ur.role = ANY(p.allowed_roles)
    );
  END IF;
END;
$$;
