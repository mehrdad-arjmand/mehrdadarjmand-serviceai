
-- Drop functions with changed return types first
DROP FUNCTION IF EXISTS public.get_user_permissions(uuid);
DROP FUNCTION IF EXISTS public.get_all_roles();

-- Recreate get_user_permissions with landing columns
CREATE OR REPLACE FUNCTION public.get_user_permissions(p_user_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(role text, repository_read boolean, repository_write boolean, repository_delete boolean, assistant_read boolean, assistant_write boolean, assistant_delete boolean, landing_read boolean, landing_write boolean, landing_delete boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE target_user_id uuid;
BEGIN
    target_user_id := COALESCE(p_user_id, auth.uid());
    RETURN QUERY
    SELECT rp.role, rp.repository_read, rp.repository_write, rp.repository_delete,
           rp.assistant_read, rp.assistant_write, rp.assistant_delete,
           rp.landing_read, rp.landing_write, rp.landing_delete
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON ur.role = rp.role
    WHERE ur.user_id = target_user_id;
END;
$$;

-- Recreate get_all_roles with landing columns
CREATE OR REPLACE FUNCTION public.get_all_roles()
RETURNS TABLE(role text, description text, repository_read boolean, repository_write boolean, repository_delete boolean, assistant_read boolean, assistant_write boolean, assistant_delete boolean, landing_read boolean, landing_write boolean, landing_delete boolean, user_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
    IF NOT is_admin() THEN RAISE EXCEPTION 'Access denied: admin role required'; END IF;
    RETURN QUERY
    SELECT rp.role, rp.description, rp.repository_read, rp.repository_write, rp.repository_delete,
           rp.assistant_read, rp.assistant_write, rp.assistant_delete,
           rp.landing_read, rp.landing_write, rp.landing_delete,
           COALESCE(counts.cnt, 0) AS user_count
    FROM public.role_permissions rp
    LEFT JOIN (SELECT ur.role AS role_name, COUNT(*) as cnt FROM public.user_roles ur GROUP BY ur.role) counts ON rp.role = counts.role_name
    ORDER BY rp.role;
END;
$$;
