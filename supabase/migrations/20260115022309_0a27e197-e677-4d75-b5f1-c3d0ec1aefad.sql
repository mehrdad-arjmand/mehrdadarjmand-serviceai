-- Drop existing permissive public policies on documents
DROP POLICY IF EXISTS "Allow public delete access to documents" ON public.documents;
DROP POLICY IF EXISTS "Allow public delete on documents" ON public.documents;
DROP POLICY IF EXISTS "Allow public insert access to documents" ON public.documents;
DROP POLICY IF EXISTS "Allow public insert on documents" ON public.documents;
DROP POLICY IF EXISTS "Allow public read access to documents" ON public.documents;
DROP POLICY IF EXISTS "Allow public read on documents" ON public.documents;
DROP POLICY IF EXISTS "Allow public update on documents" ON public.documents;

-- Drop existing permissive public policies on chunks
DROP POLICY IF EXISTS "Allow public delete access to chunks" ON public.chunks;
DROP POLICY IF EXISTS "Allow public delete on chunks" ON public.chunks;
DROP POLICY IF EXISTS "Allow public insert access to chunks" ON public.chunks;
DROP POLICY IF EXISTS "Allow public insert on chunks" ON public.chunks;
DROP POLICY IF EXISTS "Allow public read access to chunks" ON public.chunks;
DROP POLICY IF EXISTS "Allow public read on chunks" ON public.chunks;

-- Create authenticated-only policies for documents
CREATE POLICY "Authenticated users can read documents"
ON public.documents FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert documents"
ON public.documents FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update documents"
ON public.documents FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Authenticated users can delete documents"
ON public.documents FOR DELETE
TO authenticated
USING (true);

-- Create authenticated-only policies for chunks
CREATE POLICY "Authenticated users can read chunks"
ON public.chunks FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert chunks"
ON public.chunks FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update chunks"
ON public.chunks FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Authenticated users can delete chunks"
ON public.chunks FOR DELETE
TO authenticated
USING (true);