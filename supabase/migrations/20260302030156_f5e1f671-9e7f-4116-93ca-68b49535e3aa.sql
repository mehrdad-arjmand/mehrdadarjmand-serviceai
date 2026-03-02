
-- Create a SECURITY DEFINER function to handle project creation, bypassing RLS entirely
CREATE OR REPLACE FUNCTION public.create_project(
  p_name text,
  p_allowed_roles text[] DEFAULT ARRAY['admin']::text[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  new_id uuid;
  caller_id uuid;
BEGIN
  caller_id := auth.uid();
  
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  -- Check user has landing_write permission
  IF NOT has_permission('landing', 'write', caller_id) AND NOT is_admin() THEN
    RAISE EXCEPTION 'Insufficient permissions to create projects';
  END IF;
  
  INSERT INTO public.projects (name, created_by, allowed_roles)
  VALUES (p_name, caller_id, p_allowed_roles)
  RETURNING id INTO new_id;
  
  RETURN new_id;
END;
$$;
