// @vitest-environment jsdom
/**
 * GuidedJourney（從零引導表單，W1-8 細修）行為測試。
 *
 * 守三件事：
 *   1. 拆解失敗 → toast.error 標真實 procedure 名（director.analyzeScriptOverview /
 *      generateVideoScript 過渡組合），並回到輸入步驟（不卡轉圈圈）。
 *   2. loading 有「取消返回」出口；取消後遲到的拆解結果直接丟棄（不會突然跳 review）。
 *   3. 寫入失敗（worldStoryboard.createFromSegments）→ toast.error＋不關窗，
 *      拆解結果保留可重試。
 *
 * 沿用 repo 慣例：模組級 vi.mock 釘 useProjectSpine 與 sonner，不掛真 provider。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";
import type { ScriptBreakdown } from "@/adapters/types";

const { spineStub, toastStub } = vi.hoisted(() => {
  const toastFn = Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  });
  return {
    spineStub: {
      project: { id: "p1", name: "測試專案" } as { id: string; name: string } | null,
      breakdownScript: vi.fn<(s: string) => Promise<ScriptBreakdown>>(),
      ingestBreakdown: vi.fn<() => Promise<void>>(),
    },
    toastStub: toastFn,
  };
});

vi.mock("@/spine/ProjectSpineProvider", () => ({
  useProjectSpine: () => spineStub,
}));

vi.mock("sonner", () => ({ toast: toastStub }));

import { GuidedJourney } from "./GuidedJourney";

const BD: ScriptBreakdown = {
  acts: [
    {
      title: "第一幕",
      shots: [{ title: "雪山開場", route: "text", characters: [], scene: "雪山" }],
    },
  ],
  characters: ["密勒日巴"],
  scenes: ["雪山"],
};

beforeEach(() => {
  spineStub.breakdownScript.mockReset();
  spineStub.ingestBreakdown.mockReset();
  toastStub.error.mockClear();
});

afterEach(() => cleanup());

function open(onClose = vi.fn()) {
  render(<GuidedJourney open onClose={onClose} />);
  return onClose;
}

describe("GuidedJourney（從零引導表單）", () => {
  it("拆解失敗：toast.error 標真實 procedure 名並回到輸入步驟", async () => {
    spineStub.breakdownScript.mockRejectedValue(new Error("上游爆炸"));
    open();

    fireEvent.click(screen.getByRole("button", { name: /自動拆解/ }));

    await waitFor(() => expect(toastStub.error).toHaveBeenCalled());
    const [title, opts] = toastStub.error.mock.calls[0];
    expect(String(title)).toContain("director.analyzeScriptOverview");
    expect(String((opts as { description?: string })?.description)).toContain("上游爆炸");
    // 回到 STEP 1（輸入框重新可見，沒被關在 loading）
    expect(screen.getByPlaceholderText(/把整份腳本貼進來/)).toBeTruthy();
  });

  it("loading 可取消：取消後遲到的結果被丟棄、不跳 review", async () => {
    let resolveLate!: (b: ScriptBreakdown) => void;
    spineStub.breakdownScript.mockReturnValue(
      new Promise<ScriptBreakdown>(res => { resolveLate = res; })
    );
    open();

    fireEvent.click(screen.getByRole("button", { name: /自動拆解/ }));
    // loading 中有取消出口
    const cancel = await screen.findByRole("button", { name: /取消返回/ });
    fireEvent.click(cancel);
    expect(screen.getByPlaceholderText(/把整份腳本貼進來/)).toBeTruthy();

    // 遲到的結果到了也不該切到 review
    resolveLate(BD);
    await new Promise(r => setTimeout(r, 0));
    expect(screen.queryByText(/確認拆解結果/)).toBeNull();
    expect(screen.getByPlaceholderText(/把整份腳本貼進來/)).toBeTruthy();
  });

  it("寫入失敗：toast.error 標 worldStoryboard.createFromSegments、不關窗、結果保留", async () => {
    spineStub.breakdownScript.mockResolvedValue(BD);
    spineStub.ingestBreakdown.mockRejectedValue(new Error("DB 寫入失敗"));
    const onClose = open();

    fireEvent.click(screen.getByRole("button", { name: /自動拆解/ }));
    await screen.findByText(/確認拆解結果/);

    fireEvent.click(screen.getByRole("button", { name: /寫入目前專案/ }));
    await waitFor(() => expect(toastStub.error).toHaveBeenCalled());
    expect(String(toastStub.error.mock.calls[0][0])).toContain(
      "worldStoryboard.createFromSegments"
    );
    expect(onClose).not.toHaveBeenCalled();
    // 拆解結果仍在（可改名重試）
    expect(screen.getByText(/確認拆解結果/)).toBeTruthy();
  });

  it("寫入成功：關窗並重置", async () => {
    spineStub.breakdownScript.mockResolvedValue(BD);
    spineStub.ingestBreakdown.mockResolvedValue(undefined);
    const onClose = open();

    fireEvent.click(screen.getByRole("button", { name: /自動拆解/ }));
    await screen.findByText(/確認拆解結果/);

    fireEvent.click(screen.getByRole("button", { name: /寫入目前專案/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
