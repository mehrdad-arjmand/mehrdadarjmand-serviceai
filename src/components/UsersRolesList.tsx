import { useState } from "react";
import { Card } from "@/components/ui/card";
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
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, User, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RoleWithPermissions, UserWithRole } from "@/hooks/useRolesManagement";
import type { AppRole } from "@/hooks/usePermissions";

interface UsersRolesListProps {
  users: UserWithRole[];
  roles: RoleWithPermissions[];
  isUpdating: boolean;
  onAssignRole: (userId: string, role: AppRole) => Promise<boolean>;
  onDeleteUser?: (userId: string) => Promise<boolean>;
}

export const UsersRolesList = ({
  users,
  roles,
  isUpdating,
  onAssignRole,
  onDeleteUser,
}: UsersRolesListProps) => {
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserWithRole | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleRoleChange = async (userId: string, newRole: string) => {
    setUpdatingUserId(userId);
    await onAssignRole(userId, newRole);
    setUpdatingUserId(null);
  };

  const handleDelete = async () => {
    if (!deleteTarget || !onDeleteUser) return;
    setIsDeleting(true);
    await onDeleteUser(deleteTarget.user_id);
    setIsDeleting(false);
    setDeleteTarget(null);
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
    <>
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
                <TableHead className="w-[35%]">User</TableHead>
                <TableHead className="w-[25%]">Role</TableHead>
                <TableHead className="w-[25%]">Assigned</TableHead>
                {onDeleteUser && <TableHead className="w-[15%] text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={onDeleteUser ? 4 : 3} className="text-center py-8 text-muted-foreground">
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
                          onValueChange={(value) => handleRoleChange(user.user_id, value)}
                          disabled={isUpdating}
                        >
                          <SelectTrigger className="w-[140px]">
                            <SelectValue placeholder="No role">
                              {user.role ? (
                                <span>{user.role}</span>
                              ) : (
                                <span className="text-muted-foreground">No role</span>
                              )}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent className="bg-popover border border-border z-50">
                            {roles.map((role) => (
                              <SelectItem key={role.role} value={role.role}>
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
                    {onDeleteUser && (
                      <TableCell className="text-right">
                        {user.role !== 'admin' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => setDeleteTarget(user)}
                            disabled={isUpdating}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the user "{deleteTarget?.email}" and their role assignment. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
