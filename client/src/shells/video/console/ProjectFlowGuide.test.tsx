// @vitest-environment jsdom
/**
 * ProjectFlowGuide（I-6 創作流程嚮導，AIDV-84 · Phase 1 唯讀導航）行為測試。
 *
 * 守住：
 *   1. 由既有專案資料推導四步（世界觀/劇本/分鏡/生成）狀態與「下一步」。
 *   2. 點劇本/分鏡/生成 → 切對應中欄畫布；世界觀步唯狀態、不可點（零誤動作）。
 *   3. 無分鏡時「分鏡」導向 script（去產生骨架），有分鏡時導向 shot。
 *   4. 全齊 → 顯示「全部就緒」。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => ({
  setCanvasMode: vi.fn(),
  project: null as unknown,
}));

vi.mock("@/spine/ProjectSpineProvider", () => ({ useProjectSpine: () => ({ project: h.project }) }));
vi.mock("../DirectorConsoleProvider", () => ({ useDirectorConsole: () => ({ setCanvasMode: h.setCanvasMode }) }));

import { ProjectFlowGuide } from "./ProjectFlowGuide";

function shot(over: Record<string, unknown> = {}) {
  return {
    id: "sh1", no: "S01", act: 1, title: "x", route: "text", characterIds: [], sceneId: null,
    seed: 1, approval: "pending", stale: false, gen: { status: "idle", variant: 0 }, ...over,
  };
}

function makeProject(over: Record<string, unknown> = {}) {
  return {
    id: "1", name: "測試", emoji: "🎬", type: "影片", logline: "", styleBible: "", stageIndex: 0,
    characters: [], scenes: [], shots: [], notes: [], assets: [], promptBlocks: [],
    packet: { summaryMarkdown: "", sourceRefs: [], tokenEstimate: 0, ttlSec: 0, permissions: "" },
    updatedAt: 0, worldFrameworkId: null, worldStyle: undefined, ...over,
  };
}

beforeEach(() => {
  h.setCanvasMode.mockReset();
  h.project = makeProject();
});
afterEach(() => cleanup());

describe("ProjectFlowGuide（I-6 / AIDV-84）", () => {
  it("空專案 → 下一步＝世界觀；四步皆顯示", () => {
    render(<ProjectFlowGuide />);
    expect(screen.getByText(/下一步：世界觀/)).toBeTruthy();
    expect(screen.getByText("劇本")).toBeTruthy();
    expect(screen.getByText("分鏡")).toBeTruthy();
    expect(screen.getByText("生成")).toBeTruthy();
  });

  it("點「劇本」→ 切 script 畫布", () => {
    render(<ProjectFlowGuide />);
    fireEvent.click(screen.getByText("劇本"));
    expect(h.setCanvasMode).toHaveBeenCalledWith("script");
  });

  it("無分鏡時「分鏡」導向 script；有分鏡時導向 shot", () => {
    const { rerender } = render(<ProjectFlowGuide />);
    fireEvent.click(screen.getByText("分鏡"));
    expect(h.setCanvasMode).toHaveBeenLastCalledWith("script");

    h.project = makeProject({ shots: [shot()] });
    rerender(<ProjectFlowGuide />);
    fireEvent.click(screen.getByText("分鏡"));
    expect(h.setCanvasMode).toHaveBeenLastCalledWith("shot");
  });

  it("世界觀步唯狀態（點擊不切畫布）", () => {
    render(<ProjectFlowGuide />);
    fireEvent.click(screen.getByText("世界觀"));
    expect(h.setCanvasMode).not.toHaveBeenCalled();
  });

  it("世界已連結 + 有分鏡 + 有素材 → 全部就緒", () => {
    h.project = makeProject({
      worldFrameworkId: 7,
      stageIndex: 3,
      shots: [shot({ approval: "approved", gen: { status: "done", variant: 0 } })],
      assets: [{ id: "a1", kind: "image", provider: "mock", modelId: "m", sourceStudio: "video-studio", costUsd: 0, ts: "now" }],
    });
    render(<ProjectFlowGuide />);
    expect(screen.getByText(/全部就緒/)).toBeTruthy();
  });
});
