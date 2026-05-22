import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Suspense, useEffect } from "react";
import { lazyWithRetry as lazy } from "@/lib/lazyWithRetry";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { NotesDrawerProvider } from "./contexts/NotesDrawerContext";
import { AssetsDrawerProvider } from "./contexts/AssetsDrawerContext";
import { PersonalityProvider } from "./contexts/PersonalityContext";
import DashboardLayout from "./components/DashboardLayout";
import ProjectNotesDrawer from "./components/ProjectNotesDrawer";
import AssetsQuickDrawer from "./components/AssetsQuickDrawer";
import OfflineBanner from "./components/OfflineBanner";
import AuthExpiredModal from "./components/AuthExpiredModal";
import LoginOrbAnimation from "./components/LoginOrbAnimation";
import { ShowcaseTransferProvider } from "./contexts/ShowcaseTransferContext";
import { SiteOnboardingProvider } from "./contexts/SiteOnboardingContext";
import { FocusFlowProvider } from "./contexts/FocusFlowContext";
import { AmbientProvider } from "./contexts/AmbientSoundContext";
import { OrbGuideProvider } from "./contexts/OrbGuideContext";
import { PageAgentProvider } from "./contexts/PageAgentContext";
import { GlobalOrbChatProvider } from "./contexts/GlobalOrbChatContext";
import { OrbStateProvider } from "./contexts/OrbStateContext";
import { PersonalSettingsProvider } from "./contexts/PersonalSettingsContext";
import { IntentCardProvider } from "./contexts/IntentCardContext";
import { WorldContextProvider } from "./contexts/WorldContextContext";
import { ProjectsProvider } from "./contexts/ProjectsContext";
import SkipToContent from "./components/SkipToContent";
import RouteTransition from "./components/RouteTransition";
const SiteOnboardingOverlay = lazy(
  () => import("./components/SiteOnboardingOverlay")
);
const CommandPalette = lazy(() => import("./components/CommandPalette"));

// ─── 首頁直接載入（不延遲，確保首屏最快） ─────────────────────────────────
import Home from "./pages/Home";

