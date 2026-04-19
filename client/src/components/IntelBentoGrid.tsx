/**
 * IntelBentoGrid.tsx — 情報站 Bento Grid 網格
 *
 * 依後端權重標籤實作資訊權重佈局：
 *   - Model Breakthrough → 跨列/跨行寬視角卡片（hero card）
 *   - Inspiration Tip → 網格邊角小方塊
 *   - 其他標籤 → 中等尺寸卡片
 *
 * 設計原則：
 *   - 大面積留白取代擁擠資訊
 *   - 廢棄紅點通知
 *   - 結合 Radix Tabs 分類切換
 *   - 結合 Radix ScrollArea 可捲動區域
 */

import {
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
  lazy,
  Suspense,
  memo,
} from "react";
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useTransform,
  useSpring,
} from "framer-motion";
import { trpc } from "@/lib/trpc";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";
import Autoplay from "embla-carousel-autoplay";
import {
  Zap,
  Lightbulb,
  TrendingUp,
  Wrench,
  Users,
  BookOpen,
  Newspaper,
  ExternalLink,
  Eye,
  Clock,
  ChevronRight,
} from "lucide-react";
import type { SceneId } from "@/components/AmbientEnvironment";
import {
  useSenseEngine,
  useCardSenseProps,
  useSectionScrollSense,
} from "@/hooks/useSenseEngine";
import ArticleDialog from "@/components/ArticleDialog";

// ─── Weight Label Config ────────────────────────────────────────────────────

type WeightLabel =
  | "Model Breakthrough"
  | "Inspiration Tip"
  | "Industry Shift"
  | "Creative Tool"
  | "Community Spotlight"
  | "Tutorial Guide"
  | "General Update";

interface WeightConfig {
  icon: typeof Zap;
  label: string;
  /** Bento grid span: "hero" = col-span-2 row-span-2, "medium" = col-span-1 row-span-2, "small" = col-span-1 row-span-1 */
  size: "hero" | "medium" | "small";
  accentColor: string;
  accentBg: string;
}

const WEIGHT_CONFIG: Record<WeightLabel, WeightConfig> = {
  "Model Breakthrough": {
    icon: Zap,
    label: "模型突破",
    size: "hero",
    accentColor: "text-amber-400",
    accentBg: "bg-amber-400/10",
  },
  "Inspiration Tip": {
    icon: Lightbulb,
    label: "靈感技巧",
    size: "small",
    accentColor: "text-emerald-400",
    accentBg: "bg-emerald-400/10",
  },
  "Industry Shift": {
    icon: TrendingUp,
    label: "產業動態",
    size: "medium",
    accentColor: "text-blue-400",
    accentBg: "bg-blue-400/10",
  },
  "Creative Tool": {
    icon: Wrench,
    label: "創作工具",
    size: "medium",
    accentColor: "text-violet-400",
    accentBg: "bg-violet-400/10",
  },
  "Community Spotlight": {
    icon: Users,
    label: "社群焦點",
    size: "small",
    accentColor: "text-rose-400",
    accentBg: "bg-rose-400/10",
  },
  "Tutorial Guide": {
    icon: BookOpen,
    label: "教學指南",
    size: "small",
    accentColor: "text-cyan-400",
    accentBg: "bg-cyan-400/10",
  },
  "General Update": {
    icon: Newspaper,
    label: "一般更新",
    size: "small",
    accentColor: "text-slate-400",
    accentBg: "bg-slate-400/10",
  },
};

const KNOWN_WEIGHT_LABELS = Object.keys(WEIGHT_CONFIG) as WeightLabel[];

// ─── Tab definitions ────────────────────────────────────────────────────────
//
// Each tab maps to a *bucket of weight labels*. Using positive membership lists
// (instead of negative "NOT X AND NOT Y" filters) ensures every label is
// routed to exactly one tab, so tabs never end up empty just because the OARS
// classifier skewed toward a single label.

type TabValue = "all" | "breakthrough" | "tips" | "industry";

