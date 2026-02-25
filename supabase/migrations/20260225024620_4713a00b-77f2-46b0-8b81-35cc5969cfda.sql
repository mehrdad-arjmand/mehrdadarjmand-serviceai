
-- Add landing permission columns (the first migration failed before these were applied)
ALTER TABLE public.role_permissions 
  ADD COLUMN IF NOT EXISTS landing_read boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS landing_write boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS landing_delete boolean NOT NULL DEFAULT false;

-- Set admin landing permissions to true
UPDATE public.role_permissions SET landing_read = true, landing_write = true, landing_delete = true WHERE role = 'admin';
-- Set other roles to at least read
UPDATE public.role_permissions SET landing_read = true WHERE role != 'admin';
