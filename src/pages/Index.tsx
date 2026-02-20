import { Header } from "@/components/Header";
import { RepositoryCard } from "@/components/RepositoryCard";
import { TechnicianChat } from "@/components/TechnicianChat";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/hooks/usePermissions";
import { Loader2 } from "lucide-react";

const Index = () => {
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [chunksCount, setChunksCount] = useState(0);
  const [hasDocuments, setHasDocuments] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("");
  const permissions = usePermissions();

  const fetchStats = async () => {
    const { count: docsCount } = await supabase.
    from('documents').
    select('*', { count: 'exact', head: true });

    const { count: chunksCount } = await supabase.
    from('chunks').
    select('*', { count: 'exact', head: true });

    setHasDocuments((docsCount || 0) > 0);
    setChunksCount(chunksCount || 0);
  };

  useEffect(() => {
    fetchStats();

    const docsChannel = supabase.
    channel('docs-stats').
    on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, fetchStats).
    on('postgres_changes', { event: '*', schema: 'public', table: 'chunks' }, fetchStats).
    subscribe();

    return () => {
      supabase.removeChannel(docsChannel);
    };
  }, []);

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
      </div>);

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
            {permissions.role &&
            <p className="text-sm text-muted-foreground mt-4">
                Current role: <span className="font-medium capitalize">{permissions.role}</span>
              </p>
            }
          </div>
        </main>
      </div>);

  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }} className="bg-background">
      <Header />

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', minHeight: 0 }}>
        <Tabs value={currentTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-w-0" style={{ minHeight: 0 }}>
          {canSeeRepository &&
          <TabsContent
            value="repository"
            className="flex-1 mt-0 flex flex-col data-[state=inactive]:hidden"
            style={{ minHeight: 0, overflow: 'hidden' }}>

              <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
                {canSeeRepository && canSeeAssistant &&
              <div className="pl-4 pt-4 bg-popover">
                    <TabsList className="bg-muted/60 p-1 rounded-xl">
                      <TabsTrigger value="repository" className="rounded-lg px-4 py-1.5 text-sm font-medium data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all duration-200">
                        Repository
                      </TabsTrigger>
                      <TabsTrigger value="assistant" className="rounded-lg px-4 py-1.5 text-sm font-medium data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all duration-200">
                        Assistant
                      </TabsTrigger>
                    </TabsList>
                  </div>
              }
                <main className="px-4 py-6 bg-popover">
                  <RepositoryCard
                  onDocumentSelect={setSelectedDocumentId}
                  permissions={permissions.repository} />

                </main>
              </div>
            </TabsContent>
          }

          {canSeeAssistant &&
          <TabsContent
            value="assistant"
            className="flex-1 mt-0 flex flex-col data-[state=inactive]:hidden"
            style={{ overflow: 'hidden', minHeight: 0 }}>

              <div style={{ flex: 1, overflow: 'hidden', display: 'flex', minHeight: 0 }}>
                <TechnicianChat
                hasDocuments={hasDocuments}
                chunksCount={chunksCount}
                permissions={permissions.assistant}
                showTabBar={canSeeRepository && canSeeAssistant}
                currentTab={currentTab}
                onTabChange={setActiveTab} />

              </div>
            </TabsContent>
          }
        </Tabs>
      </div>
    </div>);

};

export default Index;