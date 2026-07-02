import { useAuth } from "@/_core/hooks/useAuth";
import VisualSoul from "@/components/VisualSoul";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { getLoginUrl, getDemoLoginUrl } from "@/const";
import LocalAuthForm from "@/components/LocalAuthForm";
import LoginCosmicScene, { getSceneFrameHues } from "@/components/LoginCosmicScene";
import type { SceneId } from "@/components/AmbientEnvironment";
import { useAmbient } from "@/contexts/AmbientSoundContext";
import { SoundControl } from "@/components/AmbientSoundEngine";
import { BackgroundTasksProvider } from "@/contexts/BackgroundTasksContext";
import {
  useSiteOnboarding,
  type PageId,
} from "@/contexts/SiteOnboardingContext";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { ProactiveEventBus } from "@/lib/proactiveEventBus";
import {
  measurePageTti,
  isPageTtiSlow,
  trackRouteVisit,
  suggestUnusedFeature,
} from "@/lib/spiritWatchers";
import { ProactiveNotificationCenter } from "@/lib/ProactiveNotificationCenter";
import { useGlobalOrbChat } from "@/contexts/GlobalOrbChatContext";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Button } from "./ui/button";
import ProactiveOrbWidget from "./ProactiveOrbWidget";
import AgentIntentPreview from "./AgentIntentPreview";
import AgentFocusSpotlight from "./AgentFocusSpotlight";
import {
  getPageById,
  getSidebarTree,
  type SidebarTreeLeaf,
} from "@/config/appRegistry";
import { resolveSidebarIcon } from "@/config/sidebarIcons";
import { usePersonalSettings } from "@/contexts/PersonalSettingsContext";
import { ProjectSelector } from "./layout/ProjectSelector";
import { useIsMobile } from "@/hooks/useMobile";
import type { ShellId } from "@/spine/types"; // P0 4-shell：可選 shell 範圍
import AppleDock, {
  type DockEntry,
  type DockLeaf,
  type DockPosition,
  type DockDensity,
  type DockVariant,
} from "./AppleDock";
import { ENABLE_AIDV_CHROME, ENABLE_QUICK_FEEDBACK, ORB_SMILEY_ONLY } from "@/config/featureFlags";
import { AidvShellChrome } from "@/shells/AidvShellChrome";
import { AidvOrbMount } from "@/shells/AidvOrbMount";
import { QuickFeedbackButton } from "./QuickFeedbackButton";

const DOCK_POSITION_KEY = "apple-dock-position";
const DOCK_MINIMIZED_KEY = "apple-dock-minimized";
const DOCK_IMMERSIVE_KEY = "apple-dock-immersive";
const DOCK_DENSITY_KEY = "apple-dock-density";
const DOCK_VARIANT_KEY = "apple-dock-variant";

function readDockPosition(): DockPosition {
  if (typeof window === "undefined") return "left";
  const v = window.localStorage.getItem(DOCK_POSITION_KEY);
  if (v === "right" || v === "top" || v === "bottom" || v === "left") {
    return v;
  }
  return "left";
}

function readDockMinimized(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(DOCK_MINIMIZED_KEY) === "1";
}

function readDockImmersive(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(DOCK_IMMERSIVE_KEY) === "1";
}

function readDockDensity(): DockDensity {
  if (typeof window === "undefined") return "comfortable";
  const v = window.localStorage.getItem(DOCK_DENSITY_KEY);
  if (v === "compact" || v === "comfortable" || v === "spacious") return v;
  return "comfortable";
}

function readDockVariant(): DockVariant {
  if (typeof window === "undefined") return "dock";
  const v = window.localStorage.getItem(DOCK_VARIANT_KEY);
  if (v === "dock" || v === "rail" || v === "panel") return v;
  return "dock";
}

const POSITION_CYCLE: DockPosition[] = ["left", "top", "right", "bottom"];


// ─── Sidebar structure ──────────────────────────────────────────────────
//
// The dock's content (which leaves go where, group labels/icons, ordering)
// is fully driven by shared/appRegistry — see SIDEBAR_GROUPS + each page's
// sidebarOrder/sidebarGroup/sidebarIcon. To add or move a dock entry, edit
// the registry, NOT this file.

const toDockLeaf = (leaf: SidebarTreeLeaf): DockLeaf => ({
  kind: "leaf",
  icon: resolveSidebarIcon(leaf.icon),
  label: leaf.label,
  description: undefined,
  path: leaf.path,
  id: `sidebar-${leaf.pageId}-link`,
  pageId: leaf.pageId,
});

const sidebarStructure: DockEntry[] = getSidebarTree().map(node => {
  if (node.kind === "page") return toDockLeaf(node);
  return {
    kind: "group",
    icon: resolveSidebarIcon(node.icon),
    label: node.label,
    description: node.description,
    children: node.children.map(toDockLeaf),
    seeAllPath: node.seeAllPath,
  };
});

// ─── Per-scene login card chrome ────────────────────────────────────────────

