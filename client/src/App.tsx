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
import { ShowcaseTransferProvider } from "./contexts/ShowcaseTransferContext";

// ─── 首頁直接載入（不延遲，確保首屏最快） ─────────────────────────────────
import Home from "./pages/Home";

// ─── 其他頁面使用 lazy() 延遲載入，按需拆分 bundle ────────────────────────
const Studio           = lazy(() => import("./pages/Studio"));
const DirectorAI       = lazy(() => import("./pages/DirectorAI"));
const AssetsLibrary    = lazy(() => import("./pages/AssetsLibrary"));
const ModelsPage       = lazy(() => import("./pages/ModelsPage"));
const VaultPage        = lazy(() => import("./pages/VaultPage"));
const SharedSpace      = lazy(() => import("./pages/SharedSpace"));
const NotesPage        = lazy(() => import("./pages/NotesPage"));
const CalendarPage     = lazy(() => import("./pages/CalendarPage"));
const DashboardPage    = lazy(() => import("./pages/DashboardPage"));
const FeedbackPage     = lazy(() => import("./pages/FeedbackPage"));
const AiBrainSettings  = lazy(() => import("./pages/AiBrainSettings"));
const SettingsPage     = lazy(() => import("./pages/SettingsPage"));
const HistoryPage      = lazy(() => import("./pages/HistoryPage"));
const AdminPage        = lazy(() => import("./pages/AdminPage"));

// ─── 頁面載入中的通用 Skeleton ─────────────────────────────────────────────
function PageSkeleton() {
  return (
    <div className="flex items-center justify-center h-full min-h-[60vh]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        <p className="text-sm text-muted-foreground">載入中...</p>
      </div>
    </div>
  );
}

// ─── 路由包裝元件 ─────────────────────────────────────────────────────────

function DashboardRoute({ component: Component }: { component: React.ComponentType }) {
  return (
    <DashboardLayout>
      <Suspense fallback={<PageSkeleton />}>
        <Component />
      </Suspense>
    </DashboardLayout>
  );
}

function ProtectedDashboardRoute({ component: Component }: { component: React.ComponentType }) {
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
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <PersonalityProvider>
        <NotesDrawerProvider>
          <ShowcaseTransferProvider>
            <TooltipProvider>
              <Toaster />
              <OfflineBanner />
              <AuthExpiredModal />
              <Router />
              <ProjectNotesDrawer />
            </TooltipProvider>
          </ShowcaseTransferProvider>
        </NotesDrawerProvider>
        </PersonalityProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
