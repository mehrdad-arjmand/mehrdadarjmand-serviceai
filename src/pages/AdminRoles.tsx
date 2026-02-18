import { Header } from "@/components/Header";
import { RolesPermissionsManager } from "@/components/RolesPermissionsManager";
import { UsersRolesList } from "@/components/UsersRolesList";
import { usePermissions } from "@/hooks/usePermissions";
import { useRolesManagement } from "@/hooks/useRolesManagement";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Shield, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";

const AdminRoles = () => {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const rolesManagement = useRolesManagement();

  // Check if user is admin
  const isAdmin = permissions.role === 'admin';

  if (permissions.isLoading || rolesManagement.isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="px-6 lg:px-10 py-10 flex items-center justify-center">
          <div className="flex items-center gap-3 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Loading...</span>
          </div>
        </main>
      </div>
    );
  }

  // Redirect non-admins
  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="px-6 lg:px-10 py-10">
          <div className="text-center py-16">
            <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-foreground mb-2">Access Denied</h2>
            <p className="text-muted-foreground mb-6">
              You need administrator privileges to access this page.
            </p>
            <Button onClick={() => navigate('/')} variant="outline">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Go Back
            </Button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="px-6 lg:px-10 py-10">
        {/* Page Header */}
        <div className="flex items-center gap-4 mb-8">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => navigate('/')}
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </div>

        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground tracking-tight flex items-center gap-3">
            <Shield className="h-6 w-6" />
            Roles & Permissions
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            Manage roles, permissions, and user assignments.
          </p>
        </div>

        <Tabs defaultValue="roles" className="w-full">
          <TabsList className="bg-muted/60 p-1 rounded-xl mb-6">
            <TabsTrigger 
              value="roles" 
              className="rounded-lg px-4 py-2 text-sm font-medium data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all duration-200 gap-2"
            >
              <Shield className="h-4 w-4" />
              Roles
            </TabsTrigger>
            <TabsTrigger 
              value="users"
              className="rounded-lg px-4 py-2 text-sm font-medium data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all duration-200 gap-2"
            >
              <Users className="h-4 w-4" />
              Users
            </TabsTrigger>
          </TabsList>

          <TabsContent value="roles" className="mt-0">
            <RolesPermissionsManager 
              roles={rolesManagement.roles}
              isUpdating={rolesManagement.isUpdating}
              onUpdateRole={rolesManagement.updateRolePermissions}
              onCreateRole={rolesManagement.createRole}
              onDeleteRole={rolesManagement.deleteRole}
            />
          </TabsContent>

          <TabsContent value="users" className="mt-0">
            <UsersRolesList 
              users={rolesManagement.users}
              roles={rolesManagement.roles}
              isUpdating={rolesManagement.isUpdating}
              onAssignRole={rolesManagement.assignUserRole}
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default AdminRoles;
