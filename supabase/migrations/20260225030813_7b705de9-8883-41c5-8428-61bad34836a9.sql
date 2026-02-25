
-- Function to delete a user (admin only) - removes role assignment and deletes from auth
CREATE OR REPLACE FUNCTION public.delete_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'Access denied: admin role required';
    END IF;
    
    IF p_user_id = auth.uid() THEN
        RAISE EXCEPTION 'Cannot delete yourself';
    END IF;
    
    -- Check if target is admin
    IF check_is_admin(p_user_id) THEN
        RAISE EXCEPTION 'Cannot delete an admin user';
    END IF;
    
    -- Remove role assignment
    DELETE FROM public.user_roles WHERE user_id = p_user_id;
    
    -- Remove from project_allowed_users
    DELETE FROM public.project_allowed_users WHERE user_id = p_user_id;
    
    -- Delete the user from auth
    DELETE FROM auth.users WHERE id = p_user_id;
END;
$$;
