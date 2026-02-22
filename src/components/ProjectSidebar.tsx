import { ChevronDown, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import React from "react";

interface Project {
  id: string;
  name: string;
}

interface ProjectSidebarProps {
  projects: Project[];
  currentProject: Project;
  onProjectSwitch: (project: Project) => void;
  tabSwitcher?: React.ReactNode;
  children?: React.ReactNode;
}

export const ProjectSidebar = ({ projects, currentProject, onProjectSwitch, tabSwitcher, children }: ProjectSidebarProps) => {
  return (
    <div
      style={{
        width: '260px',
        flexShrink: 0,
        height: '100%',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'hsl(var(--sidebar-background))',
        borderRight: '1px solid hsl(var(--sidebar-border))'
      }}
    >
      {/* Project selector dropdown — blends with sidebar background */}
      <div className="flex-shrink-0 pl-4 pr-4 pt-3 pb-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 w-full px-0 py-2 text-sm font-medium text-foreground hover:opacity-80 transition-opacity">
              <span className="flex-1 text-left truncate">{currentProject.name}</span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56 bg-popover border border-border shadow-lg z-50">
            {projects.map((project) => (
              <DropdownMenuItem
                key={project.id}
                onClick={() => onProjectSwitch(project)}
                className="flex items-center justify-between"
              >
                <span className="truncate">{project.name}</span>
                {project.id === currentProject.id && (
                  <Check className="h-4 w-4 text-foreground flex-shrink-0" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Tab switcher */}
      {tabSwitcher && (
        <div className="flex-shrink-0 pl-4 pr-4 pb-3">
          {tabSwitcher}
        </div>
      )}

      {/* Optional children (e.g. conversation list) */}
      {children}
    </div>
  );
};
