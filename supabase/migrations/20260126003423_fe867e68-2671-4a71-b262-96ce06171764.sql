-- Add description column to role_permissions table
ALTER TABLE public.role_permissions 
ADD COLUMN IF NOT EXISTS description text;

-- Create a function to list all users with their roles (for admin use)
CREATE OR REPLACE FUNCTION public.list_users_with_roles()
RETURNS TABLE (
  user_id uuid,
  email text,
  role app_role,
  role_assigned_at timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    u.id as user_id,
    u.email::text,
    ur.role,
    ur.created_at as role_assigned_at
  FROM auth.users u
  LEFT JOIN public.user_roles ur ON u.id = ur.user_id
  ORDER BY u.email;
$$;

-- Grant execute permission to authenticated users (the function itself checks admin via RLS)
GRANT EXECUTE ON FUNCTION public.list_users_with_roles() TO authenticated;

-- Create function to assign/update user role (admin only)
CREATE OR REPLACE FUNCTION public.assign_user_role(p_user_id uuid, p_role app_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Check if caller is admin
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin role required';
  END IF;
  
  -- Delete existing role assignment
  DELETE FROM public.user_roles WHERE user_id = p_user_id;
  
  -- Insert new role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (p_user_id, p_role);
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.assign_user_role(uuid, app_role) TO authenticated;

-- Create function to add a new role with permissions (admin only)
CREATE OR REPLACE FUNCTION public.create_role(
  p_role app_role,
  p_description text DEFAULT NULL,
  p_repository_read boolean DEFAULT false,
  p_repository_write boolean DEFAULT false,
  p_repository_delete boolean DEFAULT false,
  p_assistant_read boolean DEFAULT false,
  p_assistant_write boolean DEFAULT false,
  p_assistant_delete boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin role required';
  END IF;
  
  INSERT INTO public.role_permissions (
    role, description,
    repository_read, repository_write, repository_delete,
    assistant_read, assistant_write, assistant_delete
  ) VALUES (
    p_role, p_description,
    p_repository_read, p_repository_write, p_repository_delete,
    p_assistant_read, p_assistant_write, p_assistant_delete
  );
END;
$$;

-- Create function to update role permissions (admin only)
CREATE OR REPLACE FUNCTION public.update_role_permissions(
  p_role app_role,
  p_description text DEFAULT NULL,
  p_repository_read boolean DEFAULT NULL,
  p_repository_write boolean DEFAULT NULL,
  p_repository_delete boolean DEFAULT NULL,
  p_assistant_read boolean DEFAULT NULL,
  p_assistant_write boolean DEFAULT NULL,
  p_assistant_delete boolean DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin role required';
  END IF;
  
  UPDATE public.role_permissions
  SET 
    description = COALESCE(p_description, description),
    repository_read = COALESCE(p_repository_read, repository_read),
    repository_write = COALESCE(p_repository_write, repository_write),
    repository_delete = COALESCE(p_repository_delete, repository_delete),
    assistant_read = COALESCE(p_assistant_read, assistant_read),
    assistant_write = COALESCE(p_assistant_write, assistant_write),
    assistant_delete = COALESCE(p_assistant_delete, assistant_delete),
    updated_at = now()
  WHERE role = p_role;
END;
$$;

-- Create function to delete a role (admin only)
CREATE OR REPLACE FUNCTION public.delete_role(p_role app_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin role required';
  END IF;
  
  -- Check if any users have this role
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE role = p_role) THEN
    RAISE EXCEPTION 'Cannot delete role: users are still assigned to this role';
  END IF;
  
  DELETE FROM public.role_permissions WHERE role = p_role;
END;
$$;

-- Create function to get all roles with permissions
CREATE OR REPLACE FUNCTION public.get_all_roles()
RETURNS TABLE (
  role app_role,
  description text,
  repository_read boolean,
  repository_write boolean,
  repository_delete boolean,
  assistant_read boolean,
  assistant_write boolean,
  assistant_delete boolean,
  user_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    rp.role,
    rp.description,
    rp.repository_read,
    rp.repository_write,
    rp.repository_delete,
    rp.assistant_read,
    rp.assistant_write,
    rp.assistant_delete,
    (SELECT COUNT(*) FROM public.user_roles ur WHERE ur.role = rp.role) as user_count
  FROM public.role_permissions rp
  ORDER BY rp.role;
$$;

GRANT EXECUTE ON FUNCTION public.get_all_roles() TO authenticated;