import { AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export const Header = () => {
  return (
    <header className="sticky top-0 z-10 bg-card border-b border-border">
      <div className="container mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-semibold text-sm">AI</span>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Service AI</h1>
            <p className="text-xs text-muted-foreground">Simple prototype · UI only</p>
          </div>
        </div>
        <Badge variant="outline" className="gap-1.5">
          <AlertCircle className="h-3 w-3" />
          Demo: backend not wired
        </Badge>
      </div>
    </header>
  );
};
