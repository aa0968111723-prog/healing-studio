import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Zap, DollarSign, Clock, TrendingUp } from "lucide-react";
import { motion } from "framer-motion";

export default function DashboardPage() {
  const { user } = useAuth();
  const statsQuery = trpc.dashboard.myStats.useQuery(undefined, { retry: false });

  const stats = statsQuery.data;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">儀表板</h1>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0 }}
          className="healing-card bg-card p-4"
        >
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <Zap className="w-4 h-4" />
            <span className="text-xs">剩餘配額</span>
          </div>
          <p className="text-2xl font-semibold">{stats?.remainingGenerations ?? user?.remainingGenerations ?? 0}</p>
          <p className="text-xs text-muted-foreground mt-1">次生成</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="healing-card bg-card p-4"
        >
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <BarChart3 className="w-4 h-4" />
            <span className="text-xs">總請求數</span>
          </div>
          <p className="text-2xl font-semibold">{stats?.totalRequests ?? 0}</p>
          <p className="text-xs text-muted-foreground mt-1">次 API 呼叫</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="healing-card bg-card p-4"
        >
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <DollarSign className="w-4 h-4" />
            <span className="text-xs">預估成本</span>
          </div>
          <p className="text-2xl font-semibold">${stats?.totalCost?.toFixed(3) ?? "0.000"}</p>
          <p className="text-xs text-muted-foreground mt-1">USD</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="healing-card bg-card p-4"
        >
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <TrendingUp className="w-4 h-4" />
            <span className="text-xs">效率指標</span>
          </div>
          <p className="text-2xl font-semibold">
            {stats?.totalRequests ? (stats.totalCost / stats.totalRequests).toFixed(4) : "0.0000"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">USD/次</p>
        </motion.div>
      </div>

      {/* Recent Usage Logs */}
      <div className="healing-card bg-card p-4">
        <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5" />
          最近使用紀錄
        </h2>
        {statsQuery.isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 bg-muted/30 animate-pulse rounded-[15px]" />
            ))}
          </div>
        ) : !stats?.recentLogs || stats.recentLogs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">還沒有使用紀錄</p>
        ) : (
          <div className="space-y-2">
            {stats.recentLogs.map((log) => (
              <div
                key={log.id}
                className="flex items-center gap-3 p-3 rounded-[15px] bg-muted/20 hover:bg-muted/30 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {log.requestType === "image_generation" ? "圖片生成" :
                       log.requestType === "video_generation" ? "影片生成" :
                       log.requestType === "audio_generation" ? "音樂生成" :
                       log.requestType === "voice_dubbing" ? "語音配音" :
                       log.requestType === "safety_check" ? "安全檢查" :
                       log.requestType === "prompt_expansion" ? "提示詞擴展" :
                       log.requestType === "director_ai" ? "導演 AI" : log.requestType}
                    </span>
                    <Badge
                      variant={log.responseStatus === "success" ? "secondary" : "destructive"}
                      className="text-xs rounded-[10px]"
                    >
                      {log.responseStatus === "success" ? "成功" : log.responseStatus === "blocked" ? "已攔截" : "失敗"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {log.apiProvider} | {log.tokensUsed ?? 0} tokens | ${log.estimatedCostUsd ?? "0"}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {new Date(log.createdAt).toLocaleString("zh-TW")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
