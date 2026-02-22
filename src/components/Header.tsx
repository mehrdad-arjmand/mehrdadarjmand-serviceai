import { useAuth } from "@/contexts/AuthContext";
import { UserMenu } from "@/components/UserMenu";
import { useNavigate } from "react-router-dom";

export const Header = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-50 glass border-b border-border/50">
      <div className="w-full px-4 py-4 flex items-center justify-between">
        {/* Logo & Title — clickable to Projects */}
        <button
          onClick={() => navigate("/projects")}
          className="flex items-center gap-3 hover:opacity-80 transition-opacity"
        >
          <div className="w-9 h-9 rounded-xl bg-foreground flex items-center justify-center shadow-premium flex-shrink-0">
            <span className="text-background font-semibold text-xs tracking-tight">AI</span>
          </div>
          <div className="text-left">
            <h1 className="text-base font-semibold text-foreground tracking-tight leading-tight">Service AI</h1>
            <p className="text-[11px] text-muted-foreground font-normal leading-tight">Enterprise Knowledge Base</p>
          </div>
        </button>

        {/* User actions */}
        {user && <UserMenu />}
      </div>
    </header>
  );
};
