import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { NotesDrawerProvider } from "./contexts/NotesDrawerContext";
import Home from "./pages/Home";
import DashboardLayout from "./components/DashboardLayout";
import Studio from "./pages/Studio";
import DirectorAI from "./pages/DirectorAI";
import AssetsLibrary from "./pages/AssetsLibrary";
import ModelsPage from "./pages/ModelsPage";
import NotesPage from "./pages/NotesPage";
import CalendarPage from "./pages/CalendarPage";
import DashboardPage from "./pages/DashboardPage";
import FeedbackPage from "./pages/FeedbackPage";
import AdminPage from "./pages/AdminPage";
import SharedSpace from "./pages/SharedSpace";
import SettingsPage from "./pages/SettingsPage";
import AiBrainSettings from "./pages/AiBrainSettings";
import VaultPage from "./pages/VaultPage";
import HistoryPage from "./pages/HistoryPage";
import ProjectNotesDrawer from "./components/ProjectNotesDrawer";
import OfflineBanner from "./components/OfflineBanner";
import AuthExpiredModal from "./components/AuthExpiredModal";
import { ShowcaseTransferProvider } from "./contexts/ShowcaseTransferContext";

function DashboardRoute({ component: Component }: { component: React.ComponentType }) {
  return (
    <DashboardLayout>
      <Component />
    </DashboardLayout>
  );
}

/**
 * Wraps a page component with an inline ErrorBoundary for page-level isolation.
 * If the page crashes, only the page content shows the friendly error UI,
 * while the sidebar/navigation remain functional.
 */
function ProtectedDashboardRoute({ component: Component }: { component: React.ComponentType }) {
  return (
    <DashboardLayout>
      <ErrorBoundary inline>
        <Component />
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
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
