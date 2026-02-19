import {
  Trash2, Loader2, CheckCircle, AlertCircle, Clock, Check,
  SlidersHorizontal, ChevronRight, ChevronDown, X, Search, Plus
} from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect, useRef } from "react";
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
}

interface Role {
  role: string;
  displayName: string | null;
}

interface RepositoryCardProps {
  onDocumentSelect?: (id: string | null) => void;
  permissions: TabPermissions;
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

// ─── Main Component ───────────────────────────────────────────────────────────
export const RepositoryCard = ({ onDocumentSelect, permissions }: RepositoryCardProps) => {
  const canWrite = permissions.write;
  const canDelete = permissions.delete;

  // Upload state
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [metadataOpen, setMetadataOpen] = useState(false);

  // Upload metadata
  const [docType, setDocType] = useState("");
  const [site, setSite] = useState("");
  const [equipmentType, setEquipmentType] = useState("");
  const [equipmentMake, setEquipmentMake] = useState("");
  const [equipmentModel, setEquipmentModel] = useState("");
  const [selectedRoles, setSelectedRoles] = useState<string[]>(["all"]);

  // Dropdown options
  const [docTypeOptions, setDocTypeOptions] = useState<string[]>([]);
  const [siteOptions, setSiteOptions] = useState<string[]>([]);
  const [equipmentTypeOptions, setEquipmentTypeOptions] = useState<string[]>([]);
  const [equipmentMakeOptions, setEquipmentMakeOptions] = useState<string[]>([]);
  const [equipmentModelOptions, setEquipmentModelOptions] = useState<string[]>([]);
  const [availableRoles, setAvailableRoles] = useState<Role[]>([]);

  // Documents
  const [documents, setDocuments] = useState<Document[]>([]);
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(10);

  // Search & filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterDocType, setFilterDocType] = useState("");
  const [filterSite, setFilterSite] = useState("");
  const [filterEquipmentType, setFilterEquipmentType] = useState("");
  const [filterMake, setFilterMake] = useState("");
  const [filterModel, setFilterModel] = useState("");
  const [filterRole, setFilterRole] = useState("");

  // Modals
  const [viewDoc, setViewDoc] = useState<Document | null>(null);
  const [editTarget, setEditTarget] = useState<Document | null>(null);
  const [editDocType, setEditDocType] = useState("");
  const [editSite, setEditSite] = useState("");
  const [editEquipmentType, setEditEquipmentType] = useState("");
  const [editEquipmentMake, setEditEquipmentMake] = useState("");
  const [editEquipmentModel, setEditEquipmentModel] = useState("");
  const [editSelectedRoles, setEditSelectedRoles] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; fileName: string } | null>(null);

