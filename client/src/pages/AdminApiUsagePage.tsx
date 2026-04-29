import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { GlassCard, ZenSkeleton } from "@/components/ZenCoPilot";
import { useRegisterPageAgent, type AgentActionResult } from "@/contexts/PageAgentContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  BarChart3,
  DollarSign,
  Download,
  Plus,
  Shield,
  Trash2,
  Wallet,
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
} from "recharts";

// ─── Constants ───────────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<string, string> = {
  fal_ai: "Fal.ai",
  gemini: "Google Gemini",
  elevenlabs: "ElevenLabs",
  suno: "Suno",
};

const PROVIDER_COLORS: Record<string, string> = {
  fal_ai: "#8b5cf6",
  gemini: "#3b82f6",
  elevenlabs: "#10b981",
  suno: "#f59e0b",
};

// ─── KPI Card ────────────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon,
  label,
  value,
  color = "text-primary",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
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
        </div>
      </div>
    </GlassCard>
  );
}

// ─── Balance Bar ─────────────────────────────────────────────────────────────

function BalanceBar({
  provider,
  pct,
  remaining,
  quota,
}: {
  provider: string;
  pct: number | null;
  remaining: number;
  quota: number;
}) {
  const p = pct ?? 0;
  const color = p < 5 ? "bg-red-500" : p < 20 ? "bg-yellow-500" : "bg-green-500";
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground w-28 shrink-0">
        {PROVIDER_LABELS[provider] ?? provider}
      </span>
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${p}%` }} />
      </div>
      <span className="text-xs tabular-nums w-24 text-right">
        {remaining.toLocaleString()} / {quota.toLocaleString()}
      </span>
    </div>
  );
}

// ─── Overview Tab ────────────────────────────────────────────────────────────

function OverviewTab() {
  const overview = trpc.apiUsage.overview.useQuery(undefined, { retry: false });

  if (overview.isLoading) return <ZenSkeleton className="h-64" />;
  if (overview.error) return <p className="hs-small text-destructive">載入失敗：{overview.error.message}</p>;

  const data = overview.data;

  // Transform daily costs for stacked area chart
  const chartMap = new Map<string, Record<string, number>>();
  for (const d of data?.dailyCosts ?? []) {
    const dateStr = typeof d.date === "string" ? d.date : new Date(d.date).toISOString().slice(0, 10);
    if (!chartMap.has(dateStr)) chartMap.set(dateStr, { date: 0 });
    const entry = chartMap.get(dateStr)!;
    entry[d.provider] = (entry[d.provider] ?? 0) + d.cost;
  }
  const chartData = Array.from(chartMap.entries())
    .map(([date, vals]) => ({ date, ...vals }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard icon={BarChart3} label="本月呼叫數" value={data?.monthCalls?.toLocaleString() ?? "0"} />
        <KpiCard
          icon={DollarSign}
          label="本月總費用"
          value={`$${(data?.monthCost ?? 0).toFixed(2)}`}
          color="text-blue-500"
        />
        <KpiCard
          icon={Wallet}
          label="加總餘額"
          value={`$${(data?.totalBalance ?? 0).toFixed(2)}`}
          color="text-green-500"
        />
        <KpiCard
          icon={AlertTriangle}
          label="24h 錯誤率"
          value={`${data?.errorRate24h ?? 0}%`}
          color={(data?.errorRate24h ?? 0) > 5 ? "text-red-500" : "text-muted-foreground"}
        />
      </div>

      {/* Stacked Area Chart */}
      {chartData.length > 0 && (
        <GlassCard>
          <p className="hs-small !mb-2 text-muted-foreground">近 30 天每日費用趨勢</p>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              {Object.entries(PROVIDER_COLORS).map(([key, color]) => (
                <Area
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stackId="1"
                  stroke={color}
                  fill={color}
                  fillOpacity={0.4}
                  name={PROVIDER_LABELS[key]}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </GlassCard>
      )}

      {/* Balance Bars */}
      {(data?.providerBalances?.length ?? 0) > 0 && (
        <GlassCard>
          <p className="hs-small !mb-3 text-muted-foreground">各供應商餘額</p>
          <div className="space-y-3">
            {data!.providerBalances.map(b => (
              <BalanceBar
                key={b.provider}
                provider={b.provider}
                pct={b.pct}
                remaining={b.remaining}
                quota={b.quota}
              />
            ))}
          </div>
        </GlassCard>
      )}
    </motion.div>
  );
}

// ─── Usage by Provider Tab ───────────────────────────────────────────────────

function ProvidersTab() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const query = trpc.apiUsage.usageByProvider.useQuery(
    {
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
    },
    { retry: false }
  );

  if (query.isLoading) return <ZenSkeleton className="h-48" />;
  if (query.error) return <p className="hs-small text-destructive">載入失敗</p>;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Input
          type="date"
          className="w-40"
          value={startDate}
          onChange={e => setStartDate(e.target.value)}
          placeholder="開始日期"
        />
        <Input
          type="date"
          className="w-40"
          value={endDate}
          onChange={e => setEndDate(e.target.value)}
          placeholder="結束日期"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {query.data?.providers.map(p => (
          <GlassCard key={p.provider}>
            <div className="flex items-center gap-2 mb-3">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: PROVIDER_COLORS[p.provider] }}
              />
              <span className="hs-h3 !mb-0">{PROVIDER_LABELS[p.provider]}</span>
              {p.latestSnapshot?.tier && (
                <Badge variant="outline" className="ml-auto text-[10px]">
                  {p.latestSnapshot.tier}
                </Badge>
              )}
            </div>
            {p.latestSnapshot && (
              <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground mb-3">
                <div>
                  <span className="block">配額</span>
                  <span className="font-medium text-foreground">
                    {Number(p.latestSnapshot.quota ?? 0).toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="block">剩餘</span>
                  <span className="font-medium text-foreground">
                    {Number(p.latestSnapshot.remaining ?? 0).toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="block">餘額</span>
                  <span className="font-medium text-foreground">
                    ${Number(p.latestSnapshot.balanceUsd ?? 0).toFixed(2)}
                  </span>
                </div>
              </div>
            )}
            {p.recentCosts.length > 0 && (
              <ResponsiveContainer width="100%" height={100}>
                <BarChart data={[...p.recentCosts].reverse()}>
                  <XAxis dataKey="date" tick={{ fontSize: 9 }} />
                  <Tooltip />
                  <Bar
                    dataKey="totalCostUsd"
                    fill={PROVIDER_COLORS[p.provider]}
                    radius={[4, 4, 0, 0]}
                    name="費用 (USD)"
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </GlassCard>
        ))}
      </div>
    </motion.div>
  );
}

// ─── Rate Limit Tab ──────────────────────────────────────────────────────────

function RateLimitTab() {
  const utils = trpc.useUtils();
  const rulesQuery = trpc.apiUsage.rateLimits.list.useQuery(undefined, { retry: false });
  const upsertMut = trpc.apiUsage.rateLimits.upsert.useMutation({
    onSuccess: () => {
      utils.apiUsage.rateLimits.list.invalidate();
      toast.success("規則已儲存");
    },
  });
  const deleteMut = trpc.apiUsage.rateLimits.delete.useMutation({
    onSuccess: () => {
      utils.apiUsage.rateLimits.list.invalidate();
      toast.success("規則已刪除");
    },
  });

  const [form, setForm] = useState({
    ruleType: "global" as "per_user" | "per_api_key" | "global",
    targetId: "",
    provider: "all",
    dailyCallLimit: "",
    dailyCostLimitUsd: "",
  });

  const handleAdd = () => {
    upsertMut.mutate({
      ruleType: form.ruleType,
      targetId: form.targetId || undefined,
      provider: form.provider === "all" ? undefined : form.provider,
      dailyCallLimit: form.dailyCallLimit ? Number(form.dailyCallLimit) : undefined,
      dailyCostLimitUsd: form.dailyCostLimitUsd ? Number(form.dailyCostLimitUsd) : undefined,
      isActive: true,
    });
    setForm({ ruleType: "global", targetId: "", provider: "all", dailyCallLimit: "", dailyCostLimitUsd: "" });
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
      <GlassCard>
        <p className="hs-h3 !mb-3">新增速率限制規則</p>
        <div className="flex flex-wrap gap-3 items-end">
          <Select value={form.ruleType} onValueChange={v => setForm(f => ({ ...f, ruleType: v as typeof f.ruleType }))}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="global">全域</SelectItem>
              <SelectItem value="per_user">每位使用者</SelectItem>
              <SelectItem value="per_api_key">每個 API Key</SelectItem>
            </SelectContent>
          </Select>
          {form.ruleType !== "global" && (
            <Input
              className="w-32"
              placeholder="目標 ID"
              value={form.targetId}
              onChange={e => setForm(f => ({ ...f, targetId: e.target.value }))}
            />
          )}
          <Select value={form.provider} onValueChange={v => setForm(f => ({ ...f, provider: v }))}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">所有供應商</SelectItem>
              {Object.entries(PROVIDER_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className="w-28"
            placeholder="每日呼叫"
            type="number"
            value={form.dailyCallLimit}
            onChange={e => setForm(f => ({ ...f, dailyCallLimit: e.target.value }))}
          />
          <Input
            className="w-28"
            placeholder="每日費用 $"
            type="number"
            step="0.01"
            value={form.dailyCostLimitUsd}
            onChange={e => setForm(f => ({ ...f, dailyCostLimitUsd: e.target.value }))}
          />
          <Button size="sm" onClick={handleAdd} disabled={upsertMut.isPending}>
            <Plus className="w-3 h-3 mr-1" /> 新增
          </Button>
        </div>
      </GlassCard>

      {rulesQuery.isLoading ? (
        <ZenSkeleton className="h-32" />
      ) : (
        <GlassCard>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left pb-2">類型</th>
                  <th className="text-left pb-2">目標</th>
                  <th className="text-left pb-2">供應商</th>
                  <th className="text-right pb-2">每日呼叫上限</th>
                  <th className="text-right pb-2">每日費用上限</th>
                  <th className="text-right pb-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {rulesQuery.data?.map(rule => (
                  <tr key={rule.id} className="border-b border-border/50">
                    <td className="py-2">
                      <Badge variant="outline">{rule.ruleType}</Badge>
                    </td>
                    <td>{rule.targetId || "—"}</td>
                    <td>{rule.provider ? (PROVIDER_LABELS[rule.provider] ?? rule.provider) : "所有"}</td>
                    <td className="text-right tabular-nums">{rule.dailyCallLimit ?? "—"}</td>
                    <td className="text-right tabular-nums">
                      {rule.dailyCostLimitUsd ? `$${rule.dailyCostLimitUsd}` : "—"}
                    </td>
                    <td className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteMut.mutate({ id: rule.id })}
                        disabled={deleteMut.isPending}
                      >
                        <Trash2 className="w-3 h-3 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {rulesQuery.data?.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-6 text-muted-foreground">
                      尚無規則
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}
    </motion.div>
  );
}

// ─── Billing Tab ─────────────────────────────────────────────────────────────

function BillingTab() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const query = trpc.apiUsage.billing.useQuery(
    {
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
    },
    { retry: false }
  );

  const handleCsvExport = () => {
    if (!query.data?.rows?.length) return;
    const header = "Provider,Endpoint,Date,Calls,Units,Cost (USD)";
    const lines = query.data.rows.map(
      r =>
        `${r.provider},"${r.endpoint}",${typeof r.date === "string" ? r.date : new Date(r.date).toISOString().slice(0, 10)},${r.callCount},${r.totalUnits},${r.totalCostUsd.toFixed(6)}`
    );
    const csv = [header, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `api-billing-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV 已匯出");
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <Input type="date" className="w-40" value={startDate} onChange={e => setStartDate(e.target.value)} />
        <Input type="date" className="w-40" value={endDate} onChange={e => setEndDate(e.target.value)} />
        <Button variant="outline" size="sm" onClick={handleCsvExport} disabled={!query.data?.rows?.length}>
          <Download className="w-3 h-3 mr-1" /> CSV 匯出
        </Button>
      </div>

      {query.isLoading ? (
        <ZenSkeleton className="h-48" />
      ) : (
        <GlassCard>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left pb-2">供應商</th>
                  <th className="text-left pb-2">端點</th>
                  <th className="text-left pb-2">日期</th>
                  <th className="text-right pb-2">呼叫數</th>
                  <th className="text-right pb-2">單位數</th>
                  <th className="text-right pb-2">費用 (USD)</th>
                </tr>
              </thead>
              <tbody>
                {query.data?.rows?.map((r, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="py-1.5">{PROVIDER_LABELS[r.provider] ?? r.provider}</td>
                    <td className="font-mono text-[10px]">{r.endpoint}</td>
                    <td>{typeof r.date === "string" ? r.date : new Date(r.date).toISOString().slice(0, 10)}</td>
                    <td className="text-right tabular-nums">{r.callCount}</td>
                    <td className="text-right tabular-nums">{r.totalUnits.toFixed(2)}</td>
                    <td className="text-right tabular-nums">${r.totalCostUsd.toFixed(4)}</td>
                  </tr>
                ))}
                {query.data?.rows?.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-6 text-muted-foreground">尚無帳單資料</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}
    </motion.div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function AdminApiUsagePage() {
  const [activeTab, setActiveTab] = useState("overview");
  const [, navigate] = useLocation();

  // 與 AdminPage 同樣只暴露 navigate / setTab；不開放 destructive 動作。
  useRegisterPageAgent({
    pageId: "admin-api-usage",
    pageLabel: "API 用量分析",
    pagePath: "/admin/api-usage",
    capabilities: [
      {
        action: "navigate",
        label: "前往管理子頁",
        options: [
          { id: "/admin", label: "管理後台首頁" },
          { id: "/admin/api-usage", label: "API 用量分析" },
          { id: "/admin/brain-pipeline", label: "大腦推理鏈視覺化" },
        ],
      },
      {
        action: "setTab",
        label: "切換用量分頁",
        options: [
          { id: "overview", label: "總覽" },
          { id: "providers", label: "供應商" },
          { id: "rate-limit", label: "速率限制" },
          { id: "billing", label: "帳單" },
        ],
      },
    ],
    handle: async (action): Promise<AgentActionResult> => {
      if (action.type === "navigate" && typeof action.path === "string") {
        navigate(action.path);
        return { ok: true };
      }
      if (action.type === "setTab" && typeof action.tabId === "string") {
        setActiveTab(action.tabId);
        return { ok: true };
      }
      return { ok: false, reason: `admin-api-usage: unsupported action "${action.type}"` };
    },
  });

  return (
    <div className="flex-1 p-4 sm:p-8 max-w-7xl mx-auto w-full">
      <div className="flex items-center gap-3 mb-6">
        <Shield className="w-6 h-6 text-primary" />
        <div>
          <h1 className="hs-h2 !mb-0">API 用量管理</h1>
          <p className="hs-small !mb-0 text-muted-foreground">
            統一管理 AI 供應商呼叫次數、費用、配額與告警
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="overview">總覽</TabsTrigger>
          <TabsTrigger value="providers">供應商</TabsTrigger>
          <TabsTrigger value="rate-limit">速率限制</TabsTrigger>
          <TabsTrigger value="billing">帳單</TabsTrigger>
        </TabsList>

        <TabsContent value="overview"><OverviewTab /></TabsContent>
        <TabsContent value="providers"><ProvidersTab /></TabsContent>
        <TabsContent value="rate-limit"><RateLimitTab /></TabsContent>
        <TabsContent value="billing"><BillingTab /></TabsContent>
      </Tabs>
    </div>
  );
}
