import { LogOut, Settings, User, Shield, BarChart3 } from "lucide-react";
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

  const isAdmin = permissions.role === 'admin';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent/80 transition-all duration-200"
          title={user?.email}
        >
          <User className="h-7 w-7" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56 bg-popover border border-border shadow-lg z-50"
      >
        <DropdownMenuLabel className="font-normal">
          <p className="text-sm font-medium leading-none truncate">
            {user?.email}
          </p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={() => navigate('/settings')}
          className="cursor-pointer"
        >
          <Settings className="mr-2 h-4 w-4" />
          <span>Settings</span>
        </DropdownMenuItem>

        {isAdmin && (
          <>
            <DropdownMenuItem
              onClick={() => navigate('/admin/roles')}
              className="cursor-pointer"
            >
              <Shield className="mr-2 h-4 w-4" />
              <span>Roles & Permissions</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => navigate('/admin/analytics')}
              className="cursor-pointer"
            >
              <BarChart3 className="mr-2 h-4 w-4" />
              <span>Query Analytics</span>
            </DropdownMenuItem>
          </>
        )}

        <DropdownMenuSeparator />
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
