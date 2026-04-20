import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/sonner";
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
const LoraTrainer = lazy(() => import("./pages/LoraTrainer"));
const FocusFlowPage = lazy(() => import("./pages/FocusFlowPage"));
const LangSmithPage = lazy(() => import("./pages/LangSmithPage"));
const BackgroundTasksPage = lazy(() => import("./pages/BackgroundTasksPage"));
const CreditsInfoPage = lazy(() => import("./pages/CreditsInfoPage"));
const PromptLibraryPage = lazy(() => import("./pages/PromptLibraryPage"));
const AdminApiUsagePage = lazy(() => import("./pages/AdminApiUsagePage"));

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
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" switchable>
        <PersonalityProvider>
          <NotesDrawerProvider>
            <ShowcaseTransferProvider>
              <SiteOnboardingProvider>
                <FocusFlowProvider>
                  <AmbientProvider>
                  <OrbGuideProvider>
                  <TooltipProvider>
                    <Toaster />
                    <OfflineBanner />
                    <AuthExpiredModal />
                    <LoginOrbAnimation />
                    <Router />
                    <ProjectNotesDrawer />
                    <Suspense fallback={null}>
                      <SiteOnboardingOverlay />
                    </Suspense>
                  </TooltipProvider>
                  </OrbGuideProvider>
                  </AmbientProvider>
                </FocusFlowProvider>
              </SiteOnboardingProvider>
            </ShowcaseTransferProvider>
          </NotesDrawerProvider>
        </PersonalityProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
