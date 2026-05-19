/**
 * AIModelsHub.tsx — AI 模型情報專區
 *
 * v2：自動研究 + 事實查核（auto-research / fact-check）整合
 *   - 透過 trpc.aiModels.list 取得 baseline + enrichment（pricing、benchmarks、
 *     latestUpdates、factCheck.sources）。若後端尚未跑過 cron，會 fallback 到
 *     shared/aiModelsCatalog.ts 內的 baseline 種子資料。
 *   - 卡片上顯示 fact-check 徽章與 verified 日期。
 *   - 詳情 Modal 加入：定價區段、基準分數、最新動態、引用來源、研究 metadata。
 *   - Header 顯示自動研究覆蓋率、上次研究時間、stale 提醒。
 */

import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useRegisterPageAgent } from "@/contexts/PageAgentContext";
import type {
  AgentAction,
  AgentActionResult,
  AgentCapability,
} from "../../../shared/agent-actions";
import VisualSoul from "@/components/VisualSoul";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Cpu,
  Search,
  ExternalLink,
  Sparkles,
  Filter,
  Image as ImageIcon,
  Video,
  Music,
  MessageSquare,
  Layers,
  ChevronRight,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Lightbulb,
  Zap,
  Newspaper,
  ArrowRight,
  X,
  Eye,
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  DollarSign,
  BarChart3,
  Link2,
  Globe,
  Server,
  PlayCircle,
  Clock,
  Activity,
  ChevronDown,
  Compass,
  FileText,
  PackagePlus,
  Bot,
} from "lucide-react";
import {
  AI_MODELS_CATALOG,
  PROVIDER_STYLE,
  MODALITY_STYLE,
  TIER_STYLE,
  PRICING_TIER_STYLE,
  FACT_CHECK_STATUS_STYLE,
  getUniqueProviders,
  getFeaturedModels,
  sortByLatest,
  computeFactCheckStatus,
  type AIModelEntry,
  type LatencyClass,
  type ModelModality,
  type ModelProvider,
  type ModelTier,
  type FactCheckStatus,
} from "@/data/aiModelsCatalog";

const LATENCY_LABELS: Record<LatencyClass, string> = {
  realtime: "即時 (<1s)",
  fast: "快速 (1-3s)",
  standard: "標準 (3-10s)",
  slow: "深度 (>10s)",
};

// ─── Modality tabs config ──────────────────────────────────────────────────

// 「tabId」既支援 ModelModality，也支援 "deep-research"（用 category 過濾）
type ModalityTabId = ModelModality | "all" | "deep-research";

const MODALITY_TABS: Array<{
  id: ModalityTabId;
  label: string;
  icon: typeof MessageSquare;
}> = [
  { id: "all", label: "全部", icon: Layers },
  { id: "text", label: "文字", icon: MessageSquare },
  { id: "multimodal", label: "多模態", icon: Sparkles },
  { id: "agent", label: "代理", icon: Bot },
  { id: "deep-research", label: "深度研究", icon: Compass },
  { id: "image", label: "圖片", icon: ImageIcon },
  { id: "video", label: "影片", icon: Video },
  { id: "audio", label: "音訊", icon: Music },
];

const TIER_FILTERS: Array<{ id: ModelTier | "all"; label: string }> = [
  { id: "all", label: "全部層級" },
  { id: "frontier", label: "旗艦" },
  { id: "balanced", label: "均衡" },
  { id: "lightweight", label: "輕量" },
  { id: "open-source", label: "開源" },
];

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatReleaseDate(iso: string): string {
  const [y, m] = iso.split("-");
  if (!y) return iso;
  return m ? `${y}年${parseInt(m, 10)}月` : y;
}

function relativeRelease(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  if (!y || !m) return formatReleaseDate(iso);
  const release = new Date(y, (m ?? 1) - 1, 1);
  const now = new Date();
  const months =
    (now.getFullYear() - release.getFullYear()) * 12 +
    (now.getMonth() - release.getMonth());
  if (months < 1) return "本月發佈";
  if (months < 6) return `${months} 個月前`;
  if (months < 12) return `${months} 個月前`;
  const years = Math.floor(months / 12);
  return `${years} 年前`;
}

function relativeFromNow(iso?: string): string {
  if (!iso) return "尚未驗證";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "尚未驗證";
  const diff = Date.now() - t;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "剛剛驗證";
  if (minutes < 60) return `${minutes} 分鐘前驗證`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小時前驗證`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前驗證`;
  const months = Math.floor(days / 30);
  return `${months} 個月前驗證`;
}

function formatAbsoluteTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDurationMs(ms?: number): string {
  if (!ms || ms < 0) return "—";
  if (ms < 1000) return `${ms} ms`;
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec} 秒`;
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes < 60) return seconds ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分鐘`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return remMin ? `${hours} 小時 ${remMin} 分` : `${hours} 小時`;
}

// 把 cron expression 翻成「每週日 03:30」這類的人話。無法解析時退回原字串。
const WEEKDAY_LABELS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
function humanizeCron(expr?: string): string {
  if (!expr) return "未設定";
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, mon, dow] = parts;
  const pad = (s: string) => (s.length < 2 ? `0${s}` : s);

  // 解析時間
  const hasFixedTime = /^\d+$/.test(hour) && /^\d+$/.test(min);
  const timeStr = hasFixedTime ? `${pad(hour)}:${pad(min)}` : null;

  // dom / mon 都是 *，看 dow
  if (dom === "*" && mon === "*") {
    if (dow === "*") {
      return timeStr ? `每天 ${timeStr}` : `每天 ${min} 分 ${hour} 時`;
    }
    if (/^\d$/.test(dow)) {
      const label = WEEKDAY_LABELS[parseInt(dow, 10)] ?? `週${dow}`;
      return timeStr ? `每${label} ${timeStr}` : `每${label}`;
    }
    if (dow === "1-5") {
      return timeStr ? `平日 ${timeStr}` : `平日`;
    }
  }
  return expr;
}

// ─── Fact-check badge ──────────────────────────────────────────────────────

// 把「YYYY-MM-DD」、「YYYY-MM」、「YYYY」皆轉成可比較的 timestamp。
function parseUpdateDate(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y) return 0;
  return new Date(y, (m ?? 1) - 1, d ?? 1).getTime();
}

const FRESH_UPDATE_DAYS = 7;
function isFreshUpdate(iso: string, days: number = FRESH_UPDATE_DAYS): boolean {
  const t = parseUpdateDate(iso);
  if (!t) return false;
  return Date.now() - t < days * 86400_000;
}

function relativeUpdateLabel(iso: string): string {
  const t = parseUpdateDate(iso);
  if (!t) return iso;
  const diffDays = Math.floor((Date.now() - t) / 86400_000);
  if (diffDays < 0) return "即將發佈";
  if (diffDays < 1) return "今天";
  if (diffDays === 1) return "昨天";
  if (diffDays < 7) return `${diffDays} 天前`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} 週前`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} 個月前`;
  return `${Math.floor(diffDays / 365)} 年前`;
}

function FactCheckBadge({
  status,
  checkedAt,
  size = "sm",
}: {
  status: FactCheckStatus;
  checkedAt?: string;
  size?: "sm" | "md";
}) {
  const style = FACT_CHECK_STATUS_STYLE[status];
  const Icon =
    status === "verified" || status === "auto-checked"
      ? ShieldCheck
      : status === "stale" || status === "pending"
        ? ShieldAlert
        : AlertCircle;
  const sizeClass =
    size === "md" ? "text-xs px-2.5 py-1" : "text-[10px] px-2 py-0.5";
  return (
    <span
      className={`inline-flex items-center gap-1 ${sizeClass} font-medium rounded-full ${style.chipBg} ${style.chipText}`}
      title={
        checkedAt
          ? `${style.description}｜${relativeFromNow(checkedAt)}`
          : style.description
      }
    >
      <Icon className={size === "md" ? "w-3.5 h-3.5" : "w-2.5 h-2.5"} />
      {style.label}
    </span>
  );
}

// ─── Model card ────────────────────────────────────────────────────────────

// Card-level compact capability chips. Show only enabled ones to avoid clutter.
// One emoji + a short Chinese label tooltip — keeps the card scannable at a glance.
function CapabilityChipsRow({ model }: { model: AIModelEntry }) {
  type Chip = { key: string; emoji: string; title: string; on: boolean };
  const caps = model.capabilities ?? {};
  const chips: Chip[] = [
    { key: "vision", emoji: "👁", title: "視覺輸入", on: !!caps.visionInput },
    { key: "tools", emoji: "🛠", title: "工具呼叫", on: !!caps.functionCalling },
    { key: "code", emoji: "⚙️", title: "程式執行", on: !!caps.codeExecution },
    { key: "web", emoji: "🌐", title: "網頁搜尋", on: !!caps.webSearch },
    { key: "cache", emoji: "💾", title: "Prompt 快取", on: !!caps.promptCaching },
    { key: "batch", emoji: "📦", title: "Batch API", on: !!caps.batchApi },
  ];
  const active = chips.filter(c => c.on);
  if (active.length === 0 && !model.agentDetails && !model.lineage) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 mb-3">
      {active.map(c => (
        <span
          key={c.key}
          title={c.title}
          aria-label={c.title}
          className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted/70 border border-border/40 inline-flex items-center gap-0.5"
        >
          <span>{c.emoji}</span>
          <span className="text-foreground/80">{c.title}</span>
        </span>
      ))}
      {model.modality === "agent" && model.agentDetails?.asyncCapable && (
        <span
          title="支援背景非同步執行"
          className="text-[10px] px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200/60"
        >
          ⏱ 背景跑
        </span>
      )}
      {model.lineage && model.lineage.length > 1 && (
        <span
          title={`版本演進：${model.lineage.length} 個里程碑`}
          className="text-[10px] px-1.5 py-0.5 rounded-md bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-200/60"
        >
          v{model.lineage.length}
        </span>
      )}
    </div>
  );
}

