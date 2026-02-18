import { Header } from "@/components/Header";
import { usePermissions } from "@/hooks/usePermissions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, BarChart3, Download, Loader2, Play, Shield, Target, History } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface AnalyticsData {
  sample_size: number;
  latency: { p50: number; p95: number; p99: number; avg: number; min: number; max: number };
  tokens: { avg_input: number; avg_output: number; avg_total: number };
  cost: { avg: string; p95: string; total: string };
  retrieval_eval: {
    evaluated_count: number;
    avg_precision_at_k: number;
    avg_recall_at_k: number;
    avg_hit_rate: number;
    mrr: number;
  } | null;
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

interface RetrievalEvalResult {
  evaluated: number;
  eval_model: string;
  k_used: string;
  ranking_confirmed: string;
  aggregate: {
    avg_precision_at_k: number;
    avg_recall_at_k: number;
    avg_hit_rate_at_k: number;
    mrr: number;
  };
  per_query: Array<{
    query_log_id: string;
    query: string;
    k: number;
    total_relevant: number;
    precision_at_k: number;
    recall_at_k: number;
    hit_rate: number;
    first_relevant_rank: number | null;
  }>;
}

interface EvalRun {
  id: string;
  created_at: string;
  total_queries: number;
  avg_precision_at_k: number;
  avg_recall_at_k: number;
  avg_hit_rate_at_k: number;
  mrr: number;
  eval_model: string;
  k_used: string;
  notes: string | null;
}

