
-- Add api_tier column to role_permissions
ALTER TABLE public.role_permissions ADD COLUMN IF NOT EXISTS api_tier text NOT NULL DEFAULT 'free';

-- Update admin role to paid by default
UPDATE public.role_permissions SET api_tier = 'paid' WHERE role = 'admin';
