-- Add DELETE policy for chunks table that checks repository_delete permission
CREATE POLICY "Users with repository delete can delete chunks"
ON public.chunks
FOR DELETE
TO authenticated
USING (has_permission('repository'::text, 'delete'::text, auth.uid()));