const TAB_BUCKETS: Record<Exclude<TabValue, "all">, readonly WeightLabel[]> = {
  breakthrough: ["Model Breakthrough"],
  tips: ["Inspiration Tip", "Tutorial Guide", "Community Spotlight"],
  industry: ["Industry Shift", "Creative Tool", "General Update"],
};

const TABS: ReadonlyArray<{ value: TabValue; label: string }> = [
  { value: "all", label: "全部" },
  { value: "breakthrough", label: "模型突破" },
  { value: "tips", label: "靈感技巧" },
  { value: "industry", label: "產業與工具" },
];

/**
 * Keyword fallback: when an article's weight label is "General Update" (the
 * server-side default when Gemini returns something unrecognized), try to
 * derive a better bucket from the title/summary text. Prevents the 靈感技巧
 * tab from starving when upstream classification is noisy.
 */
function deriveBucketFromText(
  title: string,
  summary: string | null | undefined
): Exclude<TabValue, "all"> | null {
  const text = `${title} ${summary ?? ""}`.toLowerCase();
  if (
    /tip|trick|prompt|workflow|tutorial|guide|how to|技巧|心法|教學|入門|指南/.test(
      text
    )
  ) {
    return "tips";
  }
  if (
    /launch|release|platform|tool|update|feature|roll ?out|發佈|推出|上線|更新|工具|平台/.test(
      text
    )
  ) {
    return "industry";
  }
  if (/breakthrough|model|release of|sota|突破|發表/.test(text)) {
    return "breakthrough";
  }
  return null;
}

function bucketForItem(item: NewsItem): Exclude<TabValue, "all"> {
  const wl = getWeightLabel(item.tags);
  // 1. Trust the server label first, unless it's the catch-all
  if (wl !== "General Update") {
    for (const [bucket, labels] of Object.entries(TAB_BUCKETS) as Array<
      [Exclude<TabValue, "all">, readonly WeightLabel[]]
    >) {
      if (labels.includes(wl)) return bucket;
    }
  }
  // 2. Keyword fallback for General Update
  const guessed = deriveBucketFromText(item.title, item.oarsSummary);
  if (guessed) return guessed;
  // 3. Final fallback: treat as industry news
  return "industry";
}

// ─── Helper: extract weight label from tags ─────────────────────────────────

function getWeightLabel(tags: string[] | null | undefined): WeightLabel {
  if (!tags || tags.length === 0) return "General Update";
  for (const tag of tags) {
    if (KNOWN_WEIGHT_LABELS.includes(tag as WeightLabel)) {
      return tag as WeightLabel;
    }
  }
  return "General Update";
}

// ─── Helper: format relative time ───────────────────────────────────────────

