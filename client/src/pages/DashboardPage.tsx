import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePageTour } from "@/contexts/SiteOnboardingContext";
import { useAIState } from "@/contexts/AIStateContext";
import { useRegisterPageAgent } from "@/contexts/PageAgentContext";
import { useGlobalOrbChat } from "@/contexts/GlobalOrbChatContext";
import type {
  AgentAction,
  AgentActionResult,
  AgentCapability,
} from "../../../shared/agent-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart3,
  Zap,
  Clock,
  TrendingUp,
  LayoutDashboard,
  Image,
  Video,
  Music,
  Mic,
  Activity,
  Coins,
  Monitor,
  DollarSign,
  AlertTriangle,
  Sparkles,
  Info,
} from "lucide-react";
import { GlassCard, ZenSkeleton } from "@/components/ZenCoPilot";
import { motion } from "framer-motion";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
} from "recharts";

const CreditsInfoPage = lazy(() => import("./CreditsInfoPage"));
const LangSmithPage = lazy(() => import("./LangSmithPage"));

// ─── Section Tabs ────────────────────────────────────────────────────────────
type SectionId = "dashboard" | "credits" | "langsmith";

const SECTION_TABS: { id: SectionId; label: string; icon: React.ReactNode }[] = [
  { id: "dashboard", label: "使用統計", icon: <LayoutDashboard className="w-3.5 h-3.5" /> },
  { id: "credits", label: "積分帳戶", icon: <Coins className="w-3.5 h-3.5" /> },
  { id: "langsmith", label: "LangSmith", icon: <Monitor className="w-3.5 h-3.5" /> },
];

function SubPageSkeleton() {
  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      <Skeleton className="h-8 w-48 rounded-lg" />
      <Skeleton className="h-4 w-72 rounded" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    </div>
  );
}

function getInitialSection(): SectionId {
  const params = new URLSearchParams(window.location.search);
  const s = params.get("section");
  const valid = SECTION_TABS.map(t => t.id);
  if (s && valid.includes(s as SectionId)) return s as SectionId;
  return "dashboard";
}

// ─── Label maps ─────────────────────────────────────────────────────────────

const requestTypeLabels: Record<string, string> = {
  image_generation: "圖片生成",
  video_generation: "影片生成",
  audio_generation: "音樂生成",
  voice_dubbing: "語音配音",
  safety_check: "安全檢查",
  prompt_expansion: "提示詞擴展",
  director_ai: "導演 AI",
};

const MODALITY_COLORS: Record<string, string> = {
  image_generation: "#818cf8",
  video_generation: "#34d399",
  audio_generation: "#fb923c",
  voice_dubbing: "#f472b6",
  prompt_expansion: "#60a5fa",
  safety_check: "#a78bfa",
  director_ai: "#facc15",
};

const MODALITY_ICONS: Record<string, React.ReactNode> = {
  image_generation: <Image className="w-3 h-3" />,
  video_generation: <Video className="w-3 h-3" />,
  audio_generation: <Music className="w-3 h-3" />,
  voice_dubbing: <Mic className="w-3 h-3" />,
};

// ─── Custom Tooltip ──────────────────────────────────────────────────────────

function CustomBarTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border/50 bg-background/95 backdrop-blur-sm p-3 shadow-lg text-xs">
      <p className="font-semibold mb-1">{label}</p>
      {payload.map((entry: any, i: number) => (
        <p key={i} style={{ color: entry.color }}>
          {entry.name}：{entry.value}
        </p>
      ))}
    </div>
  );
}