const QueryAnalytics = () => {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const isAdmin = permissions.role === "admin";

  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);
  const [retrievalEval, setRetrievalEval] = useState<RetrievalEvalResult | null>(null);
  const [evalRuns, setEvalRuns] = useState<EvalRun[]>([]);
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
    } catch {
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

  const runRetrievalEval = async () => {
    setLoading("retrieval-eval");
    try {
      const res = await callEvalFunction("run-retrieval-eval", { limit: "50" });
      if (!res) return;
      const data = await res.json();
      if (data.success) {
        setRetrievalEval(data);
        if (data.evaluated > 0) toast.success(`Evaluated ${data.evaluated} queries`);
        else toast.info(data.message || "No queries to evaluate");
      } else {
        toast.error(data.error || "Retrieval eval failed");
      }
    } catch {
      toast.error("Retrieval eval failed");
    } finally {
      setLoading(null);
    }
  };

  const fetchEvalRuns = async () => {
    setLoading("eval-runs");
    try {
      const res = await callEvalFunction("eval-runs");
      if (!res) return;
      const data = await res.json();
      if (data.success) setEvalRuns(data.runs);
    } catch {
      toast.error("Failed to fetch eval runs");
    } finally {
      setLoading(null);
    }
  };

  if (permissions.isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="px-6 lg:px-10 py-10 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </main>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="px-6 lg:px-10 py-10 text-center">
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
      <main className="px-6 lg:px-10 py-8">
        <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="text-muted-foreground hover:text-foreground mb-6 -ml-2">
          <ArrowLeft className="h-4 w-4 mr-2" />Back
        </Button>

        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground tracking-tight flex items-center gap-3">
            <BarChart3 className="h-6 w-6" />Query Analytics & Evaluation
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5">Latency, tokens, cost, and retrieval quality evaluation.</p>
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
            Ground-Truth Eval
          </Button>
          <Button onClick={runRetrievalEval} variant="outline" disabled={loading !== null}>
            {loading === "retrieval-eval" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Target className="h-4 w-4 mr-2" />}
            LLM Retrieval Eval
          </Button>
          <Button onClick={fetchEvalRuns} variant="outline" disabled={loading !== null}>
            {loading === "eval-runs" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <History className="h-4 w-4 mr-2" />}
            Eval History
          </Button>
        </div>

        {/* Analytics cards */}
        {analytics && (
          <div className={`grid gap-6 mb-8 ${analytics.retrieval_eval ? 'md:grid-cols-2 lg:grid-cols-4' : 'md:grid-cols-3'}`}>
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

            {analytics.retrieval_eval && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Retrieval Quality</CardTitle>
                  <CardDescription>{analytics.retrieval_eval.evaluated_count} evaluated</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Precision@K</span><span className="font-mono font-medium">{(analytics.retrieval_eval.avg_precision_at_k * 100).toFixed(1)}%</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Recall@K</span><span className="font-mono font-medium">{(analytics.retrieval_eval.avg_recall_at_k * 100).toFixed(1)}%</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Hit Rate</span><span className="font-mono font-medium">{(analytics.retrieval_eval.avg_hit_rate * 100).toFixed(1)}%</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">MRR</span><span className="font-mono font-medium">{analytics.retrieval_eval.mrr.toFixed(4)}</span></div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* LLM Retrieval Eval Results */}
        {retrievalEval && retrievalEval.evaluated > 0 && (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="h-4 w-4" />LLM Retrieval Evaluation
              </CardTitle>
              <CardDescription>
                {retrievalEval.evaluated} queries • Model: {retrievalEval.eval_model} • K: {retrievalEval.k_used}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-8 mb-6">
                <div>
                  <p className="text-sm text-muted-foreground">Avg Precision@K</p>
                  <p className="text-2xl font-mono font-semibold text-foreground">{(retrievalEval.aggregate.avg_precision_at_k * 100).toFixed(1)}%</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Avg Recall@K</p>
                  <p className="text-2xl font-mono font-semibold text-foreground">{(retrievalEval.aggregate.avg_recall_at_k * 100).toFixed(1)}%</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Hit Rate@K</p>
                  <p className="text-2xl font-mono font-semibold text-foreground">{(retrievalEval.aggregate.avg_hit_rate_at_k * 100).toFixed(1)}%</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">MRR</p>
                  <p className="text-2xl font-mono font-semibold text-foreground">{retrievalEval.aggregate.mrr.toFixed(4)}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Ranking: {retrievalEval.ranking_confirmed}
              </p>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-3 font-medium text-muted-foreground">Query</th>
                      <th className="text-right p-3 font-medium text-muted-foreground">K</th>
                      <th className="text-right p-3 font-medium text-muted-foreground">Prec</th>
                      <th className="text-right p-3 font-medium text-muted-foreground">Recall</th>
                      <th className="text-right p-3 font-medium text-muted-foreground">Hit</th>
                      <th className="text-right p-3 font-medium text-muted-foreground">1st Rel</th>
                    </tr>
                  </thead>
                  <tbody>
                    {retrievalEval.per_query.map((r, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-3 max-w-xs truncate">{r.query}</td>
                        <td className="p-3 text-right font-mono">{r.k}</td>
                        <td className="p-3 text-right font-mono">{(r.precision_at_k * 100).toFixed(1)}%</td>
                        <td className="p-3 text-right font-mono">{(r.recall_at_k * 100).toFixed(1)}%</td>
                        <td className="p-3 text-right font-mono">{r.hit_rate ? '✓' : '✗'}</td>
                        <td className="p-3 text-right font-mono">{r.first_relevant_rank ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Ground-truth Eval results */}
        {evalResult && (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="text-base">Ground-Truth Evaluation (k={evalResult.k})</CardTitle>
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

        {/* Eval Run History */}
        {evalRuns.length > 0 && (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <History className="h-4 w-4" />Evaluation History
              </CardTitle>
              <CardDescription>Past LLM retrieval evaluation runs</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-3 font-medium text-muted-foreground">Date</th>
                      <th className="text-right p-3 font-medium text-muted-foreground">Queries</th>
                      <th className="text-right p-3 font-medium text-muted-foreground">Prec@K</th>
                      <th className="text-right p-3 font-medium text-muted-foreground">Recall@K</th>
                      <th className="text-right p-3 font-medium text-muted-foreground">Hit Rate</th>
                      <th className="text-right p-3 font-medium text-muted-foreground">MRR</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Model</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evalRuns.map((run) => (
                      <tr key={run.id} className="border-t">
                        <td className="p-3 text-muted-foreground">{new Date(run.created_at).toLocaleDateString()}</td>
                        <td className="p-3 text-right font-mono">{run.total_queries}</td>
                        <td className="p-3 text-right font-mono">{(run.avg_precision_at_k * 100).toFixed(1)}%</td>
                        <td className="p-3 text-right font-mono">{(run.avg_recall_at_k * 100).toFixed(1)}%</td>
                        <td className="p-3 text-right font-mono">{(run.avg_hit_rate_at_k * 100).toFixed(1)}%</td>
                        <td className="p-3 text-right font-mono">{run.mrr.toFixed(4)}</td>
                        <td className="p-3 text-muted-foreground text-xs">{run.eval_model}</td>
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

-- Retrieval quality (evaluated queries only)
SELECT
  COUNT(*) AS evaluated_queries,
  AVG(precision_at_k) AS avg_precision,
  AVG(recall_at_k) AS avg_recall,
  AVG(hit_rate_at_k) AS avg_hit_rate,
  AVG(CASE WHEN first_relevant_rank IS NOT NULL
    THEN 1.0 / first_relevant_rank ELSE 0 END) AS mrr
FROM query_logs
WHERE evaluated_at IS NOT NULL;`}</pre>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default QueryAnalytics;
