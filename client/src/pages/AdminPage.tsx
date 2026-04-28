import { useState, lazy, Suspense, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Users,
  BarChart3,
  MessageSquare,
  Shield,
  RefreshCw,
  Activity,
  Database,
  Key,
  Eye,
  TrendingUp,
  Server,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  DollarSign,
  Cpu,
  Image,
  Film,
  Music,
  Mic,
  Brain,
  Search,
  GitBranch,
  Loader2,
  ExternalLink,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";
import { GlassCard, ZenSkeleton } from "@/components/ZenCoPilot";
import { motion } from "framer-motion";

const AiBrainSettings = lazy(() => import("./AiBrainSettings"));

// Shared modality icon map (avoid recreating in render loops)
const MODALITY_ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  image: Image,
  video: Film,
  audio: Music,
  voice: Mic,
};

// ─── Stat Card Component ─────────────────────────────────────────────────────
function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color = "text-primary",
}: {
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
          <p className="hs-h3-lg !mb-0 tabular-nums">{value}</p>
          {sub && <p className="hs-small !mb-0 text-muted-foreground">{sub}</p>}
        </div>
      </div>
    </GlassCard>
  );
}

// ─── Main Admin Page ─────────────────────────────────────────────────────────

export default function AdminPage() {
  const { user } = useAuth();
  const [quotaInputs, setQuotaInputs] = useState<Record<number, string>>({});
  const [autoCreditAmountInputs, setAutoCreditAmountInputs] = useState<
    Record<number, string>
  >({});
  const [autoCreditIntervalInputs, setAutoCreditIntervalInputs] = useState<
    Record<number, string>
  >({});
  const [autoCreditEnabledInputs, setAutoCreditEnabledInputs] = useState<
    Record<number, string>
  >({});
  const [userSearch, setUserSearch] = useState("");
  const [autoCreditFilter, setAutoCreditFilter] = useState<
    "all" | "enabled" | "disabled"
  >("all");
  const [activeTab, setActiveTab] = useState("overview");

  // ── Existing queries ──
  const usersQuery = trpc.admin.allUsers.useQuery(undefined, { retry: false });
  const feedbacksQuery = trpc.feedback.all.useQuery(undefined, {
    retry: false,
  });
  const costQuery = trpc.admin.teamCostSummary.useQuery(undefined, {
    retry: false,
  });

  // ── New queries ──
  const statsQuery = trpc.admin.systemStats.useQuery(undefined, {
    retry: false,
  });
  const activityQuery = trpc.admin.userActivity.useQuery(undefined, {
    retry: false,
  });
  const apiBreakdownQuery = trpc.admin.apiProviderBreakdown.useQuery(
    undefined,
    { retry: false }
  );
  const trendQuery = trpc.admin.systemDailyTrend.useQuery(
    { days: 30 },
    { retry: false }
  );
  const genHistoryQuery = trpc.admin.allGenerationHistory.useQuery(
    { limit: 100 },
    { retry: false }
  );
  const jobsQuery = trpc.admin.allBackgroundJobs.useQuery(
    { limit: 50 },
    { retry: false }
  );
  const apiKeysQuery = trpc.admin.apiKeysStatus.useQuery(undefined, {
    retry: false,
  });
  const usageLogsQuery = trpc.admin.usageLogs.useQuery(
    { limit: 100 },
    { retry: false }
  );

  // ── Mutations ──
  const updateQuota = trpc.admin.updateQuota.useMutation({
    onSuccess: () => {
      usersQuery.refetch();
      activityQuery.refetch();
      toast.success("配額已更新");
    },
    onError: e => toast.error(e.message),
  });

  const updateRole = trpc.admin.updateRole.useMutation({
    onSuccess: () => {
      usersQuery.refetch();
      activityQuery.refetch();
      toast.success("角色已更新");
    },
    onError: e => toast.error(e.message),
  });

  const updateAutoCreditPolicy = trpc.admin.updateAutoCreditPolicy.useMutation({
    onSuccess: () => {
      usersQuery.refetch();
      toast.success("自動給點策略已更新");
    },
    onError: e => toast.error(e.message),
  });

  const runAutoCreditNow = trpc.admin.runAutoCreditNow.useMutation({
    onSuccess: data => {
      usersQuery.refetch();
      toast.success(
        `已執行自動給點：${data.processedUsers} 人，合計 ${data.totalGranted} 點`
      );
    },
    onError: e => toast.error(e.message),
  });

  const updateFeedbackStatus = trpc.feedback.updateStatus.useMutation({
    onSuccess: () => {
      feedbacksQuery.refetch();
      toast.success("狀態已更新");
    },
  });

  // 僅限管理員存取此頁面
  if (user?.role !== "admin") {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <h3 className="text-base font-medium mt-6">權限不足</h3>
        <p className="text-sm text-muted-foreground mt-2">
          此頁面僅限管理員存取
        </p>
      </div>
    );
  }

  const stats = statsQuery.data;
  const users = usersQuery.data ?? [];
  const autoCreditSummary = useMemo(() => {
    const enabledUsers = users.filter(u => u.autoCreditEnabled);
    const now = Date.now();
    const dueUsers = enabledUsers.filter(u => {
      if (!u.autoCreditNextAt) return false;
      return new Date(u.autoCreditNextAt).getTime() <= now;
    });
    const totalScheduledPerCycle = enabledUsers.reduce(
      (sum, u) => sum + (u.autoCreditAmount ?? 0),
      0
    );
    return {
      totalUsers: users.length,
      enabledUsers: enabledUsers.length,
      dueUsers: dueUsers.length,
      totalScheduledPerCycle,
    };
  }, [users]);

  const filteredUsers = useMemo(() => {
    const kw = userSearch.trim().toLowerCase();
    return users.filter(u => {
      const matchFilter =
        autoCreditFilter === "all"
          ? true
          : autoCreditFilter === "enabled"
            ? Boolean(u.autoCreditEnabled)
            : !u.autoCreditEnabled;
      if (!matchFilter) return false;
      if (!kw) return true;
      const name = (u.name ?? "").toLowerCase();
      const email = (u.email ?? "").toLowerCase();
      return name.includes(kw) || email.includes(kw) || String(u.id).includes(kw);
    });
  }, [users, userSearch, autoCreditFilter]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Shield className="w-5 h-5 text-muted-foreground" />
        <h1 className="hs-h2 !mb-0">管理後台</h1>
        <Badge variant="outline" className="text-[10px]">
          管理員
        </Badge>
      </div>

      <p className="text-xs text-muted-foreground">
        管理使用者配額、角色權限、API 金鑰、系統監控、使用紀錄與回饋處理。
      </p>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="rounded-xl bg-muted/40 p-1 flex-nowrap overflow-x-auto h-auto gap-1 w-full justify-start md:flex-wrap md:justify-center">
          <TabsTrigger
            value="overview"
            className="rounded-lg gap-1 text-xs shrink-0"
          >
            <TrendingUp className="w-3 h-3" /> 系統概覽
          </TabsTrigger>
          <TabsTrigger
            value="users"
            className="rounded-lg gap-1 text-xs shrink-0"
          >
            <Users className="w-3 h-3" /> 使用者管理
          </TabsTrigger>
          <TabsTrigger
            value="activity"
            className="rounded-lg gap-1 text-xs shrink-0"
          >
            <Eye className="w-3 h-3" /> 活動紀錄
          </TabsTrigger>
          <TabsTrigger
            value="api"
            className="rounded-lg gap-1 text-xs shrink-0"
          >
            <Database className="w-3 h-3" /> API / 資料庫
          </TabsTrigger>
          <TabsTrigger
            value="costs"
            className="rounded-lg gap-1 text-xs shrink-0"
          >
            <BarChart3 className="w-3 h-3" /> 成本金流
          </TabsTrigger>
          <TabsTrigger
            value="generations"
            className="rounded-lg gap-1 text-xs shrink-0"
          >
            <Image className="w-3 h-3" /> 生成歷史
          </TabsTrigger>
          <TabsTrigger
            value="jobs"
            className="rounded-lg gap-1 text-xs shrink-0"
          >
            <Server className="w-3 h-3" /> 背景任務
          </TabsTrigger>
          <TabsTrigger
            value="feedback"
            className="rounded-lg gap-1 text-xs shrink-0"
          >
            <MessageSquare className="w-3 h-3" /> 回饋
          </TabsTrigger>
          <TabsTrigger
            value="brain"
            className="rounded-lg gap-1 text-xs shrink-0"
          >
            <Brain className="w-3 h-3" /> 大腦組態
          </TabsTrigger>
          <TabsTrigger
            value="ai-research"
            className="rounded-lg gap-1 text-xs shrink-0"
          >
            <Search className="w-3 h-3" /> AI 全站研究
          </TabsTrigger>
        </TabsList>

        {/* ═══ Tab 1: System Overview ═══ */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          {statsQuery.isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[1, 2, 3, 4, 5, 6].map(i => (
                <GlassCard key={i} hover={false}>
                  <ZenSkeleton lines={2} />
                </GlassCard>
              ))}
            </div>
          ) : stats ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <StatCard
                  icon={Users}
                  label="總使用者"
                  value={stats.totalUsers}
                />
                <StatCard
                  icon={Activity}
                  label="總生成次數"
                  value={stats.totalGenerations}
                />
                <StatCard
                  icon={Database}
                  label="總 API 呼叫"
                  value={stats.totalApiCalls}
                />
                <StatCard
                  icon={DollarSign}
                  label="總成本 (USD)"
                  value={`$${parseFloat(stats.totalCost).toFixed(2)}`}
                  color="text-orange-500"
                />
                <StatCard
                  icon={Server}
                  label="背景任務"
                  value={stats.totalJobs}
                  sub={`進行中: ${stats.activeJobs} | 失敗: ${stats.failedJobs}`}
                />
                <StatCard
                  icon={Image}
                  label="數位資產"
                  value={stats.totalAssets}
                />
              </div>

              {/* Daily trend mini chart */}
              {trendQuery.data &&
                trendQuery.data.length > 0 &&
                (() => {
                  const trendData = trendQuery.data;
                  const maxCalls = Math.max(
                    ...trendData.map(x => x.totalCalls),
                    1
                  );
                  return (
                    <GlassCard>
                      <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                        <TrendingUp className="w-4 h-4" /> 近 30 天系統使用趨勢
                      </h3>
                      <div className="flex items-end gap-1 h-24">
                        {trendData.map((d, i) => {
                          const height = Math.max(
                            4,
                            (d.totalCalls / maxCalls) * 100
                          );
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
                        <span className="hs-small !mb-0 text-muted-foreground">
                          {trendData[0]?.date}
                        </span>
                        <span className="hs-small !mb-0 text-muted-foreground">
                          {trendData[trendData.length - 1]?.date}
                        </span>
                      </div>
                    </GlassCard>
                  );
                })()}
            </>
          ) : (
            <p className="text-center text-muted-foreground py-8 text-sm">
              無法載入系統統計
            </p>
          )}
        </TabsContent>

        {/* ═══ Tab 2: Users Management ═══ */}
        <TabsContent value="users" className="mt-4 space-y-2">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <GlassCard hover={false}>
              <p className="text-[11px] text-muted-foreground">使用者總數</p>
              <p className="text-base font-semibold">{autoCreditSummary.totalUsers}</p>
            </GlassCard>
            <GlassCard hover={false}>
              <p className="text-[11px] text-muted-foreground">已啟用自動給點</p>
              <p className="text-base font-semibold">{autoCreditSummary.enabledUsers}</p>
            </GlassCard>
            <GlassCard hover={false}>
              <p className="text-[11px] text-muted-foreground">目前已到期</p>
              <p className="text-base font-semibold">{autoCreditSummary.dueUsers}</p>
            </GlassCard>
            <GlassCard hover={false}>
              <p className="text-[11px] text-muted-foreground">每期排程總額</p>
              <p className="text-base font-semibold">
                {autoCreditSummary.totalScheduledPerCycle} 點
              </p>
            </GlassCard>
          </div>

          <div className="flex flex-col md:flex-row gap-2 md:items-center md:justify-between">
            <div className="flex gap-2">
              <Input
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
                placeholder="搜尋使用者（名稱 / Email / ID）"
                className="h-8 rounded-lg text-xs md:w-72"
              />
              <Select
                value={autoCreditFilter}
                onValueChange={v =>
                  setAutoCreditFilter(v as "all" | "enabled" | "disabled")
                }
              >
                <SelectTrigger className="h-8 rounded-lg text-xs w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部</SelectItem>
                  <SelectItem value="enabled">僅看已啟用</SelectItem>
                  <SelectItem value="disabled">僅看未啟用</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="rounded-lg h-8 text-xs"
              onClick={() => runAutoCreditNow.mutate()}
              disabled={runAutoCreditNow.isPending}
            >
              {runAutoCreditNow.isPending ? "執行中..." : "立即執行自動給點"}
            </Button>
          </div>
          {usersQuery.isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <GlassCard key={i} hover={false}>
                  <ZenSkeleton lines={2} />
                </GlassCard>
              ))}
            </div>
          ) : filteredUsers.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-sm">
              查無符合條件的使用者
            </p>
          ) : (
            filteredUsers.map(u => (
              <motion.div
                key={u.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                <GlassCard>
                  <div className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">
                          {u.name || "未命名"}
                        </p>
                        <Badge
                          variant={u.role === "admin" ? "default" : "secondary"}
                          className="text-[10px] rounded-md"
                        >
                          {u.role === "admin" ? "管理員" : "使用者"}
                        </Badge>
                      </div>
                      <p className="hs-small !mb-0 text-muted-foreground mt-0.5">
                        {u.email || "無信箱"} | 配額: {u.remainingGenerations} |
                        註冊:{" "}
                        {new Date(u.createdAt).toLocaleDateString("zh-TW")}
                      </p>
                      <div className="mt-1.5 flex gap-1">
                        <Badge
                          variant={u.autoCreditEnabled ? "default" : "outline"}
                          className="text-[10px] rounded-md"
                        >
                          {u.autoCreditEnabled ? "自動給點啟用中" : "自動給點關閉"}
                        </Badge>
                        {u.autoCreditEnabled && u.autoCreditAmount > 0 ? (
                          <Badge variant="secondary" className="text-[10px] rounded-md">
                            每 {u.autoCreditIntervalDays} 天 +{u.autoCreditAmount} 點
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Role Toggle */}
                      <Select
                        value={u.role}
                        onValueChange={v =>
                          updateRole.mutate({
                            userId: u.id,
                            role: v as "user" | "admin",
                          })
                        }
                      >
                        <SelectTrigger className="w-20 h-8 rounded-lg text-[11px]">
                          <SelectValue />
                        </SelectTrigger>
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
                        onChange={e =>
                          setQuotaInputs(prev => ({
                            ...prev,
                            [u.id]: e.target.value,
                          }))
                        }
                        className="w-20 h-8 rounded-lg text-xs"
                      />
                      <Button
                        size="sm"
                        className="rounded-lg h-8 w-8 p-0"
                        onClick={() => {
                          const amount = parseInt(quotaInputs[u.id] || "0");
                          if (amount >= 0)
                            updateQuota.mutate({ userId: u.id, amount });
                        }}
                        disabled={updateQuota.isPending}
                      >
                        <RefreshCw className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-2">
                    <Select
                      value={
                        autoCreditEnabledInputs[u.id] ??
                        (u.autoCreditEnabled ? "on" : "off")
                      }
                      onValueChange={v =>
                        setAutoCreditEnabledInputs(prev => ({
                          ...prev,
                          [u.id]: v,
                        }))
                      }
                    >
                      <SelectTrigger className="h-8 rounded-lg text-xs">
                        <SelectValue placeholder="自動給點" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="off">自動給點：關閉</SelectItem>
                        <SelectItem value="on">自動給點：啟用</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      min={0}
                      placeholder={`每期點數 (${u.autoCreditAmount ?? 0})`}
                      value={autoCreditAmountInputs[u.id] ?? ""}
                      onChange={e =>
                        setAutoCreditAmountInputs(prev => ({
                          ...prev,
                          [u.id]: e.target.value,
                        }))
                      }
                      className="h-8 rounded-lg text-xs"
                    />
                    <Input
                      type="number"
                      min={1}
                      placeholder={`週期天數 (${u.autoCreditIntervalDays ?? 7})`}
                      value={autoCreditIntervalInputs[u.id] ?? ""}
                      onChange={e =>
                        setAutoCreditIntervalInputs(prev => ({
                          ...prev,
                          [u.id]: e.target.value,
                        }))
                      }
                      className="h-8 rounded-lg text-xs"
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      className="rounded-lg h-8 text-xs"
                      disabled={updateAutoCreditPolicy.isPending}
                      onClick={() => {
                        const enabled =
                          (autoCreditEnabledInputs[u.id] ??
                            (u.autoCreditEnabled ? "on" : "off")) === "on";
                        const amount = Number.parseInt(
                          autoCreditAmountInputs[u.id] ??
                            String(u.autoCreditAmount ?? 0),
                          10
                        );
                        const intervalDays = Number.parseInt(
                          autoCreditIntervalInputs[u.id] ??
                            String(u.autoCreditIntervalDays ?? 7),
                          10
                        );
                        if (!Number.isFinite(amount) || amount < 0) {
                          toast.error("每期點數需為 0 或正整數");
                          return;
                        }
                        if (!Number.isFinite(intervalDays) || intervalDays < 1) {
                          toast.error("週期天數需為 1 以上整數");
                          return;
                        }
                        if (enabled && amount === 0) {
                          toast.error("啟用自動給點時，每期點數不可為 0");
                          return;
                        }
                        updateAutoCreditPolicy.mutate({
                          userId: u.id,
                          enabled,
                          amount,
                          intervalDays,
                        });
                      }}
                    >
                      儲存自動給點
                    </Button>
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    下次自動給點：
                    {u.autoCreditNextAt
                      ? new Date(u.autoCreditNextAt).toLocaleString("zh-TW")
                      : "未設定"}
                    {u.autoCreditEnabled &&
                    u.autoCreditNextAt &&
                    new Date(u.autoCreditNextAt).getTime() <= Date.now()
                      ? "（已到期待發放）"
                      : ""}
                    {" · "}上次發放：
                    {u.autoCreditLastAt
                      ? new Date(u.autoCreditLastAt).toLocaleString("zh-TW")
                      : "尚未發放"}
                    {u.autoCreditEnabled && u.autoCreditNextAt
                      ? (() => {
                          const diffMs =
                            new Date(u.autoCreditNextAt).getTime() - Date.now();
                          if (diffMs <= 0) return " · 目前可發放";
                          const diffDays = Math.ceil(
                            diffMs / (24 * 60 * 60 * 1000)
                          );
                          return ` · 約 ${diffDays} 天後發放`;
                        })()
                      : ""}
                  </p>
                </GlassCard>
              </motion.div>
            ))
          )}
        </TabsContent>

        {/* ═══ Tab 3: User Activity ═══ */}
        <TabsContent value="activity" className="mt-4 space-y-2">
          {activityQuery.isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <GlassCard key={i} hover={false}>
                  <ZenSkeleton lines={3} />
                </GlassCard>
              ))}
            </div>
          ) : !activityQuery.data || activityQuery.data.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-sm">
              沒有活動資料
            </p>
          ) : (
            activityQuery.data.map(a => (
              <motion.div
                key={a.userId}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                <GlassCard>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">
                          {a.name || "未命名"}
                        </p>
                        <Badge
                          variant={a.role === "admin" ? "default" : "secondary"}
                          className="text-[10px]"
                        >
                          {a.role}
                        </Badge>
                      </div>
                      <span className="hs-small !mb-0 text-muted-foreground">
                        最後登入:{" "}
                        {a.lastSignedIn
                          ? new Date(a.lastSignedIn).toLocaleString("zh-TW")
                          : "未知"}
                      </span>
                    </div>
                    <p className="hs-small !mb-0 text-muted-foreground">
                      {a.email || "無信箱"}
                    </p>
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
            <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
              <Key className="w-4 h-4" /> API 金鑰狀態
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {apiKeysQuery.isLoading
                ? [1, 2, 3, 4].map(i => (
                    <GlassCard key={i} hover={false}>
                      <ZenSkeleton lines={1} />
                    </GlassCard>
                  ))
                : apiKeysQuery.data?.map(k => (
                    <GlassCard key={k.name}>
                      <div className="flex items-center gap-3">
                        {k.isSet ? (
                          <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-medium">{k.label}</p>
                          <p className="hs-small !mb-0 text-muted-foreground">
                            {k.module} — {k.name}
                          </p>
                        </div>
                        <Badge
                          variant={k.isSet ? "default" : "destructive"}
                          className="text-[10px] ml-auto shrink-0"
                        >
                          {k.isSet ? "已設定" : "未設定"}
                        </Badge>
                      </div>
                    </GlassCard>
                  ))}
            </div>
          </div>

          {/* API Provider Breakdown */}
          <div>
            <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
              <Database className="w-4 h-4" /> API 供應商使用統計
            </h3>
            {apiBreakdownQuery.isLoading ? (
              <div className="space-y-2">
                {[1, 2].map(i => (
                  <GlassCard key={i} hover={false}>
                    <ZenSkeleton lines={2} />
                  </GlassCard>
                ))}
              </div>
            ) : !apiBreakdownQuery.data ||
              apiBreakdownQuery.data.length === 0 ? (
              <p className="text-center text-muted-foreground py-6 text-sm">
                沒有 API 使用資料
              </p>
            ) : (
              <div className="space-y-2">
                {apiBreakdownQuery.data.map((item, idx) => {
                  const total = item.successCount + item.failedCount;
                  const successRate =
                    total > 0
                      ? ((item.successCount / total) * 100).toFixed(1)
                      : "0";
                  return (
                    <GlassCard key={idx}>
                      <div className="flex items-center gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-xs font-medium">
                              {item.apiProvider}
                            </p>
                            <Badge variant="outline" className="text-[10px]">
                              {item.requestType}
                            </Badge>
                          </div>
                          <p className="hs-small !mb-0 text-muted-foreground mt-0.5">
                            {item.totalCalls} 次呼叫 | {item.totalTokens} tokens
                            | 成功率: {successRate}%
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-semibold">
                            ${parseFloat(String(item.totalCost)).toFixed(3)}
                          </p>
                          <p className="hs-small !mb-0 text-muted-foreground">
                            <span className="text-green-600">
                              {item.successCount}✓
                            </span>{" "}
                            <span className="text-red-500">
                              {item.failedCount}✗
                            </span>
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
            <div className="space-y-2">
              {[1, 2].map(i => (
                <GlassCard key={i} hover={false}>
                  <ZenSkeleton lines={2} />
                </GlassCard>
              ))}
            </div>
          ) : !costQuery.data || costQuery.data.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-sm">
              沒有成本資料
            </p>
          ) : (
            costQuery.data.map(item => {
              const u = usersQuery.data?.find(u => u.id === item.userId);
              const displayName =
                u?.name || u?.email || `使用者 #${item.userId}`;
              const displaySub =
                u?.email && u?.name ? u.email : `ID: ${item.userId}`;
              return (
                <GlassCard key={item.userId}>
                  <div className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {displayName}
                      </p>
                      <p className="hs-small !mb-0 text-muted-foreground mt-0.5">
                        {displaySub} | {item.totalRequests} 次請求 |{" "}
                        {item.totalTokens} tokens
                      </p>
                    </div>
                    <p className="hs-h3-lg !mb-0 shrink-0">
                      ${parseFloat(String(item.totalCost)).toFixed(3)}
                    </p>
                  </div>
                </GlassCard>
              );
            })
          )}
        </TabsContent>

        {/* ═══ Tab 6: All Generation History ═══ */}
        <TabsContent value="generations" className="mt-4 space-y-2">
          {genHistoryQuery.isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <GlassCard key={i} hover={false}>
                  <ZenSkeleton lines={2} />
                </GlassCard>
              ))}
            </div>
          ) : !genHistoryQuery.data || genHistoryQuery.data.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-sm">
              沒有生成歷史
            </p>
          ) : (
            genHistoryQuery.data.map(g => {
              const u = usersQuery.data?.find(u => u.id === g.userId);
              const ModalityIcon = MODALITY_ICONS[g.modality] || Cpu;
              return (
                <motion.div
                  key={g.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  <GlassCard>
                    <div className="flex items-start gap-3">
                      <div className="p-1.5 rounded-md bg-muted/50 shrink-0 mt-0.5">
                        <ModalityIcon className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">
                            {g.modality}
                          </Badge>
                          <span className="hs-small !mb-0 text-muted-foreground">
                            {u?.name || `使用者 #${g.userId}`}
                          </span>
                          <span className="hs-small !mb-0 text-muted-foreground ml-auto">
                            {new Date(g.createdAt).toLocaleString("zh-TW")}
                          </span>
                        </div>
                        {g.prompt && (
                          <p className="hs-small !mb-0 text-muted-foreground mt-1 line-clamp-2">
                            {g.prompt}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          {g.costCredits > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted/30">
                              {g.costCredits} 點
                            </span>
                          )}
                          {g.durationMs && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted/30">
                              {(g.durationMs / 1000).toFixed(1)}s
                            </span>
                          )}
                          {g.isBookmarked && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300">
                              ★ 已收藏
                            </span>
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
            <div className="space-y-2">
              {[1, 2].map(i => (
                <GlassCard key={i} hover={false}>
                  <ZenSkeleton lines={2} />
                </GlassCard>
              ))}
            </div>
          ) : !jobsQuery.data || jobsQuery.data.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-sm">
              沒有背景任務
            </p>
          ) : (
            jobsQuery.data.map(job => {
              const u = usersQuery.data?.find(u => u.id === job.userId);
              const statusColors: Record<string, string> = {
                queued:
                  "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
                processing:
                  "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
                completed:
                  "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
                failed:
                  "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
                cancelled:
                  "bg-gray-100 text-gray-600 dark:bg-gray-900/30 dark:text-gray-400",
              };
              return (
                <GlassCard key={job.id}>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">
                          {job.jobType}
                        </Badge>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded-full ${statusColors[job.status] || ""}`}
                        >
                          {job.status}
                        </span>
                        <span className="hs-small !mb-0 text-muted-foreground">
                          {u?.name || `使用者 #${job.userId}`}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="hs-small !mb-0 text-muted-foreground">
                          進度: {job.progress}%
                        </span>
                        {job.progressMessage && (
                          <span className="hs-small !mb-0 text-muted-foreground truncate">
                            — {job.progressMessage}
                          </span>
                        )}
                        <span className="hs-small !mb-0 text-muted-foreground ml-auto">
                          {new Date(job.createdAt).toLocaleString("zh-TW")}
                        </span>
                      </div>
                      {job.errorMessage && (
                        <p className="hs-small !mb-0 text-red-500 mt-1 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />{" "}
                          {job.errorMessage}
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
            <div className="space-y-2">
              {[1, 2].map(i => (
                <GlassCard key={i} hover={false}>
                  <ZenSkeleton lines={2} />
                </GlassCard>
              ))}
            </div>
          ) : !feedbacksQuery.data || feedbacksQuery.data.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-sm">
              沒有回饋
            </p>
          ) : (
            feedbacksQuery.data.map(fb => (
              <motion.div
                key={fb.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                <GlassCard>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{fb.title}</p>
                      {fb.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {fb.description}
                        </p>
                      )}
                      <div className="flex items-center gap-1.5 mt-2">
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted/30 font-medium">
                          {fb.category}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted/30 font-medium">
                          {fb.priority}
                        </span>
                      </div>
                    </div>
                    <Select
                      value={fb.status}
                      onValueChange={v =>
                        updateFeedbackStatus.mutate({
                          id: fb.id,
                          status: v as
                            | "open"
                            | "in_progress"
                            | "resolved"
                            | "closed",
                        })
                      }
                    >
                      <SelectTrigger className="w-24 h-7 rounded-lg text-[11px]">
                        <SelectValue />
                      </SelectTrigger>
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

        {/* ═══ Tab 9: Brain Configuration ═══ */}
        <TabsContent value="brain" className="mt-4">
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            }
          >
            <AiBrainSettings />
          </Suspense>
        </TabsContent>

        {/* ═══ Tab 10: AI Site Research ═══ */}
        <TabsContent value="ai-research" className="mt-4">
          <AiSiteResearchPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── AI Site Research Panel ─────────────────────────────────────────────────
// 自動抓漏程式缺陷、思考優化、管理員同意後自動連結 GitHub 修正

function AiSiteResearchPanel() {
  const [scanPrompt, setScanPrompt] = useState(
    "掃描全站程式碼，找出潛在缺陷、效能問題、安全漏洞、以及可優化的架構點"
  );
  const [isScanning, setIsScanning] = useState(false);

  // ── Queries ──
  const proposalsQuery = trpc.brain.proposals.useQuery(undefined, {
    refetchInterval: 15_000,
  });
  const researchQuery = trpc.brain.researchResults.useQuery(undefined);
  const summaryQuery = trpc.brain.monitorSummary.useQuery(undefined, {
    refetchInterval: 15_000,
  });

  // ── Mutations ──
  const createProposalMut = trpc.brain.createProposal.useMutation({
    onSuccess: () => {
      toast.success("AI 研究提案已建立");
      proposalsQuery.refetch();
    },
    onError: e => toast.error(e.message),
  });
  const approveProposalMut = trpc.brain.approveProposal.useMutation({
    onSuccess: () => {
      toast.success("提案已核准，將自動連結 GitHub 修正");
      proposalsQuery.refetch();
    },
    onError: e => toast.error(e.message),
  });
  const rejectProposalMut = trpc.brain.rejectProposal.useMutation({
    onSuccess: () => {
      toast.success("提案已拒絕");
      proposalsQuery.refetch();
    },
    onError: e => toast.error(e.message),
  });
  const webSearchMut = trpc.brain.webSearch.useMutation({
    onSuccess: results => {
      toast.success(`找到 ${results.length} 筆研究結果`);
      researchQuery.refetch();
    },
    onError: e => toast.error(e.message),
  });
  const addToLearnHubMut = trpc.brain.addResearchToLearnHub.useMutation({
    onSuccess: () => {
      toast.success("已加入學習文件庫");
      researchQuery.refetch();
    },
    onError: e => toast.error(e.message),
  });

  const handleScan = async () => {
    setIsScanning(true);
    try {
      // Step 1: Web search for best practices and known issues
      await webSearchMut.mutateAsync({
        query: "healing studio AI multimodal platform common bugs optimization",
        maxResults: 5,
      });
      // Step 2: Create a self-reflection proposal for site-wide analysis
      await createProposalMut.mutateAsync({
        title: "AI 全站自動研究：程式缺陷與優化建議",
        description: scanPrompt,
        category: "prompt_optimization",
        currentValue: "目前全站未經 AI 自動掃描",
        proposedValue: "AI 自動掃描發現並產出優化建議",
        reasoning: scanPrompt,
        confidence: 70,
      });
    } finally {
      setIsScanning(false);
    }
  };

  const proposals = proposalsQuery.data ?? [];
  const research = researchQuery.data ?? [];
  const summary = summaryQuery.data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <GlassCard>
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Search className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">AI 全站自動研究系統</h3>
            <p className="hs-small !mb-0 text-muted-foreground">
              自動掃描程式碼缺陷、思考優化方案，經管理員同意後可自動連結 GitHub
              建立 Issue / PR 修正
            </p>
          </div>
        </div>

        {/* Stats */}
        {summary && (
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="text-center p-2 rounded-lg bg-muted/30">
              <p className="hs-h3-lg !mb-0">{summary.pendingProposals}</p>
              <p className="hs-small !mb-0 text-muted-foreground">待審核提案</p>
            </div>
            <div className="text-center p-2 rounded-lg bg-muted/30">
              <p className="hs-h3-lg !mb-0">{summary.totalResearch}</p>
              <p className="hs-small !mb-0 text-muted-foreground">研究資料</p>
            </div>
            <div className="text-center p-2 rounded-lg bg-muted/30">
              <p className="hs-h3-lg !mb-0">{summary.unresolvedErrors}</p>
              <p className="hs-small !mb-0 text-muted-foreground">未解決錯誤</p>
            </div>
          </div>
        )}

        {/* Scan Controls */}
        <div className="space-y-2">
          <Input
            value={scanPrompt}
            onChange={e => setScanPrompt(e.target.value)}
            placeholder="自訂研究指令..."
            className="text-xs"
          />
          <Button
            onClick={handleScan}
            disabled={isScanning || !scanPrompt.trim()}
            className="w-full gap-2 text-xs"
            size="sm"
          >
            {isScanning ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Search className="w-3 h-3" />
            )}
            {isScanning ? "AI 研究中..." : "啟動 AI 全站研究"}
          </Button>
        </div>
      </GlassCard>

      {/* Proposals requiring approval */}
      <GlassCard>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <GitBranch className="w-4 h-4" />
          優化提案（需管理員審核）
          {proposals.filter(p => p.status === "pending").length > 0 && (
            <Badge variant="destructive" className="text-[9px]">
              {proposals.filter(p => p.status === "pending").length} 待審核
            </Badge>
          )}
        </h3>
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {proposals.length === 0 ? (
            <p className="text-center text-muted-foreground py-4 text-xs">
              尚無提案。啟動 AI 研究以生成優化建議。
            </p>
          ) : (
            proposals.map(p => (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <div className="p-3 rounded-lg bg-muted/20 border border-white/5 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium">{p.title}</p>
                      <p className="hs-small !mb-0 text-muted-foreground mt-0.5 line-clamp-2">
                        {p.description}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[9px] shrink-0 ${
                        p.status === "pending"
                          ? "border-yellow-500/30 text-yellow-600"
                          : p.status === "approved"
                            ? "border-green-500/30 text-green-600"
                            : "border-red-500/30 text-red-600"
                      }`}
                    >
                      {p.status === "pending"
                        ? "待審核"
                        : p.status === "approved"
                          ? "已核准"
                          : "已拒絕"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1.5 hs-small !mb-0 text-muted-foreground">
                    <Badge variant="secondary" className="text-[9px]">
                      {p.category}
                    </Badge>
                    <span>{new Date(p.createdAt).toLocaleString("zh-TW")}</span>
                  </div>
                  {p.status === "pending" && (
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 text-[10px] h-7 border-green-500/30 hover:bg-green-500/10"
                        onClick={() =>
                          approveProposalMut.mutate({ proposalId: p.id })
                        }
                        disabled={approveProposalMut.isPending}
                      >
                        <ThumbsUp className="w-3 h-3" /> 核准並連結 GitHub
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 text-[10px] h-7 border-red-500/30 hover:bg-red-500/10"
                        onClick={() =>
                          rejectProposalMut.mutate({ proposalId: p.id })
                        }
                        disabled={rejectProposalMut.isPending}
                      >
                        <ThumbsDown className="w-3 h-3" /> 拒絕
                      </Button>
                    </div>
                  )}
                  {p.status === "approved" && (
                    <div className="flex items-center gap-1.5 hs-small !mb-0 text-green-600">
                      <CheckCircle2 className="w-3 h-3" />
                      已核准 — 系統將自動建立 GitHub Issue 追蹤修正
                    </div>
                  )}
                </div>
              </motion.div>
            ))
          )}
        </div>
      </GlassCard>

      {/* Research Results */}
      <GlassCard>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <ExternalLink className="w-4 h-4" />
          網路研究資料
        </h3>
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {research.length === 0 ? (
            <p className="text-center text-muted-foreground py-4 text-xs">
              尚無研究資料
            </p>
          ) : (
            research.slice(0, 20).map(r => (
              <div
                key={r.id}
                className="p-2 rounded-lg bg-muted/20 flex items-start justify-between gap-2"
              >
                <div className="min-w-0">
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium text-primary hover:underline line-clamp-1"
                  >
                    {r.title}
                  </a>
                  <p className="hs-small !mb-0 text-muted-foreground line-clamp-1">
                    {r.summary}
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Badge variant="secondary" className="text-[9px]">
                      {r.source}
                    </Badge>
                    <span className="hs-small !mb-0 text-muted-foreground">
                      相關度: {r.relevance}%
                    </span>
                  </div>
                </div>
                {!r.addedToLearnHub && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-[10px] h-6 shrink-0"
                    onClick={() =>
                      addToLearnHubMut.mutate({ researchId: r.id })
                    }
                    disabled={addToLearnHubMut.isPending}
                  >
                    加入學習庫
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      </GlassCard>
    </div>
  );
}