function formatRelativeTime(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "剛剛";
  if (diffMin < 60) return `${diffMin} 分鐘前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小時前`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay} 天前`;
  return d.toLocaleDateString("zh-TW", { month: "short", day: "numeric" });
}

// ─── Scene-adaptive styles ──────────────────────────────────────────────────

interface SceneStyles {
  cardBg: string;
  cardBorder: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  tabsBg: string;
  tabsActiveBg: string;
  tabsActiveText: string;
  dividerColor: string;
}

const SCENE_CARD_STYLES: Record<SceneId, SceneStyles> = {
  nightSky: {
    cardBg: "rgba(15,18,45,0.5)",
    cardBorder: "rgba(100,120,200,0.1)",
    textPrimary: "text-white",
    textSecondary: "text-slate-300",
    textMuted: "text-slate-400",
    tabsBg: "rgba(20,25,60,0.5)",
    tabsActiveBg: "rgba(80,90,180,0.25)",
    tabsActiveText: "text-indigo-200",
    dividerColor: "rgba(100,120,200,0.15)",
  },
  morning: {
    cardBg: "rgba(255,248,240,0.55)",
    cardBorder: "rgba(220,180,140,0.15)",
    textPrimary: "text-amber-950",
    textSecondary: "text-amber-800",
    textMuted: "text-amber-700/60",
    tabsBg: "rgba(255,240,220,0.5)",
    tabsActiveBg: "rgba(245,190,100,0.2)",
    tabsActiveText: "text-amber-800",
    dividerColor: "rgba(210,170,120,0.2)",
  },
  cafe: {
    cardBg: "rgba(248,242,232,0.55)",
    cardBorder: "rgba(200,180,150,0.15)",
    textPrimary: "text-stone-900",
    textSecondary: "text-stone-700",
    textMuted: "text-stone-500",
    tabsBg: "rgba(240,230,215,0.5)",
    tabsActiveBg: "rgba(180,160,130,0.2)",
    tabsActiveText: "text-stone-800",
    dividerColor: "rgba(180,150,120,0.18)",
  },
  deepSea: {
    cardBg: "rgba(8,30,55,0.5)",
    cardBorder: "rgba(60,140,180,0.1)",
    textPrimary: "text-cyan-50",
    textSecondary: "text-cyan-200",
    textMuted: "text-cyan-300/60",
    tabsBg: "rgba(10,40,70,0.5)",
    tabsActiveBg: "rgba(40,120,160,0.25)",
    tabsActiveText: "text-cyan-200",
    dividerColor: "rgba(60,140,180,0.15)",
  },
};

// ─── Scene dot indicator colors ────────────────────────────────────────────

const SCENE_DOT_COLORS: Record<SceneId, string> = {
  nightSky: "#e0e7ff",
  morning: "#78350f",
  cafe: "#1c1917",
  deepSea: "#ecfeff",
};

/** Max dot indicators shown in carousel to prevent visual clutter */
const MAX_VISIBLE_DOTS = 10;

// ─── News Card ──────────────────────────────────────────────────────────────

interface NewsItem {
  id: number;
  title: string;
  oarsSummary: string;
  sourceName: string;
  sourceUrl: string | null;
  coverImageUrl: string | null;
  category: string;
  tags: string[] | null;
  isPinned: boolean;
  publishedAt: Date | string | null;
  viewCount: number;
  createdAt: Date | string;
}

// ─── Mandatory transition curve (soft-bounce) ─────────────────────────────────────

const SOFT_BOUNCE: [number, number, number, number] = [0.16, 1, 0.3, 1];

function BentoCard({
  item,
  config,
  styles,
  senseEngine,
  onCardClick,
}: {
  item: NewsItem;
  config: WeightConfig;
  styles: SceneStyles;
  senseEngine: ReturnType<typeof useSenseEngine>;
  onCardClick: (id: number) => void;
}) {
  const Icon = config.icon;
  const isHero = config.size === "hero";
  const isMedium = config.size === "medium";
  const [isHovered, setIsHovered] = useState(false);
  const [imgError, setImgError] = useState(false);
  const showImage = !!item.coverImageUrl && !imgError;

  // Sense Engine: card-level micro-behavior tracking
  const senseProps = useCardSenseProps(
    senseEngine,
    `news-${item.id}`,
    item.title,
    undefined,
    item.tags ?? undefined
  );

  // ─── Mouse-tracking fluid glow ─────────────────────────────────────────
  const mouseX = useMotionValue(0.5);
  const mouseY = useMotionValue(0.5);
  const glowX = useSpring(mouseX, { stiffness: 200, damping: 30 });
  const glowY = useSpring(mouseY, { stiffness: 200, damping: 30 });
  const glowBg = useTransform(
    [glowX, glowY],
    ([x, y]: number[]) =>
      `radial-gradient(600px circle at ${x * 100}% ${y * 100}%, rgba(255,255,255,0.06) 0%, transparent 60%)`
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      mouseX.set((e.clientX - rect.left) / rect.width);
      mouseY.set((e.clientY - rect.top) / rect.height);
    },
    [mouseX, mouseY]
  );

  return (
    <motion.article
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      whileHover={{ scale: 1.015, y: -2 }}
      transition={{ duration: 0.5, ease: SOFT_BOUNCE }}
      onHoverStart={() => {
        setIsHovered(true);
        senseProps.onMouseEnter({} as React.MouseEvent);
      }}
      onHoverEnd={() => {
        setIsHovered(false);
        senseProps.onMouseLeave();
      }}
      onMouseDown={() => senseProps.onMouseDown()}
      onMouseUp={() => senseProps.onMouseUp()}
      onMouseMove={e => {
        handleMouseMove(e);
        senseProps.onMouseMove(e);
      }}
      onClick={() => onCardClick(item.id)}
      className="group relative rounded-2xl overflow-hidden cursor-pointer h-full card-healing"
      style={{
        background: styles.cardBg,
        border: `1px solid ${styles.cardBorder}`,
        minHeight: isHero ? "280px" : isMedium ? "220px" : "180px",
      }}
    >
      {/* ── Glassmorphism fluid glow overlay (mouse-tracking) ── */}
      <motion.div
        className="absolute inset-0 pointer-events-none z-0 rounded-2xl"
        style={{ background: glowBg }}
        animate={{ opacity: isHovered ? 1 : 0 }}
        transition={{ duration: 0.3, ease: SOFT_BOUNCE }}
      />

      {/* ── Edge glow ring (hover border highlight) ── */}
      <motion.div
        className="absolute inset-0 pointer-events-none z-0 rounded-2xl"
        style={{
          boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.08), 0 0 20px 2px rgba(255,255,255,0.03)`,
        }}
        animate={{
          boxShadow: isHovered
            ? `inset 0 0 0 1.5px rgba(255,255,255,0.15), 0 8px 32px 0 rgba(255,255,255,0.06)`
            : `inset 0 0 0 1px rgba(255,255,255,0.08), 0 0 20px 2px rgba(255,255,255,0.03)`,
        }}
        transition={{ duration: 0.4, ease: SOFT_BOUNCE }}
      />

      {/* Accent stripe */}
      <motion.div
        className={`absolute top-0 left-0 right-0 h-[2px] ${config.accentBg} z-[2]`}
        animate={{ opacity: isHovered ? 1 : 0.6 }}
        transition={{ duration: 0.3 }}
      />

      <div className="relative z-10 flex flex-col h-full">
        {/* ── Cover image banner (with placeholder fallback) ───────────── */}
        <div
          className={`relative w-full overflow-hidden flex-shrink-0 ${
            isHero
              ? "aspect-[16/9]"
              : isMedium
                ? "aspect-[16/9]"
                : "aspect-[16/10]"
          }`}
        >
          {showImage ? (
            <>
              <img
                src={item.coverImageUrl!}
                alt=""
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                onError={() => setImgError(true)}
                className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
              />
              {/* Readability gradient on top edge for overlay badges */}
              <div
                aria-hidden="true"
                className="absolute inset-0 pointer-events-none"
                style={{
                  background:
                    "linear-gradient(180deg, rgba(0,0,0,0.15) 0%, transparent 30%, transparent 70%, rgba(0,0,0,0.12) 100%)",
                }}
              />
            </>
          ) : (
            // Placeholder: gradient backdrop + category icon
            <div
              aria-hidden="true"
              className={`absolute inset-0 flex items-center justify-center ${config.accentBg}`}
            >
              <div
                className="absolute inset-0"
                style={{
                  background: `radial-gradient(circle at 30% 35%, currentColor 0%, transparent 55%), radial-gradient(circle at 75% 70%, currentColor 0%, transparent 55%)`,
                  opacity: 0.12,
                }}
              />
              <Icon
                className={`relative w-10 h-10 opacity-40 ${config.accentColor}`}
              />
            </div>
          )}
        </div>

        {/* ── Padded content ─────────────────────────────────────────── */}
        <div
          className={`relative flex flex-col flex-1 ${isHero ? "p-6 sm:p-7" : isMedium ? "p-4 sm:p-5" : "p-4"}`}
        >
        {/* Header: weight badge + time */}
        <div className="flex items-center justify-between mb-3">
          <motion.span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium tracking-wide ${config.accentBg} ${config.accentColor}`}
            animate={{ scale: isHovered ? 1.05 : 1 }}
            transition={{ duration: 0.3, ease: SOFT_BOUNCE }}
          >
            <Icon className="w-3 h-3" />
            {config.label}
          </motion.span>
          <span
            className={`text-[10px] flex items-center gap-1 ${styles.textMuted}`}
          >
            <Clock className="w-2.5 h-2.5" />
            {formatRelativeTime(item.publishedAt)}
          </span>
        </div>

        {/* Title */}
        <h3
          className={`font-semibold leading-snug tracking-tight transition-colors duration-300 ${styles.textPrimary} ${
            isHero
              ? "hs-h3-lg mb-3"
              : isMedium
                ? "hs-h3 mb-2"
                : "hs-small !font-semibold mb-2 line-clamp-2"
          }`}
        >
          {item.title}
        </h3>

        {/* ── Progressive Disclosure Layer 1: Summary (hero/medium always, small on hover) ── */}
        {(isHero || isMedium) && (
          <p
            className={`text-xs leading-relaxed ${styles.textSecondary} ${
              isHero ? "line-clamp-4 mb-4" : "line-clamp-2 mb-3"
            }`}
          >
            {item.oarsSummary}
          </p>
        )}

        {/* Progressive Disclosure: Small cards reveal summary on hover */}
        {config.size === "small" && (
          <AnimatePresence>
            {isHovered && item.oarsSummary && (
              <motion.p
                initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                animate={{ opacity: 1, height: "auto", marginBottom: 8 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                transition={{ duration: 0.35, ease: SOFT_BOUNCE }}
                className={`text-[11px] leading-relaxed line-clamp-2 overflow-hidden ${styles.textSecondary}`}
              >
                {item.oarsSummary}
              </motion.p>
            )}
          </AnimatePresence>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* ── Progressive Disclosure Layer 2: Footer details (revealed on hover) ── */}
        <motion.div
          className="flex items-center justify-between"
          animate={{ opacity: isHovered ? 1 : 0.7, y: isHovered ? 0 : 2 }}
          transition={{ duration: 0.3, ease: SOFT_BOUNCE }}
        >
          <span
            className={`text-[10px] ${styles.textMuted} truncate max-w-[60%]`}
          >
            {item.sourceName}
          </span>
          <div className="flex items-center gap-3">
            {item.viewCount > 0 && (
              <span
                className={`text-[10px] flex items-center gap-1 ${styles.textMuted}`}
              >
                <Eye className="w-2.5 h-2.5" />
                {item.viewCount}
              </span>
            )}
            {item.sourceUrl && (
              <a
                href={item.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`text-[10px] flex items-center gap-0.5 ${styles.textMuted} hover:opacity-80 transition-colors`}
                onClick={e => e.stopPropagation()}
              >
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            )}
          </div>
        </motion.div>

        {/* ── Progressive Disclosure Layer 3: "Read more" CTA (hero/medium on hover) ── */}
        {(isHero || isMedium) && (
          <AnimatePresence>
            {isHovered && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.3, ease: SOFT_BOUNCE }}
                className="mt-3 pt-3"
                style={{ borderTop: `1px solid ${styles.cardBorder}` }}
              >
                <span
                  className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${config.accentColor}`}
                >
                  閱讀完整報導
                  <motion.span
                    animate={{ x: [0, 3, 0] }}
                    transition={{
                      duration: 1.2,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }}
                  >
                    <ChevronRight className="w-3 h-3" />
                  </motion.span>
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        )}
        </div>
      </div>
    </motion.article>
  );
}