function ModelCard({
  model,
  onOpen,
  inCompare,
  onToggleCompare,
}: {
  model: AIModelEntry;
  onOpen: () => void;
  inCompare?: boolean;
  onToggleCompare?: () => void;
}) {
  const provider = PROVIDER_STYLE[model.provider];
  const modality = MODALITY_STYLE[model.modality];
  const tier = TIER_STYLE[model.tier];
  const factStatus = computeFactCheckStatus(model.factCheck);
  const pricingTier = model.pricing?.tier
    ? PRICING_TIER_STYLE[model.pricing.tier]
    : null;
  const freshUpdate = useMemo(() => {
    if (!model.latestUpdates || model.latestUpdates.length === 0) return null;
    return (
      model.latestUpdates.find(u => isFreshUpdate(u.date)) ??
      [...model.latestUpdates].sort(
        (a, b) => parseUpdateDate(b.date) - parseUpdateDate(a.date)
      )[0] ??
      null
    );
  }, [model.latestUpdates]);
  const isFresh = freshUpdate ? isFreshUpdate(freshUpdate.date) : false;
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const utils = trpc.useUtils();
  const refreshOne = trpc.aiModels.refreshOne.useMutation({
    onSuccess: () => {
      toast.success(`已重新研究：${model.name}`);
      void utils.aiModels.list.invalidate();
      void utils.aiModels.researchStats.invalidate();
    },
    onError: err => {
      toast.error(err.message ?? `研究失敗：${model.name}`);
    },
  });

  return (
    <motion.button
      type="button"
      onClick={onOpen}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      className="group text-left cursor-pointer rounded-2xl border border-border/70 dark:border-white/10 bg-card hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 transition-healing overflow-hidden w-full"
    >
      {model.featured && (
        <div className="h-0.5 bg-gradient-to-r from-amber-400 via-orange-400 to-pink-400" />
      )}

      <div className="p-5">
        {/* Header row: provider badge + modality + tier */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="inline-flex items-center gap-1.5 flex-wrap">
            <div
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold ring-1 ${provider.bg} ${provider.accent} ${provider.ring}`}
            >
              {provider.label}
            </div>
            {isFresh && freshUpdate && (
              <span
                className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-700 ring-1 ring-rose-200 animate-pulse"
                title={`${relativeUpdateLabel(freshUpdate.date)}：${freshUpdate.summary}`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                最新動態
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            <span
              className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${modality.chipBg} ${modality.chipText}`}
            >
              {modality.emoji} {modality.label}
            </span>
            <span
              className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${tier.chipBg} ${tier.chipText}`}
            >
              {tier.label}
            </span>
          </div>
        </div>

        {/* Title + apiId */}
        <h3 className="hs-h3 !mb-0 text-foreground mb-1 group-hover:text-primary transition-colors">
          {model.name}
        </h3>
        {model.apiId && (
          <p className="text-[11px] font-mono text-muted-foreground/70 mb-2">
            {model.apiId}
          </p>
        )}

        {/* Tagline */}
        <p className="hs-small !mb-0 text-foreground/90 line-clamp-2 mb-3">
          {model.tagline}
        </p>

        {/* Quick spec row */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {model.contextWindow && (
            <span className="text-[10px] px-2 py-0.5 bg-muted text-foreground/90 rounded-full">
              脈絡 {model.contextWindow}
            </span>
          )}
          {pricingTier && (
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full font-medium inline-flex items-center gap-0.5 ${pricingTier.chipBg} ${pricingTier.chipText}`}
              title={pricingTier.hint}
            >
              <DollarSign className="w-2.5 h-2.5" />
              {pricingTier.label}
            </span>
          )}
          {model.openWeight && (
            <span className="text-[10px] px-2 py-0.5 bg-violet-50 text-violet-700 rounded-full font-medium">
              開源權重
            </span>
          )}
          <span className="text-[10px] px-2 py-0.5 bg-muted text-muted-foreground rounded-full inline-flex items-center gap-1">
            <Calendar className="w-2.5 h-2.5" />
            {formatReleaseDate(model.releaseDate)}
          </span>
        </div>

        {/* Token pricing line + top benchmark — denser at-a-glance facts */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground/90 mb-3">
          {(model.pricing?.inputPerMillion || model.pricing?.outputPerMillion) && (
            <span className="inline-flex items-center gap-1">
              <DollarSign className="w-3 h-3 text-emerald-600" />
              <span className="font-mono text-foreground/90">
                {model.pricing.inputPerMillion ?? "—"}
                {" / "}
                {model.pricing.outputPerMillion ?? "—"}
              </span>
              <span className="text-muted-foreground/60">{model.pricing.unit}</span>
            </span>
          )}
          {model.benchmarks && model.benchmarks.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <BarChart3 className="w-3 h-3 text-violet-500" />
              <span className="text-foreground/90">
                {model.benchmarks[0].name}
              </span>
              <span className="font-semibold text-foreground">
                {model.benchmarks[0].score}
              </span>
            </span>
          )}
        </div>

        {/* Capability mini-icons — tools / vision / cache / batch / open */}
        <CapabilityChipsRow model={model} />

        {/* Hosting platforms */}
        {model.hostedOn && model.hostedOn.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 mb-3">
            <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">
              代管
            </span>
            {model.hostedOn.slice(0, 5).map(h => (
              <span
                key={h}
                className="text-[10px] px-1.5 py-0.5 rounded bg-card border border-border/60 text-muted-foreground"
                title={`此模型可在 ${HOSTING_LABELS[h] ?? h} 上呼叫`}
              >
                {HOSTING_LABELS[h] ?? h}
              </span>
            ))}
            {model.hostedOn.length > 5 && (
              <span className="text-[10px] text-muted-foreground/60">
                +{model.hostedOn.length - 5}
              </span>
            )}
          </div>
        )}

        {/* Tags */}
        {model.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {model.tags.slice(0, 3).map(t => (
              <span
                key={t}
                className="text-[10px] px-2 py-0.5 bg-muted text-muted-foreground rounded-full"
              >
                #{t}
              </span>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-border/70">
          <FactCheckBadge
            status={factStatus}
            checkedAt={model.factCheck?.checkedAt}
          />
          <div className="inline-flex items-center gap-1.5">
            {onToggleCompare && (
              <span
                role="checkbox"
                aria-checked={!!inCompare}
                tabIndex={0}
                title={inCompare ? "已加入比較" : "加入比較"}
                onClick={e => {
                  e.stopPropagation();
                  onToggleCompare();
                }}
                onKeyDown={e => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    onToggleCompare();
                  }
                }}
                className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md cursor-pointer transition-healing ${
                  inCompare
                    ? "bg-fuchsia-100 text-fuchsia-700 ring-1 ring-fuchsia-200"
                    : "bg-muted/60 text-muted-foreground hover:bg-muted"
                }`}
              >
                <span
                  className={`w-3 h-3 rounded-sm border flex items-center justify-center ${
                    inCompare
                      ? "border-fuchsia-500 bg-fuchsia-500 text-white"
                      : "border-muted-foreground/40"
                  }`}
                >
                  {inCompare && <CheckCircle2 className="w-2.5 h-2.5" />}
                </span>
                比較
              </span>
            )}
            {isAdmin && (
              <span
                role="button"
                tabIndex={0}
                aria-label={`重新研究 ${model.name}`}
                title="僅管理員：重新跑這款模型的自動研究"
                onClick={e => {
                  e.stopPropagation();
                  if (refreshOne.isPending) return;
                  refreshOne.mutate({ id: model.id, force: true });
                }}
                onKeyDown={e => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    if (refreshOne.isPending) return;
                    refreshOne.mutate({ id: model.id, force: true });
                  }
                }}
                className={`p-1 rounded-full transition-healing ${
                  refreshOne.isPending
                    ? "text-sky-500"
                    : "text-muted-foreground/60 hover:text-primary hover:bg-primary/5"
                }`}
              >
                <RefreshCw
                  className={`w-3 h-3 ${refreshOne.isPending ? "animate-spin" : ""}`}
                />
              </span>
            )}
            <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground/70 group-hover:text-primary transition-colors">
              查看詳情
              <ChevronRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </span>
          </div>
        </div>
      </div>
    </motion.button>
  );
}

// ─── Pricing block ─────────────────────────────────────────────────────────

function PricingBlock({ model }: { model: AIModelEntry }) {
  if (!model.pricing) return null;
  const tier = PRICING_TIER_STYLE[model.pricing.tier];
  return (
    <section className="rounded-xl border border-border bg-gradient-to-br from-emerald-500/5 via-card to-sky-500/5 p-4">
      <div className="flex items-center gap-2 mb-2">
        <DollarSign className="w-4 h-4 text-emerald-600" />
        <h3 className="hs-h3 !mb-0 text-foreground">定價</h3>
        <span
          className={`ml-auto text-[10px] font-medium px-2 py-0.5 rounded-full ${tier.chipBg} ${tier.chipText}`}
          title={tier.hint}
        >
          {tier.label}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
        {model.pricing.inputPerMillion && (
          <div className="rounded-lg bg-card border border-border/50 px-3 py-2">
            <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">
              Input
            </div>
            <div className="text-sm font-semibold text-foreground">
              {model.pricing.inputPerMillion}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {model.pricing.unit}
            </div>
          </div>
        )}
        {model.pricing.outputPerMillion && (
          <div className="rounded-lg bg-card border border-border/50 px-3 py-2">
            <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">
              Output
            </div>
            <div className="text-sm font-semibold text-foreground">
              {model.pricing.outputPerMillion}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {model.pricing.unit}
            </div>
          </div>
        )}
        {!model.pricing.inputPerMillion && !model.pricing.outputPerMillion && (
          <div className="rounded-lg bg-card border border-border/50 px-3 py-2 sm:col-span-3">
            <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">
              計價方式
            </div>
            <div className="text-sm font-medium text-foreground">
              {model.pricing.unit}
            </div>
          </div>
        )}
      </div>
      {model.pricing.note && (
        <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
          <span className="text-muted-foreground/70">註：</span>
          {model.pricing.note}
        </p>
      )}
    </section>
  );
}

// ─── Benchmark block ───────────────────────────────────────────────────────

function BenchmarkBlock({ model }: { model: AIModelEntry }) {
  if (!model.benchmarks || model.benchmarks.length === 0) return null;
  return (
    <section>
      <h3 className="hs-h3 !mb-0 text-foreground mb-2 inline-flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-indigo-500" />
        基準分數
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {model.benchmarks.map((b, i) => (
          <div
            key={i}
            className="rounded-lg border border-border bg-card p-3 flex items-start justify-between gap-3"
          >
            <div className="min-w-0">
              <div className="text-xs font-medium text-foreground">{b.name}</div>
              {b.rank && (
                <div className="text-[10px] text-muted-foreground/70 mt-0.5">{b.rank}</div>
              )}
            </div>
            <div className="text-right shrink-0">
              <div className="text-sm font-semibold text-indigo-700">
                {b.score}
              </div>
              {b.sourceUrl && (
                <a
                  href={b.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-muted-foreground/70 hover:text-primary inline-flex items-center gap-0.5"
                  onClick={e => e.stopPropagation()}
                >
                  來源
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Latest updates block ──────────────────────────────────────────────────

function LatestUpdatesBlock({ model }: { model: AIModelEntry }) {
  if (!model.latestUpdates || model.latestUpdates.length === 0) return null;
  return (
    <section>
      <h3 className="hs-h3 !mb-0 text-foreground mb-2 inline-flex items-center gap-2">
        <Newspaper className="w-4 h-4 text-rose-500" />
        最新動態（自動追蹤）
      </h3>
      <div className="space-y-2">
        {model.latestUpdates.map((u, i) => (
          <div
            key={i}
            className="rounded-lg border border-border bg-card p-3"
          >
            <div className="flex items-start gap-3">
              <div className="text-[10px] font-mono text-muted-foreground shrink-0 pt-0.5">
                {u.date}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-foreground/90 leading-relaxed">
                  {u.summary}
                </p>
                {u.url && (
                  <a
                    href={u.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-primary hover:underline inline-flex items-center gap-0.5 mt-1"
                    onClick={e => e.stopPropagation()}
                  >
                    <Link2 className="w-2.5 h-2.5" />
                    來源連結
                  </a>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Availability block ────────────────────────────────────────────────────

function AvailabilityBlock({ model }: { model: AIModelEntry }) {
  if (!model.availability) return null;
  const a = model.availability;
  return (
    <section>
      <h3 className="hs-h3 !mb-0 text-foreground mb-2 inline-flex items-center gap-2">
        <Globe className="w-4 h-4 text-blue-500" />
        取得管道
      </h3>
      <div className="flex flex-wrap gap-2">
        <span
          className={`text-xs px-3 py-1 rounded-full ${a.api ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-muted text-muted-foreground"}`}
        >
          {a.api ? "✓" : "—"} API
        </span>
        <span
          className={`text-xs px-3 py-1 rounded-full ${a.web ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-muted text-muted-foreground"}`}
        >
          {a.web ? "✓" : "—"} Web UI
        </span>
        <span
          className={`text-xs px-3 py-1 rounded-full inline-flex items-center gap-1 ${a.selfHost ? "bg-violet-50 text-violet-700 border border-violet-200" : "bg-muted text-muted-foreground"}`}
        >
          {a.selfHost ? <Server className="w-3 h-3" /> : null}
          {a.selfHost ? "可自架" : "無法自架"}
        </span>
      </div>
      {a.notes && (
        <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{a.notes}</p>
      )}
    </section>
  );
}

// ─── Capabilities block (能力矩陣) ─────────────────────────────────────────

const CAPABILITY_ROWS: Array<{
  key: keyof NonNullable<AIModelEntry["capabilities"]>;
  label: string;
  hint: string;
}> = [
  { key: "visionInput", label: "圖像輸入", hint: "可讀取圖片內容" },
  { key: "audioInput", label: "音訊輸入", hint: "可讀取聲音輸入" },
  { key: "videoInput", label: "影片輸入", hint: "可讀取影片內容" },
  { key: "functionCalling", label: "Function Calling", hint: "支援工具呼叫" },
  { key: "structuredOutput", label: "結構化輸出", hint: "JSON / schema 強制" },
  { key: "streaming", label: "串流輸出", hint: "支援 SSE / streaming" },
  { key: "fineTuning", label: "Fine-tuning", hint: "可自行微調" },
  { key: "codeExecution", label: "程式碼執行", hint: "內建 sandbox 執行" },
  { key: "webSearch", label: "網路搜尋", hint: "內建瀏覽 / 搜尋工具" },
  { key: "promptCaching", label: "Prompt Caching", hint: "重複 input 折扣" },
  { key: "batchApi", label: "Batch API", hint: "批次任務通常 50% 折扣" },
];

function CapabilityCell({
  state,
  label,
  hint,
}: {
  state: boolean | undefined;
  label: string;
  hint: string;
}) {
  const color =
    state === true
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : state === false
        ? "bg-gray-50 text-gray-400 border-gray-200"
        : "bg-amber-50 text-amber-700 border-amber-200 border-dashed";
  const symbol = state === true ? "✓" : state === false ? "—" : "?";
  return (
    <div
      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] ${color}`}
      title={state === undefined ? `${hint}（尚未確認）` : hint}
    >
      <span className="font-mono w-3 text-center">{symbol}</span>
      <span>{label}</span>
    </div>
  );
}

function CapabilitiesBlock({ model }: { model: AIModelEntry }) {
  if (!model.capabilities) return null;
  const caps = model.capabilities;
  return (
    <section>
      <h3 className="hs-h3 !mb-0 text-gray-900 mb-2 inline-flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-indigo-500" />
        能力矩陣
      </h3>
      <div className="flex flex-wrap gap-1.5">
        {CAPABILITY_ROWS.map(row => (
          <CapabilityCell
            key={row.key}
            state={caps[row.key]}
            label={row.label}
            hint={row.hint}
          />
        ))}
      </div>
    </section>
  );
}

// ─── Safety / compliance badges ─────────────────────────────────────────────

const SAFETY_STYLE: Record<
  NonNullable<AIModelEntry["safetyTier"]>,
  { label: string; chipBg: string; chipText: string; hint: string }
> = {
  high: {
    label: "高度對齊",
    chipBg: "bg-emerald-50",
    chipText: "text-emerald-700",
    hint: "嚴格安全微調、企業級合規友善",
  },
  medium: {
    label: "標準對齊",
    chipBg: "bg-sky-50",
    chipText: "text-sky-700",
    hint: "業界一般水準的安全微調",
  },
  low: {
    label: "輕度對齊",
    chipBg: "bg-amber-50",
    chipText: "text-amber-700",
    hint: "創意空間較大，需自行加上 guardrails",
  },
  unrestricted: {
    label: "無限制",
    chipBg: "bg-rose-50",
    chipText: "text-rose-700",
    hint: "幾乎不做內容過濾，部署時請自帶安全層",
  },
};

function SafetyComplianceBlock({ model }: { model: AIModelEntry }) {
  if (!model.safetyTier && (!model.compliance || model.compliance.length === 0))
    return null;
  return (
    <section className="rounded-xl border border-gray-200 bg-card p-4">
      <h3 className="hs-h3 !mb-0 text-gray-900 mb-2 inline-flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-blue-500" />
        安全與合規
      </h3>
      <div className="flex flex-wrap items-center gap-2">
        {model.safetyTier && (
          <span
            className={`text-xs px-2.5 py-1 rounded-full font-medium ${SAFETY_STYLE[model.safetyTier].chipBg} ${SAFETY_STYLE[model.safetyTier].chipText}`}
            title={SAFETY_STYLE[model.safetyTier].hint}
          >
            {SAFETY_STYLE[model.safetyTier].label}
          </span>
        )}
        {model.compliance?.map(tag => (
          <span
            key={tag}
            className="text-xs px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 font-medium font-mono"
            title={`${tag} compliance`}
          >
            {tag}
          </span>
        ))}
      </div>
    </section>
  );
}

// ─── Agent-specific details block ─────────────────────────────────────────
// 只對 modality === "agent" 顯示：sandbox、工具集、是否可背景跑、整合對象等

const SANDBOX_LABELS: Record<
  NonNullable<AIModelEntry["agentDetails"]>["sandbox"] & string,
  string
> = {
  "cloud-vm": "雲端 VM",
  browser: "瀏覽器",
  "local-terminal": "本機終端",
  ide: "IDE 內建",
  "github-actions": "GitHub Actions",
  "self-hosted": "自架部署",
  mixed: "多種環境",
};

function formatTaskDuration(minutes?: number): string | null {
  if (!minutes || minutes <= 0) return null;
  if (minutes < 60) return `${minutes} 分鐘`;
  const hours = minutes / 60;
  if (hours < 24) {
    return Number.isInteger(hours)
      ? `${hours} 小時`
      : `${hours.toFixed(1)} 小時`;
  }
  const days = Math.round(hours / 24);
  return `${days} 天`;
}

function AgentDetailsBlock({ model }: { model: AIModelEntry }) {
  if (model.modality !== "agent") return null;
  const d = model.agentDetails;
  if (!d) return null;

  const rows: Array<{ label: string; value: React.ReactNode }> = [];
  if (d.sandbox) {
    rows.push({
      label: "執行環境",
      value: SANDBOX_LABELS[d.sandbox] ?? d.sandbox,
    });
  }
  if (d.maxTaskMinutes) {
    rows.push({
      label: "單次任務上限",
      value: formatTaskDuration(d.maxTaskMinutes) ?? "—",
    });
  }
  if (typeof d.concurrencyLimit === "number") {
    rows.push({
      label: "並行任務",
      value: `${d.concurrencyLimit} session`,
    });
  }
  if (d.memory) {
    rows.push({ label: "記憶 / 狀態", value: d.memory });
  }
  rows.push({
    label: "背景執行",
    value: d.asyncCapable ? (
      <span className="inline-flex items-center gap-1 text-emerald-700">
        <CheckCircle2 className="w-3 h-3" /> 支援
      </span>
    ) : (
      <span className="text-muted-foreground">需開著</span>
    ),
  });
  if (d.needsAuthorization !== undefined) {
    rows.push({
      label: "需要授權",
      value: d.needsAuthorization ? (
        <span className="inline-flex items-center gap-1 text-amber-700">
          <ShieldAlert className="w-3 h-3" /> 敏感操作要確認
        </span>
      ) : (
        <span className="text-muted-foreground">不需</span>
      ),
    });
  }

  return (
    <section className="rounded-xl border border-indigo-200/60 bg-gradient-to-br from-indigo-500/5 via-card to-violet-500/5 p-4">
      <h3 className="hs-h3 !mb-0 text-foreground mb-2 inline-flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-indigo-500" />
        代理運作細節
      </h3>

      {rows.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
          {rows.map((r, i) => (
            <div
              key={i}
              className="rounded-lg bg-card/80 border border-border/60 px-3 py-1.5"
            >
              <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">
                {r.label}
              </div>
              <div className="text-xs font-medium text-foreground mt-0.5">
                {r.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {d.tools && d.tools.length > 0 && (
        <div className="mb-2">
          <div className="text-[11px] text-muted-foreground/80 mb-1">
            內建工具
          </div>
          <div className="flex flex-wrap gap-1.5">
            {d.tools.map(t => (
              <span
                key={t}
                className="text-[11px] px-2 py-0.5 rounded-md bg-card text-foreground/90 border border-border/60"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {d.integrations && d.integrations.length > 0 && (
        <div>
          <div className="text-[11px] text-muted-foreground/80 mb-1">
            整合對象
          </div>
          <div className="flex flex-wrap gap-1.5">
            {d.integrations.map(t => (
              <span
                key={t}
                className="text-[11px] px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Interfaces + SDK packages ─────────────────────────────────────────────

const INTERFACE_LABELS: Record<NonNullable<AIModelEntry["interfaces"]>[number], string> = {
  api: "API",
  "web-app": "Web 應用",
  cli: "CLI",
  "ide-plugin": "IDE 套件",
  "desktop-app": "桌面 App",
  "mobile-app": "行動 App",
  "browser-extension": "瀏覽器擴充",
  sdk: "SDK",
  "github-action": "GitHub Action",
};

function InterfacesBlock({ model }: { model: AIModelEntry }) {
  const ifaces = model.interfaces ?? [];
  const pkgs = model.sdkPackages ?? [];
  if (ifaces.length === 0 && pkgs.length === 0) return null;
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h3 className="hs-h3 !mb-0 text-foreground mb-2 inline-flex items-center gap-2">
        <PackagePlus className="w-4 h-4 text-sky-500" />
        使用介面 / SDK
      </h3>
      {ifaces.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {ifaces.map(i => (
            <span
              key={i}
              className="text-[11px] px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 font-medium"
            >
              {INTERFACE_LABELS[i] ?? i}
            </span>
          ))}
        </div>
      )}
      {pkgs.length > 0 && (
        <ul className="space-y-1">
          {pkgs.map(p => (
            <li
              key={p.name}
              className="flex items-center gap-2 text-xs"
            >
              <span className="text-[10px] uppercase tracking-wider font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                {p.source}
              </span>
              {p.url ? (
                <a
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-foreground/90 hover:text-primary inline-flex items-center gap-1"
                >
                  {p.name}
                  <ExternalLink className="w-3 h-3 opacity-60" />
                </a>
              ) : (
                <span className="font-mono text-foreground/90">{p.name}</span>
              )}
              {p.note && (
                <span className="text-muted-foreground/80">— {p.note}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Lineage / version history ────────────────────────────────────────────

function LineageBlock({ model }: { model: AIModelEntry }) {
  const steps = model.lineage ?? [];
  if (steps.length === 0) return null;
  return (
    <section>
      <h3 className="hs-h3 !mb-0 text-foreground mb-2 inline-flex items-center gap-2">
        <Activity className="w-4 h-4 text-fuchsia-500" />
        版本演進
      </h3>
      <ol className="relative border-l-2 border-border/60 pl-4 space-y-2">
        {steps.map((s, i) => (
          <li key={i} className="relative">
            <span
              className={`absolute -left-[1.4rem] top-1.5 w-3 h-3 rounded-full ring-2 ring-background ${
                s.current ? "bg-fuchsia-500" : "bg-border"
              }`}
            />
            <div className="flex items-baseline gap-2 flex-wrap">
              <span
                className={`text-sm font-medium ${
                  s.current ? "text-fuchsia-700" : "text-foreground"
                }`}
              >
                {s.label}
              </span>
              <span className="text-[11px] text-muted-foreground/70">
                {formatReleaseDate(s.releaseDate)}
              </span>
              {s.current && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-fuchsia-50 text-fuchsia-700 font-medium">
                  目前版本
                </span>
              )}
            </div>
            {s.note && (
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {s.note}
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

// ─── Peers / similar models ────────────────────────────────────────────────

function PeersBlock({
  model,
  allModels,
  onOpen,
}: {
  model: AIModelEntry;
  allModels: AIModelEntry[];
  onOpen: (m: AIModelEntry) => void;
}) {
  const peers = useMemo(() => {
    if (!model.peers || model.peers.length === 0) return [];
    return model.peers
      .map(id => allModels.find(m => m.id === id))
      .filter((m): m is AIModelEntry => Boolean(m));
  }, [model.peers, allModels]);

  if (peers.length === 0) return null;

  return (
    <section>
      <h3 className="hs-h3 !mb-0 text-gray-900 mb-2 inline-flex items-center gap-2">
        <Layers className="w-4 h-4 text-violet-500" />
        相似模型
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {peers.map(p => {
          const ps = PROVIDER_STYLE[p.provider];
          const ts = TIER_STYLE[p.tier];
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onOpen(p)}
              className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-card px-3 py-2 hover:border-primary/40 hover:shadow-sm transition-all text-left group"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ring-1 ${ps.bg} ${ps.accent} ${ps.ring}`}
                  >
                    {ps.label}
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded ${ts.chipBg} ${ts.chipText}`}
                  >
                    {ts.label}
                  </span>
                </div>
                <div className="text-sm font-medium text-gray-800 mt-1 truncate group-hover:text-primary">
                  {p.name}
                </div>
                <div className="text-[11px] text-gray-500 truncate">
                  {p.tagline}
                </div>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-gray-400 group-hover:text-primary group-hover:translate-x-0.5 transition-transform shrink-0" />
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ─── Fact-check sources block ──────────────────────────────────────────────

function FactCheckBlock({ model }: { model: AIModelEntry }) {
  const factCheck = model.factCheck;
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const utils = trpc.useUtils();
  const refreshOne = trpc.aiModels.refreshOne.useMutation({
    onSuccess: () => {
      toast.success(`已重新研究：${model.name}`);
      void utils.aiModels.list.invalidate();
      void utils.aiModels.researchStats.invalidate();
    },
    onError: err => {
      toast.error(err.message ?? `研究失敗：${model.name}`);
    },
  });

  if (!factCheck) return null;
  const status = computeFactCheckStatus(factCheck);
  const style = FACT_CHECK_STATUS_STYLE[status];

  return (
    <section className="rounded-xl border border-border bg-gradient-to-br from-sky-500/5 via-card to-violet-500/5 p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="hs-h3 !mb-0 text-foreground inline-flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          事實查核
        </h3>
        <div className="flex items-center gap-2">
          <FactCheckBadge
            status={status}
            checkedAt={factCheck.checkedAt}
            size="md"
          />
          {isAdmin && (
            <button
              type="button"
              onClick={e => {
                e.stopPropagation();
                if (refreshOne.isPending) return;
                refreshOne.mutate({ id: model.id, force: true });
              }}
              disabled={refreshOne.isPending}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-card border border-gray-200 text-gray-600 hover:border-primary/40 hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="僅管理員：忽略 24h 快取，立刻重新查核這款模型"
            >
              {refreshOne.isPending ? (
                <RefreshCw className="w-3 h-3 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3" />
              )}
              {refreshOne.isPending ? "研究中…" : "重新研究"}
            </button>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
        {style.description}
        {factCheck.checkedAt ? `｜${relativeFromNow(factCheck.checkedAt)}` : ""}
        {factCheck.provider ? `｜提供者：${factCheck.provider}` : ""}
      </p>

      {factCheck.hasDiscrepancy && factCheck.notes && (
        <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-900 leading-relaxed">
              <span className="font-semibold">自動研究發現差異：</span>
              {factCheck.notes}
            </div>
          </div>
        </div>
      )}

      {factCheck.sources.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
            引用來源（{factCheck.sources.length}）
          </div>
          {factCheck.sources.map((s, i) => (
            <a
              key={i}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-lg bg-card border border-border hover:border-primary/40 transition-colors p-2.5 group"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <Link2 className="w-3 h-3 text-muted-foreground/70 shrink-0" />
                <span className="text-[11px] font-medium text-foreground truncate group-hover:text-primary">
                  {s.title}
                </span>
                {s.domain && (
                  <span className="text-[10px] text-muted-foreground/70 ml-auto shrink-0">
                    {s.domain}
                  </span>
                )}
              </div>
              {s.snippet && (
                <p className="text-[10px] text-muted-foreground line-clamp-2 leading-relaxed pl-5">
                  {s.snippet}
                </p>
              )}
            </a>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground italic">
          尚未取得引用來源（下一輪自動研究會補上）。
        </p>
      )}
    </section>
  );
}

// ─── Model detail modal ────────────────────────────────────────────────────

function ModelDetailModal({
  model,
  allModels,
  onOpen,
  onClose,
}: {
  model: AIModelEntry;
  allModels: AIModelEntry[];
  onOpen: (m: AIModelEntry) => void;
  onClose: () => void;
}) {
  const provider = PROVIDER_STYLE[model.provider];
  const modality = MODALITY_STYLE[model.modality];
  const tier = TIER_STYLE[model.tier];

  const factStatus = computeFactCheckStatus(model.factCheck);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent
        showCloseButton={false}
        className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0 rounded-3xl"
      >
        {model.featured && (
          <div className="h-1 bg-gradient-to-r from-amber-400 via-orange-400 to-pink-400 shrink-0" />
        )}

        {/* Header */}
        <div className="relative flex items-start gap-3 sm:gap-4 p-5 sm:p-6 pr-12 sm:pr-14 pb-4 border-b shrink-0">
          <div
            className={`p-2.5 sm:p-3 rounded-2xl ring-1 ${provider.bg} ${provider.ring} shrink-0`}
          >
            <Cpu className={`w-5 h-5 sm:w-6 sm:h-6 ${provider.accent}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 mb-2">
              <Badge
                variant="outline"
                className={`text-[10px] ${provider.accent}`}
              >
                {provider.label}
              </Badge>
              <span
                className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${modality.chipBg} ${modality.chipText}`}
              >
                {modality.emoji} {modality.label}
              </span>
              <span
                className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${tier.chipBg} ${tier.chipText}`}
              >
                {tier.label}
              </span>
              {model.openWeight && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-violet-50 text-violet-700">
                  開源權重
                </span>
              )}
            </div>
            <DialogHeader className="space-y-0">
              <DialogTitle className="hs-h2 !mb-0 text-foreground leading-tight">
                {model.name}
              </DialogTitle>
            </DialogHeader>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
              {model.apiId && (
                <p className="text-xs font-mono text-muted-foreground">{model.apiId}</p>
              )}
              <FactCheckBadge
                status={factStatus}
                checkedAt={model.factCheck?.checkedAt}
              />
            </div>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              {model.tagline}
            </p>
          </div>
          <button
            onClick={onClose}
            className="absolute top-3 right-3 sm:top-4 sm:right-4 p-2 rounded-xl hover:bg-muted text-muted-foreground/70 hover:text-foreground/90 transition-colors"
            aria-label="關閉"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="@container p-6 space-y-6">
            {/* Spec strip */}
            <div className="grid grid-cols-2 @md:grid-cols-3 @2xl:grid-cols-4 gap-3">
              <div className="rounded-xl border border-border bg-card p-3 min-w-0">
                <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">
                  發佈時間
                </div>
                <div className="text-sm font-medium text-foreground mt-0.5 truncate">
                  {formatReleaseDate(model.releaseDate)}
                </div>
              </div>
              {model.contextWindow && (
                <div className="rounded-xl border border-border bg-card p-3 min-w-0">
                  <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">
                    上下文視窗
                  </div>
                  <div className="text-sm font-medium text-foreground mt-0.5 truncate">
                    {model.contextWindow}
                  </div>
                </div>
              )}
              <div className="rounded-xl border border-border bg-card p-3 min-w-0">
                <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">
                  授權方式
                </div>
                <div className="text-sm font-medium text-foreground mt-0.5 truncate">
                  {model.openWeight ? "開源權重" : "閉源／API"}
                </div>
              </div>
              {model.trainingCutoff && (
                <div className="rounded-xl border border-gray-200 bg-card p-3 min-w-0">
                  <div className="text-[10px] text-gray-400 uppercase tracking-wider">
                    訓練截止
                  </div>
                  <div className="text-sm font-medium text-gray-800 mt-0.5 truncate">
                    {formatReleaseDate(model.trainingCutoff)}
                  </div>
                </div>
              )}
              {model.latencyClass && (
                <div className="rounded-xl border border-gray-200 bg-card p-3 min-w-0">
                  <div className="text-[10px] text-gray-400 uppercase tracking-wider">
                    回應延遲
                  </div>
                  <div className="text-sm font-medium text-gray-800 mt-0.5 truncate">
                    {LATENCY_LABELS[model.latencyClass]}
                  </div>
                </div>
              )}
              {model.languages && model.languages.length > 0 && (
                <div className="rounded-xl border border-gray-200 bg-card p-3 min-w-0">
                  <div className="text-[10px] text-gray-400 uppercase tracking-wider">
                    主要語言
                  </div>
                  <div
                    className="text-sm font-medium text-gray-800 mt-0.5 truncate"
                    title={model.languages.join(" · ")}
                  >
                    {model.languages.slice(0, 3).join(" · ")}
                    {model.languages.length > 3 ? ` +${model.languages.length - 3}` : ""}
                  </div>
                </div>
              )}
              {model.region && (
                <div className="rounded-xl border border-gray-200 bg-card p-3 min-w-0 col-span-2 @md:col-span-2">
                  <div className="text-[10px] text-gray-400 uppercase tracking-wider">
                    地區備註
                  </div>
                  <div className="text-sm font-medium text-gray-800 mt-0.5">
                    {model.region}
                  </div>
                </div>
              )}
            </div>

            {/* Description */}
            <section>
              <h3 className="hs-h3 !mb-0 text-foreground mb-2">關於這個模型</h3>
              <p className="text-sm text-foreground/90 leading-relaxed">
                {model.description}
              </p>
            </section>

            {/* Pricing — auto-researched */}
            <PricingBlock model={model} />

            {/* Benchmarks — auto-researched */}
            <BenchmarkBlock model={model} />

            {/* Capabilities matrix */}
            <CapabilitiesBlock model={model} />

            {/* Agent-only: sandbox / tools / integrations */}
            <AgentDetailsBlock model={model} />

            {/* Latest updates — auto-researched */}
            <LatestUpdatesBlock model={model} />

            {/* Version lineage */}
            <LineageBlock model={model} />

            {/* Interfaces + SDK packages */}
            <InterfacesBlock model={model} />

            {/* Availability */}
            <AvailabilityBlock model={model} />

            {/* Safety + compliance */}
            <SafetyComplianceBlock model={model} />

            {/* Strengths */}
            <section>
              <h3 className="hs-h3 !mb-0 text-foreground mb-2 inline-flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                強項
              </h3>
              <ul className="space-y-1.5">
                {model.strengths.map((s, i) => (
                  <li
                    key={i}
                    className="text-sm text-foreground/90 pl-4 relative leading-relaxed"
                  >
                    <span className="absolute left-0 top-1.5 w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    {s}
                  </li>
                ))}
              </ul>
            </section>

            {/* Limitations */}
            {model.limitations.length > 0 && (
              <section>
                <h3 className="hs-h3 !mb-0 text-foreground mb-2 inline-flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600" />
                  使用前要知道
                </h3>
                <ul className="space-y-1.5">
                  {model.limitations.map((s, i) => (
                    <li
                      key={i}
                      className="text-sm text-foreground/90 pl-4 relative leading-relaxed"
                    >
                      <span className="absolute left-0 top-1.5 w-1.5 h-1.5 rounded-full bg-amber-400" />
                      {s}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Use cases */}
            <section>
              <h3 className="hs-h3 !mb-0 text-foreground mb-2 inline-flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-yellow-500" />
                建議使用情境
              </h3>
              <div className="flex flex-wrap gap-2">
                {model.useCases.map((u, i) => (
                  <span
                    key={i}
                    className="text-xs px-3 py-1.5 rounded-full bg-gradient-to-r from-amber-50 to-orange-50 text-amber-900 border border-amber-200/60"
                  >
                    {u}
                  </span>
                ))}
              </div>
            </section>

            {/* Fact-check sources — the trust layer */}
            <FactCheckBlock model={model} />

            {/* Peers / similar models */}
            <PeersBlock
              model={model}
              allModels={allModels}
              onOpen={onOpen}
            />

            {/* Tags */}
            {model.tags.length > 0 && (
              <section>
                <h3 className="hs-h3 !mb-0 text-foreground mb-2">標籤</h3>
                <div className="flex flex-wrap gap-1.5">
                  {model.tags.map(t => (
                    <span
                      key={t}
                      className="text-xs px-2 py-1 bg-muted text-foreground/90 rounded-md"
                    >
                      #{t}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* Tier description */}
            <section className="rounded-xl border border-border bg-muted/40 p-4">
              <div className="text-xs font-semibold text-foreground/90 mb-1">
                關於「{tier.label}」層級
              </div>
              <div className="text-xs text-muted-foreground">{tier.description}</div>
            </section>
          </div>
        </ScrollArea>

        {/* Footer with official link */}
        {model.officialUrl && (
          <div className="border-t p-4 shrink-0 flex items-center justify-between gap-3 bg-background">
            <span className="text-xs text-muted-foreground">官方資訊與最新文件</span>
            <a
              href={model.officialUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
            >
              前往官方網站
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Featured model spotlight (compact horizontal scroll) ──────────────────

// ─── Cross-model latest activity feed ─────────────────────────────────────
//
// 把所有模型的 `latestUpdates` 攤平、依日期排序，取最新 ~10 筆。
// 讓使用者一眼看到「整個 AI 生態最近發生了什麼」，而不是要逐一點開卡片。

function CrossModelUpdatesFeed({
  models,
  onOpen,
  limit = 10,
}: {
  models: AIModelEntry[];
  onOpen: (m: AIModelEntry) => void;
  limit?: number;
}) {
  const items = useMemo(() => {
    type FeedItem = {
      modelId: string;
      modelName: string;
      provider: AIModelEntry["provider"];
      modality: AIModelEntry["modality"];
      date: string;
      summary: string;
      url?: string;
      ts: number;
    };
    const flat: FeedItem[] = [];
    for (const m of models) {
      if (!m.latestUpdates) continue;
      for (const u of m.latestUpdates) {
        flat.push({
          modelId: m.id,
          modelName: m.name,
          provider: m.provider,
          modality: m.modality,
          date: u.date,
          summary: u.summary,
          url: u.url,
          ts: parseUpdateDate(u.date),
        });
      }
    }
    flat.sort((a, b) => b.ts - a.ts);
    return flat.slice(0, limit);
  }, [models, limit]);

  if (items.length === 0) return null;

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-4">
        <h2 className="hs-h2 !mb-0 text-gray-900 inline-flex items-center gap-2">
          <Activity className="w-5 h-5 text-rose-500" />
          最新動態（自動追蹤）
        </h2>
        <span className="text-xs text-gray-500">
          每日 03:30 由自動研究補上
        </span>
      </div>
      <div className="space-y-2">
        {items.map((item, i) => {
          const ps = PROVIDER_STYLE[item.provider];
          const ms = MODALITY_STYLE[item.modality];
          const fresh = isFreshUpdate(item.date);
          const model = models.find(m => m.id === item.modelId);
          return (
            <motion.div
              key={`${item.modelId}-${i}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.02 }}
              className={`group flex items-start gap-3 p-3 rounded-xl border ${
                fresh
                  ? "border-rose-200 bg-rose-50/30"
                  : "border-gray-200 bg-card"
              } hover:border-primary/40 hover:shadow-sm transition-all`}
            >
              <div className="text-[11px] font-mono text-gray-500 shrink-0 pt-0.5 w-16 sm:w-20">
                <div className={fresh ? "text-rose-600 font-semibold" : ""}>
                  {relativeUpdateLabel(item.date)}
                </div>
                <div className="text-[10px] text-gray-400 mt-0.5">
                  {item.date}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap mb-1">
                  <button
                    type="button"
                    onClick={() => model && onOpen(model)}
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ring-1 ${ps.bg} ${ps.accent} ${ps.ring} hover:underline`}
                  >
                    {ps.label}
                  </button>
                  <button
                    type="button"
                    onClick={() => model && onOpen(model)}
                    className="text-sm font-medium text-gray-900 hover:text-primary transition-colors truncate text-left"
                  >
                    {item.modelName}
                  </button>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded ${ms.chipBg} ${ms.chipText}`}
                  >
                    {ms.label}
                  </span>
                  {fresh && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 inline-flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                      新
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-700 leading-relaxed">
                  {item.summary}
                </p>
              </div>
              <div className="shrink-0 flex flex-col gap-1">
                {item.url && (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-gray-400 hover:text-primary inline-flex items-center gap-0.5"
                    title="查看來源連結"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}

function FeaturedSpotlight({
  models,
  onOpen,
}: {
  models: AIModelEntry[];
  onOpen: (m: AIModelEntry) => void;
}) {
  if (models.length === 0) return null;

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-4">
        <h2 className="hs-h2 !mb-0 text-foreground inline-flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-amber-500" />
          本期精選模型
        </h2>
        <span className="text-xs text-muted-foreground">
          {models.length} 款值得認識
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {models.map(m => (
          <ModelCard key={m.id} model={m} onOpen={() => onOpen(m)} />
        ))}
      </div>
    </section>
  );
}

// ─── Timeline (latest releases) ────────────────────────────────────────────

function ReleasesTimeline({
  models,
  onOpen,
}: {
  models: AIModelEntry[];
  onOpen: (m: AIModelEntry) => void;
}) {
  const recent = useMemo(() => sortByLatest(models).slice(0, 8), [models]);
  if (recent.length === 0) return null;

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-4">
        <h2 className="hs-h2 !mb-0 text-foreground inline-flex items-center gap-2">
          <Calendar className="w-5 h-5 text-blue-500" />
          發表時序
        </h2>
        <span className="text-xs text-muted-foreground">由新到舊</span>
      </div>
      <div className="relative pl-5 border-l-2 border-border">
        {recent.map((m, i) => {
          const provider = PROVIDER_STYLE[m.provider];
          const modality = MODALITY_STYLE[m.modality];
          return (
            <motion.button
              key={m.id}
              type="button"
              onClick={() => onOpen(m)}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.03 }}
              className="relative block w-full text-left mb-3 p-3 rounded-xl hover:bg-muted/60 transition-colors group"
            >
              <span
                className={`absolute -left-[27px] top-4 w-3 h-3 rounded-full ring-2 ring-white ${provider.bg}`}
                style={{ boxShadow: "0 0 0 1px rgba(0,0,0,0.08)" }}
              />
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded ring-1 ${provider.bg} ${provider.accent} ${provider.ring}`}
                    >
                      {provider.label}
                    </span>
                    <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                      {m.name}
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${modality.chipBg} ${modality.chipText}`}
                    >
                      {modality.label}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                    {m.tagline}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-xs font-medium text-foreground/90">
                    {formatReleaseDate(m.releaseDate)}
                  </div>
                  <div className="text-[10px] text-muted-foreground/70">
                    {relativeRelease(m.releaseDate)}
                  </div>
                </div>
              </div>
            </motion.button>
          );
        })}
      </div>
    </section>
  );
}

// ─── News strip (model breakthrough articles from news.list) ───────────────

function NewsStrip() {
  const { data, isLoading } = trpc.news.list.useQuery(
    { limit: 6 },
    { staleTime: 60_000 }
  );

  const breakthroughs = useMemo(() => {
    const items = data?.items ?? [];
    const labeled = items.filter(i =>
      (i.tags ?? []).some(t => ["Model Breakthrough", "模型突破"].includes(t))
    );
    return (labeled.length > 0 ? labeled : items).slice(0, 4);
  }, [data]);

  if (isLoading) {
    return (
      <section className="mb-10">
        <h2 className="hs-h2 !mb-0 text-foreground mb-4 inline-flex items-center gap-2">
          <Newspaper className="w-5 h-5 text-rose-500" />
          模型新聞流
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-24 rounded-2xl bg-muted animate-pulse"
            />
          ))}
        </div>
      </section>
    );
  }

  if (breakthroughs.length === 0) return null;

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-4">
        <h2 className="hs-h2 !mb-0 text-foreground inline-flex items-center gap-2">
          <Newspaper className="w-5 h-5 text-rose-500" />
          模型新聞流
        </h2>
        <span className="text-xs text-muted-foreground">來自首頁情報站的最新動態</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {breakthroughs.map(item => (
          <a
            key={item.id}
            href={item.sourceUrl ?? "#"}
            target={item.sourceUrl ? "_blank" : undefined}
            rel="noopener noreferrer"
            className="group p-4 rounded-2xl border border-border hover:border-primary/30 hover:shadow-md transition-all bg-card"
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] px-2 py-0.5 bg-rose-50 text-rose-700 rounded-full font-medium">
                {item.sourceName}
              </span>
              {item.viewCount > 0 && (
                <span className="text-[10px] text-muted-foreground/70 inline-flex items-center gap-1">
                  <Eye className="w-3 h-3" />
                  {item.viewCount}
                </span>
              )}
            </div>
            <h3 className="text-sm font-semibold text-foreground line-clamp-2 group-hover:text-primary transition-colors">
              {item.title}
            </h3>
            <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
              {item.oarsSummary}
            </p>
          </a>
        ))}
      </div>
    </section>
  );
}

// ─── Discoveries panel (new models / new papers / model updates) ──────────
//
// 「研究 = 發現」。Cron 每天會去 web search 找最新發表的模型 / 論文 / 既有模型
// 的重大更新。這個 panel 是 discovery 的 UI 出口，admin 可以一鍵手動觸發。

function DiscoveriesPanel() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const utils = trpc.useUtils();
  const { data } = trpc.aiModels.discoveries.useQuery(
    { limit: 12 },
    { staleTime: 60_000, refetchInterval: 120_000 }
  );

  const runDiscovery = trpc.aiModels.runDiscovery.useMutation({
    onSuccess: data => {
      toast.success(data?.message ?? "已啟動發現");
      void utils.aiModels.discoveries.invalidate();
      void utils.aiModels.researchStats.invalidate();
    },
    onError: err => {
      toast.error(err.message ?? "無法啟動發現");
    },
  });

  const items = data?.items ?? [];
  const stats = data?.stats;

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="hs-h2 !mb-0 text-foreground inline-flex items-center gap-2">
          <Compass className="w-5 h-5 text-sky-500" />
          本期新發現
          {items.length > 0 && (
            <span className="text-xs text-muted-foreground font-normal">
              {items.length} 則
            </span>
          )}
        </h2>
        <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          {stats?.lastRunAt ? (
            <span title={stats.lastRunAt}>
              上次發現 · {relativeFromNow(stats.lastRunAt)}
            </span>
          ) : (
            <span>研究尚未跑過</span>
          )}
          {isAdmin && (
            <button
              type="button"
              onClick={() => runDiscovery.mutate()}
              disabled={runDiscovery.isPending}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-card border border-border hover:border-sky-300 hover:text-sky-700 disabled:opacity-50 disabled:cursor-not-allowed transition-healing"
              title="手動跑一次 discovery（找新模型 / 新論文）"
            >
              {runDiscovery.isPending ? (
                <RefreshCw className="w-3 h-3 animate-spin" />
              ) : (
                <Compass className="w-3 h-3" />
              )}
              立即發現
            </button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/40 p-5 text-sm text-muted-foreground">
          {stats?.lastRunError ? (
            <>
              <div className="inline-flex items-center gap-2 text-amber-700">
                <AlertCircle className="w-4 h-4" />
                <span className="font-medium">上次發現失敗</span>
              </div>
              <div className="text-xs text-amber-700/80 mt-1 break-words">
                {stats.lastRunError}
              </div>
            </>
          ) : (
            <span>
              研究 cron 還沒找到新東西；下一輪每天 03:30 自動執行。
            </span>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map(d => (
            <DiscoveryCard key={d.id} d={d} />
          ))}
        </div>
      )}
    </section>
  );
}

function DiscoveryCard({
  d,
}: {
  d: {
    id: string;
    kind: "new-model" | "new-paper" | "model-update";
    title: string;
    summary: string;
    url: string;
    date: string;
    discoveredAt: string;
    provider?: string;
    affectedModelId?: string;
    suggestedId?: string;
  };
}) {
  const tone =
    d.kind === "new-model"
      ? {
          label: "新模型",
          icon: PackagePlus,
          chip: "bg-emerald-50 text-emerald-700",
          ring: "hover:border-emerald-300",
        }
      : d.kind === "new-paper"
        ? {
            label: "新論文",
            icon: FileText,
            chip: "bg-violet-50 text-violet-700",
            ring: "hover:border-violet-300",
          }
        : {
            label: "模型更新",
            icon: Sparkles,
            chip: "bg-amber-50 text-amber-700",
            ring: "hover:border-amber-300",
          };
  const Icon = tone.icon;
  return (
    <a
      href={d.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`group block p-4 rounded-2xl border border-border bg-card transition-all hover:shadow-md ${tone.ring}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium ${tone.chip}`}
        >
          <Icon className="w-3 h-3" />
          {tone.label}
        </span>
        {d.provider && (
          <span className="text-[10px] px-2 py-0.5 bg-muted text-muted-foreground rounded-full font-medium">
            {d.provider}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground/70 ml-auto">
          {d.date}
        </span>
      </div>
      <h3 className="text-sm font-semibold text-foreground line-clamp-2 group-hover:text-primary transition-colors">
        {d.title}
      </h3>
      <p className="text-xs text-muted-foreground line-clamp-3 mt-1">
        {d.summary}
      </p>
      {(d.affectedModelId || d.suggestedId) && (
        <div className="mt-2 text-[11px] text-muted-foreground/80 inline-flex items-center gap-1 font-mono">
          <Link2 className="w-3 h-3" />
          {d.affectedModelId
            ? `對應 catalog：${d.affectedModelId}`
            : `建議 id：${d.suggestedId}`}
        </div>
      )}
    </a>
  );
}

// ─── Auto-research status panel ────────────────────────────────────────────
//
// 提供「手動 + 自動」雙軌：cron 走每週固定排程，admin 也可以從這裡立即觸發
// 全量研究。同時把上次跑的 metadata（耗時、嘗試/成功數、錯誤明細）都攤開來
// 讓策展者一眼能看到目前是不是健康。

// 數字會在值變化時平滑跳到新值（~600ms），讓 hero stats 有點生氣
function useAnimatedCount(target: number, durationMs = 600): number {
  const [value, setValue] = useState(target);
  useEffect(() => {
    if (value === target) return;
    const start = value;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / durationMs);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(start + (target - start) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // value intentionally excluded — we only re-animate when target moves
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);
  return value;
}

function StatTile({
  label,
  value,
  suffix,
  icon,
  tone,
}: {
  label: string;
  value: number;
  suffix?: string;
  icon?: React.ReactNode;
  tone?: "emerald" | "violet";
}) {
  const animated = useAnimatedCount(value);
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.25 }}
      className={`rounded-xl border border-border p-3 ${
        tone === "emerald"
          ? "bg-gradient-to-br from-emerald-500/8 to-card"
          : tone === "violet"
            ? "bg-gradient-to-br from-violet-500/8 to-card"
            : "bg-card"
      }`}
    >
      <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wider inline-flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div className="text-xl font-semibold text-foreground mt-0.5 tabular-nums">
        {animated}
        {suffix && (
          <span className="text-xs text-muted-foreground/70 font-normal">
            {suffix}
          </span>
        )}
      </div>
    </motion.div>
  );
}

// 把人類友善的「每天 / 每週 X / 平日 + HH:MM」轉成 5 段 cron 字串
function buildCronExpr(opts: {
  preset: "daily" | "weekday" | "weekly";
  weekday: number; // 0–6
  hour: number; // 0–23
  minute: number; // 0–59
}): string {
  const { preset, weekday, hour, minute } = opts;
  const m = String(minute);
  const h = String(hour);
  if (preset === "daily") return `${m} ${h} * * *`;
  if (preset === "weekday") return `${m} ${h} * * 1-5`;
  return `${m} ${h} * * ${weekday}`;
}

// 反向：盡力把 cron 解析回 picker 狀態；解析不到就回 null（讓 UI 退到 raw 模式）
function parseCronExpr(expr: string): {
  preset: "daily" | "weekday" | "weekly";
  weekday: number;
  hour: number;
  minute: number;
} | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, mon, dow] = parts;
  if (dom !== "*" || mon !== "*") return null;
  if (!/^\d+$/.test(min) || !/^\d+$/.test(hour)) return null;
  const m = parseInt(min, 10);
  const h = parseInt(hour, 10);
  if (m < 0 || m > 59 || h < 0 || h > 23) return null;
  if (dow === "*") {
    return { preset: "daily", weekday: 0, hour: h, minute: m };
  }
  if (dow === "1-5") {
    return { preset: "weekday", weekday: 0, hour: h, minute: m };
  }
  if (/^\d$/.test(dow)) {
    return {
      preset: "weekly",
      weekday: parseInt(dow, 10),
      hour: h,
      minute: m,
    };
  }
  return null;
}

function ScheduleEditorDialog({
  open,
  onOpenChange,
  initialCron,
  envOverride,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  initialCron: string;
  envOverride: boolean;
}) {
  const utils = trpc.useUtils();
  const setSchedule = trpc.aiModels.setSchedule.useMutation({
    onSuccess: data => {
      toast.success(data.message ?? "排程已更新");
      void utils.aiModels.researchStats.invalidate();
      onOpenChange(false);
    },
    onError: err => {
      toast.error(err.message ?? "更新排程失敗");
    },
  });

  const parsed = parseCronExpr(initialCron);
  const [mode, setMode] = useState<"picker" | "raw">(parsed ? "picker" : "raw");
  const [preset, setPreset] = useState<"daily" | "weekday" | "weekly">(
    parsed?.preset ?? "daily"
  );
  const [weekday, setWeekday] = useState<number>(parsed?.weekday ?? 0);
  const [hour, setHour] = useState<number>(parsed?.hour ?? 3);
  const [minute, setMinute] = useState<number>(parsed?.minute ?? 30);
  const [rawCron, setRawCron] = useState<string>(initialCron);

  useEffect(() => {
    if (!open) return;
    const p = parseCronExpr(initialCron);
    setMode(p ? "picker" : "raw");
    setPreset(p?.preset ?? "daily");
    setWeekday(p?.weekday ?? 0);
    setHour(p?.hour ?? 3);
    setMinute(p?.minute ?? 30);
    setRawCron(initialCron);
  }, [open, initialCron]);

  const computedCron =
    mode === "picker"
      ? buildCronExpr({ preset, weekday, hour, minute })
      : rawCron.trim();
  const preview = humanizeCron(computedCron);
  const dirty = computedCron !== initialCron;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-sky-600" />
            設定自動研究排程
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* mode switch */}
          <div className="inline-flex rounded-full bg-muted p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setMode("picker")}
              className={`px-3 py-1 rounded-full transition-all ${
                mode === "picker"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground"
              }`}
            >
              快速選擇
            </button>
            <button
              type="button"
              onClick={() => setMode("raw")}
              className={`px-3 py-1 rounded-full transition-all ${
                mode === "raw"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground"
              }`}
            >
              自訂 cron
            </button>
          </div>

          {mode === "picker" ? (
            <div className="space-y-3">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground/70 mb-1">
                  頻率
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(["daily", "weekday", "weekly"] as const).map(p => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPreset(p)}
                      className={`text-xs px-2.5 py-1 rounded-full transition-all ring-1 ${
                        preset === p
                          ? "bg-foreground text-background ring-foreground"
                          : "bg-card text-muted-foreground ring-border hover:ring-border"
                      }`}
                    >
                      {p === "daily"
                        ? "每天"
                        : p === "weekday"
                          ? "週一到週五"
                          : "每週指定日"}
                    </button>
                  ))}
                </div>
              </div>

              {preset === "weekly" && (
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground/70 mb-1">
                    星期
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {WEEKDAY_LABELS.map((label, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setWeekday(i)}
                        className={`text-xs px-2.5 py-1 rounded-full transition-all ring-1 ${
                          weekday === i
                            ? "bg-foreground text-background ring-foreground"
                            : "bg-card text-muted-foreground ring-border"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground/70 mb-1">
                    時
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={hour}
                    onChange={e =>
                      setHour(Math.max(0, Math.min(23, Number(e.target.value) || 0)))
                    }
                    className="w-full px-3 py-1.5 rounded-md bg-background border border-border text-sm"
                  />
                </div>
                <div className="text-muted-foreground text-lg pt-5">：</div>
                <div className="flex-1">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground/70 mb-1">
                    分
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={minute}
                    onChange={e =>
                      setMinute(
                        Math.max(0, Math.min(59, Number(e.target.value) || 0))
                      )
                    }
                    className="w-full px-3 py-1.5 rounded-md bg-background border border-border text-sm"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground/70 mb-1">
                Cron 表達式（5 段：分 時 日 月 週）
              </div>
              <input
                type="text"
                value={rawCron}
                onChange={e => setRawCron(e.target.value)}
                placeholder="30 3 * * *"
                className="w-full px-3 py-1.5 rounded-md bg-background border border-border text-sm font-mono"
              />
              <div className="text-[11px] text-muted-foreground/70 mt-1">
                範例：<code>0 */6 * * *</code>（每 6 小時）、
                <code>0 9 * * 1-5</code>（平日早上 9 點）
              </div>
            </div>
          )}

          {/* preview */}
          <div className="rounded-lg bg-muted/40 border border-border/60 p-3 text-xs">
            <div className="text-muted-foreground/70 mb-0.5">預覽</div>
            <div className="font-medium text-foreground">{preview}</div>
            <code className="text-[11px] text-muted-foreground/80 mt-0.5 block">
              {computedCron || "—"}
            </code>
          </div>

          {envOverride && (
            <div className="text-[11px] text-amber-700 bg-amber-50/60 border border-amber-200/60 rounded-md p-2">
              注意：目前由環境變數 <code>MODEL_RESEARCH_CRON_SCHEDULE</code> 設定。
              這裡的變更即時生效，但 process 重啟後會被環境變數覆蓋。
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={setSchedule.isPending}
          >
            取消
          </Button>
          <Button
            size="sm"
            onClick={() => setSchedule.mutate({ schedule: computedCron })}
            disabled={!dirty || !computedCron || setSchedule.isPending}
          >
            {setSchedule.isPending ? "儲存中…" : "儲存"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AutoResearchPanel({
  staleCount,
  verifiedCount,
}: {
  staleCount: number;
  verifiedCount: number;
}) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const utils = trpc.useUtils();
  const [showErrors, setShowErrors] = useState(false);
  const [scheduleEditorOpen, setScheduleEditorOpen] = useState(false);

  const { data } = trpc.aiModels.researchStats.useQuery(undefined, {
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const refreshAll = trpc.aiModels.refreshAll.useMutation({
    onSuccess: data => {
      toast.success(data?.message ?? "已在背景啟動完整研究");
      void utils.aiModels.researchStats.invalidate();
      void utils.aiModels.list.invalidate();
    },
    onError: err => {
      toast.error(err.message ?? "無法啟動研究");
    },
  });
  const refreshStale = trpc.aiModels.refreshStale.useMutation({
    onSuccess: data => {
      toast.success(data?.message ?? "已啟動 stale 模型補抓");
      void utils.aiModels.researchStats.invalidate();
      void utils.aiModels.list.invalidate();
    },
    onError: err => {
      toast.error(err.message ?? "無法啟動 stale 補抓");
    },
  });

  if (!data) return null;
  const last = data.stats.lastRunAt;
  const inProgress = data.isRunning;
  const coveragePct = Math.round((data.stats.coverage ?? 0) * 100);
  const tried = data.stats.lastRunModelsTried;
  const succeeded = data.stats.lastRunModelsSucceeded;
  const duration = data.stats.lastRunDurationMs;
  const totalRuns = data.stats.totalRunsCompleted;
  const errors = data.stats.lastRunErrors;
  const scheduleLabel = humanizeCron(data.schedule);

  return (
    <div className="mt-4 rounded-2xl border border-border bg-gradient-to-br from-sky-500/5 via-card to-violet-500/5 overflow-hidden">
      {/* Header: 狀態 + 主要動作 */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-border/60">
        <div className="inline-flex items-center gap-2">
          <span
            className={`relative inline-flex items-center justify-center w-7 h-7 rounded-full ${
              inProgress
                ? "bg-sky-100 text-sky-600"
                : data.scheduled
                  ? "bg-emerald-50 text-emerald-600"
                  : "bg-muted text-muted-foreground"
            }`}
          >
            <Activity
              className={`w-3.5 h-3.5 ${inProgress ? "animate-pulse" : ""}`}
            />
            {inProgress && (
              <span className="absolute inset-0 rounded-full ring-2 ring-sky-300/60 animate-ping" />
            )}
          </span>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-foreground">
              自動研究 ·{" "}
              <span
                className={
                  inProgress
                    ? "text-sky-600"
                    : data.scheduled
                      ? "text-emerald-600"
                      : "text-muted-foreground"
                }
              >
                {inProgress
                  ? "進行中"
                  : data.scheduled
                    ? "排程已啟用"
                    : "排程已停用"}
              </span>
            </div>
            <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5">
              <span>{scheduleLabel}</span>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setScheduleEditorOpen(true)}
                  className="inline-flex items-center justify-center w-4 h-4 rounded-full text-muted-foreground/70 hover:text-primary hover:bg-muted transition-healing"
                  title="調整自動研究排程"
                  aria-label="調整自動研究排程"
                >
                  <Clock className="w-3 h-3" />
                </button>
              )}
              <span className="text-muted-foreground/60 mx-0.5">·</span>
              累積 {totalRuns} 輪
            </div>
          </div>
        </div>

        {isAdmin && (
          <ScheduleEditorDialog
            open={scheduleEditorOpen}
            onOpenChange={setScheduleEditorOpen}
            initialCron={data.schedule}
            envOverride={Boolean(data.envOverride)}
          />
        )}

        <div className="ml-auto inline-flex items-center gap-2 flex-wrap justify-end">
          {isAdmin ? (
            <>
              <button
                type="button"
                onClick={() => refreshStale.mutate()}
                disabled={
                  inProgress ||
                  refreshAll.isPending ||
                  refreshStale.isPending ||
                  staleCount + (data.totalModels - verifiedCount - staleCount) === 0
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-card border border-border text-foreground/90 hover:border-primary/40 hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed transition-healing"
                title="只重抓 stale / pending / error 的模型，比完整研究便宜很多"
              >
                {refreshStale.isPending ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Clock className="w-3.5 h-3.5" />
                )}
                只刷新過期 ({staleCount + (data.totalModels - verifiedCount - staleCount)})
              </button>
              <button
                type="button"
                onClick={() => refreshAll.mutate()}
                disabled={inProgress || refreshAll.isPending || refreshStale.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-foreground text-background hover:bg-foreground/85 disabled:opacity-50 disabled:cursor-not-allowed transition-healing"
                title="立即在背景跑一輪完整 catalog 自動研究"
              >
                {refreshAll.isPending || inProgress ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <PlayCircle className="w-3.5 h-3.5" />
                )}
                {inProgress ? "研究進行中…" : "手動執行完整研究"}
              </button>
            </>
          ) : (
            <span className="text-[11px] text-muted-foreground/70">
              管理員可手動觸發研究
            </span>
          )}
        </div>
      </div>

      {/* 細節 grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border/40">
        <div className="bg-card/80 p-3">
          <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">
            覆蓋率
          </div>
          <div className="mt-0.5 text-sm font-semibold text-foreground">
            {coveragePct}%
            <span className="text-[11px] font-normal text-muted-foreground/70 ml-1">
              （{data.totalModels} 款）
            </span>
          </div>
        </div>
        <div className="bg-card/80 p-3">
          <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wider inline-flex items-center gap-1">
            <ShieldCheck className="w-2.5 h-2.5 text-emerald-500" />
            已驗證 / 待補
          </div>
          <div className="mt-0.5 text-sm font-semibold text-foreground">
            {verifiedCount}
            {staleCount > 0 && (
              <span className="text-[11px] font-normal text-amber-600 ml-1">
                · {staleCount} 過期
              </span>
            )}
          </div>
        </div>
        <div className="bg-card/80 p-3">
          <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wider inline-flex items-center gap-1">
            <Clock className="w-2.5 h-2.5 text-muted-foreground/70" />
            上次研究
          </div>
          <div
            className="mt-0.5 text-sm font-semibold text-foreground truncate"
            title={last ? formatAbsoluteTime(last) : "尚未執行"}
          >
            {last ? relativeFromNow(last).replace("驗證", "") : "尚未執行"}
          </div>
          {last && (
            <div className="text-[10px] text-muted-foreground/70 truncate">
              {formatAbsoluteTime(last)}
            </div>
          )}
        </div>
        <div className="bg-card/80 p-3">
          <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">
            上次耗時 / 嘗試
          </div>
          <div className="mt-0.5 text-sm font-semibold text-foreground">
            {formatDurationMs(duration)}
          </div>
          <div className="text-[10px] text-muted-foreground/70">
            {tried > 0 ? `${succeeded}/${tried} 成功` : "—"}
          </div>
        </div>
      </div>

      {/* 錯誤摺疊區 */}
      {errors.length > 0 && (
        <div className="border-t border-border/60">
          <button
            type="button"
            onClick={() => setShowErrors(v => !v)}
            className="w-full flex items-center gap-2 px-4 py-2 text-xs text-amber-700 hover:bg-amber-50/40 transition-healing"
          >
            <AlertCircle className="w-3.5 h-3.5" />
            <span className="font-medium">上次有 {errors.length} 個錯誤</span>
            <ChevronDown
              className={`w-3.5 h-3.5 ml-auto transition-transform ${
                showErrors ? "rotate-180" : ""
              }`}
            />
          </button>
          {showErrors && (
            <div className="px-4 pb-3 max-h-40 overflow-y-auto">
              <ul className="space-y-1 text-[11px] text-amber-800 font-mono">
                {errors.slice(0, 50).map((e, i) => (
                  <li
                    key={i}
                    className="pl-2 border-l-2 border-amber-200 leading-relaxed break-words"
                  >
                    {e}
                  </li>
                ))}
                {errors.length > 50 && (
                  <li className="pl-2 text-amber-600 italic">
                    …還有 {errors.length - 50} 筆未顯示
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Compare bar (floating bottom) ────────────────────────────────────────

function CompareBar({
  ids,
  allModels,
  onClear,
  onOpen,
  onRemove,
}: {
  ids: string[];
  allModels: AIModelEntry[];
  onClear: () => void;
  onOpen: () => void;
  onRemove: (id: string) => void;
}) {
  const selected = useMemo(
    () =>
      ids
        .map(id => allModels.find(m => m.id === id))
        .filter((m): m is AIModelEntry => Boolean(m)),
    [ids, allModels]
  );

  return (
    <AnimatePresence>
      {selected.length > 0 && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: "spring", stiffness: 280, damping: 28 }}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[min(640px,calc(100vw-2rem))]"
        >
          <div className="rounded-2xl bg-card/95 backdrop-blur-md border border-border shadow-xl shadow-fuchsia-500/10 px-3 py-2 flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground shrink-0">
              已選 <span className="font-semibold text-foreground">{selected.length}</span> / 4
            </span>
            <div className="flex-1 flex items-center gap-1 overflow-x-auto">
              {selected.map(m => {
                const ps = PROVIDER_STYLE[m.provider];
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onRemove(m.id)}
                    title="從比較中移除"
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ring-1 shrink-0 ${ps.bg} ${ps.accent} ${ps.ring} hover:opacity-80`}
                  >
                    {m.name}
                    <X className="w-2.5 h-2.5 opacity-70" />
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={onClear}
              className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-muted shrink-0"
            >
              清除
            </button>
            <Button
              size="sm"
              onClick={onOpen}
              disabled={selected.length < 2}
              className="bg-gradient-to-r from-fuchsia-500 to-violet-500 text-white border-0 hover:opacity-90 shrink-0"
            >
              <Layers className="w-3.5 h-3.5 mr-1" />
              比較
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Comparison view (full screen side-by-side) ──────────────────────────

function ComparisonView({
  ids,
  allModels,
  onClose,
  onOpenModel,
}: {
  ids: string[];
  allModels: AIModelEntry[];
  onClose: () => void;
  onOpenModel: (m: AIModelEntry) => void;
}) {
  const models = useMemo(
    () =>
      ids
        .map(id => allModels.find(m => m.id === id))
        .filter((m): m is AIModelEntry => Boolean(m)),
    [ids, allModels]
  );

  if (models.length < 2) {
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>比較需要至少 2 款模型</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  const rows: Array<{
    label: string;
    render: (m: AIModelEntry) => React.ReactNode;
  }> = [
    {
      label: "廠商",
      render: m => PROVIDER_STYLE[m.provider]?.label ?? m.provider,
    },
    { label: "模態", render: m => MODALITY_STYLE[m.modality]?.label ?? m.modality },
    { label: "層級", render: m => TIER_STYLE[m.tier]?.label ?? m.tier },
    { label: "發佈", render: m => formatReleaseDate(m.releaseDate) },
    { label: "上下文", render: m => m.contextWindow ?? "—" },
    {
      label: "Input",
      render: m =>
        m.pricing?.inputPerMillion ? (
          <span className="font-mono">{m.pricing.inputPerMillion}</span>
        ) : (
          "—"
        ),
    },
    {
      label: "Output",
      render: m =>
        m.pricing?.outputPerMillion ? (
          <span className="font-mono">{m.pricing.outputPerMillion}</span>
        ) : (
          "—"
        ),
    },
    {
      label: "計價單位",
      render: m => (
        <span className="text-[11px]">{m.pricing?.unit ?? "—"}</span>
      ),
    },
    {
      label: "Top benchmark",
      render: m =>
        m.benchmarks?.[0] ? (
          <span>
            <span className="text-muted-foreground/80">
              {m.benchmarks[0].name}
            </span>{" "}
            <span className="font-semibold">{m.benchmarks[0].score}</span>
          </span>
        ) : (
          "—"
        ),
    },
    {
      label: "視覺輸入",
      render: m => capYesNo(m.capabilities?.visionInput),
    },
    {
      label: "工具呼叫",
      render: m => capYesNo(m.capabilities?.functionCalling),
    },
    {
      label: "程式執行",
      render: m => capYesNo(m.capabilities?.codeExecution),
    },
    { label: "網頁搜尋", render: m => capYesNo(m.capabilities?.webSearch) },
    {
      label: "Prompt 快取",
      render: m => capYesNo(m.capabilities?.promptCaching),
    },
    { label: "Batch API", render: m => capYesNo(m.capabilities?.batchApi) },
    {
      label: "開源權重",
      render: m => (m.openWeight ? "✓" : "—"),
    },
    {
      label: "安全分級",
      render: m => m.safetyTier ?? "—",
    },
    {
      label: "合規",
      render: m =>
        m.compliance && m.compliance.length > 0 ? (
          <span className="font-mono text-[10px]">{m.compliance.join(" · ")}</span>
        ) : (
          "—"
        ),
    },
    {
      label: "API / Web / 自架",
      render: m => {
        const a = m.availability;
        if (!a) return "—";
        const pick = (b: boolean) => (b ? "✓" : "—");
        return (
          <span className="font-mono text-[11px]">
            {pick(a.api)} / {pick(a.web)} / {pick(a.selfHost)}
          </span>
        );
      },
    },
    {
      label: "代管平台",
      render: m =>
        m.hostedOn && m.hostedOn.length > 0 ? (
          <span className="flex flex-wrap gap-0.5">
            {m.hostedOn.map(h => (
              <span
                key={h}
                className="text-[10px] px-1 rounded bg-muted text-muted-foreground"
              >
                {HOSTING_LABELS[h]}
              </span>
            ))}
          </span>
        ) : (
          "—"
        ),
    },
    {
      label: "代理 sandbox",
      render: m => {
        if (m.modality !== "agent" || !m.agentDetails?.sandbox) return "—";
        return SANDBOX_LABELS[m.agentDetails.sandbox] ?? m.agentDetails.sandbox;
      },
    },
    {
      label: "背景執行",
      render: m =>
        m.agentDetails?.asyncCapable === undefined
          ? "—"
          : m.agentDetails.asyncCapable
            ? "✓"
            : "需開著",
    },
    {
      label: "標籤",
      render: m =>
        m.tags.length > 0 ? (
          <span className="flex flex-wrap gap-0.5">
            {m.tags.slice(0, 4).map(t => (
              <span
                key={t}
                className="text-[10px] px-1 rounded bg-muted text-muted-foreground"
              >
                {t}
              </span>
            ))}
          </span>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent
        showCloseButton={false}
        className="max-w-5xl max-h-[92vh] overflow-hidden flex flex-col p-0 gap-0 rounded-3xl"
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b shrink-0 bg-gradient-to-r from-fuchsia-500/5 via-card to-violet-500/5">
          <Layers className="w-5 h-5 text-fuchsia-600" />
          <h2 className="hs-h2 !mb-0 text-foreground">並列比較 · {models.length} 款模型</h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto p-2 rounded-xl hover:bg-muted text-muted-foreground/70 hover:text-foreground"
            aria-label="關閉"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-5">
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: `minmax(110px,140px) repeat(${models.length}, minmax(0, 1fr))`,
              }}
            >
              {/* header row */}
              <div />
              {models.map(m => {
                const ps = PROVIDER_STYLE[m.provider];
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onOpenModel(m)}
                    className={`text-left rounded-xl border border-border bg-card p-3 hover:border-primary/40 hover:shadow-md transition-all`}
                  >
                    <div
                      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md ring-1 mb-1 ${ps.bg} ${ps.accent} ${ps.ring}`}
                    >
                      {ps.label}
                    </div>
                    <div className="text-sm font-semibold text-foreground leading-tight">
                      {m.name}
                    </div>
                    {m.apiId && (
                      <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
                        {m.apiId}
                      </div>
                    )}
                  </button>
                );
              })}

              {/* rows */}
              {rows.map((row, ri) => (
                <React.Fragment key={ri}>
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground/70 py-2 border-t border-border/40">
                    {row.label}
                  </div>
                  {models.map(m => (
                    <div
                      key={m.id}
                      className="text-sm text-foreground/90 py-2 border-t border-border/40 min-w-0 break-words"
                    >
                      {row.render(m)}
                    </div>
                  ))}
                </React.Fragment>
              ))}
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function capYesNo(v: boolean | undefined): React.ReactNode {
  if (v === undefined) return "—";
  return v ? (
    <span className="text-emerald-600">✓</span>
  ) : (
    <span className="text-muted-foreground">—</span>
  );
}

// ─── Hosting labels ───────────────────────────────────────────────────────

const HOSTING_LABELS: Record<NonNullable<AIModelEntry["hostedOn"]>[number], string> = {
  fal: "Fal.ai",
  replicate: "Replicate",
  openrouter: "OpenRouter",
  bedrock: "AWS Bedrock",
  vertex: "GCP Vertex",
  together: "Together",
  huggingface: "🤗 HF",
  groq: "Groq",
  "azure-openai": "Azure OpenAI",
  self: "自架",
};

// ─── Main page ─────────────────────────────────────────────────────────────

export default function AIModelsHub() {
  const [, navigate] = useLocation();
  const [activeModality, setActiveModality] = useState<ModalityTabId>(
    "all"
  );
  const [activeProvider, setActiveProvider] = useState<ModelProvider | "all">(
    "all"
  );
  const [activeTier, setActiveTier] = useState<ModelTier | "all">("all");
  const [search, setSearch] = useState("");
  const [openModel, setOpenModel] = useState<AIModelEntry | null>(null);
  // ── Comparison system ───────────────────────────────────────────────────
  // 使用者可勾選最多 4 款模型，底部出現浮動 bar；按「比較」開全螢幕並列表
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const toggleCompare = (id: string) => {
    setCompareIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 4) {
        toast.warning("最多同時比較 4 款模型");
        return prev;
      }
      return [...prev, id];
    });
  };

  const { data: catalogData } = trpc.aiModels.list.useQuery(undefined, {
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  // Server is the source of truth, but fall back to baseline if it's still loading
  // or the server-side cache is empty (first deploy before the first cron run).
  const allModels = useMemo<AIModelEntry[]>(() => {
    if (catalogData?.models && catalogData.models.length > 0) {
      return catalogData.models as AIModelEntry[];
    }
    return AI_MODELS_CATALOG;
  }, [catalogData]);

  const allProviders = useMemo(() => {
    const fromServer = new Set<ModelProvider>(
      allModels.map(m => m.provider as ModelProvider)
    );
    // Keep the union of static + server so filter pills are stable even mid-load
    for (const p of getUniqueProviders()) fromServer.add(p);
    return Array.from(fromServer);
  }, [allModels]);

  const featured = useMemo(
    () =>
      catalogData?.models && catalogData.models.length > 0
        ? (catalogData.models.filter(m => m.featured) as AIModelEntry[])
        : getFeaturedModels(),
    [catalogData]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allModels.filter(m => {
      // 「深度研究」分頁用 category 過濾，其他用 modality
      if (activeModality === "deep-research") {
        if (m.category !== "deep-research") return false;
      } else if (activeModality !== "all" && m.modality !== activeModality) {
        return false;
      }
      if (activeProvider !== "all" && m.provider !== activeProvider)
        return false;
      if (activeTier !== "all" && m.tier !== activeTier) return false;
      if (!q) return true;
      const hay = [
        m.name,
        m.apiId ?? "",
        m.tagline,
        m.description,
        m.provider,
        ...m.tags,
        ...m.useCases,
        ...(m.benchmarks?.map(b => b.name) ?? []),
        ...(m.latestUpdates?.map(u => u.summary) ?? []),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [allModels, activeModality, activeProvider, activeTier, search]);

  const sorted = useMemo(() => sortByLatest(filtered), [filtered]);

  // ── PageAgent registration: let the orb drive filters ────────────────────
  const agentCapabilities = useMemo<AgentCapability[]>(
    () => [
      {
        action: "setTab",
        label: "分頁切換",
        hint: "all / text / image / video / audio / multimodal / agent / deep-research",
        options: MODALITY_TABS.map(t => ({ id: t.id, label: t.label })),
      },
      {
        action: "search",
        label: "搜尋模型",
        hint: "在名稱、描述、能力標籤、benchmark、更新中搜尋",
      },
      {
        action: "setParam",
        label: "進階篩選",
        hint: "key 可為 provider 或 tier",
      },
      { action: "reset", label: "重置篩選" },
    ],
    []
  );

  useRegisterPageAgent({
    pageId: "ai-models-hub",
    pageLabel: "AI 模型情報專區",
    pagePath: "/ai-models-hub",
    capabilities: agentCapabilities,
    state: {
      activeModality,
      activeProvider,
      activeTier,
      searchQuery: search,
      visibleModels: sorted.length,
      totalModels: allModels.length,
      verifiedCount: catalogData?.meta.verifiedCount ?? 0,
      lastResearchAt: catalogData?.meta.lastResearchAt ?? null,
    },
    handle: async (action: AgentAction): Promise<AgentActionResult> => {
      switch (action.type) {
        case "setTab": {
          const id = action.tabId as ModalityTabId;
          if (
            [
              "all",
              "text",
              "image",
              "video",
              "audio",
              "multimodal",
              "agent",
              "deep-research",
            ].includes(id)
          ) {
            setActiveModality(id);
            return { ok: true, message: `已切換到「${id}」分頁` };
          }
          return { ok: false, reason: `不認得的分頁：${action.tabId}` };
        }
        case "search": {
          setSearch(action.query);
          return { ok: true, message: `已搜尋：${action.query}` };
        }
        case "setParam": {
          if (action.key === "provider") {
            setActiveProvider(action.value as ModelProvider | "all");
            return { ok: true, message: `篩選 provider：${action.value}` };
          }
          if (action.key === "tier") {
            setActiveTier(action.value as ModelTier | "all");
            return { ok: true, message: `篩選 tier：${action.value}` };
          }
          return { ok: false, reason: `不支援的參數 key：${action.key}` };
        }
        case "reset": {
          setActiveModality("all");
          setActiveProvider("all");
          setActiveTier("all");
          setSearch("");
          return { ok: true, message: "已重置所有篩選" };
        }
        default:
          return { ok: false, reason: "此頁面不支援該動作" };
      }
    },
  });

  // ── ESC closes modal ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!openModel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenModel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openModel]);

  const hasActiveFilters =
    activeModality !== "all" ||
    activeProvider !== "all" ||
    activeTier !== "all" ||
    search.length > 0;

  const verifiedCount = catalogData?.meta.verifiedCount ?? 0;
  const staleCount = catalogData?.meta.staleCount ?? 0;

  return (
    <div className="flex-1 w-full">
      <div className="page-shell page-shell-wide">
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <header className="page-header">
          <div className="flex items-center gap-3">
            <VisualSoul size="sm" state="thinking" personality="creative" />
            <span className="page-eyebrow">
              情報站 · 深入專區 · 自動研究
            </span>
          </div>
          <h1 className="page-title">AI 模型情報專區</h1>
          <p className="page-subtitle">
            一份由人工策展、再由自動管線每週查證的當代主流 AI 模型總覽。
            <span className="text-foreground font-medium">
              {" "}
              模態 · 廠商 · 層級{" "}
            </span>
            篩選之外，每個模型都附{" "}
            <span className="text-foreground font-medium">
              最新定價、基準分數、近期更新與引用來源
            </span>
            。
          </p>

          {/* Stats strip — counters animate when value changes */}
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatTile label="模型總數" value={allModels.length} />
            <StatTile label="廠商" value={allProviders.length} />
            <StatTile label="精選" value={featured.length} />
            <StatTile
              label="已自動查核"
              icon={
                <ShieldCheck className="w-2.5 h-2.5 text-emerald-600" />
              }
              value={verifiedCount}
              suffix={` / ${allModels.length}`}
              tone="emerald"
            />
          </div>

          {/* Auto-research panel: 自動排程 + 手動觸發 + 上次跑的細節 */}
          <AutoResearchPanel
            staleCount={staleCount}
            verifiedCount={verifiedCount}
          />
        </header>

        {/* ── Featured spotlight ───────────────────────────────────────── */}
        {!hasActiveFilters && (
          <FeaturedSpotlight models={featured} onOpen={setOpenModel} />
        )}

        {/* ── Discoveries (new models / new papers / model updates) ──── */}
        {!hasActiveFilters && <DiscoveriesPanel />}

        {/* ── Cross-model latest activity feed ─────────────────────────── */}
        {!hasActiveFilters && (
          <CrossModelUpdatesFeed
            models={allModels}
            onOpen={setOpenModel}
            limit={10}
          />
        )}

        {/* ── Filter bar ───────────────────────────────────────────────── */}
        <section className="mb-6 sticky top-0 z-10 -mx-2 px-2 py-3 bg-gradient-to-b from-background via-background/95 to-background/80 backdrop-blur-sm">
          {/* Modality tabs */}
          <div className="flex flex-wrap gap-2 mb-3">
            {MODALITY_TABS.map(t => {
              const Icon = t.icon;
              const active = activeModality === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveModality(t.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    active
                      ? "bg-foreground text-background shadow-sm"
                      : "bg-card border border-border text-muted-foreground hover:border-border"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Provider + Tier + Search */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Provider select-as-pills (compact) */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setActiveProvider("all")}
                className={`text-[11px] px-2.5 py-1 rounded-full transition-all ${
                  activeProvider === "all"
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                所有廠商
              </button>
              {allProviders.map(p => {
                const active = activeProvider === p;
                const ps = PROVIDER_STYLE[p];
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setActiveProvider(p)}
                    className={`text-[11px] px-2.5 py-1 rounded-full transition-all ring-1 ${
                      active
                        ? `${ps.bg} ${ps.accent} ${ps.ring} ring-2`
                        : "bg-card text-muted-foreground ring-border hover:ring-border"
                    }`}
                  >
                    {ps.label}
                  </button>
                );
              })}
            </div>

            <div className="hidden sm:block w-px h-5 bg-border mx-1" />

            {/* Tier */}
            <div className="flex items-center gap-1.5">
              {TIER_FILTERS.map(t => {
                const active = activeTier === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setActiveTier(t.id)}
                    className={`text-[11px] px-2.5 py-1 rounded-full transition-all ${
                      active
                        ? "bg-foreground text-background"
                        : "bg-card border border-border text-muted-foreground hover:border-border"
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>

            <div className="flex-1" />

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/70" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="搜尋模型、能力或用途…"
                className="h-8 pl-8 text-xs w-56"
              />
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  setActiveModality("all");
                  setActiveProvider("all");
                  setActiveTier("all");
                  setSearch("");
                }}
                className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              >
                <X className="w-3 h-3" />
                清除篩選
              </button>
            )}
          </div>
        </section>

        {/* ── Result count ─────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 mb-4 text-xs text-muted-foreground">
          <Filter className="w-3.5 h-3.5" />
          顯示 {sorted.length} 款模型
          {hasActiveFilters && (
            <span className="text-muted-foreground/70">（套用篩選後）</span>
          )}
        </div>

        {/* ── Model grid ────────────────────────────────────────────── */}
        <AnimatePresence mode="popLayout">
          {sorted.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="rounded-2xl border border-dashed border-border p-10 text-center"
            >
              <div className="text-3xl mb-2">🔍</div>
              <div className="text-sm font-medium text-foreground/90 mb-1">
                找不到符合條件的模型
              </div>
              <div className="text-xs text-muted-foreground">
                試著放寬篩選或修改關鍵字
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="grid"
              layout
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-10"
            >
              {sorted.map(m => (
                <ModelCard
                  key={m.id}
                  model={m}
                  onOpen={() => setOpenModel(m)}
                  inCompare={compareIds.includes(m.id)}
                  onToggleCompare={() => toggleCompare(m.id)}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Releases timeline ─────────────────────────────────────── */}
        <ReleasesTimeline models={allModels} onOpen={setOpenModel} />

        {/* ── Live news strip ──────────────────────────────────────── */}
        <NewsStrip />

        {/* ── Footer CTA ─────────────────────────────────────────── */}
        <section className="mt-10 rounded-2xl border border-border bg-gradient-to-br from-blue-500/5 via-card to-purple-500/5 p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-2xl bg-card ring-1 ring-border">
              <Zap className="w-5 h-5 text-amber-500" />
            </div>
            <div className="flex-1">
              <h3 className="hs-h3 !mb-0 text-foreground mb-1">
                找到合適的模型了嗎？
              </h3>
              <p className="text-sm text-muted-foreground mb-3">
                從目錄選定模型後，可前往
                <span className="text-foreground font-medium"> 我的模型 </span>
                訓練專屬 LoRA，或到
                <span className="text-foreground font-medium"> 創作中心 </span>
                直接開始使用。
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => navigate("/create")}
                  className="rounded-full"
                >
                  進入創作中心
                  <ArrowRight className="w-3.5 h-3.5 ml-1" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate("/models")}
                  className="rounded-full"
                >
                  我的模型
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => navigate("/learn")}
                  className="rounded-full"
                >
                  學習文件中心
                </Button>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* ── Detail modal ─────────────────────────────────────────────── */}
      {openModel && (
        <ModelDetailModal
          model={openModel}
          allModels={allModels}
          onOpen={setOpenModel}
          onClose={() => setOpenModel(null)}
        />
      )}

      {/* ── Floating compare bar ─────────────────────────────────────── */}
      <CompareBar
        ids={compareIds}
        allModels={allModels}
        onClear={() => setCompareIds([])}
        onOpen={() => setCompareOpen(true)}
        onRemove={id => setCompareIds(prev => prev.filter(x => x !== id))}
      />

      {/* ── Comparison view ─────────────────────────────────────────── */}
      {compareOpen && (
        <ComparisonView
          ids={compareIds}
          allModels={allModels}
          onClose={() => setCompareOpen(false)}
          onOpenModel={m => {
            setCompareOpen(false);
            setOpenModel(m);
          }}
        />
      )}
    </div>
  );
}
