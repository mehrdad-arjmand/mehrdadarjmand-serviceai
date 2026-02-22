import { useState, useEffect } from "react";
import { Header } from "@/components/Header";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, Search, X, Loader2, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";

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
  const [availableRoles, setAvailableRoles] = useState<string[]>([]);
  const [metrics, setMetrics] = useState<MetricCard[]>([
    { label: "ACCURACY", sublabel: "Hit rate", value: "—" },
    { label: "TIME", sublabel: "Median latency", value: "—" },
    { label: "COST", sublabel: "Average cost per query", value: "—" },
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

    // Hit rate
    const hitRates = data.filter((d) => d.hit_rate_at_k !== null);
    const avgHitRate = hitRates.length > 0
      ? hitRates.reduce((sum, d) => sum + (d.hit_rate_at_k || 0), 0) / hitRates.length
      : 0;

    // Median latency
    const latencies = data
      .map((d) => d.execution_time_ms)
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);
    const medianLatency = latencies.length > 0
      ? latencies[Math.floor(latencies.length / 2)]
      : 0;

    // Avg cost
    const costs = data.filter((d) => d.upstream_inference_cost !== null);
    const avgCost = costs.length > 0
      ? costs.reduce((sum, d) => sum + (d.upstream_inference_cost || 0), 0) / costs.length
      : 0;

    setMetrics([
      {
        label: "ACCURACY",
        sublabel: "Hit rate",
        value: `${(avgHitRate * 100).toFixed(1)}%`,
      },
      {
        label: "TIME",
        sublabel: "Median latency",
        value: medianLatency >= 1000
          ? `${(medianLatency / 1000).toFixed(1)} seconds`
          : `${medianLatency} ms`,
      },
      {
        label: "COST",
        sublabel: "Average cost per query",
        value: `$${avgCost.toFixed(6)}`,
      },
    ]);
  };

  const fetchRoles = async () => {
    const { data } = await supabase
      .from("role_permissions")
      .select("role")
      .order("role");
    if (data) setAvailableRoles(data.map((r) => r.role));
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
          allowed_roles: selectedRoles.length > 0 ? selectedRoles : ["admin"],
        })
        .select()
        .single();

      if (error) throw error;

      // Insert metadata fields
      if (metadataFields.length > 0 && project) {
        const { error: fieldsError } = await supabase
          .from("project_metadata_fields")
          .insert(
            metadataFields.map((field_name) => ({
              project_id: project.id,
              field_name,
            }))
          );
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

  const toggleRole = (role: string) => {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  };

  const filteredProjects = projects.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-10">
        {/* Metrics */}
        <div className="grid grid-cols-3 gap-4">
          {metrics.map((m) => (
            <div
              key={m.label}
              className="rounded-2xl border border-border bg-card p-6 space-y-2"
            >
              <p className="text-xs font-medium text-brand tracking-wider uppercase">
                {m.label}
              </p>
              <p className="text-2xl font-semibold text-foreground tracking-tight">
                {m.value}
              </p>
              <p className="text-xs text-muted-foreground">{m.sublabel}</p>
            </div>
          ))}
        </div>

        {/* Projects section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Projects</h2>
              <p className="text-sm text-muted-foreground">
                Isolated workspaces, independent repositories.
              </p>
            </div>
            <Button
              onClick={() => setShowCreate(true)}
              className="rounded-full bg-foreground text-background hover:bg-foreground/90 gap-2"
            >
              <Plus className="h-4 w-4" />
              Create project
            </Button>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search projects..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 rounded-xl border-border"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            )}
          </div>

          {/* Table header */}
          <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
            <span className="font-medium">All projects</span>
            <span>Double-click a row to open</span>
          </div>

          {/* Project rows */}
          <div className="border border-border rounded-2xl overflow-hidden bg-card divide-y divide-border">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                {search ? "No projects match your search." : "No projects yet. Create one to get started."}
              </div>
            ) : (
              filteredProjects.map((project) => (
                <div
                  key={project.id}
                  className="flex items-center justify-between px-5 py-4 hover:bg-muted/30 cursor-pointer transition-colors"
                  onDoubleClick={() => navigate(`/?project=${project.id}`)}
                >
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">
                      {project.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Created {format(new Date(project.created_at), "MMM d, yyyy")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {project.allowed_roles.map((role) => (
                      <Badge
                        key={role}
                        variant="outline"
                        className="rounded-full text-xs font-normal capitalize"
                      >
                        {role}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))
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
            {/* Project name */}
            <div className="space-y-2">
              <Label>Project Name</Label>
              <Input
                placeholder="e.g. Industrial Batteries"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
              />
            </div>

            {/* Role access */}
            <div className="space-y-2">
              <Label>Roles with Access</Label>
              <div className="flex flex-wrap gap-2">
                {availableRoles.map((role) => (
                  <button
                    key={role}
                    onClick={() => toggleRole(role)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors capitalize ${
                      selectedRoles.includes(role)
                        ? "bg-foreground text-background border-foreground"
                        : "bg-card text-muted-foreground border-border hover:border-foreground/30"
                    }`}
                  >
                    {role}
                  </button>
                ))}
              </div>
            </div>

            {/* Metadata fields */}
            <div className="space-y-2">
              <Label>Metadata Fields</Label>
              <p className="text-xs text-muted-foreground">
                Define the metadata structure for documents in this project.
              </p>
              <div className="flex flex-wrap gap-2">
                {metadataFields.map((field) => (
                  <Badge
                    key={field}
                    variant="secondary"
                    className="rounded-full gap-1.5 pr-1.5"
                  >
                    {field}
                    <button
                      onClick={() =>
                        setMetadataFields(metadataFields.filter((f) => f !== field))
                      }
                    >
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
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addMetadataField}
                  className="shrink-0"
                >
                  <Plus className="h-4 w-4" />
                  Add
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateProject}
              disabled={!newProjectName.trim() || creating}
              className="bg-foreground text-background hover:bg-foreground/90"
            >
              {creating && <Loader2 className="h-4 w-4 animate-spin" />}
              Create Project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Projects;
