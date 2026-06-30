// @vitest-environment jsdom
/**
 * CreationFlowBar × S2 跳階補齊精靈（AIDV-95 / U-5，旗標 ENABLE_VIDEO_GATE_KIT）行為測試。
 * 守住：
 *   · 旗標 OFF（預設）＝跳階直接切畫布、無 ⚠N 徽章、無精靈＝零變化（既有 CreationFlowBar.test 已覆蓋，這裡再確認 OFF）。
 *   · 旗標 ON 且目標前置缺料 → 攔下彈精靈（不立即切畫布）；「仍要前往」→ 切目標；「回頭引導」→ 切上一階段。
 *   · 旗標 ON 且前置齊備 → 直接切畫布（不彈精靈）。
 *   · 旗標 ON ＝缺料步驟顯示「⚠N」徽章。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import { freshDefaultWorkflow } from "./workflowSteps";

const flags = vi.hoisted(() => ({ chrome: false, gateKit: true }));
vi.mock("@/config/featureFlags", () => ({
  get ENABLE_AIDV_CHROME() { return flags.chrome; },
}));
vi.mock("@/config/videoFlags", async (orig) => ({
  ...(await orig<typeof import("@/config/videoFlags")>()),
  get ENABLE_VIDEO_GATE_KIT() { return flags.gateKit; },
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    apiUsage: { textLlmStatus: { useQuery: () => ({ data: undefined }) } },
    brain: { providerSystemStatus: { useQuery: () => ({ data: undefined }) } },
  },
}));

const h = vi.hoisted(() => ({
  setCanvasMode: vi.fn(),
  scheduleGeneration: vi.fn(),
  setProvider: vi.fn(),
  setCoverShot: vi.fn(),
  openDrawer: vi.fn(),
  toast: vi.fn(),
  shots: [] as unknown[],
  characters: [] as unknown[],
  scenes: [] as unknown[],
}));
vi.mock("sonner", () => ({ toast: (...a: unknown[]) => h.toast(...a) }));
vi.mock("@/spine/ProjectSpineProvider", () => ({
  useProjectSpine: () => ({
    project: { shots: h.shots, characters: h.characters, scenes: h.scenes, stageIndex: 0, coverShotId: null },
    scheduleGeneration: h.scheduleGeneration,
    setProvider: h.setProvider,
    setCoverShot: h.setCoverShot,
    provider: "mock",
  }),
}));
vi.mock("../DirectorConsoleProvider", () => ({
  useDirectorConsole: () => ({
    steps: freshDefaultWorkflow(),
    canvasMode: "chat",
    setCanvasMode: h.setCanvasMode,
    openDrawer: h.openDrawer,
  }),
}));

import { CreationFlowBar } from "./CreationFlowBar";

const textShot = {
  id: "s1", no: "S01", act: 1, title: "晨光", route: "text", characterIds: [], sceneId: null,
  seed: 1, approval: "pending", stale: false, gen: { status: "idle", variant: 0 },
};

beforeEach(() => {
  h.setCanvasMode.mockReset(); h.toast.mockReset();
  flags.chrome = false; flags.gateKit = true;
  h.shots = []; h.characters = []; h.scenes = [];
});
afterEach(() => { cleanup(); });

describe("CreationFlowBar × S2 補齊精靈（旗標 ENABLE_VIDEO_GATE_KIT）", () => {
  it("旗標 ON：跳『多模態素材』但無分鏡 → 彈精靈、暫不切畫布", () => {
    render(<CreationFlowBar onGuided={vi.fn()} />);
    fireEvent.click(screen.getByText("多模態素材"));
    expect(screen.getAllByText(/前往「多模態素材」前，還有待補/).length).toBeGreaterThan(0);
    expect(h.setCanvasMode).not.toHaveBeenCalled();
  });

  it("旗標 ON：精靈『仍要前往』→ 切到目標畫布（setCanvasMode('asset')）", () => {
    render(<CreationFlowBar onGuided={vi.fn()} />);
    fireEvent.click(screen.getByText("多模態素材"));
    const dialog = screen.getAllByRole("dialog").at(-1)!;
    fireEvent.click(within(dialog).getByRole("button", { name: /仍要前往/ }));
    expect(h.setCanvasMode).toHaveBeenCalledWith("asset");
  });

  it("旗標 ON：精靈『回頭引導』→ 切到上一階段（setCanvasMode('script')）", () => {
    render(<CreationFlowBar onGuided={vi.fn()} />);
    fireEvent.click(screen.getByText("多模態素材"));
    const dialog = screen.getAllByRole("dialog").at(-1)!;
    fireEvent.click(within(dialog).getByRole("button", { name: /回腳本意圖/ }));
    expect(h.setCanvasMode).toHaveBeenCalledWith("script");
  });

  it("旗標 ON 且前置齊備（有就緒 text 鏡）→ 直接切畫布、不彈精靈", () => {
    h.shots = [textShot];
    render(<CreationFlowBar onGuided={vi.fn()} />);
    fireEvent.click(screen.getByText("多模態素材"));
    expect(screen.queryByText(/還有待補/)).toBeNull();
    expect(h.setCanvasMode).toHaveBeenCalledWith("asset");
  });

  it("旗標 ON：缺料步驟顯示「⚠N」徽章", () => {
    render(<CreationFlowBar onGuided={vi.fn()} />);
    expect(screen.getAllByText(/⚠1/).length).toBeGreaterThan(0);
  });

  it("旗標 OFF：跳階直接切畫布、無精靈、無徽章（零變化）", () => {
    flags.gateKit = false;
    render(<CreationFlowBar onGuided={vi.fn()} />);
    fireEvent.click(screen.getByText("多模態素材"));
    expect(h.setCanvasMode).toHaveBeenCalledWith("asset");
    expect(screen.queryByText(/還有待補/)).toBeNull();
    expect(screen.queryByText(/⚠/)).toBeNull();
  });
});
