import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-6">
        <img src="/logo.svg" alt="Service AI" className="w-16 h-16" />
        <div className="w-48 flex flex-col items-center gap-3">
          <div className="w-full h-1 rounded-full bg-border overflow-hidden">
            <div className="h-full bg-foreground rounded-full animate-loading-bar" />
          </div>
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
