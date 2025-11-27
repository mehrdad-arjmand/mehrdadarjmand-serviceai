import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, FileText, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface DocumentUploadProps {
  onIndexComplete: (documentsCount: number, chunksCount: number) => void;
}

export const DocumentUpload = ({ onIndexComplete }: DocumentUploadProps) => {
  const [files, setFiles] = useState<File[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files).filter(
        (file) => file.type === "application/pdf"
      );
      setFiles((prev) => [...prev, ...newFiles]);
    }
  };

  const handleBuildKnowledgeBase = async () => {
    if (files.length === 0) {
      toast({
        title: "No files selected",
        description: "Please select at least one PDF file to upload.",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    let totalChunks = 0;

    try {
      for (const file of files) {
        // 1. Extract text from PDF
        const formData = new FormData();
        formData.append("file", file);

        const extractResponse = await supabase.functions.invoke(
          "extract-pdf-text",
          {
            body: formData,
          }
        );

        if (extractResponse.error) throw extractResponse.error;

        const { text } = extractResponse.data as { text: string };

        // Limit text size on the client before sending to the Edge function
        const MAX_TEXT_LENGTH = 40000;
        const truncatedText =
          typeof text === "string" ? text.slice(0, MAX_TEXT_LENGTH) : "";

        if (!truncatedText) {
          throw new Error("No text could be extracted from this PDF.");
        }

        // 2. Create document record
        const { data: document, error: docError } = await supabase
          .from("documents")
          .insert({
            filename: file.name,
            doc_type: inferDocType(file.name),
          })
          .select()
          .single();

        if (docError) throw docError;

        // 3. Process document (chunk and embed)
        const processResponse = await supabase.functions.invoke(
          "process-document",
          {
            body: {
              documentId: document.id,
              filename: file.name,
              content: truncatedText,
            },
          }
        );

        if (processResponse.error) throw processResponse.error;

        totalChunks += processResponse.data.chunksCount;
      }

      toast({
        title: "Knowledge base built successfully",
        description: `Indexed ${totalChunks} chunks from ${files.length} documents.`,
      });

      onIndexComplete(files.length, totalChunks);
      setFiles([]);
    } catch (error: any) {
      console.error("Error building knowledge base:", error);
      toast({
        title: "Error building knowledge base",
        description: error.message || "An unexpected error occurred.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const inferDocType = (filename: string): string => {
    const lower = filename.toLowerCase();
    if (lower.includes("report") || lower.includes("daily")) return "report";
    if (lower.includes("manual")) return "manual";
    if (lower.includes("procedure") || lower.includes("sop")) return "procedure";
    if (lower.includes("project")) return "project_doc";
    return "unknown";
  };

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-1">
            Upload Documents
          </h2>
          <p className="text-sm text-muted-foreground">
            Add PDF files to build your knowledge base
          </p>
        </div>

        {/* File Input */}
        <div className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary/50 transition-colors">
          <input
            type="file"
            id="file-upload"
            multiple
            accept=".pdf"
            onChange={handleFileSelect}
            className="hidden"
            disabled={isProcessing}
          />
          <label
            htmlFor="file-upload"
            className="cursor-pointer flex flex-col items-center gap-2"
          >
            <Upload className="h-8 w-8 text-muted-foreground" />
            <div className="text-sm">
              <span className="font-medium text-primary">Click to upload</span>
              <span className="text-muted-foreground"> or drag and drop</span>
            </div>
            <span className="text-xs text-muted-foreground">PDF files only</span>
          </label>
        </div>

        {/* Selected Files */}
        {files.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">
              Selected files ({files.length}):
            </p>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {files.map((file, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded px-3 py-2"
                >
                  <FileText className="h-4 w-4" />
                  <span className="truncate">{file.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Build Button */}
        <Button
          onClick={handleBuildKnowledgeBase}
          disabled={files.length === 0 || isProcessing}
          className="w-full"
        >
          {isProcessing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Building Knowledge Base...
            </>
          ) : (
            "Build Knowledge Base"
          )}
        </Button>
      </div>
    </Card>
  );
};