import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Users, BarChart3, MessageSquare, Shield, RefreshCw, Activity,
  Database, Key, Eye, TrendingUp, Server, Clock, AlertTriangle,
  CheckCircle2, XCircle, DollarSign, Cpu, Image, Film, Music, Mic,
} from "lucide-react";
import { GlassCard, ZenSkeleton } from "@/components/ZenCoPilot";
import VisualSoul from "@/components/VisualSoul";
import { motion } from "framer-motion";
import { useAIState } from "@/contexts/AIStateContext";

// ─── Stat Card Component ─────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, sub, color = "text-primary" }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <GlassCard>
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg bg-muted/50 ${color}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold tabular-nums">{value}</p>
          {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
        </div>
      </div>
    </GlassCard>
  );
}

// ─── Main Admin Page ─────────────────────────────────────────────────────────

export default function AdminPage() {
  const { personality } = useAIState();
  const { user } = useAuth();
  const [quotaInputs, setQuotaInputs] = useState<Record<number, string>>({});
  const [activeTab, setActiveTab] = useState("overview");

  // ── Existing queries ──
  const usersQuery = trpc.admin.allUsers.useQuery(undefined, { retry: false });
  const feedbacksQuery = trpc.feedback.all.useQuery(undefined, { retry: false });
  const costQuery = trpc.admin.teamCostSummary.useQuery(undefined, { retry: false });

  // ── New queries ──
  const statsQuery = trpc.admin.systemStats.useQuery(undefined, { retry: false });
  const activityQuery = trpc.admin.userActivity.useQuery(undefined, { retry: false });
  const apiBreakdownQuery = trpc.admin.apiProviderBreakdown.useQuery(undefined, { retry: false });
  const trendQuery = trpc.admin.systemDailyTrend.useQuery({ days: 30 }, { retry: false });
  const genHistoryQuery = trpc.admin.allGenerationHistory.useQuery({ limit: 100 }, { retry: false });
  const jobsQuery = trpc.admin.allBackgroundJobs.useQuery({ limit: 50 }, { retry: false });
  const apiKeysQuery = trpc.admin.apiKeysStatus.useQuery(undefined, { retry: false });
  const usageLogsQuery = trpc.admin.usageLogs.useQuery({ limit: 100 }, { retry: false });

  // ── Mutations ──
  const updateQuota = trpc.admin.updateQuota.useMutation({
    onSuccess: () => {
      usersQuery.refetch();
      activityQuery.refetch();
      toast.success("配額已更新");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateRole = trpc.admin.updateRole.useMutation({
    onSuccess: () => {
      usersQuery.refetch();
      activityQuery.refetch();
      toast.success("角色已更新");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateFeedbackStatus = trpc.feedback.updateStatus.useMutation({
    onSuccess: () => {
      feedbacksQuery.refetch();
      toast.success("狀態已更新");
    },
  });

  if (user?.role !== "admin") {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <VisualSoul size="lg" personality={personality} />
        <h3 className="text-base font-medium mt-6">權限不足</h3>
        <p className="text-sm text-muted-foreground mt-2">此頁面僅限管理員存取</p>
      </div>
    );
  }

  const stats = statsQuery.data;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Shield className="w-5 h-5 text-muted-foreground" />
        <h1 className="text-xl font-semibold">管理後台</h1>
        <Badge variant="outline" className="text-[10px]">超級管理員</Badge>
      </div>

      <p className="text-xs text-muted-foreground">
        管理使用者配額、角色權限、API 金鑰、系統監控、使用紀錄與回饋處理。
      </p>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="rounded-xl bg-muted/40 p-1 flex-wrap h-auto gap-1">
          <TabsTrigger value="overview" className="rounded-lg gap-1 text-xs"><TrendingUp className="w-3 h-3" /> 系統概覽</TabsTrigger>
          <TabsTrigger value="users" className="rounded-lg gap-1 text-xs"><Users className="w-3 h-3" /> 使用者</TabsTrigger>
          <TabsTrigger value="activity" className="rounded-lg gap-1 text-xs"><Eye className="w-3 h-3" /> 活動紀錄</TabsTrigger>
          <TabsTrigger value="api" className="rounded-lg gap-1 text-xs"><Database className="w-3 h-3" /> API / 資料庫</TabsTrigger>
          <TabsTrigger value="costs" className="rounded-lg gap-1 text-xs"><BarChart3 className="w-3 h-3" /> 成本金流</TabsTrigger>
          <TabsTrigger value="generations" className="rounded-lg gap-1 text-xs"><Image className="w-3 h-3" /> 生成歷史</TabsTrigger>
          <TabsTrigger value="jobs" className="rounded-lg gap-1 text-xs"><Server className="w-3 h-3" /> 背景任務</TabsTrigger>
          <TabsTrigger value="feedback" className="rounded-lg gap-1 text-xs"><MessageSquare className="w-3 h-3" /> 回饋</TabsTrigger>
        </TabsList>

        {/* ═══ Tab 1: System Overview ═══ */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          {statsQuery.isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[1, 2, 3, 4, 5, 6].map(i => <GlassCard key={i} hover={false}><ZenSkeleton lines={2} /></GlassCard>)}
            </div>
          ) : stats ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <StatCard icon={Users} label="總使用者" value={stats.totalUsers} />
                <StatCard icon={Activity} label="總生成次數" value={stats.totalGenerations} />
                <StatCard icon={Database} label="總 API 呼叫" value={stats.totalApiCalls} />
                <StatCard icon={DollarSign} label="總成本 (USD)" value={`$${parseFloat(stats.totalCost).toFixed(2)}`} color="text-orange-500" />
                <StatCard icon={Server} label="背景任務" value={stats.totalJobs} sub={`進行中: ${stats.activeJobs} | 失敗: ${stats.failedJobs}`} />
                <StatCard icon={Image} label="數位資產" value={stats.totalAssets} />
              </div>

              {/* Daily trend mini chart */}
              {trendQuery.data && trendQuery.data.length > 0 && (
                <GlassCard>
                  <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" /> 近 30 天系統使用趨勢
                  </h3>
                  <div className="flex items-end gap-1 h-24">
                    {trendQuery.data.map((d, i) => {
                      const maxCalls = Math.max(...trendQuery.data!.map(x => x.totalCalls), 1);
                      const height = Math.max(4, (d.totalCalls / maxCalls) * 100);
                      return (
                        <div
                          key={i}
                          className="flex-1 bg-primary/60 rounded-t hover:bg-primary transition-colors"
                          style={{ height: `${height}%` }}
                          title={`${d.date}: ${d.totalCalls} 次呼叫, ${d.uniqueUsers} 使用者, $${parseFloat(d.totalCost).toFixed(3)}`}
                        />
                      );
                    })}
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-[10px] text-muted-foreground">{trendQuery.data[0]?.date}</span>
                    <span className="text-[10px] text-muted-foreground">{trendQuery.data[trendQuery.data.length - 1]?.date}</span>
                  </div>
                </GlassCard>
              )}
            </>
          ) : (
            <p className="text-center text-muted-foreground py-8 text-sm">無法載入系統統計</p>
          )}
        </TabsContent>

        {/* ═══ Tab 2: Users Management ═══ */}
        <TabsContent value="users" className="mt-4 space-y-2">
          {usersQuery.isLoading ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => (<GlassCard key={i} hover={false}><ZenSkeleton lines={2} /></GlassCard>))}</div>
          ) : (
            usersQuery.data?.map((u) => (
              <motion.div key={u.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <GlassCard>
                  <div className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{u.name || "未命名"}</p>
                        <Badge variant={u.role === "admin" ? "default" : "secondary"} className="text-[10px] rounded-md">{u.role === "admin" ? "管理員" : "使用者"}</Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {u.email || "無信箱"} | 配額: {u.remainingGenerations} | 註冊: {new Date(u.createdAt).toLocaleDateString("zh-TW")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Role Toggle */}
                      <Select
                        value={u.role}
                        onValueChange={(v) => updateRole.mutate({ userId: u.id, role: v as "user" | "admin" })}
                      >
                        <SelectTrigger className="w-20 h-8 rounded-lg text-[11px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="user">使用者</SelectItem>
                          <SelectItem value="admin">管理員</SelectItem>
                        </SelectContent>
                      </Select>
                      {/* Quota update */}
                      <Input
                        type="number"
                        placeholder="配額"
                        value={quotaInputs[u.id] ?? ""}
                        onChange={(e) => setQuotaInputs((prev) => ({ ...prev, [u.id]: e.target.value }))}
                        className="w-20 h-8 rounded-lg text-xs"
                      />
                      <Button
                        size="sm"
                        className="rounded-lg h-8 w-8 p-0"
                        onClick={() => { const amount = parseInt(quotaInputs[u.id] || "0"); if (amount >= 0) updateQuota.mutate({ userId: u.id, amount }); }}
                        disabled={updateQuota.isPending}
                      >
                        <RefreshCw className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            ))
          )}
        </TabsContent>

        {/* ═══ Tab 3: User Activity ═══ */}
        <TabsContent value="activity" className="mt-4 space-y-2">
          {activityQuery.isLoading ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => (<GlassCard key={i} hover={false}><ZenSkeleton lines={3} /></GlassCard>))}</div>
          ) : !activityQuery.data || activityQuery.data.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-sm">沒有活動資料</p>
          ) : (
            activityQuery.data.map((a) => (
              <motion.div key={a.userId} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <GlassCard>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{a.name || "未命名"}</p>
                        <Badge variant={a.role === "admin" ? "default" : "secondary"} className="text-[10px]">{a.role}</Badge>
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        最後登入: {a.lastSignedIn ? new Date(a.lastSignedIn).toLocaleString("zh-TW") : "未知"}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">{a.email || "無信箱"}</p>
                    <div className="flex flex-wrap gap-2 mt-1">
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                        API 呼叫: {a.totalApiCalls}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                        生成次數: {a.totalGenerations}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                        資產數: {a.totalAssets}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                        花費: ${parseFloat(String(a.totalCost)).toFixed(3)}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                        剩餘配額: {a.remainingGenerations}
                      </span>
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            ))
          )}
        </TabsContent>

        {/* ═══ Tab 4: API / Database / Keys ═══ */}
        <TabsContent value="api" className="mt-4 space-y-4">
          {/* API Keys Status */}
          <div>
            <h3 className="text-sm font-medium mb-2 flex items-center gap-2"><Key className="w-4 h-4" /> API 金鑰狀態</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {apiKeysQuery.isLoading ? (
                [1, 2, 3, 4].map(i => <GlassCard key={i} hover={false}><ZenSkeleton lines={1} /></GlassCard>)
              ) : (
                apiKeysQuery.data?.map((k) => (
                  <GlassCard key={k.name}>
                    <div className="flex items-center gap-3">
                      {k.isSet ? (
                        <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-medium">{k.label}</p>
                        <p className="text-[10px] text-muted-foreground">{k.module} — {k.name}</p>
                      </div>
                      <Badge variant={k.isSet ? "default" : "destructive"} className="text-[10px] ml-auto shrink-0">
                        {k.isSet ? "已設定" : "未設定"}
                      </Badge>
                    </div>
                  </GlassCard>
                ))
              )}
            </div>
          </div>

          {/* API Provider Breakdown */}
          <div>
            <h3 className="text-sm font-medium mb-2 flex items-center gap-2"><Database className="w-4 h-4" /> API 供應商使用統計</h3>
            {apiBreakdownQuery.isLoading ? (
              <div className="space-y-2">{[1, 2].map(i => <GlassCard key={i} hover={false}><ZenSkeleton lines={2} /></GlassCard>)}</div>
            ) : !apiBreakdownQuery.data || apiBreakdownQuery.data.length === 0 ? (
              <p className="text-center text-muted-foreground py-6 text-sm">沒有 API 使用資料</p>
            ) : (
              <div className="space-y-2">
                {apiBreakdownQuery.data.map((item, idx) => {
                  const total = item.successCount + item.failedCount;
                  const successRate = total > 0 ? ((item.successCount / total) * 100).toFixed(1) : "0";
                  return (
                    <GlassCard key={idx}>
                      <div className="flex items-center gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-xs font-medium">{item.apiProvider}</p>
                            <Badge variant="outline" className="text-[10px]">{item.requestType}</Badge>
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {item.totalCalls} 次呼叫 | {item.totalTokens} tokens | 成功率: {successRate}%
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-semibold">${parseFloat(String(item.totalCost)).toFixed(3)}</p>
                          <p className="text-[10px] text-muted-foreground">
                            <span className="text-green-600">{item.successCount}✓</span>{" "}
                            <span className="text-red-500">{item.failedCount}✗</span>
                          </p>
                        </div>
                      </div>
                    </GlassCard>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ═══ Tab 5: Cost / Billing ═══ */}
        <TabsContent value="costs" className="mt-4 space-y-2">
          {costQuery.isLoading ? (
            <div className="space-y-2">{[1, 2].map((i) => (<GlassCard key={i} hover={false}><ZenSkeleton lines={2} /></GlassCard>))}</div>
          ) : !costQuery.data || costQuery.data.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-sm">沒有成本資料</p>
          ) : (
            costQuery.data.map((item) => {
              const u = usersQuery.data?.find((u) => u.id === item.userId);
              const displayName = u?.name || u?.email || `使用者 #${item.userId}`;
              const displaySub = u?.email && u?.name ? u.email : `ID: ${item.userId}`;
              return (
                <GlassCard key={item.userId}>
                  <div className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{displayName}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{displaySub} | {item.totalRequests} 次請求 | {item.totalTokens} tokens</p>
                    </div>
                    <p className="text-lg font-semibold shrink-0">${parseFloat(String(item.totalCost)).toFixed(3)}</p>
                  </div>
                </GlassCard>
              );
            })
          )}
        </TabsContent>

        {/* ═══ Tab 6: All Generation History ═══ */}
        <TabsContent value="generations" className="mt-4 space-y-2">
          {genHistoryQuery.isLoading ? (
            <div className="space-y-2">{[1, 2, 3].map(i => <GlassCard key={i} hover={false}><ZenSkeleton lines={2} /></GlassCard>)}</div>
          ) : !genHistoryQuery.data || genHistoryQuery.data.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-sm">沒有生成歷史</p>
          ) : (
            genHistoryQuery.data.map((g) => {
              const u = usersQuery.data?.find(u => u.id === g.userId);
              const modalityIcons: Record<string, React.ComponentType<{ className?: string }>> = { image: Image, video: Film, audio: Music, voice: Mic };
              const ModalityIcon = modalityIcons[g.modality] || Cpu;
              return (
                <motion.div key={g.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <GlassCard>
                    <div className="flex items-start gap-3">
                      <div className="p-1.5 rounded-md bg-muted/50 shrink-0 mt-0.5">
                        <ModalityIcon className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">{g.modality}</Badge>
                          <span className="text-[10px] text-muted-foreground">
                            {u?.name || `使用者 #${g.userId}`}
                          </span>
                          <span className="text-[10px] text-muted-foreground ml-auto">
                            {new Date(g.createdAt).toLocaleString("zh-TW")}
                          </span>
                        </div>
                        {g.prompt && (
                          <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{g.prompt}</p>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          {g.costCredits > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted/30">{g.costCredits} 點</span>
                          )}
                          {g.durationMs && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted/30">{(g.durationMs / 1000).toFixed(1)}s</span>
                          )}
                          {g.isBookmarked && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300">★ 已收藏</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </GlassCard>
                </motion.div>
              );
            })
          )}
        </TabsContent>

        {/* ═══ Tab 7: Background Jobs ═══ */}
        <TabsContent value="jobs" className="mt-4 space-y-2">
          {jobsQuery.isLoading ? (
            <div className="space-y-2">{[1, 2].map(i => <GlassCard key={i} hover={false}><ZenSkeleton lines={2} /></GlassCard>)}</div>
          ) : !jobsQuery.data || jobsQuery.data.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-sm">沒有背景任務</p>
          ) : (
            jobsQuery.data.map((job) => {
              const u = usersQuery.data?.find(u => u.id === job.userId);
              const statusColors: Record<string, string> = {
                queued: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
                processing: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
                completed: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
                failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
                cancelled: "bg-gray-100 text-gray-600 dark:bg-gray-900/30 dark:text-gray-400",
              };
              return (
                <GlassCard key={job.id}>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">{job.jobType}</Badge>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${statusColors[job.status] || ""}`}>
                          {job.status}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {u?.name || `使用者 #${job.userId}`}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-muted-foreground">
                          進度: {job.progress}%
                        </span>
                        {job.progressMessage && (
                          <span className="text-[10px] text-muted-foreground truncate">— {job.progressMessage}</span>
                        )}
                        <span className="text-[10px] text-muted-foreground ml-auto">
                          {new Date(job.createdAt).toLocaleString("zh-TW")}
                        </span>
                      </div>
                      {job.errorMessage && (
                        <p className="text-[10px] text-red-500 mt-1 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> {job.errorMessage}
                        </p>
                      )}
                    </div>
                  </div>
                </GlassCard>
              );
            })
          )}
        </TabsContent>

        {/* ═══ Tab 8: Feedback ═══ */}
        <TabsContent value="feedback" className="mt-4 space-y-2">
          {feedbacksQuery.isLoading ? (
            <div className="space-y-2">{[1, 2].map((i) => (<GlassCard key={i} hover={false}><ZenSkeleton lines={2} /></GlassCard>))}</div>
          ) : !feedbacksQuery.data || feedbacksQuery.data.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-sm">沒有回饋</p>
          ) : (
            feedbacksQuery.data.map((fb) => (
              <motion.div key={fb.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <GlassCard>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{fb.title}</p>
                      {fb.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{fb.description}</p>}
                      <div className="flex items-center gap-1.5 mt-2">
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted/30 font-medium">{fb.category}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted/30 font-medium">{fb.priority}</span>
                      </div>
                    </div>
                    <Select value={fb.status} onValueChange={(v) => updateFeedbackStatus.mutate({ id: fb.id, status: v as "open" | "in_progress" | "resolved" | "closed" })}>
                      <SelectTrigger className="w-24 h-7 rounded-lg text-[11px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="open">開放</SelectItem>
                        <SelectItem value="in_progress">處理中</SelectItem>
                        <SelectItem value="resolved">已解決</SelectItem>
                        <SelectItem value="closed">已關閉</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </GlassCard>
              </motion.div>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
