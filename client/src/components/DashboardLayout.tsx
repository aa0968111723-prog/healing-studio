import { useAuth } from "@/_core/hooks/useAuth";
import VisualSoul from "@/components/VisualSoul";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { getLoginUrl, getDemoLoginUrl } from "@/const";
import LocalAuthForm from "@/components/LocalAuthForm";
import { useIsMobile, useViewMode } from "@/hooks/useMobile";
import {
  Wand2,
  Clapperboard,
  Cpu,
  BarChart3,
  Shield,
  LogOut,
  PanelLeft,
  Home,
  Users,
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
  ChevronRight,
  ListChecks,
  Coins,
  Monitor,
  Music,
  GripVertical,
  Bot,
  Sparkles,
  LayoutGrid,
} from "lucide-react";
import { BackgroundTasksProvider } from "@/contexts/BackgroundTasksContext";
import BackgroundTasksDrawer from "./BackgroundTasksDrawer";
import type { LucideIcon } from "lucide-react";
import {
  useSiteOnboarding,
  type PageId,
} from "@/contexts/SiteOnboardingContext";
import {
  CSSProperties,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Button } from "./ui/button";
import { useAIState } from "@/contexts/AIStateContext";
import ProactiveOrbWidget from "./ProactiveOrbWidget";
import AgentIntentPreview from "./AgentIntentPreview";
import AgentFocusSpotlight from "./AgentFocusSpotlight";
import {
  getSidebarPages,
  type AppPageRegistryItem,
} from "@/config/appRegistry";
import { usePersonalSettings } from "@/contexts/PersonalSettingsContext";


type SidebarLeafItem = {
  kind: "leaf";
  icon: LucideIcon;
  label: string;
  path: string;
  id: string;
  pageId: string;
};

type SidebarGroupItem = {
  kind: "group";
  icon: LucideIcon;
  label: string;
  children: SidebarLeafItem[];
};

type SidebarHeadingItem = {
  kind: "heading";
  label: string;
};

type SidebarEntry = SidebarLeafItem | SidebarGroupItem | SidebarHeadingItem;

function isGroup(entry: SidebarEntry): entry is SidebarGroupItem {
  return entry.kind === "group";
}

function isHeading(entry: SidebarEntry): entry is SidebarHeadingItem {
  return entry.kind === "heading";
}

function isLeaf(entry: SidebarEntry): entry is SidebarLeafItem {
  return entry.kind === "leaf";
}

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

const sidebarStructure: SidebarEntry[] = (() => {
  const entries: SidebarEntry[] = [];
  const push = (entry: SidebarEntry | null) => {
    if (entry) entries.push(entry);
  };
  // Flat list — every feature is its own top-level entry, no categories.
  const pageIds = ["agent-chat", "studio", "image-studio", "video-studio", "pro-studio", "director", "models", "assets", "notes", "learn"];

  // Debug: log which pages are found vs missing
  console.log("[Sidebar Debug] Available pages in sidebarPagesById:", Array.from(sidebarPagesById.keys()));
  pageIds.forEach(id => {
    const leaf = buildLeaf(id);
    if (!leaf) {
      console.warn(`[Sidebar Debug] Page not found: ${id}`);
    }
    push(leaf);
  });

  return entries;
})();

const flatMenuItems: SidebarLeafItem[] = sidebarStructure.flatMap(entry => {
  if (isGroup(entry)) return entry.children;
  if (isLeaf(entry)) return [entry];
  return [];
});

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 200;
const MAX_WIDTH = 400;

/** Tablet breakpoint range — auto-collapse to icon mode */
const TABLET_MIN_PX = 768;
const TABLET_MAX_PX = 1024;

