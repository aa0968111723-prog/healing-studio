import { useAuth } from "@/_core/hooks/useAuth";
import VisualSoul from "@/components/VisualSoul";
import { AvatarRenderer } from "@/components/AvatarStudio";
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
} from "@/components/ui/sidebar";
import BackgroundTasksDrawer from "./BackgroundTasksDrawer";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronRight } from "lucide-react";
import { getLoginUrl, getDemoLoginUrl } from "@/const";
import LocalAuthForm from "@/components/LocalAuthForm";
import { useIsMobile } from "@/hooks/useMobile";
import {
  Wand2,
  Clapperboard,
  Cpu,
  BarChart3,
  Shield,
  LogOut,
  Home,
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
import { Suspense, useCallback, useEffect } from "react";
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
import AppleDock, { type DockEntry, type DockLeaf } from "./AppleDock";


type SidebarLeafItem = DockLeaf;

type SidebarGroupItem = {
  kind: "group";
  icon: LucideIcon;
  label: string;
  children: SidebarLeafItem[];
};

type SidebarEntry = DockEntry;

function isGroup(entry: SidebarEntry): entry is SidebarGroupItem {
  return entry.kind === "group";
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

const flatMenuItems: SidebarLeafItem[] = sidebarStructure.flatMap(entry => {
  if (isGroup(entry)) return entry.children;
  if (isLeaf(entry)) return [entry];
  return [];
});

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
  const activeMenuItem = flatMenuItems.find(item => item.path === location);
  const isMobile = useIsMobile();

  const isAdmin = user?.role === "admin";
  const displayName = settings.displayName.trim() || user?.name || "使用者";
  const displayInitial = displayName.charAt(0).toUpperCase() || "U";

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

  return (
    <>
      {/* ── Apple-style floating dock (desktop / tablet) ── */}
      {!isMobile && (
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
        />
      )}

      {/* ── Mobile sidebar drawer (Sheet) — opened by SidebarTrigger in top bar ── */}
      {isMobile && (
        <Sidebar collapsible="offcanvas" className="border-r-0">
          <SidebarHeader className="h-14 justify-center">
            <div className="flex items-center gap-2 px-2">
              <span className="font-semibold tracking-tight text-foreground text-sm">
                AI Director
              </span>
            </div>
          </SidebarHeader>
          <SidebarContent className="gap-0">
            <SidebarMenu
              className="px-2 py-0.5 gap-0.5"
              role="navigation"
              aria-label="主導覽"
            >
              {sidebarStructure.map(entry => {
                if (entry.kind === "group") {
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
                          <SidebarMenuButton className="h-10 font-normal rounded-xl">
                            <entry.icon
                              className={`h-4 w-4 ${hasActiveChild ? "text-primary" : ""}`}
                            />
                            <span>{entry.label}</span>
                            <ChevronRight className="ml-auto h-4 w-4 transition-transform duration-300 group-data-[state=open]/collapsible:rotate-90" />
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
                      className="h-10 font-normal rounded-xl"
                    >
                      <entry.icon
                        className={`h-4 w-4 ${isActive ? "text-primary" : ""}`}
                      />
                      <span>{entry.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarContent>
          <SidebarFooter className="px-3 py-2 gap-1.5">
            <BackgroundTasksDrawer />
          </SidebarFooter>
        </Sidebar>
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
              <span className="tracking-tight text-foreground text-sm font-medium truncate max-w-[140px]">
                {activeMenuItem?.label ?? "AI Director"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 bg-primary/10 rounded-lg px-2.5 py-1.5">
                <Zap className="w-3.5 h-3.5 text-primary" />
                <span className="text-xs font-semibold text-primary tabular-nums">
                  {user?.remainingGenerations ?? 0}
                </span>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    aria-label="使用者選單"
                    className="h-10 w-10 rounded-full overflow-hidden border focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <AvatarRenderer
                      avatarUrl={user?.avatarUrl ?? null}
                      fallback={displayInitial}
                      className="h-10 w-10"
                    />
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
                    onClick={handleRestartWelcomeTour}
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
          } ${!isMobile ? "md:pl-24" : ""} pb-safe-area-inset-bottom focus:outline-none`}
          data-scroll-area
          style={{
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
