// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
// 直接釘 MockProjectsProvider：本檔斷言 MOCK_PROJECTS 內容，不該因
// VITE_ENABLE_4SHELL/PROJECT_SSOT 環境改走真實 provider 而轉紅。
import { MockProjectsProvider } from "@/contexts/ProjectsContext";
import { MOCK_PROJECTS } from "@/data/mockProjects";
import ProjectsListPage from "./ProjectsListPage";
import ProjectDetailPage from "./ProjectDetailPage";

afterEach(() => {
  cleanup();
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

function renderAt(path: string, ui: React.ReactNode) {
  const { hook } = memoryLocation({ path });
  return render(
    <Router hook={hook}>
      <MockProjectsProvider>{ui}</MockProjectsProvider>
    </Router>,
  );
}

/** Wrap detail page in the matching Route so useParams resolves `:id`. */
function renderDetailAt(path: string) {
  const { hook } = memoryLocation({ path });
  return render(
    <Router hook={hook}>
      <MockProjectsProvider>
        <Route path="/projects/:id" component={ProjectDetailPage} />
      </MockProjectsProvider>
    </Router>,
  );
}

describe("ProjectsListPage (/projects)", () => {
  it("renders the page title and every mock project card", () => {
    renderAt("/projects", <ProjectsListPage />);
    expect(screen.getByText("我的創作專案")).toBeTruthy();
    expect(screen.getByTestId("projects-list")).toBeTruthy();
    for (const project of MOCK_PROJECTS) {
      expect(
        screen.getByTestId(`project-card-${project.id}`),
        `card for ${project.id}`,
      ).toBeTruthy();
      expect(screen.getByText(project.title)).toBeTruthy();
    }
  });

  it("renders progress, current step, and next-action for each card", () => {
    renderAt("/projects", <ProjectsListPage />);
    const zen = MOCK_PROJECTS.find(p => p.id === "proj-zen-short")!;
    expect(screen.getByTestId(`project-progress-${zen.id}`).textContent).toBe(
      `${zen.progress}%`,
    );
    expect(screen.getByText(zen.currentStep)).toBeTruthy();
    expect(screen.getByText(zen.nextAction)).toBeTruthy();
    // Every card has a 繼續創作 button.
    for (const project of MOCK_PROJECTS) {
      expect(screen.getByTestId(`continue-${project.id}`)).toBeTruthy();
    }
  });
});

describe("ProjectDetailPage (/projects/:id)", () => {
  it("renders title / type / status / current-step / next-action / 回到創作中樞", () => {
    const zen = MOCK_PROJECTS.find(p => p.id === "proj-zen-short")!;
    renderDetailAt(`/projects/${zen.id}`);

    expect(screen.getByRole("heading", { name: zen.title })).toBeTruthy();
    expect(screen.getByTestId("project-detail-type").textContent).toBe("影片");
    expect(screen.getByTestId("project-detail-status").textContent).toBe(
      "進行中",
    );
    expect(screen.getByTestId("project-detail-progress").textContent).toBe(
      `進度 ${zen.progress}%`,
    );
    expect(
      screen.getByTestId("project-detail-current-step-text").textContent,
    ).toBe(zen.currentStep);
    expect(screen.getByText(zen.nextAction)).toBeTruthy();
    expect(screen.getByTestId("project-detail-back-home")).toBeTruthy();
  });

  it("surfaces bound world framework + storyboard for the zen sample", () => {
    const zen = MOCK_PROJECTS.find(p => p.id === "proj-zen-short")!;
    renderDetailAt(`/projects/${zen.id}`);
    expect(screen.getByTestId("project-detail-bindings")).toBeTruthy();
    const wf = screen.getByTestId("binding-world-framework");
    expect(wf.dataset.bound).toBe("true");
    expect(wf.textContent).toContain("禪修世界觀 v1");
    const sb = screen.getByTestId("binding-storyboard");
    expect(sb.dataset.bound).toBe("true");
    expect(sb.textContent).toContain("30 秒禪修分鏡");
  });

  it("shows 未綁定 fallback when no binding is set on the project", () => {
    // proj-club-poster 沒有 binding 欄位 → 三行都應顯示「未綁定」。
    const club = MOCK_PROJECTS.find(p => p.id === "proj-club-poster")!;
    renderDetailAt(`/projects/${club.id}`);
    for (const id of [
      "binding-world-framework",
      "binding-storyboard",
      "binding-director-session",
    ]) {
      const row = screen.getByTestId(id);
      expect(row.dataset.bound, `${id} should be 未綁定`).toBe("false");
      expect(row.textContent).toContain("未綁定");
    }
  });

  it("shows a 找不到 fallback for unknown project ids", () => {
    renderDetailAt("/projects/missing-id");
    expect(screen.getByText("找不到這個專案")).toBeTruthy();
  });
});
