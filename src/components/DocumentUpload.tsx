import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, FileText, Loader2, CheckCircle, XCircle, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface DocumentUploadProps {
  onIndexComplete: (documentsCount: number, chunksCount: number) => void;
}

interface Document {
  id: string;
  filename: string;
  doc_type: string | null;
  page_count: number | null;
  ingested_chunks: number | null;
  ingestion_status: string | null;
  ingestion_error: string | null;
  uploaded_at: string | null;
}

export const DocumentUpload = ({ onIndexComplete }: DocumentUploadProps) => {
  const [files, setFiles] = useState<File[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [documents, setDocuments] = useState<Document[]>([]);
  const { toast } = useToast();

  // Fetch documents on mount and set up realtime subscription
  useEffect(() => {
    fetchDocuments();
    
    // Subscribe to document changes
    const channel = supabase
      .channel('documents-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'documents' },
        () => {
          fetchDocuments();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchDocuments = async () => {
    const { data, error } = await supabase
      .from('documents')
      .select('id, filename, doc_type, page_count, ingested_chunks, ingestion_status, ingestion_error, uploaded_at')
      .order('uploaded_at', { ascending: false });

    if (error) {
      console.error('Error fetching documents:', error);
      return;
    }

    setDocuments(data || []);
    
    // Update parent with total chunks
    const { count } = await supabase
      .from('chunks')
      .select('*', { count: 'exact', head: true });
    
    onIndexComplete(data?.length || 0, count || 0);
  };

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
    const documentIds: string[] = [];

    try {
      // PHASE 1: Extract text and create chunks for all files
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);

        const extractResponse = await supabase.functions.invoke(
          "extract-pdf-text",
          { body: formData }
        );

        if (extractResponse.error) throw extractResponse.error;

        const { text, pageCount } = extractResponse.data as { text: string; pageCount?: number };

        if (!text) {
          throw new Error("No text could be extracted from this PDF.");
        }

        // Create document record
        const { data: document, error: docError } = await supabase
          .from("documents")
          .insert({
            filename: file.name,
            doc_type: inferDocType(file.name),
            ingestion_status: 'pending',
            page_count: pageCount || null,
          })
          .select()
          .single();

        if (docError) throw docError;

        // Process document - saves chunks without embeddings
        const processResponse = await supabase.functions.invoke(
          "process-document",
          {
            body: {
              documentId: document.id,
              filename: file.name,
              content: text,
              pageCount: pageCount,
            },
          }
        );

        if (processResponse.error) throw processResponse.error;
        documentIds.push(document.id);
      }

      toast({
        title: "Documents uploaded",
        description: `Processing embeddings for ${files.length} documents...`,
      });

      setFiles([]);
      fetchDocuments();

      // PHASE 2: Generate embeddings in background (in batches to avoid CPU timeout)
      for (const docId of documentIds) {
        let complete = false;
        let attempts = 0;
        const maxAttempts = 100; // Safety limit

        while (!complete && attempts < maxAttempts) {
          attempts++;
          const embedResponse = await supabase.functions.invoke(
            "generate-embeddings",
            { body: { documentId: docId } }
          );

          if (embedResponse.error) {
            console.error("Embedding error:", embedResponse.error);
            break;
          }

          complete = embedResponse.data.complete;
          
          if (!complete) {
            // Small delay between batches
            await new Promise(r => setTimeout(r, 100));
          }
        }
      }

      fetchDocuments();
      toast({
        title: "Knowledge base complete",
        description: `All documents have been fully indexed.`,
      });

    } catch (error: any) {
      console.error("Error building knowledge base:", error);
      toast({
        title: "Error building knowledge base",
        description: error.message || "An unexpected error occurred.",
        variant: "destructive",
      });
      fetchDocuments();
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

  const getStatusBadge = (doc: Document) => {
    const status = doc.ingestion_status || 'pending';
    
    if (status === 'complete') {
      return (
        <Badge variant="default" className="bg-green-600 hover:bg-green-600">
          <CheckCircle className="h-3 w-3 mr-1" />
          Complete ({doc.ingested_chunks || 0} chunks)
        </Badge>
      );
    }
    
    if (status === 'in_progress' || status === 'processing_embeddings') {
      return (
        <Badge variant="secondary" className="bg-blue-100 text-blue-800">
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          {status === 'processing_embeddings' ? 'Embeddings' : 'Processing'} ({doc.ingested_chunks || 0} chunks)
        </Badge>
      );
    }
    
    if (status === 'failed') {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <Badge variant="destructive">
                <XCircle className="h-3 w-3 mr-1" />
                Failed
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p className="max-w-xs">{doc.ingestion_error || 'Unknown error'}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
    
    return (
      <Badge variant="outline">
        <Clock className="h-3 w-3 mr-1" />
        Pending
      </Badge>
    );
  };

  return (
    <Card className="p-6">
      <div className="space-y-6">
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

        {/* Documents Table */}
        {documents.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-foreground">
              Indexed Documents ({documents.length})
            </h3>
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Filename</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Pages</TableHead>
                    <TableHead>Ingestion Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.map((doc) => (
                    <TableRow key={doc.id}>
                      <TableCell className="font-medium max-w-[200px] truncate">
                        {doc.filename}
                      </TableCell>
                      <TableCell>{doc.doc_type || 'unknown'}</TableCell>
                      <TableCell>{doc.page_count || '—'}</TableCell>
                      <TableCell>{getStatusBadge(doc)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
};
