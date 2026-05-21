CREATE UNIQUE INDEX IF NOT EXISTS idx_eval_dataset_query_text_normalized
ON public.eval_dataset (lower(regexp_replace(btrim(query_text), '\s+', ' ', 'g')));

DROP POLICY IF EXISTS "Admins can manage eval_dataset" ON public.eval_dataset;
DROP POLICY IF EXISTS "Admins can read eval_dataset" ON public.eval_dataset;
DROP POLICY IF EXISTS "Admins can insert eval_dataset" ON public.eval_dataset;
DROP POLICY IF EXISTS "Admins can update eval_dataset" ON public.eval_dataset;

CREATE POLICY "Admins can read eval_dataset"
ON public.eval_dataset
FOR SELECT
USING (is_admin());

CREATE POLICY "Admins can insert eval_dataset"
ON public.eval_dataset
FOR INSERT
WITH CHECK (is_admin());

CREATE POLICY "Admins can update eval_dataset"
ON public.eval_dataset
FOR UPDATE
USING (is_admin())
WITH CHECK (is_admin());