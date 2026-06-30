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
// 此檔守的是 ENABLE_AIDV_CHROME OFF/ON 的既有跳階行為；S2 跳階守衛（ENABLE_VIDEO_GATE_KIT，
// 由 CreationFlowBar.gatekit.test 覆蓋）固定關閉，避免本機 .env（VITE_ENABLE_VIDEO_GATE_KIT=1）
// 讓本檔非確定性。保留其餘 videoFlags export（freshDefaultWorkflow 需 ENABLE_VOICE_MUSIC_WORKFLOW）。
vi.mock("@/config/videoFlags", async (orig) => ({
  ...(await orig<typeof import("@/config/videoFlags")>()),
  get ENABLE_VIDEO_GATE_KIT() { return false; },
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    apiUsage: {
      textLlmStatus: { useQuery: () => ({ data: undefined }) },
    },
    brain: {
      providerSystemStatus: { useQuery: () => ({ data: undefined }) },
    },
  },
}));

const h = vi.hoisted(() => ({
  setCanvasMode: vi.fn(),
  scheduleGeneration: vi.fn(),
  setProvider: vi.fn(),
  setCoverShot: vi.fn(),
  openDrawer: vi.fn(),
  toast: vi.fn(),
  canvasMode: "chat" as string,
  steps: null as unknown[] | null,
  shots: [] as unknown[],
  coverShotId: null as string | null,
}));
vi.mock("sonner", () => ({ toast: (...a: unknown[]) => h.toast(...a) }));
vi.mock("@/spine/ProjectSpineProvider", () => ({
  useProjectSpine: () => ({
    project: { shots: h.shots, characters: [], scenes: [], stageIndex: 0, coverShotId: h.coverShotId },
    scheduleGeneration: h.scheduleGeneration,
    setProvider: h.setProvider,
    setCoverShot: h.setCoverShot,
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
  h.setCanvasMode.mockReset(); h.toast.mockReset(); h.setCoverShot.mockReset();
  h.canvasMode = "chat"; h.steps = null; h.shots = []; h.coverShotId = null;
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

  // AIDV-246：封面幀選擇
  it("（AIDV-246）匯出對話框：點「設封面」呼叫 setCoverShot(shotId)", () => {
    h.shots = [
      { id: "s1", no: "S01", act: 1, title: "晨光", route: "text", characterIds: [], sceneId: null,
        seed: 1, approval: "pending", stale: false, gen: { status: "done", variant: 0, assetUrl: "/media/s01.mp4" } },
    ];
    render(<CreationFlowBar onGuided={vi.fn()} />);
    fireEvent.click(screen.getByText(/匯出素材包/));
    fireEvent.click(screen.getByTitle("設為封面"));
    expect(h.setCoverShot).toHaveBeenCalledWith("s1");
  });

  it("（AIDV-246）封面幀已選擇：按鈕顯示「封面」、再點呼叫 setCoverShot(null) 取消", () => {
    h.coverShotId = "s1";
    h.shots = [
      { id: "s1", no: "S01", act: 1, title: "晨光", route: "text", characterIds: [], sceneId: null,
        seed: 1, approval: "pending", stale: false, gen: { status: "done", variant: 0, assetUrl: "/media/s01.mp4" } },
    ];
    render(<CreationFlowBar onGuided={vi.fn()} />);
    fireEvent.click(screen.getByText(/匯出素材包/));
    expect(screen.getByTitle("取消封面選擇")).toBeTruthy();
    expect(screen.getByText("封面")).toBeTruthy();
    fireEvent.click(screen.getByTitle("取消封面選擇"));
    expect(h.setCoverShot).toHaveBeenCalledWith(null);
  });
});
