import { Upload, FileText, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect } from "react";

interface Document {
  id: string;
  fileName: string;
  fileType: string;
  docType: string;
  equipmentType: string;
  extractedText: string;
  textLength: number;
  error: string | null;
  createdAt: string;
}

interface RepositoryCardProps {
  onDocumentSelect?: (id: string | null) => void;
}

export const RepositoryCard = ({ onDocumentSelect }: RepositoryCardProps) => {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [docType, setDocType] = useState<string>("");
  const [equipmentType, setEquipmentType] = useState<string>("");

  // Fetch documents from database on mount
  useEffect(() => {
    const fetchDocuments = async () => {
      try {
        const { data: docs, error } = await supabase
          .from('documents')
          .select('*')
          .order('uploaded_at', { ascending: false });

        if (error) throw error;

        if (docs) {
          // Fetch chunks for each document to reconstruct full text
          const documentsWithText = await Promise.all(
            docs.map(async (doc) => {
              const { data: chunks, error: chunksError } = await supabase
                .from('chunks')
                .select('text, chunk_index, equipment')
                .eq('document_id', doc.id)
                .order('chunk_index');

              if (chunksError) {
                console.error('Error fetching chunks:', chunksError);
                return null;
              }

              const extractedText = chunks?.map(c => c.text).join('') || '';
              const equipment = chunks?.[0]?.equipment || 'unknown';

              return {
                id: doc.id,
                fileName: doc.filename,
                fileType: doc.filename.split('.').pop() || 'unknown',
                docType: doc.doc_type || 'unknown',
                equipmentType: equipment,
                extractedText,
                textLength: extractedText.length,
                error: null,
                createdAt: doc.uploaded_at || new Date().toISOString(),
              };
            })
          );

          setDocuments(documentsWithText.filter(d => d !== null) as Document[]);
        }
      } catch (error) {
        console.error('Error fetching documents:', error);
      }
    };

    fetchDocuments();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setSelectedFiles(files);
    }
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) {
      toast({
        title: "No files selected",
        description: "Please select at least one file",
        variant: "destructive",
      });
      return;
    }

    if (!docType || !equipmentType) {
      toast({
        title: "Missing metadata",
        description: "Please select document type and equipment type",
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);

    try {
      const formData = new FormData();
      selectedFiles.forEach(file => formData.append('files', file));
      formData.append('docType', docType);
      formData.append('equipmentType', equipmentType);

      const { data, error } = await supabase.functions.invoke('ingest', {
        body: formData,
      });

      if (error) throw error;

      if (data.success) {
        setDocuments(prev => [...prev, ...data.documents]);
        toast({
          title: "Upload successful",
          description: `Processed ${data.documents.length} file(s)`,
        });

        // Reset form
        setSelectedFiles([]);
        const fileInput = document.getElementById('file-upload') as HTMLInputElement;
        if (fileInput) fileInput.value = '';
      } else {
        throw new Error(data.error || 'Upload failed');
      }
    } catch (error: any) {
      console.error('Upload error:', error);
      toast({
        title: "Upload failed",
        description: error.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (docId: string, fileName: string) => {
    if (!confirm(`Delete "${fileName}"? This will remove it from the knowledge base.`)) {
      return;
    }

    try {
      // Delete chunks first (foreign key constraint)
      const { error: chunksError } = await supabase
        .from('chunks')
        .delete()
        .eq('document_id', docId);

      if (chunksError) throw chunksError;

      // Delete document
      const { error: docError } = await supabase
        .from('documents')
        .delete()
        .eq('id', docId);

      if (docError) throw docError;

      // Update UI
      setDocuments(prev => prev.filter(d => d.id !== docId));
      if (selectedDocId === docId) {
        setSelectedDocId(null);
        onDocumentSelect?.(null);
      }

      toast({
        title: "Document deleted",
        description: `"${fileName}" has been removed from the knowledge base.`,
      });
    } catch (error: any) {
      console.error('Delete error:', error);
      toast({
        title: "Delete failed",
        description: error.message || "Unknown error",
        variant: "destructive",
      });
    }
  };

  const selectedDoc = documents.find(doc => doc.id === selectedDocId);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Upload documents</CardTitle>
        <CardDescription>
          Add PDFs, Word files, or text documents to build your knowledge base.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Upload Area */}
        <div className="border-2 border-dashed border-border rounded-lg p-12 text-center hover:border-muted-foreground/50 transition-colors cursor-pointer">
          <input
            type="file"
            id="file-upload"
            multiple
            accept=".pdf,.docx,.txt"
            className="hidden"
            onChange={handleFileChange}
          />
          <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center gap-3">
            <Upload className="h-10 w-10 text-muted-foreground" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                {selectedFiles.length > 0 
                  ? `${selectedFiles.length} file(s) selected` 
                  : "Click to upload or drag and drop"}
              </p>
              <p className="text-xs text-muted-foreground">
                PDF, DOCX, or TXT files (multiple allowed)
              </p>
            </div>
          </label>
        </div>

        <Separator />

        {/* Metadata Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="doc-type">Document type</Label>
            <Select value={docType} onValueChange={setDocType}>
              <SelectTrigger id="doc-type">
                <SelectValue placeholder="Select document type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="report">Daily / shift report</SelectItem>
                <SelectItem value="procedure">Procedure / SOP</SelectItem>
                <SelectItem value="project">Project document</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="equipment-type">Equipment type</Label>
            <Select value={equipmentType} onValueChange={setEquipmentType}>
              <SelectTrigger id="equipment-type">
                <SelectValue placeholder="Select equipment type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inverter">Inverter</SelectItem>
                <SelectItem value="battery">Battery</SelectItem>
                <SelectItem value="converter">Converter</SelectItem>
                <SelectItem value="pcs">PCS</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Notes */}
        <div className="space-y-2">
          <Label htmlFor="notes">Notes (optional)</Label>
          <Textarea
            id="notes"
            placeholder="Short description, e.g. 'XG-4000 inverter commissioning logs for Site-23'."
            rows={3}
            className="resize-none"
          />
        </div>

        {/* Upload Button */}
        <div className="flex justify-end">
          <Button size="lg" onClick={handleUpload} disabled={selectedFiles.length === 0 || isUploading || !docType || !equipmentType}>
            {isUploading ? "Uploading..." : "Upload"}
          </Button>
        </div>

        {/* Documents Table */}
        {documents.length > 0 && (
          <>
            <Separator />
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Documents</h3>
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Length</TableHead>
                      <TableHead>Equipment</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {documents.map((doc) => (
                      <TableRow 
                        key={doc.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => {
                          const newId = doc.id === selectedDocId ? null : doc.id;
                          setSelectedDocId(newId);
                          onDocumentSelect?.(newId);
                        }}
                      >
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            {doc.fileName}
                          </div>
                        </TableCell>
                        <TableCell className="uppercase text-xs">{doc.fileType}</TableCell>
                        <TableCell>{doc.textLength.toLocaleString()} chars</TableCell>
                        <TableCell className="capitalize">{doc.equipmentType}</TableCell>
                        <TableCell>
                          {doc.error ? (
                            <Badge variant="destructive">Error</Badge>
                          ) : (
                            <Badge variant="default" className="bg-green-600">Success</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(doc.id, doc.fileName);
                            }}
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Preview Area */}
              {selectedDoc && (
                <div className="space-y-2">
                  <Label>Preview: {selectedDoc.fileName}</Label>
                  {selectedDoc.error ? (
                    <div className="p-4 border rounded-lg bg-destructive/10 text-destructive">
                      <p className="font-medium">Error extracting text:</p>
                      <p className="text-sm mt-1">{selectedDoc.error}</p>
                    </div>
                  ) : (
                    <ScrollArea className="h-[300px] border rounded-lg p-4 bg-muted/30">
                      <pre className="text-xs whitespace-pre-wrap font-mono">
                        {selectedDoc.extractedText.slice(0, 3000)}
                        {selectedDoc.extractedText.length > 3000 && '\n\n... (truncated)'}
                      </pre>
                    </ScrollArea>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