// ─── 其他頁面使用 lazy() 延遲載入，按需拆分 bundle ────────────────────────
const CreationHub = lazy(() => import("./pages/CreationHub"));
const Playground = lazy(() => import("./pages/Playground"));
const Studio = lazy(() => import("./pages/Studio"));
const DirectorAI = lazy(() => import("./pages/DirectorAI"));
const AnimationStudio = lazy(() => import("./pages/AnimationStudio"));
const AssetsLibrary = lazy(() => import("./pages/AssetsLibrary"));
const ModelsPage = lazy(() => import("./pages/ModelsPage"));
const NotesPage = lazy(() => import("./pages/NotesPage"));
const CalendarPage = lazy(() => import("./pages/CalendarPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const FeedbackPage = lazy(() => import("./pages/FeedbackPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const AgentPreferencesPage = lazy(() => import("./pages/settings/AgentPreferencesPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const ProStudio = lazy(() => import("./pages/ProStudio"));
const ImageStudio = lazy(() => import("./pages/ImageStudio"));
const VideoStudio = lazy(() => import("./pages/VideoStudio"));
const LightOrbCreationStudio = lazy(() => import("./pages/LightOrbCreationStudio"));
const LearnHub = lazy(() => import("./pages/LearnHub"));
const AIModelsHub = lazy(() => import("./pages/AIModelsHub"));
const ModelWishlistPage = lazy(() => import("./pages/ModelWishlistPage"));
const TutorialOverviewPage = lazy(() => import("./pages/TutorialOverviewPage"));
const LoraTrainer = lazy(() => import("./pages/LoraTrainer"));
const FocusFlowPage = lazy(() => import("./pages/FocusFlowPage"));
const AgentChat = lazy(() => import("./pages/AgentChat"));
const AdminApiUsagePage = lazy(() => import("./pages/AdminApiUsagePage"));
const AiBrainPipelinePage = lazy(() => import("./pages/AiBrainPipelinePage"));
const MyBrainPage = lazy(() => import("./pages/MyBrainPage"));
const ForgotPasswordPage = lazy(() => import("./pages/ForgotPasswordPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const AccountSettingsPage = lazy(() => import("./pages/AccountSettingsPage"));
const ProcessViewerPage = lazy(() => import("./pages/ProcessViewerPage"));
const AgentCodexPage = lazy(() => import("./pages/AgentCodexPage"));
const SharedSpace = lazy(() => import("./pages/SharedSpace"));
const TeachingArchive = lazy(() => import("./pages/TeachingArchive"));
const TeamsPage = lazy(() => import("./pages/TeamsPage"));
const CreativeProjectPage = lazy(() => import("./pages/CreativeProjectPage"));
const ProjectsListPage = lazy(() => import("./pages/ProjectsListPage"));
const ProjectDetailPage = lazy(() => import("./pages/ProjectDetailPage"));

import { Skeleton } from "@/components/ui/skeleton";

// ─── 頁面載入中的通用 Skeleton ─────────────────────────────────────────────
function PageSkeleton() {
  return (
    <div className="flex-1 p-6 sm:p-8 space-y-6 w-full animate-in fade-in duration-500">
      <div className="flex items-center gap-4 mb-8">
        <Skeleton className="h-12 w-12 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Skeleton className="h-48 rounded-2xl glass-card-static" />
        <Skeleton className="h-48 rounded-2xl glass-card-static" />
        <Skeleton className="h-48 rounded-2xl glass-card-static" />
      </div>
      <Skeleton className="h-64 mt-6 w-full rounded-2xl glass-card-static" />
    </div>
  );
}

// ─── 路由包裝元件 ─────────────────────────────────────────────────────────

function NavigateRedirect({ to }: { to: string }) {
  const [, navigate] = useLocation();
  useEffect(() => { navigate(to, { replace: true }); }, [navigate, to]);
  return null;
}

function DashboardRoute({
  component: Component,
}: {
  component: React.ComponentType;
}) {
  return (
    <DashboardLayout>
      <Suspense fallback={<PageSkeleton />}>
        <RouteTransition>
          <Component />
        </RouteTransition>
      </Suspense>
    </DashboardLayout>
  );
}


function StandaloneProtectedRoute({
  component: Component,
}: {
  component: React.ComponentType;
}) {
  const { loading, isAuthenticated } = useAuth();

  if (loading) return <PageSkeleton />;
  if (!isAuthenticated) {
    if (typeof window !== "undefined") window.location.href = getLoginUrl();
    return null;
  }

  return (
    <ErrorBoundary inline>
      <Suspense fallback={<PageSkeleton />}>
        <RouteTransition>
          <Component />
        </RouteTransition>
      </Suspense>
    </ErrorBoundary>
  );
}

function ProtectedDashboardRoute({
  component: Component,
}: {
  component: React.ComponentType;
}) {
  return (
    <DashboardLayout>
      <ErrorBoundary inline>
        <Suspense fallback={<PageSkeleton />}>
          <RouteTransition>
            <Component />
          </RouteTransition>
        </Suspense>
      </ErrorBoundary>
    </DashboardLayout>
  );
}

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  oauth_config_error: "Google 登入未設定，請聯繫管理員。",
  auth_denied: "您已取消 Google 授權，請重試。",
  missing_code: "Google 登入流程異常，請重試。",
  missing_google_user_id: "無法取得 Google 帳號資訊，請重試。",
  oauth_failed: "Google 登入失敗，請稍後再試。",
  oauth_token_exchange_failed:
    "Google 暫時無法回應，可能是網路或設定問題，請稍後再試。",
  oauth_userinfo_failed: "無法從 Google 取得個人資料，請重新登入。",
  oauth_db_error: "登入時資料庫忙線，請稍後再試。",
  oauth_redirect_mismatch:
    "Google 登入網址未授權，請聯繫管理員確認 OAuth 設定。",
  demo_oauth_failed: "訪客登入失敗，請重新整理頁面。",
};

function OAuthErrorToast() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    if (!error) return;

    params.delete("error");
    const newSearch = params.toString();
    const newUrl =
      window.location.pathname +
      (newSearch ? `?${newSearch}` : "") +
      window.location.hash;
    window.history.replaceState({}, "", newUrl);

    // Don't blame Google for the demo flow when the demo path itself failed.
    const isDemo = error === "demo_oauth_failed";
    const message = OAUTH_ERROR_MESSAGES[error] ?? "登入失敗，請重試。";
    toast.error(isDemo ? "訪客登入失敗" : "Google 登入失敗", {
      description: message,
      duration: 6000,
    });
  }, []);

  return null;
}

// Redirect old standalone routes into the unified digital-asset page (/assets?section=...)
function AssetsRedirect({ section }: { section: string }) {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate(`/assets?section=${section}`, { replace: true });
  }, [navigate, section]);
  return null;
}

