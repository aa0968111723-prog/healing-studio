import { lazy, Suspense, useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { NotesDrawerProvider } from "./contexts/NotesDrawerContext";
import { PersonalityProvider } from "./contexts/PersonalityContext";
import DashboardLayout from "./components/DashboardLayout";
import ProjectNotesDrawer from "./components/ProjectNotesDrawer";
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
import { PersonalSettingsProvider } from "./contexts/PersonalSettingsContext";
const SiteOnboardingOverlay = lazy(
  () => import("./components/SiteOnboardingOverlay")
);

// ─── 首頁直接載入（不延遲，確保首屏最快） ─────────────────────────────────
import Home from "./pages/Home";

// ─── 其他頁面使用 lazy() 延遲載入，按需拆分 bundle ────────────────────────
const Studio = lazy(() => import("./pages/Studio"));
const DirectorAI = lazy(() => import("./pages/DirectorAI"));
const AssetsLibrary = lazy(() => import("./pages/AssetsLibrary"));
const ModelsPage = lazy(() => import("./pages/ModelsPage"));
const VaultPage = lazy(() => import("./pages/VaultPage"));
const SharedSpace = lazy(() => import("./pages/SharedSpace"));
const NotesPage = lazy(() => import("./pages/NotesPage"));
const CalendarPage = lazy(() => import("./pages/CalendarPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const FeedbackPage = lazy(() => import("./pages/FeedbackPage"));
const AiBrainSettings = lazy(() => import("./pages/AiBrainSettings"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const HistoryPage = lazy(() => import("./pages/HistoryPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const ProStudio = lazy(() => import("./pages/ProStudio"));
const ImageStudio = lazy(() => import("./pages/ImageStudio"));
const VideoStudio = lazy(() => import("./pages/VideoStudio"));
const LearnHub = lazy(() => import("./pages/LearnHub"));
const TutorialOverviewPage = lazy(() => import("./pages/TutorialOverviewPage"));
const LoraTrainer = lazy(() => import("./pages/LoraTrainer"));
const FocusFlowPage = lazy(() => import("./pages/FocusFlowPage"));
const LangSmithPage = lazy(() => import("./pages/LangSmithPage"));
const BackgroundTasksPage = lazy(() => import("./pages/BackgroundTasksPage"));
const CreditsInfoPage = lazy(() => import("./pages/CreditsInfoPage"));
const PromptLibraryPage = lazy(() => import("./pages/PromptLibraryPage"));
const AgentChat = lazy(() => import("./pages/AgentChat"));
const AdminApiUsagePage = lazy(() => import("./pages/AdminApiUsagePage"));
const ForgotPasswordPage = lazy(() => import("./pages/ForgotPasswordPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const AccountSettingsPage = lazy(() => import("./pages/AccountSettingsPage"));

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

function DashboardRoute({
  component: Component,
}: {
  component: React.ComponentType;
}) {
  return (
    <DashboardLayout>
      <Suspense fallback={<PageSkeleton />}>
        <Component />
      </Suspense>
    </DashboardLayout>
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
          <Component />
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

    const message = OAUTH_ERROR_MESSAGES[error] ?? "登入失敗，請重試。";
    toast.error("Google 登入失敗", { description: message, duration: 6000 });
  }, []);

  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/studio">
        <ProtectedDashboardRoute component={Studio} />
      </Route>
      <Route path="/director">
        <ProtectedDashboardRoute component={DirectorAI} />
      </Route>
      <Route path="/assets">
        <DashboardRoute component={AssetsLibrary} />
      </Route>
      <Route path="/models">
        <DashboardRoute component={ModelsPage} />
      </Route>
      <Route path="/vault">
        <DashboardRoute component={VaultPage} />
      </Route>
      <Route path="/shared">
        <DashboardRoute component={SharedSpace} />
      </Route>
      <Route path="/notes">
        <DashboardRoute component={NotesPage} />
      </Route>
      <Route path="/calendar">
        <DashboardRoute component={CalendarPage} />
      </Route>
      <Route path="/dashboard">
        <DashboardRoute component={DashboardPage} />
      </Route>
      <Route path="/feedback">
        <DashboardRoute component={FeedbackPage} />
      </Route>
      <Route path="/settings/ai-brain">
        <ProtectedDashboardRoute component={AiBrainSettings} />
      </Route>
      <Route path="/settings">
        <DashboardRoute component={SettingsPage} />
      </Route>
      <Route path="/history">
        <ProtectedDashboardRoute component={HistoryPage} />
      </Route>
      <Route path="/admin">
        <DashboardRoute component={AdminPage} />
      </Route>
      <Route path="/admin/api-usage">
        <DashboardRoute component={AdminApiUsagePage} />
      </Route>
      <Route path="/pro-studio">
        <ProtectedDashboardRoute component={ProStudio} />
      </Route>
      <Route path="/image-studio">
        <ProtectedDashboardRoute component={ImageStudio} />
      </Route>
      <Route path="/video-studio">
        <ProtectedDashboardRoute component={VideoStudio} />
      </Route>
      <Route path="/learn">
        <DashboardRoute component={LearnHub} />
      </Route>
      <Route path="/learn/tutorial-overview">
        <DashboardRoute component={TutorialOverviewPage} />
      </Route>
      <Route path="/tutorial-overview">
        <DashboardRoute component={TutorialOverviewPage} />
      </Route>
      <Route path="/lora-trainer">
        <ProtectedDashboardRoute component={LoraTrainer} />
      </Route>
      <Route path="/focus-flow">
        <DashboardRoute component={FocusFlowPage} />
      </Route>
      <Route path="/langsmith">
        <DashboardRoute component={LangSmithPage} />
      </Route>
      <Route path="/background-tasks">
        <ProtectedDashboardRoute component={BackgroundTasksPage} />
      </Route>
      <Route path="/credits">
        <DashboardRoute component={CreditsInfoPage} />
      </Route>
      <Route path="/prompt-library">
        <DashboardRoute component={PromptLibraryPage} />
      </Route>
      <Route path="/agent">
        <DashboardRoute component={AgentChat} />
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
              <ShowcaseTransferProvider>
                <SiteOnboardingProvider>
                  <FocusFlowProvider>
                    <AmbientProvider>
                    <OrbGuideProvider>
                    <PageAgentProvider>
                    <GlobalOrbChatProvider>
                    <TooltipProvider>
                      <Toaster />
                      <OAuthErrorToast />
                      <OfflineBanner />
                      <AuthExpiredModal />
                      <LoginOrbAnimation />
                      <Router />
                      <ProjectNotesDrawer />
                      <Suspense fallback={null}>
                        <SiteOnboardingOverlay />
                      </Suspense>
                    </TooltipProvider>
                    </GlobalOrbChatProvider>
                    </PageAgentProvider>
                    </OrbGuideProvider>
                    </AmbientProvider>
                  </FocusFlowProvider>
                </SiteOnboardingProvider>
              </ShowcaseTransferProvider>
            </NotesDrawerProvider>
          </PersonalityProvider>
        </PersonalSettingsProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
