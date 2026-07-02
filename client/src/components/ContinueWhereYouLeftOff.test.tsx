// @vitest-environment jsdom
/**
 * ContinueWhereYouLeftOff — AIDV-967 元件測試（仿 SSEFallbackBanner.test.tsx
 * 的 jsdom + vi.mock 模式）
 * 驗收條件：
 * - 全空（真新手）→ 完全不渲染
 * - 有路徑進度 → slot ① 顯示 X/5、CTA 連到 /learn?sub=start
 * - 有未完成專案 → slot ② CTA 連到 /projects/:id（對齊 AIDV-961 目的地）
 * - 載入中：有路徑進度 → 專案 slot 畫 skeleton；無路徑進度 → 不渲染
 * - 查詢失敗 → 專案 slot 靜默降級（有路徑仍顯示；全靠專案則不渲染）
 * - 可關閉：點 X → 卡片消失、localStorage 記住、重掛不再顯示
 * - a11y：region + heading、按鈕皆有可讀 label
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Project } from "@/types/projects";
import { ContinueWhereYouLeftOff } from "./ContinueWhereYouLeftOff";
import {
  BEGINNER_PATH_DONE_KEY,
  CONTINUE_CARD_DISMISS_KEY,
} from "./continueResume";

vi.mock("@/contexts/ProjectsContext", () => ({
  useProjects: vi.fn(),
}));
// SSOT 旗標依 env 而變（測試環境可能關）；元件行為以旗標 ON 為準來驗證。
vi.mock("@/config/projectFlags", () => ({
  ENABLE_PROJECT_SSOT: true,
}));

import { useProjects } from "@/contexts/ProjectsContext";
const mockUseProjects = useProjects as unknown as ReturnType<typeof vi.fn>;

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "42",
    title: "療癒短片企劃",
    type: "video",
    status: "draft",
    progress: 30,
    currentStep: "分鏡進行中",
    nextAction: "回到分鏡工作室完成第 3 格",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
    ...overrides,
  };
}

function setProjects(
  projects: Project[],
  { isLoading = false, error = null as string | null } = {},
) {
  mockUseProjects.mockReturnValue({ projects, isLoading, error });
}

function setPathDone(ids: string[]) {
  window.localStorage.setItem(BEGINNER_PATH_DONE_KEY, JSON.stringify(ids));
}

function renderCard() {
  const { hook } = memoryLocation({ path: "/" });
  return render(
    <Router hook={hook}>
      <ContinueWhereYouLeftOff />
    </Router>,
  );
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ContinueWhereYouLeftOff (AIDV-967)", () => {
  it("全空（真新手）→ 完全不渲染", () => {
    setProjects([]);
    renderCard();
    expect(screen.queryByTestId("continue-left-off")).toBeNull();
  });

  it("有路徑進度 → 顯示 X/5 與 /learn?sub=start CTA", () => {
    setPathDone(["read-prompt", "first-image"]);
    setProjects([]);
    renderCard();
    expect(screen.getByTestId("continue-left-off-path").textContent).toContain(
      "2/5",
    );
    const cta = screen
      .getByTestId("continue-left-off-path-cta")
      .closest("section")!
      .querySelector('a[href="/learn?sub=start"]');
    expect(cta).not.toBeNull();
    // 無專案 slot
    expect(screen.queryByTestId("continue-left-off-project")).toBeNull();
  });

  it("有未完成專案 → CTA 連到 /projects/:id（AIDV-961 可續編目的地）", () => {
    setProjects([makeProject()]);
    renderCard();
    const slot = screen.getByTestId("continue-left-off-project");
    expect(slot.textContent).toContain("療癒短片企劃");
    expect(slot.textContent).toContain("回到分鏡工作室完成第 3 格");
    const link = slot.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/projects/42");
    expect(screen.queryByTestId("continue-left-off-path")).toBeNull();
  });

  it("completed 專案不算未完成 → 不渲染", () => {
    setProjects([makeProject({ status: "completed" })]);
    renderCard();
    expect(screen.queryByTestId("continue-left-off")).toBeNull();
  });

  it("載入中＋有路徑進度 → 專案 slot 先畫 skeleton", () => {
    setPathDone(["read-prompt"]);
    setProjects([], { isLoading: true });
    renderCard();
    expect(screen.getByTestId("continue-left-off-path")).toBeTruthy();
    expect(
      screen.getByTestId("continue-left-off-project-loading"),
    ).toBeTruthy();
  });

  it("載入中＋無路徑進度 → 不渲染（不閃空 skeleton 卡）", () => {
    setProjects([], { isLoading: true });
    renderCard();
    expect(screen.queryByTestId("continue-left-off")).toBeNull();
  });

  it("查詢失敗（未登入/後端錯）＋有路徑進度 → 專案 slot 靜默降級、路徑照常", () => {
    setPathDone(["read-prompt"]);
    setProjects([makeProject()], { error: "UNAUTHORIZED" });
    renderCard();
    expect(screen.getByTestId("continue-left-off-path")).toBeTruthy();
    expect(screen.queryByTestId("continue-left-off-project")).toBeNull();
    expect(
      screen.queryByTestId("continue-left-off-project-loading"),
    ).toBeNull();
  });

  it("查詢失敗且無路徑進度 → 完全不渲染（絕不弄壞首頁）", () => {
    setProjects([makeProject()], { error: "boom" });
    renderCard();
    expect(screen.queryByTestId("continue-left-off")).toBeNull();
  });

  it("點 X 關閉 → 卡片消失、localStorage 記住、重掛不再顯示", () => {
    setPathDone(["read-prompt"]);
    setProjects([]);
    renderCard();
    fireEvent.click(screen.getByTestId("continue-left-off-dismiss"));
    expect(screen.queryByTestId("continue-left-off")).toBeNull();
    expect(window.localStorage.getItem(CONTINUE_CARD_DISMISS_KEY)).toBe("1");

    cleanup();
    renderCard(); // 重新掛載（模擬回訪）
    expect(screen.queryByTestId("continue-left-off")).toBeNull();
  });

  it("a11y：region 以卡片 heading 命名、CTA 與關閉鈕皆有可讀 label", () => {
    setPathDone(["read-prompt", "first-image", "refine"]);
    setProjects([makeProject()]);
    renderCard();
    expect(
      screen.getByRole("region", { name: "接著上次繼續" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "接著上次繼續" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "繼續新手路徑，已完成 3 / 5 步" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "繼續專案「療癒短片企劃」" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "關閉「接著上次繼續」卡片，之後不再顯示",
      }),
    ).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "新手路徑進度" })).toBeTruthy();
  });
});
