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
  Palette,
  FolderOpen,
  ListChecks,
  Coins,
  Monitor,
  Brain,
  Music,
  GripVertical,
  Bot,
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
  useMemo,
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
import AgentFocusSpotlight from "./AgentFocusSpotlight";
import {
  getSidebarGroups,
  type AppPageRegistryItem,
} from "@/config/appRegistry";
import { usePersonalSettings } from "@/contexts/PersonalSettingsContext";

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

const sidebarIconByPageId: Record<string, LucideIcon> = {
  "agent-chat": Bot,
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

const groupIconByName: Record<string, LucideIcon> = {
  專業創作室: Palette,
  素材與模型: FolderOpen,
  規劃筆記: StickyNote,
  數據洞察: BarChart3,
};

const sidebarGroupsFromRegistry = getSidebarGroups();
const sidebarPagesById = new Map(
  sidebarGroupsFromRegistry.flatMap(group =>
    group.pages.map(page => [page.id, page])
  )
);

const toLeafItem = (page: AppPageRegistryItem): SidebarLeafItem => ({
  icon: sidebarIconByPageId[page.id] ?? BookOpen,
  label: page.label,
  path: page.path,
  id: `sidebar-${page.id}-link`,
});

const createGroupEntry = (
  label: string,
  pageIds: string[]
): SidebarGroupItem => ({
  icon: groupIconByName[label] ?? FolderOpen,
  label,
  children: pageIds
    .map(id => sidebarPagesById.get(id))
    .filter((page): page is AppPageRegistryItem => Boolean(page))
    .map(toLeafItem),
});

const sidebarStructure: SidebarEntry[] = ["agent-chat", "studio", "director"]
  .map(id => sidebarPagesById.get(id))
  .filter((page): page is AppPageRegistryItem => Boolean(page))
  .map(toLeafItem);

sidebarStructure.splice(
  2,
  0,
  createGroupEntry("專業創作室", ["image-studio", "video-studio", "pro-studio"])
);
sidebarStructure.push(
  createGroupEntry("素材與模型", [
    "assets",
    "history",
    "prompt-library",
    "shared",
    "models",
    "lora-trainer",
    "vault",
    "background-tasks",
  ])
);
sidebarStructure.push(createGroupEntry("規劃筆記", ["notes", "calendar"]));
sidebarStructure.push(
  createGroupEntry("數據洞察", ["dashboard", "credits", "langsmith"])
);
for (const tailId of ["learn", "feedback", "settings"]) {
  const page = sidebarPagesById.get(tailId);
  if (page) {
    sidebarStructure.push(toLeafItem(page));
  }
}

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
  const activeMenuItem = [...flatMenuItems, ...adminItems].find(
    item => item.path === location
  );
  const isMobile = useIsMobile();
  const { viewMode } = useViewMode();
  const normalizedSidebarQuery = sidebarQuery.trim().toLowerCase();
  const visibleSidebarStructure = useMemo<SidebarEntry[]>(() => {
    if (!normalizedSidebarQuery) return sidebarStructure;

    return sidebarStructure
      .map(entry => {
        if (!isGroup(entry)) {
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
            {!isCollapsed && (
              <div className="px-3 pt-2 pb-1">
                <div className="rounded-xl border border-border/70 bg-background/70 px-2.5 py-2">
                  <input
                    value={sidebarQuery}
                    onChange={e => setSidebarQuery(e.target.value)}
                    placeholder="搜尋側邊欄功能..."
                    className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground/80"
                    aria-label="搜尋側邊欄功能"
                  />
                </div>
              </div>
            )}
            <SidebarMenu className="px-2 py-1" id="sidebar-nav">
              {visibleSidebarStructure.map(entry => {
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
                            className="h-10 transition-all font-normal rounded-xl"
                          >
                            <entry.icon className="h-4 w-4" />
                            <span>{entry.label}</span>
                            <span className="ml-1 text-[10px] text-muted-foreground">
                              {entry.children.length}
                            </span>
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
                      className="h-10 transition-all font-normal rounded-xl"
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
                        className="h-10 transition-all font-normal rounded-xl"
                      >
                        <item.icon
                          className={`h-4 w-4 ${isActive ? "text-primary" : ""}`}
                        />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              {visibleSidebarStructure.length === 0 && !isCollapsed && (
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
            {!isCollapsed && (
              <button
                onClick={() => setLocation("/settings")}
                className="w-full flex items-center justify-between px-2 py-1.5 mb-1 rounded-lg bg-muted/40 hover:bg-muted/60 transition-colors"
              >
                <span className="hs-small !mb-0 text-muted-foreground">
                  檢視模式：
                  {viewMode === "auto"
                    ? "自動"
                    : viewMode === "desktop"
                      ? "桌機"
                      : "行動"}
                </span>
                <span className="text-[11px] text-muted-foreground/80">
                  到個人設定調整
                </span>
              </button>
            )}
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
              <button
                onClick={() => setLocation("/settings")}
                className="h-9 px-2 rounded-lg flex items-center justify-center bg-muted/60 hover:bg-muted transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="前往個人設定調整檢視模式"
                title="到個人設定調整檢視模式"
              >
                <Monitor className="w-4 h-4 text-muted-foreground mr-1" />
                <span className="text-[11px] text-muted-foreground">
                  {viewMode === "auto"
                    ? "自動"
                    : viewMode === "desktop"
                      ? "桌機"
                      : "行動"}
                </span>
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
                      {displayInitial}
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
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
          className={`relative flex-1 overflow-y-auto ${
            settings.compactMode ? "p-3 sm:p-4 lg:p-5" : "p-4 sm:p-6 lg:p-8"
          } pb-safe-area-inset-bottom`}
          data-scroll-area
          style={{
            paddingBottom: settings.compactMode
              ? "calc(1rem + env(safe-area-inset-bottom, 0px))"
              : "calc(2rem + env(safe-area-inset-bottom, 0px))",
          }}
        >
          <GlobalPageHint />
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
