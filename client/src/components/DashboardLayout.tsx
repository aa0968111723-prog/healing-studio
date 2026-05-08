import { useAuth } from "@/_core/hooks/useAuth";
import VisualSoul from "@/components/VisualSoul";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { getLoginUrl, getDemoLoginUrl } from "@/const";
import LocalAuthForm from "@/components/LocalAuthForm";
import LoginCosmicScene from "@/components/LoginCosmicScene";
import { useCurrentScene } from "@/components/AmbientEnvironment";
import type { SceneId } from "@/components/AmbientEnvironment";
import {
  Wand2,
  Clapperboard,
  Cpu,
  BarChart3,
  Settings,
  StickyNote,
  CalendarDays,
  Image,
  Clock,
  Package,
  Layers,
  MessageSquare,
  Zap,
  Film,
  BookOpen,
  BookMarked,
  ListChecks,
  Coins,
  Monitor,
  Music,
  Bot,
  Sparkles,
  LayoutGrid,
  Palette,
  FolderOpen,
  GraduationCap,
  Users,
} from "lucide-react";
import { BackgroundTasksProvider } from "@/contexts/BackgroundTasksContext";
import type { LucideIcon } from "lucide-react";
import {
  useSiteOnboarding,
  type PageId,
} from "@/contexts/SiteOnboardingContext";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Button } from "./ui/button";
import ProactiveOrbWidget from "./ProactiveOrbWidget";
import AgentIntentPreview from "./AgentIntentPreview";
import AgentFocusSpotlight from "./AgentFocusSpotlight";
import {
  getSidebarPages,
  type AppPageRegistryItem,
} from "@/config/appRegistry";
import { usePersonalSettings } from "@/contexts/PersonalSettingsContext";
import AppleDock, {
  type DockEntry,
  type DockLeaf,
  type DockPosition,
} from "./AppleDock";

const DOCK_POSITION_KEY = "apple-dock-position";
const DOCK_MINIMIZED_KEY = "apple-dock-minimized";

function readDockPosition(): DockPosition {
  if (typeof window === "undefined") return "left";
  const v = window.localStorage.getItem(DOCK_POSITION_KEY);
  return v === "right" ? "right" : "left";
}

function readDockMinimized(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(DOCK_MINIMIZED_KEY) === "1";
}


type SidebarLeafItem = DockLeaf;

type SidebarGroupItem = {
  kind: "group";
  icon: LucideIcon;
  label: string;
  children: SidebarLeafItem[];
};

type SidebarEntry = DockEntry;

const sidebarIconByPageId: Record<string, LucideIcon> = {
  "agent-chat": Bot,
  create: LayoutGrid,
  playground: Sparkles,
  studio: Wand2,
  "image-studio": Image,
  "video-studio": Film,
  "pro-studio": Music,
  director: Clapperboard,
  assets: Package,
  history: Clock,
  "prompt-library": BookMarked,
  shared: Users,
  models: Cpu,
  "lora-trainer": Zap,
  vault: Layers,
  "background-tasks": ListChecks,
  notes: StickyNote,
  calendar: CalendarDays,
  dashboard: BarChart3,
  credits: Coins,
  learn: BookOpen,
  feedback: MessageSquare,
  langsmith: Monitor,
  settings: Settings,
};

const allSidebarPages = getSidebarPages();
const sidebarPagesById = new Map(
  allSidebarPages.map(page => [page.id, page])
);

const toLeafItem = (page: AppPageRegistryItem): SidebarLeafItem => ({
  kind: "leaf",
  icon: sidebarIconByPageId[page.id] ?? BookOpen,
  label: page.label,
  path: page.path,
  id: `sidebar-${page.id}-link`,
  pageId: page.id,
});

const buildLeaf = (id: string): SidebarLeafItem | null => {
  const page = sidebarPagesById.get(id);
  return page ? toLeafItem(page) : null;
};

const buildGroup = (
  label: string,
  icon: LucideIcon,
  ids: string[]
): SidebarGroupItem | null => {
  const children = ids
    .map(buildLeaf)
    .filter((leaf): leaf is SidebarLeafItem => leaf !== null);
  if (children.length === 0) return null;
  return { kind: "group", label, icon, children };
};

