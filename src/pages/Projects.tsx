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
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/hooks/usePermissions";

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

interface UserOption {
  user_id: string;
  email: string;
  role: string | null;
}

// ─── Role Multi-Select ────────────────────────────────────────────────────────
const RoleMultiSelect = ({
  selectedRoles,
  availableRoles,
  onChange,
  label = "Access Role",
  disabledRoles = [],
}: {
  selectedRoles: string[];
  availableRoles: RoleOption[];
  onChange: (roles: string[]) => void;
  label?: string;
  disabledRoles?: string[];
}) => {
  const [open, setOpen] = useState(false);

  const toggle = (role: string) => {
    if (disabledRoles.includes(role)) return;
    if (role === "all") {
      onChange(selectedRoles.includes("all") ? disabledRoles : ["all"]);
    } else {
      let next = selectedRoles.filter((r) => r !== "all");
      if (next.includes(role)) {
        if (disabledRoles.includes(role)) return;
        next = next.filter((r) => r !== role);
      } else {
        next = [...next, role];
      }
      if (next.length === availableRoles.length) onChange(["all"]);
      else onChange(next);
    }
  };

  const displayLabel = selectedRoles.includes("all")
    ? "All"
    : selectedRoles.length === 0
      ? "Select roles"
      : selectedRoles.length === 1
        ? availableRoles.find((r) => r.role === selectedRoles[0])?.displayName || selectedRoles[0]
        : `${selectedRoles.length} roles`;

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className="w-full flex items-center justify-between h-10 border border-border rounded-lg px-3 text-sm bg-background hover:bg-muted/40 transition-colors text-left">
            <span className={selectedRoles.length > 0 ? "text-foreground capitalize" : "text-muted-foreground"}>
              {displayLabel}
            </span>
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
                {availableRoles.map((role) => (
                  <CommandItem
                    key={role.role}
                    onSelect={() => toggle(role.role)}
                    className={cn("text-sm capitalize", disabledRoles.includes(role.role) && "opacity-60")}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-3.5 w-3.5",
                        selectedRoles.includes(role.role) || selectedRoles.includes("all") ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {role.displayName || role.role}
                    {disabledRoles.includes(role.role) && <span className="ml-auto text-xs text-muted-foreground">(required)</span>}
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

// ─── User Multi-Select per Role ───────────────────────────────────────────────
const UserMultiSelect = ({
  selectedUserIds,
  allUsers,
  selectedRoles,
  onChange,
  currentUserId,
}: {
  selectedUserIds: string[];
  allUsers: UserOption[];
  selectedRoles: string[];
  onChange: (userIds: string[]) => void;
  currentUserId: string;
}) => {
  const [open, setOpen] = useState(false);

  // Filter users whose role is in selectedRoles (or all users if "all" is selected)
  const eligibleUsers = selectedRoles.includes("all")
    ? allUsers
    : allUsers.filter((u) => u.role && selectedRoles.includes(u.role));

  // Group users by role
  const usersByRole = new Map<string, UserOption[]>();
  eligibleUsers.forEach((u) => {
    const role = u.role || "unassigned";
    if (!usersByRole.has(role)) usersByRole.set(role, []);
    usersByRole.get(role)!.push(u);
  });

  const isAllSelected = selectedUserIds.includes("all");

  const toggleAll = () => {
    if (isAllSelected) {
      // Keep current user
      onChange([currentUserId]);
    } else {
      onChange(["all"]);
    }
  };

  const toggleUser = (userId: string) => {
    if (userId === currentUserId) return; // Can't deselect self
    let next = selectedUserIds.filter((id) => id !== "all");
    if (next.includes(userId)) {
      next = next.filter((id) => id !== userId);
    } else {
      next = [...next, userId];
    }
    // Check if all eligible users are selected
    if (next.length >= eligibleUsers.length && eligibleUsers.every((u) => next.includes(u.user_id))) {
      onChange(["all"]);
    } else {
      onChange(next);
    }
  };

  const selectedCount = isAllSelected ? eligibleUsers.length : selectedUserIds.filter((id) => id !== "all").length;
  const displayLabel = isAllSelected
    ? "All users"
    : selectedCount === 0
      ? "Select users"
      : `${selectedCount} user${selectedCount !== 1 ? "s" : ""}`;

  if (eligibleUsers.length === 0) return null;

  return (
    <div className="space-y-2">
      <Label>Access Users</Label>
      <p className="text-xs text-muted-foreground">
        Select specific users within the chosen roles. Your own access is always included.
      </p>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className="w-full flex items-center justify-between h-10 border border-border rounded-lg px-3 text-sm bg-background hover:bg-muted/40 transition-colors text-left">
            <span className={selectedCount > 0 ? "text-foreground" : "text-muted-foreground"}>
              {displayLabel}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0 z-50 bg-background border border-border shadow-lg max-h-64 overflow-y-auto" align="start">
          <Command>
            <CommandList>
              <CommandGroup>
                <CommandItem onSelect={toggleAll} className="text-sm font-medium">
                  <Check className={cn("mr-2 h-3.5 w-3.5", isAllSelected ? "opacity-100" : "opacity-0")} />
                  All
                </CommandItem>
                <Separator className="my-1" />
                {Array.from(usersByRole.entries()).map(([role, users]) => (
                  <div key={role}>
                    <div className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      {role}
                    </div>
                    {users.map((u) => {
                      const isSelf = u.user_id === currentUserId;
                      const isSelected = isAllSelected || selectedUserIds.includes(u.user_id);
                      return (
                        <CommandItem
                          key={u.user_id}
                          onSelect={() => toggleUser(u.user_id)}
                          className={cn("text-sm pl-4", isSelf && "opacity-70")}
                        >
                          <Check className={cn("mr-2 h-3.5 w-3.5", isSelected ? "opacity-100" : "opacity-0")} />
                          <span className="truncate">{u.email}</span>
                          {isSelf && <span className="ml-auto text-xs text-muted-foreground">(you)</span>}
                        </CommandItem>
                      );
                    })}
                  </div>
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
  const permissions = usePermissions();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [metadataFields, setMetadataFields] = useState<string[]>([]);
  const [newFieldName, setNewFieldName] = useState("");
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>(["all"]);
  const [availableRoles, setAvailableRoles] = useState<RoleOption[]>([]);
  const [allUsers, setAllUsers] = useState<UserOption[]>([]);
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [editTarget, setEditTarget] = useState<Project | null>(null);
  const [editName, setEditName] = useState("");
  const [editRoles, setEditRoles] = useState<string[]>([]);
  const [editUserIds, setEditUserIds] = useState<string[]>(["all"]);
  const [editMetadataFields, setEditMetadataFields] = useState<string[]>([]);
  const [editNewFieldName, setEditNewFieldName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [filterRole, setFilterRole] = useState("");
  const [projectMetadataFields, setProjectMetadataFields] = useState<Record<string, string[]>>({});
  const [metrics, setMetrics] = useState<MetricCard[]>([
    { label: "QUALITY", sublabel: "Hit rate", value: "—" },
    { label: "TIME", sublabel: "Median latency", value: "—" },
    { label: "COST", sublabel: "Average cost per thousand queries", value: "—" },
  ]);

  // Get current user's role
  const currentUserRole = permissions.role;

  const fetchProjects = async () => {
    const { data, error } = await supabase.from("projects").select("*").order("created_at", { ascending: false });
    if (!error && data) {
      setProjects(data);
      // Fetch metadata fields for all projects
      const { data: fields } = await supabase
        .from("project_metadata_fields")
        .select("project_id, field_name")
        .in("project_id", data.map((p) => p.id));
      if (fields) {
        const map: Record<string, string[]> = {};
        fields.forEach((f) => {
          if (!map[f.project_id]) map[f.project_id] = [];
          map[f.project_id].push(f.field_name);
        });
        setProjectMetadataFields(map);
      }
    }
    setLoading(false);
  };

  const fetchMetrics = async () => {
    const { data, error } = await supabase
      .from("query_logs")
      .select("hit_rate_at_k, execution_time_ms, upstream_inference_cost")
      .not("execution_time_ms", "is", null);
    if (error || !data || data.length === 0) return;

    const hitRates = data.filter((d) => d.hit_rate_at_k !== null);
    const avgHitRate =
      hitRates.length > 0 ? hitRates.reduce((sum, d) => sum + (d.hit_rate_at_k || 0), 0) / hitRates.length : 0;

    const latencies = data
      .map((d) => d.execution_time_ms)
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);
    const medianLatency = latencies.length > 0 ? latencies[Math.floor(latencies.length / 2)] : 0;

    const costs = data.filter((d) => d.upstream_inference_cost !== null);
    const avgCost =
      costs.length > 0 ? costs.reduce((sum, d) => sum + (d.upstream_inference_cost || 0), 0) / costs.length : 0;

    setMetrics([
      { label: "QUALITY", sublabel: "Hit rate", value: `${(avgHitRate * 100).toFixed(1)}%` },
      {
        label: "TIME",
        sublabel: "Median latency",
        value: medianLatency >= 1000 ? `${(medianLatency / 1000).toFixed(1)} seconds` : `${medianLatency} ms`,
      },
      { label: "COST", sublabel: "Average cost per thousand queries", value: `$${(avgCost * 1000).toFixed(2)}` },
    ]);
  };

  const fetchRoles = async () => {
    const { data } = await supabase.from("role_permissions").select("role, display_name").order("role");
    if (data) setAvailableRoles(data.map((r) => ({ role: r.role, displayName: r.display_name })));
  };

  const fetchUsers = async () => {
    const isAdmin = permissions.role === 'admin';
    if (isAdmin) {
      const { data } = await supabase.rpc('list_users_with_roles');
      if (data) setAllUsers(data.map((u) => ({ user_id: u.user_id, email: u.email, role: u.role })));
    } else if (permissions.landing.write) {
      // Non-admin with write access: fetch users by available roles
      const roleNames = availableRoles.map((r) => r.role);
      if (roleNames.length > 0) {
        const { data } = await supabase.rpc('list_users_by_roles', { p_roles: roleNames });
        if (data) setAllUsers(data.map((u: any) => ({ user_id: u.user_id, email: u.email, role: u.role })));
      }
    }
  };

  useEffect(() => {
    fetchProjects();
    fetchMetrics();
    fetchRoles();
  }, []);

  useEffect(() => {
    if (!permissions.isLoading) {
      fetchUsers();
      if (currentUserRole) {
        setSelectedRoles((prev) => prev.length === 0 ? [currentUserRole] : prev);
      }
    }
  }, [permissions.isLoading, currentUserRole, availableRoles]);

  const saveProjectUsers = async (projectId: string, userIds: string[]) => {
    // Delete existing
    const { error: delError } = await supabase.from("project_allowed_users").delete().eq("project_id", projectId);
    if (delError) console.error("Error deleting project users:", delError);
    // If "all" is selected or no specific users, don't add individual entries
    if (userIds.includes("all") || userIds.length === 0) return;
    // Insert specific users
    const rows = userIds.map((uid) => ({ project_id: projectId, user_id: uid }));
    const { error: insError } = await supabase.from("project_allowed_users").insert(rows);
    if (insError) console.error("Error inserting project users:", insError);
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim() || !user) return;
    setCreating(true);
    try {
      const rolesToSave = selectedRoles.length > 0 ? selectedRoles : (currentUserRole ? [currentUserRole] : ["admin"]);
      const { data: project, error } = await supabase
        .from("projects")
        .insert({
          name: newProjectName.trim(),
          created_by: user.id,
          allowed_roles: rolesToSave,
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

      // Save per-user access
      if (project && !selectedUserIds.includes("all")) {
        // Always include current user
        const userIdsToSave = [...new Set([user.id, ...selectedUserIds])];
        await saveProjectUsers(project.id, userIdsToSave);
      }

      toast({ title: "Project created", description: `"${newProjectName}" has been created.` });
      setShowCreate(false);
      setNewProjectName("");
      setMetadataFields([]);
      setSelectedRoles(currentUserRole ? [currentUserRole] : []);
      setSelectedUserIds(["all"]);
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
      await supabase.from("project_allowed_users").delete().eq("project_id", deleteTarget.id);
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
    setEditMetadataFields(data?.map((f) => f.field_name) || []);
    setEditNewFieldName("");
    // Fetch existing allowed users
    const { data: allowedUsers } = await supabase
      .from("project_allowed_users")
      .select("user_id")
      .eq("project_id", project.id);
    if (allowedUsers && allowedUsers.length > 0) {
      setEditUserIds(allowedUsers.map((u: any) => u.user_id));
    } else {
      setEditUserIds(["all"]);
    }
  };

  const handleEditSave = async () => {
    if (!editTarget) return;
    setIsSaving(true);
    try {
      const { error: updateError } = await supabase
        .from("projects")
        .update({
          name: editName.trim(),
          allowed_roles: editRoles.length > 0 ? editRoles : (currentUserRole ? [currentUserRole] : ["admin"]),
        })
        .eq("id", editTarget.id);
      if (updateError) throw updateError;

      // Sync metadata fields
      await supabase.from("project_metadata_fields").delete().eq("project_id", editTarget.id);
      if (editMetadataFields.length > 0) {
        await supabase
          .from("project_metadata_fields")
          .insert(editMetadataFields.map((field_name) => ({ project_id: editTarget.id, field_name })));
      }

      // Sync per-user access
      if (editUserIds.includes("all")) {
        await supabase.from("project_allowed_users").delete().eq("project_id", editTarget.id);
      } else if (user) {
        const userIdsToSave = [...new Set([user.id, ...editUserIds])];
        await saveProjectUsers(editTarget.id, userIdsToSave);
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

  // Current user's role is always required (can't deselect)
  const disabledRoles = currentUserRole ? [currentUserRole] : [];

  return (
    <div className="min-h-screen bg-popover">
      <Header />

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Metrics */}
        <div className="grid grid-cols-3 gap-4 mb-32">
          {metrics.map((m) => (
            <div key={m.label} className="rounded-2xl border border-border bg-card p-6 space-y-2">
              <p className="text-xs font-medium tracking-wider uppercase text-primary">{m.label}</p>
              <p className="text-2xl font-semibold text-foreground tracking-tight">{m.value}</p>
              <p className="text-xs text-muted-foreground">{m.sublabel}</p>
            </div>
          ))}
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
              <button
                onClick={() => setSearch("")}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <button
            onClick={() => {
              setSelectedRoles(currentUserRole ? [currentUserRole] : []);
              setSelectedUserIds(["all"]);
              setShowCreate(true);
            }}
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
            <span className="text-sm text-muted-foreground">
              {filteredProjects.length} result{filteredProjects.length !== 1 ? "s" : ""}
            </span>
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
                        <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                          <FolderOpen className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          {project.name}
                        </p>
                        <div className="flex flex-wrap gap-1.5 mt-2 min-h-[22px]">
                          {(projectMetadataFields[project.id] || []).map((field) => (
                            <span
                              key={field}
                              className="text-xs px-2.5 py-0.5 rounded-full border border-border text-foreground/70 bg-background"
                            >
                              {field}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(project.created_at), "MMM d, yyyy")}
                        </span>
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="pl-8 pr-8 pb-5">
                        <Separator className="mb-5 w-[calc(100%-1rem)]" />
                        <div className="grid grid-cols-3 gap-6 mb-5">
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                              Access Roles
                            </p>
                            <p className="text-sm text-foreground capitalize">
                              {project.allowed_roles.includes("all") ? "All Roles" : project.allowed_roles.join(", ")}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); openEdit(project); }}
                            className="px-4 py-1.5 rounded-full text-sm border border-border bg-background hover:bg-muted/50 transition-colors text-foreground"
                          >
                            Edit
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: project.id, name: project.name }); }}
                            className="px-4 py-1.5 rounded-full text-sm border border-border bg-background hover:bg-muted/50 transition-colors text-foreground"
                          >
                            Delete
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); navigate(`/?project=${project.id}`); }}
                            className="px-4 py-1.5 rounded-full text-sm bg-foreground text-background hover:bg-foreground/90 transition-colors font-medium"
                          >
                            Select
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
          {filteredProjects.length > 0 && <Separator />}
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
              <Input
                placeholder="e.g. Industrial Batteries"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
              />
            </div>

            <RoleMultiSelect
              selectedRoles={selectedRoles}
              availableRoles={availableRoles}
              onChange={setSelectedRoles}
              disabledRoles={disabledRoles}
            />

            {(permissions.role === 'admin' || permissions.landing.write) && (
              <UserMultiSelect
                selectedUserIds={selectedUserIds}
                allUsers={allUsers}
                selectedRoles={selectedRoles}
                onChange={setSelectedUserIds}
                currentUserId={user?.id || ''}
              />
            )}

            <div className="space-y-2">
              <Label>Metadata Fields</Label>
              <p className="text-xs text-muted-foreground">
                Define the metadata fields that will appear on the Repository upload form for this project.
              </p>
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
            <button
              onClick={() => setShowCreate(false)}
              className="px-4 py-1.5 rounded-full text-sm border border-border bg-background hover:bg-muted/50 transition-colors text-foreground"
            >
              Cancel
            </button>
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
              disabledRoles={disabledRoles}
            />

            {(permissions.role === 'admin' || permissions.landing.write) && (
              <UserMultiSelect
                selectedUserIds={editUserIds}
                allUsers={allUsers}
                selectedRoles={editRoles}
                onChange={setEditUserIds}
                currentUserId={user?.id || ''}
              />
            )}

            <div className="space-y-2">
              <Label>Metadata Fields</Label>
              <p className="text-xs text-muted-foreground">
                Define the metadata fields that will appear on the Repository upload form for this project.
              </p>
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
            <button
              onClick={() => setEditTarget(null)}
              className="px-4 py-1.5 rounded-full text-sm border border-border bg-background hover:bg-muted/50 transition-colors text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={handleEditSave}
              disabled={!editName.trim() || isSaving}
              className="px-4 py-1.5 rounded-full text-sm bg-foreground text-background hover:bg-foreground/90 transition-colors font-medium disabled:opacity-50"
            >
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
            <AlertDialogAction
              onClick={handleDeleteProject}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Projects;
