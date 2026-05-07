import { useState, useCallback, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { usePageTour } from "@/contexts/SiteOnboardingContext";
import { useRegisterPageAgent } from "@/contexts/PageAgentContext";
import type {
  AgentAction,
  AgentActionResult,
  AgentCapability,
} from "@/contexts/PageAgentContext";
import { GlassCard, ZenSkeleton } from "@/components/ZenCoPilot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  Database,
  Download,
  Eye,
  GitCompare,
  Heart,
  Layers,
  RefreshCw,
  Save,
  Search,
  Shield,
  Tag,
  ThumbsDown,
  ThumbsUp,
  TrendingUp,
  Wifi,
  WifiOff,
  XCircle,
  Zap,
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Legend,
} from "recharts";

// ─── Tab definitions ─────────────────────────────────────────────────────────

type TabId = "overview" | "traces" | "comparison" | "datasets" | "export";

const LANGSMITH_TAB_IDS: TabId[] = [
  "overview",
  "traces",
  "comparison",
  "datasets",
  "export",
];

function isLangSmithTabId(value: string): value is TabId {
  return (LANGSMITH_TAB_IDS as readonly string[]).includes(value);
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ConnectionBadge({
  connected,
  message,
}: {
  connected: boolean;
  message: string;
}) {
  return (
    <Badge
      variant={connected ? "secondary" : "destructive"}
      className="gap-1.5 text-xs rounded-lg"
    >
      {connected ? (
        <Wifi className="w-3 h-3" />
      ) : (
        <WifiOff className="w-3 h-3" />
      )}
      {message}
    </Badge>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  unit,
  color,
  textColor,
  delay = 0,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  unit: string;
  color: string;
  textColor: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
    >
      <GlassCard>
        <div
          className={`w-9 h-9 rounded-lg ${color} flex items-center justify-center mb-3`}
        >
          <Icon className={`w-4 h-4 ${textColor}`} />
        </div>
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className={`hs-h2 !mb-0 mt-1 ${textColor}`}>{value}</p>
        <p className="hs-small !mb-0 text-muted-foreground mt-0.5">{unit}</p>
      </GlassCard>
    </motion.div>
  );
}

// ─── Error State ─────────────────────────────────────────────────────────────

function ErrorState({
  message,
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <GlassCard>
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <AlertTriangle className="w-8 h-8 text-destructive mb-3" />
        <h3 className="text-sm font-medium text-destructive">載入失敗</h3>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm">
          {message || "無法取得資料，請稍後重試。"}
        </p>
        {onRetry && (
          <Button
            variant="outline"
            size="sm"
            className="mt-3 rounded-xl text-xs gap-1"
            onClick={onRetry}
          >
            <RefreshCw className="w-3 h-3" /> 重試
          </Button>
        )}
      </div>
    </GlassCard>
  );
}

// ─── Overview Tab ────────────────────────────────────────────────────────────

function OverviewTab() {
  const healthQuery = trpc.langsmith.healthStats.useQuery(
    { sampleSize: 50 },
    { retry: 1, refetchInterval: 60_000 }
  );
  const health = healthQuery.data;

  if (healthQuery.isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <GlassCard key={i} hover={false}>
              <ZenSkeleton lines={3} />
            </GlassCard>
          ))}
        </div>
        <GlassCard hover={false}>
          <ZenSkeleton lines={6} />
        </GlassCard>
      </div>
    );
  }

  if (healthQuery.isError) {
    return (
      <ErrorState
        message={healthQuery.error?.message}
        onRetry={() => healthQuery.refetch()}
      />
    );
  }

  if (!health?.connected) {
    return (
      <GlassCard>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <WifiOff className="w-10 h-10 text-muted-foreground mb-4" />
          <h3 className="text-base font-medium">LangSmith 未連線</h3>
          <p className="text-sm text-muted-foreground mt-2 max-w-sm">
            請在 .env 中設定 LANGSMITH_API_KEY 以啟用 AI 監控儀表板。
          </p>
        </div>
      </GlassCard>
    );
  }

  const statCards = [
    {
      icon: Activity,
      label: "總追蹤數",
      value: health.total,
      unit: "runs",
      color: "bg-zen-lavender/20",
      textColor: "text-violet-600",
    },
    {
      icon: CheckCircle2,
      label: "成功率",
      value: `${health.successRate}%`,
      unit: `${health.success} 成功`,
      color: "bg-zen-sage/20",
      textColor: "text-emerald-600",
    },
    {
      icon: Clock,
      label: "平均延遲",
      value: health.avgLatencyMs,
      unit: "ms",
      color: "bg-zen-sky/20",
      textColor: "text-blue-600",
    },
    {
      icon: Zap,
      label: "Token 總數",
      value: health.totalTokens.toLocaleString(),
      unit: `$${health.totalCostUsd}`,
      color: "bg-zen-peach/20",
      textColor: "text-orange-600",
    },
  ];

  const errorBreakdownData = Object.entries(health.errorBreakdown).map(
    ([name, count]) => ({
      name,
      count,
    })
  );

  return (
    <div className="space-y-4">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card, idx) => (
          <StatCard key={card.label} {...card} delay={idx * 0.08} />
        ))}
      </div>

      {/* Hourly Traffic Timeline */}
      {health.hourlyTraffic.length > 0 && (
        <GlassCard hover={false}>
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">流量趨勢</h2>
            <Badge variant="secondary" className="text-[10px] ml-auto">
              {health.hourlyTraffic.length} 時段
            </Badge>
          </div>
          <ResponsiveContainer width="100%" height={140}>
            <AreaChart
              data={health.hourlyTraffic}
              margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(255,255,255,0.05)"
              />
              <XAxis dataKey="hour" tick={{ fontSize: 9, fill: "#94a3b8" }} />
              <YAxis
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  fontSize: 11,
                  borderRadius: 8,
                  background: "rgba(0,0,0,0.75)",
                  border: "none",
                }}
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke="#818cf8"
                fill="#818cf8"
                fillOpacity={0.15}
                strokeWidth={2}
                name="請求數"
              />
              <Area
                type="monotone"
                dataKey="errors"
                stroke="#f87171"
                fill="#f87171"
                fillOpacity={0.1}
                strokeWidth={1.5}
                name="錯誤"
              />
            </AreaChart>
          </ResponsiveContainer>
        </GlassCard>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Error Breakdown */}
        <GlassCard hover={false}>
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">錯誤分類</h2>
            <Badge variant="destructive" className="text-[10px] ml-auto">
              {health.errors} 錯誤
            </Badge>
          </div>
          {errorBreakdownData.length === 0 ? (
            <div className="flex items-center justify-center h-28 text-sm text-muted-foreground">
              🎉 無錯誤紀錄
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart
                data={errorBreakdownData}
                layout="vertical"
                margin={{ left: 60, right: 16, top: 4, bottom: 4 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.05)"
                />
                <XAxis
                  type="number"
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  allowDecimals={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  width={60}
                />
                <Tooltip
                  contentStyle={{
                    fontSize: 11,
                    borderRadius: 8,
                    background: "rgba(0,0,0,0.75)",
                    border: "none",
                  }}
                />
                <Bar
                  dataKey="count"
                  fill="#f87171"
                  radius={[0, 4, 4, 0]}
                  maxBarSize={20}
                  name="次數"
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </GlassCard>

        {/* Recent Errors */}
        <GlassCard hover={false}>
          <div className="flex items-center gap-2 mb-4">
            <XCircle className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">近期錯誤</h2>
          </div>
          {health.recentErrors.length === 0 ? (
            <div className="flex items-center justify-center h-28 text-sm text-muted-foreground">
              🎉 無近期錯誤
            </div>
          ) : (
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {health.recentErrors.map(err => (
                <div
                  key={err.id}
                  className="p-2 rounded-lg bg-destructive/5 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-destructive">
                      {err.name}
                    </span>
                    {err.time && (
                      <span className="text-muted-foreground">
                        {new Date(err.time).toLocaleString("zh-TW")}
                      </span>
                    )}
                  </div>
                  <p className="text-muted-foreground mt-0.5 line-clamp-2">
                    {err.error}
                  </p>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}

// ─── Traces Tab ──────────────────────────────────────────────────────────────

function TracesTab() {
  const [runType, setRunType] = useState<
    "llm" | "chain" | "tool" | "retriever" | undefined
  >(undefined);
  const [errorOnly, setErrorOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [feedbackRunId, setFeedbackRunId] = useState<string | null>(null);
  const [feedbackComment, setFeedbackComment] = useState("");
  const [saveDatasetName, setSaveDatasetName] = useState("");

  const runsQuery = trpc.langsmith.listRuns.useQuery(
    {
      limit: 30,
      runType,
      errorOnly,
      search: search || undefined,
      tag: tag || undefined,
    },
    { retry: 1 }
  );

  const runDetailQuery = trpc.langsmith.getRun.useQuery(
    { runId: selectedRunId! },
    { enabled: !!selectedRunId, retry: false }
  );

  const feedbackQuery = trpc.langsmith.listFeedback.useQuery(
    { runId: selectedRunId! },
    { enabled: !!selectedRunId, retry: false }
  );

  const createFeedback = trpc.langsmith.createFeedback.useMutation({
    onSuccess: data => {
      if (data.success) {
        toast.success(data.message);
        setFeedbackRunId(null);
        setFeedbackComment("");
        feedbackQuery.refetch();
      } else {
        toast.error(data.message);
      }
    },
    onError: e => toast.error(e.message),
  });

  const addToDataset = trpc.langsmith.addRunToDataset.useMutation({
    onSuccess: data => {
      if (data.success) {
        toast.success(data.message);
        setSaveDatasetName("");
      } else toast.error(data.message);
    },
    onError: e => toast.error(e.message),
  });

  const handleFeedback = useCallback(
    (runId: string, score: number) => {
      createFeedback.mutate({
        runId,
        score,
        comment: feedbackComment || undefined,
      });
    },
    [createFeedback, feedbackComment]
  );

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select
          value={runType ?? "all"}
          onValueChange={v =>
            setRunType(v === "all" ? undefined : (v as typeof runType))
          }
        >
          <SelectTrigger className="w-32 rounded-xl text-xs">
            <SelectValue placeholder="Run 類型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部類型</SelectItem>
            <SelectItem value="llm">LLM</SelectItem>
            <SelectItem value="chain">Chain</SelectItem>
            <SelectItem value="tool">Tool</SelectItem>
            <SelectItem value="retriever">Retriever</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant={errorOnly ? "destructive" : "outline"}
          size="sm"
          className="rounded-xl text-xs gap-1.5"
          onClick={() => setErrorOnly(!errorOnly)}
        >
          <AlertTriangle className="w-3 h-3" />
          {errorOnly ? "僅錯誤" : "全部狀態"}
        </Button>
        <div className="flex items-center gap-1.5 flex-1 min-w-[140px] max-w-[220px]">
          <Search className="w-3 h-3 text-muted-foreground shrink-0" />
          <Input
            placeholder="搜尋名稱..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="rounded-xl text-xs h-8"
          />
        </div>
        <div className="flex items-center gap-1.5 min-w-[120px] max-w-[180px]">
          <Tag className="w-3 h-3 text-muted-foreground shrink-0" />
          <Input
            placeholder="標籤篩選..."
            value={tag}
            onChange={e => setTag(e.target.value)}
            className="rounded-xl text-xs h-8"
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="rounded-xl text-xs gap-1.5 ml-auto"
          onClick={() => runsQuery.refetch()}
        >
          <RefreshCw className="w-3 h-3" /> 重新整理
        </Button>
      </div>

      {/* Runs List */}
      {runsQuery.isLoading ? (
        <GlassCard hover={false}>
          <ZenSkeleton lines={8} />
        </GlassCard>
      ) : runsQuery.isError ? (
        <ErrorState
          message={runsQuery.error?.message}
          onRetry={() => runsQuery.refetch()}
        />
      ) : !runsQuery.data?.runs.length ? (
        <GlassCard>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Search className="w-8 h-8 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">尚無追蹤紀錄</p>
          </div>
        </GlassCard>
      ) : (
        <div className="space-y-2">
          {runsQuery.data.runs.map(run => (
            <motion.div
              key={run.id}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <GlassCard>
                <div className="flex items-center gap-3">
                  <div
                    className={`w-2 h-2 rounded-full shrink-0 ${run.status === "error" ? "bg-destructive" : "bg-emerald-500"}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">
                        {run.name}
                      </span>
                      <Badge
                        variant="outline"
                        className="text-[10px] rounded-md shrink-0"
                      >
                        {run.run_type}
                      </Badge>
                      {run.error && (
                        <Badge
                          variant="destructive"
                          className="text-[10px] rounded-md shrink-0"
                        >
                          錯誤
                        </Badge>
                      )}
                      {run.tags.length > 0 &&
                        run.tags.slice(0, 2).map(t => (
                          <Badge
                            key={t}
                            variant="secondary"
                            className="text-[9px] rounded-md shrink-0"
                          >
                            {t}
                          </Badge>
                        ))}
                    </div>
                    <div className="flex items-center gap-3 mt-1 hs-small !mb-0 text-muted-foreground flex-wrap">
                      {run.latency != null && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {run.latency}ms
                        </span>
                      )}
                      {(run.total_tokens ?? run.extra?.total_tokens) !=
                        null && (
                        <span className="flex items-center gap-1">
                          <Zap className="w-3 h-3" />{" "}
                          {
                            (run.total_tokens ??
                              run.extra?.total_tokens) as number
                          }{" "}
                          tokens
                        </span>
                      )}
                      {run.extra?.cost_usd != null && (
                        <span>
                          ${(run.extra.cost_usd as number).toFixed(5)}
                        </span>
                      )}
                      {run.start_time && (
                        <span>
                          {new Date(run.start_time).toLocaleString("zh-TW")}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={e => {
                        e.stopPropagation();
                        setFeedbackRunId(run.id);
                      }}
                      title="回饋"
                    >
                      <Heart className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setSelectedRunId(run.id)}
                      title="詳情"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      )}

      {/* Run Detail Dialog */}
      <Dialog
        open={!!selectedRunId}
        onOpenChange={open => {
          if (!open) setSelectedRunId(null);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="w-4 h-4" /> Run 詳情
            </DialogTitle>
          </DialogHeader>
          {runDetailQuery.isLoading ? (
            <ZenSkeleton lines={8} />
          ) : runDetailQuery.data ? (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-muted-foreground">名稱：</span>
                  {runDetailQuery.data.name}
                </div>
                <div>
                  <span className="text-muted-foreground">類型：</span>
                  {runDetailQuery.data.run_type}
                </div>
                <div>
                  <span className="text-muted-foreground">狀態：</span>
                  <Badge
                    variant={
                      runDetailQuery.data.status === "error"
                        ? "destructive"
                        : "secondary"
                    }
                    className="text-xs"
                  >
                    {runDetailQuery.data.status}
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">延遲：</span>
                  {runDetailQuery.data.latency != null
                    ? `${runDetailQuery.data.latency}ms`
                    : "-"}
                </div>
                <div>
                  <span className="text-muted-foreground">時間：</span>
                  {runDetailQuery.data.start_time
                    ? new Date(runDetailQuery.data.start_time).toLocaleString(
                        "zh-TW"
                      )
                    : "-"}
                </div>
                {runDetailQuery.data.extra?.model != null && (
                  <div>
                    <span className="text-muted-foreground">模型：</span>
                    {String(runDetailQuery.data.extra.model)}
                  </div>
                )}
              </div>

              {runDetailQuery.data.error && (
                <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-xs">
                  <strong>錯誤：</strong> {runDetailQuery.data.error}
                </div>
              )}

              {runDetailQuery.data.inputs && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground mb-1">
                    輸入
                  </h4>
                  <pre className="p-3 rounded-lg bg-muted/20 text-xs overflow-x-auto max-h-40">
                    {JSON.stringify(runDetailQuery.data.inputs, null, 2)}
                  </pre>
                </div>
              )}
              {runDetailQuery.data.outputs && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground mb-1">
                    輸出
                  </h4>
                  <pre className="p-3 rounded-lg bg-muted/20 text-xs overflow-x-auto max-h-40">
                    {JSON.stringify(runDetailQuery.data.outputs, null, 2)}
                  </pre>
                </div>
              )}

              {/* Quick Save to Dataset */}
              <div className="flex items-end gap-2 pt-2 border-t border-border/20">
                <div className="flex-1 space-y-1">
                  <label className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Save className="w-3 h-3" /> 存入 Dataset
                  </label>
                  <Input
                    placeholder="Dataset 名稱..."
                    value={saveDatasetName}
                    onChange={e => setSaveDatasetName(e.target.value)}
                    className="rounded-xl text-xs h-8"
                  />
                </div>
                <Button
                  size="sm"
                  className="rounded-xl text-xs h-8"
                  disabled={
                    !saveDatasetName.trim() ||
                    !selectedRunId ||
                    addToDataset.isPending
                  }
                  onClick={() =>
                    selectedRunId &&
                    addToDataset.mutate({
                      runId: selectedRunId,
                      datasetName: saveDatasetName,
                    })
                  }
                >
                  {addToDataset.isPending ? "儲存..." : "存入"}
                </Button>
              </div>

              {/* Feedback for this run */}
              {feedbackQuery.data && feedbackQuery.data.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground mb-2">
                    回饋紀錄
                  </h4>
                  <div className="space-y-1">
                    {feedbackQuery.data.map(fb => (
                      <div
                        key={fb.id}
                        className="flex items-center gap-2 text-xs p-2 rounded-lg bg-muted/10"
                      >
                        {fb.score != null && fb.score >= 0.5 ? (
                          <ThumbsUp className="w-3 h-3 text-emerald-500" />
                        ) : (
                          <ThumbsDown className="w-3 h-3 text-destructive" />
                        )}
                        <span>{fb.comment || fb.key}</span>
                        <span className="text-muted-foreground ml-auto">
                          {fb.score}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">無法載入 Run 資料</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Feedback Dialog */}
      <Dialog
        open={!!feedbackRunId}
        onOpenChange={open => {
          if (!open) setFeedbackRunId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Heart className="w-4 h-4" /> 提交回饋
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-xs text-muted-foreground">
              對此次 AI 回應進行評分：
            </p>
            <Textarea
              placeholder="（選填）回饋說明..."
              value={feedbackComment}
              onChange={e => setFeedbackComment(e.target.value)}
              className="rounded-xl"
              rows={3}
            />
            <div className="flex gap-3">
              <Button
                className="flex-1 rounded-xl gap-1.5"
                variant="outline"
                onClick={() =>
                  feedbackRunId && handleFeedback(feedbackRunId, 1)
                }
                disabled={createFeedback.isPending}
              >
                <ThumbsUp className="w-4 h-4 text-emerald-500" /> 點讚
              </Button>
              <Button
                className="flex-1 rounded-xl gap-1.5"
                variant="outline"
                onClick={() =>
                  feedbackRunId && handleFeedback(feedbackRunId, 0)
                }
                disabled={createFeedback.isPending}
              >
                <ThumbsDown className="w-4 h-4 text-destructive" /> 點踩
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Model Comparison Tab ────────────────────────────────────────────────────

function ComparisonTab() {
  const comparisonQuery = trpc.langsmith.modelComparison.useQuery(
    { sampleSize: 100 },
    { retry: 1 }
  );
  const data = comparisonQuery.data;

  if (comparisonQuery.isLoading) {
    return (
      <div className="space-y-4">
        <GlassCard hover={false}>
          <ZenSkeleton lines={6} />
        </GlassCard>
        <GlassCard hover={false}>
          <ZenSkeleton lines={6} />
        </GlassCard>
      </div>
    );
  }

  if (comparisonQuery.isError) {
    return (
      <ErrorState
        message={comparisonQuery.error?.message}
        onRetry={() => comparisonQuery.refetch()}
      />
    );
  }

  if (!data?.models.length) {
    return (
      <GlassCard>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <GitCompare className="w-8 h-8 text-muted-foreground mb-3" />
          <h3 className="text-base font-medium">尚無模型對比數據</h3>
          <p className="text-sm text-muted-foreground mt-2">
            需要至少有 LLM 追蹤紀錄才能進行對比分析。
          </p>
        </div>
      </GlassCard>
    );
  }

  // Bar chart data for cost vs speed
  const barData = data.models.map(m => ({
    name: m.model.length > 20 ? m.model.slice(0, 20) + "…" : m.model,
    延遲: m.avgLatencyMs,
    成本: m.avgCostPerRun * 1000, // ×1000 to convert from USD to milli-USD for chart readability
    使用次數: m.runs,
  }));

  // Radar chart data for multi-dimensional comparison (top 5 models)
  const topModels = data.models.slice(0, 5);
  const maxLatency = Math.max(...topModels.map(m => m.avgLatencyMs), 1);
  const maxTokens = Math.max(...topModels.map(m => m.avgTokensPerRun), 1);
  const maxCost = Math.max(...topModels.map(m => m.avgCostPerRun), 0.000001);

  const radarData = [
    {
      metric: "成功率",
      ...Object.fromEntries(topModels.map(m => [m.model, m.successRate])),
    },
    {
      metric: "速度",
      ...Object.fromEntries(
        topModels.map(m => [
          m.model,
          Math.round((1 - m.avgLatencyMs / maxLatency) * 100),
        ])
      ),
    },
    {
      metric: "Token效率",
      ...Object.fromEntries(
        topModels.map(m => [
          m.model,
          Math.round((1 - m.avgTokensPerRun / maxTokens) * 100),
        ])
      ),
    },
    {
      metric: "成本效益",
      ...Object.fromEntries(
        topModels.map(m => [
          m.model,
          Math.round((1 - m.avgCostPerRun / maxCost) * 100),
        ])
      ),
    },
    {
      metric: "品質",
      ...Object.fromEntries(
        topModels.map(m => [m.model, m.qualityScore ?? 50])
      ),
    },
  ];

  const COLORS = ["#818cf8", "#34d399", "#fb923c", "#f472b6", "#60a5fa"];

  return (
    <div className="space-y-4">
      {/* Model Cards - Side-by-Side */}
      <div className="flex items-center gap-2 mb-2">
        <GitCompare className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">模型側邊欄對比</h2>
        <Badge variant="secondary" className="text-[10px] ml-auto">
          {data.totalRuns} 總 Runs
        </Badge>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {data.models.map((model, idx) => (
          <motion.div
            key={model.model}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.06 }}
          >
            <GlassCard>
              <div className="flex items-center gap-2 mb-3">
                <div
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ background: COLORS[idx % COLORS.length] }}
                />
                <span className="text-sm font-medium truncate">
                  {model.model}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <div>
                  <span className="text-muted-foreground">使用次數</span>
                  <p className="font-semibold">{model.runs}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">成功率</span>
                  <p
                    className={`font-semibold ${model.successRate >= 95 ? "text-emerald-600" : model.successRate >= 80 ? "text-amber-600" : "text-destructive"}`}
                  >
                    {model.successRate}%
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">平均延遲</span>
                  <p className="font-semibold">{model.avgLatencyMs}ms</p>
                </div>
                <div>
                  <span className="text-muted-foreground">平均成本</span>
                  <p className="font-semibold">
                    ${model.avgCostPerRun.toFixed(6)}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">平均 Token</span>
                  <p className="font-semibold">{model.avgTokensPerRun}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">品質評分</span>
                  <p className="font-semibold">
                    {model.qualityScore != null
                      ? `${model.qualityScore}%`
                      : "—"}
                    {model.scoredRuns > 0 && (
                      <span className="text-muted-foreground font-normal">
                        {" "}
                        ({model.scoredRuns})
                      </span>
                    )}
                  </p>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Cost vs Speed Bar Chart */}
        <GlassCard hover={false}>
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">延遲 vs 使用量</h2>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={barData}
              margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(255,255,255,0.05)"
              />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: "#94a3b8" }} />
              <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} />
              <Tooltip
                contentStyle={{
                  fontSize: 11,
                  borderRadius: 8,
                  background: "rgba(0,0,0,0.75)",
                  border: "none",
                }}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar
                dataKey="延遲"
                fill="#818cf8"
                radius={[4, 4, 0, 0]}
                maxBarSize={24}
              />
              <Bar
                dataKey="使用次數"
                fill="#34d399"
                radius={[4, 4, 0, 0]}
                maxBarSize={24}
              />
            </BarChart>
          </ResponsiveContainer>
        </GlassCard>

        {/* Radar Chart - Multi-dimensional comparison */}
        {topModels.length >= 2 && (
          <GlassCard hover={false}>
            <div className="flex items-center gap-2 mb-4">
              <Shield className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">多維度品質雷達圖</h2>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="rgba(148,163,184,0.2)" />
                <PolarAngleAxis
                  dataKey="metric"
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                />
                <PolarRadiusAxis
                  tick={{ fontSize: 8, fill: "#94a3b8" }}
                  domain={[0, 100]}
                />
                {topModels.map((m, i) => (
                  <Radar
                    key={m.model}
                    name={m.model}
                    dataKey={m.model}
                    stroke={COLORS[i % COLORS.length]}
                    fill={COLORS[i % COLORS.length]}
                    fillOpacity={0.15}
                  />
                ))}
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Tooltip
                  contentStyle={{
                    fontSize: 11,
                    borderRadius: 8,
                    background: "rgba(0,0,0,0.75)",
                    border: "none",
                  }}
                />
              </RadarChart>
            </ResponsiveContainer>
          </GlassCard>
        )}
      </div>
    </div>
  );
}

// ─── Datasets Tab ────────────────────────────────────────────────────────────

function DatasetsTab() {
  const datasetsQuery = trpc.langsmith.listDatasets.useQuery(undefined, {
    retry: false,
  });
  const [addDialogRunId, setAddDialogRunId] = useState("");
  const [addDialogDataset, setAddDialogDataset] = useState("");

  const addRunMutation = trpc.langsmith.addRunToDataset.useMutation({
    onSuccess: data => {
      if (data.success) {
        toast.success(data.message);
        setAddDialogRunId("");
        setAddDialogDataset("");
        datasetsQuery.refetch();
      } else {
        toast.error(data.message);
      }
    },
    onError: e => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">數據集管理</h2>
        </div>
      </div>

      {/* Add to dataset form */}
      <GlassCard>
        <h3 className="text-xs font-semibold text-muted-foreground mb-3">
          案例提取 — 將 Run 存入 Dataset
        </h3>
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1">
            <label className="text-[11px] text-muted-foreground">Run ID</label>
            <Input
              placeholder="貼入 Run ID..."
              value={addDialogRunId}
              onChange={e => setAddDialogRunId(e.target.value)}
              className="rounded-xl text-xs"
            />
          </div>
          <div className="flex-1 space-y-1">
            <label className="text-[11px] text-muted-foreground">
              Dataset 名稱
            </label>
            <Input
              placeholder="dataset 名稱..."
              value={addDialogDataset}
              onChange={e => setAddDialogDataset(e.target.value)}
              className="rounded-xl text-xs"
            />
          </div>
          <Button
            className="rounded-xl text-xs"
            size="sm"
            onClick={() =>
              addRunMutation.mutate({
                runId: addDialogRunId,
                datasetName: addDialogDataset,
              })
            }
            disabled={
              !addDialogRunId.trim() ||
              !addDialogDataset.trim() ||
              addRunMutation.isPending
            }
          >
            {addRunMutation.isPending ? "儲存中..." : "存入 Dataset"}
          </Button>
        </div>
      </GlassCard>

      {/* Datasets List */}
      {datasetsQuery.isLoading ? (
        <GlassCard hover={false}>
          <ZenSkeleton lines={4} />
        </GlassCard>
      ) : !datasetsQuery.data?.length ? (
        <GlassCard>
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <Layers className="w-8 h-8 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">尚無 Dataset</p>
            <p className="text-xs text-muted-foreground mt-1">
              從 Traces 頁籤將優質 Run 存入 Dataset 開始建構數據資產。
            </p>
          </div>
        </GlassCard>
      ) : (
        <div className="space-y-2">
          {datasetsQuery.data.map(ds => (
            <motion.div
              key={ds.id}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <GlassCard>
                <div className="flex items-center gap-3">
                  <Database className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{ds.name}</p>
                    {ds.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                        {ds.description}
                      </p>
                    )}
                  </div>
                  <Badge variant="secondary" className="text-[10px] shrink-0">
                    {ds.example_count} 筆
                  </Badge>
                </div>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Fine-tuning Export Tab ──────────────────────────────────────────────────

function ExportTab() {
  const [format, setFormat] = useState<"openai" | "jsonl">("openai");
  const [minScore, setMinScore] = useState(0.5);
  const [limit, setLimit] = useState(50);

  const exportQuery = trpc.langsmith.exportFineTuningData.useQuery(
    { limit, minScore, format },
    { retry: false, enabled: false } // manual trigger
  );

  const handleExport = () => {
    exportQuery.refetch();
  };

  const handleDownload = () => {
    if (!exportQuery.data?.records.length) return;
    const content = exportQuery.data.records
      .map(r => JSON.stringify(r))
      .join("\n");
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ext = format === "openai" ? "json" : "jsonl";
    a.download = `fine-tuning-${format}-${new Date().toISOString().slice(0, 10)}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`已下載 ${exportQuery.data.records.length} 筆微調數據`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Download className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">模型微調數據導出</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        篩選出用戶點讚的高品質對話，導出為 OpenAI 或 JSONL
        格式，用於後續模型微調。
      </p>

      {/* Export Config */}
      <GlassCard>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground">
              導出格式
            </label>
            <Select
              value={format}
              onValueChange={v => setFormat(v as typeof format)}
            >
              <SelectTrigger className="rounded-xl text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">OpenAI Fine-tuning</SelectItem>
                <SelectItem value="jsonl">JSONL (通用)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground">
              最低評分 (0-1)
            </label>
            <Input
              type="number"
              min={0}
              max={1}
              step={0.1}
              value={minScore}
              onChange={e => setMinScore(parseFloat(e.target.value) || 0)}
              className="rounded-xl text-xs"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground">
              數量上限
            </label>
            <Input
              type="number"
              min={1}
              max={500}
              value={limit}
              onChange={e => setLimit(parseInt(e.target.value) || 50)}
              className="rounded-xl text-xs"
            />
          </div>
        </div>
        <div className="flex gap-3 mt-4">
          <Button
            className="rounded-xl text-xs gap-1.5"
            onClick={handleExport}
            disabled={exportQuery.isFetching}
          >
            <Search className="w-3 h-3" />
            {exportQuery.isFetching ? "搜尋中..." : "搜尋優質案例"}
          </Button>
          {exportQuery.data && exportQuery.data.records.length > 0 && (
            <Button
              variant="outline"
              className="rounded-xl text-xs gap-1.5"
              onClick={handleDownload}
            >
              <Download className="w-3 h-3" />
              下載 ({exportQuery.data.total} 筆)
            </Button>
          )}
        </div>
      </GlassCard>

      {/* Preview */}
      {exportQuery.data && (
        <GlassCard hover={false}>
          <div className="flex items-center gap-2 mb-3">
            <Layers className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">預覽</h3>
            <Badge variant="secondary" className="text-[10px] ml-auto">
              {exportQuery.data.total} 筆 · {exportQuery.data.format} 格式
            </Badge>
          </div>
          {exportQuery.data.records.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              未找到符合條件的高品質案例。嘗試降低最低評分或增加搜尋數量。
            </p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {exportQuery.data.records.slice(0, 10).map((record, idx) => (
                <div key={idx} className="p-3 rounded-lg bg-muted/10 text-xs">
                  <pre className="whitespace-pre-wrap break-all max-h-24 overflow-hidden">
                    {JSON.stringify(record, null, 2)}
                  </pre>
                </div>
              ))}
              {exportQuery.data.records.length > 10 && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  ... 還有 {exportQuery.data.records.length - 10}{" "}
                  筆（點擊下載查看完整資料）
                </p>
              )}
            </div>
          )}
        </GlassCard>
      )}
    </div>
  );
}

// ─── Main Page Component ─────────────────────────────────────────────────────

export default function LangSmithPage() {
  usePageTour("langsmith");

  const statusQuery = trpc.langsmith.status.useQuery(undefined, {
    retry: false,
    refetchInterval: 120_000,
  });

  // 將 Tabs 改為受控（controlled），讓光球可以透過 setTab 動作切換 LangSmith
  // 各個監控分頁（總覽 / 追蹤 / 模型對比 / 數據集 / 微調導出）。
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  const langsmithAgentCapabilities: AgentCapability[] = useMemo(
    () => [
      {
        action: "setTab",
        label: "切換監控分頁",
        currentId: activeTab,
        options: [
          { id: "overview", label: "總覽", meta: { tip: "查看連線、總追蹤、成功率與延遲" } },
          { id: "traces", label: "追蹤", meta: { tip: "瀏覽單筆 LLM 呼叫的完整 trace" } },
          { id: "comparison", label: "模型對比", meta: { tip: "比較不同模型在同一輸入下的表現" } },
          { id: "datasets", label: "數據集", meta: { tip: "管理用於評估與微調的測試集" } },
          { id: "export", label: "微調導出", meta: { tip: "匯出可用於 fine-tune 的 JSONL 資料" } },
        ],
        hint: "setTab tabId='overview' | 'traces' | 'comparison' | 'datasets' | 'export'",
      },
    ],
    [activeTab]
  );

  useRegisterPageAgent({
    pageId: "langsmith",
    pageLabel: "AI 監控中心",
    pagePath: "/dashboard?section=langsmith",
    capabilities: langsmithAgentCapabilities,
    state: {
      activeTab,
      connected: statusQuery.data?.connected ?? false,
      statusMessage: statusQuery.data?.message ?? null,
    },
    handle: async (action: AgentAction): Promise<AgentActionResult> => {
      if (action.type === "setTab") {
        const id = String(action.tabId ?? "");
        if (!isLangSmithTabId(id)) {
          return { ok: false, reason: `langsmith: 未知 tabId：${id}` };
        }
        setActiveTab(id);
        return { ok: true, message: `已切換到 ${id}` };
      }
      return {
        ok: false,
        reason: `unsupported on langsmith: ${action.type}`,
      };
    },
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="w-5 h-5 text-muted-foreground" />
          <h1 className="hs-h2 !mb-0">AI 監控中心</h1>
        </div>
        <ConnectionBadge
          connected={statusQuery.data?.connected ?? false}
          message={statusQuery.data?.message ?? "載入中..."}
        />
      </div>
      <p className="text-xs text-muted-foreground -mt-4">
        LangSmith 深度整合 —
        全鏈路追蹤、生產監控、回饋收集、模型對比與微調數據導出。
      </p>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={v => isLangSmithTabId(v) && setActiveTab(v)}
        className="space-y-4"
      >
        <TabsList className="grid w-full grid-cols-5 rounded-xl h-9">
          <TabsTrigger value="overview" className="text-xs rounded-lg gap-1">
            <Shield className="w-3 h-3" />{" "}
            <span className="hidden sm:inline">總覽</span>
          </TabsTrigger>
          <TabsTrigger value="traces" className="text-xs rounded-lg gap-1">
            <Search className="w-3 h-3" />{" "}
            <span className="hidden sm:inline">追蹤</span>
          </TabsTrigger>
          <TabsTrigger value="comparison" className="text-xs rounded-lg gap-1">
            <GitCompare className="w-3 h-3" />{" "}
            <span className="hidden sm:inline">模型對比</span>
          </TabsTrigger>
          <TabsTrigger value="datasets" className="text-xs rounded-lg gap-1">
            <Database className="w-3 h-3" />{" "}
            <span className="hidden sm:inline">數據集</span>
          </TabsTrigger>
          <TabsTrigger value="export" className="text-xs rounded-lg gap-1">
            <Download className="w-3 h-3" />{" "}
            <span className="hidden sm:inline">微調導出</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab />
        </TabsContent>
        <TabsContent value="traces">
          <TracesTab />
        </TabsContent>
        <TabsContent value="comparison">
          <ComparisonTab />
        </TabsContent>
        <TabsContent value="datasets">
          <DatasetsTab />
        </TabsContent>
        <TabsContent value="export">
          <ExportTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
