-- Drop existing permissive delete policies
DROP POLICY IF EXISTS "Authenticated users can delete documents" ON public.documents;
DROP POLICY IF EXISTS "Authenticated users can delete chunks" ON public.chunks;

-- Create admin-only delete policies for documents
CREATE POLICY "Only admins can delete documents"
ON public.documents FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Create admin-only delete policies for chunks
CREATE POLICY "Only admins can delete chunks"
ON public.chunks FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));