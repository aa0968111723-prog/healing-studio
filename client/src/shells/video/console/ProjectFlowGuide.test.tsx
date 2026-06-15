// @vitest-environment jsdom
/**
 * ProjectFlowGuide（I-6 創作流程嚮導，AIDV-84）行為測試。
 *
 * 守住：
 *   1. 由既有專案資料推導五步（世界觀/劇本/分鏡/生成/成片，鏡像北極星 logline→成片）狀態與「下一步」。
 *   2. Phase 1 導航：點劇本/分鏡/生成 → 切對應中欄畫布；世界觀/成片步唯狀態、不可點。
 *   3. 無分鏡時「分鏡」導向 script（去產生骨架），有分鏡時導向 shot。
 *   4. Phase 2 動作鏈：劇本步主鈕→開引導式創作（onGuided）；生成步主鈕→排程就緒鏡（scheduleGeneration）。
 *   5. 全部生成 → 顯示「🎬 可成片」。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => ({
  setCanvasMode: vi.fn(),
  scheduleGeneration: vi.fn(),
  onGuided: vi.fn(),
  project: null as unknown,
}));

vi.mock("@/spine/ProjectSpineProvider", () => ({
  useProjectSpine: () => ({ project: h.project, scheduleGeneration: h.scheduleGeneration }),
}));
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
  h.scheduleGeneration.mockReset();
  h.onGuided.mockReset();
  h.project = makeProject();
});
afterEach(() => cleanup());

describe("ProjectFlowGuide（I-6 / AIDV-84）", () => {
  it("空專案 → 下一步＝世界觀；五步皆顯示（含成片）", () => {
    render(<ProjectFlowGuide />);
    expect(screen.getByText(/下一步：世界觀/)).toBeTruthy();
    expect(screen.getByText("劇本")).toBeTruthy();
    expect(screen.getByText("分鏡")).toBeTruthy();
    expect(screen.getByText("生成")).toBeTruthy();
    expect(screen.getByText("成片")).toBeTruthy();
  });

  it("點「劇本」步列 → 切 script 畫布", () => {
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

  it("Phase 2：劇本為當前步＋有 onGuided → 主鈕開引導式創作", () => {
    h.project = makeProject({ worldFrameworkId: 7 }); // 世界已連結、劇本未開始 → 當前步＝劇本
    render(<ProjectFlowGuide onGuided={h.onGuided} />);
    fireEvent.click(screen.getByText("開始引導式創作"));
    expect(h.onGuided).toHaveBeenCalledTimes(1);
  });

  it("Phase 2：生成為當前步 → 主鈕排程就緒鏡（scheduleGeneration）", () => {
    h.project = makeProject({ worldFrameworkId: 7, stageIndex: 2, shots: [shot()] }); // 就緒未生成 → 當前步＝生成
    render(<ProjectFlowGuide />);
    fireEvent.click(screen.getByText(/生成就緒鏡（1）/));
    expect(h.scheduleGeneration).toHaveBeenCalledTimes(1);
  });

  it("部分生成（S01 已生成、S02 仍就緒）→ 生成仍為當前步、不顯示可成片（Codex P2 回歸）", () => {
    h.project = makeProject({
      worldFrameworkId: 7,
      stageIndex: 3,
      shots: [
        shot({ id: "sh1", no: "S01", gen: { status: "done", variant: 0 } }),
        shot({ id: "sh2", no: "S02", gen: { status: "idle", variant: 0 } }),
      ],
      assets: [{ id: "a1", kind: "image", provider: "mock", modelId: "m", sourceStudio: "video-studio", costUsd: 0, ts: "now" }],
    });
    render(<ProjectFlowGuide />);
    expect(screen.getByText("下一步：生成")).toBeTruthy(); // 未進成片，生成仍為當前步
    expect(screen.getByText(/生成就緒鏡（1）/)).toBeTruthy();
  });

  it("世界已連結 + 全部鏡已生成 → 顯示「🎬 可成片」", () => {
    h.project = makeProject({
      worldFrameworkId: 7,
      stageIndex: 4,
      shots: [shot({ approval: "approved", gen: { status: "done", variant: 0 } })],
      assets: [{ id: "a1", kind: "image", provider: "mock", modelId: "m", sourceStudio: "video-studio", costUsd: 0, ts: "now" }],
    });
    render(<ProjectFlowGuide />);
    expect(screen.getByText(/可成片/)).toBeTruthy();
  });
});