type LoginSceneTheme = {
  /** Glass body gradient */
  cardBg: string;
  /** Glass body border */
  cardBorder: string;
  /** Card outer halo / boxShadow */
  cardShadow: string;
  /** Subtitle copy + colour */
  subtitleText: string;
  subtitleColor: string;
  /** Primary button gradient + outline */
  primaryBg: string;
  primaryBorder: string;
  primaryShadow: string;
  /** Demo button outline + tint */
  demoBg: string;
  demoBorder: string;
  demoText: string;
  /** Friendly scene label for the indicator pill */
  label: string;
  /** Pill emoji */
  glyph: string;
};

const LOGIN_THEMES: Record<SceneId, LoginSceneTheme> = {
  nightSky: {
    cardBg:
      "linear-gradient(160deg, rgba(28,22,52,0.62) 0%, rgba(18,12,38,0.72) 100%)",
    cardBorder: "1px solid rgba(180,160,240,0.22)",
    cardShadow: [
      "0 1px 0 rgba(255,255,255,0.10) inset",
      "0 -1px 0 rgba(0,0,0,0.22) inset",
      "0 0 0 1px rgba(120,100,200,0.14) inset",
      "0 4px 12px rgba(0,0,0,0.28)",
      "0 18px 44px rgba(0,0,0,0.45)",
      "0 36px 100px rgba(0,0,0,0.6)",
      "0 0 70px rgba(120,90,200,0.22)",
    ].join(","),
    subtitleText: "在星河之間，讓 AI 陪伴你舒適地創作",
    subtitleColor: "rgba(230,222,255,0.78)",
    primaryBg:
      "linear-gradient(135deg, rgba(170,140,240,0.95) 0%, rgba(120,90,210,0.95) 100%)",
    primaryBorder: "1px solid rgba(220,200,255,0.32)",
    primaryShadow:
      "0 8px 24px rgba(110,80,200,0.4), 0 0 0 1px rgba(255,255,255,0.06) inset",
    demoBg: "rgba(255,255,255,0.04)",
    demoBorder: "rgba(200,180,240,0.28)",
    demoText: "rgba(230,222,255,0.85)",
    label: "夜空",
    glyph: "🌌",
  },
  morning: {
    cardBg:
      "linear-gradient(160deg, rgba(82,42,68,0.55) 0%, rgba(48,24,46,0.7) 100%)",
    cardBorder: "1px solid rgba(255,210,170,0.30)",
    cardShadow: [
      "0 1px 0 rgba(255,225,200,0.18) inset",
      "0 -1px 0 rgba(40,12,18,0.26) inset",
      "0 0 0 1px rgba(255,180,140,0.18) inset",
      "0 4px 12px rgba(60,18,30,0.30)",
      "0 18px 44px rgba(60,18,30,0.42)",
      "0 36px 100px rgba(40,10,18,0.55)",
      "0 0 70px rgba(255,170,130,0.26)",
    ].join(","),
    subtitleText: "在晨光之間，讓 AI 陪伴你舒適地創作",
    subtitleColor: "rgba(255,235,215,0.85)",
    primaryBg:
      "linear-gradient(135deg, rgba(255,180,130,0.95) 0%, rgba(230,120,120,0.95) 100%)",
    primaryBorder: "1px solid rgba(255,225,200,0.42)",
    primaryShadow:
      "0 8px 24px rgba(220,110,90,0.4), 0 0 0 1px rgba(255,255,255,0.08) inset",
    demoBg: "rgba(255,235,215,0.05)",
    demoBorder: "rgba(255,210,170,0.32)",
    demoText: "rgba(255,235,210,0.92)",
    label: "晨光",
    glyph: "🌅",
  },
  cafe: {
    cardBg:
      "linear-gradient(160deg, rgba(46,28,18,0.62) 0%, rgba(30,18,12,0.74) 100%)",
    cardBorder: "1px solid rgba(255,200,140,0.26)",
    cardShadow: [
      "0 1px 0 rgba(255,220,180,0.16) inset",
      "0 -1px 0 rgba(0,0,0,0.30) inset",
      "0 0 0 1px rgba(220,150,90,0.20) inset",
      "0 4px 12px rgba(20,10,4,0.32)",
      "0 18px 44px rgba(20,10,4,0.46)",
      "0 36px 100px rgba(10,4,0,0.6)",
      "0 0 70px rgba(220,150,90,0.26)",
    ].join(","),
    subtitleText: "在咖啡香之間，讓 AI 陪伴你舒適地創作",
    subtitleColor: "rgba(255,225,190,0.82)",
    primaryBg:
      "linear-gradient(135deg, rgba(220,150,90,0.95) 0%, rgba(160,90,55,0.95) 100%)",
    primaryBorder: "1px solid rgba(255,225,180,0.36)",
    primaryShadow:
      "0 8px 24px rgba(120,60,30,0.45), 0 0 0 1px rgba(255,235,200,0.08) inset",
    demoBg: "rgba(255,220,180,0.05)",
    demoBorder: "rgba(255,200,140,0.30)",
    demoText: "rgba(255,225,190,0.90)",
    label: "咖啡廳",
    glyph: "☕",
  },
  deepSea: {
    cardBg:
      "linear-gradient(160deg, rgba(12,38,58,0.62) 0%, rgba(8,22,38,0.78) 100%)",
    cardBorder: "1px solid rgba(120,200,230,0.28)",
    cardShadow: [
      "0 1px 0 rgba(180,230,255,0.14) inset",
      "0 -1px 0 rgba(0,0,0,0.32) inset",
      "0 0 0 1px rgba(60,160,210,0.18) inset",
      "0 4px 12px rgba(0,4,12,0.34)",
      "0 18px 44px rgba(0,4,12,0.5)",
      "0 36px 100px rgba(0,2,8,0.65)",
      "0 0 70px rgba(60,160,210,0.26)",
    ].join(","),
    subtitleText: "在深海之間，讓 AI 陪伴你舒適地創作",
    subtitleColor: "rgba(210,235,250,0.82)",
    primaryBg:
      "linear-gradient(135deg, rgba(80,180,220,0.95) 0%, rgba(40,110,170,0.95) 100%)",
    primaryBorder: "1px solid rgba(200,235,250,0.36)",
    primaryShadow:
      "0 8px 24px rgba(20,80,130,0.45), 0 0 0 1px rgba(255,255,255,0.06) inset",
    demoBg: "rgba(160,230,255,0.05)",
    demoBorder: "rgba(120,200,230,0.32)",
    demoText: "rgba(210,235,250,0.90)",
    label: "深海",
    glyph: "🌊",
  },
};

