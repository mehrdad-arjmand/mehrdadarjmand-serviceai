import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

export const Header = () => {
  const { user, signOut } = useAuth();

  return (
    <header className="sticky top-0 z-10 bg-card border-b border-border">
      <div className="container mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-semibold text-sm">AI</span>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Service AI</h1>
            <p className="text-xs text-muted-foreground">Technician Knowledge Base</p>
          </div>
        </div>
        {user && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground hidden sm:inline">
              {user.email}
            </span>
            <Button variant="outline" size="sm" onClick={signOut} className="gap-2">
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        )}
      </div>
    </header>
  );
};
