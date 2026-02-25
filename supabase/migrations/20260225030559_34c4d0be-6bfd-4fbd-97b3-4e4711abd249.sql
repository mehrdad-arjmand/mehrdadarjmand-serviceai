
-- Create project_allowed_users table
CREATE TABLE public.project_allowed_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(project_id, user_id)
);

ALTER TABLE public.project_allowed_users ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read project_allowed_users for projects they can access
CREATE POLICY "Users can read project allowed users"
  ON public.project_allowed_users FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      JOIN public.user_roles ur ON ur.user_id = auth.uid()
      WHERE p.id = project_allowed_users.project_id
      AND (ur.role = ANY(p.allowed_roles) OR 'all' = ANY(p.allowed_roles))
    )
    OR is_admin()
  );

-- Users with landing write can manage project_allowed_users
CREATE POLICY "Users with write can manage project users"
  ON public.project_allowed_users FOR ALL
  TO authenticated
  USING (has_permission('landing', 'write', auth.uid()))
  WITH CHECK (has_permission('landing', 'write', auth.uid()));

-- Add UPDATE policy for projects for users with landing write permission
CREATE POLICY "Users with landing write can update projects"
  ON public.projects FOR UPDATE
  TO authenticated
  USING (
    has_permission('landing', 'write', auth.uid())
    AND (
      created_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid()
        AND (ur.role = ANY(projects.allowed_roles) OR 'all' = ANY(projects.allowed_roles))
      )
      OR is_admin()
    )
  )
  WITH CHECK (
    has_permission('landing', 'write', auth.uid())
  );

-- Function for non-admins to list users by roles
CREATE OR REPLACE FUNCTION public.list_users_by_roles(p_roles text[])
RETURNS TABLE(user_id uuid, email text, role text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT u.id AS user_id, u.email::text, ur.role
  FROM auth.users u
  JOIN public.user_roles ur ON u.id = ur.user_id
  WHERE ur.role = ANY(p_roles);
END;
$$;