function LoginScreen() {
  const ambient = useAmbient();
  const { sceneId, override, setOverride, allScenes, isDark } = ambient;
  const theme = LOGIN_THEMES[sceneId];

  // Stable controls object for SoundControl — strip scene fields. Memoised so
  // SoundControl's React.memo wrapper isn't invalidated on every parent
  // render (otherwise the slider/state would feel stuttery).
  const soundControls = useMemo(
    () => ({
      isPlaying: ambient.isPlaying,
      isMuted: ambient.isMuted,
      volume: ambient.volume,
      isUnlocked: ambient.isUnlocked,
      toggleMute: ambient.toggleMute,
      setVolume: ambient.setVolume,
      unlock: ambient.unlock,
    }),
    [
      ambient.isPlaying,
      ambient.isMuted,
      ambient.volume,
      ambient.isUnlocked,
      ambient.toggleMute,
      ambient.setVolume,
      ambient.unlock,
    ]
  );

  // CSS custom properties must live on a COMMON ANCESTOR of both the scene
  // background and the auth card (the card reads them via `var(--login-frame-
  // hue-*)`). LoginCosmicScene and the card are siblings, so we set the vars
  // on the .login-cosmic wrapper here.
  const frameHues = getSceneFrameHues(sceneId);

  return (
    <div
      className="login-cosmic relative flex items-center justify-center min-h-screen overflow-hidden"
      data-scene={sceneId}
      style={{
        ["--login-frame-hue-a" as string]: frameHues.a,
        ["--login-frame-hue-b" as string]: frameHues.b,
        ["--login-frame-hue-c" as string]: frameHues.c,
      }}
    >
      <LoginCosmicScene sceneId={sceneId} />

      {/* ── Sound control — top-left, lets visitors enable scene-aware light music. */}
      <div className="absolute top-4 left-4 sm:top-6 sm:left-6 z-20">
        <SoundControl
          controls={soundControls}
          isDark={isDark}
          sceneLabel={theme.label}
          compact
        />
      </div>

      {/* ── Scene picker — small chip row in the top-right so visitors can
       *    preview/lock any of the four scenes before logging in. ── */}
      <div
        className="absolute top-4 right-4 sm:top-6 sm:right-6 z-20 flex items-center gap-1.5 rounded-full px-2 py-1.5 text-xs"
        style={{
          background: "rgba(10,8,22,0.42)",
          backdropFilter: "blur(14px) saturate(140%)",
          WebkitBackdropFilter: "blur(14px) saturate(140%)",
          border: "1px solid rgba(255,255,255,0.10)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.32)",
        }}
        role="group"
        aria-label="切換背景場景"
      >
        {allScenes.map(s => {
          const t = LOGIN_THEMES[s.id as SceneId];
          const isActive = sceneId === s.id;
          const isLocked = override === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setOverride(isLocked ? null : (s.id as SceneId))}
              className="hs-press rounded-full px-2.5 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring-healing-strong) focus-visible:ring-offset-0"
              aria-label={
                isLocked
                  ? `已鎖定背景場景：${s.label}（再次點擊恢復自動）`
                  : `切換背景場景為 ${s.label}`
              }
              aria-pressed={isActive}
              aria-current={isLocked ? "true" : undefined}
              title={
                isLocked
                  ? `已鎖定為「${s.label}」（再次點擊恢復自動）`
                  : `切換為「${s.label}」`
              }
              style={{
                background: isActive
                  ? "rgba(255,255,255,0.12)"
                  : "transparent",
                color: isActive
                  ? "rgba(255,255,255,0.96)"
                  : "rgba(255,255,255,0.62)",
                boxShadow: isLocked
                  ? "inset 0 0 0 1px rgba(255,210,140,0.55)"
                  : "none",
              }}
            >
              <span className="mr-1" aria-hidden>
                {t.glyph}
              </span>
              {s.label}
            </button>
          );
        })}
      </div>

      <div
        className="login-card relative z-10 p-10 sm:p-12 max-w-md w-full mx-4 text-center"
        style={{
          background: theme.cardBg,
          backdropFilter: "blur(22px) saturate(160%)",
          WebkitBackdropFilter: "blur(22px) saturate(160%)",
          border: theme.cardBorder,
          borderRadius: "1.5rem",
          boxShadow: theme.cardShadow,
        }}
      >
        {/* Top-edge specular sheen — static "glass reflection" that simulates
         *  light catching the upper rim. No pointer tracking (mobile-safe). */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-0 right-0 top-0 rounded-t-[1.5rem]"
          style={{
            height: "44%",
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.04) 38%, transparent 100%)",
            mixBlendMode: "screen",
          }}
        />

        {/* Corner star glyphs — twinkling crosses at the four corners */}
        <span className="login-card-glyph tl" aria-hidden />
        <span className="login-card-glyph tr" aria-hidden />
        <span className="login-card-glyph bl" aria-hidden />
        <span className="login-card-glyph br" aria-hidden />

        <div className="login-card-stagger relative flex justify-center mb-6" data-stagger="1">
          <Suspense fallback={null}>
            <VisualSoul size="lg" personality="creative" state="idle" />
          </Suspense>
        </div>
        <h1 className="login-card-stagger hs-h1 !mb-0 login-title" data-stagger="2">
          AI Director 創作平台
        </h1>
        <p
          className="login-card-stagger text-sm mt-4 max-w-sm mx-auto body-healing leading-relaxed"
          data-stagger="3"
          style={{ color: theme.subtitleColor }}
        >
          {theme.subtitleText}
        </p>
        <Button
          onClick={() => {
            window.location.href = getLoginUrl();
          }}
          size="lg"
          className="login-card-stagger w-full mt-8 h-12 rounded-2xl btn-healing"
          data-stagger="4"
          style={{
            background: theme.primaryBg,
            color: "#fff",
            border: theme.primaryBorder,
            boxShadow: theme.primaryShadow,
          }}
        >
          Google 登入
        </Button>

        {/* Visual divider — separates OAuth from email login so the form feels
         *  like a clear "alternative" path rather than a continuation. */}
        <div
          className="login-card-stagger login-divider mt-5 flex items-center gap-3 text-[11px] tracking-cjk-display"
          data-stagger="5"
          aria-hidden
        >
          <span className="login-divider-rule" />
          <span className="login-divider-text">或使用 EMAIL</span>
          <span className="login-divider-rule" />
        </div>

        <div className="login-card-stagger" data-stagger="6">
          <LocalAuthForm className="mt-3 text-left login-auth-form" />
        </div>
        <Button
          onClick={() => {
            window.location.href = getDemoLoginUrl();
          }}
          variant="outline"
          size="lg"
          className="login-card-stagger w-full mt-3 h-12 rounded-2xl btn-healing"
          data-stagger="7"
          style={{
            background: theme.demoBg,
            borderStyle: "dashed",
            borderColor: theme.demoBorder,
            color: theme.demoText,
          }}
        >
          ✨ 訪客體驗（免登入）
        </Button>
      </div>
    </div>
  );
}

