
-- Recreate update_role_permissions with landing parameters
CREATE OR REPLACE FUNCTION public.update_role_permissions(
  p_role text,
  p_new_role_name text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_repository_read boolean DEFAULT NULL,
  p_repository_write boolean DEFAULT NULL,
  p_repository_delete boolean DEFAULT NULL,
  p_assistant_read boolean DEFAULT NULL,
  p_assistant_write boolean DEFAULT NULL,
  p_assistant_delete boolean DEFAULT NULL,
  p_landing_read boolean DEFAULT NULL,
  p_landing_write boolean DEFAULT NULL,
  p_landing_delete boolean DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    new_name text;
BEGIN
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'Access denied: admin role required';
    END IF;
    
    new_name := COALESCE(p_new_role_name, p_role);
    
    IF p_role = 'admin' AND new_name != 'admin' THEN
        RAISE EXCEPTION 'Cannot rename the admin role';
    END IF;
    
    IF new_name != p_role AND EXISTS (SELECT 1 FROM public.role_permissions WHERE role = new_name) THEN
        RAISE EXCEPTION 'Role name already exists: %', new_name;
    END IF;
    
    UPDATE public.role_permissions SET
        role = new_name,
        description = COALESCE(p_description, description),
        repository_read = COALESCE(p_repository_read, repository_read),
        repository_write = COALESCE(p_repository_write, repository_write),
        repository_delete = COALESCE(p_repository_delete, repository_delete),
        assistant_read = COALESCE(p_assistant_read, assistant_read),
        assistant_write = COALESCE(p_assistant_write, assistant_write),
        assistant_delete = COALESCE(p_assistant_delete, assistant_delete),
        landing_read = COALESCE(p_landing_read, landing_read),
        landing_write = COALESCE(p_landing_write, landing_write),
        landing_delete = COALESCE(p_landing_delete, landing_delete),
        updated_at = now()
    WHERE role = p_role;
    
    IF new_name != p_role THEN
        UPDATE public.user_roles SET role = new_name WHERE role = p_role;
    END IF;
END;
$$;

-- Also update create_role to accept landing parameters
CREATE OR REPLACE FUNCTION public.create_role(
  p_role text,
  p_description text DEFAULT NULL,
  p_repository_read boolean DEFAULT false,
  p_repository_write boolean DEFAULT false,
  p_repository_delete boolean DEFAULT false,
  p_assistant_read boolean DEFAULT false,
  p_assistant_write boolean DEFAULT false,
  p_assistant_delete boolean DEFAULT false,
  p_landing_read boolean DEFAULT false,
  p_landing_write boolean DEFAULT false,
  p_landing_delete boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'Access denied: admin role required';
    END IF;
    
    IF EXISTS (SELECT 1 FROM public.role_permissions WHERE role = p_role) THEN
        RAISE EXCEPTION 'Role already exists: %', p_role;
    END IF;
    
    INSERT INTO public.role_permissions (
        role, description, 
        repository_read, repository_write, repository_delete,
        assistant_read, assistant_write, assistant_delete,
        landing_read, landing_write, landing_delete
    ) VALUES (
        p_role, p_description,
        p_repository_read, p_repository_write, p_repository_delete,
        p_assistant_read, p_assistant_write, p_assistant_delete,
        p_landing_read, p_landing_write, p_landing_delete
    );
END;
$$;

-- Update has_permission to support landing tab
CREATE OR REPLACE FUNCTION public.has_permission(p_tab text, p_action text, p_user_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    target_user_id uuid;
    has_perm boolean := false;
BEGIN
    target_user_id := COALESCE(p_user_id, auth.uid());
    
    SELECT 
        CASE 
            WHEN p_tab = 'repository' AND p_action = 'read' THEN rp.repository_read
            WHEN p_tab = 'repository' AND p_action = 'write' THEN rp.repository_write
            WHEN p_tab = 'repository' AND p_action = 'delete' THEN rp.repository_delete
            WHEN p_tab = 'assistant' AND p_action = 'read' THEN rp.assistant_read
            WHEN p_tab = 'assistant' AND p_action = 'write' THEN rp.assistant_write
            WHEN p_tab = 'assistant' AND p_action = 'delete' THEN rp.assistant_delete
            WHEN p_tab = 'landing' AND p_action = 'read' THEN rp.landing_read
            WHEN p_tab = 'landing' AND p_action = 'write' THEN rp.landing_write
            WHEN p_tab = 'landing' AND p_action = 'delete' THEN rp.landing_delete
            ELSE false
        END INTO has_perm
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON ur.role = rp.role
    WHERE ur.user_id = target_user_id;
    
    RETURN COALESCE(has_perm, false);
END;
$$;