// Redirect /settings/ai-brain to /admin (大腦組態 is now a tab inside 管理後台)
function AdminRedirect() {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate("/admin", { replace: true });
  }, [navigate]);
  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/create">
        <StandaloneProtectedRoute component={CreationHub} />
      </Route>
      <Route path="/playground">
        <ProtectedDashboardRoute component={Playground} />
      </Route>
      <Route path="/studio">
        <ProtectedDashboardRoute component={Studio} />
      </Route>
      <Route path="/director">
        <ProtectedDashboardRoute component={DirectorAI} />
      </Route>
      <Route path="/creative-projects">
        <ProtectedDashboardRoute component={CreativeProjectPage} />
      </Route>
      {/* Step 3 creation-hub project skeleton — list + detail placeholder.
          Lives alongside /creative-projects (legacy world-builder console)
          while we figure out how the two converge. */}
      <Route path="/projects">
        <ProtectedDashboardRoute component={ProjectsListPage} />
      </Route>
      <Route path="/projects/:id">
        <ProtectedDashboardRoute component={ProjectDetailPage} />
      </Route>
      <Route path="/animation">
        <ProtectedDashboardRoute component={AnimationStudio} />
      </Route>
      <Route path="/animation/:storyboardId">
        <ProtectedDashboardRoute component={AnimationStudio} />
      </Route>
      {/* 舊版世界觀入口相容：統一導向 /animation */}
      <Route path="/worldbuilding">
        <NavigateRedirect to="/animation" />
      </Route>
      <Route path="/worldbuilding/:storyboardId">
        {params => <NavigateRedirect to={`/animation/${params.storyboardId}`} />}
      </Route>
      <Route path="/assets">
        <DashboardRoute component={AssetsLibrary} />
      </Route>
      <Route path="/models">
        <DashboardRoute component={ModelsPage} />
      </Route>
      <Route path="/vault">
        <AssetsRedirect section="vault" />
      </Route>
      {/* /shared 不再走 AssetsRedirect:資產相關分頁已併入 /assets,但 SharedSpace
          有獨家的「團隊共享模型」與「直送工作室」流程,需保留直連入口。 */}
      <Route path="/shared">
        <DashboardRoute component={SharedSpace} />
      </Route>
      <Route path="/notes">
        <DashboardRoute component={NotesPage} />
      </Route>
      <Route path="/calendar">
        <NavigateRedirect to="/notes" />
      </Route>
      <Route path="/dashboard">
        <DashboardRoute component={DashboardPage} />
      </Route>
      <Route path="/feedback">
        <DashboardRoute component={FeedbackPage} />
      </Route>
      <Route path="/settings/ai-brain">
        <AdminRedirect />
      </Route>
      <Route path="/settings/agent">
        <DashboardRoute component={AgentPreferencesPage} />
      </Route>
      <Route path="/settings">
        <DashboardRoute component={SettingsPage} />
      </Route>
      <Route path="/history">
        <NavigateRedirect to="/assets?section=history" />
      </Route>
      <Route path="/admin">
        <DashboardRoute component={AdminPage} />
      </Route>
      <Route path="/admin/api-usage">
        <DashboardRoute component={AdminApiUsagePage} />
      </Route>
      <Route path="/admin/brain-pipeline">
        <DashboardRoute component={AiBrainPipelinePage} />
      </Route>
      <Route path="/my-brain">
        <ProtectedDashboardRoute component={MyBrainPage} />
      </Route>
      <Route path="/pro-studio">
        <ProtectedDashboardRoute component={ProStudio} />
      </Route>
      <Route path="/image-studio">
        <ProtectedDashboardRoute component={ImageStudio} />
      </Route>
      <Route path="/light-orb-studio">
        <ProtectedDashboardRoute component={LightOrbCreationStudio} />
      </Route>
      <Route path="/video-studio">
        <ProtectedDashboardRoute component={VideoStudio} />
      </Route>
      <Route path="/learn">
        <DashboardRoute component={LearnHub} />
      </Route>
      <Route path="/ai-models-hub">
        <DashboardRoute component={AIModelsHub} />
      </Route>
      <Route path="/model-wishlist">
        <DashboardRoute component={ModelWishlistPage} />
      </Route>
      <Route path="/learn/tutorial-overview">
        <NavigateRedirect to="/tutorial-overview" />
      </Route>
      <Route path="/tutorial-overview">
        <DashboardRoute component={TutorialOverviewPage} />
      </Route>
      <Route path="/lora-trainer">
        <NavigateRedirect to="/models" />
      </Route>
      <Route path="/focus-flow">
        <DashboardRoute component={FocusFlowPage} />
      </Route>
      <Route path="/langsmith">
        <NavigateRedirect to="/dashboard?section=langsmith" />
      </Route>
      <Route path="/background-tasks">
        <AssetsRedirect section="tasks" />
      </Route>
      <Route path="/credits">
        <NavigateRedirect to="/dashboard?section=credits" />
      </Route>
      <Route path="/prompt-library">
        <AssetsRedirect section="prompts" />
      </Route>
      <Route path="/prompt-collection">
        <AssetsRedirect section="collection" />
      </Route>
      <Route path="/agent">
        <DashboardRoute component={AgentChat} />
      </Route>
      <Route path="/codex">
        <DashboardRoute component={AgentCodexPage} />
      </Route>
      <Route path="/teaching-archive">
        <ProtectedDashboardRoute component={TeachingArchive} />
      </Route>
      <Route path="/teams">
        <ProtectedDashboardRoute component={TeamsPage} />
      </Route>
      <Route path="/forgot-password">
        <Suspense fallback={<PageSkeleton />}>
          <ForgotPasswordPage />
        </Suspense>
      </Route>
      <Route path="/reset-password">
        <Suspense fallback={<PageSkeleton />}>
          <ResetPasswordPage />
        </Suspense>
      </Route>
      <Route path="/account-settings">
        <Suspense fallback={<PageSkeleton />}>
          <AccountSettingsPage />
        </Suspense>
      </Route>
      <Route path="/process">
        <Suspense fallback={<PageSkeleton />}>
          <ProcessViewerPage />
        </Suspense>
      </Route>
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" switchable>
        <PersonalSettingsProvider>
          <PersonalityProvider>
            <NotesDrawerProvider>
              <AssetsDrawerProvider>
              <ShowcaseTransferProvider>
                <SiteOnboardingProvider>
                  <FocusFlowProvider>
                    <AmbientProvider>
                    <OrbGuideProvider>
                    <PageAgentProvider>
                    <OrbStateProvider>
                    <WorldContextProvider>
                    <ProjectsProvider>
                    <GlobalOrbChatProvider>
                    <IntentCardProvider>
                    <TooltipProvider>
                      <SkipToContent />
                      <Toaster />
                      <OAuthErrorToast />
                      <OfflineBanner />
                      <AuthExpiredModal />
                      <LoginOrbAnimation />
                      <Router />
                      <ProjectNotesDrawer />
                      <AssetsQuickDrawer />
                      <Suspense fallback={null}>
                        <SiteOnboardingOverlay />
                      </Suspense>
                      <Suspense fallback={null}>
                        <CommandPalette />
                      </Suspense>
                    </TooltipProvider>
                    </IntentCardProvider>
                    </GlobalOrbChatProvider>
                    </ProjectsProvider>
                    </WorldContextProvider>
                    </OrbStateProvider>
                    </PageAgentProvider>
                    </OrbGuideProvider>
                    </AmbientProvider>
                  </FocusFlowProvider>
                </SiteOnboardingProvider>
              </ShowcaseTransferProvider>
              </AssetsDrawerProvider>
            </NotesDrawerProvider>
          </PersonalityProvider>
        </PersonalSettingsProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
