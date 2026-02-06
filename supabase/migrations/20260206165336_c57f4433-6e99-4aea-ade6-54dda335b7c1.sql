-- =====================================================
-- MIGRATION: Convert from enum-based roles to text-based roles
-- First drop dependent policies, then alter types, then recreate
-- =====================================================

-- Step 1: Drop RLS policies that depend on the role column
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can read own roles" ON public.user_roles;

-- Step 2: Alter role_permissions table - change role from enum to text
ALTER TABLE public.role_permissions 
    ALTER COLUMN role TYPE text USING role::text;

-- Step 3: Alter user_roles table - change role from enum to text
ALTER TABLE public.user_roles 
    ALTER COLUMN role TYPE text USING role::text;

-- Step 4: Drop the old enum type
DROP TYPE IF EXISTS public.app_role CASCADE;

-- Step 5: Recreate RLS policies for user_roles
CREATE POLICY "Admins can manage roles" ON public.user_roles
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
        )
    );

CREATE POLICY "Users can read own roles" ON public.user_roles
    FOR SELECT USING (auth.uid() = user_id);

-- Step 6: Recreate has_role function to work with text
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Step 7: Recreate is_admin function
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role = 'admin'
  )
$$;

-- Step 8: Recreate get_user_permissions function
CREATE OR REPLACE FUNCTION public.get_user_permissions(p_user_id uuid DEFAULT NULL)
RETURNS TABLE(
    role text,
    repository_read boolean,
    repository_write boolean,
    repository_delete boolean,
    assistant_read boolean,
    assistant_write boolean,
    assistant_delete boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    target_user_id uuid;
BEGIN
    target_user_id := COALESCE(p_user_id, auth.uid());
    
    RETURN QUERY
    SELECT 
        rp.role,
        rp.repository_read,
        rp.repository_write,
        rp.repository_delete,
        rp.assistant_read,
        rp.assistant_write,
        rp.assistant_delete
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON ur.role = rp.role
    WHERE ur.user_id = target_user_id;
END;
$$;

-- Step 9: Recreate has_permission function
CREATE OR REPLACE FUNCTION public.has_permission(p_tab text, p_action text, p_user_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
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
            ELSE false
        END INTO has_perm
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON ur.role = rp.role
    WHERE ur.user_id = target_user_id;
    
    RETURN COALESCE(has_perm, false);
END;
$$;

-- Step 10: Recreate get_all_roles function
CREATE OR REPLACE FUNCTION public.get_all_roles()
RETURNS TABLE(
    role text,
    description text,
    repository_read boolean,
    repository_write boolean,
    repository_delete boolean,
    assistant_read boolean,
    assistant_write boolean,
    assistant_delete boolean,
    user_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'Access denied: admin role required';
    END IF;
    
    RETURN QUERY
    SELECT 
        rp.role,
        rp.description,
        rp.repository_read,
        rp.repository_write,
        rp.repository_delete,
        rp.assistant_read,
        rp.assistant_write,
        rp.assistant_delete,
        COALESCE(counts.cnt, 0) AS user_count
    FROM public.role_permissions rp
    LEFT JOIN (
        SELECT ur.role AS role_name, COUNT(*) as cnt
        FROM public.user_roles ur
        GROUP BY ur.role
    ) counts ON rp.role = counts.role_name
    ORDER BY rp.role;
END;
$$;

-- Step 11: Recreate list_users_with_roles function
CREATE OR REPLACE FUNCTION public.list_users_with_roles()
RETURNS TABLE(
    user_id uuid,
    email text,
    role text,
    role_assigned_at timestamp with time zone
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'Access denied: admin role required';
    END IF;
    
    RETURN QUERY
    SELECT 
        u.id as user_id,
        u.email::text,
        ur.role,
        ur.created_at as role_assigned_at
    FROM auth.users u
    LEFT JOIN public.user_roles ur ON u.id = ur.user_id;
END;
$$;

-- Step 12: Recreate assign_user_role function
CREATE OR REPLACE FUNCTION public.assign_user_role(p_user_id uuid, p_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'Access denied: admin role required';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM public.role_permissions WHERE role = p_role) THEN
        RAISE EXCEPTION 'Role does not exist: %', p_role;
    END IF;
    
    DELETE FROM public.user_roles WHERE user_id = p_user_id;
    INSERT INTO public.user_roles (user_id, role) VALUES (p_user_id, p_role);
END;
$$;

-- Step 13: Recreate create_role function for custom roles
CREATE OR REPLACE FUNCTION public.create_role(
    p_role text,
    p_description text DEFAULT NULL,
    p_repository_read boolean DEFAULT false,
    p_repository_write boolean DEFAULT false,
    p_repository_delete boolean DEFAULT false,
    p_assistant_read boolean DEFAULT false,
    p_assistant_write boolean DEFAULT false,
    p_assistant_delete boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
        assistant_read, assistant_write, assistant_delete
    ) VALUES (
        p_role, p_description,
        p_repository_read, p_repository_write, p_repository_delete,
        p_assistant_read, p_assistant_write, p_assistant_delete
    );
END;
$$;

-- Step 14: Recreate delete_role function
CREATE OR REPLACE FUNCTION public.delete_role(p_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'Access denied: admin role required';
    END IF;
    
    IF p_role = 'admin' THEN
        RAISE EXCEPTION 'Cannot delete the admin role';
    END IF;
    
    IF EXISTS (SELECT 1 FROM public.user_roles WHERE role = p_role) THEN
        RAISE EXCEPTION 'Cannot delete role: users are still assigned to it';
    END IF;
    
    DELETE FROM public.role_permissions WHERE role = p_role;
END;
$$;

-- Step 15: Recreate update_role_permissions with rename capability
CREATE OR REPLACE FUNCTION public.update_role_permissions(
    p_role text,
    p_new_role_name text DEFAULT NULL,
    p_description text DEFAULT NULL,
    p_repository_read boolean DEFAULT NULL,
    p_repository_write boolean DEFAULT NULL,
    p_repository_delete boolean DEFAULT NULL,
    p_assistant_read boolean DEFAULT NULL,
    p_assistant_write boolean DEFAULT NULL,
    p_assistant_delete boolean DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
        updated_at = now()
    WHERE role = p_role;
    
    IF new_name != p_role THEN
        UPDATE public.user_roles SET role = new_name WHERE role = p_role;
    END IF;
END;
$$;

-- Step 16: Create 'demo' role for new signups
INSERT INTO public.role_permissions (role, description, repository_read, assistant_read, assistant_write)
VALUES ('demo', 'Default role for demo users from portfolio', true, true, true)
ON CONFLICT DO NOTHING;

-- Step 17: Update trigger function for default 'demo' role
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'demo');
    RETURN NEW;
END;
$$;

-- Step 18: Create signup_config table for phone verification
CREATE TABLE IF NOT EXISTS public.signup_config (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    key text UNIQUE NOT NULL,
    value text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

INSERT INTO public.signup_config (key, value) VALUES ('phone_last_4', '5068')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

ALTER TABLE public.signup_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read signup config" ON public.signup_config
    FOR SELECT USING (true);

CREATE POLICY "Only admins can modify signup config" ON public.signup_config
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());