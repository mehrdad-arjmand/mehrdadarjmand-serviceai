-- Drop the problematic recursive policy
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;

-- Create a security definer function to check if a user is admin without triggering recursion
CREATE OR REPLACE FUNCTION public.check_is_admin(check_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = check_user_id
      AND role = 'admin'
  )
$$;

-- Recreate the policy using the security definer function
CREATE POLICY "Admins can manage roles"
ON public.user_roles
FOR ALL
USING (public.check_is_admin(auth.uid()))
WITH CHECK (public.check_is_admin(auth.uid()));