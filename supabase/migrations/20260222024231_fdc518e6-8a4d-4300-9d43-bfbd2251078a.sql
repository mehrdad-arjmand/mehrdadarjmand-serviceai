
-- Projects table
CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  allowed_roles text[] NOT NULL DEFAULT ARRAY['admin'::text]
);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read projects they have role access to
CREATE POLICY "Users can read accessible projects" ON public.projects
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND (ur.role = ANY(projects.allowed_roles) OR 'all' = ANY(projects.allowed_roles))
    )
    OR is_admin()
  );

-- Users with admin role can insert projects
CREATE POLICY "Admins can manage projects" ON public.projects
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Anyone authenticated with repository write can create projects
CREATE POLICY "Users with repo write can create projects" ON public.projects
  FOR INSERT TO authenticated
  WITH CHECK (has_permission('repository', 'write', auth.uid()));

-- Project metadata fields table
CREATE TABLE public.project_metadata_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.project_metadata_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read metadata fields of accessible projects" ON public.project_metadata_fields
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      JOIN public.user_roles ur ON ur.user_id = auth.uid()
      WHERE p.id = project_metadata_fields.project_id
        AND (ur.role = ANY(p.allowed_roles) OR 'all' = ANY(p.allowed_roles))
    )
    OR is_admin()
  );

CREATE POLICY "Admins can manage metadata fields" ON public.project_metadata_fields
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "Users with repo write can insert metadata fields" ON public.project_metadata_fields
  FOR INSERT TO authenticated
  WITH CHECK (has_permission('repository', 'write', auth.uid()));

-- Add project_id to documents (nullable for backward compatibility)
ALTER TABLE public.documents ADD COLUMN project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