const sidebarStructure: SidebarEntry[] = (() => {
  const entries: SidebarEntry[] = [];
  const push = (entry: SidebarEntry | null) => {
    if (entry) entries.push(entry);
  };
  push(buildLeaf("agent-chat"));
  push(
    buildGroup("創作工作室", Palette, [
      "studio",
      "image-studio",
      "video-studio",
      "pro-studio",
      "director",
    ])
  );
  push(buildGroup("資源庫", FolderOpen, ["models", "assets"]));
  push(buildGroup("知識中心", GraduationCap, ["notes", "learn"]));
  return entries;
})();

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
      "0 1px 0 rgba(255,255,255,0.08) inset",
      "0 0 0 1px rgba(120,100,200,0.12) inset",
      "0 24px 80px rgba(0,0,0,0.55)",
      "0 0 60px rgba(120,90,200,0.18)",
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
      "0 1px 0 rgba(255,225,200,0.14) inset",
      "0 0 0 1px rgba(255,180,140,0.16) inset",
      "0 24px 80px rgba(60,18,30,0.5)",
      "0 0 60px rgba(255,170,130,0.22)",
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
      "0 1px 0 rgba(255,220,180,0.12) inset",
      "0 0 0 1px rgba(220,150,90,0.18) inset",
      "0 24px 80px rgba(20,10,4,0.55)",
      "0 0 60px rgba(220,150,90,0.22)",
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
      "0 1px 0 rgba(180,230,255,0.10) inset",
      "0 0 0 1px rgba(60,160,210,0.16) inset",
      "0 24px 80px rgba(0,4,12,0.6)",
      "0 0 60px rgba(60,160,210,0.22)",
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
  const { sceneId, override, setOverride, allScenes } = useCurrentScene();
  const theme = LOGIN_THEMES[sceneId];

  // Pointer-driven 3D card tilt — subtle parallax that responds to the
  // visitor's mouse, giving a tactile "physical glass" feel.
  const cardRef = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState<{ rx: number; ry: number; sx: number; sy: number }>(
    { rx: 0, ry: 0, sx: 50, sy: 50 }
  );
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (reduced) return;
      const el = cardRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;
      // Tilt range ~±5deg — gentle, never disorienting
      const rx = (0.5 - py) * 6;
      const ry = (px - 0.5) * 8;
      setTilt({ rx, ry, sx: px * 100, sy: py * 100 });
    },
    [reduced]
  );

  const handlePointerLeave = useCallback(() => {
    setTilt({ rx: 0, ry: 0, sx: 50, sy: 50 });
  }, []);

  return (
    <div
      className="login-cosmic relative flex items-center justify-center min-h-screen overflow-hidden"
      data-scene={sceneId}
    >
      <LoginCosmicScene sceneId={sceneId} />

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
              className="rounded-full px-2.5 py-1 transition-all"
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
        ref={cardRef}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        className="login-card relative z-10 p-10 sm:p-12 max-w-md w-full mx-4 text-center"
        style={{
          background: theme.cardBg,
          backdropFilter: "blur(22px) saturate(160%)",
          WebkitBackdropFilter: "blur(22px) saturate(160%)",
          border: theme.cardBorder,
          borderRadius: "1.5rem",
          boxShadow: theme.cardShadow,
          transform: `perspective(1100px) rotateX(${tilt.rx.toFixed(2)}deg) rotateY(${tilt.ry.toFixed(2)}deg)`,
          transformStyle: "preserve-3d",
          transition: "transform 320ms cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        {/* Specular highlight that follows the pointer (glass sheen) */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[1.5rem]"
          style={{
            background: `radial-gradient(circle at ${tilt.sx}% ${tilt.sy}%, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.04) 28%, transparent 55%)`,
            mixBlendMode: "screen",
            opacity: reduced ? 0 : 1,
            transition: "opacity 200ms",
          }}
        />

        {/* Corner star glyphs — twinkling crosses at the four corners */}
        <span className="login-card-glyph tl" aria-hidden />
        <span className="login-card-glyph tr" aria-hidden />
        <span className="login-card-glyph bl" aria-hidden />
        <span className="login-card-glyph br" aria-hidden />

        <div className="relative flex justify-center mb-6" style={{ transform: "translateZ(28px)" }}>
          <Suspense fallback={null}>
            <VisualSoul size="lg" personality="creative" state="idle" />
          </Suspense>
        </div>
        <h1
          className="hs-h1 !mb-0 login-title"
          style={{ transform: "translateZ(20px)" }}
        >
          AI Director 創作平台
        </h1>
        <p
          className="text-sm mt-4 max-w-sm mx-auto body-healing leading-relaxed"
          style={{ color: theme.subtitleColor, transform: "translateZ(14px)" }}
        >
          {theme.subtitleText}
        </p>
        <Button
          onClick={() => {
            window.location.href = getLoginUrl();
          }}
          size="lg"
          className="w-full mt-8 h-12 rounded-2xl btn-healing"
          style={{
            background: theme.primaryBg,
            color: "#fff",
            border: theme.primaryBorder,
            boxShadow: theme.primaryShadow,
            transform: "translateZ(10px)",
          }}
        >
          Google 登入
        </Button>
        <LocalAuthForm className="mt-3 text-left login-auth-form" />
        <Button
          onClick={() => {
            window.location.href = getDemoLoginUrl();
          }}
          variant="outline"
          size="lg"
          className="w-full mt-3 h-12 rounded-2xl btn-healing"
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
}: {
  children: React.ReactNode;
}) {
  const { loading, user } = useAuth();

  if (loading) {
    return <DashboardLayoutSkeleton />;
  }

  if (!user) {
    return <LoginScreen />;
  }

  return (
    <SidebarProvider className="h-svh overflow-hidden">
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

  const isAdmin = user?.role === "admin";
  const displayName = settings.displayName.trim() || user?.name || "使用者";
  const displayInitial = displayName.charAt(0).toUpperCase() || "U";

  // ── Dock position + minimize (persisted) ───────────────────────────────
  const [dockPosition, setDockPosition] =
    useState<DockPosition>(readDockPosition);
  const [dockMinimized, setDockMinimized] = useState<boolean>(readDockMinimized);
  useEffect(() => {
    window.localStorage.setItem(DOCK_POSITION_KEY, dockPosition);
  }, [dockPosition]);
  useEffect(() => {
    window.localStorage.setItem(DOCK_MINIMIZED_KEY, dockMinimized ? "1" : "0");
  }, [dockMinimized]);
  const toggleDockPosition = useCallback(() => {
    setDockPosition(p => (p === "left" ? "right" : "left"));
  }, []);
  const toggleDockMinimized = useCallback(() => {
    setDockMinimized(v => !v);
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

  // ── Main-content padding mirrors the dock side and tightens when minimized ──
  const dockPadClass = dockMinimized
    ? dockPosition === "left"
      ? "pl-[56px] sm:pl-[68px]"
      : "pr-[56px] sm:pr-[68px]"
    : dockPosition === "left"
      ? "pl-16 sm:pl-24"
      : "pr-16 sm:pr-24";

  return (
    <>
      {/* ── Apple-style floating dock (all viewports) ── */}
      <AppleDock
        entries={sidebarStructure}
        activePath={location}
        onNavigate={setLocation}
        user={user}
        displayName={displayName}
        displayInitial={displayInitial}
        isAdmin={isAdmin}
        onLogout={logout}
        onRestartTour={handleRestartWelcomeTour}
        position={dockPosition}
        onTogglePosition={toggleDockPosition}
        minimized={dockMinimized}
        onToggleMinimized={toggleDockMinimized}
      />

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
          } ${dockPadClass} pb-safe-area-inset-bottom focus:outline-none transition-[padding] duration-300 ease-out`}
          data-scroll-area
          style={{
            paddingTop: `calc(${settings.compactMode ? "0.75rem" : "1rem"} + env(safe-area-inset-top, 0px))`,
            paddingBottom: settings.compactMode
              ? "calc(1rem + env(safe-area-inset-bottom, 0px))"
              : "calc(2rem + env(safe-area-inset-bottom, 0px))",
          }}
        >
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
      {/* 破壞性動作執行前的柔軟確認卡片（全站都可觸發，含 /agent） */}
      {user && <AgentIntentPreview />}
      {/* 光球「看這裡」視覺聚焦（focusElement 動作的畫面層） */}
      {user && <AgentFocusSpotlight />}
    </>
  );
}
