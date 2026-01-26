import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, User } from "lucide-react";
import type { RoleWithPermissions, UserWithRole } from "@/hooks/useRolesManagement";
import type { AppRole } from "@/hooks/usePermissions";

interface UsersRolesListProps {
  users: UserWithRole[];
  roles: RoleWithPermissions[];
  isUpdating: boolean;
  onAssignRole: (userId: string, role: AppRole) => Promise<boolean>;
}

export const UsersRolesList = ({
  users,
  roles,
  isUpdating,
  onAssignRole,
}: UsersRolesListProps) => {
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);

  const handleRoleChange = async (userId: string, newRole: AppRole) => {
    setUpdatingUserId(userId);
    await onAssignRole(userId, newRole);
    setUpdatingUserId(null);
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <Card className="border border-border/60 shadow-sm">
      <div className="p-6 border-b border-border/60">
        <h3 className="text-lg font-semibold text-foreground">User Role Assignments</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Assign roles to users. Each user can have one role at a time.
        </p>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[300px]">User</TableHead>
              <TableHead className="w-[180px]">Role</TableHead>
              <TableHead>Assigned</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                  No users found.
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow key={user.user_id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                        <User className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="font-medium text-foreground">{user.email}</p>
                        <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                          {user.user_id}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {updatingUserId === user.user_id && (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      )}
                      <Select
                        value={user.role || ''}
                        onValueChange={(value) => handleRoleChange(user.user_id, value as AppRole)}
                        disabled={isUpdating}
                      >
                        <SelectTrigger className="w-[140px]">
                          <SelectValue placeholder="No role">
                            {user.role ? (
                              <span className="capitalize">{user.role}</span>
                            ) : (
                              <span className="text-muted-foreground">No role</span>
                            )}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent className="bg-popover border border-border z-50">
                          {roles.map((role) => (
                            <SelectItem key={role.role} value={role.role} className="capitalize">
                              {role.role}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {formatDate(user.role_assigned_at)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
};
