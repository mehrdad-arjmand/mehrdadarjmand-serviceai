-- Create trigger function to auto-assign 'user' role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');
  RETURN NEW;
END;
$$;

-- Create trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created_assign_role ON auth.users;
CREATE TRIGGER on_auth_user_created_assign_role
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_role();

-- Add display_name column for customizable role names
ALTER TABLE public.role_permissions
ADD COLUMN IF NOT EXISTS display_name text;

-- Set default display names
UPDATE public.role_permissions SET display_name = 'Administrator' WHERE role = 'admin' AND display_name IS NULL;
UPDATE public.role_permissions SET display_name = 'User' WHERE role = 'user' AND display_name IS NULL;
UPDATE public.role_permissions SET display_name = 'Manager' WHERE role = 'manager' AND display_name IS NULL;
UPDATE public.role_permissions SET display_name = 'Technician' WHERE role = 'technician' AND display_name IS NULL;