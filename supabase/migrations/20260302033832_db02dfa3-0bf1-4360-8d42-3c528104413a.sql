
CREATE OR REPLACE FUNCTION public.list_users_by_roles(p_roles text[])
RETURNS TABLE(user_id uuid, email text, role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT u.id AS user_id, u.email::text, ur.role
  FROM auth.users u
  JOIN public.user_roles ur ON u.id = ur.user_id
  WHERE ur.role = ANY(p_roles);
END;
$$;
