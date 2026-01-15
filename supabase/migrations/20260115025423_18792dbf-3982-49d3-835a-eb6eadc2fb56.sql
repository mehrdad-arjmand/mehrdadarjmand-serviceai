-- Drop overly permissive UPDATE policy on chunks
DROP POLICY IF EXISTS "Authenticated users can update chunks" ON public.chunks;

-- Create admin-only UPDATE policy for chunks
CREATE POLICY "Only admins can update chunks"
ON public.chunks FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));