// ─── Empty State ────────────────────────────────────────────────────────────

function EmptyState({
  styles,
  activeTab,
  onResetTab,
  hasAnyItems,
}: {
  styles: SceneStyles;
  activeTab?: TabValue;
  onResetTab?: () => void;
  hasAnyItems?: boolean;
}) {
  // Tab-specific empty message when other tabs do have content
  const showFallback = hasAnyItems && activeTab && activeTab !== "all";
  const tabLabel = TABS.find(t => t.value === activeTab)?.label ?? "";

  return (
    <div className="col-span-full flex flex-col items-center justify-center py-20">
      <Newspaper className={`w-10 h-10 mb-4 ${styles.textMuted} opacity-40`} />
      <p className={`text-sm ${styles.textMuted}`}>
        {showFallback
          ? `目前「${tabLabel}」尚無新情報`
          : "暫無情報，敬請期待"}
      </p>
      {showFallback && (
        <button
          type="button"
          onClick={onResetTab}
          className={`mt-4 inline-flex items-center gap-1.5 text-xs font-medium px-4 py-2 rounded-full backdrop-blur-md transition-all duration-300 hover:scale-105 ${styles.textMuted}`}
          style={{ background: styles.tabsBg }}
        >
          查看全部
          <ChevronRight className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// ─── Loading Skeleton ───────────────────────────────────────────────────────

function BentoSkeleton({ styles }: { styles: SceneStyles }) {
  const skeletonItems = [
    "col-span-2 row-span-2",
    "col-span-1 row-span-1",
    "col-span-1 row-span-1",
    "col-span-1 row-span-2",
    "col-span-1 row-span-1",
    "col-span-1 row-span-1",
  ];

  return (
    <>
      {skeletonItems.map((span, i) => (
        <div
          key={i}
          className={`rounded-2xl animate-pulse ${span}`}
          style={{
            background: styles.cardBg,
            border: `1px solid ${styles.cardBorder}`,
            minHeight: span.includes("row-span-2") ? "240px" : "120px",
          }}
        >
          <div className="p-5 space-y-3">
            <div className="h-3 w-20 rounded-full bg-current opacity-5" />
            <div className="h-4 w-3/4 rounded bg-current opacity-5" />
            <div className="h-3 w-1/2 rounded bg-current opacity-5" />
          </div>
        </div>
      ))}
    </>
  );
}

// ─── Bento Grid Layout Engine ───────────────────────────────────────────────

function layoutBentoItems(
  items: NewsItem[]
): Array<{ item: NewsItem; config: WeightConfig }> {
  // Sort: hero items first, then medium, then small
  const withConfig = items.map(item => {
    const weightLabel = getWeightLabel(item.tags);
    return { item, config: WEIGHT_CONFIG[weightLabel] };
  });

  // Separate by size
  const heroes = withConfig.filter(x => x.config.size === "hero");
  const mediums = withConfig.filter(x => x.config.size === "medium");
  const smalls = withConfig.filter(x => x.config.size === "small");

  // Layout: hero first (max 1), then interleave medium and small
  const result: typeof withConfig = [];

  // Place first hero
  if (heroes.length > 0) {
    result.push(heroes[0]);
  }

  // Fill remaining heroes as medium (downgrade)
  for (let i = 1; i < heroes.length; i++) {
    mediums.push({
      ...heroes[i],
      config: { ...heroes[i].config, size: "medium" },
    });
  }

  // Interleave: for every medium, add 2 smalls after
  let si = 0;
  for (const med of mediums) {
    result.push(med);
    // Add up to 2 smalls
    for (let j = 0; j < 2 && si < smalls.length; j++, si++) {
      result.push(smalls[si]);
    }
  }

  // Remaining smalls
  while (si < smalls.length) {
    result.push(smalls[si]);
    si++;
  }

  return result;
}

// ─── Main Component ─────────────────────────────────────────────────────────

interface IntelBentoGridProps {
  sceneId: SceneId;
}

const IntelBentoGrid = memo(function IntelBentoGrid({
  sceneId,
}: IntelBentoGridProps) {
  const styles = useMemo(() => SCENE_CARD_STYLES[sceneId], [sceneId]);
  const [activeTab, setActiveTab] = useState<TabValue>("all");
  const [selectedNewsId, setSelectedNewsId] = useState<number | null>(null);

  // ─── Carousel state ─────────────────────────────────────────────
  const [carouselApi, setCarouselApi] = useState<CarouselApi>();
  const [currentSlide, setCurrentSlide] = useState(0);
  const [slideCount, setSlideCount] = useState(0);
  const autoplayPlugin = useMemo(
    () =>
      Autoplay({
        delay: 5000,
        stopOnInteraction: true,
        stopOnMouseEnter: true,
      }),
    []
  );

  useEffect(() => {
    if (!carouselApi) return;
    const onSelect = () => setCurrentSlide(carouselApi.selectedScrollSnap());
    const onReInit = () => {
      setSlideCount(carouselApi.scrollSnapList().length);
      setCurrentSlide(carouselApi.selectedScrollSnap());
    };
    carouselApi.on("select", onSelect);
    carouselApi.on("reInit", onReInit);
    onReInit();
    return () => {
      carouselApi.off("select", onSelect);
      carouselApi.off("reInit", onReInit);
    };
  }, [carouselApi]);

  const scrollTo = useCallback(
    (idx: number) => carouselApi?.scrollTo(idx),
    [carouselApi]
  );

  const handleCardClick = useCallback((id: number) => {
    setSelectedNewsId(id);
  }, []);

  const handleDialogClose = useCallback(() => {
    setSelectedNewsId(null);
  }, []);

  // Sense Engine: micro-behavior tracking
  const senseEngine = useSenseEngine({
    dwellThreshold: 5000,
    scrollHesitationThreshold: 3,
  });
  const sectionScrollRef = useSectionScrollSense(
    senseEngine,
    "intel-bento-grid"
  );

  // Fetch news from tRPC (infinite pagination drives "探索更多情報")
  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = trpc.news.list.useInfiniteQuery(
    { limit: 20 },
    {
      getNextPageParam: lastPage => lastPage.nextCursor ?? undefined,
      staleTime: 60_000,
    }
  );

  const items = useMemo(
    () => data?.pages.flatMap(p => p.items) ?? [],
    [data]
  );

  // Filter by tab — route each item into exactly one bucket, with keyword
  // fallback for items the server couldn't classify.
  const filteredItems = useMemo(() => {
    if (activeTab === "all") return items;
    return items.filter(item => bucketForItem(item) === activeTab);
  }, [items, activeTab]);

  // Layout engine
  const layoutItems = useMemo(
    () => layoutBentoItems(filteredItems),
    [filteredItems]
  );

  return (
    <section
      ref={sectionScrollRef}
      className="section-breathing px-4 relative z-10"
    >
      <div className="max-w-5xl mx-auto">
        {/* Soft gradient divider */}
        <div
          className="mx-auto max-w-3xl mb-10 sm:mb-12 h-px"
          style={{
            background: `linear-gradient(90deg, transparent, ${styles.dividerColor}, transparent)`,
          }}
        />
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-10 sm:mb-12"
        >
          <h2
            className={`hs-h2 !mb-0 transition-colors duration-1000 ${styles.textPrimary}`}
          >
            情報站
          </h2>
          <p
            className={`mt-3 hs-small !mb-0 max-w-md mx-auto transition-colors duration-1000 ${styles.textMuted}`}
          >
            AI 與創作領域的最新脈動，以溫暖視角重新詮釋
          </p>
          {/* Healing divider */}
          <div
            className="mx-auto mt-6 sm:mt-8 w-16 h-[1px] rounded-full"
            style={{
              background: `linear-gradient(90deg, transparent, ${styles.dividerColor}, transparent)`,
            }}
          />
        </motion.div>

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={v => setActiveTab(v as TabValue)}
          className="mb-6 sm:mb-8"
        >
          <div className="flex justify-center overflow-x-auto scrollbar-hide">
            <TabsList
              className="h-9 sm:h-10 rounded-xl border-0 p-1 backdrop-blur-md"
              style={{ background: styles.tabsBg }}
            >
              {TABS.map(tab => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className={`rounded-lg px-3 sm:px-4 text-[11px] sm:text-xs font-medium border-0 transition-all duration-200
                    data-[state=active]:shadow-none
                    ${styles.textMuted}
                  `}
                  style={{
                    ...(activeTab === tab.value
                      ? { background: styles.tabsActiveBg }
                      : {}),
                  }}
                >
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {/* Tab content — mount points for Radix Tabs */}
          {TABS.map(tab => (
            <TabsContent key={tab.value} value={tab.value} className="mt-0" />
          ))}
        </Tabs>

        {/* ── Carousel Layout — elegant sliding instead of overwhelming grid ── */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <BentoSkeleton styles={styles} />
          </div>
        ) : layoutItems.length === 0 ? (
          <EmptyState
            styles={styles}
            activeTab={activeTab}
            hasAnyItems={items.length > 0}
            onResetTab={() => setActiveTab("all")}
          />
        ) : (
          <div className="w-full">
            <Carousel
              setApi={setCarouselApi}
              plugins={[autoplayPlugin]}
              opts={{ align: "start", loop: true }}
              className="w-full carousel-fade-edge"
            >
              <CarouselContent className="-ml-5">
                {layoutItems.map(({ item, config }) => (
                  <CarouselItem
                    key={item.id}
                    className={`pl-5 ${
                      config.size === "hero"
                        ? "basis-full sm:basis-2/3"
                        : config.size === "medium"
                          ? "basis-full sm:basis-1/2"
                          : "basis-full sm:basis-1/2 lg:basis-1/3"
                    }`}
                  >
                    <BentoCard
                      item={item}
                      config={config}
                      styles={styles}
                      senseEngine={senseEngine}
                      onCardClick={handleCardClick}
                    />
                  </CarouselItem>
                ))}
              </CarouselContent>
            </Carousel>

            {/* Carousel dot indicators */}
            {slideCount > 1 && (
              <div className="flex items-center justify-center gap-2.5 mt-10">
                {Array.from({
                  length: Math.min(slideCount, MAX_VISIBLE_DOTS),
                }).map((_, i) => (
                  <motion.button
                    key={i}
                    onClick={() => scrollTo(i)}
                    className={`rounded-full transition-all duration-700 ${
                      i === currentSlide
                        ? "opacity-50"
                        : "opacity-[0.12] hover:opacity-20"
                    }`}
                    style={{ background: SCENE_DOT_COLORS[sceneId] }}
                    animate={{
                      width: i === currentSlide ? 28 : 8,
                      height: 8,
                    }}
                    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                    aria-label={`Go to slide ${i + 1}`}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* "See more" — loads next page inline */}
        {hasNextPage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex justify-center mt-6"
          >
            <button
              type="button"
              onClick={() => {
                if (!isFetchingNextPage) fetchNextPage();
              }}
              disabled={isFetchingNextPage}
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-4 py-2 rounded-full backdrop-blur-md transition-all duration-300 hover:scale-105 disabled:opacity-60 disabled:cursor-wait ${styles.textMuted}`}
              style={{ background: styles.tabsBg }}
              aria-label="載入更多情報"
            >
              {isFetchingNextPage ? "載入中…" : "探索更多情報"}
              <ChevronRight
                className={`w-3 h-3 transition-transform ${
                  isFetchingNextPage ? "animate-pulse" : ""
                }`}
              />
            </button>
          </motion.div>
        )}
      </div>

      {/* Article Dialog */}
      <ArticleDialog
        newsId={selectedNewsId}
        onClose={handleDialogClose}
        sceneId={sceneId}
      />
    </section>
  );
});

IntelBentoGrid.displayName = "IntelBentoGrid";

export default IntelBentoGrid;
