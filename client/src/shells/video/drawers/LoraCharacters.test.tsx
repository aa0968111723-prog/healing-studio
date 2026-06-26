// @vitest-environment jsdom
/**
 * LoraCharacters（I-7 角色 LoRA 一致性，AIDV-85 唯讀 Phase 1）行為測試。
 *
 * 守住：
 *   1. 本專案角色列出＋LoRA 狀態徽章；已完成→已就緒、未訓練→可訓練提示。
 *   2. LoRA 模型庫列出（worldbuilding.linkableModels）：name/status/triggerWord。
 *   3. 四態：無角色→提示；模型庫 載入中/錯誤/空。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  models: { data: undefined as unknown, isLoading: false, isError: false, refetch: vi.fn() },
  spine: { project: { characters: [] as unknown[] } as unknown },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: { worldbuilding: { linkableModels: { useQuery: () => h.models } } },
}));
vi.mock("@/spine/ProjectSpineProvider", () => ({ useProjectSpine: () => h.spine }));

// jsdom 無 ResizeObserver；保險 polyfill（與其他抽屜測試一致）。
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub;

import { LoraCharactersBody } from "./LoraCharacters";

const CHARS = [
  { id: "c1", name: "小明", emoji: "🧑", loraStatus: "已完成", linkedModelId: 1 },
  { id: "c2", name: "小華", emoji: "👧", loraStatus: "未訓練" },
];
const MODELS = [{ id: 1, name: "小明 LoRA", modelType: "flux-lora", status: "ready", triggerWord: "xiaoming", trainedLoraUrl: "https://example.com/lora.safetensors" }];

beforeEach(() => {
  h.spine.project = { characters: CHARS };
  h.models.data = MODELS;
  h.models.isLoading = false;
  h.models.isError = false;
});

afterEach(() => cleanup());

describe("LoraCharacters（I-7 / AIDV-85 唯讀 Phase 1）", () => {
  it("列出角色＋LoRA 狀態（已就緒／可訓練）", () => {
    render(<LoraCharactersBody />);
    expect(screen.getByText(/🧑 小明/)).toBeTruthy();
    expect(screen.getByText("LoRA 已就緒")).toBeTruthy();
    expect(screen.getByText(/👧 小華/)).toBeTruthy();
    expect(screen.getByText(/可訓練 LoRA/)).toBeTruthy();
  });

  it("linkedModelId 推得『已就緒』（即使 loraStatus 仍未訓練）— Codex review 修正", () => {
    h.spine.project = { characters: [{ id: "c9", name: "阿明", emoji: "🧒", loraStatus: "未訓練", linkedModelId: 9 }] };
    h.models.data = [{ id: 9, name: "阿明 LoRA", modelType: "flux-lora", status: "ready", triggerWord: "aming", trainedLoraUrl: "https://example.com/lora-9.safetensors" }];
    render(<LoraCharactersBody />);
    expect(screen.getByText("LoRA 已就緒")).toBeTruthy();
    expect(screen.queryByText(/可訓練 LoRA/)).toBeNull();
  });

  it("列出 LoRA 模型庫（name / 可用 / triggerWord）", () => {
    render(<LoraCharactersBody />);
    expect(screen.getByText("小明 LoRA")).toBeTruthy();
    expect(screen.getByText("可用")).toBeTruthy();
    expect(screen.getAllByText("xiaoming").length).toBeGreaterThan(0);
  });

  it("無角色 → 提示", () => {
    h.spine.project = { characters: [] };
    render(<LoraCharactersBody />);
    expect(screen.getByText(/此專案無角色/)).toBeTruthy();
  });

  it("模型庫載入中 → PanelLoading", () => {
    h.models.isLoading = true;
    h.models.data = undefined;
    render(<LoraCharactersBody />);
    expect(screen.getByText("讀取 LoRA 模型…")).toBeTruthy();
  });

  it("模型庫錯誤 → PanelError", () => {
    h.models.isError = true;
    h.models.data = undefined;
    render(<LoraCharactersBody />);
    expect(screen.getByText(/LoRA 模型讀取失敗/)).toBeTruthy();
  });

  it("模型庫空 → 提示可訓練", () => {
    h.models.data = [];
    render(<LoraCharactersBody />);
    expect(screen.getByText(/還沒有訓練好的 LoRA/)).toBeTruthy();
  });
});
