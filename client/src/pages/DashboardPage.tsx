import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Zap, DollarSign, Clock, TrendingUp, LayoutDashboard } from "lucide-react";
import { GlassCard, ZenSkeleton } from "@/components/ZenCoPilot";
import { motion } from "framer-motion";

const requestTypeLabels: Record<string, string> = {
  image_generation: "圖片生成",
  video_generation: "影片生成",
  audio_generation: "音樂生成",
  voice_dubbing: "語音配音",
  safety_check: "安全檢查",
  prompt_expansion: "提示詞擴展",
  director_ai: "導演 AI",
};

export default function DashboardPage() {
  const { user } = useAuth();
  const statsQuery = trpc.dashboard.myStats.useQuery(undefined, { retry: false });
  const stats = statsQuery.data;

  const statCards = [
    { icon: Zap, label: "剩餘配額", value: stats?.remainingGenerations ?? user?.remainingGenerations ?? 0, unit: "次生成", color: "bg-zen-lavender/20" },
    { icon: BarChart3, label: "總請求數", value: stats?.totalRequests ?? 0, unit: "次 API 呼叫", color: "bg-zen-sky/20" },
    { icon: DollarSign, label: "預估成本", value: `$${stats?.totalCost?.toFixed(3) ?? "0.000"}`, unit: "USD", color: "bg-zen-peach/20" },
    { icon: TrendingUp, label: "效率指標", value: stats?.totalRequests ? (stats.totalCost / stats.totalRequests).toFixed(4) : "0.0000", unit: "USD/次", color: "bg-zen-sage/20" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <LayoutDashboard className="w-5 h-5 text-zen-smoke" />
        <h1 className="text-xl font-semibold">儀表板</h1>
      </div>

      <p className="text-xs text-muted-foreground">查看個人使用統計、配額餘額與成本分析。</p>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card, idx) => (
          <motion.div key={card.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.08 }}>
            <GlassCard>
              <div className={`w-9 h-9 rounded-lg ${card.color} flex items-center justify-center mb-3`}>
                <card.icon className="w-4 h-4 text-zen-smoke" />
              </div>
              <p className="text-[11px] text-muted-foreground">{card.label}</p>
              <p className="text-xl font-semibold mt-1">{card.value}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{card.unit}</p>
            </GlassCard>
          </motion.div>
        ))}
      </div>

      {/* Recent Usage Logs */}
      <GlassCard hover={false}>
        <div className="flex items-center gap-2 mb-4">
          <Clock className="w-4 h-4 text-zen-smoke" />
          <h2 className="text-sm font-semibold">最近使用紀錄</h2>
        </div>
        {statsQuery.isLoading ? (
          <ZenSkeleton lines={5} />
        ) : !stats?.recentLogs || stats.recentLogs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">還沒有使用紀錄</p>
        ) : (
          <div className="space-y-2">
            {stats.recentLogs.map((log) => (
              <div key={log.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/10 hover:bg-muted/20 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{requestTypeLabels[log.requestType] || log.requestType}</span>
                    <Badge variant={log.responseStatus === "success" ? "secondary" : "destructive"} className="text-[10px] rounded-md">
                      {log.responseStatus === "success" ? "成功" : log.responseStatus === "blocked" ? "已攔截" : "失敗"}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {log.apiProvider} | {log.tokensUsed ?? 0} tokens | ${log.estimatedCostUsd ?? "0"}
                  </p>
                </div>
                <span className="text-[11px] text-muted-foreground shrink-0">{new Date(log.createdAt).toLocaleString("zh-TW")}</span>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
