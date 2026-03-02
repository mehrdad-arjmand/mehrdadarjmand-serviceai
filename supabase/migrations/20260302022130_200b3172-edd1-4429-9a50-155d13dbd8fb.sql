
-- Fix user_has_project_access to also check role-based access
CREATE OR REPLACE FUNCTION public.user_has_project_access(p_project_id uuid, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  
  -- Check if user's role is in the project's allowed_roles
  IF EXISTS (
    SELECT 1 FROM public.projects p
    JOIN public.user_roles ur ON ur.user_id = target_user_id
    WHERE p.id = p_project_id AND ur.role = ANY(p.allowed_roles)
  ) THEN
    RETURN true;
  END IF;
  
  RETURN false;
END;
$function$;
