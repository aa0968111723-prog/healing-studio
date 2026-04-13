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
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { getLoginUrl, getDemoLoginUrl } from "@/const";
import { useIsMobile } from "@/hooks/useMobile";
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
  Sparkles,
  Image,
  Clock,
  Package,
  Layers,
  MessageSquare,
  Zap,
  Film,
  BookOpen,
} from "lucide-react";
import { useSiteOnboarding, type PageId } from "@/contexts/SiteOnboardingContext";
import { CSSProperties, memo, useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Button } from "./ui/button";
import VisualSoul from "./VisualSoul";
import { useAIState } from "@/contexts/AIStateContext";
import ProactiveOrbWidget from "./ProactiveOrbWidget";

// Isolated component that subscribes to AI state —
// prevents the entire DashboardLayout from re-rendering when aiState/personality change.
const SidebarVisualSoul = memo(function SidebarVisualSoul() {
  const { aiState, personality } = useAIState();
  return <VisualSoul size="sm" state={aiState} personality={personality} />;
});

const menuItems = [
  { icon: Wand2, label: "創作工作室", path: "/studio",       id: "sidebar-studio-link" },
  { icon: Sparkles, label: "音樂配音創作室", path: "/pro-studio", id: "sidebar-pro-studio-link" },
  { icon: Image, label: "圖片創作室", path: "/image-studio", id: "sidebar-image-studio-link" },
  { icon: Film, label: "影片工作室", path: "/video-studio", id: "sidebar-video-studio-link" },
  { icon: Clapperboard, label: "導演 AI", path: "/director", id: "sidebar-director-link" },
  { icon: Cpu, label: "角色鍛造所", path: "/models",                     id: "sidebar-models-link" },
  { icon: Clock, label: "生成歷史", path: "/history",                     id: "sidebar-history-link" },
  { icon: Package, label: "數位資產庫", path: "/assets",                 id: "sidebar-assets-link" },
  { icon: Layers, label: "一致性保險庫", path: "/vault",                 id: "sidebar-vault-link" },
  { icon: StickyNote, label: "專案筆記", path: "/notes",                 id: "sidebar-notes-link" },
  { icon: CalendarDays, label: "創作排程", path: "/calendar",           id: "sidebar-calendar-link" },
  { icon: Users, label: "共享空間", path: "/shared",                     id: "sidebar-shared-link" },
  { icon: BarChart3, label: "儀表板", path: "/dashboard",               id: "sidebar-dashboard-link" },
  { icon: MessageSquare, label: "回饋中心", path: "/feedback",           id: "sidebar-feedback-link" },
  { icon: BookOpen, label: "學習文件", path: "/learn",                   id: "sidebar-learn-link" },
  { icon: Settings, label: "個人設定", path: "/settings",               id: "sidebar-settings-link" },
];

