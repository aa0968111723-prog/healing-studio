// @vitest-environment jsdom
/**
 * Wave 1 SSOT 新增的載入／錯誤防護分支測試。
 *
 * mock 路徑的 provider 恆 isLoading=false / error=null，到不了這些分支；
 * 這裡直接 mock useProjects 餵狀態，逐一打到每個 data-testid，並釘住
 * ProjectDetailPage「載入中不可閃『找不到』」的順序語意。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Project } from "@/types/projects";

type MockProjectsState = {
  projects: Project[];
  activeProjectId: string | null;
  latestProject: Project | null;
  activeProject: Project | null;
  setActiveProjectId: (id: string | null) => void;
  getProjectById: (id: string) => Project | undefined;
  createProject: (draft: unknown) => Promise<Project>;
  isLoading: boolean;
  error: string | null;
};

const mockState: MockProjectsState = {
  projects: [],
  activeProjectId: null,
  latestProject: null,
  activeProject: null,
  setActiveProjectId: () => {},
  getProjectById: () => undefined,
  createProject: async () => {
    throw new Error("not stubbed");
  },
  isLoading: false,
  error: null,
};

vi.mock("@/contexts/ProjectsContext", () => ({
  useProjects: () => mockState,
}));

// CreationHub 周邊重元件／context 與本測試無關，stub 掉以免拖 trpc。
vi.mock("@/components/create/ActiveProjectContextPanel", () => ({
  ActiveProjectContextPanel: () => null,
}));
vi.mock("@/components/create/IntentComposer", () => ({
  IntentComposer: () => null,
}));
vi.mock("@/contexts/PageAgentContext", () => ({
  useRegisterPageAgent: () => {},
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import ProjectsListPage from "./ProjectsListPage";
import ProjectDetailPage from "./ProjectDetailPage";
import CreationHub from "./CreationHub";

function renderAt(path: string, ui: React.ReactNode) {
  const { hook } = memoryLocation({ path });
  return render(<Router hook={hook}>{ui}</Router>);
}

beforeEach(() => {
  mockState.projects = [];
  mockState.activeProjectId = null;
  mockState.latestProject = null;
  mockState.activeProject = null;
  mockState.getProjectById = () => undefined;
  mockState.isLoading = false;
  mockState.error = null;
});

afterEach(() => {
  cleanup();
});

describe("ProjectsListPage guards", () => {
  it("shows the loading card (not the empty state) while the list loads", () => {
    mockState.isLoading = true;
    renderAt("/projects", <ProjectsListPage />);
    expect(screen.getByTestId("projects-list-loading")).toBeTruthy();
    expect(screen.queryByText("還沒有專案")).toBeNull();
  });

  it("shows the error card with the message when the list query fails", () => {
    mockState.error = "boom";
    renderAt("/projects", <ProjectsListPage />);
    expect(screen.getByTestId("projects-list-error").textContent).toContain(
      "boom",
    );
    expect(screen.queryByText("還沒有專案")).toBeNull();
  });
});

describe("ProjectDetailPage guards", () => {
  it("shows loading — and must NOT flash 找不到 — while the list loads", () => {
    mockState.isLoading = true;
    const { hook } = memoryLocation({ path: "/projects/12" });
    render(
      <Router hook={hook}>
        <Route path="/projects/:id" component={ProjectDetailPage} />
      </Router>,
    );
    expect(screen.getByTestId("project-detail-loading")).toBeTruthy();
    expect(screen.queryByText("找不到這個專案")).toBeNull();
  });

  it("still shows 找不到 once loading finished and the id is unknown", () => {
    const { hook } = memoryLocation({ path: "/projects/999" });
    render(
      <Router hook={hook}>
        <Route path="/projects/:id" component={ProjectDetailPage} />
      </Router>,
    );
    expect(screen.getByText("找不到這個專案")).toBeTruthy();
  });
});

describe("CreationHub guards", () => {
  it("shows the loading section instead of the first-project form while loading", () => {
    mockState.isLoading = true;
    renderAt("/create", <CreationHub />);
    expect(screen.getByTestId("projects-loading")).toBeTruthy();
    expect(screen.queryByTestId("video-project-empty-form")).toBeNull();
  });

  it("shows the error section instead of the first-project form on list failure", () => {
    mockState.error = "boom";
    renderAt("/create", <CreationHub />);
    expect(screen.getByTestId("projects-error").textContent).toContain("boom");
    expect(screen.queryByTestId("video-project-empty-form")).toBeNull();
  });
});