function CustomPieLabel({ cx, cy, midAngle, outerRadius, percent, name }: any) {
  if (percent < 0.05) return null;
  const RADIAN = Math.PI / 180;
  const radius = outerRadius + 24;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text
      x={x}
      y={y}
      fill="currentColor"
      textAnchor={x > cx ? "start" : "end"}
      dominantBaseline="central"
      fontSize={10}
      className="fill-muted-foreground"
    >
      {name} {(percent * 100).toFixed(0)}%
    </text>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  // 全站新手引導
  usePageTour("dashboard");

  // ─── 大分頁（數據洞察合併） ──────────────────────────────────────────────
  const [section, setSection] = useState<SectionId>(getInitialSection);

  const handleSectionChange = (id: SectionId) => {
    setSection(id);
    const params = new URLSearchParams(window.location.search);
    params.set("section", id);
    window.history.replaceState(null, "", `?${params.toString()}`);
  };

  const { setPageContext } = useAIState();

  useEffect(() => {
    setPageContext({ pageId: "dashboard", pageLabel: "總覽儀表板" });
    return () => setPageContext(null);
  }, [setPageContext]);

  const statsQuery = trpc.dashboard.myStats.useQuery(undefined, {
    retry: false,
  });
  const stats = statsQuery.data;

  const insightsQuery = trpc.dashboard.insights.useQuery(undefined, {
    retry: false,
  });
  const insights = insightsQuery.data;

  const orbChat = useGlobalOrbChat();

  const askOrbToAnalyze = () => {
    if (!insights) return;
    const lines: string[] = [];
    lines.push("請幫我分析儀表板目前的成本與用量趨勢，給我具體的優化建議。");
    if (insights.orbSummary) lines.push(`現況摘要：${insights.orbSummary}`);
    if (insights.providerCostBreakdown.length > 0) {
      lines.push(
        "提供商成本分布：" +
          insights.providerCostBreakdown
            .slice(0, 4)
            .map(
              p =>
                `${p.apiProvider} $${p.totalCost.toFixed(4)} (${(p.costShare * 100).toFixed(0)}%)`
            )
            .join("、")
      );
    }
    if (insights.anomalies.length > 0) {
      lines.push(
        "偵測到的警示：" + insights.anomalies.map(a => a.message).join("；")
      );
    }
    if (insights.recommendations.length > 0) {
      lines.push("系統初步建議：" + insights.recommendations.join("；"));
    }
    orbChat.open();
    void orbChat.sendMessage(lines.join("\n"));
  };

  // ─── PageAgent 註冊（Phase 4a：儀表板接入光球） ────────────────────────
  // Dashboard 本身是唯讀，光球主要是拿到 state snapshot 做摘要；
  // 另外支援 navigate，讓光球可以從儀表板跳到歷史 / 筆記 / 生圖等常用頁。
  const NAV_ALLOWLIST = useMemo<Set<string>>(
    () =>
      new Set([
        "/history",
        "/notes",
        "/prompt-library",
        "/image",
        "/video",
        "/pro-studio",
        "/director-ai",
      ]),
    []
  );
  const agentCapabilities: AgentCapability[] = useMemo(
    () => [
      {
        action: "navigate",
        label: "跳到常用頁面",
        options: [
          { id: "/history", label: "生成歷史", meta: { bestFor: "復盤結果", tip: "找高成功樣本回用" } },
          { id: "/notes", label: "專案筆記", meta: { bestFor: "記錄洞察", tip: "把異常成本原因記下來" } },
          { id: "/prompt-library", label: "提示詞庫", meta: { bestFor: "優化提詞", tip: "保存高效率模板" } },
          { id: "/image", label: "圖片工作流", meta: { bestFor: "圖像任務", tip: "先低成本試稿" } },
          { id: "/video", label: "影片工作流", meta: { bestFor: "影片任務", tip: "先短時長驗證鏡頭語言" } },
          { id: "/pro-studio", label: "音樂配音工作流", meta: { bestFor: "音訊任務", tip: "先確定情緒/BPM 再生成" } },
          { id: "/director-ai", label: "導演 AI", meta: { bestFor: "整體敘事規劃", tip: "先定分鏡再分派模型" } },
        ],
        hint: "navigate path='/history' | '/notes' | '/prompt-library' | '/image' | '/video' | '/pro-studio' | '/director-ai'",
      },
    ],
    []
  );

  useRegisterPageAgent({
    pageId: "dashboard",
    pageLabel: "儀表板",
    pagePath: "/dashboard",
    capabilities: agentCapabilities,
    state: {
      remainingGenerations:
        stats?.remainingGenerations ?? user?.remainingGenerations ?? 0,
      totalRequests: stats?.totalRequests ?? 0,
      totalCost: stats?.totalCost ?? 0,
      modalityBreakdown:
        stats?.modalityBreakdown?.map(r => ({
          type: r.requestType,
          count: r.count,
          totalCost: r.totalCost,
        })) ?? [],
      // Phase 4b — AI insights snapshot, exposed to光球 so it can give
      // contextual suggestions ("成本上升 23%, 建議用較經濟的模型...").
      riskLevel: insights?.riskLevel ?? "ok",
      costTrend: insights?.costTrend ?? null,
      topModality: insights?.topModality ?? null,
      topProvider: insights?.topProvider ?? null,
      providerCostBreakdown: insights?.providerCostBreakdown ?? [],
      anomalies:
        insights?.anomalies?.map(a => ({
          code: a.code,
          severity: a.severity,
          message: a.message,
        })) ?? [],
      recommendations: insights?.recommendations ?? [],
      orbSummary: insights?.orbSummary ?? null,
    },
    handle: async (action: AgentAction): Promise<AgentActionResult> => {
      if (action.type === "navigate") {
        const path = String(action.path ?? "");
        if (!NAV_ALLOWLIST.has(path)) {
          return { ok: false, reason: `不在允許跳轉清單：${path}` };
        }
        setLocation(path);
        return { ok: true, message: `跳到 ${path}` };
      }
      return {
        ok: false,
        reason: `unsupported on dashboard: ${action.type}`,
      };
    },
  });

  const statCards = [
    {
      icon: Zap,
      label: "剩餘積分",
      value: stats?.remainingGenerations ?? user?.remainingGenerations ?? 0,
      unit: "點積分",
      color: "bg-zen-lavender/20",
      textColor: "text-violet-600",
    },
    {
      icon: BarChart3,
      label: "總請求數",
      value: stats?.totalRequests ?? 0,
      unit: "次生成",
      color: "bg-zen-sky/20",
      textColor: "text-blue-600",
    },
    {
      icon: Coins,
      label: "已消耗積分",
      value: stats?.totalRequests ?? 0,
      unit: "點積分",
      color: "bg-zen-peach/20",
      textColor: "text-orange-600",
    },
    {
      icon: TrendingUp,
      label: "今日請求",
      value: (() => {
        const today = new Date().toISOString().slice(0, 10);
        return stats?.dailyTrend?.find(r => r.date === today)?.count ?? 0;
      })(),
      unit: "次 / 今日",
      color: "bg-zen-sage/20",
      textColor: "text-emerald-600",
    },
  ];

  // Build daily trend for line chart — fill 7 days
  const today = new Date();
  const dailyChartData = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (6 - i));
    const key = d.toISOString().slice(0, 10);
    const found = stats?.dailyTrend?.find(r => r.date === key);
    return {
      date: `${d.getMonth() + 1}/${d.getDate()}`,
      請求數: found?.count ?? 0,
      費用: found?.totalCost ?? 0,
      Token數: found?.totalTokens ?? 0,
    };
  });

  // Build pie chart data for modality breakdown
  const pieData = (stats?.modalityBreakdown ?? [])
    .filter(r => r.count > 0)
    .map(r => ({
      name: requestTypeLabels[r.requestType] ?? r.requestType,
      value: r.count,
      cost: r.totalCost,
      fill: MODALITY_COLORS[r.requestType] ?? "#94a3b8",
      key: r.requestType,
    }));

  return (
    <div className="space-y-6">
      {/* ─── 大分頁標籤列 ─────────────────────────────────────────────────── */}
      <div className="flex gap-0.5 border-b overflow-x-auto pb-0 -mb-2">
        {SECTION_TABS.map(st => (
          <button
            key={st.id}
            onClick={() => handleSectionChange(st.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 whitespace-nowrap transition-colors ${
              section === st.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {st.icon}
            {st.label}
          </button>
        ))}
      </div>

      {/* ─── 使用統計（主內容） ────────────────────────────────────────────── */}
      {section === "dashboard" && (<>
      {/* Header */}
      <div className="flex items-center gap-3">
        <LayoutDashboard className="w-5 h-5 text-muted-foreground" />
        <h1 className="hs-h2 !mb-0">儀表板</h1>
      </div>
      <p className="hs-small !mb-0 text-muted-foreground -mt-4">
        查看個人使用統計、配額餘額與成本分析。
      </p>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card, idx) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.08 }}
          >
            <GlassCard>
              <div
                className={`w-9 h-9 rounded-lg ${card.color} flex items-center justify-center mb-3`}
              >
                <card.icon className={`w-4 h-4 ${card.textColor}`} />
              </div>
              <p className="hs-small !mb-0 text-muted-foreground">
                {card.label}
              </p>
              <p className={`text-xl font-semibold mt-1 ${card.textColor}`}>
                {card.value}
              </p>
              <p className="hs-small !mb-0 text-muted-foreground mt-0.5">
                {card.unit}
              </p>
            </GlassCard>
          </motion.div>
        ))}
      </div>

      {/* ─── AI 洞察卡片（Phase 4b） ────────────────────────────────────── */}
      {insights && (insights.anomalies.length > 0 || insights.recommendations.length > 0) && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <GlassCard hover={false}>
            <div className="flex items-center gap-2 mb-3">
              {insights.riskLevel === "high" ? (
                <AlertTriangle className="w-4 h-4 text-red-500" />
              ) : insights.riskLevel === "warn" ? (
                <AlertTriangle className="w-4 h-4 text-amber-500" />
              ) : (
                <Sparkles className="w-4 h-4 text-violet-500" />
              )}
              <h2 className="hs-h3 !mb-0">AI 洞察</h2>
              <Badge
                variant="secondary"
                className={`text-[10px] rounded-md ${
                  insights.riskLevel === "high"
                    ? "bg-red-500/15 text-red-500"
                    : insights.riskLevel === "warn"
                      ? "bg-amber-500/15 text-amber-500"
                      : insights.riskLevel === "info"
                        ? "bg-blue-500/15 text-blue-500"
                        : "bg-emerald-500/15 text-emerald-500"
                }`}
              >
                {insights.riskLevel === "high"
                  ? "高風險"
                  : insights.riskLevel === "warn"
                    ? "需注意"
                    : insights.riskLevel === "info"
                      ? "資訊"
                      : "正常"}
              </Badge>
              <div className="flex-1" />
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs gap-1"
                onClick={askOrbToAnalyze}
                disabled={orbChat.isSending}
              >
                <Sparkles className="w-3 h-3" />
                請光球分析
              </Button>
            </div>

            {insights.costTrend && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3 text-xs">
                <div>
                  <p className="text-muted-foreground">今日成本</p>
                  <p className="font-semibold tabular-nums">
                    ${insights.costTrend.todayCost.toFixed(4)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">日均成本</p>
                  <p className="font-semibold tabular-nums">
                    ${insights.costTrend.avgDailyCost.toFixed(4)}
                  </p>
                </div>
                {insights.costTrend.dayOverDayPct !== null && (
                  <div>
                    <p className="text-muted-foreground">日對比</p>
                    <p
                      className={`font-semibold tabular-nums ${
                        insights.costTrend.dayOverDayPct > 0
                          ? "text-amber-500"
                          : "text-emerald-500"
                      }`}
                    >
                      {insights.costTrend.dayOverDayPct >= 0 ? "+" : ""}
                      {insights.costTrend.dayOverDayPct}%
                    </p>
                  </div>
                )}
              </div>
            )}

            {insights.providerCostBreakdown.length > 0 && (
              <div className="mb-3">
                <p className="text-xs text-muted-foreground mb-1.5">
                  提供商成本分布
                </p>
                <div className="space-y-1">
                  {insights.providerCostBreakdown.slice(0, 4).map(p => (
                    <div
                      key={p.apiProvider}
                      className="flex items-center gap-2 text-xs"
                    >
                      <span className="text-foreground/80 w-24 truncate">
                        {p.apiProvider}
                      </span>
                      <div className="flex-1 h-1.5 rounded-full bg-muted/30 overflow-hidden">
                        <div
                          className="h-full bg-violet-500/70"
                          style={{ width: `${p.costShare * 100}%` }}
                        />
                      </div>
                      <span className="tabular-nums text-muted-foreground shrink-0 w-16 text-right">
                        ${p.totalCost.toFixed(4)}
                      </span>
                      <span className="tabular-nums text-muted-foreground shrink-0 w-10 text-right">
                        {(p.costShare * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {insights.anomalies.length > 0 && (
              <ul className="space-y-1.5 mb-3">
                {insights.anomalies.map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    {a.severity === "high" || a.severity === "warn" ? (
                      <AlertTriangle
                        className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${
                          a.severity === "high" ? "text-red-500" : "text-amber-500"
                        }`}
                      />
                    ) : (
                      <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-blue-500" />
                    )}
                    <span className="text-foreground/80">{a.message}</span>
                  </li>
                ))}
              </ul>
            )}

            {insights.recommendations.length > 0 && (
              <div className="rounded-lg bg-muted/20 p-2.5 text-xs space-y-1">
                <p className="font-medium text-muted-foreground">建議</p>
                {insights.recommendations.map((r, i) => (
                  <p key={i} className="text-foreground/80">
                    · {r}
                  </p>
                ))}
              </div>
            )}
          </GlassCard>
        </motion.div>
      )}

      {/* Charts Row */}
      {statsQuery.isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <GlassCard hover={false}>
            <ZenSkeleton lines={6} />
          </GlassCard>
          <GlassCard hover={false}>
            <ZenSkeleton lines={6} />
          </GlassCard>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 7-Day Activity Trend */}
          <GlassCard hover={false}>
            <div className="flex items-center gap-2 mb-4">
              <Activity className="w-4 h-4 text-muted-foreground" />
              <h2 className="hs-h3 !mb-0">近 7 天活躍趨勢</h2>
            </div>
            {dailyChartData.every(d => d.請求數 === 0) ? (
              <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
                尚無使用紀錄
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart
                  data={dailyChartData}
                  margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(255,255,255,0.05)"
                  />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    allowDecimals={false}
                  />
                  <Tooltip content={<CustomBarTooltip />} />
                  <Bar
                    dataKey="請求數"
                    fill="#818cf8"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={32}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </GlassCard>

          {/* Modality Breakdown Pie */}
          <GlassCard hover={false}>
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-4 h-4 text-muted-foreground" />
              <h2 className="hs-h3 !mb-0">模態使用分布</h2>
            </div>
            {pieData.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
                尚無使用紀錄
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width="55%" height={180}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={72}
                      paddingAngle={3}
                      dataKey="value"
                      labelLine={false}
                    >
                      {pieData.map((entry, idx) => (
                        <Cell key={idx} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number, name: string, props: any) => [
                        `${v} 次 ($${props.payload.cost.toFixed(4)})`,
                        name,
                      ]}
                      contentStyle={{
                        fontSize: 11,
                        borderRadius: 8,
                        background: "rgba(0,0,0,0.75)",
                        border: "none",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-1.5">
                  {pieData.map(entry => (
                    <div
                      key={entry.key}
                      className="flex items-center gap-2 text-xs"
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ background: entry.fill }}
                      />
                      <span className="text-foreground/80 truncate flex-1">
                        {entry.name}
                      </span>
                      <span className="tabular-nums text-muted-foreground shrink-0">
                        {entry.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </GlassCard>
        </div>
      )}

      {/* Cost Trend Line Chart */}
      {!statsQuery.isLoading && dailyChartData.some(d => d.費用 > 0) && (
        <GlassCard hover={false}>
          <div className="flex items-center gap-2 mb-4">
            <DollarSign className="w-4 h-4 text-muted-foreground" />
            <h2 className="hs-h3 !mb-0">近 7 天費用趨勢 (USD)</h2>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart
              data={dailyChartData}
              margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(255,255,255,0.05)"
              />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} />
              <YAxis
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                tickFormatter={v => `$${v.toFixed(3)}`}
              />
              <Tooltip
                formatter={(v: number) => [`$${v.toFixed(5)}`, "費用"]}
                contentStyle={{
                  fontSize: 11,
                  borderRadius: 8,
                  background: "rgba(0,0,0,0.75)",
                  border: "none",
                }}
              />
              <Line
                type="monotone"
                dataKey="費用"
                stroke="#fb923c"
                strokeWidth={2}
                dot={{ fill: "#fb923c", r: 3 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </GlassCard>
      )}

      {/* Recent Usage Logs */}
      <GlassCard hover={false}>
        <div className="flex items-center gap-2 mb-4">
          <Clock className="w-4 h-4 text-muted-foreground" />
          <h2 className="hs-h3 !mb-0">最近使用紀錄</h2>
        </div>
        {statsQuery.isLoading ? (
          <ZenSkeleton lines={5} />
        ) : !stats?.recentLogs || stats.recentLogs.length === 0 ? (
          <p className="hs-small !mb-0 text-muted-foreground text-center py-8">
            還沒有使用紀錄
          </p>
        ) : (
          <div className="space-y-2">
            {stats.recentLogs.map(log => (
              <div
                key={log.id}
                className="flex items-center gap-3 p-3 rounded-lg bg-muted/10 hover:bg-muted/20 transition-colors"
              >
                <div
                  className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                  style={{
                    background: MODALITY_COLORS[log.requestType] + "30",
                  }}
                >
                  <span style={{ color: MODALITY_COLORS[log.requestType] }}>
                    {MODALITY_ICONS[log.requestType] ?? (
                      <Activity className="w-3 h-3" />
                    )}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {requestTypeLabels[log.requestType] || log.requestType}
                    </span>
                    <Badge
                      variant={
                        log.responseStatus === "success"
                          ? "secondary"
                          : "destructive"
                      }
                      className="text-[10px] rounded-md"
                    >
                      {log.responseStatus === "success"
                        ? "成功"
                        : log.responseStatus === "blocked"
                          ? "已攔截"
                          : "失敗"}
                    </Badge>
                  </div>
                  <p className="hs-small !mb-0 text-muted-foreground mt-0.5">
                    {log.apiProvider} | {log.tokensUsed ?? 0} tokens | $
                    {log.estimatedCostUsd ?? "0"}
                  </p>
                </div>
                <span className="hs-small !mb-0 text-muted-foreground shrink-0">
                  {new Date(log.createdAt).toLocaleString("zh-TW")}
                </span>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
      </>)}

      {/* ─── 積分帳戶 ─────────────────────────────────────────────────────── */}
      {section === "credits" && (
        <Suspense fallback={<SubPageSkeleton />}>
          <CreditsInfoPage />
        </Suspense>
      )}

      {/* ─── LangSmith ────────────────────────────────────────────────────── */}
      {section === "langsmith" && (
        <Suspense fallback={<SubPageSkeleton />}>
          <LangSmithPage />
        </Suspense>
      )}
    </div>
  );
}
