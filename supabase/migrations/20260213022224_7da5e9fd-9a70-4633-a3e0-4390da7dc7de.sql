-- Allow users to read their own query logs (in addition to existing admin-only policy)
CREATE POLICY "Users can read own query logs"
ON public.query_logs
FOR SELECT
USING (auth.uid() = user_id OR is_admin());