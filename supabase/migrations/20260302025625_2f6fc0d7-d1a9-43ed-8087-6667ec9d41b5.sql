
-- Force PostgREST to reload its schema cache so new policies take effect
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
