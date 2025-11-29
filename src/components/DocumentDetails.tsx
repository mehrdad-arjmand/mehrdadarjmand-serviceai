import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { FileText } from "lucide-react";

interface DocumentDetailsProps {
  selectedDocumentId: string | null;
}

interface DocumentDetail {
  id: string;
  fileName: string;
  fileType: string;
  docType: string;
  equipmentType: string;
  extractedText: string;
  textLength: number;
  createdAt: string;
}

export const DocumentDetails = ({ selectedDocumentId }: DocumentDetailsProps) => {
  const [document, setDocument] = useState<DocumentDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedDocumentId) {
      setDocument(null);
      return;
    }

    const fetchDocument = async () => {
      setLoading(true);
      try {
        const { data: doc, error } = await supabase
          .from('documents')
          .select('*')
          .eq('id', selectedDocumentId)
          .single();

        if (error) throw error;

        if (doc) {
          const { data: chunks, error: chunksError } = await supabase
            .from('chunks')
            .select('text, chunk_index, equipment')
            .eq('document_id', doc.id)
            .order('chunk_index');

          if (chunksError) throw chunksError;

          const extractedText = chunks?.map(c => c.text).join('') || '';
          const equipment = chunks?.[0]?.equipment || 'unknown';

          setDocument({
            id: doc.id,
            fileName: doc.filename,
            fileType: doc.filename.split('.').pop() || 'unknown',
            docType: doc.doc_type || 'unknown',
            equipmentType: equipment,
            extractedText,
            textLength: extractedText.length,
            createdAt: doc.uploaded_at || new Date().toISOString(),
          });
        }
      } catch (error) {
        console.error('Error fetching document:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDocument();
  }, [selectedDocumentId]);

  if (!selectedDocumentId) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Document Details</CardTitle>
          <CardDescription>Select a document from the Repository tab to view its full content.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-[400px] text-muted-foreground">
          <div className="text-center space-y-2">
            <FileText className="h-16 w-16 mx-auto opacity-20" />
            <p>No document selected</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Document Details</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-[400px]">
          <p className="text-muted-foreground">Loading...</p>
        </CardContent>
      </Card>
    );
  }

  if (!document) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Document Details</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-[400px]">
          <p className="text-destructive">Document not found</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {document.fileName}
            </CardTitle>
            <CardDescription>
              Full extracted text from this document
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline" className="uppercase">{document.fileType}</Badge>
            <Badge variant="secondary" className="capitalize">{document.equipmentType}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Document Type</p>
            <p className="font-medium capitalize">{document.docType}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Text Length</p>
            <p className="font-medium">{document.textLength.toLocaleString()} characters</p>
          </div>
          <div>
            <p className="text-muted-foreground">Uploaded</p>
            <p className="font-medium">{new Date(document.createdAt).toLocaleDateString()}</p>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Full Content</p>
          <ScrollArea className="h-[500px] border rounded-lg p-4 bg-muted/30">
            <pre className="text-xs whitespace-pre-wrap font-mono">
              {document.extractedText}
            </pre>
          </ScrollArea>
        </div>
      </CardContent>
    </Card>
  );
};
