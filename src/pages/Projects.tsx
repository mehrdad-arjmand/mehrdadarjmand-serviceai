import { useState, useEffect } from "react";
import { Header } from "@/components/Header";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, Search, X, Loader2, ChevronRight, ChevronDown, Check, FolderOpen } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { format } from "date-fns";
import { toast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

interface Project {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
  allowed_roles: string[];
}

interface MetricCard {
  label: string;
  sublabel: string;
  value: string;
}

interface RoleOption {
  role: string;
  displayName: string | null;
}

// ─── Role Multi-Select ────────────────────────────────────────────────────────
const RoleMultiSelect = ({ selectedRoles, availableRoles, onChange, label = "Access Role" }: {
  selectedRoles: string[];
  availableRoles: RoleOption[];
  onChange: (roles: string[]) => void;
  label?: string;
}) => {
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

  const displayLabel = selectedRoles.includes("all")
    ? "All"
    : selectedRoles.length === 0
      ? "Select roles"
      : selectedRoles.length === 1
        ? (availableRoles.find(r => r.role === selectedRoles[0])?.displayName || selectedRoles[0])
        : `${selectedRoles.length} roles`;

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className="w-full flex items-center justify-between h-10 border border-border rounded-lg px-3 text-sm bg-background hover:bg-muted/40 transition-colors text-left">
            <span className={selectedRoles.length > 0 ? "text-foreground capitalize" : "text-muted-foreground"}>{displayLabel}</span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-0 z-50 bg-background border border-border shadow-lg" align="start">
          <Command>
            <CommandList>
              <CommandGroup>
                <CommandItem onSelect={() => toggle("all")} className="text-sm">
                  <Check className={cn("mr-2 h-3.5 w-3.5", selectedRoles.includes("all") ? "opacity-100" : "opacity-0")} />
                  All
                </CommandItem>
                <Separator className="my-1" />
                {availableRoles.map(role => (
                  <CommandItem key={role.role} onSelect={() => toggle(role.role)} className="text-sm capitalize">
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

const Projects = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [metadataFields, setMetadataFields] = useState<string[]>([]);
  const [newFieldName, setNewFieldName] = useState("");
  const [selectedRoles, setSelectedRoles] = useState<string[]>(["admin"]);
  const [availableRoles, setAvailableRoles] = useState<RoleOption[]>([]);
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [editTarget, setEditTarget] = useState<Project | null>(null);
  const [editName, setEditName] = useState("");
  const [editRoles, setEditRoles] = useState<string[]>([]);
  const [editMetadataFields, setEditMetadataFields] = useState<string[]>([]);
  const [editNewFieldName, setEditNewFieldName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [filterRole, setFilterRole] = useState("");
  const [metrics, setMetrics] = useState<MetricCard[]>([
    { label: "ACCURACY", sublabel: "Hit rate", value: "—" },
    { label: "TIME", sublabel: "Median latency", value: "—" },
    { label: "COST", sublabel: "Average cost per thousand queries", value: "—" }
  ]);

  const fetchProjects = async () => {
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error && data) setProjects(data);
    setLoading(false);
  };

  const fetchMetrics = async () => {
    const { data, error } = await supabase
      .from("query_logs")
      .select("hit_rate_at_k, execution_time_ms, upstream_inference_cost")
      .not("execution_time_ms", "is", null);
    if (error || !data || data.length === 0) return;

    const hitRates = data.filter((d) => d.hit_rate_at_k !== null);
    const avgHitRate = hitRates.length > 0 ? hitRates.reduce((sum, d) => sum + (d.hit_rate_at_k || 0), 0) / hitRates.length : 0;

    const latencies = data.map((d) => d.execution_time_ms).filter((v): v is number => v !== null).sort((a, b) => a - b);
    const medianLatency = latencies.length > 0 ? latencies[Math.floor(latencies.length / 2)] : 0;

    const costs = data.filter((d) => d.upstream_inference_cost !== null);
    const avgCost = costs.length > 0 ? costs.reduce((sum, d) => sum + (d.upstream_inference_cost || 0), 0) / costs.length : 0;

    setMetrics([
      { label: "ACCURACY", sublabel: "Hit rate", value: `${(avgHitRate * 100).toFixed(1)}%` },
      { label: "TIME", sublabel: "Median latency", value: medianLatency >= 1000 ? `${(medianLatency / 1000).toFixed(1)} seconds` : `${medianLatency} ms` },
      { label: "COST", sublabel: "Average cost per thousand queries", value: `$${(avgCost * 1000).toFixed(2)}` }
    ]);
  };

  const fetchRoles = async () => {
    const { data } = await supabase.from("role_permissions").select("role, display_name").order("role");
    if (data) setAvailableRoles(data.map((r) => ({ role: r.role, displayName: r.display_name })));
  };

  useEffect(() => {
    fetchProjects();
    fetchMetrics();
    fetchRoles();
  }, []);

  const handleCreateProject = async () => {
    if (!newProjectName.trim() || !user) return;
    setCreating(true);
    try {
      const { data: project, error } = await supabase
        .from("projects")
        .insert({
          name: newProjectName.trim(),
          created_by: user.id,
          allowed_roles: selectedRoles.length > 0 ? selectedRoles : ["admin"]
        })
        .select()
        .single();
      if (error) throw error;

      if (metadataFields.length > 0 && project) {
        const { error: fieldsError } = await supabase
          .from("project_metadata_fields")
          .insert(metadataFields.map((field_name) => ({ project_id: project.id, field_name })));
        if (fieldsError) console.error("Error creating metadata fields:", fieldsError);
      }

      toast({ title: "Project created", description: `"${newProjectName}" has been created.` });
      setShowCreate(false);
      setNewProjectName("");
      setMetadataFields([]);
      setSelectedRoles(["admin"]);
      fetchProjects();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const addMetadataField = () => {
    if (!newFieldName.trim()) return;
    if (metadataFields.includes(newFieldName.trim())) {
      toast({ title: "Duplicate field", description: "This field already exists.", variant: "destructive" });
      return;
    }
    setMetadataFields([...metadataFields, newFieldName.trim()]);
    setNewFieldName("");
  };

  const addEditMetadataField = () => {
    if (!editNewFieldName.trim()) return;
    if (editMetadataFields.includes(editNewFieldName.trim())) {
      toast({ title: "Duplicate field", description: "This field already exists.", variant: "destructive" });
      return;
    }
    setEditMetadataFields([...editMetadataFields, editNewFieldName.trim()]);
    setEditNewFieldName("");
  };

  const filteredProjects = projects.filter((p) => {
    const q = search.toLowerCase();
    if (q && !p.name.toLowerCase().includes(q)) return false;
    if (filterRole && !p.allowed_roles.includes(filterRole) && !p.allowed_roles.includes("all")) return false;
    return true;
  });

  const handleDeleteProject = async () => {
    if (!deleteTarget) return;
    try {
      await supabase.from("project_metadata_fields").delete().eq("project_id", deleteTarget.id);
      const { data: docs } = await supabase.from("documents").select("id").eq("project_id", deleteTarget.id);
      if (docs) {
        for (const doc of docs) {
          await supabase.from("chunks").delete().eq("document_id", doc.id);
        }
        await supabase.from("documents").delete().eq("project_id", deleteTarget.id);
      }
      await supabase.from("projects").delete().eq("id", deleteTarget.id);
      toast({ title: "Project deleted", description: `"${deleteTarget.name}" removed.` });
      setDeleteTarget(null);
      if (expandedProjectId === deleteTarget.id) setExpandedProjectId(null);
      fetchProjects();
    } catch (e: any) {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    }
  };

  const openEdit = async (project: Project) => {
    setEditTarget(project);
    setEditName(project.name);
    setEditRoles(project.allowed_roles);
    // Fetch existing metadata fields
    const { data } = await supabase
      .from("project_metadata_fields")
      .select("field_name")
      .eq("project_id", project.id)
      .order("created_at");
    setEditMetadataFields(data?.map(f => f.field_name) || []);
    setEditNewFieldName("");
  };

  const handleEditSave = async () => {
    if (!editTarget) return;
    setIsSaving(true);
    try {
      await supabase.from("projects").update({
        name: editName.trim(),
        allowed_roles: editRoles.length > 0 ? editRoles : ["admin"],
      }).eq("id", editTarget.id);

      // Sync metadata fields: delete all and re-insert
      await supabase.from("project_metadata_fields").delete().eq("project_id", editTarget.id);
      if (editMetadataFields.length > 0) {
        await supabase.from("project_metadata_fields").insert(
          editMetadataFields.map(field_name => ({ project_id: editTarget.id, field_name }))
        );
      }

      toast({ title: "Project updated" });
      setEditTarget(null);
      fetchProjects();
    } catch (e: any) {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-popover">
      <Header />

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Metrics */}
        <div className="grid grid-cols-3 gap-4 mb-32">
          {metrics.map((m) =>
            <div key={m.label} className="rounded-2xl border border-border bg-card p-6 space-y-2">
              <p className="text-xs font-medium tracking-wider uppercase text-primary">{m.label}</p>
              <p className="text-2xl font-semibold text-foreground tracking-tight">{m.value}</p>
              <p className="text-xs text-muted-foreground">{m.sublabel}</p>
            </div>
          )}
        </div>

        {/* Search + Create */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search projects..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 pr-10 h-11 rounded-full border-border bg-background"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-5 h-11 rounded-full text-sm font-medium bg-foreground text-background hover:bg-foreground/90 transition-colors whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            Create project
          </button>
        </div>

        {/* Table */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">Projects</h2>
            <span className="text-sm text-muted-foreground">{filteredProjects.length} result{filteredProjects.length !== 1 ? "s" : ""}</span>
          </div>
          <Separator />
          <div className="divide-y divide-border mt-4">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                {search ? "No projects match your search." : "No projects yet. Create one to get started."}
              </div>
            ) : (
              filteredProjects.map((project) => {
                const isExpanded = expandedProjectId === project.id;
                return (
                  <div key={project.id}>
                    <div
                      className="py-5 flex items-start justify-between cursor-pointer hover:bg-muted/30 px-2 -mx-2 rounded-lg transition-colors min-h-[72px]"
                      onClick={() => setExpandedProjectId(isExpanded ? null : project.id)}
                      onDoubleClick={() => navigate(`/?project=${project.id}`)}
                    >
                      <div className="flex-1 min-w-0 pr-4">
                        <p className="text-sm font-semibold text-foreground flex items-center gap-2"><FolderOpen className="h-4 w-4 text-muted-foreground flex-shrink-0" />{project.name}</p>
                        <div className="flex flex-wrap gap-1.5 mt-2 min-h-[22px]">
                          {project.allowed_roles.map((role) => (
                            <span key={role} className="text-xs px-2.5 py-0.5 rounded-full border border-border text-foreground/70 bg-background capitalize">{role}</span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className="text-xs text-muted-foreground">{format(new Date(project.created_at), "MMM d, yyyy")}</span>
                        {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="mx-2 mb-4 border border-border rounded-xl p-5 bg-muted/20">
                        <div className="grid grid-cols-3 gap-6 mb-5">
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Created</p>
                            <p className="text-sm text-foreground">{format(new Date(project.created_at), "MMM d, yyyy")}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Access Roles</p>
                            <p className="text-sm text-foreground capitalize">{project.allowed_roles.includes("all") ? "All Roles" : project.allowed_roles.join(", ")}</p>
                          </div>
                        </div>
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={(e) => { e.stopPropagation(); openEdit(project); }} className="px-4 py-1.5 rounded-full text-sm border border-border bg-background hover:bg-muted/50 transition-colors text-foreground">Edit</button>
                          <button onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: project.id, name: project.name }); }} className="px-4 py-1.5 rounded-full text-sm border border-border bg-background hover:bg-muted/50 transition-colors text-foreground">Delete</button>
                          <button onClick={(e) => { e.stopPropagation(); navigate(`/?project=${project.id}`); }} className="px-4 py-1.5 rounded-full text-sm bg-foreground text-background hover:bg-foreground/90 transition-colors font-medium">Select</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </main>

      {/* Create Project Modal */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create New Project</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <Label>Project Name</Label>
              <Input placeholder="e.g. Industrial Batteries" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} />
            </div>

            <RoleMultiSelect
              selectedRoles={selectedRoles}
              availableRoles={availableRoles}
              onChange={setSelectedRoles}
            />

            <div className="space-y-2">
              <Label>Metadata Fields</Label>
              <p className="text-xs text-muted-foreground">Define the metadata fields that will appear on the Repository upload form for this project.</p>
              <div className="flex flex-wrap gap-2">
                {metadataFields.map((field) => (
                  <Badge key={field} variant="secondary" className="rounded-full gap-1.5 pr-1.5">
                    {field}
                    <button onClick={() => setMetadataFields(metadataFields.filter((f) => f !== field))}>
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. Equipment Type"
                  value={newFieldName}
                  onChange={(e) => setNewFieldName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addMetadataField())}
                  className="flex-1"
                />
                <Button type="button" variant="outline" size="sm" onClick={addMetadataField} className="shrink-0">
                  <Plus className="h-4 w-4" />
                  Add
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => setShowCreate(false)} className="px-4 py-1.5 rounded-full text-sm border border-border bg-background hover:bg-muted/50 transition-colors text-foreground">Cancel</button>
            <button
              onClick={handleCreateProject}
              disabled={!newProjectName.trim() || creating}
              className="px-4 py-1.5 rounded-full text-sm bg-foreground text-background hover:bg-foreground/90 transition-colors font-medium disabled:opacity-50"
            >
              {creating && <Loader2 className="h-4 w-4 animate-spin inline mr-1" />}
              Create Project
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Project Modal */}
      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Project</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <Label>Project Name</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>

            <RoleMultiSelect
              selectedRoles={editRoles}
              availableRoles={availableRoles}
              onChange={setEditRoles}
            />

            <div className="space-y-2">
              <Label>Metadata Fields</Label>
              <p className="text-xs text-muted-foreground">Define the metadata fields that will appear on the Repository upload form for this project.</p>
              <div className="flex flex-wrap gap-2">
                {editMetadataFields.map((field) => (
                  <Badge key={field} variant="secondary" className="rounded-full gap-1.5 pr-1.5">
                    {field}
                    <button onClick={() => setEditMetadataFields(editMetadataFields.filter((f) => f !== field))}>
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. Equipment Type"
                  value={editNewFieldName}
                  onChange={(e) => setEditNewFieldName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addEditMetadataField())}
                  className="flex-1"
                />
                <Button type="button" variant="outline" size="sm" onClick={addEditMetadataField} className="shrink-0">
                  <Plus className="h-4 w-4" />
                  Add
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => setEditTarget(null)} className="px-4 py-1.5 rounded-full text-sm border border-border bg-background hover:bg-muted/50 transition-colors text-foreground">Cancel</button>
            <button onClick={handleEditSave} disabled={!editName.trim() || isSaving} className="px-4 py-1.5 rounded-full text-sm bg-foreground text-background hover:bg-foreground/90 transition-colors font-medium disabled:opacity-50">
              {isSaving && <Loader2 className="h-4 w-4 animate-spin inline mr-1" />}
              Save
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Project</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{deleteTarget?.name}" and all its documents. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteProject} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Projects;
