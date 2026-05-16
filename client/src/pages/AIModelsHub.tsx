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

import { useEffect, useMemo, useState } from "react";
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

const MODALITY_TABS: Array<{
  id: ModelModality | "all";
  label: string;
  icon: typeof MessageSquare;
}> = [
  { id: "all", label: "全部", icon: Layers },
  { id: "text", label: "文字", icon: MessageSquare },
  { id: "multimodal", label: "多模態", icon: Sparkles },
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
  return m ? `${y} 年 ${parseInt(m, 10)} 月` : y;
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

function ModelCard({
  model,
  onOpen,
}: {
  model: AIModelEntry;
  onOpen: () => void;
}) {
  const provider = PROVIDER_STYLE[model.provider];
  const modality = MODALITY_STYLE[model.modality];
  const tier = TIER_STYLE[model.tier];
  const factStatus = computeFactCheckStatus(model.factCheck);
  const pricingTier = model.pricing?.tier
    ? PRICING_TIER_STYLE[model.pricing.tier]
    : null;
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
      className="group text-left cursor-pointer rounded-2xl border border-gray-200/70 dark:border-white/10 bg-white dark:bg-white/5 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 transition-all duration-200 overflow-hidden w-full"
    >
      {model.featured && (
        <div className="h-0.5 bg-gradient-to-r from-amber-400 via-orange-400 to-pink-400" />
      )}

      <div className="p-5">
        {/* Header row: provider badge + modality + tier */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div
            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold ring-1 ${provider.bg} ${provider.accent} ${provider.ring}`}
          >
            {provider.label}
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
        <h3 className="hs-h3 !mb-0 text-gray-900 dark:text-white mb-1 group-hover:text-primary transition-colors">
          {model.name}
        </h3>
        {model.apiId && (
          <p className="text-[11px] font-mono text-gray-400 mb-2">
            {model.apiId}
          </p>
        )}

        {/* Tagline */}
        <p className="hs-small !mb-0 text-gray-600 dark:text-gray-300 line-clamp-2 mb-3">
          {model.tagline}
        </p>

        {/* Quick spec row */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {model.contextWindow && (
            <span className="text-[10px] px-2 py-0.5 bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 rounded-full">
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
          <span className="text-[10px] px-2 py-0.5 bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-gray-400 rounded-full inline-flex items-center gap-1">
            <Calendar className="w-2.5 h-2.5" />
            {formatReleaseDate(model.releaseDate)}
          </span>
        </div>

        {/* Tags */}
        {model.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {model.tags.slice(0, 3).map(t => (
              <span
                key={t}
                className="text-[10px] px-2 py-0.5 bg-gray-50 dark:bg-white/5 text-gray-500 dark:text-gray-400 rounded-full"
              >
                #{t}
              </span>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-white/5">
          <FactCheckBadge
            status={factStatus}
            checkedAt={model.factCheck?.checkedAt}
          />
          <div className="inline-flex items-center gap-1.5">
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
                className={`p-1 rounded-full transition-colors ${
                  refreshOne.isPending
                    ? "text-sky-500"
                    : "text-gray-300 hover:text-primary hover:bg-primary/5"
                }`}
              >
                <RefreshCw
                  className={`w-3 h-3 ${refreshOne.isPending ? "animate-spin" : ""}`}
                />
              </span>
            )}
            <span className="inline-flex items-center gap-0.5 text-[11px] text-gray-400 group-hover:text-primary transition-colors">
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
    <section className="rounded-xl border border-gray-200 bg-gradient-to-br from-emerald-50/40 via-white to-sky-50/40 p-4">
      <div className="flex items-center gap-2 mb-2">
        <DollarSign className="w-4 h-4 text-emerald-600" />
        <h3 className="hs-h3 !mb-0 text-gray-900">定價</h3>
        <span
          className={`ml-auto text-[10px] font-medium px-2 py-0.5 rounded-full ${tier.chipBg} ${tier.chipText}`}
          title={tier.hint}
        >
          {tier.label}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
        {model.pricing.inputPerMillion && (
          <div className="rounded-lg bg-white border border-gray-100 px-3 py-2">
            <div className="text-[10px] text-gray-400 uppercase tracking-wider">
              Input
            </div>
            <div className="text-sm font-semibold text-gray-900">
              {model.pricing.inputPerMillion}
            </div>
            <div className="text-[10px] text-gray-500">
              {model.pricing.unit}
            </div>
          </div>
        )}
        {model.pricing.outputPerMillion && (
          <div className="rounded-lg bg-white border border-gray-100 px-3 py-2">
            <div className="text-[10px] text-gray-400 uppercase tracking-wider">
              Output
            </div>
            <div className="text-sm font-semibold text-gray-900">
              {model.pricing.outputPerMillion}
            </div>
            <div className="text-[10px] text-gray-500">
              {model.pricing.unit}
            </div>
          </div>
        )}
        {!model.pricing.inputPerMillion && !model.pricing.outputPerMillion && (
          <div className="rounded-lg bg-white border border-gray-100 px-3 py-2 sm:col-span-3">
            <div className="text-[10px] text-gray-400 uppercase tracking-wider">
              計價方式
            </div>
            <div className="text-sm font-medium text-gray-900">
              {model.pricing.unit}
            </div>
          </div>
        )}
      </div>
      {model.pricing.note && (
        <p className="text-xs text-gray-600 mt-2 leading-relaxed">
          <span className="text-gray-400">註：</span>
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
      <h3 className="hs-h3 !mb-0 text-gray-900 mb-2 inline-flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-indigo-500" />
        基準分數
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {model.benchmarks.map((b, i) => (
          <div
            key={i}
            className="rounded-lg border border-gray-200 bg-white p-3 flex items-start justify-between gap-3"
          >
            <div className="min-w-0">
              <div className="text-xs font-medium text-gray-800">{b.name}</div>
              {b.rank && (
                <div className="text-[10px] text-gray-400 mt-0.5">{b.rank}</div>
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
                  className="text-[10px] text-gray-400 hover:text-primary inline-flex items-center gap-0.5"
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
      <h3 className="hs-h3 !mb-0 text-gray-900 mb-2 inline-flex items-center gap-2">
        <Newspaper className="w-4 h-4 text-rose-500" />
        最新動態（自動追蹤）
      </h3>
      <div className="space-y-2">
        {model.latestUpdates.map((u, i) => (
          <div
            key={i}
            className="rounded-lg border border-gray-200 bg-white p-3"
          >
            <div className="flex items-start gap-3">
              <div className="text-[10px] font-mono text-gray-500 shrink-0 pt-0.5">
                {u.date}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-700 leading-relaxed">
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
      <h3 className="hs-h3 !mb-0 text-gray-900 mb-2 inline-flex items-center gap-2">
        <Globe className="w-4 h-4 text-blue-500" />
        取得管道
      </h3>
      <div className="flex flex-wrap gap-2">
        <span
          className={`text-xs px-3 py-1 rounded-full ${a.api ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-gray-100 text-gray-500"}`}
        >
          {a.api ? "✓" : "—"} API
        </span>
        <span
          className={`text-xs px-3 py-1 rounded-full ${a.web ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-gray-100 text-gray-500"}`}
        >
          {a.web ? "✓" : "—"} Web UI
        </span>
        <span
          className={`text-xs px-3 py-1 rounded-full inline-flex items-center gap-1 ${a.selfHost ? "bg-violet-50 text-violet-700 border border-violet-200" : "bg-gray-100 text-gray-500"}`}
        >
          {a.selfHost ? <Server className="w-3 h-3" /> : null}
          {a.selfHost ? "可自架" : "無法自架"}
        </span>
      </div>
      {a.notes && (
        <p className="text-xs text-gray-600 mt-2 leading-relaxed">{a.notes}</p>
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
    <section className="rounded-xl border border-gray-200 bg-white p-4">
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
              className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 hover:border-primary/40 hover:shadow-sm transition-all text-left group"
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
    <section className="rounded-xl border border-gray-200 bg-gradient-to-br from-sky-50/40 via-white to-violet-50/40 p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="hs-h3 !mb-0 text-gray-900 inline-flex items-center gap-2">
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
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-white border border-gray-200 text-gray-600 hover:border-primary/40 hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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

      <p className="text-xs text-gray-600 mb-3 leading-relaxed">
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
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
            引用來源（{factCheck.sources.length}）
          </div>
          {factCheck.sources.map((s, i) => (
            <a
              key={i}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-lg bg-white border border-gray-200 hover:border-primary/40 transition-colors p-2.5 group"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <Link2 className="w-3 h-3 text-gray-400 shrink-0" />
                <span className="text-[11px] font-medium text-gray-800 truncate group-hover:text-primary">
                  {s.title}
                </span>
                {s.domain && (
                  <span className="text-[10px] text-gray-400 ml-auto shrink-0">
                    {s.domain}
                  </span>
                )}
              </div>
              {s.snippet && (
                <p className="text-[10px] text-gray-500 line-clamp-2 leading-relaxed pl-5">
                  {s.snippet}
                </p>
              )}
            </a>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-500 italic">
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
              <DialogTitle className="hs-h2 !mb-0 text-gray-900 leading-tight">
                {model.name}
              </DialogTitle>
            </DialogHeader>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
              {model.apiId && (
                <p className="text-xs font-mono text-gray-500">{model.apiId}</p>
              )}
              <FactCheckBadge
                status={factStatus}
                checkedAt={model.factCheck?.checkedAt}
              />
            </div>
            <p className="text-sm text-gray-600 mt-2 leading-relaxed">
              {model.tagline}
            </p>
          </div>
          <button
            onClick={onClose}
            className="absolute top-3 right-3 sm:top-4 sm:right-4 p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
            aria-label="關閉"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-6 space-y-6">
            {/* Spec strip */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <div className="rounded-xl border border-gray-200 bg-white p-3">
                <div className="text-[10px] text-gray-400 uppercase tracking-wider">
                  發佈時間
                </div>
                <div className="text-sm font-medium text-gray-800 mt-0.5">
                  {formatReleaseDate(model.releaseDate)}
                </div>
              </div>
              {model.contextWindow && (
                <div className="rounded-xl border border-gray-200 bg-white p-3">
                  <div className="text-[10px] text-gray-400 uppercase tracking-wider">
                    上下文視窗
                  </div>
                  <div className="text-sm font-medium text-gray-800 mt-0.5">
                    {model.contextWindow}
                  </div>
                </div>
              )}
              <div className="rounded-xl border border-gray-200 bg-white p-3">
                <div className="text-[10px] text-gray-400 uppercase tracking-wider">
                  授權方式
                </div>
                <div className="text-sm font-medium text-gray-800 mt-0.5">
                  {model.openWeight ? "開源權重" : "閉源 / API"}
                </div>
              </div>
              {model.trainingCutoff && (
                <div className="rounded-xl border border-gray-200 bg-white p-3">
                  <div className="text-[10px] text-gray-400 uppercase tracking-wider">
                    訓練截止
                  </div>
                  <div className="text-sm font-medium text-gray-800 mt-0.5">
                    {formatReleaseDate(model.trainingCutoff)}
                  </div>
                </div>
              )}
              {model.latencyClass && (
                <div className="rounded-xl border border-gray-200 bg-white p-3">
                  <div className="text-[10px] text-gray-400 uppercase tracking-wider">
                    回應延遲
                  </div>
                  <div className="text-sm font-medium text-gray-800 mt-0.5">
                    {LATENCY_LABELS[model.latencyClass]}
                  </div>
                </div>
              )}
              {model.languages && model.languages.length > 0 && (
                <div className="rounded-xl border border-gray-200 bg-white p-3">
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
                <div className="rounded-xl border border-gray-200 bg-white p-3 sm:col-span-2">
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
              <h3 className="hs-h3 !mb-0 text-gray-900 mb-2">關於這個模型</h3>
              <p className="text-sm text-gray-700 leading-relaxed">
                {model.description}
              </p>
            </section>

            {/* Pricing — auto-researched */}
            <PricingBlock model={model} />

            {/* Benchmarks — auto-researched */}
            <BenchmarkBlock model={model} />

            {/* Capabilities matrix */}
            <CapabilitiesBlock model={model} />

            {/* Latest updates — auto-researched */}
            <LatestUpdatesBlock model={model} />

            {/* Availability */}
            <AvailabilityBlock model={model} />

            {/* Safety + compliance */}
            <SafetyComplianceBlock model={model} />

            {/* Strengths */}
            <section>
              <h3 className="hs-h3 !mb-0 text-gray-900 mb-2 inline-flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                強項
              </h3>
              <ul className="space-y-1.5">
                {model.strengths.map((s, i) => (
                  <li
                    key={i}
                    className="text-sm text-gray-700 pl-4 relative leading-relaxed"
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
                <h3 className="hs-h3 !mb-0 text-gray-900 mb-2 inline-flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600" />
                  使用前要知道
                </h3>
                <ul className="space-y-1.5">
                  {model.limitations.map((s, i) => (
                    <li
                      key={i}
                      className="text-sm text-gray-700 pl-4 relative leading-relaxed"
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
              <h3 className="hs-h3 !mb-0 text-gray-900 mb-2 inline-flex items-center gap-2">
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
                <h3 className="hs-h3 !mb-0 text-gray-900 mb-2">標籤</h3>
                <div className="flex flex-wrap gap-1.5">
                  {model.tags.map(t => (
                    <span
                      key={t}
                      className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded-md"
                    >
                      #{t}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* Tier description */}
            <section className="rounded-xl border border-gray-200 bg-gray-50/50 p-4">
              <div className="text-xs font-semibold text-gray-700 mb-1">
                關於「{tier.label}」層級
              </div>
              <div className="text-xs text-gray-600">{tier.description}</div>
            </section>
          </div>
        </ScrollArea>

        {/* Footer with official link */}
        {model.officialUrl && (
          <div className="border-t p-4 shrink-0 flex items-center justify-between gap-3 bg-gray-50/50">
            <span className="text-xs text-gray-500">官方資訊與最新文件</span>
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
        <h2 className="hs-h2 !mb-0 text-gray-900 inline-flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-amber-500" />
          本期精選模型
        </h2>
        <span className="text-xs text-gray-500">
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
        <h2 className="hs-h2 !mb-0 text-gray-900 inline-flex items-center gap-2">
          <Calendar className="w-5 h-5 text-blue-500" />
          發表時序
        </h2>
        <span className="text-xs text-gray-500">由新到舊</span>
      </div>
      <div className="relative pl-5 border-l-2 border-gray-200">
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
              className="relative block w-full text-left mb-3 p-3 rounded-xl hover:bg-gray-50 transition-colors group"
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
                    <span className="text-sm font-medium text-gray-900 group-hover:text-primary transition-colors">
                      {m.name}
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${modality.chipBg} ${modality.chipText}`}
                    >
                      {modality.label}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">
                    {m.tagline}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-xs font-medium text-gray-700">
                    {formatReleaseDate(m.releaseDate)}
                  </div>
                  <div className="text-[10px] text-gray-400">
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
        <h2 className="hs-h2 !mb-0 text-gray-900 mb-4 inline-flex items-center gap-2">
          <Newspaper className="w-5 h-5 text-rose-500" />
          模型新聞流
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-24 rounded-2xl bg-gray-100 animate-pulse"
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
        <h2 className="hs-h2 !mb-0 text-gray-900 inline-flex items-center gap-2">
          <Newspaper className="w-5 h-5 text-rose-500" />
          模型新聞流
        </h2>
        <span className="text-xs text-gray-500">來自首頁情報站的最新動態</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {breakthroughs.map(item => (
          <a
            key={item.id}
            href={item.sourceUrl ?? "#"}
            target={item.sourceUrl ? "_blank" : undefined}
            rel="noopener noreferrer"
            className="group p-4 rounded-2xl border border-gray-200 hover:border-primary/30 hover:shadow-md transition-all bg-white"
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] px-2 py-0.5 bg-rose-50 text-rose-700 rounded-full font-medium">
                {item.sourceName}
              </span>
              {item.viewCount > 0 && (
                <span className="text-[10px] text-gray-400 inline-flex items-center gap-1">
                  <Eye className="w-3 h-3" />
                  {item.viewCount}
                </span>
              )}
            </div>
            <h3 className="text-sm font-semibold text-gray-900 line-clamp-2 group-hover:text-primary transition-colors">
              {item.title}
            </h3>
            <p className="text-xs text-gray-500 line-clamp-2 mt-1">
              {item.oarsSummary}
            </p>
          </a>
        ))}
      </div>
    </section>
  );
}

// ─── Auto-research status panel ────────────────────────────────────────────
//
// 提供「手動 + 自動」雙軌：cron 走每週固定排程，admin 也可以從這裡立即觸發
// 全量研究。同時把上次跑的 metadata（耗時、嘗試/成功數、錯誤明細）都攤開來
// 讓策展者一眼能看到目前是不是健康。

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
    <div className="mt-4 rounded-2xl border border-gray-200 bg-gradient-to-br from-sky-50/40 via-white to-violet-50/40 overflow-hidden">
      {/* Header: 狀態 + 主要動作 */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-gray-100/80">
        <div className="inline-flex items-center gap-2">
          <span
            className={`relative inline-flex items-center justify-center w-7 h-7 rounded-full ${
              inProgress
                ? "bg-sky-100 text-sky-600"
                : data.scheduled
                  ? "bg-emerald-50 text-emerald-600"
                  : "bg-gray-100 text-gray-500"
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
            <div className="text-sm font-semibold text-gray-800">
              自動研究 ·{" "}
              <span
                className={
                  inProgress
                    ? "text-sky-600"
                    : data.scheduled
                      ? "text-emerald-600"
                      : "text-gray-500"
                }
              >
                {inProgress
                  ? "進行中"
                  : data.scheduled
                    ? "排程已啟用"
                    : "排程已停用"}
              </span>
            </div>
            <div className="text-[11px] text-gray-500">
              {scheduleLabel}
              <span className="text-gray-300 mx-1.5">·</span>
              累積 {totalRuns} 輪
            </div>
          </div>
        </div>

        <div className="ml-auto inline-flex items-center gap-2">
          {isAdmin ? (
            <button
              type="button"
              onClick={() => refreshAll.mutate()}
              disabled={inProgress || refreshAll.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="立即在背景跑一輪完整 catalog 自動研究"
            >
              {refreshAll.isPending || inProgress ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <PlayCircle className="w-3.5 h-3.5" />
              )}
              {inProgress ? "研究進行中…" : "手動執行完整研究"}
            </button>
          ) : (
            <span className="text-[11px] text-gray-400">
              管理員可手動觸發研究
            </span>
          )}
        </div>
      </div>

      {/* 細節 grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-gray-100/70">
        <div className="bg-white/80 p-3">
          <div className="text-[10px] text-gray-400 uppercase tracking-wider">
            覆蓋率
          </div>
          <div className="mt-0.5 text-sm font-semibold text-gray-800">
            {coveragePct}%
            <span className="text-[11px] font-normal text-gray-400 ml-1">
              （{data.totalModels} 款）
            </span>
          </div>
        </div>
        <div className="bg-white/80 p-3">
          <div className="text-[10px] text-gray-400 uppercase tracking-wider inline-flex items-center gap-1">
            <ShieldCheck className="w-2.5 h-2.5 text-emerald-500" />
            已驗證 / 待補
          </div>
          <div className="mt-0.5 text-sm font-semibold text-gray-800">
            {verifiedCount}
            {staleCount > 0 && (
              <span className="text-[11px] font-normal text-amber-600 ml-1">
                · {staleCount} 過期
              </span>
            )}
          </div>
        </div>
        <div className="bg-white/80 p-3">
          <div className="text-[10px] text-gray-400 uppercase tracking-wider inline-flex items-center gap-1">
            <Clock className="w-2.5 h-2.5 text-gray-400" />
            上次研究
          </div>
          <div
            className="mt-0.5 text-sm font-semibold text-gray-800 truncate"
            title={last ? formatAbsoluteTime(last) : "尚未執行"}
          >
            {last ? relativeFromNow(last).replace("驗證", "") : "尚未執行"}
          </div>
          {last && (
            <div className="text-[10px] text-gray-400 truncate">
              {formatAbsoluteTime(last)}
            </div>
          )}
        </div>
        <div className="bg-white/80 p-3">
          <div className="text-[10px] text-gray-400 uppercase tracking-wider">
            上次耗時 / 嘗試
          </div>
          <div className="mt-0.5 text-sm font-semibold text-gray-800">
            {formatDurationMs(duration)}
          </div>
          <div className="text-[10px] text-gray-400">
            {tried > 0 ? `${succeeded}/${tried} 成功` : "—"}
          </div>
        </div>
      </div>

      {/* 錯誤摺疊區 */}
      {errors.length > 0 && (
        <div className="border-t border-gray-100/80">
          <button
            type="button"
            onClick={() => setShowErrors(v => !v)}
            className="w-full flex items-center gap-2 px-4 py-2 text-xs text-amber-700 hover:bg-amber-50/40 transition-colors"
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

// ─── Main page ─────────────────────────────────────────────────────────────

export default function AIModelsHub() {
  const [, navigate] = useLocation();
  const [activeModality, setActiveModality] = useState<ModelModality | "all">(
    "all"
  );
  const [activeProvider, setActiveProvider] = useState<ModelProvider | "all">(
    "all"
  );
  const [activeTier, setActiveTier] = useState<ModelTier | "all">("all");
  const [search, setSearch] = useState("");
  const [openModel, setOpenModel] = useState<AIModelEntry | null>(null);

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
      if (activeModality !== "all" && m.modality !== activeModality)
        return false;
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
        label: "模態切換",
        hint: "支援 all / text / image / video / audio / multimodal",
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
          const id = action.tabId as ModelModality | "all";
          if (
            ["all", "text", "image", "video", "audio", "multimodal"].includes(
              id
            )
          ) {
            setActiveModality(id);
            return { ok: true, message: `已切換到「${id}」模態` };
          }
          return { ok: false, reason: `不認得的模態：${action.tabId}` };
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
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <header className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <VisualSoul size="sm" state="thinking" personality="creative" />
            <span className="text-xs text-gray-500 tracking-wider uppercase">
              情報站 · 深入專區 · 自動研究
            </span>
          </div>
          <h1 className="hs-h1 !mb-2 text-gray-900">AI 模型情報專區</h1>
          <p className="text-sm sm:text-base text-gray-600 max-w-2xl leading-relaxed">
            一份由人工策展、再由自動管線每週查證的當代主流 AI 模型總覽。
            <span className="text-gray-800 font-medium">
              {" "}
              模態 · 廠商 · 層級{" "}
            </span>
            篩選之外，每個模型都附{" "}
            <span className="text-gray-800 font-medium">
              最新定價、基準分數、近期更新與引用來源
            </span>
            。
          </p>

          {/* Stats strip */}
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="text-[10px] text-gray-400 uppercase tracking-wider">
                模型總數
              </div>
              <div className="text-xl font-semibold text-gray-900 mt-0.5">
                {allModels.length}
              </div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="text-[10px] text-gray-400 uppercase tracking-wider">
                廠商
              </div>
              <div className="text-xl font-semibold text-gray-900 mt-0.5">
                {allProviders.length}
              </div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="text-[10px] text-gray-400 uppercase tracking-wider">
                精選
              </div>
              <div className="text-xl font-semibold text-gray-900 mt-0.5">
                {featured.length}
              </div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-gradient-to-br from-emerald-50 to-white p-3">
              <div className="text-[10px] text-gray-400 uppercase tracking-wider inline-flex items-center gap-1">
                <ShieldCheck className="w-2.5 h-2.5 text-emerald-600" />
                已自動查核
              </div>
              <div className="text-xl font-semibold text-gray-900 mt-0.5">
                {verifiedCount}
                <span className="text-xs text-gray-400 font-normal">
                  {" "}
                  / {allModels.length}
                </span>
              </div>
            </div>
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

        {/* ── Filter bar ───────────────────────────────────────────────── */}
        <section className="mb-6 sticky top-0 z-10 -mx-2 px-2 py-3 bg-gradient-to-b from-white via-white/95 to-white/80 backdrop-blur-sm">
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
                      ? "bg-gray-900 text-white shadow-sm"
                      : "bg-white border border-gray-200 text-gray-600 hover:border-gray-300"
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
                    ? "bg-gray-900 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
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
                        : "bg-white text-gray-500 ring-gray-200 hover:ring-gray-300"
                    }`}
                  >
                    {ps.label}
                  </button>
                );
              })}
            </div>

            <div className="hidden sm:block w-px h-5 bg-gray-200 mx-1" />

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
                        ? "bg-gray-900 text-white"
                        : "bg-white border border-gray-200 text-gray-500 hover:border-gray-300"
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
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
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
                className="text-[11px] text-gray-500 hover:text-gray-800 inline-flex items-center gap-1"
              >
                <X className="w-3 h-3" />
                清除篩選
              </button>
            )}
          </div>
        </section>

        {/* ── Result count ─────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 mb-4 text-xs text-gray-500">
          <Filter className="w-3.5 h-3.5" />
          顯示 {sorted.length} 款模型
          {hasActiveFilters && (
            <span className="text-gray-400">（套用篩選後）</span>
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
              className="rounded-2xl border border-dashed border-gray-300 p-10 text-center"
            >
              <div className="text-3xl mb-2">🔍</div>
              <div className="text-sm font-medium text-gray-700 mb-1">
                找不到符合條件的模型
              </div>
              <div className="text-xs text-gray-500">
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
        <section className="mt-10 rounded-2xl border border-gray-200 bg-gradient-to-br from-blue-50/40 via-white to-purple-50/40 p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-2xl bg-white ring-1 ring-gray-200">
              <Zap className="w-5 h-5 text-amber-500" />
            </div>
            <div className="flex-1">
              <h3 className="hs-h3 !mb-0 text-gray-900 mb-1">
                找到合適的模型了嗎？
              </h3>
              <p className="text-sm text-gray-600 mb-3">
                從目錄選定模型後，可前往
                <span className="text-gray-800 font-medium"> 我的模型 </span>
                訓練專屬 LoRA，或到
                <span className="text-gray-800 font-medium"> 創作中心 </span>
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
    </div>
  );
}
