import { Header } from "@/components/Header";
import { RepositoryCard } from "@/components/RepositoryCard";
import { TechnicianChat } from "@/components/TechnicianChat";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/hooks/usePermissions";
import { Loader2, ChevronDown, Check } from "lucide-react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Project {
  id: string;
  name: string;
}

const Index = () => {
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [chunksCount, setChunksCount] = useState(0);
  const [hasDocuments, setHasDocuments] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("");
  const permissions = usePermissions();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const projectId = searchParams.get("project");

  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);

  useEffect(() => {
    const fetchProjects = async () => {
      const { data } = await supabase
        .from("projects")
        .select("id, name")
        .order("created_at", { ascending: false });
      if (data) {
        setProjects(data);
        if (projectId) {
          const found = data.find((p) => p.id === projectId);
          setCurrentProject(found || null);
        }
      }
    };
    fetchProjects();
  }, [projectId]);

  const fetchStats = async () => {
    let docsQuery = supabase.from('documents').select('*', { count: 'exact', head: true });
    let chunksQuery = supabase.from('chunks').select('*', { count: 'exact', head: true });

    if (projectId) {
      docsQuery = docsQuery.eq('project_id', projectId);
    }

    const { count: docsCount } = await docsQuery;
    const { count: chunksC } = await chunksQuery;

    setHasDocuments((docsCount || 0) > 0);
    setChunksCount(chunksC || 0);
  };

  useEffect(() => {
    fetchStats();

    const docsChannel = supabase
      .channel('docs-stats')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, fetchStats)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chunks' }, fetchStats)
      .subscribe();

    return () => {
      supabase.removeChannel(docsChannel);
    };
  }, [projectId]);

  const handleProjectSwitch = (project: Project) => {
    setCurrentProject(project);
    navigate(`/?project=${project.id}`);
  };

  if (permissions.isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="px-6 lg:px-10 py-10 flex items-center justify-center">
          <div className="flex items-center gap-3 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Loading permissions...</span>
          </div>
        </main>
      </div>
    );
  }

  if (!projectId || !currentProject) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="px-6 lg:px-10 py-10">
          <div className="text-center py-16">
            <h2 className="text-xl font-semibold text-foreground mb-2">No Project Selected</h2>
            <p className="text-muted-foreground">
              Please select a project from the{" "}
              <button onClick={() => navigate("/projects")} className="text-foreground underline underline-offset-4 hover:opacity-80">
                Projects page
              </button>.
            </p>
          </div>
        </main>
      </div>
    );
  }

  const canSeeRepository = permissions.repository.read;
  const canSeeAssistant = permissions.assistant.read;
  const defaultTab = canSeeRepository ? "repository" : canSeeAssistant ? "assistant" : "none";
  const currentTab = activeTab || defaultTab;

  if (!canSeeRepository && !canSeeAssistant) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="px-6 lg:px-10 py-10">
          <div className="text-center py-16">
            <h2 className="text-xl font-semibold text-foreground mb-2">No Access</h2>
            <p className="text-muted-foreground">
              Your account does not have access to any features. Please contact an administrator.
            </p>
            {permissions.role && (
              <p className="text-sm text-muted-foreground mt-4">
                Current role: <span className="font-medium capitalize">{permissions.role}</span>
              </p>
            )}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }} className="bg-popover">
      <Header />

      {/* Sub-header bar: project dropdown left, tabs right */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/50 bg-background flex-shrink-0">
        {/* Project selector */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-muted/60 transition-colors text-sm font-medium text-foreground">
              <span className="max-w-[200px] truncate">{currentProject.name}</span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64 bg-popover border border-border shadow-lg z-50">
            {projects.map((project) => (
              <DropdownMenuItem
                key={project.id}
                onClick={() => handleProjectSwitch(project)}
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

        {/* Repository / Assistant tabs */}
        {canSeeRepository && canSeeAssistant && (
          <div className="inline-flex items-center gap-1 bg-border/60 p-1 rounded-xl">
            <button
              onClick={() => setActiveTab("repository")}
              className={cn(
                "rounded-lg px-5 py-1.5 text-sm font-medium transition-all duration-200",
                currentTab === "repository"
                  ? "bg-card shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Repository
            </button>
            <button
              onClick={() => setActiveTab("assistant")}
              className={cn(
                "rounded-lg px-5 py-1.5 text-sm font-medium transition-all duration-200",
                currentTab === "assistant"
                  ? "bg-card shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Assistant
            </button>
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', minHeight: 0 }}>
        <Tabs value={currentTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-w-0" style={{ minHeight: 0 }}>
          {canSeeRepository && (
            <TabsContent
              value="repository"
              className="flex-1 mt-0 flex flex-col data-[state=inactive]:hidden"
              style={{ minHeight: 0, overflow: 'hidden' }}
            >
              <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
                <main className="px-4 py-6 bg-popover">
                  <RepositoryCard
                    onDocumentSelect={setSelectedDocumentId}
                    permissions={permissions.repository}
                    projectId={projectId}
                  />
                </main>
              </div>
            </TabsContent>
          )}

          {canSeeAssistant && (
            <TabsContent
              value="assistant"
              className="flex-1 mt-0 flex flex-col data-[state=inactive]:hidden"
              style={{ overflow: 'hidden', minHeight: 0 }}
            >
              <div style={{ flex: 1, overflow: 'hidden', display: 'flex', minHeight: 0 }}>
                <TechnicianChat
                  hasDocuments={hasDocuments}
                  chunksCount={chunksCount}
                  permissions={permissions.assistant}
                  showTabBar={false}
                  currentTab={currentTab}
                  onTabChange={setActiveTab}
                  projectId={projectId}
                />
              </div>
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  );
};

export default Index;
