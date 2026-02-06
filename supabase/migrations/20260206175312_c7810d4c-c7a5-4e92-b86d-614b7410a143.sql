-- Fix signup_config security: restrict public access
-- The phone verification should be done server-side, not by exposing the value to clients

-- Drop the overly permissive public read policy
DROP POLICY IF EXISTS "Anyone can read signup config" ON public.signup_config;

-- Create a more restrictive policy - only admins can read/modify
CREATE POLICY "Admins can read signup config"
ON public.signup_config
FOR SELECT
TO authenticated
USING (is_admin());

CREATE POLICY "Admins can modify signup config"
ON public.signup_config
FOR ALL
TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

-- Create a secure function for phone verification that doesn't expose the value
CREATE OR REPLACE FUNCTION public.verify_phone_last_4(p_digits text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    stored_value text;
BEGIN
    -- Get the stored verification code
    SELECT value INTO stored_value
    FROM public.signup_config
    WHERE key = 'phone_last_4';
    
    -- Return true if digits match, false otherwise
    RETURN stored_value IS NOT NULL AND stored_value = p_digits;
END;
$$;

-- Grant execute permission to anon role (for signup page)
GRANT EXECUTE ON FUNCTION public.verify_phone_last_4(text) TO anon;
GRANT EXECUTE ON FUNCTION public.verify_phone_last_4(text) TO authenticated;