export default function DashboardLayout({
  children,
  shell,
}: {
  children: React.ReactNode;
  /** P0 4-shell：當頁面由某 shell 掛載時帶入；未帶入時行為與線上完全一致。 */
  shell?: ShellId;
}) {
  const { loading, user } = useAuth();

  if (loading) {
    return <DashboardLayoutSkeleton />;
  }

  if (!user) {
    return <LoginScreen />;
  }

  return (
    <SidebarProvider className="h-svh overflow-hidden" data-shell={shell}>
      <BackgroundTasksProvider>
        <DashboardLayoutContent>{children}</DashboardLayoutContent>
      </BackgroundTasksProvider>
    </SidebarProvider>
  );
}

function DashboardLayoutContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, logout } = useAuth();
  const { settings } = usePersonalSettings();
  const [location, setLocation] = useLocation();
  const isMobile = useIsMobile();

  // 15 精靈：訂閱 ProactiveEventBus，依使用者 mutedSpirits 跳過被靜音的精靈。
  // 拉到 layout 這層，整個應用任何地方 publish 都會被 toast 接到。
  const proactivePrefsQuery = trpc.agentPreferences.getPreferences.useQuery(undefined, {
    enabled: Boolean(user),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const mutedSpiritsForBus = useMemo(() => {
    const raw = (proactivePrefsQuery.data as { mutedSpirits?: string[] } | undefined)?.mutedSpirits;
    return Array.isArray(raw) ? raw : [];
  }, [proactivePrefsQuery.data]);
  // proactiveTriggerSettings 走 partial map — 沒設過的事件 fallback 到
  // DEFAULT_PROACTIVE_TRIGGER_SETTINGS（全開、5 分鐘間隔、需打勾）。
  const triggerSettingsForBus = useMemo(() => {
    const raw = (proactivePrefsQuery.data as { proactiveTriggerSettings?: unknown } | undefined)
      ?.proactiveTriggerSettings;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      return raw as Record<string, { enabled?: boolean; minIntervalMs?: number; requireAck?: boolean }>;
    }
    return {};
  }, [proactivePrefsQuery.data]);
  // Global kill-switch + favourite-promotion. orbProactiveSuggestions=false
  // silences EVERY proactive event (per-event triggerSettings can also turn
  // individual ones off). favoriteSpirits promote a transient `surface:
  // "toast"` event to a persistent ack-required notification card so the
  // user has time to read it.
  const proactiveGloballyEnabled = useMemo(() => {
    const raw = (proactivePrefsQuery.data as { orbProactiveSuggestions?: boolean } | undefined)?.orbProactiveSuggestions;
    return raw !== false;
  }, [proactivePrefsQuery.data]);
  const favoriteSpiritsForBus = useMemo(() => {
    const raw = (proactivePrefsQuery.data as { favoriteSpirits?: string[] } | undefined)?.favoriteSpirits;
    return Array.isArray(raw) ? raw : [];
  }, [proactivePrefsQuery.data]);

  // Per-event CTAs surfaced on the proactive notification card. Today
  // we only need one: `context_near_full` → 「開新對話」which calls the
  // global chat's createConversation. The card will dismiss itself
  // after the click, so the user goes straight to the fresh tab.
  const orbChat = useGlobalOrbChat();
  const eventActions = useMemo(
    () => ({
      context_near_full: {
        label: "開新對話",
        onClick: () => {
          void orbChat.createConversation();
        },
      },
    }),
    [orbChat],
  );

  // 15 精靈 / 財財 (accountant)：點數餘額 query。掉到門檻以下時 publish
  // monthly_spend_threshold，讓 toast 出現「本月剩 N 點」提示。
  // 觸發門檻：① remaining ≤ 100，或 ② usedPct ≥ 80（已花掉 80% 以上）。
  // usedPct 由後端用 spent / (spent + remaining) 算出，不再是硬寫 90 的占位。
  const balanceQuery = trpc.credits.myBalance.useQuery(undefined, {
    enabled: Boolean(user),
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
  });
  useEffect(() => {
    const remaining = balanceQuery.data?.remaining;
    if (typeof remaining !== "number") return;
    const realUsedPct = balanceQuery.data?.usedPct ?? 0;
    const LOW_REMAINING_THRESHOLD = 100;
    const HIGH_USAGE_PCT_THRESHOLD = 80;
    const shouldWarn =
      remaining <= LOW_REMAINING_THRESHOLD ||
      realUsedPct >= HIGH_USAGE_PCT_THRESHOLD;
    if (!shouldWarn) return;
    // 真正花最多的模型（近 30 天）— 後端從 api_usage_logs 取，
    // 如果是新使用者沒任何 log，給「最近的高耗模型」這個備援文案，
    // 避免精靈嘴裡冒出 (待接入) 這種開發者佔位字串。
    const recentTopModel =
      (balanceQuery.data as { topModel?: string | null } | undefined)?.topModel;
    const topModel =
      typeof recentTopModel === "string" && recentTopModel.trim()
        ? recentTopModel
        : "最近的高耗模型";
    // dedupeKey 用 user.id + bucket — 同一使用者同一天最多通知一次。
    const day = Math.floor(Date.now() / 86_400_000);
    ProactiveEventBus.publish(
      "monthly_spend_threshold",
      {
        usedPct: realUsedPct,
        remainingCredits: remaining,
        topModel,
      },
      { dedupeKey: `low-balance-${user?.id ?? "anon"}-${day}`, dedupeMs: 86_400_000 }
    );
  }, [balanceQuery.data, user?.id]);

  // 15 精靈 / 守守 (inspector)：page_perf_bad 偵測。Navigation Timing API
  // 報的 domInteractive > 5000ms 視為慢頁。dedupe 用 location + 日期；同一
  // 頁同一天最多一次提示，避免短促重複跳。只在首次掛載時量一次（不每次
  // route change 都量，因為 SPA 切頁不會重置 navigation entry）。
  useEffect(() => {
    if (typeof window === "undefined") return;
    // 等一個 tick 讓瀏覽器把 navigation entry 填好
    const id = window.setTimeout(() => {
      const tti = measurePageTti();
      if (!isPageTtiSlow(tti)) return;
      const day = Math.floor(Date.now() / 86_400_000);
      ProactiveEventBus.publish(
        "page_perf_bad",
        {
          tti: tti ?? 0,
          alternativePage: undefined,
        },
        {
          dedupeKey: `perf:${location}:${day}`,
          dedupeMs: 86_400_000,
        },
      );
    }, 1000);
    return () => window.clearTimeout(id);
  }, [location]);

  // 15 精靈 / 守守 (inspector)：route visit tracking + feature_not_used。
  // 每次切頁累加 visit count；當 count ≥ 20（常駐使用者）且仍有沒走過的
  // 推薦功能時，主動建議「你還沒試過 X」。dedupe 7 天，避免一直 spam。
  useEffect(() => {
    if (!location) return;
    trackRouteVisit(location);
    const suggestion = suggestUnusedFeature();
    if (!suggestion) return;
    ProactiveEventBus.publish(
      "feature_not_used",
      {
        featureName: suggestion.featureName,
        lastSeenAt: undefined,
      },
      {
        dedupeKey: `feat:${suggestion.path}`,
        dedupeMs: 7 * 86_400_000,
      },
    );
  }, [location]);

  // 「能進管理後台」= admin 或 leader；leader 進去只看得到 costs / users 兩個分頁
  const isAdmin = user?.role === "admin" || user?.role === "leader";
  const displayName = settings.displayName.trim() || user?.name || "使用者";
  const displayInitial = displayName.charAt(0).toUpperCase() || "U";

  // Hide admin-only registry pages from the dock for non-admins. Pages keep
  // their sidebar metadata in shared/appRegistry (so admins see them when the
  // dock is built), but we prune `group: "admin"` leaves at render time so
  // regular users don't get broken navigation into the admin console.
  const visibleSidebarStructure = useMemo<DockEntry[]>(() => {
    if (isAdmin) return sidebarStructure;
    return sidebarStructure
      .map(entry => {
        if (entry.kind === "leaf") {
          const page = getPageById(entry.pageId);
          if (page?.group === "admin") return null;
          return entry;
        }
        const children = entry.children.filter(child => {
          const page = getPageById(child.pageId);
          return page?.group !== "admin";
        });
        if (children.length === 0) return null;
        return { ...entry, children };
      })
      .filter((entry): entry is DockEntry => entry !== null);
  }, [isAdmin]);

  // ── Dock position + minimize + immersive + density + variant (persisted) ─
  const [dockPosition, setDockPosition] =
    useState<DockPosition>(readDockPosition);
  const [dockMinimized, setDockMinimized] = useState<boolean>(readDockMinimized);
  const [dockImmersive, setDockImmersive] = useState<boolean>(readDockImmersive);
  const [dockDensity, setDockDensity] = useState<DockDensity>(readDockDensity);
  const [dockVariant, setDockVariant] = useState<DockVariant>(readDockVariant);
  useEffect(() => {
    window.localStorage.setItem(DOCK_POSITION_KEY, dockPosition);
  }, [dockPosition]);
  useEffect(() => {
    window.localStorage.setItem(DOCK_MINIMIZED_KEY, dockMinimized ? "1" : "0");
  }, [dockMinimized]);
  useEffect(() => {
    window.localStorage.setItem(DOCK_IMMERSIVE_KEY, dockImmersive ? "1" : "0");
  }, [dockImmersive]);
  useEffect(() => {
    window.localStorage.setItem(DOCK_DENSITY_KEY, dockDensity);
  }, [dockDensity]);
  useEffect(() => {
    window.localStorage.setItem(DOCK_VARIANT_KEY, dockVariant);
  }, [dockVariant]);
  const cycleDockPosition = useCallback(() => {
    setDockPosition(p => {
      const idx = POSITION_CYCLE.indexOf(p);
      const next = idx === -1 ? 0 : (idx + 1) % POSITION_CYCLE.length;
      return POSITION_CYCLE[next];
    });
  }, []);
  const toggleDockMinimized = useCallback(() => {
    setDockMinimized(v => !v);
  }, []);
  const toggleDockImmersive = useCallback(() => {
    setDockImmersive(v => !v);
  }, []);
  // Switching variant: rail/panel live on a vertical edge — auto-pull the
  // position off top/bottom so the dock doesn't end up in an impossible state.
  const setDockVariantSafe = useCallback((next: DockVariant) => {
    setDockVariant(next);
    if (next !== "dock") {
      setDockPosition(p => (p === "top" || p === "bottom" ? "left" : p));
    }
  }, []);

  // ── 全站 Welcome Tour（首次登入時自動觸發）────────────────────────────
  const { startTour, hasSeen } = useSiteOnboarding();
  useEffect(() => {
    if (!user) return;
    const timer = setTimeout(() => {
      if (!hasSeen("welcome")) {
        startTour("welcome");
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, [user, startTour, hasSeen]);

  // ── Memoized ProactiveOrbWidget callbacks ──────────────────────────────
  const handleOrbRestartTour = useCallback(() => {
    const pathToPageId: Record<string, PageId> = {
      "/pro-studio": "pro-studio",
      "/image-studio": "image-studio",
      "/video-studio": "video-studio",
      "/director": "director",
      "/models": "models",
      "/history": "history",
      "/assets": "assets",
      "/vault": "vault",
      "/notes": "notes",
      "/calendar": "calendar",
      "/shared": "shared",
      "/dashboard": "dashboard",
      "/feedback": "feedback",
      "/settings": "settings",
      "/settings/ai-brain": "settings",
      "/learn": "learn",
      "/learn/tutorial-overview": "learn",
      "/focus-flow": "focus-flow",
      "/background-tasks": "background-tasks",
    };
    const pageId = pathToPageId[location] ?? "welcome";
    window.dispatchEvent(
      new CustomEvent("site-tour-start", { detail: { pageId } })
    );
  }, [location]);

  const handleOrbSaveToNotes = useCallback(
    (payload: { title: string; content?: string; sourceType?: string }) => {
      window.dispatchEvent(
        new CustomEvent("pin-to-notes", { detail: payload })
      );
    },
    []
  );

  const handleOrbOpenNotes = useCallback(() => {
    window.dispatchEvent(new CustomEvent("open-notes-drawer"));
  }, []);

  const handleOrbOpenCalendar = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent("navigate-to", { detail: "/notes" })
    );
  }, []);

  const handleOrbAddToCalendar = useCallback(
    (payload: { title: string; description?: string; date: Date }) => {
      window.dispatchEvent(
        new CustomEvent("add-to-calendar", { detail: payload })
      );
    },
    []
  );

  const handleRestartWelcomeTour = useCallback(() => {
    startTour("welcome", true);
  }, [startTour]);

  // ── Main-content padding mirrors the dock side and tightens when minimized.
  //    In immersive mode we leave only a thin gutter for the edge peek handle.
  //    On mobile the dock collapses to a corner bubble (handled inside
  //    AppleDock), so the main content needs no extra dock-clearance padding.
  //    Variant-aware: rail/panel are flush vertical sidebars, so they need
  //    rail-width vs panel-width clearance instead of the float gutter. ──
  const dockPadClass = (() => {
    // Mobile keeps the dock visible as a floating rail by default; reserve a
    // slim gutter so core controls aren't covered on narrow screens.
    if (isMobile) {
      switch (dockPosition) {
        case "left":
          return "pl-[84px]";
        case "right":
          return "pr-[84px]";
        case "top":
          return "pt-[84px]";
        case "bottom":
          return "pb-[84px]";
      }
    }
    if (dockImmersive) {
      switch (dockPosition) {
        case "left":
          return "pl-3";
        case "right":
          return "pr-3";
        case "top":
          return "pt-3";
        case "bottom":
          return "pb-3";
      }
    }
    if (dockMinimized) {
      switch (dockPosition) {
        case "left":
          return "pl-[56px] sm:pl-[68px]";
        case "right":
          return "pr-[56px] sm:pr-[68px]";
        case "top":
          return "pt-[56px] sm:pt-[68px]";
        case "bottom":
          return "pb-[56px] sm:pb-[68px]";
      }
    }
    // Variant: rail/panel — flush edge, no floating gutter. Width matches the
    // rail (item + chrome) or panel (15rem) widths in index.css.
    if (dockVariant === "rail") {
      return dockPosition === "right" ? "pr-[68px]" : "pl-[68px]";
    }
    if (dockVariant === "panel") {
      return dockPosition === "right" ? "pr-[15rem]" : "pl-[15rem]";
    }
    switch (dockPosition) {
      case "left":
        return "pl-16 sm:pl-24";
      case "right":
        return "pr-16 sm:pr-24";
      case "top":
        return "pt-16 sm:pt-24";
      case "bottom":
        return "pb-16 sm:pb-24";
    }
  })();

  return (
    <>
      {/* 主動精靈通知中心 — 取代舊的 toast 直發。卡片必須打勾才會消失，
          per-event 開關 + 間隔走 agent_preferences.proactiveTriggerSettings。
          orbProactiveSuggestions=false 是全域 kill-switch，favoriteSpirits 把
          被收藏的精靈事件升級成 ack 卡片。
          「光球只留笑臉光球」(ORB_SMILEY_ONLY，預設 ON)：把 globallyEnabled 強制壓成
          false，走元件既有「不訂閱任何事件＋清空佇列＋render null」安全分支＝守守/財財/
          巧巧等主動精靈卡片整組不再跳出，笑臉光球本體完全不受影響。底層精靈系統保留，
          設 VITE_ORB_SMILEY_ONLY=0 或 ?orbsmileyonly=0 即秒回滾。 */}
      <ProactiveNotificationCenter
        mutedSpirits={mutedSpiritsForBus}
        triggerSettings={triggerSettingsForBus}
        globallyEnabled={proactiveGloballyEnabled && !ORB_SMILEY_ONLY}
        favoriteSpirits={favoriteSpiritsForBus}
        eventActions={eventActions}
      />
      {/* ── 殼層 chrome：旗標 ON 用 design-kit 亮色暖光 Rail/TopBar/⌘K（U-4/AIDV-94，
           strangler）；OFF（預設）沿用既有 AppleDock＝線上零變化。 ── */}
      {ENABLE_AIDV_CHROME ? (
        <AidvShellChrome />
      ) : (
        <AppleDock
          entries={visibleSidebarStructure}
          activePath={location}
          onNavigate={setLocation}
          user={user}
          displayName={displayName}
          displayInitial={displayInitial}
          isAdmin={isAdmin}
          onLogout={logout}
          onRestartTour={handleRestartWelcomeTour}
          position={dockPosition}
          onCyclePosition={cycleDockPosition}
          onSetPosition={setDockPosition}
          minimized={dockMinimized}
          onToggleMinimized={toggleDockMinimized}
          immersive={dockImmersive}
          onToggleImmersive={toggleDockImmersive}
          density={dockDensity}
          onSetDensity={setDockDensity}
          variant={dockVariant}
          onSetVariant={setDockVariantSafe}
        />
      )}

      <SidebarInset className="flex flex-col min-h-0 overflow-hidden relative">
        {/* ── Workspace ambient background decorations ── */}
        <div
          className="workspace-ambient-bg absolute inset-0 pointer-events-none"
          aria-hidden="true"
        >
          <div className="workspace-top-glow" />
          <div className="workspace-orb workspace-orb-1" />
          <div className="workspace-orb workspace-orb-2" />
          <div className="workspace-orb workspace-orb-3" />
        </div>

        <main
          id="main-content"
          tabIndex={-1}
          className={`relative flex-1 overflow-y-auto ${
            settings.compactMode ? "p-3 sm:p-4 lg:p-5" : "p-4 sm:p-6 lg:p-8"
          } ${ENABLE_AIDV_CHROME ? "pt-[58px] md:pl-[76px] lg:pl-[76px] pb-[64px] md:pb-0" : dockPadClass} pb-safe-area-inset-bottom focus:outline-none transition-[padding] duration-300 ease-out`}
          data-scroll-area
          style={{
            paddingTop: `calc(${ENABLE_AIDV_CHROME ? "58px + " : ""}${settings.compactMode ? "0.75rem" : "1rem"} + env(safe-area-inset-top, 0px))`,
            paddingBottom: settings.compactMode
              ? "calc(1rem + env(safe-area-inset-bottom, 0px))"
              : "calc(2rem + env(safe-area-inset-bottom, 0px))",
          }}
        >
          {/* Phase 1：全站專案選擇器 — 跨系統導航時保持同一創作上下文。
              採黏性定位讓滾動時也保持可見,使用者可隨時切換或新增專案。 */}
          {user && (
            <div className="sticky top-0 z-30 -mx-2 mb-4 flex items-center justify-end gap-2 bg-background/80 px-2 py-1 backdrop-blur supports-[backdrop-filter]:bg-background/60">
              <ProjectSelector />
            </div>
          )}
          {children}
        </main>
      </SidebarInset>

      {/* 全站光球常駐協助（Studio 頁面內已有自己的光球，不需要重複）
          Phase 2a：/agent 緩衝聊天頁已是全頁光球對話，浮球隱藏避免雙重 UI */}
      {user && location !== "/agent" && (
        <ProactiveOrbWidget
          onRestartTour={handleOrbRestartTour}
          onSaveToNotes={handleOrbSaveToNotes}
          onOpenNotes={handleOrbOpenNotes}
          onOpenCalendar={handleOrbOpenCalendar}
          onAddToCalendar={handleOrbAddToCalendar}
          onNavigate={path => setLocation(path)}
        />
      )}
      {/* U-11 OrbAssistant 新光球（design-kit「另一種型態」，AIDV-114 第3片）。
          旗標 ENABLE_AIDV_CHROME gate＝OFF（線上預設）時不掛＝零變化、舊光球照舊；
          ON 時於左下並存（Bruce 2026-06-16 拍板「另一種型態·同時存在」）。視覺實裝，
          尚未接 spine 資料（adapter＝後續片）。 */}
      {ENABLE_AIDV_CHROME && user && location !== "/agent" && <AidvOrbMount />}
      {/* AIDV-864：快速情境回饋浮動鈕（預設 ON，退路 VITE_ENABLE_QUICK_FEEDBACK=0 或 ?quickfeedback=0） */}
      {ENABLE_QUICK_FEEDBACK && user && <QuickFeedbackButton />}
      {/* 破壞性動作執行前的柔軟確認卡片（全站都可觸發，含 /agent） */}
      {user && <AgentIntentPreview />}
      {/* 光球「看這裡」視覺聚焦（focusElement 動作的畫面層） */}
      {user && <AgentFocusSpotlight />}
    </>
  );
}
