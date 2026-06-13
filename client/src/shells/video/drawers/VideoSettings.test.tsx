// @vitest-environment jsdom
/**
 * VideoSettings（W1-6 per-引擎設定面板＋個人化面板完善）行為測試。
 *
 * 守住驗收：
 *   1. 生成引擎按鈕 → spine.setProvider。
 *   2. per-引擎（2-16）：每個模態一個 <select>，選項取自 registry；選擇 → setEnginePref(modality, modelId)。
 *   3. 系統預設（brainDefaults）顯示為基準。
 *   4. 個人化（帳號層）開關 → personal.updateSettings（已持久化的 PersonalSettings）。
 *   5. 四態：generationModels 載入中 → PanelLoading、不渲染 select。
 *
 * 沿用 repo 慣例：模組級 vi.mock 釘住 trpc / ProjectSpine / DirectorConsole / PersonalSettings；
 * registry 用真資料，選項預期值從 getModelsByDomain 推導。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";

const h = vi.hoisted(() => ({
  gen: { data: undefined as unknown, isLoading: false, isError: false, refetch: vi.fn() },
  console: {
    showSidecar: true, setShowSidecar: vi.fn(),
    autoSaveDraft: false, setAutoSaveDraft: vi.fn(),
    enginePrefs: {} as Record<string, string>, setEnginePref: vi.fn(),
  },
  spine: { provider: "hf", setProvider: vi.fn() },
  personal: {
    settings: {
      confirmBeforeGenerate: false, compactMode: false, soundEnabled: true,
      desktopNotif: false, orbCuteMode: false, orbRandomFly: false,
    } as Record<string, boolean>,
    updateSettings: vi.fn(),
    syncStatus: "synced",
  },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: { director: { generationModels: { useQuery: () => h.gen } } },
}));
vi.mock("@/spine/ProjectSpineProvider", () => ({ useProjectSpine: () => h.spine }));
vi.mock("../DirectorConsoleProvider", () => ({ useDirectorConsole: () => h.console }));
vi.mock("@/contexts/PersonalSettingsContext", () => ({ usePersonalSettings: () => h.personal }));

import { VideoSettingsBody } from "./VideoSettings";
import { getModelsByDomain } from "@shared/unifiedModelRegistry";

const T2I = getModelsByDomain("text-to-image");

beforeEach(() => {
  h.gen.data = { brainDefaults: {} };
  h.gen.isLoading = false;
  h.gen.isError = false;
  h.console.enginePrefs = {};
  h.spine.provider = "hf";
  h.personal.settings = {
    confirmBeforeGenerate: false, compactMode: false, soundEnabled: true,
    desktopNotif: false, orbCuteMode: false, orbRandomFly: false,
  };
  h.personal.syncStatus = "synced";
  h.spine.setProvider.mockClear();
  h.console.setEnginePref.mockClear();
  h.personal.updateSettings.mockClear();
});

afterEach(() => cleanup());

describe("VideoSettings（W1-6）", () => {
  it("生成引擎按鈕 → spine.setProvider", () => {
    render(<VideoSettingsBody />);
    fireEvent.click(screen.getByRole("button", { name: "fal" }));
    expect(h.spine.setProvider).toHaveBeenCalledWith("fal");
  });

  it("per-引擎 <select> 選項取自 registry；選擇 → setEnginePref(modality, modelId)", () => {
    h.gen.data = { brainDefaults: { "text-to-image": "fal-ai/flux-pro/v1.1" } };
    render(<VideoSettingsBody />);
    const sel = screen.getByLabelText("文字生圖 預設引擎") as HTMLSelectElement;
    // 預設項 + registry 該領域全部模型
    expect(within(sel).getAllByRole("option").length).toBe(T2I.length + 1);

    const pick = T2I[0].modelId;
    fireEvent.change(sel, { target: { value: pick } });
    expect(h.console.setEnginePref).toHaveBeenCalledWith("text-to-image", pick);

    // 清回預設 → null
    fireEvent.change(sel, { target: { value: "" } });
    expect(h.console.setEnginePref).toHaveBeenLastCalledWith("text-to-image", null);
  });

  it("系統預設（brainDefaults）顯示為基準", () => {
    h.gen.data = { brainDefaults: { "text-to-image": "fal-ai/imagen4/preview" } };
    render(<VideoSettingsBody />);
    expect(screen.getAllByText(/fal-ai\/imagen4\/preview/).length).toBeGreaterThanOrEqual(1);
  });

  it("個人化開關 → personal.updateSettings（已持久化）", () => {
    render(<VideoSettingsBody />);
    const label = screen.getByText("生成前先跳確認（成本門）").closest("label") as HTMLElement;
    const sw = label.querySelector('[role="switch"]') as HTMLElement;
    fireEvent.click(sw);
    expect(h.personal.updateSettings).toHaveBeenCalledWith({ confirmBeforeGenerate: true });
  });

  it("generationModels 載入中 → PanelLoading、不渲染 per-引擎 select", () => {
    h.gen.isLoading = true;
    h.gen.data = undefined;
    render(<VideoSettingsBody />);
    expect(screen.getByText("讀取各模態預設引擎…")).toBeTruthy();
    expect(screen.queryByLabelText("文字生圖 預設引擎")).toBeNull();
  });
});
