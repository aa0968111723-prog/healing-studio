// @vitest-environment jsdom
//
// AIDV-961：創作專案主控台「下一步」原本只有純文字、無對應按鈕。本檔斷言
// NextStepPanel 依綁定/專案狀態給出正確的可點按鈕（建立世界觀 → /worldbuilding、
// 建立分鏡 → /animation、生成 → /director、空清單 → 開建立專案 dialog），
// 並在「已有專案但未啟用」時不顯示動作按鈕。
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

// 可變狀態：vi.mock 工廠被提升到 import 之上，必須用 vi.hoisted 共享。
const mockState = vi.hoisted(() => ({
  currentProjectId: null as number | null,
  projects: [] as Array<{
    id: number;
    title: string;
    description: string | null;
    status: string;
    worldFrameworkId: number | null;
    worldStoryboardId: number | null;
    directorSessionId: number | null;
  }>,
}));

vi.mock("@/contexts/WorldContextContext", () => ({
  useWorldContext: () => ({
    currentProjectId: mockState.currentProjectId,
    setCurrentProjectId: vi.fn(),
  }),
}));

vi.mock("@/lib/trpc", () => {
  // 必須定義在工廠內部：vi.mock 會被提升到 import 之上，引用外層變數會
  // 觸發 "Cannot access before initialization"。
  const emptyMutation = () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  });
  return {
    trpc: {
      useUtils: () => ({ creativeProject: { list: { invalidate: vi.fn() } } }),
      creativeProject: {
        list: { useQuery: () => ({ data: mockState.projects, error: undefined }) },
        create: { useMutation: emptyMutation },
        delete: { useMutation: emptyMutation },
        link: { useMutation: emptyMutation },
      },
      worldbuilding: { list: { useQuery: () => ({ data: [] }) } },
      worldStoryboard: { list: { useQuery: () => ({ data: [] }) } },
    },
  };
});

import CreativeProjectPage from "./CreativeProjectPage";

afterEach(() => {
  cleanup();
  mockState.currentProjectId = null;
  mockState.projects = [];
});

function makeProject(over: Partial<(typeof mockState.projects)[number]> = {}) {
  return {
    id: 1,
    title: "測試專案",
    description: null,
    status: "concept",
    worldFrameworkId: null,
    worldStoryboardId: null,
    directorSessionId: null,
    ...over,
  };
}

function renderPage() {
  const { hook } = memoryLocation({ path: "/creative-projects" });
  return render(
    <Router hook={hook}>
      <CreativeProjectPage />
    </Router>,
  );
}

describe("CreativeProjectPage 下一步可點按鈕 (AIDV-961)", () => {
  it("active project with no world bound → 建立世界觀 → /worldbuilding", () => {
    mockState.currentProjectId = 1;
    mockState.projects = [makeProject({ worldFrameworkId: null })];
    renderPage();
    const btn = screen.getByTestId("creative-next-step-action");
    expect(btn.textContent).toContain("建立世界觀");
    expect(btn.getAttribute("href")).toBe("/worldbuilding");
  });

  it("world bound but no storyboard → 建立分鏡 → /animation", () => {
    mockState.currentProjectId = 1;
    mockState.projects = [
      makeProject({ worldFrameworkId: 5, worldStoryboardId: null }),
    ];
    renderPage();
    const btn = screen.getByTestId("creative-next-step-action");
    expect(btn.textContent).toContain("建立分鏡");
    expect(btn.getAttribute("href")).toBe("/animation");
  });

  it("fully bound → 生成 / 導演工作室 → /director", () => {
    mockState.currentProjectId = 1;
    mockState.projects = [
      makeProject({ worldFrameworkId: 5, worldStoryboardId: 7 }),
    ];
    renderPage();
    const btn = screen.getByTestId("creative-next-step-action");
    expect(btn.getAttribute("href")).toBe("/director");
  });

  it("no projects at all → 建立第一個創作專案 (button, no href)", () => {
    mockState.currentProjectId = null;
    mockState.projects = [];
    renderPage();
    const btn = screen.getByTestId("creative-next-step-action");
    expect(btn.textContent).toContain("建立第一個創作專案");
    // 開 dialog 的動作鈕，不是連結。
    expect(btn.getAttribute("href")).toBeNull();
  });

  it("has projects but none active → no action button (純切換上下文)", () => {
    mockState.currentProjectId = null;
    mockState.projects = [makeProject({ id: 9 })];
    renderPage();
    expect(screen.queryByTestId("creative-next-step-action")).toBeNull();
  });
});
