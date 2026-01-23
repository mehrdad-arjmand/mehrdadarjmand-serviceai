import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

export const Header = () => {
  const { user, signOut } = useAuth();

  return (
    <header className="sticky top-0 z-50 glass border-b border-border/50">
      <div 
        className="mx-auto px-8 py-5 flex items-center justify-between"
        style={{ maxWidth: "1040px" }}
      >
        {/* Logo & Title */}
        <div className="flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-foreground flex items-center justify-center shadow-premium">
            <span className="text-background font-semibold text-sm tracking-tight">AI</span>
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground tracking-tight">Service AI</h1>
            <p className="text-xs text-muted-foreground font-normal">Technician Knowledge Base</p>
          </div>
        </div>

        {/* User actions */}
        {user && (
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground hidden sm:inline font-normal">
              {user.email}
            </span>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={signOut} 
              className="gap-2 text-muted-foreground hover:text-foreground hover:bg-accent/80 transition-all duration-200"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        )}
      </div>
    </header>
  );
};
