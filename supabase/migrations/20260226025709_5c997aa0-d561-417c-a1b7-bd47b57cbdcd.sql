CREATE OR REPLACE FUNCTION public.list_users_by_roles(p_roles text[])
 RETURNS TABLE(user_id uuid, email text, role text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Admins can see all users in the specified roles
  IF is_admin() THEN
    RETURN QUERY
    SELECT u.id AS user_id, u.email::text, ur.role
    FROM auth.users u
    JOIN public.user_roles ur ON u.id = ur.user_id
    WHERE ur.role = ANY(p_roles);
  ELSE
    -- Non-admins can only see themselves
    RETURN QUERY
    SELECT u.id AS user_id, u.email::text, ur.role
    FROM auth.users u
    JOIN public.user_roles ur ON u.id = ur.user_id
    WHERE ur.role = ANY(p_roles)
      AND u.id = auth.uid();
  END IF;
END;
$function$;