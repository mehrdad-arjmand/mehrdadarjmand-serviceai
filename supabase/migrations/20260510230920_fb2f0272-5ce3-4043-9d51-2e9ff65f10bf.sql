CREATE TABLE IF NOT EXISTS public.bench_secrets (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bench_secrets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read bench_secrets" ON public.bench_secrets
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Admins can write bench_secrets" ON public.bench_secrets
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());