// @vitest-environment jsdom
/**
 * AgentCatalog（I-1 光球精靈能力＋成本目錄，AIDV-79 Phase 1）行為測試。
 *
 * 守住驗收：
 *   1. 精靈選單渲染（專精家族）＋預設選第一位。
 *   2. 列出該精靈可用模型（spirit.listModels）：label / modelId / tier / category。
 *   3. 每個模型顯示預估成本（director.estimateSegmentCost，依 modelId 合併）。
 *   4. 四態：載入中 → PanelLoading；錯誤 → PanelError；空 → 空狀態。
 *
 * 沿用 repo 慣例：模組級 vi.mock 釘住 trpc；orb-agent-roles 用真資料；Radix 需 ResizeObserver polyfill。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";

const h = vi.hoisted(() => ({
  list: { data: undefined as unknown, isLoading: false, isError: false, refetch: vi.fn() },
  cost: { data: undefined as unknown, isLoading: false, isError: false, refetch: vi.fn() },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    spirit: { listModels: { useQuery: () => h.list } },
    director: { estimateSegmentCost: { useQuery: () => h.cost } },
  },
}));

// jsdom 無 ResizeObserver；Radix（react-use-size）需要 → polyfill。
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub;

import { AgentCatalogBody } from "./AgentCatalog";

const MODELS = [
  { modelId: "fal-ai/flux/dev", label: "FLUX dev", category: "text-to-image", tier: "standard", description: "圖像生成" },
];
const LIST = { spirit: "image-specialist", categories: ["text-to-image"], models: MODELS };
const COST = [{ modality: "image", modelId: "fal-ai/flux/dev", modelLabel: "FLUX dev", points: 12, breakdown: {}, available: true }];

beforeEach(() => {
  h.list.data = LIST;
  h.list.isLoading = false;
  h.list.isError = false;
  h.cost.data = COST;
  h.cost.isLoading = false;
  h.cost.isError = false;
});

afterEach(() => cleanup());

describe("AgentCatalog（I-1 / AIDV-79 Phase 1）", () => {
  it("精靈選單渲染＋預設選第一位專精", () => {
    render(<AgentCatalogBody />);
    const sel = screen.getByLabelText("選擇精靈") as HTMLSelectElement;
    expect(sel.value).toBe("image-specialist");
    expect(sel.querySelectorAll("option").length).toBeGreaterThan(1);
  });

  it("列出精靈可用模型（label / modelId / tier）", () => {
    render(<AgentCatalogBody />);
    expect(screen.getByText("FLUX dev")).toBeTruthy();
    expect(screen.getByText("fal-ai/flux/dev")).toBeTruthy();
    expect(screen.getByText("standard")).toBeTruthy();
  });

  it("每個模型顯示預估成本（依 modelId 合併 estimateSegmentCost）", () => {
    render(<AgentCatalogBody />);
    expect(screen.getByText(/約 12 點/)).toBeTruthy();
  });

  it("切換精靈 → select 值更新", () => {
    render(<AgentCatalogBody />);
    const sel = screen.getByLabelText("選擇精靈") as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: "video-specialist" } });
    expect(sel.value).toBe("video-specialist");
  });

  it("載入中 → PanelLoading、不渲染模型", () => {
    h.list.isLoading = true;
    h.list.data = undefined;
    render(<AgentCatalogBody />);
    expect(screen.getByText("讀取精靈可用模型…")).toBeTruthy();
    expect(screen.queryByText("FLUX dev")).toBeNull();
  });

  it("錯誤 → PanelError 訊息", () => {
    h.list.isError = true;
    h.list.data = undefined;
    render(<AgentCatalogBody />);
    expect(screen.getByText(/精靈模型讀取失敗/)).toBeTruthy();
  });

  it("空模型 → 空狀態文案", () => {
    h.list.data = { spirit: "learning-specialist", categories: [], models: [] };
    render(<AgentCatalogBody />);
    expect(screen.getByText(/沒有可用的 fal 模型/)).toBeTruthy();
  });
});
