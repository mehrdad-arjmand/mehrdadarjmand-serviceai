import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { AppRole } from "@/hooks/usePermissions";

export interface RoleWithPermissions {
  role: AppRole;
  description: string | null;
  repository_read: boolean;
  repository_write: boolean;
  repository_delete: boolean;
  assistant_read: boolean;
  assistant_write: boolean;
  assistant_delete: boolean;
  user_count: number;
}

export interface UserWithRole {
  user_id: string;
  email: string;
  role: AppRole | null;
  role_assigned_at: string | null;
}

export function useRolesManagement() {
  const [roles, setRoles] = useState<RoleWithPermissions[]>([]);
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const { toast } = useToast();

  const fetchRoles = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('get_all_roles');
      
      if (error) {
        console.error('Error fetching roles:', error);
        toast({
          title: "Error",
          description: "Failed to fetch roles. You may not have permission.",
          variant: "destructive",
        });
        return;
      }
      
      setRoles(data?.map(r => ({
        ...r,
        user_count: Number(r.user_count)
      })) || []);
    } catch (err) {
      console.error('Error fetching roles:', err);
    }
  }, [toast]);

  const fetchUsers = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('list_users_with_roles');
      
      if (error) {
        console.error('Error fetching users:', error);
        toast({
          title: "Error",
          description: "Failed to fetch users. You may not have permission.",
          variant: "destructive",
        });
        return;
      }
      
      setUsers(data || []);
    } catch (err) {
      console.error('Error fetching users:', err);
    }
  }, [toast]);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    await Promise.all([fetchRoles(), fetchUsers()]);
    setIsLoading(false);
  }, [fetchRoles, fetchUsers]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const updateRolePermissions = async (
    role: AppRole,
    updates: Partial<Omit<RoleWithPermissions, 'role' | 'user_count'>>
  ) => {
    setIsUpdating(true);
    try {
      const { error } = await supabase.rpc('update_role_permissions', {
        p_role: role,
        p_description: updates.description,
        p_repository_read: updates.repository_read,
        p_repository_write: updates.repository_write,
        p_repository_delete: updates.repository_delete,
        p_assistant_read: updates.assistant_read,
        p_assistant_write: updates.assistant_write,
        p_assistant_delete: updates.assistant_delete,
      });

      if (error) {
        console.error('Error updating role:', error);
        toast({
          title: "Error",
          description: error.message || "Failed to update role permissions.",
          variant: "destructive",
        });
        return false;
      }

      toast({
        title: "Success",
        description: `Updated permissions for ${role} role.`,
      });
      
      await fetchRoles();
      return true;
    } catch (err) {
      console.error('Error updating role:', err);
      toast({
        title: "Error",
        description: "An unexpected error occurred.",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsUpdating(false);
    }
  };

  const assignUserRole = async (userId: string, role: AppRole) => {
    setIsUpdating(true);
    try {
      const { error } = await supabase.rpc('assign_user_role', {
        p_user_id: userId,
        p_role: role,
      });

      if (error) {
        console.error('Error assigning role:', error);
        toast({
          title: "Error",
          description: error.message || "Failed to assign role.",
          variant: "destructive",
        });
        return false;
      }

      toast({
        title: "Success",
        description: `Role updated successfully.`,
      });
      
      await Promise.all([fetchRoles(), fetchUsers()]);
      return true;
    } catch (err) {
      console.error('Error assigning role:', err);
      toast({
        title: "Error",
        description: "An unexpected error occurred.",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsUpdating(false);
    }
  };

  const createRole = async (
    role: AppRole,
    permissions: Partial<Omit<RoleWithPermissions, 'role' | 'user_count'>> = {}
  ) => {
    setIsUpdating(true);
    try {
      const { error } = await supabase.rpc('create_role', {
        p_role: role,
        p_description: permissions.description || null,
        p_repository_read: permissions.repository_read ?? false,
        p_repository_write: permissions.repository_write ?? false,
        p_repository_delete: permissions.repository_delete ?? false,
        p_assistant_read: permissions.assistant_read ?? false,
        p_assistant_write: permissions.assistant_write ?? false,
        p_assistant_delete: permissions.assistant_delete ?? false,
      });

      if (error) {
        console.error('Error creating role:', error);
        toast({
          title: "Error",
          description: error.message || "Failed to create role.",
          variant: "destructive",
        });
        return false;
      }

      toast({
        title: "Success",
        description: `Created ${role} role.`,
      });
      
      await fetchRoles();
      return true;
    } catch (err) {
      console.error('Error creating role:', err);
      toast({
        title: "Error",
        description: "An unexpected error occurred.",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsUpdating(false);
    }
  };

  const deleteRole = async (role: AppRole) => {
    if (role === 'admin') {
      toast({
        title: "Error",
        description: "Cannot delete the admin role.",
        variant: "destructive",
      });
      return false;
    }

    setIsUpdating(true);
    try {
      const { error } = await supabase.rpc('delete_role', {
        p_role: role,
      });

      if (error) {
        console.error('Error deleting role:', error);
        toast({
          title: "Error",
          description: error.message || "Failed to delete role.",
          variant: "destructive",
        });
        return false;
      }

      toast({
        title: "Success",
        description: `Deleted ${role} role.`,
      });
      
      await fetchRoles();
      return true;
    } catch (err) {
      console.error('Error deleting role:', err);
      toast({
        title: "Error",
        description: "An unexpected error occurred.",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsUpdating(false);
    }
  };

  return {
    roles,
    users,
    isLoading,
    isUpdating,
    refetch,
    updateRolePermissions,
    assignUserRole,
    createRole,
    deleteRole,
  };
}
