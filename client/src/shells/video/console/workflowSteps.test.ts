/**
 * workflowSteps（AIDV-12 配音/配樂工作流）測試。
 * 守住旗標 ENABLE_VOICE_MUSIC_WORKFLOW 兩態：
 *   · OFF（預設）＝ freshDefaultWorkflow() 與既有六步位元相同（零行為改變），不含 voice/music。
 *   · ON         ＝ 在「打包初剪（rough）」之後插入 voice→music 兩步，順序合理，canvasMode 對映正確。
 * 以 vi.mock 切換旗標、vi.resetModules 重載被測模組（旗標於 import 期讀取）。
 */
import { describe, it, expect, vi, afterEach } from "vitest";

const flag = vi.hoisted(() => ({ on: false }));
vi.mock("@/config/videoFlags", () => ({
  get ENABLE_VOICE_MUSIC_WORKFLOW() {
    return flag.on;
  },
}));

afterEach(() => {
  flag.on = false;
  vi.resetModules();
});

async function loadModule() {
  vi.resetModules();
  return import("./workflowSteps");
}

describe("workflowSteps · AIDV-12 配音/配樂工作流（旗標 gate）", () => {
  it("旗標 OFF（預設）：freshDefaultWorkflow() 不含 voice/music，與既有六步完全相同", async () => {
    flag.on = false;
    const m = await loadModule();
    const wf = m.freshDefaultWorkflow();
    expect(wf.map((s) => s.id)).toEqual(["intent", "entry", "asset", "rough", "gate", "done"]);
    expect(wf.find((s) => s.id === "voice")).toBeUndefined();
    expect(wf.find((s) => s.id === "music")).toBeUndefined();
  });

  it("旗標 OFF：DEFAULT_WORKFLOW 靜態常數本身不含 voice/music（位元相同保證）", async () => {
    flag.on = false;
    const m = await loadModule();
    expect(m.DEFAULT_WORKFLOW.map((s) => s.id)).toEqual([
      "intent",
      "entry",
      "asset",
      "rough",
      "gate",
      "done",
    ]);
  });

  it("旗標 OFF：voice/music 仍留在 STEP_LIBRARY，可手動加入", async () => {
    flag.on = false;
    const m = await loadModule();
    const ids = m.STEP_LIBRARY.map((s) => s.id);
    expect(ids).toContain("voice");
    expect(ids).toContain("music");
  });

  it("旗標 ON：freshDefaultWorkflow() 含 voice+music，插在 rough 之後、gate 之前", async () => {
    flag.on = true;
    const m = await loadModule();
    const wf = m.freshDefaultWorkflow();
    expect(wf.map((s) => s.id)).toEqual([
      "intent",
      "entry",
      "asset",
      "rough",
      "voice",
      "music",
      "gate",
      "done",
    ]);
  });

  it("旗標 ON：voice/music canvasMode 對映正確且非必經（required:false）", async () => {
    flag.on = true;
    const m = await loadModule();
    const wf = m.freshDefaultWorkflow();
    const voice = wf.find((s) => s.id === "voice");
    const music = wf.find((s) => s.id === "music");
    expect(voice?.canvasMode).toBe("voice");
    expect(music?.canvasMode).toBe("music");
    expect(voice?.required).toBe(false);
    expect(music?.required).toBe(false);
    expect(voice?.enabled).toBe(true);
    expect(music?.enabled).toBe(true);
  });

  it("旗標 ON：既有六步順序不變、無移除/無重排（純加法）", async () => {
    flag.on = true;
    const m = await loadModule();
    const ids = m.freshDefaultWorkflow().map((s) => s.id);
    const existing = ids.filter((id) => id !== "voice" && id !== "music");
    expect(existing).toEqual(["intent", "entry", "asset", "rough", "gate", "done"]);
  });

  it("旗標 ON：STEP_LIBRARY 不再重覆列 voice/music（避免 WorkflowBuilder 加入鈕永遠灰掉）", async () => {
    flag.on = true;
    const m = await loadModule();
    const ids = m.STEP_LIBRARY.map((s) => s.id);
    expect(ids).not.toContain("voice");
    expect(ids).not.toContain("music");
  });

  it("旗標 ON：回傳是深複製，就地改動不污染下一次取得", async () => {
    flag.on = true;
    const m = await loadModule();
    const a = m.freshDefaultWorkflow();
    a[0].name = "tampered";
    const b = m.freshDefaultWorkflow();
    expect(b[0].name).not.toBe("tampered");
  });
});
