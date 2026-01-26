import { LogOut, Settings, User, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useNavigate } from "react-router-dom";

export const UserMenu = () => {
  const { user, signOut } = useAuth();
  const permissions = usePermissions();
  const navigate = useNavigate();

  // Only admins can see the roles management option
  const isAdmin = permissions.role === 'admin';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="ghost" 
          size="sm" 
          className="gap-2 text-muted-foreground hover:text-foreground hover:bg-accent/80 transition-all duration-200"
        >
          <User className="h-4 w-4" />
          <span className="hidden sm:inline truncate max-w-[180px]">
            {user?.email}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent 
        align="end" 
        className="w-56 bg-popover border border-border shadow-lg z-50"
      >
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">Account</p>
            <p className="text-xs leading-none text-muted-foreground truncate">
              {user?.email}
            </p>
            {permissions.role && (
              <p className="text-xs leading-none text-muted-foreground capitalize">
                Role: {permissions.role}
              </p>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {isAdmin && (
          <>
            <DropdownMenuItem 
              onClick={() => navigate('/admin/roles')}
              className="cursor-pointer"
            >
              <Shield className="mr-2 h-4 w-4" />
              <span>Manage Roles & Permissions</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem 
          onClick={signOut}
          className="cursor-pointer text-destructive focus:text-destructive"
        >
          <LogOut className="mr-2 h-4 w-4" />
          <span>Log out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