const adminItems = [
  { icon: Shield, label: "管理後台", path: "/admin" },
];

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 200;
const MAX_WIDTH = 400;

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
      <div className="flex items-center justify-center min-h-screen" style={{ background: "linear-gradient(135deg, #F5F3F0 0%, #EAC9C1 30%, #D4C5E2 70%, #C8D5E0 100%)" }}>
        <div className="glass-card p-10 max-w-md w-full mx-4 text-center">
          <div className="flex justify-center mb-6">
            <VisualSoul size="lg" state="idle" personality="creative" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            AI Director 創作平台
          </h1>
          <p className="text-sm text-muted-foreground mt-3 max-w-sm mx-auto">
            登入後即可使用 AI Director 智慧創作平台
          </p>
          <Button
            onClick={() => { window.location.href = getLoginUrl(); }}
            size="lg"
            className="w-full mt-8 h-12 rounded-xl shadow-md hover:shadow-lg transition-all"
          >
            Google 登入
          </Button>
          <Button
            onClick={() => { window.location.href = getDemoLoginUrl(); }}
            variant="outline"
            size="lg"
            className="w-full mt-3 h-12 rounded-xl border-dashed border-muted-foreground/30 hover:bg-muted/40 transition-all"
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
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
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
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const activeMenuItem = [...menuItems, ...adminItems].find(
    (item) => item.path === location
  );
  const isMobile = useIsMobile();

  const allItems = user?.role === "admin" ? [...menuItems, ...adminItems] : menuItems;

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

  useEffect(() => {
    // Throttle mousemove to ~60fps to avoid excessive re-renders during resize
    let rafId: number | null = null;
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      if (rafId !== null) return; // skip if a frame is already scheduled
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
        const newWidth = e.clientX - sidebarLeft;
        if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
          setSidebarWidth(newWidth);
        }
      });
    };
    const handleMouseUp = () => setIsResizing(false);
    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar
          collapsible="icon"
          className="border-r-0"
          disableTransition={isResizing}
        >
          <SidebarHeader className="h-16 justify-center">
            <div className="flex items-center gap-3 px-2 transition-all w-full">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
                aria-label="切換導覽列"
              >
                <PanelLeft className="h-4 w-4 text-muted-foreground" />
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
              {allItems.map((item) => {
                const isActive = location === item.path;
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => setLocation(item.path)}
                      tooltip={item.label}
                      className="h-10 transition-all font-normal"
                      id={(item as any).id}
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
            {!isCollapsed && (
              <div className="glass-card-static px-3 py-2.5 mb-2 text-center">
                <p className="text-[11px] text-muted-foreground tracking-wide uppercase">剩餘配額</p>
                <p className="text-xl font-semibold text-foreground tabular-nums mt-0.5">
                  {user?.remainingGenerations ?? 0}
                </p>
              </div>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-lg px-1 py-1 hover:bg-accent/50 transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Avatar className="h-9 w-9 border shrink-0">
                    <AvatarFallback className="text-xs font-medium bg-primary/10 text-primary">
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
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => { if (!isCollapsed) setIsResizing(true); }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset className="flex flex-col min-h-0 overflow-hidden">
        {isMobile && (
          <div className="flex border-b h-14 items-center justify-between px-2 shrink-0 sticky top-0 z-40"
            style={{ background: "rgba(245,243,240,0.92)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}
          >
            <div className="flex items-center gap-2">
              <SidebarTrigger className="h-9 w-9 rounded-lg bg-background" />
              <span className="tracking-tight text-foreground text-sm font-medium">
                {activeMenuItem?.label ?? "AI Director"}
              </span>
            </div>
            <div className="flex items-center gap-2 pr-1">
              {/* Quota badge */}
              <div className="flex items-center gap-1 bg-primary/10 rounded-lg px-2 py-1">
                <Zap className="w-3 h-3 text-primary" />
                <span className="text-xs font-semibold text-primary tabular-nums">
                  {user?.remainingGenerations ?? 0}
                </span>
              </div>
              {/* User avatar dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="h-8 w-8 rounded-full border flex items-center justify-center bg-primary/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="text-xs font-medium text-primary">
                      {user?.name?.charAt(0).toUpperCase() || "U"}
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <div className="px-2 py-1.5 border-b mb-1">
                    <p className="text-xs font-medium truncate">{user?.name || "使用者"}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{user?.email || "-"}</p>
                  </div>
                  <DropdownMenuItem onClick={() => setLocation("/")} className="cursor-pointer">
                    <Home className="mr-2 h-4 w-4" />
                    <span>首頁</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={logout} className="cursor-pointer text-destructive focus:text-destructive">
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>登出</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        )}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 pb-safe-area-inset-bottom" style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom, 0px))" }}>{children}</main>
      </SidebarInset>

      {/* 全站光球常駐協助（Studio 頁面內已有自己的光球，不需要重複） */}
      {user && location !== "/studio" && (
        <ProactiveOrbWidget
          onRestartTour={() => {
            // 根據當前路徑尋找對應的 pageId
            const pathToPageId: Record<string, PageId> = {
              "/pro-studio":   "pro-studio",
              "/image-studio": "image-studio",
              "/video-studio": "video-studio",
              "/director":     "director",
              "/models":       "models",
              "/history":      "history",
              "/assets":       "assets",
              "/vault":        "vault",
              "/notes":        "notes",
              "/calendar":     "calendar",
              "/shared":       "shared",
              "/dashboard":    "dashboard",
              "/feedback":     "feedback",
              "/settings":     "settings",
              "/settings/ai-brain": "settings",
              "/learn":        "learn",
            };
            const pageId = pathToPageId[location] ?? "welcome";
            window.dispatchEvent(new CustomEvent("site-tour-start", { detail: { pageId } }));
          }}
          onSaveToNotes={(payload) => {
            window.dispatchEvent(new CustomEvent("pin-to-notes", { detail: payload }));
          }}
          onOpenNotes={() => {
            window.dispatchEvent(new CustomEvent("open-notes-drawer"));
          }}
          onOpenCalendar={() => {
            window.dispatchEvent(new CustomEvent("navigate-to", { detail: "/calendar" }));
          }}
          onAddToCalendar={(payload) => {
            window.dispatchEvent(new CustomEvent("add-to-calendar", { detail: payload }));
          }}
        />
      )}
    </>
  );
}
