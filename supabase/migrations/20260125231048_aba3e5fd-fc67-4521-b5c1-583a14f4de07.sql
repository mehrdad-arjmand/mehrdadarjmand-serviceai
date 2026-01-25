-- Create role_permissions table for granular tab-level permissions
CREATE TABLE public.role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role app_role NOT NULL UNIQUE,
  repository_read boolean NOT NULL DEFAULT false,
  repository_write boolean NOT NULL DEFAULT false,
  repository_delete boolean NOT NULL DEFAULT false,
  assistant_read boolean NOT NULL DEFAULT false,
  assistant_write boolean NOT NULL DEFAULT false,
  assistant_delete boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Enable RLS on role_permissions
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

-- RLS policy - all authenticated users can read permissions (needed for UI)
CREATE POLICY "Authenticated users can read role permissions"
ON public.role_permissions
FOR SELECT
TO authenticated
USING (true);

-- Only admins can modify role permissions
CREATE POLICY "Only admins can modify role permissions"
ON public.role_permissions
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Insert default permissions for each role
INSERT INTO public.role_permissions (role, repository_read, repository_write, repository_delete, assistant_read, assistant_write, assistant_delete)
VALUES 
  ('admin', true, true, true, true, true, true),
  ('manager', true, true, true, true, true, false),
  ('technician', true, false, false, true, true, false),
  ('user', true, false, false, true, true, false);

-- Create function to get user permissions
CREATE OR REPLACE FUNCTION public.get_user_permissions(p_user_id uuid DEFAULT auth.uid())
RETURNS TABLE (
  role app_role,
  repository_read boolean,
  repository_write boolean,
  repository_delete boolean,
  assistant_read boolean,
  assistant_write boolean,
  assistant_delete boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    rp.role,
    rp.repository_read,
    rp.repository_write,
    rp.repository_delete,
    rp.assistant_read,
    rp.assistant_write,
    rp.assistant_delete
  FROM public.user_roles ur
  JOIN public.role_permissions rp ON ur.role = rp.role
  WHERE ur.user_id = p_user_id
  LIMIT 1;
$$;

-- Create function to check specific permission
CREATE OR REPLACE FUNCTION public.has_permission(p_tab text, p_action text, p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_permission boolean := false;
  v_role app_role;
BEGIN
  -- Get user's role
  SELECT role INTO v_role FROM public.user_roles WHERE user_id = p_user_id LIMIT 1;
  
  IF v_role IS NULL THEN
    RETURN false;
  END IF;
  
  -- Check the specific permission
  EXECUTE format(
    'SELECT %I FROM public.role_permissions WHERE role = $1',
    p_tab || '_' || p_action
  ) INTO v_permission USING v_role;
  
  RETURN COALESCE(v_permission, false);
END;
$$;