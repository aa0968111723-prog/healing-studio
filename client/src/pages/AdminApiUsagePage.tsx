import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { trpc } from "@/lib/trpc";
import { toCsvRow } from "@shared/csv-safe";
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
  Flame,
  Plus,
  Shield,
  Trash2,
  TrendingUp,
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
    // 每格走 @shared/csv-safe：中和公式注入 + RFC-4180 引號跳脫（順修 provider 欄
    // 原本未引號、含逗號即錯欄的結構破壞 bug）— AIDV-562
    const lines = query.data.rows.map(r =>
      toCsvRow([
        r.provider,
        r.endpoint,
        typeof r.date === "string"
          ? r.date
          : new Date(r.date).toISOString().slice(0, 10),
        r.callCount,
        r.totalUnits,
        r.totalCostUsd.toFixed(6),
      ])
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

// ─── Deep Cost Analytics Tab ─────────────────────────────────────────────────
//
// 「深度成本」分頁：拆解全站呼叫的成本結構。
//   - 模態（LLM / 圖片 / 影片 / TTS …）
//   - Top-N 端點 / 使用者
//   - 狀態（成功 vs 失敗扣費）
//   - 延遲統計（p50 / p95 / p99）
//   - 7×24 熱力圖
//   - 浪費於失敗呼叫的金額
//   - 月底成本投影（線性外推）
//   - Catalog 預估 vs 實際扣費差異

const STATUS_LABELS: Record<string, string> = {
  success: "成功",
  failed: "失敗",
  timeout: "逾時",
  rate_limited: "速率受限",
};

const STATUS_COLORS: Record<string, string> = {
  success: "#10b981",
  failed: "#ef4444",
  timeout: "#f59e0b",
  rate_limited: "#a855f7",
};

const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

function DeepCostTab() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [provider, setProvider] = useState<string>("all");

  const query = trpc.apiUsage.deepCost.useQuery(
    {
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
      ...(provider !== "all"
        ? { provider: provider as "fal_ai" | "gemini" | "elevenlabs" | "suno" }
        : {}),
      topN: 20,
    },
    { retry: false }
  );

  if (query.isLoading) return <ZenSkeleton className="h-96" />;
  if (query.error)
    return <p className="hs-small text-destructive">載入失敗：{query.error.message}</p>;

  const data = query.data;
  if (!data) return null;

  const w = data.window;
  const proj = data.projection;
  const waste = data.waste;
  const lat = data.latency;
  const recon = data.reconciliation;

  // 熱力圖：先換算最大費用做色階
  const maxCellCost = Math.max(0.000001, ...data.heatmap.map(c => c.costUsd));

  const handleCsvExport = () => {
    // 前端聚合 CSV（資料已都在 data 裡，省一次 round-trip）
    const sections: string[][] = [];
    // 每格走 @shared/csv-safe：公式注入中和 + RFC-4180（含 provider/endpoint/userId
    // 等使用者可控欄位，原內嵌跳脫只做引號未防公式注入）— AIDV-562
    const push = (rows: (string | number)[][]) =>
      sections.push(rows.map(r => toCsvRow(r)));

    push([[`# Healing Studio 深度成本報表`]]);
    push([[`# 視窗：${w.start} → ${w.end}`]]);
    push([[`# 真值來源：${data.truth.source}`]]);
    push([[`# 真實總成本：$${data.truth.totalUsd.toFixed(6)}`]]);
    push([[]]);
    push([[`## 帳單對帳`]]);
    push([["Provider", "RecordedUsd", "InvoiceUsd", "GapUsd", "GapPct", "SnapshotAt"]]);
    for (const r of recon.perProvider) {
      push([[
        r.provider,
        r.recordedCostUsd,
        r.providerInvoiceUsd ?? "",
        r.gapUsd ?? "",
        r.gapPct ?? "",
        r.lastSnapshotAt ?? "",
      ]]);
    }
    push([["TOTAL", recon.totalRecordedUsd, recon.totalInvoicedUsd, recon.totalGapUsd, recon.totalGapPct ?? "", ""]]);
    push([[]]);

    push([[`## 模態`]]);
    push([["Category", "Calls", "Cost", "Avg", "Share%"]]);
    for (const c of data.byCategory) push([[c.label, c.callCount, c.costUsd, c.avgCostPerCall, c.share]]);
    push([[]]);

    push([[`## 功能模組`]]);
    push([["Feature", "Calls", "Cost", "Share%", "TopEndpoint"]]);
    for (const f of data.byFeature) push([[f.feature, f.callCount, f.costUsd, f.share, f.topEndpoint ?? ""]]);
    push([[]]);

    push([[`## Top 端點`]]);
    push([["Provider", "Endpoint", "Calls", "Cost", "Avg", "ErrorRate%"]]);
    for (const e of data.topEndpoints) push([[e.provider, e.endpoint, e.callCount, e.costUsd, e.avgCostPerCall, e.errorRate]]);
    push([[]]);

    push([[`## Top 使用者`]]);
    push([["UserId", "Calls", "Cost", "Avg", "TopEndpoint"]]);
    for (const u of data.topUsers) push([[u.userId, u.callCount, u.costUsd, u.avgCostPerCall, u.topEndpoint ?? ""]]);
    push([[]]);

    push([[`## Catalog vs 實際`]]);
    push([["Endpoint", "Calls", "Expected", "Actual", "Delta", "DeltaPct"]]);
    for (const c of data.catalogVsActual) push([[c.endpoint, c.callCount, c.expectedUsd, c.actualUsd, c.deltaUsd, c.deltaPct ?? ""]]);
    push([[]]);

    push([[`## 重試鏈`]]);
    push([["StartedAt", "UserId", "Endpoint", "Attempts", "TotalCost", "WindowSec", "FinalStatus"]]);
    for (const r of data.retryChains) push([[r.startedAt, r.userId, r.endpoint, r.attempts, r.totalCostUsd, r.windowSec, r.finalStatus]]);
    push([[]]);

    push([[`## 節費建議`]]);
    push([["Endpoint", "Suggested", "Calls", "Current", "AltCost", "Savings", "SavingsPct", "Risk"]]);
    for (const s of data.savingsSuggestions) push([[s.endpoint, s.suggestedEndpoint, s.callCount, s.currentCostUsd, s.suggestedCostUsd, s.monthlySavingsUsd, s.savingsPct, s.riskNote]]);

    const csv = sections.flat().join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `deep-cost-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("深度成本 CSV 已匯出");
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      {/* Source-of-Truth Banner */}
      <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-xs flex items-start gap-2">
        <Shield className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
        <div>
          <p className="font-medium">真實成本：${data.truth.totalUsd.toFixed(6)}</p>
          <p className="text-muted-foreground mt-0.5">
            數據真值來源：<code className="font-mono">{data.truth.source}</code>。
            「平台記錄」取自每筆呼叫實際扣費；「供應商帳單」取自最新一次
            <code className="font-mono">provider_snapshots.nextInvoice.amountUsd</code>。
            兩邊取較高值作為單一真值，避免漏記。
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
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
        <Select value={provider} onValueChange={setProvider}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">所有供應商</SelectItem>
            {Object.entries(PROVIDER_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={handleCsvExport}>
          <Download className="w-3 h-3 mr-1" /> 匯出深度報表 CSV
        </Button>
      </div>

      {/* Reconciliation Card */}
      <GlassCard>
        <div className="flex items-center gap-2 mb-3">
          <Wallet className="w-4 h-4 text-blue-500" />
          <p className="hs-h3 !mb-0">供應商帳單對帳（單一真值來源）</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs mb-3">
          <div className="rounded-md bg-muted/40 p-2">
            <p className="text-[10px] text-muted-foreground">平台記錄</p>
            <p className="font-medium tabular-nums">${recon.totalRecordedUsd.toFixed(6)}</p>
          </div>
          <div className="rounded-md bg-muted/40 p-2">
            <p className="text-[10px] text-muted-foreground">供應商帳單</p>
            <p className="font-medium tabular-nums">${recon.totalInvoicedUsd.toFixed(6)}</p>
          </div>
          <div className="rounded-md bg-muted/40 p-2">
            <p className="text-[10px] text-muted-foreground">缺口</p>
            <p
              className={`font-medium tabular-nums ${Math.abs(recon.totalGapUsd) > 0.01 ? "text-red-500" : ""}`}
            >
              {recon.totalGapUsd >= 0 ? "+" : ""}${recon.totalGapUsd.toFixed(6)}
              {recon.totalGapPct != null && (
                <span className="text-[10px] text-muted-foreground ml-1">
                  ({recon.totalGapPct >= 0 ? "+" : ""}
                  {recon.totalGapPct}%)
                </span>
              )}
            </p>
          </div>
          <div className="rounded-md bg-muted/40 p-2">
            <p className="text-[10px] text-muted-foreground">真實成本（取較高側）</p>
            <p className="font-medium tabular-nums text-blue-500">
              ${data.truth.totalUsd.toFixed(6)}
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="text-left pb-2">供應商</th>
                <th className="text-right pb-2">平台記錄</th>
                <th className="text-right pb-2">供應商帳單</th>
                <th className="text-right pb-2">缺口</th>
                <th className="text-right pb-2">缺口 %</th>
                <th className="text-left pb-2">最近 snapshot</th>
              </tr>
            </thead>
            <tbody>
              {recon.perProvider.map(r => {
                const significant = r.gapUsd != null && Math.abs(r.gapUsd) > 0.01;
                return (
                  <tr key={r.provider} className="border-b border-border/50">
                    <td className="py-1.5">{PROVIDER_LABELS[r.provider] ?? r.provider}</td>
                    <td className="text-right tabular-nums">${r.recordedCostUsd.toFixed(6)}</td>
                    <td className="text-right tabular-nums">
                      {r.providerInvoiceUsd != null
                        ? `$${r.providerInvoiceUsd.toFixed(6)}`
                        : "—"}
                    </td>
                    <td
                      className={`text-right tabular-nums ${significant ? "text-red-500" : ""}`}
                    >
                      {r.gapUsd == null
                        ? "—"
                        : `${r.gapUsd >= 0 ? "+" : ""}$${r.gapUsd.toFixed(6)}`}
                    </td>
                    <td className="text-right tabular-nums">
                      {r.gapPct == null ? "—" : `${r.gapPct >= 0 ? "+" : ""}${r.gapPct}%`}
                    </td>
                    <td className="text-[10px] font-mono text-muted-foreground">
                      {r.lastSnapshotAt
                        ? new Date(r.lastSnapshotAt).toLocaleString("zh-TW", { hour12: false })
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">
          缺口 &gt; 0 = 供應商帳單高於平台記錄（可能漏記呼叫）；缺口 &lt; 0 = 平台多扣（少見）。
          建議每次月結對帳缺口 &lt; 1%。
        </p>
      </GlassCard>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          icon={DollarSign}
          label="視窗內總費用"
          value={`$${w.totalCostUsd.toFixed(4)}`}
          color="text-blue-500"
        />
        <KpiCard
          icon={BarChart3}
          label="呼叫筆數"
          value={`${w.eventCount.toLocaleString()}${w.truncated ? "+" : ""}`}
        />
        <KpiCard
          icon={AlertTriangle}
          label={`浪費於失敗（${waste.wastedShare}%）`}
          value={`$${waste.wastedUsd.toFixed(4)}`}
          color={waste.wastedShare > 5 ? "text-red-500" : "text-muted-foreground"}
        />
        <KpiCard
          icon={TrendingUp}
          label={`月底投影（剩 ${proj.remainingDays} 天）`}
          value={`$${proj.projectedMonthEndUsd.toFixed(2)}`}
          color="text-green-500"
        />
      </div>

      {/* Latency Stats */}
      <GlassCard>
        <p className="hs-small !mb-3 text-muted-foreground">延遲統計（毫秒）</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
          {[
            { label: "樣本數", value: lat.sampleCount.toLocaleString() },
            { label: "平均", value: `${lat.avgMs} ms` },
            { label: "p50", value: `${lat.p50Ms} ms` },
            { label: "p95", value: `${lat.p95Ms} ms` },
            { label: "p99", value: `${lat.p99Ms} ms` },
          ].map(item => (
            <div key={item.label} className="rounded-md bg-muted/40 p-2">
              <p className="text-[10px] text-muted-foreground">{item.label}</p>
              <p className="font-medium tabular-nums">{item.value}</p>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Category Breakdown */}
      <GlassCard>
        <p className="hs-h3 !mb-3">模態成本拆解</p>
        {data.byCategory.length === 0 ? (
          <p className="hs-small text-muted-foreground">尚無資料</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left pb-2">模態</th>
                  <th className="text-right pb-2">呼叫</th>
                  <th className="text-right pb-2">成功 / 失敗</th>
                  <th className="text-right pb-2">總費用</th>
                  <th className="text-right pb-2">均費</th>
                  <th className="text-right pb-2">佔比</th>
                </tr>
              </thead>
              <tbody>
                {data.byCategory.map(c => (
                  <tr key={c.category} className="border-b border-border/50">
                    <td className="py-2 font-medium">{c.label}</td>
                    <td className="text-right tabular-nums">{c.callCount}</td>
                    <td className="text-right tabular-nums">
                      <span className="text-green-500">{c.successCount}</span>
                      <span className="text-muted-foreground"> / </span>
                      <span className="text-red-500">{c.failedCount}</span>
                    </td>
                    <td className="text-right tabular-nums">${c.costUsd.toFixed(4)}</td>
                    <td className="text-right tabular-nums">${c.avgCostPerCall.toFixed(6)}</td>
                    <td className="text-right tabular-nums">{c.share}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {/* Status Breakdown + Top Endpoints (兩欄) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <GlassCard>
          <p className="hs-h3 !mb-3">狀態成本拆解</p>
          <div className="space-y-2">
            {data.byStatus.map(s => {
              const widthPct = Math.min(100, s.share);
              return (
                <div key={s.status}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span style={{ color: STATUS_COLORS[s.status] }}>
                      {STATUS_LABELS[s.status] ?? s.status}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {s.callCount} 次 · ${s.costUsd.toFixed(4)} ({s.share}%)
                    </span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${widthPct}%`,
                        backgroundColor: STATUS_COLORS[s.status],
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </GlassCard>

        <GlassCard>
          <p className="hs-h3 !mb-3">月底投影</p>
          <div className="text-xs space-y-1.5">
            <p className="flex justify-between">
              <span className="text-muted-foreground">當月迄今</span>
              <span className="tabular-nums">${proj.monthToDateUsd.toFixed(4)}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-muted-foreground">每日平均</span>
              <span className="tabular-nums">${proj.averageDailyUsd.toFixed(4)}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-muted-foreground">經過 / 總天數</span>
              <span className="tabular-nums">
                {proj.daysElapsed} / {proj.daysInMonth}
              </span>
            </p>
            <p className="flex justify-between text-foreground font-medium pt-2 border-t">
              <span>月底投影</span>
              <span className="tabular-nums">${proj.projectedMonthEndUsd.toFixed(2)}</span>
            </p>
          </div>
        </GlassCard>
      </div>

      {/* Top Endpoints */}
      <GlassCard>
        <p className="hs-h3 !mb-3">最花錢端點 Top 20</p>
        {data.topEndpoints.length === 0 ? (
          <p className="hs-small text-muted-foreground">尚無資料</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left pb-2">供應商</th>
                  <th className="text-left pb-2">端點</th>
                  <th className="text-left pb-2">模態</th>
                  <th className="text-right pb-2">呼叫</th>
                  <th className="text-right pb-2">費用</th>
                  <th className="text-right pb-2">均費</th>
                  <th className="text-right pb-2">錯誤率</th>
                </tr>
              </thead>
              <tbody>
                {data.topEndpoints.map((ep, i) => (
                  <tr key={`${ep.provider}-${ep.endpoint}-${i}`} className="border-b border-border/50">
                    <td className="py-1.5">{PROVIDER_LABELS[ep.provider] ?? ep.provider}</td>
                    <td className="font-mono text-[10px]">{ep.endpoint}</td>
                    <td className="text-muted-foreground">{ep.category}</td>
                    <td className="text-right tabular-nums">{ep.callCount}</td>
                    <td className="text-right tabular-nums">${ep.costUsd.toFixed(4)}</td>
                    <td className="text-right tabular-nums">${ep.avgCostPerCall.toFixed(6)}</td>
                    <td className="text-right tabular-nums">
                      <span className={ep.errorRate > 10 ? "text-red-500" : ""}>
                        {ep.errorRate}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {/* Top Users */}
      <GlassCard>
        <p className="hs-h3 !mb-3">最花錢使用者 Top 20</p>
        {data.topUsers.length === 0 ? (
          <p className="hs-small text-muted-foreground">尚無資料</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left pb-2">使用者 ID</th>
                  <th className="text-right pb-2">呼叫</th>
                  <th className="text-right pb-2">費用</th>
                  <th className="text-right pb-2">均費</th>
                  <th className="text-left pb-2">最常使用端點</th>
                </tr>
              </thead>
              <tbody>
                {data.topUsers.map(u => (
                  <tr key={u.userId} className="border-b border-border/50">
                    <td className="py-1.5 font-mono">{u.userId}</td>
                    <td className="text-right tabular-nums">{u.callCount}</td>
                    <td className="text-right tabular-nums">${u.costUsd.toFixed(4)}</td>
                    <td className="text-right tabular-nums">${u.avgCostPerCall.toFixed(6)}</td>
                    <td className="font-mono text-[10px]">{u.topEndpoint ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {/* Catalog vs Actual */}
      <GlassCard>
        <div className="flex items-center gap-2 mb-3">
          <Flame className="w-4 h-4 text-orange-500" />
          <p className="hs-h3 !mb-0">Catalog 預估 vs 實際扣費（差異最大 Top 20）</p>
        </div>
        {data.catalogVsActual.length === 0 ? (
          <p className="hs-small text-muted-foreground">尚無 catalog 比對資料</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left pb-2">端點</th>
                  <th className="text-right pb-2">呼叫</th>
                  <th className="text-right pb-2">預估</th>
                  <th className="text-right pb-2">實際</th>
                  <th className="text-right pb-2">差異</th>
                  <th className="text-right pb-2">差異 %</th>
                </tr>
              </thead>
              <tbody>
                {data.catalogVsActual.map(c => (
                  <tr key={c.endpoint} className="border-b border-border/50">
                    <td className="py-1.5 font-mono text-[10px]">{c.endpoint}</td>
                    <td className="text-right tabular-nums">{c.callCount}</td>
                    <td className="text-right tabular-nums">${c.expectedUsd.toFixed(4)}</td>
                    <td className="text-right tabular-nums">${c.actualUsd.toFixed(4)}</td>
                    <td
                      className={`text-right tabular-nums ${c.deltaUsd > 0 ? "text-red-500" : c.deltaUsd < 0 ? "text-green-500" : ""}`}
                    >
                      {c.deltaUsd >= 0 ? "+" : ""}${c.deltaUsd.toFixed(4)}
                    </td>
                    <td
                      className={`text-right tabular-nums ${(c.deltaPct ?? 0) > 0 ? "text-red-500" : (c.deltaPct ?? 0) < 0 ? "text-green-500" : ""}`}
                    >
                      {c.deltaPct == null ? "—" : `${c.deltaPct > 0 ? "+" : ""}${c.deltaPct}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {/* 7×24 Heatmap */}
      <GlassCard>
        <p className="hs-h3 !mb-3">7×24 呼叫熱力圖（顏色越深 = 該時段費用越高）</p>
        <div className="overflow-x-auto">
          <table className="text-[10px]">
            <thead>
              <tr>
                <th className="text-muted-foreground pr-2"></th>
                {Array.from({ length: 24 }, (_, h) => (
                  <th key={h} className="px-0.5 text-muted-foreground">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 7 }, (_, w) => (
                <tr key={w}>
                  <td className="pr-2 text-muted-foreground">{WEEKDAY_LABELS[w]}</td>
                  {Array.from({ length: 24 }, (_, h) => {
                    const cell = data.heatmap.find(c => c.weekday === w && c.hour === h);
                    const intensity = cell ? cell.costUsd / maxCellCost : 0;
                    const opacity = cell && cell.callCount > 0 ? 0.15 + intensity * 0.85 : 0.05;
                    return (
                      <td
                        key={h}
                        className="p-0"
                        title={cell ? `${WEEKDAY_LABELS[w]} ${h}:00 — ${cell.callCount} 次 / $${cell.costUsd.toFixed(4)}` : ""}
                      >
                        <div
                          className="w-4 h-4 m-0.5 rounded-sm"
                          style={{ backgroundColor: `rgba(59, 130, 246, ${opacity})` }}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {/* ─── Deep Layer 1: Daily Endpoint Trends ──────────────────────── */}
      <GlassCard>
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-4 h-4 text-blue-500" />
          <p className="hs-h3 !mb-0">Top 端點 7 天趨勢與異常檢測</p>
        </div>
        {data.endpointTrends.length === 0 ? (
          <p className="hs-small text-muted-foreground">尚無資料</p>
        ) : (
          <div className="space-y-2">
            {data.endpointTrends.map(t => {
              const max = Math.max(0.000001, ...t.series.map(s => s.costUsd));
              return (
                <div
                  key={`${t.provider}-${t.endpoint}`}
                  className={`p-2 rounded-md ${t.isAnomaly ? "bg-red-500/10 ring-1 ring-red-500/30" : "bg-muted/30"}`}
                >
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-mono text-[10px]">{t.endpoint}</span>
                    <span className="tabular-nums text-muted-foreground">
                      今日 ${t.todayUsd.toFixed(4)} · 7 天均 ${t.baselineAvgUsd.toFixed(4)}
                      {t.spikeRatio > 0 && (
                        <span className={t.isAnomaly ? "text-red-500 font-medium ml-2" : "ml-2"}>
                          ×{t.spikeRatio.toFixed(2)}
                        </span>
                      )}
                      {t.isAnomaly && <span className="text-red-500 ml-2">⚠ 異常</span>}
                    </span>
                  </div>
                  <div className="flex items-end gap-0.5 h-8">
                    {t.series.map(d => {
                      const h = max > 0 ? (d.costUsd / max) * 100 : 0;
                      return (
                        <div
                          key={d.date}
                          className="flex-1 bg-blue-500/60 rounded-sm"
                          style={{ height: `${Math.max(2, h)}%` }}
                          title={`${d.date}：${d.callCount} 次 / $${d.costUsd.toFixed(4)}`}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>

      {/* ─── Deep Layer 2: Per-Call Cost Distribution ─────────────────── */}
      <GlassCard>
        <p className="hs-h3 !mb-3">單次呼叫成本分佈與離群值</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs mb-3">
          {[
            { label: "樣本數", value: data.costDistribution.sampleCount.toLocaleString() },
            { label: "p50", value: `$${data.costDistribution.p50Usd.toFixed(6)}` },
            { label: "p90", value: `$${data.costDistribution.p90Usd.toFixed(6)}` },
            { label: "p95", value: `$${data.costDistribution.p95Usd.toFixed(6)}` },
            { label: "p99 / max", value: `$${data.costDistribution.p99Usd.toFixed(6)} / $${data.costDistribution.maxUsd.toFixed(6)}` },
          ].map(it => (
            <div key={it.label} className="rounded-md bg-muted/40 p-2">
              <p className="text-[10px] text-muted-foreground">{it.label}</p>
              <p className="font-medium tabular-nums">{it.value}</p>
            </div>
          ))}
        </div>
        {data.costDistribution.outliers.length === 0 ? (
          <p className="hs-small text-muted-foreground">沒有偵測到離群（單次成本 &gt; p99 × 1.5）</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left pb-2">時間</th>
                  <th className="text-left pb-2">使用者</th>
                  <th className="text-left pb-2">端點</th>
                  <th className="text-right pb-2">費用</th>
                  <th className="text-right pb-2">延遲</th>
                </tr>
              </thead>
              <tbody>
                {data.costDistribution.outliers.map((o, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="py-1.5 font-mono text-[10px]">
                      {new Date(o.createdAt).toLocaleString("zh-TW", { hour12: false })}
                    </td>
                    <td className="font-mono">{o.userId ?? "—"}</td>
                    <td className="font-mono text-[10px]">{o.endpoint}</td>
                    <td className="text-right tabular-nums text-red-500">
                      ${o.costUsd.toFixed(6)}
                    </td>
                    <td className="text-right tabular-nums">
                      {o.latencyMs != null ? `${o.latencyMs} ms` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {/* ─── Deep Layer 3: Retry Chains ──────────────────────────────── */}
      <GlassCard>
        <p className="hs-h3 !mb-3">重試鏈偵測（同 user + 同端點 60 秒內連續呼叫）</p>
        {data.retryChains.length === 0 ? (
          <p className="hs-small text-muted-foreground">未偵測到重試風暴</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left pb-2">起始時間</th>
                  <th className="text-left pb-2">使用者</th>
                  <th className="text-left pb-2">端點</th>
                  <th className="text-right pb-2">嘗試</th>
                  <th className="text-right pb-2">總費用</th>
                  <th className="text-right pb-2">時長 (s)</th>
                  <th className="text-left pb-2">最終狀態</th>
                </tr>
              </thead>
              <tbody>
                {data.retryChains.map((r, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="py-1.5 font-mono text-[10px]">
                      {new Date(r.startedAt).toLocaleString("zh-TW", { hour12: false })}
                    </td>
                    <td className="font-mono">{r.userId}</td>
                    <td className="font-mono text-[10px]">{r.endpoint}</td>
                    <td className="text-right tabular-nums">
                      <Badge variant={r.attempts >= 5 ? "destructive" : "outline"}>
                        ×{r.attempts}
                      </Badge>
                    </td>
                    <td className="text-right tabular-nums">${r.totalCostUsd.toFixed(4)}</td>
                    <td className="text-right tabular-nums">{r.windowSec}</td>
                    <td>
                      <span style={{ color: STATUS_COLORS[r.finalStatus] }}>
                        {STATUS_LABELS[r.finalStatus] ?? r.finalStatus}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {/* ─── Deep Layer 4: Feature-Level Breakdown ───────────────────── */}
      <GlassCard>
        <p className="hs-h3 !mb-3">功能模組成本拆解</p>
        {data.byFeature.length === 0 ? (
          <p className="hs-small text-muted-foreground">尚無資料</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left pb-2">功能模組</th>
                  <th className="text-right pb-2">呼叫</th>
                  <th className="text-right pb-2">費用</th>
                  <th className="text-right pb-2">佔比</th>
                  <th className="text-left pb-2">最常端點</th>
                </tr>
              </thead>
              <tbody>
                {data.byFeature.map(f => (
                  <tr key={f.feature} className="border-b border-border/50">
                    <td className="py-1.5 font-medium">{f.feature}</td>
                    <td className="text-right tabular-nums">{f.callCount}</td>
                    <td className="text-right tabular-nums">${f.costUsd.toFixed(4)}</td>
                    <td className="text-right tabular-nums">{f.share}%</td>
                    <td className="font-mono text-[10px]">{f.topEndpoint ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {/* ─── Deep Layer 5: What-If Savings ────────────────────────────── */}
      <GlassCard>
        <div className="flex items-center gap-2 mb-3">
          <Wallet className="w-4 h-4 text-green-500" />
          <p className="hs-h3 !mb-0">節費試算（同模態最便宜替代品）</p>
        </div>
        {data.savingsSuggestions.length === 0 ? (
          <p className="hs-small text-muted-foreground">沒有顯著節費機會（&lt; 30%）</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left pb-2">當前端點</th>
                  <th className="text-left pb-2">建議替代</th>
                  <th className="text-right pb-2">呼叫</th>
                  <th className="text-right pb-2">當前費用</th>
                  <th className="text-right pb-2">替代費用</th>
                  <th className="text-right pb-2">可省</th>
                  <th className="text-right pb-2">節省 %</th>
                  <th className="text-left pb-2">風險</th>
                </tr>
              </thead>
              <tbody>
                {data.savingsSuggestions.map((s, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="py-1.5 font-mono text-[10px]">{s.endpoint}</td>
                    <td className="font-mono text-[10px] text-green-500">{s.suggestedEndpoint}</td>
                    <td className="text-right tabular-nums">{s.callCount}</td>
                    <td className="text-right tabular-nums">${s.currentCostUsd.toFixed(4)}</td>
                    <td className="text-right tabular-nums">${s.suggestedCostUsd.toFixed(4)}</td>
                    <td className="text-right tabular-nums text-green-500 font-medium">
                      ${s.monthlySavingsUsd.toFixed(4)}
                    </td>
                    <td className="text-right tabular-nums">{s.savingsPct}%</td>
                    <td className="text-[10px] text-muted-foreground">{s.riskNote}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {w.truncated && (
        <p className="hs-small text-yellow-500">
          ⚠ 視窗內事件超過 50,000 筆，已截斷僅取最新 50,000 筆計算。建議縮小日期範圍。
        </p>
      )}
    </motion.div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

const ADMIN_API_USAGE_TAB_IDS = [
  "overview",
  "providers",
  "deep-cost",
  "rate-limit",
  "billing",
] as const;
type AdminApiUsageTabId = (typeof ADMIN_API_USAGE_TAB_IDS)[number];

function isAdminApiUsageTabId(value: string): value is AdminApiUsageTabId {
  return (ADMIN_API_USAGE_TAB_IDS as readonly string[]).includes(value);
}

export default function AdminApiUsagePage() {
  const [, navigate] = useLocation();
  const search = useSearch();

  // URL ↔ activeTab 雙向同步：?tab=billing 直接打開帳單分頁，且切換 tab 會
  // replaceState 寫回 URL，讓 reload / 分享連結都能保持當前位置。
  const initialTab = (() => {
    try {
      const params = new URLSearchParams(search);
      const v = params.get("tab");
      return v && isAdminApiUsageTabId(v) ? v : "overview";
    } catch {
      return "overview";
    }
  })();
  const [activeTab, setActiveTab] = useState<AdminApiUsageTabId>(
    initialTab as AdminApiUsageTabId
  );

  useEffect(() => {
    try {
      const params = new URLSearchParams(search);
      const v = params.get("tab");
      if (v && isAdminApiUsageTabId(v) && v !== activeTab) {
        setActiveTab(v);
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const handleTabChange = (next: string) => {
    if (!isAdminApiUsageTabId(next) || next === activeTab) return;
    setActiveTab(next);
    try {
      const params = new URLSearchParams(window.location.search);
      params.set("tab", next);
      const nextUrl = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
      window.history.replaceState(null, "", nextUrl);
    } catch {
      // ignore
    }
  };

  // 與 AdminPage 同樣只暴露 navigate / setTab；不開放 destructive 動作。
  // NAV_ALLOWLIST 與 capabilities.options 必須一致；TAB_ALLOWLIST 對應 setTab。
  const ADMIN_API_NAV_ALLOWLIST = new Set<string>([
    "/admin",
    "/admin/api-usage",
    "/admin/brain-pipeline",
  ]);
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
          { id: "deep-cost", label: "深度成本" },
          { id: "rate-limit", label: "速率限制" },
          { id: "billing", label: "帳單" },
        ],
      },
    ],
    state: {
      activeTab,
    },
    handle: async (action): Promise<AgentActionResult> => {
      if (action.type === "navigate" && typeof action.path === "string") {
        if (!ADMIN_API_NAV_ALLOWLIST.has(action.path)) {
          return {
            ok: false,
            reason: `admin-api-usage: 不在允許跳轉清單：${action.path}`,
          };
        }
        navigate(action.path);
        return { ok: true };
      }
      if (action.type === "setTab" && typeof action.tabId === "string") {
        if (!isAdminApiUsageTabId(action.tabId)) {
          return {
            ok: false,
            reason: `admin-api-usage: 未知 tabId：${action.tabId}`,
          };
        }
        handleTabChange(action.tabId);
        return { ok: true };
      }
      return { ok: false, reason: `admin-api-usage: unsupported action "${action.type}"` };
    },
  });

  return (
    <div className="page-shell page-shell-wide w-full">
      <header className="page-header">
        <div className="flex items-center gap-3">
          <Shield className="w-6 h-6 text-primary" />
          <div>
            <p className="page-eyebrow">Admin · API Usage</p>
            <h1 className="page-title !mb-0">API 用量管理</h1>
          </div>
        </div>
        <p className="page-subtitle">
          統一管理 AI 供應商呼叫次數、費用、配額與告警
        </p>
      </header>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="mb-4">
          <TabsTrigger value="overview">總覽</TabsTrigger>
          <TabsTrigger value="providers">供應商</TabsTrigger>
          <TabsTrigger value="deep-cost">深度成本</TabsTrigger>
          <TabsTrigger value="rate-limit">速率限制</TabsTrigger>
          <TabsTrigger value="billing">帳單</TabsTrigger>
        </TabsList>

        <TabsContent value="overview"><OverviewTab /></TabsContent>
        <TabsContent value="providers"><ProvidersTab /></TabsContent>
        <TabsContent value="deep-cost"><DeepCostTab /></TabsContent>
        <TabsContent value="rate-limit"><RateLimitTab /></TabsContent>
        <TabsContent value="billing"><BillingTab /></TabsContent>
      </Tabs>
    </div>
  );
}
