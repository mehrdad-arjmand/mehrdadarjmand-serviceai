import { Upload, FileText, Trash2, CalendarIcon, Loader2, CheckCircle, AlertCircle, Clock, Check, ChevronsUpDown } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { TabPermissions } from "@/hooks/usePermissions";

interface Document {
  id: string;
  fileName: string;
  fileType: string;
  docType: string;
  uploadDate: string | null;
  site: string | null;
  equipmentType: string;
  equipmentMake: string | null;
  equipmentModel: string | null;
  extractedText: string;
  textLength: number;
  error: string | null;
  createdAt: string;
  pageCount: number | null;
  totalChunks: number;
  embeddedChunks: number;
  ingestionStatus: string;
  ingestionError: string | null;
  allowedRoles: string[];
}

interface Role {
  role: string;
  displayName: string | null;
}

interface RepositoryCardProps {
  onDocumentSelect?: (id: string | null) => void;
  permissions: TabPermissions;
}

export const RepositoryCard = ({ onDocumentSelect, permissions }: RepositoryCardProps) => {
  const canWrite = permissions.write;
  const canDelete = permissions.delete;
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  
  // Available roles for access control
  const [availableRoles, setAvailableRoles] = useState<Role[]>([]);
  
  // Form state
  const [docType, setDocType] = useState<string>("");
  const [site, setSite] = useState<string>("");
  const [equipmentType, setEquipmentType] = useState<string>("");
  const [equipmentMake, setEquipmentMake] = useState<string>("");
  const [equipmentModel, setEquipmentModel] = useState<string>("");
  const [selectedRoles, setSelectedRoles] = useState<string[]>(["all"]); // Default to all roles

  // Dropdown options state - loaded from database
  const [docTypeOptions, setDocTypeOptions] = useState<string[]>([]);
  const [siteOptions, setSiteOptions] = useState<string[]>([]);
  const [equipmentTypeOptions, setEquipmentTypeOptions] = useState<string[]>([]);
  const [equipmentMakeOptions, setEquipmentMakeOptions] = useState<string[]>([]);
  const [equipmentModelOptions, setEquipmentModelOptions] = useState<string[]>([]);

  // Load dropdown options from database
  useEffect(() => {
    const fetchDropdownOptions = async () => {
      try {
        const { data, error } = await supabase
          .from('dropdown_options')
          .select('category, value')
          .order('value');
        
        if (error) throw error;
        
        if (data) {
          const docTypes = data.filter(d => d.category === 'docType').map(d => d.value);
          const sites = data.filter(d => d.category === 'site').map(d => d.value);
          const equipTypes = data.filter(d => d.category === 'equipmentType').map(d => d.value);
          const equipMakes = data.filter(d => d.category === 'equipmentMake').map(d => d.value);
          const equipModels = data.filter(d => d.category === 'equipmentModel').map(d => d.value);
          
          setDocTypeOptions(docTypes);
          setSiteOptions(sites);
          setEquipmentTypeOptions(equipTypes);
          setEquipmentMakeOptions(equipMakes);
          setEquipmentModelOptions(equipModels);
        }
      } catch (error) {
        console.error('Error fetching dropdown options:', error);
      }
    };
    
    fetchDropdownOptions();
  }, []);

  // Inline add state
  const [showDocTypeInput, setShowDocTypeInput] = useState(false);
  const [showSiteInput, setShowSiteInput] = useState(false);
  const [showEquipmentTypeInput, setShowEquipmentTypeInput] = useState(false);
  const [showEquipmentMakeInput, setShowEquipmentMakeInput] = useState(false);
  const [showEquipmentModelInput, setShowEquipmentModelInput] = useState(false);

  const [newDocType, setNewDocType] = useState("");
  const [newSite, setNewSite] = useState("");
  const [newEquipmentType, setNewEquipmentType] = useState("");
  const [newEquipmentMake, setNewEquipmentMake] = useState("");
  const [newEquipmentModel, setNewEquipmentModel] = useState("");

  // Role picker popover state
  const [rolePickerOpen, setRolePickerOpen] = useState(false);

  // Fetch available roles
  useEffect(() => {
    const fetchRoles = async () => {
      try {
        const { data, error } = await supabase
          .from('role_permissions')
          .select('role, display_name')
          .order('role');
        
        if (error) throw error;
        
        if (data) {
          setAvailableRoles(data.map(r => ({
            role: r.role,
            displayName: r.display_name
          })));
        }
      } catch (error) {
        console.error('Error fetching roles:', error);
      }
    };
    
    fetchRoles();
  }, []);

  const fetchDocuments = async () => {
    try {
      const { data: docs, error } = await supabase
        .from('documents')
        .select('*')
        .order('uploaded_at', { ascending: false });

      if (error) throw error;

      if (docs) {
        // Fetch chunks for each document to reconstruct full text and count embeddings
        const documentsWithText = await Promise.all(
          docs.map(async (doc) => {
            const { data: chunks, error: chunksError } = await supabase
              .from('chunks')
              .select('text, chunk_index, equipment, embedding')
              .eq('document_id', doc.id)
              .order('chunk_index');

            if (chunksError) {
              console.error('Error fetching chunks:', chunksError);
              return null;
            }

            const extractedText = chunks?.map(c => c.text).join('') || '';
            const equipment = chunks?.[0]?.equipment || 'unknown';
            // Count chunks that have embeddings
            const embeddedChunks = chunks?.filter(c => c.embedding !== null).length || 0;

            return {
              id: doc.id,
              fileName: doc.filename,
              fileType: doc.filename.split('.').pop() || 'unknown',
              docType: doc.doc_type || 'unknown',
              uploadDate: doc.upload_date || null,
              site: doc.site || null,
              equipmentType: equipment,
              equipmentMake: doc.equipment_make || null,
              equipmentModel: doc.equipment_model || null,
              extractedText,
              textLength: extractedText.length,
              error: null,
              createdAt: doc.uploaded_at || new Date().toISOString(),
              pageCount: doc.page_count || null,
              totalChunks: doc.total_chunks || chunks?.length || 0,
              embeddedChunks,
              ingestionStatus: doc.ingestion_status || 'pending',
              ingestionError: doc.ingestion_error || null,
              allowedRoles: (doc as any).allowed_roles || ['admin'],
            };
          })
        );

        setDocuments(documentsWithText.filter(d => d !== null) as Document[]);
      }
    } catch (error) {
      console.error('Error fetching documents:', error);
    }
  };

  // Fetch documents and subscribe to realtime updates + polling for chunks
  useEffect(() => {
    fetchDocuments();

    // Subscribe to documents changes
    const docsChannel = supabase
      .channel('repository-docs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, fetchDocuments)
      .subscribe();

    // Subscribe to chunks changes for real-time embedding progress
    const chunksChannel = supabase
      .channel('repository-chunks')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chunks' }, fetchDocuments)
      .subscribe();

    // Also poll every 3 seconds for in-progress documents (in case subscription misses updates)
    const pollInterval = setInterval(() => {
      // Check if any documents are still in progress
      const hasInProgress = documents.some(
        doc => doc.ingestionStatus === 'in_progress' || doc.ingestionStatus === 'processing_embeddings'
      );
      if (hasInProgress) {
        fetchDocuments();
      }
    }, 3000);

    return () => {
      supabase.removeChannel(docsChannel);
      supabase.removeChannel(chunksChannel);
      clearInterval(pollInterval);
    };
  }, [documents]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setSelectedFiles(files);
    }
  };

  const handleAddOption = async (
    type: 'docType' | 'site' | 'equipmentType' | 'equipmentMake' | 'equipmentModel',
    value: string,
    saveToDatabase: boolean = true
  ) => {
    if (!value.trim()) return;

    // Save to database if requested (when clicking Add button)
    if (saveToDatabase) {
      try {
        const { error } = await supabase
          .from('dropdown_options')
          .insert({ category: type, value: value.trim() });
        
        if (error && !error.message.includes('duplicate')) {
          console.error('Error saving dropdown option:', error);
          toast({
            title: "Error saving option",
            description: error.message,
            variant: "destructive",
          });
          return;
        }
      } catch (err) {
        console.error('Error saving dropdown option:', err);
      }
    }

    switch (type) {
      case 'docType':
        if (!docTypeOptions.includes(value)) {
          setDocTypeOptions([...docTypeOptions, value]);
        }
        setDocType(value);
        setShowDocTypeInput(false);
        setNewDocType("");
        break;
      case 'site':
        if (!siteOptions.includes(value)) {
          setSiteOptions([...siteOptions, value]);
        }
        setSite(value);
        setShowSiteInput(false);
        setNewSite("");
        break;
      case 'equipmentType':
        if (!equipmentTypeOptions.includes(value)) {
          setEquipmentTypeOptions([...equipmentTypeOptions, value]);
        }
        setEquipmentType(value);
        setShowEquipmentTypeInput(false);
        setNewEquipmentType("");
        break;
      case 'equipmentMake':
        if (!equipmentMakeOptions.includes(value)) {
          setEquipmentMakeOptions([...equipmentMakeOptions, value]);
        }
        setEquipmentMake(value);
        setShowEquipmentMakeInput(false);
        setNewEquipmentMake("");
        break;
      case 'equipmentModel':
        if (!equipmentModelOptions.includes(value)) {
          setEquipmentModelOptions([...equipmentModelOptions, value]);
        }
        setEquipmentModel(value);
        setShowEquipmentModelInput(false);
        setNewEquipmentModel("");
        break;
    }
  };

  const handleRoleToggle = (role: string) => {
    if (role === "all") {
      // If "all" is selected, toggle between all and none
      if (selectedRoles.includes("all")) {
        setSelectedRoles([]);
      } else {
        setSelectedRoles(["all"]);
      }
    } else {
      // Remove "all" if selecting specific roles
      let newRoles = selectedRoles.filter(r => r !== "all");
      
      if (newRoles.includes(role)) {
        newRoles = newRoles.filter(r => r !== role);
      } else {
        newRoles = [...newRoles, role];
      }
      
      // If all individual roles are selected, switch to "all"
      if (newRoles.length === availableRoles.length) {
        setSelectedRoles(["all"]);
      } else {
        setSelectedRoles(newRoles);
      }
    }
  };

  const getSelectedRolesLabel = () => {
    if (selectedRoles.includes("all")) {
      return "All roles";
    }
    if (selectedRoles.length === 0) {
      return "Select roles";
    }
    if (selectedRoles.length === 1) {
      const role = availableRoles.find(r => r.role === selectedRoles[0]);
      return role?.displayName || role?.role || selectedRoles[0];
    }
    return `${selectedRoles.length} roles selected`;
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

    // Resolve final values: use typed input if the Add Item input is showing, otherwise use selected value
    const finalSite = showSiteInput ? newSite.trim() : site;
    const finalEquipmentMake = showEquipmentMakeInput ? newEquipmentMake.trim() : equipmentMake;
    const finalEquipmentModel = showEquipmentModelInput ? newEquipmentModel.trim() : equipmentModel;
    const finalDocType = showDocTypeInput ? newDocType.trim() : docType;
    const finalEquipmentType = showEquipmentTypeInput ? newEquipmentType.trim() : equipmentType;

    // Only access_role is required; all other metadata fields are optional
    if (selectedRoles.length === 0) {
      toast({
        title: "Missing access roles",
        description: "Please select at least one role that can access this document",
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);

    try {
      const formData = new FormData();
      selectedFiles.forEach(file => formData.append('files', file));
      if (finalDocType) formData.append('docType', finalDocType);
      formData.append('uploadDate', new Date().toISOString().split('T')[0]); // Auto-set to today
      if (finalSite) formData.append('site', finalSite);
      if (finalEquipmentType) formData.append('equipmentType', finalEquipmentType);
      if (finalEquipmentMake) formData.append('equipmentMake', finalEquipmentMake);
      if (finalEquipmentModel) formData.append('equipmentModel', finalEquipmentModel);
      formData.append('allowedRoles', JSON.stringify(selectedRoles));

      const { data, error } = await supabase.functions.invoke('ingest', {
        body: formData,
      });

      if (error) throw error;

      if (data.success) {
        toast({
          title: "Upload successful",
          description: `Processed ${data.documents.length} file(s). Embeddings are generating server-side.`,
        });

        // Reset form
        setSelectedFiles([]);
        const fileInput = document.getElementById('file-upload') as HTMLInputElement;
        if (fileInput) fileInput.value = '';

        // Embedding generation now happens server-side automatically
        // No frontend loop needed — realtime subscription will update progress

        // Refresh documents list
        await fetchDocuments();
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

  // Background embedding generation - now uses server-side full mode
  const runEmbeddingGeneration = async (docId: string, fileName: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('generate-embeddings', {
        body: { documentId: docId, mode: 'full' },
      });

      if (error) throw error;

      toast({
        title: "Indexing complete",
        description: `"${fileName}" is now fully indexed.`,
      });
    } catch (error: any) {
      console.error('Embedding generation error:', error);
      toast({
        title: "Indexing failed",
        description: `${fileName}: ${error.message || "Unknown error"}`,
        variant: "destructive",
      });
    }
  };

  // Retry embedding generation for failed documents
  const handleRetryEmbeddings = async (docId: string, fileName: string) => {
    toast({
      title: "Retrying indexing",
      description: `Resuming embedding generation for "${fileName}"...`,
    });
    
    // Reset status to processing
    await supabase
      .from('documents')
      .update({ ingestion_status: 'processing_embeddings', ingestion_error: null })
      .eq('id', docId);
    
    runEmbeddingGeneration(docId, fileName);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const { id: docId, fileName } = deleteTarget;
    setDeleteTarget(null);

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

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; fileName: string } | null>(null);

  const selectedDoc = documents.find(doc => doc.id === selectedDocId);

  const formatRolesDisplay = (roles: string[]) => {
    if (roles.includes("all")) return "All";
    if (roles.length === 0) return "None";
    if (roles.length <= 2) {
      return roles.map(r => {
        const roleInfo = availableRoles.find(ar => ar.role === r);
        return roleInfo?.displayName || r;
      }).join(", ");
    }
    return `${roles.length} roles`;
  };

  return (
    <Card className="w-full border-border/50 shadow-premium bg-card">
      <CardHeader className="pb-4">
        <CardTitle className="text-xl tracking-tight">
          {canWrite ? "Upload documents" : "Document Repository"}
        </CardTitle>
        <CardDescription className="text-muted-foreground font-normal">
          {canWrite 
            ? "Add PDFs, Word files, or text documents to build your knowledge base."
            : "View documents in the knowledge base."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        {/* Upload Area - Only show if user has write permission */}
        {canWrite && (
          <>
            <div className="relative border-2 border-dashed border-border/60 rounded-2xl p-16 text-center hover:border-muted-foreground/40 hover:bg-muted/30 transition-all duration-300 cursor-pointer group">
              <input
                type="file"
                id="file-upload"
                multiple
                accept=".pdf,.docx,.txt"
                className="hidden"
                onChange={handleFileChange}
              />
              <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center group-hover:bg-accent transition-colors duration-300">
                  <Upload className="h-6 w-6 text-muted-foreground" />
                </div>
                <div className="space-y-1.5">
                  <p className="text-base font-medium text-foreground">
                    {selectedFiles.length > 0 
                      ? `${selectedFiles.length} file(s) selected` 
                      : "Click to upload or drag and drop"}
                  </p>
                  <p className="text-sm text-muted-foreground font-normal">
                    PDF, DOCX, or TXT files (multiple allowed)
                  </p>
                </div>
              </label>
            </div>

            <Separator className="bg-border/50" />

        {/* Metadata Form */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Document Type */}
          <div className="space-y-2">
            <Label htmlFor="doc-type">Document type</Label>
            {showDocTypeInput ? (
              <div className="flex gap-2">
                <Input
                  value={newDocType}
                  onChange={(e) => setNewDocType(e.target.value)}
                  placeholder="Enter new document type"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleAddOption('docType', newDocType);
                    }
                  }}
                />
                <Button
                  size="sm"
                  onClick={() => handleAddOption('docType', newDocType)}
                >
                  Add
                </Button>
              </div>
            ) : (
              <Select 
                value={docType} 
                onValueChange={(value) => {
                  if (value === "__add_new__") {
                    setShowDocTypeInput(true);
                  } else {
                    setDocType(value);
                  }
                }}
              >
                <SelectTrigger id="doc-type">
                  <SelectValue placeholder="Select document type" />
                </SelectTrigger>
                <SelectContent>
                  {docTypeOptions.map((option) => (
                    <SelectItem key={option} value={option}>{option}</SelectItem>
                  ))}
                  <SelectItem value="__add_new__">+ Add item</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Access Role Multi-Select */}
          <div className="space-y-2">
            <Label>Access role</Label>
            <Popover open={rolePickerOpen} onOpenChange={setRolePickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={rolePickerOpen}
                  className="h-10 w-full justify-between font-normal"
                >
                  {getSelectedRolesLabel()}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[280px] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search roles..." />
                  <CommandList>
                    <CommandEmpty>No roles found.</CommandEmpty>
                    <CommandGroup>
                      {/* All option */}
                      <CommandItem
                        value="all"
                        onSelect={() => handleRoleToggle("all")}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            selectedRoles.includes("all") ? "opacity-100" : "opacity-0"
                          )}
                        />
                        All roles
                      </CommandItem>
                      <Separator className="my-1" />
                      {/* Individual roles */}
                      {availableRoles.map((role) => (
                        <CommandItem
                          key={role.role}
                          value={role.role}
                          onSelect={() => handleRoleToggle(role.role)}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              (selectedRoles.includes(role.role) || selectedRoles.includes("all"))
                                ? "opacity-100" 
                                : "opacity-0"
                            )}
                          />
                          {role.displayName || role.role}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {/* Site */}
          <div className="space-y-2">
            <Label htmlFor="site">Site</Label>
            {showSiteInput ? (
              <div className="flex gap-2">
                <Input
                  value={newSite}
                  onChange={(e) => setNewSite(e.target.value)}
                  placeholder="Enter site name"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleAddOption('site', newSite);
                    }
                  }}
                />
                <Button
                  size="sm"
                  onClick={() => handleAddOption('site', newSite)}
                >
                  Add
                </Button>
              </div>
            ) : (
              <Select 
                value={site} 
                onValueChange={(value) => {
                  if (value === "__add_new__") {
                    setShowSiteInput(true);
                  } else {
                    setSite(value);
                  }
                }}
              >
                <SelectTrigger id="site">
                  <SelectValue placeholder="Select site" />
                </SelectTrigger>
                <SelectContent>
                  {siteOptions.map((option) => (
                    <SelectItem key={option} value={option}>{option}</SelectItem>
                  ))}
                  <SelectItem value="__add_new__">+ Add item</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Equipment Type */}
          <div className="space-y-2">
            <Label htmlFor="equipment-type">Equipment type</Label>
            {showEquipmentTypeInput ? (
              <div className="flex gap-2">
                <Input
                  value={newEquipmentType}
                  onChange={(e) => setNewEquipmentType(e.target.value)}
                  placeholder="Enter equipment type"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleAddOption('equipmentType', newEquipmentType);
                    }
                  }}
                />
                <Button
                  size="sm"
                  onClick={() => handleAddOption('equipmentType', newEquipmentType)}
                >
                  Add
                </Button>
              </div>
            ) : (
              <Select 
                value={equipmentType} 
                onValueChange={(value) => {
                  if (value === "__add_new__") {
                    setShowEquipmentTypeInput(true);
                  } else {
                    setEquipmentType(value);
                  }
                }}
              >
                <SelectTrigger id="equipment-type">
                  <SelectValue placeholder="Select equipment type" />
                </SelectTrigger>
                <SelectContent>
                  {equipmentTypeOptions.map((option) => (
                    <SelectItem key={option} value={option}>{option}</SelectItem>
                  ))}
                  <SelectItem value="__add_new__">+ Add item</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Equipment Make */}
          <div className="space-y-2">
            <Label htmlFor="equipment-make">Equipment make</Label>
            {showEquipmentMakeInput ? (
              <div className="flex gap-2">
                <Input
                  value={newEquipmentMake}
                  onChange={(e) => setNewEquipmentMake(e.target.value)}
                  placeholder="Enter equipment make"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleAddOption('equipmentMake', newEquipmentMake);
                    }
                  }}
                />
                <Button
                  size="sm"
                  onClick={() => handleAddOption('equipmentMake', newEquipmentMake)}
                >
                  Add
                </Button>
              </div>
            ) : (
              <Select 
                value={equipmentMake} 
                onValueChange={(value) => {
                  if (value === "__add_new__") {
                    setShowEquipmentMakeInput(true);
                  } else {
                    setEquipmentMake(value);
                  }
                }}
              >
                <SelectTrigger id="equipment-make">
                  <SelectValue placeholder="Select equipment make" />
                </SelectTrigger>
                <SelectContent>
                  {equipmentMakeOptions.map((option) => (
                    <SelectItem key={option} value={option}>{option}</SelectItem>
                  ))}
                  <SelectItem value="__add_new__">+ Add item</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Equipment Model */}
          <div className="space-y-2">
            <Label htmlFor="equipment-model">Equipment model</Label>
            {showEquipmentModelInput ? (
              <div className="flex gap-2">
                <Input
                  value={newEquipmentModel}
                  onChange={(e) => setNewEquipmentModel(e.target.value)}
                  placeholder="Enter equipment model"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleAddOption('equipmentModel', newEquipmentModel);
                    }
                  }}
                />
                <Button
                  size="sm"
                  onClick={() => handleAddOption('equipmentModel', newEquipmentModel)}
                >
                  Add
                </Button>
              </div>
            ) : (
              <Select 
                value={equipmentModel} 
                onValueChange={(value) => {
                  if (value === "__add_new__") {
                    setShowEquipmentModelInput(true);
                  } else {
                    setEquipmentModel(value);
                  }
                }}
              >
                <SelectTrigger id="equipment-model">
                  <SelectValue placeholder="Select equipment model" />
                </SelectTrigger>
                <SelectContent>
                  {equipmentModelOptions.map((option) => (
                    <SelectItem key={option} value={option}>{option}</SelectItem>
                  ))}
                  <SelectItem value="__add_new__">+ Add item</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        {/* Upload Button */}
        <div className="flex justify-end">
          <Button size="lg" onClick={handleUpload} disabled={selectedFiles.length === 0 || isUploading || selectedRoles.length === 0}>

            {isUploading ? "Uploading..." : "Upload"}
          </Button>
        </div>
          </>
        )}

        {/* Documents Table */}
        {documents.length > 0 && (
          <>
            <Separator />
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Documents</h3>
              <div className="border rounded-lg overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Document type</TableHead>
                      <TableHead>Upload date</TableHead>
                      <TableHead>Access roles</TableHead>
                      <TableHead>Site</TableHead>
                      <TableHead>Equipment type</TableHead>
                      <TableHead>Equipment make</TableHead>
                      <TableHead>Equipment model</TableHead>
                      <TableHead>Ingestion</TableHead>
                      {canDelete && <TableHead className="w-[50px]"></TableHead>}
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
                        <TableCell className="capitalize">{doc.docType}</TableCell>
                        <TableCell>{doc.uploadDate || '—'}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">
                            {formatRolesDisplay(doc.allowedRoles)}
                          </Badge>
                        </TableCell>
                        <TableCell>{doc.site || '—'}</TableCell>
                        <TableCell className="capitalize">{doc.equipmentType}</TableCell>
                        <TableCell>{doc.equipmentMake || '—'}</TableCell>
                        <TableCell>{doc.equipmentModel || '—'}</TableCell>
                        <TableCell>
                          {doc.ingestionStatus === 'complete' && (
                            <div className="flex items-center gap-1 text-green-600">
                              <CheckCircle className="h-4 w-4" />
                              <span className="text-xs">Complete ({doc.embeddedChunks}/{doc.totalChunks} chunks)</span>
                            </div>
                          )}
                          {doc.ingestionStatus === 'failed' && (
                            <div className="flex items-center gap-2">
                              <div className="flex items-center gap-1 text-destructive" title={doc.ingestionError || 'Unknown error'}>
                                <AlertCircle className="h-4 w-4" />
                                <span className="text-xs">Failed ({doc.embeddedChunks}/{doc.totalChunks})</span>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-6 text-xs"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRetryEmbeddings(doc.id, doc.fileName);
                                }}
                              >
                                Retry
                              </Button>
                            </div>
                          )}
                          {(doc.ingestionStatus === 'in_progress' || doc.ingestionStatus === 'processing_embeddings') && (
                            <div className="flex items-center gap-1 text-amber-600">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              <span className="text-xs">Indexing... ({doc.embeddedChunks}/{doc.totalChunks} chunks)</span>
                            </div>
                          )}
                          {doc.ingestionStatus === 'pending' && (
                            <div className="flex items-center gap-1 text-muted-foreground">
                              <Clock className="h-4 w-4" />
                              <span className="text-xs">Pending</span>
                            </div>
                          )}
                        </TableCell>
                        {canDelete && (
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteTarget({ id: doc.id, fileName: doc.fileName });
                              }}
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              title="Delete document"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Full Text Preview */}
              {selectedDoc && (
                <div className="space-y-2">
                  <Label>Document text: {selectedDoc.fileName}</Label>
                  {selectedDoc.error ? (
                    <div className="p-4 border rounded-lg bg-destructive/10 text-destructive">
                      <p className="font-medium">Error extracting text:</p>
                      <p className="text-sm mt-1">{selectedDoc.error}</p>
                    </div>
                  ) : (
                    <ScrollArea className="h-[400px] border rounded-lg p-4 bg-muted/30">
                      <pre className="text-xs whitespace-pre-wrap font-mono">
                        {selectedDoc.extractedText}
                      </pre>
                    </ScrollArea>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.fileName}</strong>? This will remove it from the knowledge base. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};
