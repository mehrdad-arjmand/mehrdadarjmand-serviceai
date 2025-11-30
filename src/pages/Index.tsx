import { Header } from "@/components/Header";
import { RepositoryCard } from "@/components/RepositoryCard";
import { TechnicianChat } from "@/components/TechnicianChat";
import { DocumentDetails } from "@/components/DocumentDetails";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

const Index = () => {
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [chunksCount, setChunksCount] = useState(0);
  const [hasDocuments, setHasDocuments] = useState(false);

  useEffect(() => {
    const fetchStats = async () => {
      const { count: docsCount } = await supabase
        .from('documents')
        .select('*', { count: 'exact', head: true });
      
      const { count: chunksCount } = await supabase
        .from('chunks')
        .select('*', { count: 'exact', head: true });

      setHasDocuments((docsCount || 0) > 0);
      setChunksCount(chunksCount || 0);
    };

    fetchStats();
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />

      {/* Main Content */}
      <main className="container mx-auto px-6 py-8" style={{ maxWidth: "1040px" }}>
        {/* Workspace Section */}
        <Tabs defaultValue="repository" className="w-full">
          <div className="flex items-end justify-between mb-6">
            <div>
              <h2 className="text-2xl font-semibold text-foreground">Workspace</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Switch between document repository, assistant, and document details.
              </p>
            </div>
            <TabsList>
              <TabsTrigger value="repository">Repository</TabsTrigger>
              <TabsTrigger value="assistant">Assistant</TabsTrigger>
              <TabsTrigger value="details">Details</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="repository">
            <RepositoryCard onDocumentSelect={setSelectedDocumentId} />
          </TabsContent>
          <TabsContent value="assistant">
            <TechnicianChat hasDocuments={hasDocuments} chunksCount={chunksCount} />
          </TabsContent>
          <TabsContent value="details">
            <DocumentDetails selectedDocumentId={selectedDocumentId} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Index;