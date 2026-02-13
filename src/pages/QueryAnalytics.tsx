import { Header } from "@/components/Header";
import { usePermissions } from "@/hooks/usePermissions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, BarChart3, Download, Loader2, Play, Shield } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface AnalyticsData {
  sample_size: number;
  latency: { p50: number; p95: number; p99: number; avg: number; min: number; max: number };
  tokens: { avg_input: number; avg_output: number; avg_total: number };
  cost: { avg: string; p95: string; total: string };
}

interface EvalResult {
  k: number;
  total_queries: number;
  avg_precision_at_k: number;
  avg_recall_at_k: number;
  results: Array<{
    query: string;
    precision_at_k: number;
    recall_at_k: number;
    retrieved_count: number;
    expected_count: number;
    relevant_found: number;
  }>;
}

const QueryAnalytics = () => {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const isAdmin = permissions.role === "admin";

  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  const callEvalFunction = async (action: string, params?: Record<string, string>) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { toast.error("Not authenticated"); return null; }

    const url = new URL(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/run-eval`);
    url.searchParams.set("action", action);
    if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
    });
    return res;
  };

  const fetchAnalytics = async () => {
    setLoading("analytics");
    try {
      const res = await callEvalFunction("analytics");
      if (!res) return;
      const data = await res.json();
      if (data.analytics) setAnalytics(data.analytics);
      else toast.error(data.error || "No data");
    } catch (e) {
      toast.error("Failed to fetch analytics");
    } finally {
      setLoading(null);
    }
  };

  const exportCSV = async () => {
    setLoading("export");
    try {
      const res = await callEvalFunction("export");
      if (!res) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "query_logs.csv";
      a.click();
      URL.revokeObjectURL(url);
      toast.success("CSV downloaded");
    } catch {
      toast.error("Export failed");
    } finally {
      setLoading(null);
    }
  };

  const runEval = async () => {
    setLoading("eval");
    try {
      const res = await callEvalFunction("run-eval", { k: "10" });
      if (!res) return;
      const data = await res.json();
      if (data.success) setEvalResult(data);
      else toast.error(data.error || "Eval failed");
    } catch {
      toast.error("Eval failed");
    } finally {
      setLoading(null);
    }
  };

  if (permissions.isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="mx-auto px-8 py-10 flex items-center justify-center" style={{ maxWidth: "1040px" }}>
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </main>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="mx-auto px-8 py-10 text-center" style={{ maxWidth: "1040px" }}>
          <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-foreground mb-2">Access Denied</h2>
          <Button onClick={() => navigate("/")} variant="outline"><ArrowLeft className="h-4 w-4 mr-2" />Go Back</Button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto px-8 py-10" style={{ maxWidth: "1040px" }}>
        <div className="flex items-center gap-4 mb-8">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
        </div>

        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground tracking-tight flex items-center gap-3">
            <BarChart3 className="h-6 w-6" />Query Analytics & Evaluation
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5">Latency percentiles, token usage, cost tracking, and retrieval evaluation.</p>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-3 mb-8">
          <Button onClick={fetchAnalytics} disabled={loading !== null}>
            {loading === "analytics" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <BarChart3 className="h-4 w-4 mr-2" />}
            Load Analytics
          </Button>
          <Button onClick={exportCSV} variant="outline" disabled={loading !== null}>
            {loading === "export" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            Export CSV
          </Button>
          <Button onClick={runEval} variant="outline" disabled={loading !== null}>
            {loading === "eval" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
            Run Eval (k=10)
          </Button>
        </div>

        {/* Analytics cards */}
        {analytics && (
          <div className="grid gap-6 md:grid-cols-3 mb-8">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Latency</CardTitle>
                <CardDescription>{analytics.sample_size} queries</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">p50</span><span className="font-mono font-medium">{analytics.latency.p50}ms</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">p95</span><span className="font-mono font-medium">{analytics.latency.p95}ms</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">p99</span><span className="font-mono font-medium">{analytics.latency.p99}ms</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">avg</span><span className="font-mono font-medium">{analytics.latency.avg}ms</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">min / max</span><span className="font-mono font-medium">{analytics.latency.min} / {analytics.latency.max}ms</span></div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Tokens</CardTitle>
                <CardDescription>Average per query</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Input</span><span className="font-mono font-medium">{analytics.tokens.avg_input}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Output</span><span className="font-mono font-medium">{analytics.tokens.avg_output}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="font-mono font-medium">{analytics.tokens.avg_total}</span></div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Cost</CardTitle>
                <CardDescription>Upstream inference</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Avg</span><span className="font-mono font-medium">${analytics.cost.avg}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">p95</span><span className="font-mono font-medium">${analytics.cost.p95}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="font-mono font-medium">${analytics.cost.total}</span></div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Eval results */}
        {evalResult && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Evaluation Results (k={evalResult.k})</CardTitle>
              <CardDescription>{evalResult.total_queries} queries evaluated</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-8 mb-6">
                <div>
                  <p className="text-sm text-muted-foreground">Avg Precision@{evalResult.k}</p>
                  <p className="text-2xl font-mono font-semibold text-foreground">{(evalResult.avg_precision_at_k * 100).toFixed(1)}%</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Avg Recall@{evalResult.k}</p>
                  <p className="text-2xl font-mono font-semibold text-foreground">{(evalResult.avg_recall_at_k * 100).toFixed(1)}%</p>
                </div>
              </div>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-3 font-medium text-muted-foreground">Query</th>
                      <th className="text-right p-3 font-medium text-muted-foreground">Precision</th>
                      <th className="text-right p-3 font-medium text-muted-foreground">Recall</th>
                      <th className="text-right p-3 font-medium text-muted-foreground">Found</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evalResult.results.map((r, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-3 max-w-xs truncate">{r.query}</td>
                        <td className="p-3 text-right font-mono">{(r.precision_at_k * 100).toFixed(1)}%</td>
                        <td className="p-3 text-right font-mono">{(r.recall_at_k * 100).toFixed(1)}%</td>
                        <td className="p-3 text-right font-mono">{r.relevant_found}/{r.expected_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* SQL Reference */}
        <Card className="mt-8">
          <CardHeader>
            <CardTitle className="text-base">SQL Reference Queries</CardTitle>
            <CardDescription>Run these manually to recompute metrics</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted/50 p-4 rounded-lg text-xs font-mono overflow-x-auto whitespace-pre-wrap text-foreground">{`-- Latency percentiles
SELECT
  COUNT(*) AS sample_size,
  PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY execution_time_ms) AS p50,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY execution_time_ms) AS p95,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY execution_time_ms) AS p99,
  AVG(execution_time_ms)::int AS avg_ms,
  MIN(execution_time_ms) AS min_ms,
  MAX(execution_time_ms) AS max_ms
FROM query_logs;

-- Token averages
SELECT
  AVG(input_tokens)::int AS avg_input,
  AVG(output_tokens)::int AS avg_output,
  AVG(total_tokens)::int AS avg_total
FROM query_logs;

-- Cost analytics
SELECT
  AVG(upstream_inference_cost) AS avg_cost,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY upstream_inference_cost) AS p95_cost,
  SUM(upstream_inference_cost) AS total_cost
FROM query_logs;`}</pre>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default QueryAnalytics;
