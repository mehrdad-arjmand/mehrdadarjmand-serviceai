
-- Drop existing functions that need return type changes
DROP FUNCTION IF EXISTS public.get_all_roles();
DROP FUNCTION IF EXISTS public.get_user_permissions(uuid);

-- Recreate get_all_roles with api_tier
CREATE OR REPLACE FUNCTION public.get_all_roles()
 RETURNS TABLE(role text, description text, repository_read boolean, repository_write boolean, repository_delete boolean, assistant_read boolean, assistant_write boolean, assistant_delete boolean, landing_read boolean, landing_write boolean, landing_delete boolean, user_count bigint, api_tier text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT is_admin() THEN RAISE EXCEPTION 'Access denied: admin role required'; END IF;
    RETURN QUERY
    SELECT rp.role, rp.description, rp.repository_read, rp.repository_write, rp.repository_delete,
           rp.assistant_read, rp.assistant_write, rp.assistant_delete,
           rp.landing_read, rp.landing_write, rp.landing_delete,
           COALESCE(counts.cnt, 0) AS user_count,
           rp.api_tier
    FROM public.role_permissions rp
    LEFT JOIN (SELECT ur.role AS role_name, COUNT(*) as cnt FROM public.user_roles ur GROUP BY ur.role) counts ON rp.role = counts.role_name
    ORDER BY rp.role;
END;
$function$;

-- Recreate get_user_permissions with api_tier
CREATE OR REPLACE FUNCTION public.get_user_permissions(p_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(role text, repository_read boolean, repository_write boolean, repository_delete boolean, assistant_read boolean, assistant_write boolean, assistant_delete boolean, landing_read boolean, landing_write boolean, landing_delete boolean, api_tier text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE target_user_id uuid;
BEGIN
    target_user_id := COALESCE(p_user_id, auth.uid());
    RETURN QUERY
    SELECT rp.role, rp.repository_read, rp.repository_write, rp.repository_delete,
           rp.assistant_read, rp.assistant_write, rp.assistant_delete,
           rp.landing_read, rp.landing_write, rp.landing_delete,
           rp.api_tier
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON ur.role = rp.role
    WHERE ur.user_id = target_user_id;
END;
$function$;

-- Drop old 9-param version of update_role_permissions
DROP FUNCTION IF EXISTS public.update_role_permissions(text, text, text, boolean, boolean, boolean, boolean, boolean, boolean);

-- Drop old 12-param version
DROP FUNCTION IF EXISTS public.update_role_permissions(text, text, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean);

-- Recreate with 13 params including api_tier
CREATE OR REPLACE FUNCTION public.update_role_permissions(p_role text, p_new_role_name text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_repository_read boolean DEFAULT NULL::boolean, p_repository_write boolean DEFAULT NULL::boolean, p_repository_delete boolean DEFAULT NULL::boolean, p_assistant_read boolean DEFAULT NULL::boolean, p_assistant_write boolean DEFAULT NULL::boolean, p_assistant_delete boolean DEFAULT NULL::boolean, p_landing_read boolean DEFAULT NULL::boolean, p_landing_write boolean DEFAULT NULL::boolean, p_landing_delete boolean DEFAULT NULL::boolean, p_api_tier text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    new_name text;
BEGIN
    IF NOT is_admin() THEN RAISE EXCEPTION 'Access denied: admin role required'; END IF;
    new_name := COALESCE(p_new_role_name, p_role);
    IF p_role = 'admin' AND new_name != 'admin' THEN RAISE EXCEPTION 'Cannot rename the admin role'; END IF;
    IF new_name != p_role AND EXISTS (SELECT 1 FROM public.role_permissions WHERE role = new_name) THEN RAISE EXCEPTION 'Role name already exists: %', new_name; END IF;
    UPDATE public.role_permissions SET
        role = new_name,
        description = COALESCE(p_description, description),
        repository_read = COALESCE(p_repository_read, repository_read),
        repository_write = COALESCE(p_repository_write, repository_write),
        repository_delete = COALESCE(p_repository_delete, repository_delete),
        assistant_read = COALESCE(p_assistant_read, assistant_read),
        assistant_write = COALESCE(p_assistant_write, assistant_write),
        assistant_delete = COALESCE(p_assistant_delete, assistant_delete),
        landing_read = COALESCE(p_landing_read, landing_read),
        landing_write = COALESCE(p_landing_write, landing_write),
        landing_delete = COALESCE(p_landing_delete, landing_delete),
        api_tier = COALESCE(p_api_tier, api_tier),
        updated_at = now()
    WHERE role = p_role;
    IF new_name != p_role THEN UPDATE public.user_roles SET role = new_name WHERE role = p_role; END IF;
END;
$function$;

-- Helper function for edge functions
CREATE OR REPLACE FUNCTION public.get_user_api_tier(p_user_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(rp.api_tier, 'free')
  FROM public.user_roles ur
  JOIN public.role_permissions rp ON ur.role = rp.role
  WHERE ur.user_id = p_user_id
  LIMIT 1
$function$;
