/**
 * ShowcaseMasonry.tsx — 精選作品瀑布流
 *
 * 高效能 Masonry (瀑布流) 佈局：
 *   - CSS Columns 原生瀑布流（零 JS 佈局計算，GPU 友善）
 *   - 綁定 trpc.showcase.list LOD API（cursor-based 分頁）
 *   - IntersectionObserver lazy load 漸進式圖片載入
 *   - Blur placeholder → 高畫質淡入動畫
 *   - Infinite Scroll 觸底自動載入
 *   - CSS contain + will-change 確保 60 FPS
 *   - 場景自適應色彩
 */

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { trpc } from "@/lib/trpc";
import {
  Image as ImageIcon,
  Film,
  Music,
  Mic,
  Heart,
  GitFork,
  Loader2,
  Sparkles,
  Eye,
} from "lucide-react";
import { useLocation } from "wouter";
import type { SceneId } from "./AmbientEnvironment";
import RippleTransition, { useRippleTransition } from "./RippleTransition";
import {
  useShowcaseTransfer,
  type ShowcaseTransferPayload,
} from "@/contexts/ShowcaseTransferContext";
import {
  useSenseEngine,
  useCardSenseProps,
  useSectionScrollSense,
} from "@/hooks/useSenseEngine";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";
import Autoplay from "embla-carousel-autoplay";
import PortfolioDetailDialog, {
  type PortfolioBasicItem,
  type PortfolioDetailData,
} from "./PortfolioDetailDialog";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ShowcaseItem {
  id: number;
  title: string;
  description: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  modality: string;
  sortWeight: number;
  likeCount: number;
  forkCount: number;
  commentCount: number;
  createdAt: Date | string;
}

// ─── Scene-adaptive styles ──────────────────────────────────────────────────

interface MasonrySceneStyles {
  sectionBg: string;
  titleColor: string;
  subtitleColor: string;
  cardBg: string;
  cardBorder: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  badgeBg: string;
  badgeText: string;
  glowColor: string;
  skeletonBg: string;
  skeletonShimmer: string;
  dividerColor: string;
}