const PAGE_HINTS: Record<string, string[]> = {
  "image-studio": [
    "先用快速模型找方向，再切高品質模型定稿。",
    "每次只改一個參數，結果更容易比較與回溯。",
  ],
  "video-studio": [
    "先短時長預演，確認節奏後再產出完整片段。",
    "要省成本可先用經濟模型做分鏡驗證。",
  ],
  "pro-studio": [
    "先確認語氣與情緒，再細調速度與穩定度。",
    "音訊流程建議先去噪/分軌，再做配音或混音。",
  ],
  models: [
    "先做最小可用模型，再逐輪微調超參數。",
    "共享前補上推薦情境與禁用場景，團隊更好用。",
  ],
};

function GlobalPageHint() {
  const { pageContext } = useAIState();
  const [open, setOpen] = useState(false);
  if (!pageContext) return null;

  const hints = PAGE_HINTS[pageContext.pageId] ?? [
    "先完成一個最小可用成果，再逐步細化。",
    "若卡住可先用光球拆解任務，再執行下一步。",
  ];

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-2xl border border-border/50 bg-background/70 p-3 mb-4"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Bot className="w-4 h-4 text-primary shrink-0" />
            <p className="text-xs sm:text-sm font-medium text-left truncate">
              {pageContext.pageLabel} 操作提示
            </p>
          </div>
          <ChevronRight
            className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">
        <ul className="space-y-1 list-disc pl-5">
          {hints.map(h => (
            <li key={h} className="text-xs text-muted-foreground">
              {h}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) {
    return <DashboardLayoutSkeleton />;
  }

  if (!user) {
    return (
      <div
        className="flex items-center justify-center min-h-screen healing-wash-bg"
        style={{
          background:
            "linear-gradient(135deg, #F5F3F0 0%, #EAC9C1 25%, #D4C5E2 55%, #C4DFCF 80%, #C8D5E0 100%)",
        }}
      >
        <div className="glass-card p-10 sm:p-12 max-w-md w-full mx-4 text-center">
          <div className="flex justify-center mb-6">
            <Suspense fallback={null}>
              <VisualSoul size="lg" personality="creative" state="idle" />
            </Suspense>
          </div>
          <h1 className="hs-h1 !mb-0 text-foreground">AI Director 創作平台</h1>
          <p className="text-sm text-muted-foreground mt-4 max-w-sm mx-auto body-healing leading-relaxed">
            在這裡，讓 AI 陪伴你舒適地創作
          </p>
          <Button
            onClick={() => {
              window.location.href = getLoginUrl();
            }}
            size="lg"
            className="w-full mt-8 h-12 rounded-2xl shadow-md hover:shadow-lg hover:bg-primary/80 btn-healing"
          >
            Google 登入
          </Button>
          <LocalAuthForm className="mt-3 text-left" />
          <Button
            onClick={() => {
              window.location.href = getDemoLoginUrl();
            }}
            variant="outline"
            size="lg"
            className="w-full mt-3 h-12 rounded-2xl border-dashed border-muted-foreground/30 hover:bg-muted/40 hover:shadow-md btn-healing"
          >
            ✨ 訪客體驗（免登入）
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
      className="h-svh overflow-hidden"
    >
      <BackgroundTasksProvider>
        <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
          {children}
        </DashboardLayoutContent>
      </BackgroundTasksProvider>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
};

function DashboardLayoutContent({
  children,
  setSidebarWidth,
}: DashboardLayoutContentProps) {
  const { user, logout } = useAuth();
  const { settings } = usePersonalSettings();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar, setOpen } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDisplayWidth, setResizeDisplayWidth] = useState<number | null>(
    null
  );
  const [sidebarQuery, setSidebarQuery] = useState("");
  const sidebarRef = useRef<HTMLDivElement>(null);
  const activeMenuItem = flatMenuItems.find(item => item.path === location);
  const isMobile = useIsMobile();
  const { viewMode } = useViewMode();
  const normalizedSidebarQuery = sidebarQuery.trim().toLowerCase();
  const visibleSidebarStructure = useMemo<SidebarEntry[]>(() => {
    if (!normalizedSidebarQuery) return sidebarStructure;

    return sidebarStructure
      .map(entry => {
        if (isHeading(entry)) {
          // Headings are decorative — skip during search filtering.
          return null;
        }
        if (isLeaf(entry)) {
          const matched =
            entry.label.toLowerCase().includes(normalizedSidebarQuery) ||
            entry.path.toLowerCase().includes(normalizedSidebarQuery);
          return matched ? entry : null;
        }

        const matchedChildren = entry.children.filter(child => {
          return (
            child.label.toLowerCase().includes(normalizedSidebarQuery) ||
            child.path.toLowerCase().includes(normalizedSidebarQuery)
          );
        });

        const selfMatched = entry.label
          .toLowerCase()
          .includes(normalizedSidebarQuery);

        if (!selfMatched && matchedChildren.length === 0) return null;
        return {
          ...entry,
          children: selfMatched ? entry.children : matchedChildren,
        } satisfies SidebarGroupItem;
      })
      .filter((entry): entry is SidebarEntry => Boolean(entry));
  }, [normalizedSidebarQuery]);

  const isAdmin = user?.role === "admin";
  const displayName = settings.displayName.trim() || user?.name || "使用者";
  const displayInitial = displayName.charAt(0).toUpperCase() || "U";

  // ── Tablet auto-collapse: icon mode for 768–1024 px ───────────────────
  useEffect(() => {
    const mql = window.matchMedia(
      `(min-width: ${TABLET_MIN_PX}px) and (max-width: ${TABLET_MAX_PX}px)`
    );
    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches) setOpen(false); // collapse to icon mode
    };
    handleChange(mql); // check on mount
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, [setOpen]);

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

  useEffect(() => {
    if (isCollapsed) setIsResizing(false);
  }, [isCollapsed]);

  // ── Unified resize handler (mouse + touch) ───────────────────────────
  useEffect(() => {
    let rafId: number | null = null;
    let latestClientX = 0;

    const applyResize = () => {
      rafId = null;
      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = latestClientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
        setResizeDisplayWidth(Math.round(newWidth));
      }
    };

    const handlePointerMove = (clientX: number) => {
      if (!isResizing) return;
      latestClientX = clientX;
      if (rafId !== null) return;
      rafId = requestAnimationFrame(applyResize);
    };

    const handleMouseMove = (e: MouseEvent) => handlePointerMove(e.clientX);
    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        e.preventDefault(); // prevent page scroll while resizing
        handlePointerMove(e.touches[0].clientX);
      }
    };
    const handleEnd = () => {
      setIsResizing(false);
      setResizeDisplayWidth(null);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleEnd);
      document.addEventListener("touchmove", handleTouchMove, {
        passive: false,
      });
      document.addEventListener("touchend", handleEnd);
      document.addEventListener("touchcancel", handleEnd);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      // -webkit-user-select needed for Safari on iPad during touch-resize
      (
        document.body.style as unknown as Record<string, string>
      ).webkitUserSelect = "none";
    }
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleEnd);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleEnd);
      document.removeEventListener("touchcancel", handleEnd);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      (
        document.body.style as unknown as Record<string, string>
      ).webkitUserSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  /** Start resize from mouse or touch */
  const startResize = useCallback(() => {
    if (!isCollapsed) setIsResizing(true);
  }, [isCollapsed]);

  /** Double-click / double-tap resets sidebar to default width */
  const resetWidth = useCallback(() => {
    setSidebarWidth(DEFAULT_WIDTH);
  }, [setSidebarWidth]);

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

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar
          collapsible="icon"
          className="border-r-0"
          disableTransition={isResizing}
        >
          <SidebarHeader className="h-16 justify-center sidebar-zen-glow">
            <div className="flex items-center gap-3 px-2 transition-all w-full">
              <button
                onClick={toggleSidebar}
                className="h-10 w-10 flex items-center justify-center hover:bg-accent rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
                aria-label="切換導覽列"
              >
                <PanelLeft className="h-4.5 w-4.5 text-muted-foreground" />
              </button>
              {!isCollapsed && (
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold tracking-tight truncate text-foreground text-sm">
                    AI Director
                  </span>
                </div>
              )}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0">
            {!isCollapsed && (
              <div className="px-3 pt-2 pb-1">
                <label
                  className="surface-1 flex items-center gap-2 rounded-xl px-2.5 py-2 transition-healing focus-within:[outline:2px_solid_var(--ring-healing)] focus-within:outline-offset-1"
                  aria-label="搜尋側邊欄功能"
                >
                  <input
                    value={sidebarQuery}
                    onChange={e => setSidebarQuery(e.target.value)}
                    placeholder="搜尋功能..."
                    className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/80"
                    aria-label="搜尋側邊欄功能"
                  />
                  <kbd
                    className="hidden md:inline-flex items-center gap-0.5 rounded-md border border-border/60 bg-background/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                    title="⌘K / Ctrl+K 全站指令面板"
                  >
                    ⌘K
                  </kbd>
                </label>
              </div>
            )}
            <SidebarMenu
              className="px-2 py-1"
              id="sidebar-nav"
              role="navigation"
              aria-label="主導覽"
            >
              {visibleSidebarStructure.map((entry, index) => {
                if (isHeading(entry)) {
                  return (
                    <li
                      key={`heading-${entry.label}-${index}`}
                      className="sidebar-section-heading group-data-[collapsible=icon]:hidden list-none px-3 pt-4 pb-1.5 text-[10px] font-medium tracking-[0.16em] uppercase text-muted-foreground/55"
                      role="presentation"
                    >
                      <span>{entry.label}</span>
                    </li>
                  );
                }
                if (isGroup(entry)) {
                  const hasActiveChild = entry.children.some(
                    child => location === child.path
                  );
                  return (
                    <Collapsible
                      key={entry.label}
                      defaultOpen={hasActiveChild}
                      className="group/collapsible"
                    >
                      <SidebarMenuItem>
                        <CollapsibleTrigger asChild>
                          <SidebarMenuButton
                            tooltip={entry.label}
                            className="h-11 transition-all duration-200 ease-out font-normal rounded-xl"
                          >
                            <entry.icon className="h-4 w-4" />
                            <span>{entry.label}</span>
                            <span className="ml-1 text-[10px] text-muted-foreground">
                              {entry.children.length}
                            </span>
                            <ChevronRight className="ml-auto h-4 w-4 transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] group-data-[state=open]/collapsible:rotate-90" />
                          </SidebarMenuButton>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <SidebarMenuSub>
                            {entry.children.map(child => {
                              const isChildActive = location === child.path;
                              return (
                                <SidebarMenuSubItem key={child.path}>
                                  <SidebarMenuSubButton
                                    onClick={() => setLocation(child.path)}
                                    isActive={isChildActive}
                                    className="cursor-pointer rounded-lg h-9"
                                    id={child.id}
                                  >
                                    <child.icon
                                      className={`h-4 w-4 ${isChildActive ? "text-primary" : ""}`}
                                    />
                                    <span>{child.label}</span>
                                  </SidebarMenuSubButton>
                                </SidebarMenuSubItem>
                              );
                            })}
                          </SidebarMenuSub>
                        </CollapsibleContent>
                      </SidebarMenuItem>
                    </Collapsible>
                  );
                }
                const isActive = location === entry.path;
                return (
                  <SidebarMenuItem key={entry.path}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => setLocation(entry.path)}
                      tooltip={entry.label}
                      data-pageid={entry.pageId}
                      className="sidebar-leaf-button h-11 transition-all duration-200 ease-out font-normal rounded-xl"
                      id={entry.id}
                    >
                      <entry.icon
                        className={`h-4 w-4 ${isActive ? "text-primary" : ""}`}
                      />
                      <span>{entry.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
              {visibleSidebarStructure.filter(e => !isHeading(e)).length ===
                0 &&
                !isCollapsed && (
                  <SidebarMenuItem>
                    <div className="px-3 py-6 text-center text-xs text-muted-foreground rounded-xl border border-dashed border-border/70">
                      找不到符合的頁面，請換個關鍵字試試。
                    </div>
                  </SidebarMenuItem>
                )}
            </SidebarMenu>
          </SidebarContent>

          <SidebarFooter className="p-3">
            {/* 背景任務面板 */}
            {!isCollapsed && <BackgroundTasksDrawer />}
            {!isCollapsed && (
              <Link
                href="/dashboard?section=credits"
                className="block cursor-pointer group"
                aria-label="查看積分說明"
              >
                <div className="glass-card-static quota-card-zen px-3 py-2.5 mb-2 text-center transition-colors group-hover:bg-accent/40">
                  <p className="hs-small !mb-0 text-muted-foreground tracking-wide uppercase">
                    剩餘配額
                  </p>
                  <p className="hs-h2 !mb-0 text-foreground tabular-nums mt-0.5">
                    {user?.remainingGenerations ?? 0}
                  </p>
                  <p className="hs-small !mb-0 text-muted-foreground/70 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    點擊查看積分說明
                  </p>
                </div>
              </Link>
            )}
            {/* 檢視模式按鈕已移除 — 功能保留在個人設定頁面，不需在側邊欄常駐 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-lg px-1.5 py-1.5 hover:bg-accent/50 transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]">
                  <Avatar className="h-10 w-10 border shrink-0">
                    <AvatarFallback className="text-sm font-medium bg-primary/10 text-primary">
                      {displayInitial}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p className="text-sm font-medium truncate leading-none text-foreground">
                      {displayName}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-1.5">
                      {user?.email || "-"}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel className="px-3 pb-1.5 pt-2">
                  <p className="text-sm font-medium truncate text-foreground">
                    {displayName}
                  </p>
                  <p className="text-xs font-normal text-muted-foreground truncate mt-0.5">
                    {user?.email || "-"}
                  </p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setLocation("/")}
                  className="cursor-pointer"
                >
                  <Home className="mr-2 h-4 w-4" />
                  <span>首頁</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setLocation("/settings")}
                  className="cursor-pointer"
                >
                  <Settings className="mr-2 h-4 w-4" />
                  <span>個人設定</span>
                </DropdownMenuItem>
                {isAdmin && (
                  <DropdownMenuItem
                    onClick={() => setLocation("/admin")}
                    className="cursor-pointer"
                  >
                    <Shield className="mr-2 h-4 w-4" />
                    <span>管理後台</span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => startTour("welcome", true)}
                  className="cursor-pointer"
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  <span>重新開始導覽</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={logout}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>登出</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>
        {/* ── Resize handle: mouse + touch, wider hit area ── */}
        {!isCollapsed && (
          <div
            className="absolute top-0 right-0 w-[6px] h-full cursor-col-resize group/resize-handle select-none touch-none"
            onMouseDown={startResize}
            onTouchStart={startResize}
            onDoubleClick={resetWidth}
            style={{ zIndex: 50 }}
            role="separator"
            aria-orientation="vertical"
            aria-label="調整側邊欄寬度（雙擊重設）"
            tabIndex={0}
            onKeyDown={e => {
              if (e.key === "Enter") resetWidth();
            }}
          >
            {/* Visual line — appears on hover / during resize */}
            <div
              className={`absolute inset-y-0 left-1/2 -translate-x-1/2 w-[2px] rounded-full transition-colors duration-200 ${
                isResizing
                  ? "bg-primary/40"
                  : "bg-transparent group-hover/resize-handle:bg-primary/20"
              }`}
            />
            {/* Grip dots — visible on hover */}
            <div
              className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 transition-opacity duration-200 ${
                isResizing
                  ? "opacity-60"
                  : "opacity-0 group-hover/resize-handle:opacity-40"
              }`}
            >
              <GripVertical className="w-3 h-3 text-muted-foreground" />
            </div>
          </div>
        )}
        {/* ── Width indicator tooltip during resize ── */}
        {isResizing && resizeDisplayWidth !== null && (
          <div
            className="fixed top-1/2 -translate-y-1/2 pointer-events-none z-[100] px-2 py-1 rounded-md bg-foreground/80 text-background text-xs font-mono tabular-nums shadow-lg"
            style={{ left: `${resizeDisplayWidth + 8}px` }}
          >
            {resizeDisplayWidth}px
          </div>
        )}
      </div>

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

        {isMobile && (
          <div
            className="flex border-b h-14 items-center justify-between px-3 shrink-0 sticky top-0 z-40"
            style={{
              background: "rgba(245,243,240,0.92)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              paddingTop: "env(safe-area-inset-top, 0px)",
            }}
          >
            <div className="flex items-center gap-2.5">
              <SidebarTrigger className="h-10 w-10 rounded-lg bg-background" />
              {/* Truncate long page titles on narrow mobile screens to avoid pushing right controls off-screen */}
              <span className="tracking-tight text-foreground text-sm font-medium truncate max-w-[140px]">
                {activeMenuItem?.label ?? "AI Director"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {/* 檢視模式按鈕已移除 — 簡化行動端頂部列 */}
              {/* Quota badge */}
              <div className="flex items-center gap-1.5 bg-primary/10 rounded-lg px-2.5 py-1.5">
                <Zap className="w-3.5 h-3.5 text-primary" />
                <span className="text-xs font-semibold text-primary tabular-nums">
                  {user?.remainingGenerations ?? 0}
                </span>
              </div>
              {/* User avatar dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    aria-label="使用者選單"
                    className="h-10 w-10 rounded-full border flex items-center justify-center bg-primary/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="text-sm font-medium text-primary">
                      {displayInitial}
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52 sm:w-56">
                  <div className="px-3 py-2 border-b mb-1">
                    <p className="text-sm font-medium truncate">
                      {displayName}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {user?.email || "-"}
                    </p>
                  </div>
                  <DropdownMenuItem
                    onClick={() => setLocation("/")}
                    className="cursor-pointer h-10"
                  >
                    <Home className="mr-2 h-4 w-4" />
                    <span>首頁</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setLocation("/settings")}
                    className="cursor-pointer h-10"
                  >
                    <Settings className="mr-2 h-4 w-4" />
                    <span>個人設定</span>
                  </DropdownMenuItem>
                  {isAdmin && (
                    <DropdownMenuItem
                      onClick={() => setLocation("/admin")}
                      className="cursor-pointer h-10"
                    >
                      <Shield className="mr-2 h-4 w-4" />
                      <span>管理後台</span>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onClick={() => startTour("welcome", true)}
                    className="cursor-pointer h-10"
                  >
                    <Sparkles className="mr-2 h-4 w-4" />
                    <span>重新開始導覽</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={logout}
                    className="cursor-pointer text-destructive focus:text-destructive h-10"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>登出</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        )}
        <main
          id="main-content"
          tabIndex={-1}
          className={`relative flex-1 overflow-y-auto ${
            settings.compactMode ? "p-3 sm:p-4 lg:p-5" : "p-4 sm:p-6 lg:p-8"
          } pb-safe-area-inset-bottom focus:outline-none`}
          data-scroll-area
          style={{
            paddingBottom: settings.compactMode
              ? "calc(1rem + env(safe-area-inset-bottom, 0px))"
              : "calc(2rem + env(safe-area-inset-bottom, 0px))",
          }}
        >
          {/* GlobalPageHint 已移除 — 操作提示功能已由光球助手替代，減少頁面雜訊 */}
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
