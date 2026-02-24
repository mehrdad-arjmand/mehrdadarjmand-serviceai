
CREATE POLICY "Authenticated users can create projects"
  ON public.projects
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by);
