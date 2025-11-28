import { Header } from "@/components/Header";
import { RepositoryCard } from "@/components/RepositoryCard";
import { AssistantCard } from "@/components/AssistantCard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const Index = () => {
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
                Switch between document repository and assistant.
              </p>
            </div>
            <TabsList>
              <TabsTrigger value="repository">Repository</TabsTrigger>
              <TabsTrigger value="assistant">Assistant</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="repository">
            <RepositoryCard />
          </TabsContent>
          <TabsContent value="assistant">
            <AssistantCard />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Index;