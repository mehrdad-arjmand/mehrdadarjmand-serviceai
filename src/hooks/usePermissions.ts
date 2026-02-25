import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// AppRole is now a string since we support custom roles
export type AppRole = string;

export interface TabPermissions {
  read: boolean;
  write: boolean;
  delete: boolean;
}

export interface UserPermissions {
  role: AppRole | null;
  repository: TabPermissions;
  assistant: TabPermissions;
  landing: TabPermissions;
  isLoading: boolean;
  refetch: () => Promise<void>;
}

const defaultPermissions: TabPermissions = {
  read: false,
  write: false,
  delete: false,
};

export function usePermissions(): UserPermissions {
  const { user } = useAuth();
  const [role, setRole] = useState<AppRole | null>(null);
  const [repository, setRepository] = useState<TabPermissions>(defaultPermissions);
  const [assistant, setAssistant] = useState<TabPermissions>(defaultPermissions);
  const [landing, setLanding] = useState<TabPermissions>(defaultPermissions);
  const [isLoading, setIsLoading] = useState(true);

  const fetchPermissions = useCallback(async () => {
    if (!user) {
      setRole(null);
      setRepository(defaultPermissions);
      setAssistant(defaultPermissions);
      setLanding(defaultPermissions);
      setIsLoading(false);
      return;
    }

    try {
      // Call the database function to get user permissions
      const { data, error } = await supabase.rpc('get_user_permissions');
      
      if (error) {
        console.error('Error fetching permissions:', error);
        // Default to basic user permissions if no role is assigned
        setRole('demo');
        setRepository({ read: true, write: false, delete: false });
        setAssistant({ read: true, write: true, delete: false });
        setLanding({ read: true, write: false, delete: false });
      } else if (data && data.length > 0) {
        const perms = data[0];
        setRole(perms.role as AppRole);
        setRepository({
          read: perms.repository_read,
          write: perms.repository_write,
          delete: perms.repository_delete,
        });
        setAssistant({
          read: perms.assistant_read,
          write: perms.assistant_write,
          delete: perms.assistant_delete,
        });
        setLanding({
          read: (perms as any).landing_read ?? true,
          write: (perms as any).landing_write ?? false,
          delete: (perms as any).landing_delete ?? false,
        });
      } else {
        // No role assigned - default to demo permissions
        console.log('No role assigned for user, using default demo permissions');
        setRole('demo');
        setRepository({ read: true, write: false, delete: false });
        setAssistant({ read: true, write: true, delete: false });
        setLanding({ read: true, write: false, delete: false });
      }
    } catch (err) {
      console.error('Error fetching permissions:', err);
      setRole('demo');
      setRepository({ read: true, write: false, delete: false });
      setAssistant({ read: true, write: true, delete: false });
      setLanding({ read: true, write: false, delete: false });
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchPermissions();
  }, [fetchPermissions]);

  return {
    role,
    repository,
    assistant,
    landing,
    isLoading,
    refetch: fetchPermissions,
  };
}

// Helper hook to check a specific permission
export function useHasPermission(tab: 'repository' | 'assistant' | 'landing', action: 'read' | 'write' | 'delete'): boolean {
  const permissions = usePermissions();
  return permissions[tab][action];
}
