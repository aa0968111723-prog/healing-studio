/**
 * AIModelsHub.tsx — AI 模型情報專區
 *
 * 將 IntelBentoGrid（首頁情報站）延伸成一個深入專區頁面：
 *   - 上半：人工策展的主流 AI 模型目錄（卡片網格 + 篩選 + 詳情）
 *   - 下半：news.list 的「Model Breakthrough」即時新聞流
 *
 * 設計原則：
 *   - 沿用 LearnHub 的 dashboard 風格（light theme + glass cards）
 *   - 篩選軸：模態 / 廠商 / 層級 / 開源
 *   - 點擊卡片開啟詳情 Modal（強弱項、建議情境、官方連結）
 *   - 整合 PageAgent，讓光球可代為導航與篩選
 */

import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { trpc } from "@/lib/trpc";
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
} from "lucide-react";
import {
  AI_MODELS_CATALOG,
  PROVIDER_STYLE,
  MODALITY_STYLE,
  TIER_STYLE,
  getUniqueProviders,
  getFeaturedModels,
  sortByLatest,
  type AIModelEntry,
  type ModelModality,
  type ModelProvider,
  type ModelTier,
} from "@/data/aiModelsCatalog";

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
          <span className="text-[11px] text-gray-400">
            {relativeRelease(model.releaseDate)}
          </span>
          <span className="inline-flex items-center gap-0.5 text-[11px] text-gray-400 group-hover:text-primary transition-colors">
            查看詳情
            <ChevronRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
          </span>
        </div>
      </div>
    </motion.button>
  );
}

// ─── Model detail modal ────────────────────────────────────────────────────

function ModelDetailModal({
  model,
  onClose,
}: {
  model: AIModelEntry;
  onClose: () => void;
}) {
  const provider = PROVIDER_STYLE[model.provider];
  const modality = MODALITY_STYLE[model.modality];
  const tier = TIER_STYLE[model.tier];

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0 rounded-3xl">
        {model.featured && (
          <div className="h-1 bg-gradient-to-r from-amber-400 via-orange-400 to-pink-400 shrink-0" />
        )}

        {/* Header */}
        <div className="flex items-start gap-4 p-6 pb-4 border-b shrink-0">
          <div
            className={`p-3 rounded-2xl ring-1 ${provider.bg} ${provider.ring} shrink-0`}
          >
            <Cpu className={`w-6 h-6 ${provider.accent}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap gap-2 mb-2">
              <Badge variant="outline" className={`text-[10px] ${provider.accent}`}>
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
            {model.apiId && (
              <p className="text-xs font-mono text-gray-500 mt-1">
                {model.apiId}
              </p>
            )}
            <p className="text-sm text-gray-600 mt-2">{model.tagline}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors shrink-0"
            aria-label="關閉"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-6 space-y-6">
            {/* Spec strip */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
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
            </div>

            {/* Description */}
            <section>
              <h3 className="hs-h3 !mb-0 text-gray-900 mb-2">關於這個模型</h3>
              <p className="text-sm text-gray-700 leading-relaxed">
                {model.description}
              </p>
            </section>

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
        <span className="text-xs text-gray-500">{models.length} 款值得認識</span>
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
    // Try to surface model-breakthrough flagged items; fall back to recent.
    const labeled = items.filter(i =>
      (i.tags ?? []).some(t =>
        ["Model Breakthrough", "模型突破"].includes(t)
      )
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
        <span className="text-xs text-gray-500">
          來自首頁情報站的最新動態
        </span>
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

  const allProviders = useMemo(() => getUniqueProviders(), []);
  const featured = useMemo(() => getFeaturedModels(), []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return AI_MODELS_CATALOG.filter(m => {
      if (activeModality !== "all" && m.modality !== activeModality) return false;
      if (activeProvider !== "all" && m.provider !== activeProvider) return false;
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
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [activeModality, activeProvider, activeTier, search]);

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
        hint: "在名稱、描述、能力標籤中搜尋",
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
      totalModels: AI_MODELS_CATALOG.length,
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

  return (
    <div className="flex-1 w-full">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <header className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <VisualSoul size="sm" state="thinking" personality="creative" />
            <span className="text-xs text-gray-500 tracking-wider uppercase">
              情報站 · 深入專區
            </span>
          </div>
          <h1 className="hs-h1 !mb-2 text-gray-900">AI 模型情報專區</h1>
          <p className="text-sm sm:text-base text-gray-600 max-w-2xl leading-relaxed">
            一份由人工策展的當代主流 AI 模型總覽。從旗艦推理到開源權重，依
            <span className="text-gray-800 font-medium"> 模態 · 廠商 · 層級 </span>
            篩選，快速找到適合你需求的模型，並即時掌握模型發表動態。
          </p>

          {/* Stats strip */}
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="text-[10px] text-gray-400 uppercase tracking-wider">
                模型總數
              </div>
              <div className="text-xl font-semibold text-gray-900 mt-0.5">
                {AI_MODELS_CATALOG.length}
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
            <div className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="text-[10px] text-gray-400 uppercase tracking-wider">
                開源權重
              </div>
              <div className="text-xl font-semibold text-gray-900 mt-0.5">
                {AI_MODELS_CATALOG.filter(m => m.openWeight).length}
              </div>
            </div>
          </div>
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
        <ReleasesTimeline
          models={AI_MODELS_CATALOG}
          onOpen={setOpenModel}
        />

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
          onClose={() => setOpenModel(null)}
        />
      )}
    </div>
  );
}
