// @vitest-environment jsdom
/**
 * ModelCatalog（W1-5 單模型遊樂場統一目錄頁）行為測試。
 *
 * 守住驗收：
 *   1. registry 為準：情報層（catalog）載入中 / 失敗，目錄仍渲染全部 registry 模型卡。
 *   2. 領域分頁＝只顯示該領域；搜尋＝跨 label/modelId/provider/優勢 過濾。
 *   3. catalog 當情報層：對得上 id 的卡才 enrich（tagline＋事實查核新鮮度）；對不上不編造。
 *   4. 情報層失敗 → 顯示可重試錯誤條，但 registry 卡照常（不被情報層拖垮）。
 *   5. 選「文字生圖」模型 → 就地試生成走既有 generation 接縫（model 帶該 modelId）。
 *
 * 沿用 repo 慣例：模組級 vi.mock 釘 @/lib/trpc 與 SpineProvider；registry 用真資料，
 * 預期值都從 UNIFIED_MODEL_REGISTRY 推導，避免硬編列表。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";

const { listState, generateMock } = vi.hoisted(() => ({
  listState: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  generateMock: vi.fn(async (_input: Record<string, unknown>) => ({ model: "flux-pro", seedUsed: 4321, provider: "hf", costUsd: 0.01 })),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    aiModels: {
      list: { useQuery: () => listState },
    },
  },
}));

vi.mock("@/providers/SpineProvider", () => ({
  useSpine: () => ({
    provider: "hf",
    adapters: { generation: { generate: generateMock } },
  }),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
}));

import { ModelCatalogBody } from "./ModelCatalog";
import { DOMAIN_META } from "@/shells/_shared/ModelCard";
import { UNIFIED_MODEL_REGISTRY } from "@shared/unifiedModelRegistry";

const TOTAL = UNIFIED_MODEL_REGISTRY.length;
const T2I = UNIFIED_MODEL_REGISTRY.filter((m) => m.domain === "text-to-image");
const SAMPLE0 = UNIFIED_MODEL_REGISTRY[0];

/** catalog 就緒回應（meta 齊；models 由各案自行覆蓋）。 */
function readyData(models: unknown[] = []) {
  return {
    models,
    meta: { total: models.length, shown: models.length, verifiedCount: 0, staleCount: 0, coverage: 0, lastResearchAt: null, staleThresholdDays: 30 },
  };
}

/** 找領域分頁鈕（避免和卡片內的領域 badge 撞名）。 */
function domainTab(container: HTMLElement, domain: keyof typeof DOMAIN_META): HTMLButtonElement {
  const text = `${DOMAIN_META[domain].emoji} ${DOMAIN_META[domain].label}`;
  const btn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);
  if (!btn) throw new Error(`找不到領域分頁：${text}`);
  return btn as HTMLButtonElement;
}

beforeEach(() => {
  listState.data = readyData([]);
  listState.isLoading = false;
  listState.isError = false;
  generateMock.mockClear();
});

afterEach(() => cleanup());

describe("ModelCatalog 統一目錄頁（W1-5）", () => {
  it("registry 為準：情報層載入中也照顯全部模型卡", () => {
    listState.isLoading = true;
    listState.data = undefined;
    render(<ModelCatalogBody />);
    expect(screen.getAllByTestId("modelcard").length).toBe(TOTAL);
    expect(screen.getByTestId("catalog-intel-strip").textContent).toContain("載入中");
  });

  it("領域分頁＝只顯示該領域模型", () => {
    const { container } = render(<ModelCatalogBody />);
    expect(screen.getAllByTestId("modelcard").length).toBe(TOTAL);
    fireEvent.click(domainTab(container, "text-to-image"));
    expect(screen.getAllByTestId("modelcard").length).toBe(T2I.length);
  });

  it("搜尋＝跨欄位過濾，命中的卡仍在", () => {
    const { container } = render(<ModelCatalogBody />);
    const token = SAMPLE0.label;
    fireEvent.change(screen.getByPlaceholderText(/搜尋型號/), { target: { value: token } });
    const cards = screen.getAllByTestId("modelcard");
    expect(cards.length).toBeGreaterThanOrEqual(1);
    expect(cards.length).toBeLessThanOrEqual(TOTAL);
    expect(container.querySelector(`[data-model-id="${SAMPLE0.modelId}"]`)).toBeTruthy();
  });

  it("catalog 當情報層：對得上 id 的卡 enrich（tagline＋新鮮度），對不上不編造", () => {
    listState.data = readyData([
      { id: SAMPLE0.modelId, tagline: "INTEL_TAGLINE_XYZ", officialUrl: "https://example.com", factCheck: { status: "verified" }, featured: true },
    ]);
    render(<ModelCatalogBody />);
    expect(screen.getAllByText("INTEL_TAGLINE_XYZ").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/已查證/).length).toBeGreaterThanOrEqual(1);
    // 沒對到的型號不應冒出情報區塊：情報卡數 < 全部卡數
    expect(screen.getAllByTestId("modelcard-intel").length).toBeLessThan(TOTAL);
  });

  it("情報層失敗：顯示可重試錯誤條，但 registry 卡照常", () => {
    listState.isError = true;
    listState.data = undefined;
    render(<ModelCatalogBody />);
    expect(screen.getByText(/情報層讀取失敗/)).toBeTruthy();
    expect(screen.getAllByTestId("modelcard").length).toBe(TOTAL);
  });

  it("選文字生圖模型 → 就地試生成走 generation 接縫（model 帶該 modelId）", async () => {
    const sample = T2I[0];
    const { container } = render(<ModelCatalogBody />);
    const card = container.querySelector(`[data-model-id="${sample.modelId}"]`) as HTMLElement;
    expect(card).toBeTruthy();
    fireEvent.click(card);

    expect(screen.getByTestId("model-detail")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/試生成一張/), { target: { value: "a calm snowy peak" } });
    fireEvent.click(screen.getByRole("button", { name: /試生成/ }));

    await waitFor(() => expect(generateMock).toHaveBeenCalled());
    const arg = generateMock.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.model).toBe(sample.modelId);
    expect(arg.prompt).toBe("a calm snowy peak");
  });
});
