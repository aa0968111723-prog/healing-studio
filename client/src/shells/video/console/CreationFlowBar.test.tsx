// @vitest-environment jsdom
/**
 * CreationFlowBar（U-2 / AIDV-92 逐殼採用 · /video S2）行為測試。
 * 守住頂部創作流程列兩條路徑：
 *   · 旗標 OFF（預設）＝既有 <ol> 流程列＝零變化（無 role="tablist"、不進 .aidv-kit）。
 *   · 旗標 ON       ＝design-kit 亮色暖光 FlowBar（role="tablist"、進 .aidv-kit、保留步驟名稱）。
 * 並驗 onJump 接回既有行為：一般步→setCanvasMode；待後端步→toast 且不切畫布。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { freshDefaultWorkflow } from "./workflowSteps";

const flags = vi.hoisted(() => ({ chrome: false }));
vi.mock("@/config/featureFlags", () => ({
  get ENABLE_AIDV_CHROME() { return flags.chrome; },
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    apiUsage: {
      textLlmStatus: { useQuery: () => ({ data: undefined }) },
    },
  },
}));

const h = vi.hoisted(() => ({
  setCanvasMode: vi.fn(),
  scheduleGeneration: vi.fn(),
  setProvider: vi.fn(),
  openDrawer: vi.fn(),
  toast: vi.fn(),
  canvasMode: "chat" as string,
  steps: null as unknown[] | null,
  shots: [] as unknown[],
}));
vi.mock("sonner", () => ({ toast: (...a: unknown[]) => h.toast(...a) }));
vi.mock("@/spine/ProjectSpineProvider", () => ({
  useProjectSpine: () => ({
    project: { shots: h.shots, characters: [], scenes: [], stageIndex: 0 },
    scheduleGeneration: h.scheduleGeneration,
    setProvider: h.setProvider,
    provider: "mock",
  }),
}));
vi.mock("../DirectorConsoleProvider", () => ({
  useDirectorConsole: () => ({
    steps: h.steps ?? freshDefaultWorkflow(),
    canvasMode: h.canvasMode,
    setCanvasMode: h.setCanvasMode,
    openDrawer: h.openDrawer,
  }),
}));

import { CreationFlowBar } from "./CreationFlowBar";

beforeEach(() => {
  h.setCanvasMode.mockReset(); h.toast.mockReset(); h.canvasMode = "chat"; h.steps = null; h.shots = [];
});
afterEach(() => { cleanup(); flags.chrome = false; });

describe("CreationFlowBar（U-2 / AIDV-92 · /video S2）", () => {
  it("旗標 OFF（預設）：既有 <ol> 流程列，步驟名稱在、無 tablist、未進設計套件範圍", () => {
    flags.chrome = false;
    const { container } = render(<CreationFlowBar onGuided={vi.fn()} />);
    expect(screen.getByText("腳本意圖")).toBeTruthy();
    expect(screen.getByText("多模態素材")).toBeTruthy();
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.querySelector(".aidv-kit")).toBeNull();
  });

  it("旗標 ON：改用 design-kit FlowBar（role=tablist、進 .aidv-kit、保留步驟名稱）", () => {
    flags.chrome = true;
    const { container } = render(<CreationFlowBar onGuided={vi.fn()} />);
    expect(screen.getByText("腳本意圖")).toBeTruthy();
    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
  });

  it("旗標 ON：點一般步『多模態素材』→ 切對應畫布（setCanvasMode('asset')）", () => {
    flags.chrome = true;
    render(<CreationFlowBar onGuided={vi.fn()} />);
    fireEvent.click(screen.getByText("多模態素材"));
    expect(h.setCanvasMode).toHaveBeenCalledWith("asset");
  });

  it("旗標 ON：點『打包初剪』→ 切初剪畫布（setCanvasMode('rough-cut')，S4 已接）", () => {
    flags.chrome = true;
    render(<CreationFlowBar onGuided={vi.fn()} />);
    fireEvent.click(screen.getByText("打包初剪"));
    expect(h.setCanvasMode).toHaveBeenCalledWith("rough-cut");
  });

  it("旗標 ON：點『配音/環境音』（AIDV-12）→ 切配音畫布（setCanvasMode('voice')）", () => {
    flags.chrome = true;
    h.steps = [{ id: "voice", name: "配音/環境音", required: false, enabled: true, canvasMode: "voice" }];
    render(<CreationFlowBar onGuided={vi.fn()} />);
    fireEvent.click(screen.getByText("配音/環境音"));
    expect(h.setCanvasMode).toHaveBeenCalledWith("voice");
  });

  it("旗標 ON：點『配樂』（AIDV-12）→ 切配樂畫布（setCanvasMode('music')）", () => {
    flags.chrome = true;
    h.steps = [{ id: "music", name: "配樂", required: false, enabled: true, canvasMode: "music" }];
    render(<CreationFlowBar onGuided={vi.fn()} />);
    fireEvent.click(screen.getByText("配樂"));
    expect(h.setCanvasMode).toHaveBeenCalledWith("music");
  });

  it("旗標 ON：點待後端步（pending）→ 提示 toast 且不切畫布", () => {
    flags.chrome = true;
    h.steps = [{ id: "pend", name: "待後端步", required: false, enabled: true, canvasMode: "chat", pending: true }];
    render(<CreationFlowBar onGuided={vi.fn()} />);
    fireEvent.click(screen.getByText("待後端步"));
    expect(h.toast).toHaveBeenCalledTimes(1);
    expect(h.setCanvasMode).not.toHaveBeenCalled();
  });

  // AIDV-234：匯出對話框中字幕 CC 區段顯示「待語音軌」狀態（非靜默 no-op）
  it("（AIDV-234）匯出對話框展示字幕 / CC 區段，標示「待語音軌」而非靜默忽略", () => {
    h.shots = [
      { id: "s1", no: "S01", act: 1, title: "晨光", route: "text", characterIds: [], sceneId: null,
        seed: 1, approval: "pending", stale: false, gen: { status: "done", variant: 0, assetUrl: "/media/s01.mp4" } },
    ];
    render(<CreationFlowBar onGuided={vi.fn()} />);
    fireEvent.click(screen.getByText(/匯出素材包/));
    expect(screen.getByText(/字幕 \/ CC（SRT/)).toBeTruthy();
    expect(screen.getByText("待語音軌")).toBeTruthy();
  });
});
