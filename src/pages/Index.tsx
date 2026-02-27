import { Header } from "@/components/Header";
import { RepositoryCard } from "@/components/RepositoryCard";
import { TechnicianChat } from "@/components/TechnicianChat";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/hooks/usePermissions";
import { Loader2 } from "lucide-react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

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
      setProjectsFetched(true);
    };
    fetchProjects();
  }, [projectId]);

  const fetchStats = async () => {
    try {
      let docsQuery = supabase.from('documents').select('id', { count: 'exact' });

      if (projectId) {
        docsQuery = docsQuery.eq('project_id', projectId);
      }

      const { data: docsData, count: docsCount, error: docsError } = await docsQuery;
      
      if (docsError) {
        console.error('Error fetching document stats:', docsError);
      }

      // Use data length as fallback if count is null
      const docCount = docsCount ?? docsData?.length ?? 0;
      setHasDocuments(docCount > 0);

      // Get chunks count filtered by project documents
      if (projectId && docsData && docsData.length > 0) {
        const docIds = docsData.map(d => d.id);
        const { count: chunksC } = await supabase
          .from('chunks')
          .select('*', { count: 'exact', head: true })
          .in('document_id', docIds);
        setChunksCount(chunksC || 0);
      } else if (!projectId) {
        const { count: chunksC } = await supabase
          .from('chunks')
          .select('*', { count: 'exact', head: true });
        setChunksCount(chunksC || 0);
      } else {
        setChunksCount(0);
      }
    } catch (err) {
      console.error('Error in fetchStats:', err);
    }
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

  // Redirect to /projects if no project selected
  const [projectsFetched, setProjectsFetched] = useState(false);

  useEffect(() => {
    if (projectsFetched && !projectId) {
      navigate("/projects", { replace: true });
    }
  }, [projectId, projectsFetched, navigate]);

  const handleProjectSwitch = (project: Project) => {
    setCurrentProject(project);
    navigate(`/?project=${project.id}`);
  };

  if (permissions.isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="flex items-center justify-center" style={{ height: 'calc(100vh - 80px)' }}>
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </main>
      </div>
    );
  }

  if (!projectId || !currentProject) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="flex items-center justify-center" style={{ height: 'calc(100vh - 80px)' }}>
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
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

  // Build tab switcher element to pass into children
  const tabSwitcher = canSeeRepository && canSeeAssistant ? (
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
  ) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }} className="bg-popover">
      <Header />

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', minHeight: 0 }}>
        <Tabs value={currentTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-w-0" style={{ minHeight: 0 }}>
          {canSeeRepository && (
            <TabsContent
              value="repository"
              className="flex-1 mt-0 flex flex-col data-[state=inactive]:hidden"
              style={{ minHeight: 0, overflow: 'hidden' }}
            >
              <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
                <main className="bg-popover">
                  <RepositoryCard
                    onDocumentSelect={setSelectedDocumentId}
                    permissions={permissions.repository}
                    projectId={projectId}
                    projects={projects}
                    currentProject={currentProject}
                    onProjectSwitch={handleProjectSwitch}
                    tabSwitcher={tabSwitcher}
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
                  projects={projects}
                  currentProject={currentProject}
                  onProjectSwitch={handleProjectSwitch}
                  tabSwitcher={tabSwitcher}
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
