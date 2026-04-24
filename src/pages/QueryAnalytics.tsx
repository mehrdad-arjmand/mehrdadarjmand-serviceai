import { Header } from "@/components/Header";
import { usePermissions } from "@/hooks/usePermissions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, BarChart3, Download, Loader2, Play, Shield, Target, History, Copy, Check, Grid3X3 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface AnalyticsData {
  sample_size: number;
  latency: { p50: number; p95: number; p99: number; avg: number; min: number; max: number };
  tokens: { avg_input: number; avg_output: number; avg_total: number };
  cost: { avg: string; p95: string; total: string };
  retrieval_eval: {
    evaluated_count: number;
    total_queries: number;
    abstention_rate: number;
    avg_precision_at_k: number;
    avg_recall_at_k: number;
    avg_hit_rate: number;
    avg_f1: number;
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
  ranking_confirmed?: string;
  aggregate: {
    avg_precision_at_k: number;
    avg_recall_at_k: number;
    avg_hit_rate_at_k: number;
    mrr: number;
  };
  per_query: Array<{
    query_log_id: string;
    query: string;
    k?: number;
    top_k_eval?: number;
    total_relevant?: number;
    relevant_in_top_k?: number;
    precision_at_k: number;
    recall_at_k?: number;
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

interface ConfusionRow {
  query: string;
  top_k: number;
  top_k_eval: number;
  relevant_in_top_k: number;
  total_relevant_chunks: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
}

interface ConfusionMatrix {
  rows: ConfusionRow[];
  totals: { tp: number; fp: number; fn: number; tn: number; accuracy: number; precision: number; recall: number; f1: number };
}

const SQL_REFERENCE = `-- Latency percentiles
SELECT
  COUNT(*) AS sample_size,
  PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY execution_time_ms) AS p50,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY execution_time_ms) AS p95,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY execution_time_ms) AS p99,
  AVG(execution_time_ms)::int AS avg_ms,
  MIN(execution_time_ms) AS min_ms,
  MAX(execution_time_ms) AS max_ms
FROM query_logs;

-- Retrieval quality (non-zero precision queries only, excludes out-of-scope)
SELECT
  COUNT(*) FILTER (WHERE precision_at_k > 0) AS evaluated_nonzero,
  COUNT(*) AS evaluated_total,
  AVG(precision_at_k) FILTER (WHERE precision_at_k > 0) AS avg_precision,
  AVG(recall_at_k) FILTER (WHERE precision_at_k > 0) AS avg_recall,
  AVG(hit_rate_at_k) AS avg_hit_rate,
  AVG(CASE WHEN first_relevant_rank IS NOT NULL
    THEN 1.0 / first_relevant_rank ELSE 0 END) AS mrr
FROM query_logs
WHERE evaluated_at IS NOT NULL;`;

const QueryAnalytics = () => {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const isAdmin = permissions.role === "admin";

  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);
  const [retrievalEval, setRetrievalEval] = useState<RetrievalEvalResult | null>(null);
  const [evalRuns, setEvalRuns] = useState<EvalRun[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [sqlCopied, setSqlCopied] = useState(false);
  const [confusionMatrix, setConfusionMatrix] = useState<ConfusionMatrix | null>(null);

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

  const fetchConfusionMatrix = async () => {
    try {
      const { data: logs, error } = await supabase
        .from('query_logs')
        .select('query_text, top_k, top_k_eval, relevant_in_top_k, total_relevant_chunks, first_relevant_rank')
        .not('evaluated_at', 'is', null)
        .not('total_relevant_chunks', 'is', null)
        .not('first_relevant_rank', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1000);
      
      if (error || !logs || logs.length === 0) return;

      const rows: ConfusionRow[] = logs.map(l => {
        const tp = l.relevant_in_top_k ?? 0;
        const fp = (l.top_k ?? 0) - tp;
        const fn = (l.total_relevant_chunks ?? 0) - tp;
        const tn = Math.max(0, (l.top_k_eval ?? 0) - (l.top_k ?? 0) - fn);
        const total = tp + fp + fn + tn;
        const precision = (tp + fp) > 0 ? tp / (tp + fp) : 0;
        const recall = (tp + fn) > 0 ? tp / (tp + fn) : 0;
        const f1 = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0;
        return {
          query: l.query_text?.slice(0, 80) || '',
          top_k: l.top_k ?? 0,
          top_k_eval: l.top_k_eval ?? 0,
          relevant_in_top_k: tp,
          total_relevant_chunks: l.total_relevant_chunks ?? 0,
          tp, fp, fn, tn,
          accuracy: total > 0 ? (tp + tn) / total : 0,
          precision,
          recall,
          f1,
        };
      });

      const sumTp = rows.reduce((s, r) => s + r.tp, 0);
      const sumFp = rows.reduce((s, r) => s + r.fp, 0);
      const sumFn = rows.reduce((s, r) => s + r.fn, 0);
      const sumTn = rows.reduce((s, r) => s + r.tn, 0);
      const totalAll = sumTp + sumFp + sumFn + sumTn;
      // Macro-F1: average of per-query F1 (consistent with per-query precision/recall averaging)
      const macroF1 = rows.length > 0 ? rows.reduce((s, r) => s + r.f1, 0) / rows.length : 0;

      setConfusionMatrix({
        rows,
        totals: {
          tp: sumTp, fp: sumFp, fn: sumFn, tn: sumTn,
          accuracy: totalAll > 0 ? (sumTp + sumTn) / totalAll : 0,
          precision: (sumTp + sumFp) > 0 ? sumTp / (sumTp + sumFp) : 0,
          recall: (sumTp + sumFn) > 0 ? sumTp / (sumTp + sumFn) : 0,
          f1: macroF1,
        },
      });
    } catch {
      console.error('Failed to compute confusion matrix');
    }
  };

  useEffect(() => {
    if (isAdmin) {
      fetchAnalytics();
      fetchConfusionMatrix();
    }
  }, [isAdmin]);

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

  const handleCopySQL = async () => {
    await navigator.clipboard.writeText(SQL_REFERENCE);
    setSqlCopied(true);
    toast.success("SQL copied to clipboard");
    setTimeout(() => setSqlCopied(false), 2000);
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

        {/* Title row with Export CSV */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-foreground tracking-tight flex items-center gap-3">
              <BarChart3 className="h-6 w-6" />Query Analytics & Evaluation
            </h1>
            <p className="text-sm text-muted-foreground mt-1.5">Latency, tokens, cost, and retrieval quality evaluation.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={handleCopySQL} variant="ghost" size="sm" className="text-muted-foreground" disabled={loading !== null}>
              {sqlCopied ? <Check className="h-4 w-4 mr-1.5" /> : <Copy className="h-4 w-4 mr-1.5" />}
              {sqlCopied ? "Copied" : "SQL"}
            </Button>
            <Button onClick={exportCSV} variant="outline" size="sm" disabled={loading !== null}>
              {loading === "export" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
              Export CSV
            </Button>
          </div>
        </div>

        {/* Analytics cards */}
        {loading === "analytics" && !analytics && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {analytics && (
          <div className={`grid gap-6 mb-8 ${analytics.retrieval_eval ? 'md:grid-cols-2 lg:grid-cols-4' : 'md:grid-cols-3'}`}>
            <Card className="border border-border/60 shadow-sm">
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

            <Card className="border border-border/60 shadow-sm">
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

            <Card className="border border-border/60 shadow-sm">
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
              <Card className="border border-border/60 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Retrieval Quality</CardTitle>
                  <CardDescription>
                    {analytics.retrieval_eval.evaluated_count} queries with relevant results
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Precision@K</span><span className="font-mono font-medium">{(analytics.retrieval_eval.avg_precision_at_k * 100).toFixed(1)}%</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Recall@K</span><span className="font-mono font-medium">{(analytics.retrieval_eval.avg_recall_at_k * 100).toFixed(1)}%</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Abstention</span><span className="font-mono font-medium">{(analytics.retrieval_eval.abstention_rate * 100).toFixed(1)}%</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">MRR</span><span className="font-mono font-medium">{analytics.retrieval_eval.mrr.toFixed(4)}</span></div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* LLM Retrieval Eval Results */}
        {retrievalEval && retrievalEval.evaluated > 0 && (
          <Card className="mb-8 border border-border/60 shadow-sm">
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
                      <th className="text-right p-3 font-medium text-muted-foreground">Top K</th>
                      <th className="text-right p-3 font-medium text-muted-foreground">Top K Eval</th>
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
                        <td className="p-3 text-right font-mono">{r.top_k_eval ?? '—'}</td>
                        <td className="p-3 text-right font-mono">{(r.precision_at_k * 100).toFixed(1)}%</td>
                        <td className="p-3 text-right font-mono">{((r.recall_at_k ?? 0) * 100).toFixed(1)}%</td>
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
          <Card className="mb-8 border border-border/60 shadow-sm">
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
          <Card className="mb-8 border border-border/60 shadow-sm">
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

        {/* Confusion Matrix */}
        {confusionMatrix && confusionMatrix.rows.length > 0 && (
          <Card className="mb-8 border border-border/60 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Grid3X3 className="h-4 w-4" />Confusion Matrix
              </CardTitle>
              <CardDescription>
                {confusionMatrix.rows.length} evaluated queries
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Aggregate KPIs */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                <div className="bg-muted/30 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-0.5">Accuracy</p>
                  <p className="text-xl font-mono font-semibold text-foreground">{(confusionMatrix.totals.accuracy * 100).toFixed(1)}%</p>
                </div>
                <div className="bg-muted/30 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-0.5">Precision</p>
                  <p className="text-xl font-mono font-semibold text-foreground">{(confusionMatrix.totals.precision * 100).toFixed(1)}%</p>
                </div>
                <div className="bg-muted/30 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-0.5">Recall</p>
                  <p className="text-xl font-mono font-semibold text-foreground">{(confusionMatrix.totals.recall * 100).toFixed(1)}%</p>
                </div>
                <div className="bg-muted/30 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-0.5">TP / FP / FN / TN</p>
                  <p className="text-lg font-mono font-medium text-foreground">
                    {confusionMatrix.totals.tp} / {confusionMatrix.totals.fp} / {confusionMatrix.totals.fn} / {confusionMatrix.totals.tn}
                  </p>
                </div>
              </div>

              {/* Per-query table — condensed */}
              <div className="border border-border/60 rounded-lg overflow-auto max-h-96">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableHead className="text-muted-foreground text-xs">Query</TableHead>
                      <TableHead className="text-right text-muted-foreground text-xs w-[60px]">K</TableHead>
                      <TableHead className="text-center text-muted-foreground text-xs w-[120px]">TP/FP/FN/TN</TableHead>
                      <TableHead className="text-right text-muted-foreground text-xs w-[65px]">Acc</TableHead>
                      <TableHead className="text-right text-muted-foreground text-xs w-[65px]">Prec</TableHead>
                      <TableHead className="text-right text-muted-foreground text-xs w-[65px]">Recall</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {confusionMatrix.rows.map((r, i) => (
                      <TableRow key={i} className="hover:bg-muted/20">
                        <TableCell className="max-w-xs truncate text-sm py-2.5">{r.query}</TableCell>
                        <TableCell className="text-right font-mono text-sm py-2.5">{r.top_k}</TableCell>
                        <TableCell className="text-center font-mono text-sm py-2.5">
                          <span className="text-green-600">{r.tp}</span>
                          <span className="text-muted-foreground mx-0.5">/</span>
                          <span className="text-red-500">{r.fp}</span>
                          <span className="text-muted-foreground mx-0.5">/</span>
                          <span className="text-orange-500">{r.fn}</span>
                          <span className="text-muted-foreground mx-0.5">/</span>
                          <span>{r.tn}</span>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm py-2.5">{(r.accuracy * 100).toFixed(1)}%</TableCell>
                        <TableCell className="text-right font-mono text-sm py-2.5">{(r.precision * 100).toFixed(1)}%</TableCell>
                        <TableCell className="text-right font-mono text-sm py-2.5">{(r.recall * 100).toFixed(1)}%</TableCell>
                      </TableRow>
                    ))}
                    {/* Aggregate row */}
                    <TableRow className="bg-muted/40 font-semibold border-t-2 border-border hover:bg-muted/40">
                      <TableCell className="text-sm py-2.5">Aggregate</TableCell>
                      <TableCell className="text-right font-mono text-sm py-2.5">—</TableCell>
                      <TableCell className="text-center font-mono text-sm py-2.5">
                        <span className="text-green-600">{confusionMatrix.totals.tp}</span>
                        <span className="text-muted-foreground mx-0.5">/</span>
                        <span className="text-red-500">{confusionMatrix.totals.fp}</span>
                        <span className="text-muted-foreground mx-0.5">/</span>
                        <span className="text-orange-500">{confusionMatrix.totals.fn}</span>
                        <span className="text-muted-foreground mx-0.5">/</span>
                        <span>{confusionMatrix.totals.tn}</span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm py-2.5">{(confusionMatrix.totals.accuracy * 100).toFixed(1)}%</TableCell>
                      <TableCell className="text-right font-mono text-sm py-2.5">{(confusionMatrix.totals.precision * 100).toFixed(1)}%</TableCell>
                      <TableCell className="text-right font-mono text-sm py-2.5">{(confusionMatrix.totals.recall * 100).toFixed(1)}%</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
};

export default QueryAnalytics;
