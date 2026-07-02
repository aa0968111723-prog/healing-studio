// @vitest-environment jsdom
/**
 * ContinueWhereYouLeftOff — AIDV-967 元件測試（仿 SSEFallbackBanner 的
 * jsdom + mock context 模式；wouter Link 用 memoryLocation Router 包）。
 *
 * 驗收條件：
 * - 真新手（無路徑進度、無專案）→ 完全不渲染。
 * - 路徑進度 → X/5 + 深連結 /learn?sub=start。
 * - 未完成專案 → 連到 /projects/:id（AIDV-961 對齊的可續編 surface）。
 * - 載入：有路徑進度 → 路徑 slot + 專案 skeleton；無 → 整卡不渲染。
 * - 錯誤（未登入 / 查詢失敗）→ 專案 slot 靜默消失，不弄壞首頁。
 * - 可關閉：X → 消失 + localStorage 記住 → 重掛不重彈。
 * - a11y：section aria-labelledby heading、按鈕都有可讀 label。
 * - 私密模式（localStorage 擲例外）→ 不炸、不渲染。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Project } from "@/types/projects";
import { ContinueWhereYouLeftOff } from "./ContinueWhereYouLeftOff";
import {
  BEGINNER_PATH_LS_KEY,
  DISMISS_LS_KEY,
} from "./continueWhereYouLeftOff";

vi.mock("@/contexts/ProjectsContext", () => ({
  useProjects: vi.fn(),
}));

import { useProjects } from "@/contexts/ProjectsContext";
const mockUseProjects = useProjects as unknown as ReturnType<typeof vi.fn>;

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "12",
    title: "療癒短片企劃",
    type: "video",
    status: "draft",
    progress: 30,
    currentStep: "分鏡到一半",
    nextAction: "回導演工作室補分鏡。",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
    ...overrides,
  };
}

function setProjects({
  projects = [] as Project[],
  isLoading = false,
  error = null as string | null,
} = {}) {
  mockUseProjects.mockReturnValue({ projects, isLoading, error });
}

function setPathProgress(ids: string[]) {
  window.localStorage.setItem(BEGINNER_PATH_LS_KEY, JSON.stringify(ids));
}

function renderCard() {
  const { hook } = memoryLocation({ path: "/" });
  return render(
    <Router hook={hook}>
      <ContinueWhereYouLeftOff />
    </Router>,
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("ContinueWhereYouLeftOff (AIDV-967)", () => {
  it("真新手（無路徑進度、無專案、非載入）→ 完全不渲染", () => {
    setProjects();
    renderCard();
    expect(screen.queryByTestId("continue-where-left-off")).toBeNull();
  });

  it("有路徑進度 → 顯示 2/5 與 /learn?sub=start 深連結", () => {
    setPathProgress(["read-prompt", "first-image"]);
    setProjects();
    renderCard();
    expect(screen.getByTestId("continue-slot-path")).toBeDefined();
    expect(screen.getByText("2/5")).toBeDefined();
    const cta = screen.getByTestId("continue-path-cta");
    expect(cta.getAttribute("href")).toBe("/learn?sub=start");
    // 沒有未完成專案 → 專案 slot 不出現
    expect(screen.queryByTestId("continue-slot-project")).toBeNull();
  });

  it("有未完成專案 → 顯示專案 slot，連到 /projects/:id（對齊 AIDV-961）", () => {
    setProjects({ projects: [makeProject({ id: "12" })] });
    renderCard();
    const slot = screen.getByTestId("continue-slot-project");
    expect(slot.textContent).toContain("療癒短片企劃");
    expect(slot.textContent).toContain("回導演工作室補分鏡。");
    const cta = screen.getByTestId("continue-project-cta");
    expect(cta.getAttribute("href")).toBe("/projects/12");
    expect(screen.queryByTestId("continue-slot-path")).toBeNull();
  });

  it("載入中＋有路徑進度 → 路徑 slot＋專案 skeleton", () => {
    setPathProgress(["read-prompt"]);
    setProjects({ isLoading: true });
    renderCard();
    expect(screen.getByTestId("continue-slot-path")).toBeDefined();
    expect(screen.getByTestId("continue-slot-project-skeleton")).toBeDefined();
    expect(screen.queryByTestId("continue-slot-project")).toBeNull();
  });

  it("載入中＋無路徑進度 → 整卡不渲染（不對真新手閃空卡）", () => {
    setProjects({ isLoading: true });
    renderCard();
    expect(screen.queryByTestId("continue-where-left-off")).toBeNull();
  });

  it("查詢失敗（未登入等）＋有路徑進度 → 只剩路徑 slot、無 skeleton、不炸", () => {
    setPathProgress(["read-prompt", "first-image", "refine"]);
    setProjects({ error: "UNAUTHORIZED" });
    renderCard();
    expect(screen.getByTestId("continue-slot-path")).toBeDefined();
    expect(screen.queryByTestId("continue-slot-project")).toBeNull();
    expect(screen.queryByTestId("continue-slot-project-skeleton")).toBeNull();
  });

  it("查詢失敗＋無路徑進度 → 完全不渲染（首頁靜默降級）", () => {
    setProjects({ error: "Failed to fetch" });
    expect(() => renderCard()).not.toThrow();
    expect(screen.queryByTestId("continue-where-left-off")).toBeNull();
  });

  it("點 X 關閉 → 卡片消失且 localStorage 記住；重新掛載不重彈", () => {
    setPathProgress(["read-prompt"]);
    setProjects();
    renderCard();
    fireEvent.click(screen.getByTestId("continue-where-left-off-dismiss"));
    expect(screen.queryByTestId("continue-where-left-off")).toBeNull();
    expect(window.localStorage.getItem(DISMISS_LS_KEY)).toBe("1");

    cleanup();
    renderCard(); // 重新掛載（模擬回訪）
    expect(screen.queryByTestId("continue-where-left-off")).toBeNull();
  });

  it("a11y：section aria-labelledby 指到卡片 heading；關閉鈕與 CTA 都有可讀名稱", () => {
    setPathProgress(["read-prompt"]);
    setProjects({ projects: [makeProject()] });
    renderCard();
    const heading = screen.getByRole("heading", { name: "接著上次繼續" });
    const section = screen.getByTestId("continue-where-left-off");
    expect(section.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(
      screen.getByRole("button", { name: "關閉「接著上次繼續」卡片" }),
    ).toBeDefined();
    expect(screen.getByRole("link", { name: "繼續新手路徑" })).toBeDefined();
    expect(
      screen.getByRole("link", { name: "繼續專案：療癒短片企劃" }),
    ).toBeDefined();
    expect(
      screen.getByRole("progressbar", { name: "新手路徑進度" }).getAttribute("aria-valuenow"),
    ).toBe("1");
  });

  it("私密模式（localStorage.getItem 擲例外）→ 不炸；無專案時不渲染", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    setProjects();
    expect(() => renderCard()).not.toThrow();
    expect(screen.queryByTestId("continue-where-left-off")).toBeNull();
  });
});