const SCENE_MASONRY_STYLES: Record<SceneId, MasonrySceneStyles> = {
  nightSky: {
    sectionBg: "rgba(10, 10, 30, 0.4)",
    titleColor: "text-indigo-100",
    subtitleColor: "text-indigo-300/70",
    cardBg: "rgba(20, 20, 50, 0.6)",
    cardBorder: "rgba(100, 100, 180, 0.2)",
    textPrimary: "text-indigo-50",
    textSecondary: "text-indigo-200/80",
    textMuted: "text-indigo-300/50",
    badgeBg: "bg-indigo-500/20",
    badgeText: "text-indigo-300",
    glowColor: "rgba(120, 120, 255, 0.08)",
    skeletonBg: "bg-indigo-900/30",
    skeletonShimmer: "via-indigo-700/20",
    dividerColor: "rgba(100,120,200,0.15)",
  },
  morning: {
    sectionBg: "rgba(255, 245, 235, 0.4)",
    titleColor: "text-amber-900",
    subtitleColor: "text-amber-700/70",
    cardBg: "rgba(255, 250, 240, 0.7)",
    cardBorder: "rgba(200, 160, 100, 0.25)",
    textPrimary: "text-amber-900",
    textSecondary: "text-amber-800/70",
    textMuted: "text-amber-600/50",
    badgeBg: "bg-amber-500/15",
    badgeText: "text-amber-700",
    glowColor: "rgba(255, 180, 80, 0.08)",
    skeletonBg: "bg-amber-100/50",
    skeletonShimmer: "via-amber-200/30",
    dividerColor: "rgba(210,170,120,0.2)",
  },
  cafe: {
    sectionBg: "rgba(40, 25, 15, 0.4)",
    titleColor: "text-orange-100",
    subtitleColor: "text-orange-300/70",
    cardBg: "rgba(50, 35, 20, 0.6)",
    cardBorder: "rgba(160, 120, 70, 0.25)",
    textPrimary: "text-orange-50",
    textSecondary: "text-orange-200/80",
    textMuted: "text-orange-300/50",
    badgeBg: "bg-orange-500/20",
    badgeText: "text-orange-300",
    glowColor: "rgba(200, 140, 60, 0.08)",
    skeletonBg: "bg-orange-900/30",
    skeletonShimmer: "via-orange-700/20",
    dividerColor: "rgba(180,150,120,0.18)",
  },
  deepSea: {
    sectionBg: "rgba(5, 20, 35, 0.4)",
    titleColor: "text-cyan-100",
    subtitleColor: "text-cyan-300/70",
    cardBg: "rgba(10, 30, 50, 0.6)",
    cardBorder: "rgba(60, 140, 180, 0.2)",
    textPrimary: "text-cyan-50",
    textSecondary: "text-cyan-200/80",
    textMuted: "text-cyan-300/50",
    badgeBg: "bg-cyan-500/20",
    badgeText: "text-cyan-300",
    glowColor: "rgba(60, 180, 220, 0.08)",
    skeletonBg: "bg-cyan-900/30",
    skeletonShimmer: "via-cyan-700/20",
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

// ─── Modality config ────────────────────────────────────────────────────────

const MODALITY_CONFIG: Record<
  string,
  { icon: typeof ImageIcon; label: string; color: string }
> = {
  image: { icon: ImageIcon, label: "圖像", color: "text-violet-400" },
  video: { icon: Film, label: "影片", color: "text-rose-400" },
  audio: { icon: Music, label: "音樂", color: "text-emerald-400" },
  voice: { icon: Mic, label: "語音", color: "text-sky-400" },
};

// ─── Soft bounce transition ─────────────────────────────────────────────────

const SOFT_BOUNCE: [number, number, number, number] = [0.16, 1, 0.3, 1];

// ─── Progressive Image Component ────────────────────────────────────────────

function ProgressiveImage({
  src,
  thumbnailSrc,
  alt,
  styles,
}: {
  src: string | null;
  thumbnailSrc: string | null;
  alt: string;
  styles: MasonrySceneStyles;
}) {
  const [loaded, setLoaded] = useState(false);
  const [inView, setInView] = useState(false);
  const imgRef = useRef<HTMLDivElement>(null);

  // IntersectionObserver for lazy loading
  useEffect(() => {
    const el = imgRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px 0px" } // Start loading 200px before visible
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const displaySrc = src || thumbnailSrc;

  return (
    <div
      ref={imgRef}
      className="relative w-full overflow-hidden rounded-t-xl"
      style={{ minHeight: "120px" }}
    >
      {/* Blur placeholder background */}
      <div
        className={`absolute inset-0 ${styles.skeletonBg}`}
        style={{
          backgroundImage: thumbnailSrc ? `url(${thumbnailSrc})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
          filter: "blur(20px)",
          transform: "scale(1.1)",
        }}
      />

      {/* Shimmer animation while loading */}
      {!loaded && (
        <div className="absolute inset-0 overflow-hidden">
          <div
            className={`absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent ${styles.skeletonShimmer} to-transparent`}
          />
        </div>
      )}

      {/* Actual image (lazy loaded) — with gentle zoom on card hover */}
      {inView && displaySrc && (
        <motion.img
          src={displaySrc}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          initial={{ opacity: 0 }}
          animate={{ opacity: loaded ? 1 : 0 }}
          transition={{ duration: 0.6, ease: SOFT_BOUNCE }}
          className="relative w-full h-auto block img-healing"
          style={{ contentVisibility: "auto" }}
        />
      )}

      {/* Fallback for no image */}
      {!displaySrc && (
        <div
          className={`flex items-center justify-center h-40 ${styles.skeletonBg}`}
        >
          <ImageIcon className={`w-8 h-8 ${styles.textMuted}`} />
        </div>
      )}
    </div>
  );
}

// ─── Masonry Card ───────────────────────────────────────────────────────────

function MasonryCard({
  item,
  styles,
  onCardClick,
  senseEngine,
  onVisibilityChange,
}: {
  item: ShowcaseItem;
  styles: MasonrySceneStyles;
  onCardClick: (e: React.MouseEvent, item: ShowcaseItem) => void;
  senseEngine: ReturnType<typeof useSenseEngine>;
  onVisibilityChange?: (id: number, isVisible: boolean) => void;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const modConfig = MODALITY_CONFIG[item.modality] || MODALITY_CONFIG.image;
  const ModIcon = modConfig.icon;

  // Sense Engine: card-level micro-behavior tracking
  const senseProps = useCardSenseProps(
    senseEngine,
    `showcase-${item.id}`,
    item.title,
    item.modality
  );

  // Track visibility for silent reconstruction
  const cardVisRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = cardVisRef.current;
    if (!el || !onVisibilityChange) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          onVisibilityChange(item.id, true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [item.id, onVisibilityChange]);

  return (
    <motion.article
      ref={cardVisRef}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      whileHover={{ y: -3 }}
      transition={{ duration: 0.5, ease: SOFT_BOUNCE }}
      onHoverStart={() => {
        setIsHovered(true);
        senseProps.onMouseEnter({} as React.MouseEvent);
      }}
      onHoverEnd={() => {
        setIsHovered(false);
        senseProps.onMouseLeave();
      }}
      onMouseMove={e => senseProps.onMouseMove(e)}
      onMouseDown={() => senseProps.onMouseDown()}
      onMouseUp={() => senseProps.onMouseUp()}
      className="break-inside-avoid mb-4 rounded-xl overflow-hidden cursor-pointer group card-healing"
      style={{
        background: styles.cardBg,
        border: `1px solid ${styles.cardBorder}`,
        contain: "layout style paint",
        willChange: "transform",
      }}
      onClick={e => {
        senseEngine.trackScrollClick();
        onCardClick(e, item);
      }}
    >
      {/* Hover glow overlay */}
      <motion.div
        className="absolute inset-0 pointer-events-none z-10 rounded-xl"
        animate={{
          boxShadow: isHovered
            ? `inset 0 0 0 1.5px rgba(255,255,255,0.1), 0 12px 32px 0 ${styles.glowColor}`
            : `inset 0 0 0 1px rgba(255,255,255,0.04), 0 0 0 0 transparent`,
        }}
        transition={{ duration: 0.5, ease: SOFT_BOUNCE }}
      />

      {/* Image with progressive loading */}
      <ProgressiveImage
        src={item.imageUrl}
        thumbnailSrc={item.thumbnailUrl}
        alt={item.title}
        styles={styles}
      />

      {/* Content */}
      <div className="p-4 relative z-10">
        {/* Modality badge */}
        <div className="flex items-center justify-between mb-2">
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${styles.badgeBg} ${modConfig.color}`}
          >
            <ModIcon className="w-2.5 h-2.5" />
            {modConfig.label}
          </span>
          {item.sortWeight > 0 && (
            <span
              className={`inline-flex items-center gap-0.5 text-[10px] ${styles.badgeText}`}
            >
              <Sparkles className="w-2.5 h-2.5" />
              精選
            </span>
          )}
        </div>

        {/* Title */}
        <h4
          className={`hs-h3 !mb-0 leading-snug line-clamp-2 ${styles.textPrimary}`}
        >
          {item.title}
        </h4>

        {/* Progressive Disclosure: Description on hover */}
        <AnimatePresence>
          {isHovered && item.description && (
            <motion.p
              initial={{ opacity: 0, height: 0, marginTop: 0 }}
              animate={{ opacity: 1, height: "auto", marginTop: 6 }}
              exit={{ opacity: 0, height: 0, marginTop: 0 }}
              transition={{ duration: 0.3, ease: SOFT_BOUNCE }}
              className={`text-[11px] leading-relaxed line-clamp-3 overflow-hidden ${styles.textSecondary}`}
            >
              {item.description}
            </motion.p>
          )}
        </AnimatePresence>

        {/* Stats footer */}
        <motion.div
          className="flex items-center gap-3 mt-3 pt-2"
          style={{ borderTop: `1px solid ${styles.cardBorder}` }}
          animate={{ opacity: isHovered ? 1 : 0.6 }}
          transition={{ duration: 0.3 }}
        >
          <span
            className={`inline-flex items-center gap-1 text-[10px] ${styles.textMuted}`}
          >
            <Heart className="w-2.5 h-2.5" />
            {item.likeCount}
          </span>
          <span
            className={`inline-flex items-center gap-1 text-[10px] ${styles.textMuted}`}
          >
            <GitFork className="w-2.5 h-2.5" />
            {item.forkCount}
          </span>

          {/* Progressive Disclosure: "View" CTA on hover */}
          <AnimatePresence>
            {isHovered && (
              <motion.span
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.25, ease: SOFT_BOUNCE }}
                className={`ml-auto inline-flex items-center gap-0.5 text-[10px] font-medium ${styles.badgeText}`}
              >
                <Eye className="w-2.5 h-2.5" />
                查看
              </motion.span>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </motion.article>
  );
}

// ─── Skeleton Card ──────────────────────────────────────────────────────────

function SkeletonCard({ styles }: { styles: MasonrySceneStyles }) {
  // Random height for natural masonry feel
  const height = useMemo(() => 140 + Math.floor(Math.random() * 100), []);

  return (
    <div
      className="break-inside-avoid mb-4 rounded-xl overflow-hidden animate-pulse"
      style={{
        background: styles.cardBg,
        border: `1px solid ${styles.cardBorder}`,
      }}
    >
      <div
        className={`w-full ${styles.skeletonBg} relative overflow-hidden`}
        style={{ height }}
      >
        <div
          className={`absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent ${styles.skeletonShimmer} to-transparent`}
        />
      </div>
      <div className="p-4 space-y-2">
        <div className={`h-3 w-16 rounded ${styles.skeletonBg}`} />
        <div className={`h-4 w-full rounded ${styles.skeletonBg}`} />
        <div className={`h-4 w-3/4 rounded ${styles.skeletonBg}`} />
        <div className="flex gap-3 pt-2">
          <div className={`h-3 w-10 rounded ${styles.skeletonBg}`} />
          <div className={`h-3 w-10 rounded ${styles.skeletonBg}`} />
        </div>
      </div>
    </div>
  );
}

// ─── Modality Filter Tabs ───────────────────────────────────────────────────

function ModalityTabs({
  active,
  onChange,
  styles,
}: {
  active: string | null;
  onChange: (modality: string | null) => void;
  styles: MasonrySceneStyles;
}) {
  const tabs = [
    { key: null, label: "全部", icon: Sparkles },
    { key: "image", label: "圖像", icon: ImageIcon },
    { key: "video", label: "影片", icon: Film },
    { key: "audio", label: "音樂", icon: Music },
    { key: "voice", label: "語音", icon: Mic },
  ];

  return (
    <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap justify-center">
      {tabs.map(tab => {
        const isActive = active === tab.key;
        const TabIcon = tab.icon;
        return (
          <motion.button
            key={tab.key ?? "all"}
            onClick={() => onChange(tab.key)}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.97 }}
            transition={{ duration: 0.25, ease: SOFT_BOUNCE }}
            className={`inline-flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-full text-[11px] sm:text-xs font-medium transition-healing ${
              isActive
                ? `${styles.badgeBg} ${styles.badgeText} ring-1 ring-current/20`
                : `${styles.textMuted} hover:${styles.textSecondary}`
            }`}
            style={{
              background: isActive ? undefined : "rgba(255,255,255,0.04)",
              border: `1px solid ${isActive ? "currentColor" : "transparent"}`,
              borderColor: isActive ? undefined : "rgba(255,255,255,0.06)",
            }}
          >
            <TabIcon className="w-3 h-3" />
            {tab.label}
          </motion.button>
        );
      })}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function ShowcaseMasonry({
  sceneId,
  aestheticOverride,
}: {
  sceneId: SceneId;
  /** 當 Gemini Director 偵測到美學偏好時，傳入標籤陣列觸發靜默重構 */
  aestheticOverride?: string[] | null;
}) {
  const styles = useMemo(() => SCENE_MASONRY_STYLES[sceneId], [sceneId]);
  const [modality, setModality] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [, navigate] = useLocation();

  // ─── Carousel state ─────────────────────────────────────────────
  const [showcaseApi, setShowcaseApi] = useState<CarouselApi>();
  const [showcaseSlide, setShowcaseSlide] = useState(0);
  const [showcaseSlideCount, setShowcaseSlideCount] = useState(0);
  const showcaseAutoplay = useMemo(
    () =>
      Autoplay({
        delay: 4500,
        stopOnInteraction: true,
        stopOnMouseEnter: true,
      }),
    []
  );

  useEffect(() => {
    if (!showcaseApi) return;
    const onSelect = () => setShowcaseSlide(showcaseApi.selectedScrollSnap());
    const onReInit = () => {
      setShowcaseSlideCount(showcaseApi.scrollSnapList().length);
      setShowcaseSlide(showcaseApi.selectedScrollSnap());
    };
    showcaseApi.on("select", onSelect);
    showcaseApi.on("reInit", onReInit);
    onReInit();
    return () => {
      showcaseApi.off("select", onSelect);
      showcaseApi.off("reInit", onReInit);
    };
  }, [showcaseApi]);

  const showcaseScrollTo = useCallback(
    (idx: number) => showcaseApi?.scrollTo(idx),
    [showcaseApi]
  );

  // Sense Engine: micro-behavior tracking
  const senseEngine = useSenseEngine({
    dwellThreshold: 5000,
    scrollHesitationThreshold: 3,
  });
  const sectionScrollRef = useSectionScrollSense(
    senseEngine,
    "showcase-masonry"
  );
  const { rippleActive, rippleOrigin, triggerRipple, resetRipple } =
    useRippleTransition();
  const { setPayload, setIsLoading } = useShowcaseTransfer();
  const utils = trpc.useUtils();
  const prefetchReady = useRef(false);
  const pendingItemId = useRef<number | null>(null);

  // ─── Detail Modal state ─────────────────────────────────────────
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailBasic, setDetailBasic] = useState<PortfolioBasicItem | null>(
    null
  );
  const [detailData, setDetailData] = useState<PortfolioDetailData | null>(
    null
  );
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const pendingRippleEventRef = useRef<{
    clientX: number;
    clientY: number;
  } | null>(null);

  const handleCardClick = useCallback(
    (e: React.MouseEvent, item: ShowcaseItem) => {
      // Open detail modal immediately with the basic fields we already have
      setDetailBasic(item);
      setDetailData(null);
      setDetailOpen(true);
      setIsLoadingDetail(true);

      // Remember where the click originated, so "Enter Studio" can ripple from it
      pendingRippleEventRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
      };

      // Reset transfer readiness and preload the full record in the background
      prefetchReady.current = false;
      pendingItemId.current = item.id;
      setIsLoading(true);

      utils.showcase.getById
        .fetch({ id: item.id })
        .then(detail => {
          const payload: ShowcaseTransferPayload = {
            showcaseId: detail.id,
            generatedItemId: detail.generatedItemId,
            title: detail.title,
            deconstructedBlocks:
              detail.completelyDeconstructedBlocks as ShowcaseTransferPayload["deconstructedBlocks"],
            vibeParameters:
              detail.vibeParameters as ShowcaseTransferPayload["vibeParameters"],
            originalPrompt: detail.originalPrompt,
            imageUrl: detail.imageUrl,
            modality: detail.modality as "image" | "video" | "audio" | "voice",
          };
          setPayload(payload);
          setDetailData({
            originalPrompt: detail.originalPrompt,
            completelyDeconstructedBlocks:
              detail.completelyDeconstructedBlocks as PortfolioDetailData["completelyDeconstructedBlocks"],
          });
          prefetchReady.current = true;
        })
        .catch(() => {
          // Even if prefetch fails, still allow navigation — Studio handles empty payload
          prefetchReady.current = true;
        })
        .finally(() => {
          setIsLoading(false);
          setIsLoadingDetail(false);
        });
    },
    [utils.showcase.getById, setPayload, setIsLoading]
  );

  const handleEnterStudio = useCallback(() => {
    setDetailOpen(false);
    const origin = pendingRippleEventRef.current;
    if (origin) {
      triggerRipple({
        clientX: origin.clientX,
        clientY: origin.clientY,
      } as React.MouseEvent);
    } else {
      // Fallback: ripple from viewport centre
      triggerRipple({
        clientX: window.innerWidth / 2,
        clientY: window.innerHeight / 2,
      } as React.MouseEvent);
    }
  }, [triggerRipple]);

  const handleRippleComplete = useCallback(() => {
    // If prefetch is ready, navigate immediately
    if (prefetchReady.current) {
      navigate("/studio");
      setTimeout(() => resetRipple(), 100);
      return;
    }
    // Otherwise, poll until ready (max 3s safety timeout)
    const start = Date.now();
    const poll = setInterval(() => {
      if (prefetchReady.current || Date.now() - start > 3000) {
        clearInterval(poll);
        navigate("/studio");
        setTimeout(() => resetRipple(), 100);
      }
    }, 50);
  }, [navigate, resetRipple]);

  // ───  // ─── Silent Reconstruction State ───────────────────────────────
  const [reconstructedItems, setReconstructedItems] = useState<ShowcaseItem[]>(
    []
  );
  const [isReconstructing, setIsReconstructing] = useState(false);
  const reconstructedRef = useRef(false);
  const visibleIdsRef = useRef<Set<number>>(new Set());
  const reconstructionAestheticsRef = useRef<string[] | null>(null);

  // ─── LOD API: cursor-based pagination ───────────────────────
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
  } = trpc.showcase.list.useInfiniteQuery(
    {
      limit: 12,
      ...(modality
        ? { modality: modality as "image" | "video" | "audio" | "voice" }
        : {}),
    },
    {
      getNextPageParam: lastPage => lastPage.nextCursor ?? undefined,
      staleTime: 60_000,
    }
  );

  const originalItems = useMemo(
    () => data?.pages.flatMap(p => p.items) ?? [],
    [data]
  );

  // ─── Track visible card IDs via IntersectionObserver ────────────
  const trackVisibility = useCallback((id: number, isVisible: boolean) => {
    if (isVisible) {
      visibleIdsRef.current.add(id);
    }
  }, []);

  // ─── Silent Reconstruction: fetch aesthetic-matched items ───────
  useEffect(() => {
    if (
      !aestheticOverride ||
      aestheticOverride.length === 0 ||
      reconstructedRef.current ||
      isReconstructing
    )
      return;

    // Prevent duplicate reconstruction for same aesthetics
    const sortedKey = [...aestheticOverride].sort();
    const prevKey = reconstructionAestheticsRef.current;
    if (prevKey && sortedKey.join(",") === prevKey.join(",")) return;
    reconstructionAestheticsRef.current = sortedKey;

    setIsReconstructing(true);
    reconstructedRef.current = true;

    // Collect currently visible IDs to exclude them
    const excludeIds = Array.from(visibleIdsRef.current);

    utils.showcase.byAesthetics
      .fetch({
        aesthetics: aestheticOverride,
        limit: 24,
        excludeIds,
      })
      .then(result => {
        if (result.items.length > 0) {
          setReconstructedItems(result.items as ShowcaseItem[]);
        }
      })
      .catch(() => {
        // Silent fail — keep original items
      })
      .finally(() => {
        setIsReconstructing(false);
      });
  }, [aestheticOverride, isReconstructing, utils.showcase.byAesthetics]);

  // ─── Merge: visible originals + reconstructed replacements ──────
  // Hard cap to prevent OOM from unlimited infinite scroll
  const MAX_DISPLAY_ITEMS = 200;

  const allItems = useMemo(() => {
    let items: ShowcaseItem[];
    if (reconstructedItems.length === 0) {
      items = originalItems;
    } else {
      // Keep items that are already visible (in viewport)
      const visibleIds = visibleIdsRef.current;
      const keptItems = originalItems.filter(item => visibleIds.has(item.id));

      // Append reconstructed items (already excludes visible IDs from backend)
      const merged = [...keptItems, ...reconstructedItems];

      // Deduplicate by ID
      const seen = new Set<number>();
      items = merged.filter(item => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
    }
    // Cap total items to prevent OOM in DOM
    return items.slice(0, MAX_DISPLAY_ITEMS);
  }, [originalItems, reconstructedItems]);

  // ─── Infinite Scroll: IntersectionObserver sentinel ─────────────────
  const loadMore = useCallback(() => {
    if (
      hasNextPage &&
      !isFetchingNextPage &&
      originalItems.length < MAX_DISPLAY_ITEMS
    ) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, originalItems.length]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          loadMore();
        }
      },
      { rootMargin: "300px 0px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  // ─── Render ─────────────────────────────────────────────────────────

  return (
    <section
      ref={sectionScrollRef}
      className="section-breathing px-4 relative z-10"
      style={{
        background: styles.sectionBg,
        transition: "background 1s ease",
      }}
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
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.7, ease: SOFT_BOUNCE }}
          className="text-center mb-10 sm:mb-12"
        >
          <h2
            className={`hs-h2 !mb-0 transition-colors duration-1000 ${styles.titleColor}`}
          >
            精選作品
          </h2>
          <p
            className={`mt-3 sm:mt-4 hs-small !mb-0 transition-colors duration-1000 ${styles.subtitleColor}`}
          >
            社群創作者的靈感結晶，探索多模態 AI 的無限可能
          </p>
          {/* Healing divider */}
          <div
            className="mx-auto mt-6 sm:mt-8 w-16 h-[1px] rounded-full"
            style={{
              background: `linear-gradient(90deg, transparent, ${styles.dividerColor}, transparent)`,
            }}
          />
        </motion.div>

        {/* Modality filter tabs */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.5, delay: 0.1, ease: SOFT_BOUNCE }}
          className="mb-8"
        >
          <ModalityTabs
            active={modality}
            onChange={setModality}
            styles={styles}
          />
        </motion.div>

        {/* Loading skeleton */}
        {isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} styles={styles} />
            ))}
          </div>
        )}

        {/* Error state */}
        {isError && (
          <div className="text-center py-16">
            <p className={`text-sm ${styles.textMuted}`}>
              載入失敗，請稍後再試
            </p>
          </div>
        )}

        {/* Empty state — with gentle breathing */}
        {!isLoading && !isError && allItems.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-20"
          >
            <motion.div
              animate={{ scale: [1, 1.08, 1], opacity: [0.4, 0.7, 0.4] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            >
              <Sparkles
                className={`w-10 h-10 mx-auto mb-5 ${styles.textMuted}`}
              />
            </motion.div>
            <p className={`text-sm ${styles.textMuted}`}>
              暫無精選作品，敬請期待
            </p>
          </motion.div>
        )}

        {/* ── Carousel layout — gentle sliding showcase ── */}
        {!isLoading && allItems.length > 0 && (
          <div className="w-full">
            <Carousel
              setApi={setShowcaseApi}
              plugins={[showcaseAutoplay]}
              opts={{ align: "start", loop: true }}
              className="w-full carousel-fade-edge"
            >
              <CarouselContent className="-ml-5">
                {/* Cap at 24 items for carousel performance — prevents excessive DOM nodes and keeps navigation snappy */}
                {allItems.slice(0, 24).map(item => (
                  <CarouselItem
                    key={item.id}
                    className="pl-5 basis-full sm:basis-1/2 lg:basis-1/3"
                  >
                    <MasonryCard
                      item={item}
                      styles={styles}
                      onCardClick={handleCardClick}
                      senseEngine={senseEngine}
                      onVisibilityChange={trackVisibility}
                    />
                  </CarouselItem>
                ))}
              </CarouselContent>
            </Carousel>

            {/* Carousel dot indicators */}
            {showcaseSlideCount > 1 && (
              <div className="flex items-center justify-center gap-2.5 mt-10">
                {Array.from({
                  length: Math.min(showcaseSlideCount, MAX_VISIBLE_DOTS),
                }).map((_, i) => (
                  <motion.button
                    key={i}
                    onClick={() => showcaseScrollTo(i)}
                    className="rounded-full transition-all duration-700"
                    style={{
                      background: SCENE_DOT_COLORS[sceneId],
                      opacity: i === showcaseSlide ? 0.5 : 0.12,
                    }}
                    animate={{
                      width: i === showcaseSlide ? 28 : 8,
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

        {/* Infinite scroll sentinel — prefetches additional data that populates the carousel.
            Carousel displays up to 24 items; newly fetched items replace/extend the carousel pool
            via allItems computed value, keeping the experience fresh as user browses. */}
        <div ref={sentinelRef} className="h-4" />

        {/* Loading more indicator */}
        {isFetchingNextPage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center justify-center py-6 gap-2"
          >
            <Loader2 className={`w-4 h-4 animate-spin ${styles.textMuted}`} />
            <span className={`text-xs ${styles.textMuted}`}>
              載入更多作品...
            </span>
          </motion.div>
        )}
      </div>

      {/* Portfolio Detail Modal */}
      <PortfolioDetailDialog
        basic={detailBasic}
        detail={detailData}
        isLoadingDetail={isLoadingDetail}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onEnterStudio={handleEnterStudio}
        isDark={sceneId !== "morning"}
      />

      {/* Ripple Transition Overlay */}
      <RippleTransition
        active={rippleActive}
        origin={rippleOrigin}
        sceneId={sceneId}
        onComplete={handleRippleComplete}
      />
    </section>
  );
}
