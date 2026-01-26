import { useAuth } from "@/contexts/AuthContext";
import { UserMenu } from "@/components/UserMenu";

export const Header = () => {
  const { user } = useAuth();

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
        {user && <UserMenu />}
      </div>
    </header>
  );
};
