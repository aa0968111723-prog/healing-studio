import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  Leaf,
  Radar,
  ChevronRight,
  Palette,
  FolderOpen,
  ListChecks,
  Coins,
  Monitor,
  Smartphone,
  Brain,
  Music,
  GripVertical,
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
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link, useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Button } from "./ui/button";
import VisualSoul from "./VisualSoul";
import { useAIState } from "@/contexts/AIStateContext";
import ProactiveOrbWidget from "./ProactiveOrbWidget";
import AgentIntentPreview from "./AgentIntentPreview";

// Isolated component that subscribes to AI state —
// prevents the entire DashboardLayout from re-rendering when aiState/personality change.
const SidebarVisualSoul = memo(function SidebarVisualSoul() {
  const { aiState, personality } = useAIState();
  return <VisualSoul size="sm" state={aiState} personality={personality} />;
});

type SidebarLeafItem = {
  icon: LucideIcon;
  label: string;
  path: string;
  id: string;
};

type SidebarGroupItem = {
  icon: LucideIcon;
  label: string;
  children: SidebarLeafItem[];
};

type SidebarEntry = SidebarLeafItem | SidebarGroupItem;

function isGroup(entry: SidebarEntry): entry is SidebarGroupItem {
  return "children" in entry;
}

/**
 * Sidebar menu hierarchy — organised by healing-creative workflow:
 *
 *  ① 創作靈感 (Create)  — the core creative tools, top-level for quick access
 *  ② 素材與模型 (Assets & Models) — manage what you've made / trained
 *  ③ 規劃筆記 (Plan & Organise) — notes, calendar, focus flow
 *  ④ 數據洞察 (Insights) — dashboard, monitoring, credits
 *  ⑤ 學習成長 (Learn & Grow) — docs, feedback
 *  ⑥ 設定 (Settings) — personal settings (bottom)
 */
const sidebarStructure: SidebarEntry[] = [
  // ─── ① 創作靈感 ───────────────────────────────────
  {
    icon: Wand2,
    label: "創作工作室",
    path: "/studio",
    id: "sidebar-studio-link",
  },
  {
    icon: Palette,
    label: "專業創作室",
    children: [
      {
        icon: Image,
        label: "圖片創作室",
        path: "/image-studio",
        id: "sidebar-image-studio-link",
      },
      {
        icon: Film,
        label: "影片創作室",
        path: "/video-studio",
        id: "sidebar-video-studio-link",
      },
      {
        icon: Music,
        label: "音樂配音創作室",
        path: "/pro-studio",
        id: "sidebar-pro-studio-link",
      },
    ],
  },
  {
    icon: Clapperboard,
    label: "導演 AI",
    path: "/director",
    id: "sidebar-director-link",
  },

  // ─── ② 素材與模型 ─────────────────────────────────
  {
    icon: FolderOpen,
    label: "素材與模型",
    children: [
      {
        icon: Package,
        label: "數位資產庫",
        path: "/assets",
        id: "sidebar-assets-link",
      },
      {
        icon: Clock,
        label: "生成歷史",
        path: "/history",
        id: "sidebar-history-link",
      },
      {
        icon: BookMarked,
        label: "提示詞庫",
        path: "/prompt-library",
        id: "sidebar-prompt-library-link",
      },
      {
        icon: Users,
        label: "共享空間",
        path: "/shared",
        id: "sidebar-shared-link",
      },
      {
        icon: Cpu,
        label: "角色鍛造所",
        path: "/models",
        id: "sidebar-models-link",
      },
      {
        icon: Zap,
        label: "模型訓練中心",
        path: "/lora-trainer",
        id: "sidebar-lora-trainer-link",
      },
      {
        icon: Layers,
        label: "一致性保險庫",
        path: "/vault",
        id: "sidebar-vault-link",
      },
      {
        icon: ListChecks,
        label: "背景任務中心",
        path: "/background-tasks",
        id: "sidebar-background-tasks-link",
      },
    ],
  },

  // ─── ③ 規劃筆記 ───────────────────────────────────
  {
    icon: StickyNote,
    label: "規劃筆記",
    children: [
      {
        icon: StickyNote,
        label: "專案筆記",
        path: "/notes",
        id: "sidebar-notes-link",
      },
      {
        icon: CalendarDays,
        label: "創作排程",
        path: "/calendar",
        id: "sidebar-calendar-link",
      },
      {
        icon: Leaf,
        label: "專注流",
        path: "/focus-flow",
        id: "sidebar-focus-flow-link",
      },
    ],
  },

  // ─── ④ 數據洞察 ───────────────────────────────────
  {
    icon: BarChart3,
    label: "數據洞察",
    children: [
      {
        icon: BarChart3,
        label: "儀表板",
        path: "/dashboard",
        id: "sidebar-dashboard-link",
      },
      {
        icon: Radar,
        label: "AI 監控中心",
        path: "/langsmith",
        id: "sidebar-langsmith-link",
      },
      {
        icon: Coins,
        label: "積分說明",
        path: "/credits",
        id: "sidebar-credits-link",
      },
    ],
  },

  // ─── ⑤ 學習成長 ───────────────────────────────────
  {
    icon: BookOpen,
    label: "學習文件中心",
    path: "/learn",
    id: "sidebar-learn-link",
  },
  {
    icon: MessageSquare,
    label: "回饋中心",
    path: "/feedback",
    id: "sidebar-feedback-link",
  },

  // ─── ⑥ 設定 ──────────────────────────────────────
  {
    icon: Settings,
    label: "個人設定",
    path: "/settings",
    id: "sidebar-settings-link",
  },
];

