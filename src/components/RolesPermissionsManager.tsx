import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Pencil, Plus, Trash2, Users } from "lucide-react";
import type { RoleWithPermissions } from "@/hooks/useRolesManagement";
import type { AppRole } from "@/hooks/usePermissions";

interface RolesPermissionsManagerProps {
  roles: RoleWithPermissions[];
  isUpdating: boolean;
  onUpdateRole: (
    role: AppRole,
    updates: Partial<Omit<RoleWithPermissions, 'role' | 'user_count'>> & { newRoleName?: string }
  ) => Promise<boolean>;
  onCreateRole: (
    role: string,
    permissions?: Partial<Omit<RoleWithPermissions, 'role' | 'user_count'>>
  ) => Promise<boolean>;
  onDeleteRole: (role: AppRole) => Promise<boolean>;
}

export const RolesPermissionsManager = ({
  roles,
  isUpdating,
  onUpdateRole,
  onCreateRole,
  onDeleteRole,
}: RolesPermissionsManagerProps) => {
  const [editingRole, setEditingRole] = useState<RoleWithPermissions | null>(null);
  const [editForm, setEditForm] = useState<Partial<RoleWithPermissions> & { newRoleName?: string }>({});
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDescription, setNewRoleDescription] = useState('');
  const [deletingRole, setDeletingRole] = useState<RoleWithPermissions | null>(null);

  const handleEditClick = (role: RoleWithPermissions) => {
    setEditingRole(role);
    setEditForm({
      newRoleName: role.role,
      description: role.description || '',
      repository_read: role.repository_read,
      repository_write: role.repository_write,
      repository_delete: role.repository_delete,
      assistant_read: role.assistant_read,
      assistant_write: role.assistant_write,
      assistant_delete: role.assistant_delete,
    });
  };

  const handleSave = async () => {
    if (!editingRole) return;
    
    const updates: Partial<Omit<RoleWithPermissions, 'role' | 'user_count'>> & { newRoleName?: string } = {
      description: editForm.description,
      repository_read: editForm.repository_read,
      repository_write: editForm.repository_write,
      repository_delete: editForm.repository_delete,
      assistant_read: editForm.assistant_read,
      assistant_write: editForm.assistant_write,
      assistant_delete: editForm.assistant_delete,
    };
    
    // Only include newRoleName if it's different from the original
    if (editForm.newRoleName && editForm.newRoleName !== editingRole.role) {
      updates.newRoleName = editForm.newRoleName;
    }
    
    const success = await onUpdateRole(editingRole.role, updates);
    if (success) {
      setEditingRole(null);
      setEditForm({});
    }
  };

  const handlePermissionToggle = (
    permission: keyof Omit<RoleWithPermissions, 'role' | 'description' | 'user_count'>
  ) => {
    setEditForm(prev => ({
      ...prev,
      [permission]: !prev[permission],
    }));
  };

  const renderPermissionBadge = (enabled: boolean) => (
    <Badge 
      variant={enabled ? "default" : "secondary"}
      className={enabled ? "bg-primary/10 text-primary hover:bg-primary/20" : "bg-muted text-muted-foreground"}
    >
      {enabled ? "Yes" : "No"}
    </Badge>
  );

  const handleCreateRole = async () => {
    if (!newRoleName.trim()) return;
    
    const success = await onCreateRole(newRoleName.trim(), { description: newRoleDescription || null });
    if (success) {
      setIsCreateDialogOpen(false);
      setNewRoleName('');
      setNewRoleDescription('');
    }
  };

  const handleDeleteRole = async () => {
    if (!deletingRole) return;
    
    const success = await onDeleteRole(deletingRole.role);
    if (success) {
      setDeletingRole(null);
    }
  };

  const isAdminRole = (role: string) => role === 'admin';

  return (
    <>
      <Card className="border border-border/60 shadow-sm">
        <div className="p-6 border-b border-border/60 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Role Definitions</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Configure permissions for each role. Changes apply immediately to all users with that role.
            </p>
          </div>
          <Button onClick={() => setIsCreateDialogOpen(true)} disabled={isUpdating}>
            <Plus className="h-4 w-4 mr-2" />
            Add Role
          </Button>
        </div>
        
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[140px]">Role</TableHead>
                <TableHead className="w-[180px]">Description</TableHead>
                <TableHead className="text-center">Repository<br /><span className="text-xs font-normal">R / W / D</span></TableHead>
                <TableHead className="text-center">Assistant<br /><span className="text-xs font-normal">R / W / D</span></TableHead>
                <TableHead className="text-center w-[80px]">Users</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.map((role) => (
                <TableRow key={role.role}>
                  <TableCell className="font-medium">{role.role}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {role.description || <span className="italic">No description</span>}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-center gap-1">
                      {renderPermissionBadge(role.repository_read)}
                      {renderPermissionBadge(role.repository_write)}
                      {renderPermissionBadge(role.repository_delete)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-center gap-1">
                      {renderPermissionBadge(role.assistant_read)}
                      {renderPermissionBadge(role.assistant_write)}
                      {renderPermissionBadge(role.assistant_delete)}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-1 text-muted-foreground">
                      <Users className="h-3.5 w-3.5" />
                      <span className="text-sm">{role.user_count}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEditClick(role)}
                        disabled={isUpdating}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {!isAdminRole(role.role) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeletingRole(role)}
                          disabled={isUpdating || role.user_count > 0}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          title={role.user_count > 0 ? "Cannot delete: users assigned" : "Delete role"}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Edit Role Dialog */}
      <Dialog open={!!editingRole} onOpenChange={(open) => !open && setEditingRole(null)}>
        <DialogContent className="sm:max-w-[500px] bg-background">
          <DialogHeader>
            <DialogTitle>
              Edit {editingRole?.role} Role
            </DialogTitle>
            <DialogDescription>
              Configure the permissions for this role. Changes will affect all users with this role.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Role Name (editable for non-admin roles) */}
            {editingRole && !isAdminRole(editingRole.role) && (
              <div className="space-y-2">
                <Label htmlFor="roleName">Role Name</Label>
                <Input
                  id="roleName"
                  placeholder="Role name..."
                  value={editForm.newRoleName || ''}
                  onChange={(e) => setEditForm(prev => ({ ...prev, newRoleName: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">
                  Renaming will update all users currently assigned to this role.
                </p>
              </div>
            )}

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                placeholder="Brief description of this role..."
                value={editForm.description || ''}
                onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
              />
            </div>

            {/* Repository Permissions */}
            <div className="space-y-3">
              <Label className="text-base font-medium">Repository Permissions</Label>
              <div className="space-y-3 pl-1">
                <div className="flex items-center justify-between">
                  <Label htmlFor="repo-read" className="font-normal cursor-pointer">
                    Read - View documents and repository
                  </Label>
                  <Switch
                    id="repo-read"
                    checked={editForm.repository_read}
                    onCheckedChange={() => handlePermissionToggle('repository_read')}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="repo-write" className="font-normal cursor-pointer">
                    Write - Upload and edit documents
                  </Label>
                  <Switch
                    id="repo-write"
                    checked={editForm.repository_write}
                    onCheckedChange={() => handlePermissionToggle('repository_write')}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="repo-delete" className="font-normal cursor-pointer">
                    Delete - Remove documents
                  </Label>
                  <Switch
                    id="repo-delete"
                    checked={editForm.repository_delete}
                    onCheckedChange={() => handlePermissionToggle('repository_delete')}
                  />
                </div>
              </div>
            </div>

            {/* Assistant Permissions */}
            <div className="space-y-3">
              <Label className="text-base font-medium">Assistant Permissions</Label>
              <div className="space-y-3 pl-1">
                <div className="flex items-center justify-between">
                  <Label htmlFor="asst-read" className="font-normal cursor-pointer">
                    Read - Access the assistant
                  </Label>
                  <Switch
                    id="asst-read"
                    checked={editForm.assistant_read}
                    onCheckedChange={() => handlePermissionToggle('assistant_read')}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="asst-write" className="font-normal cursor-pointer">
                    Write - Send messages to assistant
                  </Label>
                  <Switch
                    id="asst-write"
                    checked={editForm.assistant_write}
                    onCheckedChange={() => handlePermissionToggle('assistant_write')}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="asst-delete" className="font-normal cursor-pointer">
                    Delete - Delete conversations
                  </Label>
                  <Switch
                    id="asst-delete"
                    checked={editForm.assistant_delete}
                    onCheckedChange={() => handlePermissionToggle('assistant_delete')}
                  />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingRole(null)} disabled={isUpdating}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isUpdating}>
              {isUpdating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Role Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="sm:max-w-[400px] bg-background">
          <DialogHeader>
            <DialogTitle>Create New Role</DialogTitle>
            <DialogDescription>
              Create a custom role with a unique name. You can configure permissions after creation.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new-role-name">Role Name</Label>
              <Input
                id="new-role-name"
                placeholder="e.g., viewer, editor, demo..."
                value={newRoleName}
                onChange={(e) => setNewRoleName(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
              />
              <p className="text-xs text-muted-foreground">
                Use lowercase letters and underscores only.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-role-description">Description (optional)</Label>
              <Input
                id="new-role-description"
                placeholder="Brief description of this role..."
                value={newRoleDescription}
                onChange={(e) => setNewRoleDescription(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)} disabled={isUpdating}>
              Cancel
            </Button>
            <Button onClick={handleCreateRole} disabled={isUpdating || !newRoleName.trim()}>
              {isUpdating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Role Confirmation */}
      <AlertDialog open={!!deletingRole} onOpenChange={(open) => !open && setDeletingRole(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Role</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the <span className="font-semibold">{deletingRole?.role}</span> role? 
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isUpdating}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDeleteRole}
              disabled={isUpdating}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isUpdating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
