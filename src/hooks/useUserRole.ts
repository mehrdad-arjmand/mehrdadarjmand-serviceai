import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface UseUserRoleResult {
  isAdmin: boolean;
  isLoading: boolean;
  role: 'admin' | 'user' | null;
  refetch: () => Promise<void>;
}

export function useUserRole(): UseUserRoleResult {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [role, setRole] = useState<'admin' | 'user' | null>(null);

  const checkRole = useCallback(async () => {
    if (!user) {
      setIsAdmin(false);
      setRole(null);
      setIsLoading(false);
      return;
    }

    try {
      // Use the security definer function to check admin status
      const { data, error } = await supabase.rpc('is_admin');
      
      if (error) {
        console.error('Error checking admin status:', error);
        setIsAdmin(false);
        setRole('user');
      } else {
        setIsAdmin(data === true);
        setRole(data === true ? 'admin' : 'user');
      }
    } catch (err) {
      console.error('Error checking role:', err);
      setIsAdmin(false);
      setRole('user');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    checkRole();
  }, [checkRole]);

  return {
    isAdmin,
    isLoading,
    role,
    refetch: checkRole,
  };
}