/** Flat list of all navigable items (for lookups like active-page label) */
const flatMenuItems: SidebarLeafItem[] = sidebarStructure.flatMap(entry =>
  isGroup(entry) ? entry.children : [entry]
);

const adminItems = [
  { icon: Shield, label: "管理後台", path: "/admin" },
  { icon: Brain, label: "大腦組態", path: "/settings/ai-brain" },
];

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 200;
const MAX_WIDTH = 400;

/** Tablet breakpoint range — auto-collapse to icon mode */
const TABLET_MIN_PX = 768;
const TABLET_MAX_PX = 1024;

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
          <div className="flex justify-center mb-8">
            <VisualSoul size="xl" state="idle" personality="creative" />
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
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar, setOpen } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDisplayWidth, setResizeDisplayWidth] = useState<number | null>(
    null
  );
  const sidebarRef = useRef<HTMLDivElement>(null);
  const activeMenuItem = [...flatMenuItems, ...adminItems].find(
    item => item.path === location
  );
  const isMobile = useIsMobile();
  const { viewMode, setViewMode } = useViewMode();

  const isAdmin = user?.role === "admin";

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
      "/focus-flow": "focus-flow",
      "/langsmith": "langsmith",
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
      new CustomEvent("navigate-to", { detail: "/calendar" })
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
                  <SidebarVisualSoul />
                  <span className="font-semibold tracking-tight truncate text-foreground text-sm">
                    AI Director
                  </span>
                </div>
              )}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0">
            <SidebarMenu className="px-2 py-1" id="sidebar-nav">
              {sidebarStructure.map(entry => {
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
                            className="h-10 transition-all font-normal"
                          >
                            <entry.icon className="h-4 w-4" />
                            <span>{entry.label}</span>
                            <ChevronRight className="ml-auto h-4 w-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
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
                                    className="cursor-pointer"
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
                      className="h-10 transition-all font-normal"
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
              {isAdmin &&
                adminItems.map(item => {
                  const isActive = location === item.path;
                  return (
                    <SidebarMenuItem key={item.path}>
                      <SidebarMenuButton
                        isActive={isActive}
                        onClick={() => setLocation(item.path)}
                        tooltip={item.label}
                        className="h-10 transition-all font-normal"
                      >
                        <item.icon
                          className={`h-4 w-4 ${isActive ? "text-primary" : ""}`}
                        />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
            </SidebarMenu>
          </SidebarContent>

          <SidebarFooter className="p-3">
            {/* 背景任務面板 */}
            {!isCollapsed && <BackgroundTasksDrawer />}
            {!isCollapsed && (
              <Link
                href="/credits"
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
            {/* Desktop/Mobile view toggle */}
            {!isCollapsed && (
              <div className="flex items-center justify-between px-1 py-1.5 mb-1 rounded-lg bg-muted/40">
                <span className="hs-small !mb-0 text-muted-foreground ml-1">
                  檢視模式
                </span>
                <div className="flex gap-0.5">
                  <button
                    onClick={() => setViewMode("auto")}
                    className={`h-7 px-2 rounded-md text-[11px] font-medium transition-colors ${viewMode === "auto" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                    title="自動"
                  >
                    自動
                  </button>
                  <button
                    onClick={() => setViewMode("desktop")}
                    className={`h-7 w-7 rounded-md flex items-center justify-center transition-colors ${viewMode === "desktop" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                    title="電腦版"
                  >
                    <Monitor className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setViewMode("mobile")}
                    className={`h-7 w-7 rounded-md flex items-center justify-center transition-colors ${viewMode === "mobile" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                    title="行動版"
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-lg px-1.5 py-1.5 hover:bg-accent/50 transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]">
                  <Avatar className="h-10 w-10 border shrink-0">
                    <AvatarFallback className="text-sm font-medium bg-primary/10 text-primary">
                      {user?.name?.charAt(0).toUpperCase() || "U"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p className="text-sm font-medium truncate leading-none text-foreground">
                      {user?.name || "使用者"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-1.5">
                      {user?.email || "-"}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onClick={() => setLocation("/")}
                  className="cursor-pointer"
                >
                  <Home className="mr-2 h-4 w-4" />
                  <span>首頁</span>
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
              {/* View mode toggle: desktop/mobile */}
              <button
                onClick={() =>
                  setViewMode(viewMode === "desktop" ? "auto" : "desktop")
                }
                className="h-9 w-9 rounded-lg flex items-center justify-center bg-muted/60 hover:bg-muted transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={
                  viewMode === "desktop" ? "切換行動版" : "切換電腦版"
                }
                title={viewMode === "desktop" ? "切換回行動版" : "切換至電腦版"}
              >
                {viewMode === "desktop" ? (
                  <Smartphone className="w-4 h-4 text-primary" />
                ) : (
                  <Monitor className="w-4 h-4 text-muted-foreground" />
                )}
              </button>
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
                      {user?.name?.charAt(0).toUpperCase() || "U"}
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <div className="px-3 py-2 border-b mb-1">
                    <p className="text-sm font-medium truncate">
                      {user?.name || "使用者"}
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
          className="relative flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 pb-safe-area-inset-bottom"
          data-scroll-area
          style={{
            paddingBottom: "calc(2rem + env(safe-area-inset-bottom, 0px))",
          }}
        >
          {children}
        </main>
      </SidebarInset>

      {/* 全站光球常駐協助（Studio 頁面內已有自己的光球，不需要重複） */}
      {user && (
        <>
          <ProactiveOrbWidget
            onRestartTour={handleOrbRestartTour}
            onSaveToNotes={handleOrbSaveToNotes}
            onOpenNotes={handleOrbOpenNotes}
            onOpenCalendar={handleOrbOpenCalendar}
            onAddToCalendar={handleOrbAddToCalendar}
            onNavigate={(path) => setLocation(path)}
          />
          {/* Phase 1.5：破壞性動作執行前的柔軟確認卡片 */}
          <AgentIntentPreview />
        </>
      )}
    </>
  );
}