  // ── Fetch dropdown options ──
  const fetchDropdownOptions = async () => {
    const { data } = await supabase.from('dropdown_options').select('category, value').order('value');
    if (data) {
      setDocTypeOptions(data.filter(d => d.category === 'docType').map(d => d.value));
      setSiteOptions(data.filter(d => d.category === 'site').map(d => d.value));
      setEquipmentTypeOptions(data.filter(d => d.category === 'equipmentType').map(d => d.value));
      setEquipmentMakeOptions(data.filter(d => d.category === 'equipmentMake').map(d => d.value));
      setEquipmentModelOptions(data.filter(d => d.category === 'equipmentModel').map(d => d.value));
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
    const { data: docs, error } = await supabase.from('documents').select('*').order('uploaded_at', { ascending: false });
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
      };
    }));

    setDocuments(documentsWithText.filter(d => d !== null) as Document[]);
  };

  useEffect(() => {
    fetchDocuments();
    const docsChannel = supabase.channel('repository-docs').on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, fetchDocuments).subscribe();
    const chunksChannel = supabase.channel('repository-chunks').on('postgres_changes', { event: '*', schema: 'public', table: 'chunks' }, fetchDocuments).subscribe();
    const poll = setInterval(() => {
      if (documents.some(d => d.ingestionStatus === 'in_progress' || d.ingestionStatus === 'processing_embeddings')) fetchDocuments();
    }, 3000);
    return () => { supabase.removeChannel(docsChannel); supabase.removeChannel(chunksChannel); clearInterval(poll); };
  }, [documents.length]);

  // ── Add new dropdown option ──
  const handleAddOption = async (category: string, value: string, setter: (opts: string[]) => void, currentOpts: string[]) => {
    if (!value.trim()) return;
    await supabase.from('dropdown_options').insert({ category, value: value.trim() });
    if (!currentOpts.includes(value.trim())) setter([...currentOpts, value.trim()]);
    await fetchDropdownOptions();
  };

  // ── Upload ──
  const handleUpload = async () => {
    if (selectedFiles.length === 0) { toast({ title: "No files selected", variant: "destructive" }); return; }
    if (selectedRoles.length === 0) { toast({ title: "Select an access role", variant: "destructive" }); return; }
    setIsUploading(true);
    try {
      const formData = new FormData();
      selectedFiles.forEach(f => formData.append('files', f));
      if (docType) formData.append('docType', docType);
      formData.append('uploadDate', new Date().toISOString().split('T')[0]);
      if (site) formData.append('site', site);
      if (equipmentType) formData.append('equipmentType', equipmentType);
      if (equipmentMake) formData.append('equipmentMake', equipmentMake);
      if (equipmentModel) formData.append('equipmentModel', equipmentModel);
      formData.append('allowedRoles', JSON.stringify(selectedRoles));
      const { data, error } = await supabase.functions.invoke('ingest', { body: formData });
      if (error) throw error;
      if (data.success) {
        toast({ title: "Upload successful", description: `${data.documents.length} file(s) queued for indexing.` });
        setSelectedFiles([]);
        setDocType(""); setSite(""); setEquipmentType(""); setEquipmentMake(""); setEquipmentModel("");
        setSelectedRoles(["all"]); setMetadataOpen(false);
        const fi = document.getElementById('file-upload') as HTMLInputElement;
        if (fi) fi.value = '';
        await fetchDocuments();
      } else throw new Error(data.error || 'Upload failed');
    } catch (e: any) { toast({ title: "Upload failed", description: e.message, variant: "destructive" }); }
    finally { setIsUploading(false); }
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
    setEditDocType(doc.docType === 'unknown' ? '' : doc.docType);
    setEditSite(doc.site || '');
    setEditEquipmentType(doc.equipmentType === 'unknown' ? '' : doc.equipmentType);
    setEditEquipmentMake(doc.equipmentMake || '');
    setEditEquipmentModel(doc.equipmentModel || '');
    setEditSelectedRoles(doc.allowedRoles);
  };

  const handleEditSave = async () => {
    if (!editTarget) return;
    setIsSaving(true);
    try {
      await supabase.from('documents').update({ doc_type: editDocType || null, site: editSite || null, equipment_make: editEquipmentMake || null, equipment_model: editEquipmentModel || null, allowed_roles: editSelectedRoles }).eq('id', editTarget.id);
      if (editEquipmentType !== editTarget.equipmentType) await supabase.from('chunks').update({ equipment: editEquipmentType || null }).eq('document_id', editTarget.id);
      toast({ title: "Document updated" });
      setEditTarget(null);
      await fetchDocuments();
    } catch (e: any) { toast({ title: "Update failed", description: e.message, variant: "destructive" }); }
    finally { setIsSaving(false); }
  };

  // ── Reprocess ──
  const handleReprocess = async (doc: Document) => {
    toast({ title: "Reprocessing", description: `Reindexing "${doc.fileName}"...` });
    await supabase.from('documents').update({ ingestion_status: 'processing_embeddings', ingestion_error: null }).eq('id', doc.id);
    try {
      await supabase.functions.invoke('generate-embeddings', { body: { documentId: doc.id, mode: 'full' } });
      toast({ title: "Reprocessing complete" });
    } catch (e: any) { toast({ title: "Reprocessing failed", description: e.message, variant: "destructive" }); }
    await fetchDocuments();
  };

  // ── Filter active tags ──
  const activeFilters: { key: string; label: string; clear: () => void }[] = [];
  if (filterDocType) activeFilters.push({ key: 'type', label: `Type: ${filterDocType}`, clear: () => setFilterDocType("") });
  if (filterSite) activeFilters.push({ key: 'site', label: `Site: ${filterSite}`, clear: () => setFilterSite("") });
  if (filterEquipmentType) activeFilters.push({ key: 'eqtype', label: `Equipment: ${filterEquipmentType}`, clear: () => setFilterEquipmentType("") });
  if (filterMake) activeFilters.push({ key: 'make', label: `Make: ${filterMake}`, clear: () => setFilterMake("") });
  if (filterModel) activeFilters.push({ key: 'model', label: `Model: ${filterModel}`, clear: () => setFilterModel("") });
  if (filterRole) activeFilters.push({ key: 'role', label: `Role: ${filterRole}`, clear: () => setFilterRole("") });

  const clearAllFilters = () => { setFilterDocType(""); setFilterSite(""); setFilterEquipmentType(""); setFilterMake(""); setFilterModel(""); setFilterRole(""); setSearchQuery(""); };

  // ── Filtered documents ──
  const filteredDocuments = documents.filter(doc => {
    const q = searchQuery.toLowerCase();
    if (q && !doc.fileName.toLowerCase().includes(q) && !doc.docType.toLowerCase().includes(q) && !(doc.site || '').toLowerCase().includes(q) && !(doc.equipmentMake || '').toLowerCase().includes(q) && !(doc.equipmentModel || '').toLowerCase().includes(q)) return false;
    if (filterDocType && doc.docType !== filterDocType) return false;
    if (filterSite && doc.site !== filterSite) return false;
    if (filterEquipmentType && doc.equipmentType !== filterEquipmentType) return false;
    if (filterMake && doc.equipmentMake !== filterMake) return false;
    if (filterModel && doc.equipmentModel !== filterModel) return false;
    if (filterRole && !doc.allowedRoles.includes(filterRole) && !doc.allowedRoles.includes("all")) return false;
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
    if (doc.docType && doc.docType !== 'unknown') tags.push(doc.docType);
    if (doc.site) tags.push(doc.site);
    if (doc.equipmentType && doc.equipmentType !== 'unknown') tags.push(doc.equipmentType);
    if (doc.equipmentMake) tags.push(doc.equipmentMake);
    if (doc.equipmentModel) tags.push(doc.equipmentModel);
    return tags;
  };

  const StatusBadge = ({ doc }: { doc: Document }) => {
    if (doc.ingestionStatus === 'complete') return <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border" style={{ background: 'hsl(142 76% 96%)', color: 'hsl(142 72% 29%)', borderColor: 'hsl(142 60% 75%)' }}>Indexed</span>;
    if (doc.ingestionStatus === 'failed') return <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border" style={{ background: 'hsl(0 86% 97%)', color: 'hsl(0 72% 51%)', borderColor: 'hsl(0 72% 80%)' }}><AlertCircle className="h-3 w-3" />Failed</span>;
    if (doc.ingestionStatus === 'in_progress' || doc.ingestionStatus === 'processing_embeddings') return <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border" style={{ background: 'hsl(38 92% 96%)', color: 'hsl(32 95% 44%)', borderColor: 'hsl(38 80% 75%)' }}><Loader2 className="h-3 w-3 animate-spin" />Processing</span>;
    return <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-muted text-muted-foreground border border-border"><Clock className="h-3 w-3" />Pending</span>;
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8 pb-12">

      {/* ── Upload Box ── */}
      {canWrite && (
        <div className="border-2 border-dashed border-border rounded-2xl bg-background">
          {/* Drop zone */}
          <div className="py-12 px-8 text-center">
            <input type="file" id="file-upload" multiple accept=".pdf,.docx,.txt" className="hidden" onChange={e => setSelectedFiles(Array.from(e.target.files || []))} />
            <label htmlFor="file-upload" className="cursor-pointer">
              <p className="text-base font-semibold text-foreground">Upload documents</p>
              <p className="text-sm mt-2">
                <span className="text-primary cursor-pointer">Drag &amp; drop files here or <span className="underline">click to browse</span></span>
              </p>
              {selectedFiles.length > 0 && (
                <p className="text-xs text-muted-foreground mt-3">{selectedFiles.length} file{selectedFiles.length > 1 ? 's' : ''} selected</p>
              )}
            </label>
          </div>

          {/* Metadata panel */}
          {metadataOpen && (
            <>
              <Separator />
              <div className="px-8 py-6">
                <div className="flex items-center justify-between mb-5">
                  <p className="text-sm font-semibold text-foreground">Upload metadata</p>
                  <button onClick={() => { setDocType(""); setSite(""); setEquipmentType(""); setEquipmentMake(""); setEquipmentModel(""); setSelectedRoles(["all"]); }} className="text-sm text-muted-foreground hover:text-foreground transition-colors">Reset</button>
                </div>
                <div className="grid grid-cols-3 gap-x-8 gap-y-5">
                  <InlineSelect label="Document Type" value={docType} onChange={setDocType} options={docTypeOptions} allowAdd onAddNew={v => handleAddOption('docType', v, setDocTypeOptions, docTypeOptions)} />
                  <InlineSelect label="Site" value={site} onChange={setSite} options={siteOptions} allowAdd onAddNew={v => handleAddOption('site', v, setSiteOptions, siteOptions)} />
                  <InlineSelect label="Equipment Type" value={equipmentType} onChange={setEquipmentType} options={equipmentTypeOptions} allowAdd onAddNew={v => handleAddOption('equipmentType', v, setEquipmentTypeOptions, equipmentTypeOptions)} />
                  <InlineSelect label="Make" value={equipmentMake} onChange={setEquipmentMake} options={equipmentMakeOptions} allowAdd onAddNew={v => handleAddOption('equipmentMake', v, setEquipmentMakeOptions, equipmentMakeOptions)} />
                  <InlineSelect label="Model" value={equipmentModel} onChange={setEquipmentModel} options={equipmentModelOptions} allowAdd onAddNew={v => handleAddOption('equipmentModel', v, setEquipmentModelOptions, equipmentModelOptions)} />
                  <RoleSelect label="Access Role" selectedRoles={selectedRoles} availableRoles={availableRoles} onChange={setSelectedRoles} />
                </div>
              </div>
            </>
          )}

          {/* Actions row */}
          <div className="px-8 pb-6 flex items-center gap-3 justify-center">
            <button
              onClick={() => setMetadataOpen(!metadataOpen)}
              className={cn(
                "inline-flex items-center gap-2 px-5 py-2 rounded-full text-sm font-medium border transition-colors",
                metadataOpen ? "bg-muted border-border text-foreground" : "bg-background border-border text-foreground hover:bg-muted/50"
              )}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Metadata
            </button>
            <Button
              onClick={handleUpload}
              disabled={selectedFiles.length === 0 || isUploading}
              className="rounded-full px-6 bg-foreground text-background hover:bg-foreground/90"
            >
              {isUploading ? <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Uploading...</> : "Upload"}
            </Button>
          </div>
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

        {/* Filter panel */}
        {filtersOpen && (
          <div className="border border-border rounded-xl p-6 bg-background shadow-sm">
            <div className="flex items-center justify-between mb-5">
              <p className="text-sm font-semibold text-foreground">Search filters</p>
              <button onClick={() => { setFilterDocType(""); setFilterSite(""); setFilterEquipmentType(""); setFilterMake(""); setFilterModel(""); setFilterRole(""); }} className="text-sm text-muted-foreground hover:text-foreground transition-colors">Reset</button>
            </div>
            <div className="grid grid-cols-3 gap-x-8 gap-y-5">
              <InlineSelect label="Document Type" value={filterDocType} onChange={v => { setFilterDocType(v); setVisibleCount(10); }} options={docTypeOptions} />
              <InlineSelect label="Site" value={filterSite} onChange={v => { setFilterSite(v); setVisibleCount(10); }} options={siteOptions} />
              <InlineSelect label="Equipment Type" value={filterEquipmentType} onChange={v => { setFilterEquipmentType(v); setVisibleCount(10); }} options={equipmentTypeOptions} />
              <InlineSelect label="Make" value={filterMake} onChange={v => { setFilterMake(v); setVisibleCount(10); }} options={equipmentMakeOptions} />
              <InlineSelect label="Model" value={filterModel} onChange={v => { setFilterModel(v); setVisibleCount(10); }} options={equipmentModelOptions} />
              <InlineSelect label="Access Role" value={filterRole} onChange={v => { setFilterRole(v); setVisibleCount(10); }} options={availableRoles.map(r => r.role)} />
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
                {/* Row */}
                <div
                  className="py-5 flex items-start justify-between cursor-pointer hover:bg-muted/30 px-2 -mx-2 rounded-lg transition-colors min-h-[72px]"
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

                {/* Expanded panel */}
                {isExpanded && (
                  <div className="mx-2 mb-4 border border-border rounded-xl p-5 bg-muted/20">
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
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => setViewDoc(doc)} className="px-4 py-1.5 rounded-full text-sm border border-border bg-background hover:bg-muted/50 transition-colors text-foreground">View</button>
                      {canWrite && <button onClick={() => openEdit(doc)} className="px-4 py-1.5 rounded-full text-sm border border-border bg-background hover:bg-muted/50 transition-colors text-foreground">Edit</button>}
                      {canDelete && <button onClick={() => setDeleteTarget({ id: doc.id, fileName: doc.fileName })} className="px-4 py-1.5 rounded-full text-sm border border-border bg-background hover:bg-muted/50 transition-colors text-foreground">Delete</button>}
                      {canWrite && <button onClick={() => handleReprocess(doc)} className="px-4 py-1.5 rounded-full text-sm bg-foreground text-background hover:bg-foreground/90 transition-colors font-medium">Reprocess</button>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Load more */}
        {filteredDocuments.length > visibleCount && (
          <div className="flex justify-center mt-6">
            <button onClick={() => setVisibleCount(v => v + 10)} className="px-6 py-2 rounded-full text-sm border border-border bg-background hover:bg-muted/50 transition-colors text-foreground">
              Load more ({filteredDocuments.length - visibleCount} remaining)
            </button>
          </div>
        )}
      </div>

      {/* ── View Modal ── */}
      <Dialog open={!!viewDoc} onOpenChange={open => !open && setViewDoc(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Document preview</DialogTitle>
          </DialogHeader>
          {viewDoc && (
            <div className="space-y-4">
              <p className="text-sm font-semibold text-foreground">{viewDoc.fileName}</p>
              <ScrollArea className="h-64 rounded-xl border border-border bg-muted/30 p-4">
                <pre className="text-xs text-foreground/80 whitespace-pre-wrap font-mono leading-relaxed">
                  {viewDoc.extractedText.slice(0, 2000) || "No preview available."}
                  {viewDoc.extractedText.length > 2000 ? "\n\n[Preview truncated to first 2000 characters]" : ""}
                </pre>
              </ScrollArea>
              {viewDoc.pageCount && <p className="text-xs text-muted-foreground">Tagged metadata: {getMetaTags(viewDoc).join(', ') || 'None'}{viewDoc.allowedRoles.includes('all') ? ', All Roles' : `, ${formatRoles(viewDoc.allowedRoles)}`}.</p>}
            </div>
          )}
          <DialogFooter>
            <button onClick={() => setViewDoc(null)} className="px-5 py-2 rounded-full text-sm bg-foreground text-background hover:bg-foreground/90 transition-colors font-medium">Close</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Modal ── */}
      <Dialog open={!!editTarget} onOpenChange={open => !open && setEditTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit metadata</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 py-2">
            <InlineSelect label="Document Type" value={editDocType} onChange={setEditDocType} options={docTypeOptions} />
            <InlineSelect label="Site" value={editSite} onChange={setEditSite} options={siteOptions} />
            <InlineSelect label="Equipment Type" value={editEquipmentType} onChange={setEditEquipmentType} options={equipmentTypeOptions} />
            <InlineSelect label="Make" value={editEquipmentMake} onChange={setEditEquipmentMake} options={equipmentMakeOptions} />
            <InlineSelect label="Model" value={editEquipmentModel} onChange={setEditEquipmentModel} options={equipmentModelOptions} />
            <RoleSelect label="Access Role" selectedRoles={editSelectedRoles} availableRoles={availableRoles} onChange={setEditSelectedRoles} />
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
    </div>
  );
};
