import {
  Trash2, Loader2, CheckCircle, AlertCircle, Clock, Check,
  SlidersHorizontal, ChevronRight, ChevronDown, X, Search, Plus,
  Upload, ClipboardPaste, Mic, Square, FolderOpen
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DocumentViewerModal } from "@/components/DocumentViewerModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { TabPermissions } from "@/hooks/usePermissions";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ScrollArea } from "@/components/ui/scroll-area";

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
  metadata: Record<string, string>;
}

interface Role {
  role: string;
  displayName: string | null;
}

interface Project {
  id: string;
  name: string;
}

interface RepositoryCardProps {
  onDocumentSelect?: (id: string | null) => void;
  permissions: TabPermissions;
  projectId?: string;
  projects?: Project[];
  currentProject?: Project | null;
  onProjectSwitch?: (project: Project) => void;
  tabSwitcher?: React.ReactNode;
}

// ─── Inline Select with Add New ─────────────────────────────────────────────
interface InlineSelectProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  allowAdd?: boolean;
  onAddNew?: (v: string) => void;
}

const InlineSelect = ({ label, value, onChange, options, placeholder = "All", allowAdd = false, onAddNew }: InlineSelectProps) => {
  const [open, setOpen] = useState(false);
  const [addMode, setAddMode] = useState(false);
  const [newValue, setNewValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (addMode) inputRef.current?.focus();
  }, [addMode]);

  const handleConfirmAdd = () => {
    if (newValue.trim() && onAddNew) {
      onAddNew(newValue.trim());
      onChange(newValue.trim());
    }
    setAddMode(false);
    setNewValue("");
    setOpen(false);
  };

  const handleCancelAdd = () => {
    setAddMode(false);
    setNewValue("");
  };

  if (addMode) {
    return (
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">{label}</p>
        <div className="flex items-center h-10 border border-border rounded-lg bg-background overflow-hidden">
          <input
            ref={inputRef}
            value={newValue}
            onChange={e => setNewValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleConfirmAdd(); if (e.key === 'Escape') handleCancelAdd(); }}
            placeholder={`Add new ${label.toLowerCase()}`}
            className="flex-1 min-w-0 text-sm bg-transparent outline-none placeholder:text-muted-foreground/60 px-3"
          />
          <div className="flex items-center gap-0 border-l border-border flex-shrink-0">
            <button onClick={handleConfirmAdd} className="text-primary hover:text-primary/80 px-2.5 h-10 flex items-center">
              <Check className="h-3.5 w-3.5" />
            </button>
            <button onClick={handleCancelAdd} className="text-muted-foreground hover:text-foreground px-2.5 h-10 flex items-center border-l border-border">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">{label}</p>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className="w-full flex items-center justify-between h-10 border border-border rounded-lg px-3 text-sm bg-background hover:bg-muted/40 transition-colors text-left">
            <span className={value ? "text-foreground" : "text-muted-foreground"}>{value || placeholder}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-0 z-50 bg-background border border-border shadow-lg" align="start">
          <Command>
            <CommandList>
              <CommandGroup>
                <CommandItem onSelect={() => { onChange(""); setOpen(false); }} className="text-sm">
                  <Check className={cn("mr-2 h-3.5 w-3.5", !value ? "opacity-100" : "opacity-0")} />
                  All
                </CommandItem>
                {options.map(opt => (
                  <CommandItem key={opt} onSelect={() => { onChange(opt); setOpen(false); }} className="text-sm">
                    <Check className={cn("mr-2 h-3.5 w-3.5", value === opt ? "opacity-100" : "opacity-0")} />
                    {opt}
                  </CommandItem>
                ))}
                {allowAdd && (
                  <>
                    <Separator className="my-1" />
                    <CommandItem onSelect={() => { setOpen(false); setAddMode(true); }} className="text-sm text-primary">
                      <Plus className="mr-2 h-3.5 w-3.5" />
                      Add new...
                    </CommandItem>
                  </>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
};

// ─── Role Multi-Select ────────────────────────────────────────────────────────
interface RoleSelectProps {
  label: string;
  selectedRoles: string[];
  availableRoles: Role[];
  onChange: (roles: string[]) => void;
}

const RoleSelect = ({ label, selectedRoles, availableRoles, onChange }: RoleSelectProps) => {
  const [open, setOpen] = useState(false);

  const toggle = (role: string) => {
    if (role === "all") {
      onChange(selectedRoles.includes("all") ? [] : ["all"]);
    } else {
      let next = selectedRoles.filter(r => r !== "all");
      if (next.includes(role)) next = next.filter(r => r !== role);
      else next = [...next, role];
      if (next.length === availableRoles.length) onChange(["all"]);
      else onChange(next);
    }
  };

  const label_display = selectedRoles.includes("all") ? "All" : selectedRoles.length === 0 ? "All" : selectedRoles.length === 1 ? (availableRoles.find(r => r.role === selectedRoles[0])?.displayName || selectedRoles[0]) : `${selectedRoles.length} roles`;

  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">{label}</p>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className="w-full flex items-center justify-between h-10 border border-border rounded-lg px-3 text-sm bg-background hover:bg-muted/40 transition-colors text-left">
            <span className="text-foreground">{label_display}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-0 z-50 bg-background border border-border shadow-lg" align="start">
          <Command>
            <CommandList>
              <CommandGroup>
                <CommandItem onSelect={() => toggle("all")} className="text-sm">
                  <Check className={cn("mr-2 h-3.5 w-3.5", selectedRoles.includes("all") || selectedRoles.length === 0 ? "opacity-100" : "opacity-0")} />
                  All Roles
                </CommandItem>
                <Separator className="my-1" />
                {availableRoles.map(role => (
                  <CommandItem key={role.role} onSelect={() => toggle(role.role)} className="text-sm">
                    <Check className={cn("mr-2 h-3.5 w-3.5", selectedRoles.includes(role.role) || selectedRoles.includes("all") ? "opacity-100" : "opacity-0")} />
                    {role.displayName || role.role}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
};

// ─── Document Multi-Select ────────────────────────────────────────────────────
interface DocItem { id: string; name: string; }
interface DocumentMultiSelectProps {
  label: string;
  selectedIds: string[];
  documents: DocItem[];
  onChange: (ids: string[]) => void;
}

const DocumentMultiSelect = ({ label, selectedIds, documents, onChange }: DocumentMultiSelectProps) => {
  const [open, setOpen] = useState(false);
  const allSelected = selectedIds.length === 0 || (documents.length > 0 && selectedIds.length === documents.length);

  const toggle = (id: string) => {
    if (id === "__all__") {
      onChange([]);
    } else {
      let next: string[];
      if (selectedIds.includes(id)) {
        next = selectedIds.filter(i => i !== id);
      } else {
        next = [...selectedIds, id];
      }
      if (next.length === documents.length) next = [];
      onChange(next);
    }
  };

  const displayLabel = selectedIds.length === 0 ? "All" : selectedIds.length === 1 ? (documents.find(d => d.id === selectedIds[0])?.name || "1 document") : `${selectedIds.length} documents`;

  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">{label}</p>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className="w-full flex items-center justify-between h-10 border border-border rounded-lg px-3 text-sm bg-background hover:bg-muted/40 transition-colors text-left">
            <span className="text-foreground truncate">{displayLabel}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0 z-50 bg-background border border-border shadow-lg" align="start">
          <Command>
            <CommandInput placeholder="Search documents..." />
            <CommandList>
              <CommandEmpty>No documents found.</CommandEmpty>
              <CommandGroup>
                <CommandItem onSelect={() => toggle("__all__")} className="text-sm">
                  <Check className={cn("mr-2 h-3.5 w-3.5", allSelected ? "opacity-100" : "opacity-0")} />
                  All Documents
                </CommandItem>
                <Separator className="my-1" />
                {documents.map(doc => (
                  <CommandItem key={doc.id} onSelect={() => toggle(doc.id)} className="text-sm">
                    <Check className={cn("mr-2 h-3.5 w-3.5", selectedIds.includes(doc.id) || allSelected ? "opacity-100" : "opacity-0")} />
                    <span className="truncate">{doc.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────
export const RepositoryCard = ({ onDocumentSelect, permissions, projectId, projects, currentProject, onProjectSwitch, tabSwitcher }: RepositoryCardProps) => {
  const canWrite = permissions.write;
  const canDelete = permissions.delete;

  // Project metadata fields
  const [projectFields, setProjectFields] = useState<string[]>([]);

  // Upload state
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [metadataOpen, setMetadataOpen] = useState(false);

  // Dynamic upload metadata (keyed by field name)
  const [uploadMetadata, setUploadMetadata] = useState<Record<string, string>>({});
  const [selectedRoles, setSelectedRoles] = useState<string[]>(["all"]);

  // Dropdown options (keyed by field name)
  const [fieldOptions, setFieldOptions] = useState<Record<string, string[]>>({});
  const [availableRoles, setAvailableRoles] = useState<Role[]>([]);

  // Documents
  const [documents, setDocuments] = useState<Document[]>([]);
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(10);

  // Search & filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [filterRole, setFilterRole] = useState("");
  const [filterDocumentIds, setFilterDocumentIds] = useState<string[]>([]);

  // Modals
  const [viewDoc, setViewDoc] = useState<Document | null>(null);
  const [editTarget, setEditTarget] = useState<Document | null>(null);
  const [editMetadata, setEditMetadata] = useState<Record<string, string>>({});
  const [editSelectedRoles, setEditSelectedRoles] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; fileName: string } | null>(null);

  // Copied text modal state
  const [copiedTextOpen, setCopiedTextOpen] = useState(false);
  const [copiedTextName, setCopiedTextName] = useState("");
  const [copiedTextContent, setCopiedTextContent] = useState("");
  const [isInsertingText, setIsInsertingText] = useState(false);

  // Dictate modal state
  const [dictateOpen, setDictateOpen] = useState(false);
  const [dictateName, setDictateName] = useState("");
  const [dictateContent, setDictateContent] = useState("");
  const [isDictating, setIsDictating] = useState(false);
  const [isInsertingDictation, setIsInsertingDictation] = useState(false);
  const dictateRecognitionRef = useRef<any>(null);

  // Edit content modal state (for txt/docx)
  const [editContentDoc, setEditContentDoc] = useState<Document | null>(null);
  const [editContentName, setEditContentName] = useState("");
  const [editContentText, setEditContentText] = useState("");
  const [isEditContentDictating, setIsEditContentDictating] = useState(false);
  const [isEditContentSaving, setIsEditContentSaving] = useState(false);
  const [isEditContentLoading, setIsEditContentLoading] = useState(false);
  const editContentRecognitionRef = useRef<any>(null);
  const editContentTextareaRef = useRef<HTMLTextAreaElement>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Fetch project metadata fields ──
  useEffect(() => {
    const fetchProjectFields = async () => {
      if (!projectId) {
        setProjectFields([]);
        return;
      }
      const { data } = await supabase
        .from('project_metadata_fields')
        .select('field_name')
        .eq('project_id', projectId)
        .order('created_at');
      setProjectFields(data?.map(f => f.field_name) || []);
    };
    fetchProjectFields();
  }, [projectId]);

  // ── Fetch dropdown options for each field ──
  const fetchDropdownOptions = async () => {
    const { data } = await supabase.from('dropdown_options').select('category, value').order('value');
    if (data) {
      const grouped: Record<string, string[]> = {};
      data.forEach(d => {
        if (!grouped[d.category]) grouped[d.category] = [];
        grouped[d.category].push(d.value);
      });
      setFieldOptions(grouped);
    }
  };

  useEffect(() => { fetchDropdownOptions(); }, []);

  useEffect(() => {
    const fetchRoles = async () => {
      const { data } = await supabase.from('role_permissions').select('role, display_name').order('role');
      if (data) setAvailableRoles(data.map(r => ({ role: r.role, displayName: r.display_name })));
    };
    fetchRoles();
  }, []);

  // ── Fetch documents ──
  const fetchDocuments = async () => {
    let query = supabase.from('documents').select('*').order('uploaded_at', { ascending: false });
    if (projectId) query = query.eq('project_id', projectId);
    const { data: docs, error } = await query;
    if (error || !docs) return;

    const documentsWithText = await Promise.all(docs.map(async (doc) => {
      const { data: chunks } = await supabase.from('chunks').select('text, chunk_index, equipment, embedding').eq('document_id', doc.id).order('chunk_index');
      const extractedText = chunks?.map(c => c.text).join('') || '';
      const equipment = chunks?.[0]?.equipment || 'unknown';
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
        metadata: (doc as any).metadata || {},
      };
    }));

    setDocuments(documentsWithText.filter(d => d !== null) as Document[]);
  };

  const documentsRef = useRef(documents);
  documentsRef.current = documents;

  // Track when documents enter processing_embeddings to detect stuck ones
  const embeddingStartTimesRef = useRef<Record<string, number>>({});
  const autoRetryInProgressRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    fetchDocuments();
    const docsChannel = supabase.channel('repository-docs').on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, fetchDocuments).subscribe();
    const chunksChannel = supabase.channel('repository-chunks').on('postgres_changes', { event: '*', schema: 'public', table: 'chunks' }, fetchDocuments).subscribe();
    const poll = setInterval(async () => {
      const docs = documentsRef.current;
      const stuckDocs = docs.filter(d => d.ingestionStatus === 'processing_embeddings');
      
      if (stuckDocs.length > 0 || docs.some(d => d.ingestionStatus === 'in_progress')) {
        fetchDocuments();
      }

      // Auto-retry: if a document has been at 'processing_embeddings' with 0 embedded chunks for 60s+
      for (const doc of stuckDocs) {
        if (!embeddingStartTimesRef.current[doc.id]) {
          embeddingStartTimesRef.current[doc.id] = Date.now();
        }
        const elapsed = Date.now() - embeddingStartTimesRef.current[doc.id];
        if (elapsed > 60000 && doc.embeddedChunks === 0 && !autoRetryInProgressRef.current.has(doc.id)) {
          console.log(`Auto-retrying embeddings for stuck document ${doc.id} (${doc.fileName})`);
          autoRetryInProgressRef.current.add(doc.id);
          try {
            await supabase.functions.invoke('generate-embeddings', {
              body: { documentId: doc.id, mode: 'full' }
            });
          } catch (err) {
            console.error(`Auto-retry failed for ${doc.id}:`, err);
          } finally {
            autoRetryInProgressRef.current.delete(doc.id);
            delete embeddingStartTimesRef.current[doc.id];
            fetchDocuments();
          }
        }
      }

      // Clean up tracking for completed documents
      for (const id of Object.keys(embeddingStartTimesRef.current)) {
        if (!stuckDocs.find(d => d.id === id)) {
          delete embeddingStartTimesRef.current[id];
        }
      }
    }, 5000);
    return () => { supabase.removeChannel(docsChannel); supabase.removeChannel(chunksChannel); clearInterval(poll); };
  }, [projectId]);

  // ── Add new dropdown option ──
  const handleAddOption = async (category: string, value: string) => {
    if (!value.trim()) return;
    await supabase.from('dropdown_options').insert({ category, value: value.trim() });
    await fetchDropdownOptions();
  };

  // ── Upload ──
  const handleUpload = async (filesToUpload: File[]) => {
    if (filesToUpload.length === 0) return;
    if (selectedRoles.length === 0) { toast({ title: "Select an access role", variant: "destructive" }); return; }
    setIsUploading(true);
    try {
      const formData = new FormData();
      filesToUpload.forEach(f => formData.append('files', f));
      formData.append('uploadDate', new Date().toISOString().split('T')[0]);
      formData.append('allowedRoles', JSON.stringify(selectedRoles));
      if (projectId) formData.append('projectId', projectId);
      
      // Send dynamic metadata as JSON
      formData.append('dynamicMetadata', JSON.stringify(uploadMetadata));

      // Also send legacy fields for backward compatibility
      if (uploadMetadata['Document Type']) formData.append('docType', uploadMetadata['Document Type']);
      if (uploadMetadata['Site']) formData.append('site', uploadMetadata['Site']);
      if (uploadMetadata['Equipment Type']) formData.append('equipmentType', uploadMetadata['Equipment Type']);
      if (uploadMetadata['Make']) formData.append('equipmentMake', uploadMetadata['Make']);
      if (uploadMetadata['Model']) formData.append('equipmentModel', uploadMetadata['Model']);

      const { data, error } = await supabase.functions.invoke('ingest', { body: formData });
      if (error) throw error;
      if (data.success) {
        toast({ title: "Upload successful", description: `${data.documents.length} file(s) queued for indexing.` });
        setSelectedFiles([]);
        setUploadMetadata({});
        setSelectedRoles(["all"]); setMetadataOpen(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
        await fetchDocuments();
      } else throw new Error(data.error || 'Upload failed');
    } catch (e: any) { toast({ title: "Upload failed", description: e.message, variant: "destructive" }); }
    finally { setIsUploading(false); }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setSelectedFiles(files);
      handleUpload(files);
    }
  };

  // ── Insert copied text ──
  const handleInsertText = async () => {
    if (!copiedTextName.trim() || !copiedTextContent.trim()) {
      toast({ title: "Name and content required", variant: "destructive" });
      return;
    }
    setIsInsertingText(true);
    try {
      const { data, error } = await supabase.functions.invoke('ingest-text', {
        body: {
          documentName: copiedTextName.trim(),
          content: copiedTextContent.trim(),
          docType: uploadMetadata['Document Type'] || undefined,
          site: uploadMetadata['Site'] || undefined,
          equipmentType: uploadMetadata['Equipment Type'] || undefined,
          equipmentMake: uploadMetadata['Make'] || undefined,
          equipmentModel: uploadMetadata['Model'] || undefined,
          allowedRoles: selectedRoles,
          projectId: projectId || undefined,
          dynamicMetadata: uploadMetadata,
        }
      });
      if (error) throw error;
      if (data.success) {
        toast({ title: "Text inserted", description: `"${data.document.fileName}" queued for indexing.` });
        setCopiedTextOpen(false);
        setCopiedTextName("");
        setCopiedTextContent("");
        await fetchDocuments();
      }
    } catch (e: any) { toast({ title: "Insert failed", description: e.message, variant: "destructive" }); }
    finally { setIsInsertingText(false); }
  };

  // ── Dictation ──
  const startDictation = useCallback(() => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      toast({ title: "Speech recognition not supported", variant: "destructive" });
      return;
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    dictateRecognitionRef.current = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    let finalTranscript = dictateContent;
    recognition.onstart = () => setIsDictating(true);
    recognition.onresult = (event: any) => {
      let interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalTranscript += transcript + ' ';
        else interimTranscript += transcript;
      }
      setDictateContent(finalTranscript + interimTranscript);
    };
    recognition.onerror = (event: any) => {
      if (event.error === 'not-allowed') toast({ title: "Microphone permission denied", variant: "destructive" });
      setIsDictating(false);
      dictateRecognitionRef.current = null;
    };
    recognition.onend = () => { setIsDictating(false); dictateRecognitionRef.current = null; };
    recognition.start();
  }, [toast, dictateContent]);

  const stopDictation = useCallback(() => {
    if (dictateRecognitionRef.current) {
      try { dictateRecognitionRef.current.stop(); } catch (e) {}
      dictateRecognitionRef.current = null;
    }
    setIsDictating(false);
  }, []);

  const handleInsertDictation = async () => {
    if (!dictateName.trim() || !dictateContent.trim()) {
      toast({ title: "Name and content required", variant: "destructive" });
      return;
    }
    stopDictation();
    setIsInsertingDictation(true);
    try {
      const { data, error } = await supabase.functions.invoke('ingest-text', {
        body: {
          documentName: dictateName.trim(),
          content: dictateContent.trim(),
          docType: uploadMetadata['Document Type'] || undefined,
          site: uploadMetadata['Site'] || undefined,
          equipmentType: uploadMetadata['Equipment Type'] || undefined,
          equipmentMake: uploadMetadata['Make'] || undefined,
          equipmentModel: uploadMetadata['Model'] || undefined,
          allowedRoles: selectedRoles,
          projectId: projectId || undefined,
          dynamicMetadata: uploadMetadata,
        }
      });
      if (error) throw error;
      if (data.success) {
        toast({ title: "Dictation inserted", description: `"${data.document.fileName}" queued for indexing.` });
        setDictateOpen(false);
        setDictateName("");
        setDictateContent("");
        await fetchDocuments();
      }
    } catch (e: any) { toast({ title: "Insert failed", description: e.message, variant: "destructive" }); }
    finally { setIsInsertingDictation(false); }
  };

  // ── Delete ──
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const { id, fileName } = deleteTarget;
    setDeleteTarget(null);
    try {
      await supabase.from('chunks').delete().eq('document_id', id);
      await supabase.from('documents').delete().eq('id', id);
      setDocuments(prev => prev.filter(d => d.id !== id));
      if (expandedDocId === id) setExpandedDocId(null);
      toast({ title: "Document deleted", description: `"${fileName}" removed.` });
    } catch (e: any) { toast({ title: "Delete failed", description: e.message, variant: "destructive" }); }
  };

  // ── Edit ──
  const openEdit = (doc: Document) => {
    setEditTarget(doc);
    // Build edit metadata from doc's metadata + legacy fields
    const meta: Record<string, string> = { ...(doc.metadata || {}) };
    // Fill from legacy columns if not in metadata
    if (doc.docType && doc.docType !== 'unknown' && !meta['Document Type']) meta['Document Type'] = doc.docType;
    if (doc.site && !meta['Site']) meta['Site'] = doc.site;
    if (doc.equipmentType && doc.equipmentType !== 'unknown' && !meta['Equipment Type']) meta['Equipment Type'] = doc.equipmentType;
    if (doc.equipmentMake && !meta['Make']) meta['Make'] = doc.equipmentMake;
    if (doc.equipmentModel && !meta['Model']) meta['Model'] = doc.equipmentModel;
    setEditMetadata(meta);
    setEditSelectedRoles(doc.allowedRoles);
  };

  const handleEditSave = async () => {
    if (!editTarget) return;
    setIsSaving(true);
    try {
      const updateData: any = {
        allowed_roles: editSelectedRoles,
        metadata: editMetadata,
      };
      // Also update legacy columns if present
      if (editMetadata['Document Type'] !== undefined) updateData.doc_type = editMetadata['Document Type'] || null;
      if (editMetadata['Site'] !== undefined) updateData.site = editMetadata['Site'] || null;
      if (editMetadata['Make'] !== undefined) updateData.equipment_make = editMetadata['Make'] || null;
      if (editMetadata['Model'] !== undefined) updateData.equipment_model = editMetadata['Model'] || null;

      await supabase.from('documents').update(updateData).eq('id', editTarget.id);

      if (editMetadata['Equipment Type'] !== undefined) {
        await supabase.from('chunks').update({ equipment: editMetadata['Equipment Type'] || null }).eq('document_id', editTarget.id);
      }

      toast({ title: "Document updated" });
      setEditTarget(null);
      await fetchDocuments();
    } catch (e: any) { toast({ title: "Update failed", description: e.message, variant: "destructive" }); }
    finally { setIsSaving(false); }
  };

  // ── Edit Content (for txt/docx) ──
  const openEditContent = async (doc: Document) => {
    setEditContentDoc(doc);
    setEditContentName(doc.fileName);
    setEditContentText("");
    setIsEditContentLoading(true);
    const { data: chunks } = await supabase.from('chunks').select('text, chunk_index').eq('document_id', doc.id).order('chunk_index');
    // Reconstruct original text by removing overlap between consecutive chunks
    if (chunks && chunks.length > 0) {
      let fullText = chunks[0].text;
      for (let i = 1; i < chunks.length; i++) {
        const prev = chunks[i - 1].text;
        const curr = chunks[i].text;
        // Find the overlap: the end of prev that matches the start of curr
        let overlapLen = 0;
        const maxOverlap = Math.min(prev.length, curr.length, 300); // overlap is ~200 chars
        for (let ol = maxOverlap; ol >= 10; ol--) {
          if (prev.slice(-ol) === curr.slice(0, ol)) {
            overlapLen = ol;
            break;
          }
        }
        fullText += curr.slice(overlapLen);
      }
      setEditContentText(fullText);
    } else {
      setEditContentText('');
    }
    setIsEditContentLoading(false);
  };

  const startEditContentDictation = useCallback(() => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      toast({ title: "Speech recognition not supported", variant: "destructive" });
      return;
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    editContentRecognitionRef.current = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    const textarea = editContentTextareaRef.current;
    const cursorPos = textarea?.selectionStart ?? editContentText.length;
    const textBefore = editContentText.slice(0, cursorPos);
    const textAfter = editContentText.slice(cursorPos);
    let newDictatedText = '';
    recognition.onstart = () => setIsEditContentDictating(true);
    recognition.onresult = (event: any) => {
      let finalT = '';
      let interimT = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalT += transcript + ' ';
        else interimT += transcript;
      }
      newDictatedText += finalT;
      setEditContentText(textBefore + newDictatedText + interimT + textAfter);
    };
    recognition.onerror = (event: any) => {
      if (event.error === 'not-allowed') toast({ title: "Microphone permission denied", variant: "destructive" });
      setIsEditContentDictating(false);
      editContentRecognitionRef.current = null;
    };
    recognition.onend = () => { setIsEditContentDictating(false); editContentRecognitionRef.current = null; };
    recognition.start();
  }, [toast, editContentText]);

  const stopEditContentDictation = useCallback(() => {
    if (editContentRecognitionRef.current) {
      try { editContentRecognitionRef.current.stop(); } catch (e) {}
      editContentRecognitionRef.current = null;
    }
    setIsEditContentDictating(false);
  }, []);

  const handleSaveEditContent = async () => {
    if (!editContentDoc || !editContentText.trim()) return;
    stopEditContentDictation();
    setIsEditContentSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('ingest-text', {
        body: {
          documentId: editContentDoc.id,
          documentName: editContentName.trim() || editContentDoc.fileName,
          content: editContentText.trim(),
          allowedRoles: editContentDoc.allowedRoles,
          projectId: projectId || undefined,
          dynamicMetadata: editContentDoc.metadata,
          isUpdate: true,
        }
      });
      if (error) throw error;
      toast({ title: "Document updated", description: "Re-indexing in progress..." });
      setEditContentDoc(null);
      await fetchDocuments();
    } catch (e: any) { toast({ title: "Update failed", description: e.message, variant: "destructive" }); }
    finally { setIsEditContentSaving(false); }
  };

  // ── Reprocess ──
  const [reprocessingIds, setReprocessingIds] = useState<Set<string>>(new Set());

  const handleReprocess = async (doc: Document) => {
    toast({ title: "Reprocessing", description: `Reindexing "${doc.fileName}"...` });
    setReprocessingIds(prev => new Set(prev).add(doc.id));

    try {
      const { error: clearError } = await supabase
        .from('chunks')
        .update({ embedding: null })
        .eq('document_id', doc.id);
      if (clearError) throw clearError;

      await supabase.from('documents').update({
        ingestion_status: 'processing_embeddings',
        ingestion_error: null,
        ingested_chunks: 0,
      }).eq('id', doc.id);

      await fetchDocuments();

      let complete = false;
      let attempts = 0;
      const maxAttempts = 200;

      while (!complete && attempts < maxAttempts) {
        attempts++;
        const { data: embedResponse, error: embedError } = await supabase.functions.invoke(
          'generate-embeddings',
          { body: { documentId: doc.id } }
        );

        if (embedError) {
          console.error("Embedding batch error:", embedError);
          break;
        }

        complete = embedResponse?.complete === true;

        if (embedResponse?.embedded != null) {
          await supabase.from('documents').update({
            ingested_chunks: embedResponse.embedded,
          }).eq('id', doc.id);
        }

        if (!complete) {
          await new Promise(r => setTimeout(r, 200));
        }
      }

      if (complete) {
        await supabase.from('documents').update({ ingestion_status: 'complete' }).eq('id', doc.id);
        toast({ title: "Reprocessing complete", description: `"${doc.fileName}" has been fully re-indexed.` });
      } else {
        toast({ title: "Reprocessing may be incomplete", description: "Check document status.", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Reprocessing failed", description: e.message, variant: "destructive" });
      await supabase.from('documents').update({
        ingestion_status: 'failed',
        ingestion_error: e.message,
      }).eq('id', doc.id);
    } finally {
      setReprocessingIds(prev => { const next = new Set(prev); next.delete(doc.id); return next; });
      await fetchDocuments();
    }
  };

  // ── Filter active tags ──
  const activeFilters: { key: string; label: string; clear: () => void }[] = [];
  projectFields.forEach(field => {
    if (filterValues[field]) {
      activeFilters.push({ key: field, label: `${field}: ${filterValues[field]}`, clear: () => setFilterValues(prev => { const n = { ...prev }; delete n[field]; return n; }) });
    }
  });
  if (filterRole) activeFilters.push({ key: 'role', label: `Role: ${filterRole}`, clear: () => setFilterRole("") });
  if (filterDocumentIds.length > 0) {
    const docLabel = filterDocumentIds.length === 1 ? (documents.find(d => d.id === filterDocumentIds[0])?.fileName || '1 document') : `${filterDocumentIds.length} documents`;
    activeFilters.push({ key: 'documents', label: `Documents: ${docLabel}`, clear: () => setFilterDocumentIds([]) });
  }

  const clearAllFilters = () => { setFilterValues({}); setFilterRole(""); setFilterDocumentIds([]); setSearchQuery(""); };

  // Document items for multi-select
  const docItems: DocItem[] = documents.map(d => ({ id: d.id, name: d.fileName }));

  // ── Get metadata value from doc (check metadata JSONB first, then legacy columns) ──
  const getDocFieldValue = (doc: Document, field: string): string => {
    if (doc.metadata && doc.metadata[field]) return doc.metadata[field];
    // Legacy mapping
    const legacyMap: Record<string, string | null> = {
      'Document Type': doc.docType !== 'unknown' ? doc.docType : null,
      'Site': doc.site,
      'Equipment Type': doc.equipmentType !== 'unknown' ? doc.equipmentType : null,
      'Make': doc.equipmentMake,
      'Model': doc.equipmentModel,
    };
    return legacyMap[field] || '';
  };

  // ── Filtered documents ──
  const filteredDocuments = documents.filter(doc => {
    const q = searchQuery.toLowerCase();
    if (q && !doc.fileName.toLowerCase().includes(q) && !doc.docType.toLowerCase().includes(q) && !(doc.site || '').toLowerCase().includes(q) && !(doc.equipmentMake || '').toLowerCase().includes(q) && !(doc.equipmentModel || '').toLowerCase().includes(q)) return false;
    // Dynamic field filters
    for (const field of projectFields) {
      if (filterValues[field]) {
        const val = getDocFieldValue(doc, field);
        if (val !== filterValues[field]) return false;
      }
    }
    if (filterRole && !doc.allowedRoles.includes(filterRole) && !doc.allowedRoles.includes("all")) return false;
    if (filterDocumentIds.length > 0 && !filterDocumentIds.includes(doc.id)) return false;
    return true;
  });

  const visibleDocuments = filteredDocuments.slice(0, visibleCount);

  // ── Helpers ──
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    try { return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return dateStr; }
  };

  const formatRoles = (roles: string[]) => roles.includes("all") ? "All Roles" : roles.map(r => availableRoles.find(ar => ar.role === r)?.displayName || r).join(", ");

  const getMetaTags = (doc: Document) => {
    const tags: string[] = [];
    // Use project fields to get tags
    for (const field of projectFields) {
      const val = getDocFieldValue(doc, field);
      if (val) tags.push(val);
    }
    // Fallback: if no project fields, use legacy
    if (projectFields.length === 0) {
      if (doc.docType && doc.docType !== 'unknown') tags.push(doc.docType);
      if (doc.site) tags.push(doc.site);
      if (doc.equipmentType && doc.equipmentType !== 'unknown') tags.push(doc.equipmentType);
      if (doc.equipmentMake) tags.push(doc.equipmentMake);
      if (doc.equipmentModel) tags.push(doc.equipmentModel);
    }
    return tags;
  };

  const StatusBadge = ({ doc }: { doc: Document }) => {
    const effectivelyComplete = doc.ingestionStatus === 'complete' || (doc.totalChunks > 0 && doc.embeddedChunks >= doc.totalChunks);
    if (effectivelyComplete) return <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border" style={{ background: 'hsl(142 76% 96%)', color: 'hsl(142 72% 29%)', borderColor: 'hsl(142 60% 75%)' }}>Indexed</span>;
    if (doc.ingestionStatus === 'failed') return <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border" style={{ background: 'hsl(0 86% 97%)', color: 'hsl(0 72% 51%)', borderColor: 'hsl(0 72% 80%)' }}><AlertCircle className="h-3 w-3" />Failed</span>;
    if (doc.ingestionStatus === 'in_progress' || doc.ingestionStatus === 'processing_embeddings') return <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border" style={{ background: 'hsl(38 92% 96%)', color: 'hsl(32 95% 44%)', borderColor: 'hsl(38 80% 75%)' }}><Loader2 className="h-3 w-3 animate-spin" />Processing</span>;
    return <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-muted text-muted-foreground border border-border"><Clock className="h-3 w-3" />Pending</span>;
  };

  // Compute grid columns based on field count + Access Role + Documents
  const metadataFieldCount = projectFields.length + 2; // +1 for Access Role, +1 for Documents
  const gridCols = metadataFieldCount <= 2 ? 2 : 3;

  return (
    <div className="space-y-0 pb-12">

      {/* Project dropdown + tab switcher row */}
      {(projects || tabSwitcher) && (
        <div className="sticky top-0 z-30 bg-popover flex items-center justify-between px-4 py-3">
          {projects && currentProject && onProjectSwitch ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 max-w-[50vw] sm:w-[228px] px-3 py-2 rounded-lg hover:bg-muted/60 transition-colors text-sm font-medium text-foreground min-w-0">
                  <FolderOpen className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span className="flex-1 text-left truncate">{currentProject.name}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56 bg-popover border border-border shadow-lg z-50">
                {projects.map((project) => (
                  <DropdownMenuItem
                    key={project.id}
                    onClick={() => onProjectSwitch(project)}
                    className="flex items-center gap-2"
                  >
                    <FolderOpen className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="flex-1 text-left truncate">{project.name}</span>
                    {project.id === currentProject.id && (
                      <Check className="h-4 w-4 text-foreground flex-shrink-0 ml-auto" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : <div />}
          {tabSwitcher}
        </div>
      )}

      <div className="max-w-3xl mx-auto space-y-8 px-4 py-6">

      {/* ── Upload Actions ── */}
      {canWrite && (
        <div className="border-2 border-dashed border-border rounded-2xl bg-background">
          {/* Header text */}
          <div className="pt-6 px-8 text-center space-y-1">
            <p className="text-sm font-medium text-foreground">Upload metadata and drag & drop files</p>
            <p className="text-sm text-muted-foreground">or select an option below</p>
          </div>

          {/* Buttons row */}
          <div className="py-6 px-8">
            <input ref={fileInputRef} type="file" id="file-upload" multiple accept=".pdf,.docx,.txt" className="hidden" onChange={handleFileSelect} />
            {/* Mobile: 2x2 grid with equal-width buttons; Desktop: flex row */}
            <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-center sm:justify-center">
              <button
                onClick={() => setMetadataOpen(!metadataOpen)}
                className={cn(
                  "inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-full text-sm font-medium border transition-colors whitespace-nowrap sm:px-5 sm:gap-2",
                  metadataOpen ? "bg-muted border-border text-foreground" : "bg-background border-border text-foreground hover:bg-muted/50"
                )}
              >
                <SlidersHorizontal className="h-3.5 w-3.5 flex-shrink-0" />
                Metadata
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-full text-sm font-medium border border-border bg-background text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50 whitespace-nowrap sm:px-5 sm:gap-2"
              >
                <Upload className="h-4 w-4 flex-shrink-0" />
                {isUploading ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading...</> : "Upload files"}
              </button>
              <button
                onClick={() => setCopiedTextOpen(true)}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-full text-sm font-medium border border-border bg-background text-foreground hover:bg-muted/50 transition-colors whitespace-nowrap sm:px-5 sm:gap-2"
              >
                <ClipboardPaste className="h-4 w-4 flex-shrink-0" />
                Copied text
              </button>
              <button
                onClick={() => setDictateOpen(true)}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-full text-sm font-medium border border-border bg-background text-foreground hover:bg-muted/50 transition-colors whitespace-nowrap sm:px-5 sm:gap-2"
              >
                <Mic className="h-4 w-4 flex-shrink-0" />
                Dictate
              </button>
            </div>
          </div>

          {/* Metadata panel — dynamic fields from project + Access Role */}
          {metadataOpen && (
            <>
              <Separator />
              <div className="px-8 py-6">
                <div className="flex items-center justify-between mb-5">
                  <p className="text-sm font-semibold text-foreground">Upload metadata</p>
                  <button onClick={() => { setUploadMetadata({}); setSelectedRoles(["all"]); }} className="text-sm text-muted-foreground hover:text-foreground transition-colors">Reset</button>
                </div>
                <div className={`grid gap-x-8 gap-y-5 ${gridCols === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                  {projectFields.map(field => (
                    <InlineSelect
                      key={field}
                      label={field}
                      value={uploadMetadata[field] || ""}
                      onChange={v => setUploadMetadata(prev => ({ ...prev, [field]: v }))}
                      options={fieldOptions[field] || []}
                      allowAdd
                      onAddNew={v => handleAddOption(field, v)}
                    />
                  ))}
                  
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Search & Filters ── */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setVisibleCount(10); }}
              placeholder="Search documents by filters"
              className="pl-10 pr-10 h-11 rounded-full border-border bg-background"
            />
            {searchQuery && (
              <button
                onClick={() => { setSearchQuery(""); setVisibleCount(10); }}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <button
            onClick={() => setFiltersOpen(!filtersOpen)}
            className={cn(
              "inline-flex items-center gap-2 px-5 h-11 rounded-full text-sm font-medium border transition-colors whitespace-nowrap",
              filtersOpen ? "bg-muted border-border text-foreground" : "bg-background border-border text-foreground hover:bg-muted/50"
            )}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filters
          </button>
        </div>

        {/* Active filter tags */}
        <div className="flex items-center gap-2 flex-wrap min-h-[24px]">
          {activeFilters.length === 0 ? (
            <p className="text-xs text-muted-foreground">No filters active.</p>
          ) : (
            activeFilters.map(f => (
              <span key={f.key} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-muted border border-border text-foreground">
                {f.label}
                <button onClick={f.clear} className="text-muted-foreground hover:text-foreground ml-0.5"><X className="h-3 w-3" /></button>
              </span>
            ))
          )}
          {activeFilters.length > 0 && (
            <button onClick={clearAllFilters} className="text-xs text-muted-foreground hover:text-foreground ml-auto">Clear</button>
          )}
        </div>

        {/* Filter panel — dynamic fields from project + Access Role + Documents */}
        {filtersOpen && (
          <div className="border border-border rounded-xl p-6 bg-background shadow-sm">
            <div className="flex items-center justify-between mb-5">
              <p className="text-sm font-semibold text-foreground">Search filters</p>
              <button onClick={() => { setFilterValues({}); setFilterRole(""); setFilterDocumentIds([]); }} className="text-sm text-muted-foreground hover:text-foreground transition-colors">Reset</button>
            </div>
            <div className={`grid gap-x-8 gap-y-5 ${gridCols === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
              {projectFields.map(field => (
                <InlineSelect
                  key={field}
                  label={field}
                  value={filterValues[field] || ""}
                  onChange={v => { setFilterValues(prev => ({ ...prev, [field]: v })); setVisibleCount(10); }}
                  options={fieldOptions[field] || []}
                />
              ))}
              
              <DocumentMultiSelect label="Documents" selectedIds={filterDocumentIds} documents={docItems} onChange={ids => { setFilterDocumentIds(ids); setVisibleCount(10); }} />
            </div>
          </div>
        )}
      </div>

      {/* ── Documents List ── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">Documents</h2>
          <span className="text-sm text-muted-foreground">{filteredDocuments.length} result{filteredDocuments.length !== 1 ? 's' : ''}</span>
        </div>
        <Separator className="mb-4" />

        <div className="divide-y divide-border">
          {visibleDocuments.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">No documents found.</p>
          )}

          {visibleDocuments.map(doc => {
            const isExpanded = expandedDocId === doc.id;
            const tags = getMetaTags(doc);

            return (
              <div key={doc.id}>
                <div
                  className={cn(
                    "py-5 flex items-start justify-between cursor-pointer px-2 -mx-2 rounded-lg transition-colors min-h-[72px]",
                    isExpanded ? "bg-muted/30" : "hover:bg-muted/30"
                  )}
                  onClick={() => setExpandedDocId(isExpanded ? null : doc.id)}
                >
                  <div className="flex-1 min-w-0 pr-4">
                    <p className="text-sm font-semibold text-foreground">{doc.fileName}</p>
                    <div className="flex flex-wrap gap-1.5 mt-2 min-h-[22px]">
                      {tags.map(tag => (
                        <span key={tag} className="text-xs px-2.5 py-0.5 rounded-full border border-border text-foreground/70 bg-background">{tag}</span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <StatusBadge doc={doc} />
                    {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </div>

                {isExpanded && (
                  <div className="pl-8 pr-8 pb-5 bg-muted/30 -mx-2 px-[calc(2rem+0.5rem)] rounded-b-lg">
                    <Separator className="mb-5" />
                    <div className="grid grid-cols-3 gap-6 mb-5">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Uploaded</p>
                        <p className="text-sm text-foreground">{formatDate(doc.createdAt)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Access Role</p>
                        <p className="text-sm text-foreground">{formatRoles(doc.allowedRoles)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Chunks</p>
                        <p className="text-sm text-foreground">{doc.embeddedChunks}/{doc.totalChunks}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {doc.fileType === 'pdf' ? (
                        <button onClick={() => setViewDoc(doc)} className="px-4 py-1.5 rounded-full text-sm border border-border bg-background hover:bg-muted/50 transition-colors text-foreground">View</button>
                      ) : (
                        <button onClick={() => openEditContent(doc)} className="px-4 py-1.5 rounded-full text-sm border border-border bg-background hover:bg-muted/50 transition-colors text-foreground">Edit</button>
                      )}
                      {canWrite && <button onClick={() => openEdit(doc)} className="px-4 py-1.5 rounded-full text-sm border border-border bg-background hover:bg-muted/50 transition-colors text-foreground">Metadata</button>}
                      {canDelete && <button onClick={() => setDeleteTarget({ id: doc.id, fileName: doc.fileName })} className="px-4 py-1.5 rounded-full text-sm border border-border bg-background hover:bg-muted/50 transition-colors text-foreground">Delete</button>}
                      {canWrite && <button onClick={() => handleReprocess(doc)} className="px-4 py-1.5 rounded-full text-sm bg-foreground text-background hover:bg-foreground/90 transition-colors font-medium">Reprocess</button>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {visibleDocuments.length > 0 && <Separator />}

        {filteredDocuments.length > visibleCount && (
          <div className="flex justify-center mt-6">
            <button onClick={() => setVisibleCount(v => v + 10)} className="px-6 py-2 rounded-full text-sm border border-border bg-background hover:bg-muted/50 transition-colors text-foreground">
              Load more ({filteredDocuments.length - visibleCount} remaining)
            </button>
          </div>
        )}
      </div>

      </div>

      {/* ── View Modal ── */}
      {viewDoc && (
        <DocumentViewerModal
          open={!!viewDoc}
          onClose={() => setViewDoc(null)}
          documentId={viewDoc.id}
          highlightText=""
          filename={viewDoc.fileName}
          chunkIndex={-1}
        />
      )}

      {/* ── Edit Modal — dynamic fields from project + Access Role ── */}
      <Dialog open={!!editTarget} onOpenChange={open => !open && setEditTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit metadata</DialogTitle>
          </DialogHeader>
          <div className={`grid gap-x-6 gap-y-5 py-2 ${gridCols === 2 ? 'grid-cols-2' : 'grid-cols-2'}`}>
            {projectFields.map(field => (
              <InlineSelect
                key={field}
                label={field}
                value={editMetadata[field] || ""}
                onChange={v => setEditMetadata(prev => ({ ...prev, [field]: v }))}
                options={fieldOptions[field] || []}
              />
            ))}
            
          </div>
          <DialogFooter>
            <button onClick={() => setEditTarget(null)} className="px-5 py-2 rounded-full text-sm border border-border bg-background hover:bg-muted/50 transition-colors text-foreground">Cancel</button>
            <button onClick={handleEditSave} disabled={isSaving} className="px-5 py-2 rounded-full text-sm bg-foreground text-background hover:bg-foreground/90 transition-colors font-medium disabled:opacity-50">
              {isSaving ? "Saving..." : "Save"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm ── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.fileName}</strong>? This will remove it from the knowledge base and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Copied Text Modal ── */}
      <Dialog open={copiedTextOpen} onOpenChange={open => { if (!open) { setCopiedTextOpen(false); setCopiedTextName(""); setCopiedTextContent(""); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Copied text</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-sm font-medium">Document name</Label>
              <Input
                value={copiedTextName}
                onChange={e => setCopiedTextName(e.target.value)}
                placeholder="Enter document name"
                className="mt-1.5"
              />
            </div>
            <div>
              <Label className="text-sm font-medium">Content</Label>
              <Textarea
                value={copiedTextContent}
                onChange={e => setCopiedTextContent(e.target.value)}
                placeholder="Paste or type your text here..."
                className="mt-1.5 min-h-[200px]"
              />
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => { setCopiedTextOpen(false); setCopiedTextName(""); setCopiedTextContent(""); }} className="px-5 py-2 rounded-full text-sm border border-border bg-background hover:bg-muted/50 transition-colors text-foreground">Cancel</button>
            <button onClick={handleInsertText} disabled={isInsertingText || !copiedTextName.trim() || !copiedTextContent.trim()} className="px-5 py-2 rounded-full text-sm bg-foreground text-background hover:bg-foreground/90 transition-colors font-medium disabled:opacity-50">
              {isInsertingText ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin inline" /> Inserting...</> : "Insert"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dictate Modal ── */}
      <Dialog open={dictateOpen} onOpenChange={open => { if (!open) { stopDictation(); setDictateOpen(false); setDictateName(""); setDictateContent(""); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Dictate</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-sm font-medium">Document name</Label>
              <Input
                value={dictateName}
                onChange={e => setDictateName(e.target.value)}
                placeholder="Enter document name"
                className="mt-1.5"
              />
            </div>
            <div>
              <Label className="text-sm font-medium">Dictated text</Label>
              <Textarea
                value={dictateContent}
                onChange={e => setDictateContent(e.target.value)}
                placeholder="Your dictation will appear here..."
                className="mt-1.5 min-h-[200px]"
              />
            </div>
            <div className="flex items-center gap-3">
              {isDictating ? (
                <button
                  onClick={stopDictation}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                >
                  <Square className="h-3.5 w-3.5" />
                  Stop recording
                </button>
              ) : (
                <button
                  onClick={startDictation}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border border-border bg-background text-foreground hover:bg-muted/50 transition-colors"
                >
                  <Mic className="h-3.5 w-3.5" />
                  Start recording
                </button>
              )}
              {isDictating && (
                <span className="flex items-center gap-1.5 text-xs text-destructive">
                  <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
                  Recording...
                </span>
              )}
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => { stopDictation(); setDictateOpen(false); setDictateName(""); setDictateContent(""); }} className="px-5 py-2 rounded-full text-sm border border-border bg-background hover:bg-muted/50 transition-colors text-foreground">Cancel</button>
            <button onClick={handleInsertDictation} disabled={isInsertingDictation || !dictateName.trim() || !dictateContent.trim()} className="px-5 py-2 rounded-full text-sm bg-foreground text-background hover:bg-foreground/90 transition-colors font-medium disabled:opacity-50">
              {isInsertingDictation ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin inline" /> Inserting...</> : "Insert"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Content Modal (txt/docx) ── */}
      <Dialog open={!!editContentDoc} onOpenChange={open => { if (!open) { stopEditContentDictation(); setEditContentDoc(null); setEditContentName(""); setEditContentText(""); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit document</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-sm font-medium">Document name</Label>
              <Input
                value={editContentName}
                onChange={e => setEditContentName(e.target.value)}
                placeholder="Enter document name"
                className="mt-1.5"
              />
            </div>
            <div>
              <Label className="text-sm font-medium">Content</Label>
              {isEditContentLoading ? (
                <div className="flex items-center justify-center min-h-[200px] border border-border rounded-md mt-1.5">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <Textarea
                  ref={editContentTextareaRef}
                  value={editContentText}
                  onChange={e => setEditContentText(e.target.value)}
                  placeholder="Document content..."
                  className="mt-1.5 min-h-[200px]"
                />
              )}
            </div>
            <div className="flex items-center gap-3">
              {isEditContentDictating ? (
                <button
                  onClick={stopEditContentDictation}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                >
                  <Square className="h-3.5 w-3.5" />
                  Stop recording
                </button>
              ) : (
                <button
                  onClick={startEditContentDictation}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border border-border bg-background text-foreground hover:bg-muted/50 transition-colors"
                >
                  <Mic className="h-3.5 w-3.5" />
                  Start recording
                </button>
              )}
              {isEditContentDictating && (
                <span className="flex items-center gap-1.5 text-xs text-destructive">
                  <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
                  Recording...
                </span>
              )}
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => { stopEditContentDictation(); setEditContentDoc(null); }} className="px-5 py-2 rounded-full text-sm border border-border bg-background hover:bg-muted/50 transition-colors text-foreground">Cancel</button>
            <button onClick={handleSaveEditContent} disabled={isEditContentSaving || !editContentText.trim()} className="px-5 py-2 rounded-full text-sm bg-foreground text-background hover:bg-foreground/90 transition-colors font-medium disabled:opacity-50">
              {isEditContentSaving ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin inline" /> Saving...</> : "Insert"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
