import { useState } from "react";
import { DocumentUpload } from "@/components/DocumentUpload";
import { TechnicianChat } from "@/components/TechnicianChat";

const Index = () => {
  const [documentsCount, setDocumentsCount] = useState(0);
  const [chunksCount, setChunksCount] = useState(0);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-6 py-4">
          <h1 className="text-xl font-semibold text-foreground">
            Field Technician Knowledge Base
            <span className="ml-2 text-sm font-normal text-muted-foreground">· Prototype</span>
          </h1>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Panel - Context & Documents */}
          <div className="space-y-6">
            <DocumentUpload 
              onIndexComplete={(docs, chunks) => {
                setDocumentsCount(docs);
                setChunksCount(chunks);
              }}
            />
          </div>

          {/* Right Panel - Technician Assistant */}
          <div className="space-y-6">
            <TechnicianChat 
              hasDocuments={documentsCount > 0}
              chunksCount={chunksCount}
            />
          </div>
        </div>
      </main>
    </div>
  );
};

export default Index;