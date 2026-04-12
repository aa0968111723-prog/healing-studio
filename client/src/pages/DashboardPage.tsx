import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import {
  BarChart3, Zap, DollarSign, Clock, TrendingUp, LayoutDashboard,
  Image, Video, Music, Mic, Activity,
} from "lucide-react";
import { GlassCard, ZenSkeleton } from "@/components/ZenCoPilot";
import { motion } from "framer-motion";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

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
  image_generation:  "#818cf8",
  video_generation:  "#34d399",
  audio_generation:  "#fb923c",
  voice_dubbing:     "#f472b6",
  prompt_expansion:  "#60a5fa",
  safety_check:      "#a78bfa",
  director_ai:       "#facc15",
};

const MODALITY_ICONS: Record<string, React.ReactNode> = {
  image_generation:  <Image className="w-3 h-3" />,
  video_generation:  <Video className="w-3 h-3" />,
  audio_generation:  <Music className="w-3 h-3" />,
  voice_dubbing:     <Mic className="w-3 h-3" />,
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
    <text x={x} y={y} fill="currentColor" textAnchor={x > cx ? "start" : "end"} dominantBaseline="central" fontSize={10} className="fill-muted-foreground">
      {name} {(percent * 100).toFixed(0)}%
    </text>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuth();
  const statsQuery = trpc.dashboard.myStats.useQuery(undefined, { retry: false });
  const stats = statsQuery.data;

  const statCards = [
    {
      icon: Zap,
      label: "剩餘配額",
      value: stats?.remainingGenerations ?? user?.remainingGenerations ?? 0,
      unit: "次生成",
      color: "bg-zen-lavender/20",
      textColor: "text-violet-600",
    },
    {
      icon: BarChart3,
      label: "總請求數",
      value: stats?.totalRequests ?? 0,
      unit: "次 API 呼叫",
      color: "bg-zen-sky/20",
      textColor: "text-blue-600",
    },
    {
      icon: DollarSign,
      label: "預估成本",
      value: `$${stats?.totalCost?.toFixed(3) ?? "0.000"}`,
      unit: "USD",
      color: "bg-zen-peach/20",
      textColor: "text-orange-600",
    },
    {
      icon: TrendingUp,
      label: "效率指標",
      value: stats?.totalRequests
        ? `$${(stats.totalCost / stats.totalRequests).toFixed(4)}`
        : "$0.0000",
      unit: "USD / 次",
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
      {/* Header */}
      <div className="flex items-center gap-3">
        <LayoutDashboard className="w-5 h-5 text-muted-foreground" />
        <h1 className="text-xl font-semibold">儀表板</h1>
      </div>
      <p className="text-xs text-muted-foreground -mt-4">查看個人使用統計、配額餘額與成本分析。</p>

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
              <div className={`w-9 h-9 rounded-lg ${card.color} flex items-center justify-center mb-3`}>
                <card.icon className={`w-4 h-4 ${card.textColor}`} />
              </div>
              <p className="text-[11px] text-muted-foreground">{card.label}</p>
              <p className={`text-xl font-semibold mt-1 ${card.textColor}`}>{card.value}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{card.unit}</p>
            </GlassCard>
          </motion.div>
        ))}
      </div>

      {/* Charts Row */}
      {statsQuery.isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <GlassCard hover={false}><ZenSkeleton lines={6} /></GlassCard>
          <GlassCard hover={false}><ZenSkeleton lines={6} /></GlassCard>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 7-Day Activity Trend */}
          <GlassCard hover={false}>
            <div className="flex items-center gap-2 mb-4">
              <Activity className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">近 7 天活躍趨勢</h2>
            </div>
            {dailyChartData.every(d => d.請求數 === 0) ? (
              <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
                尚無使用紀錄
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={dailyChartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                  <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} allowDecimals={false} />
                  <Tooltip content={<CustomBarTooltip />} />
                  <Bar dataKey="請求數" fill="#818cf8" radius={[4, 4, 0, 0]} maxBarSize={32} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </GlassCard>

          {/* Modality Breakdown Pie */}
          <GlassCard hover={false}>
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">模態使用分布</h2>
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
                      contentStyle={{ fontSize: 11, borderRadius: 8, background: "rgba(0,0,0,0.75)", border: "none" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-1.5">
                  {pieData.map((entry) => (
                    <div key={entry.key} className="flex items-center gap-2 text-xs">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: entry.fill }} />
                      <span className="text-foreground/80 truncate flex-1">{entry.name}</span>
                      <span className="tabular-nums text-muted-foreground shrink-0">{entry.value}</span>
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
            <h2 className="text-sm font-semibold">近 7 天費用趨勢 (USD)</h2>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={dailyChartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} />
              <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(v) => `$${v.toFixed(3)}`} />
              <Tooltip
                formatter={(v: number) => [`$${v.toFixed(5)}`, "費用"]}
                contentStyle={{ fontSize: 11, borderRadius: 8, background: "rgba(0,0,0,0.75)", border: "none" }}
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
          <h2 className="text-sm font-semibold">最近使用紀錄</h2>
        </div>
        {statsQuery.isLoading ? (
          <ZenSkeleton lines={5} />
        ) : !stats?.recentLogs || stats.recentLogs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">還沒有使用紀錄</p>
        ) : (
          <div className="space-y-2">
            {stats.recentLogs.map((log) => (
              <div
                key={log.id}
                className="flex items-center gap-3 p-3 rounded-lg bg-muted/10 hover:bg-muted/20 transition-colors"
              >
                <div
                  className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                  style={{ background: MODALITY_COLORS[log.requestType] + "30" }}
                >
                  <span style={{ color: MODALITY_COLORS[log.requestType] }}>
                    {MODALITY_ICONS[log.requestType] ?? <Activity className="w-3 h-3" />}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {requestTypeLabels[log.requestType] || log.requestType}
                    </span>
                    <Badge
                      variant={log.responseStatus === "success" ? "secondary" : "destructive"}
                      className="text-[10px] rounded-md"
                    >
                      {log.responseStatus === "success"
                        ? "成功"
                        : log.responseStatus === "blocked"
                        ? "已攔截"
                        : "失敗"}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {log.apiProvider} | {log.tokensUsed ?? 0} tokens | ${log.estimatedCostUsd ?? "0"}
                  </p>
                </div>
                <span className="text-[11px] text-muted-foreground shrink-0">
                  {new Date(log.createdAt).toLocaleString("zh-TW")}
                </span>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
