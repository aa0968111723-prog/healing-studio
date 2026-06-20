// @vitest-environment jsdom
/**
 * PromptsPanel 積木 combo 接真實 procedure（AIDV-12）行為測試。
 * 守住：
 *   · chrome OFF ＋ 本卡旗標 OFF（預設）→ 既有脊椎本地 promptBlocks 列＝零變化、**不發 trpc**。
 *   · chrome OFF ＋ 本卡旗標 ON ＋ blockCombos.list 回資料 → 渲染真實 combo（name / blockIds）。
 *   · chrome OFF ＋ 本卡旗標 ON ＋ 載入中／錯誤 → 回退脊椎本地 promptBlocks（additive fallback）。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const flags = vi.hoisted(() => ({ chrome: false, real: false }));
vi.mock("@/config/featureFlags", () => ({
  get ENABLE_AIDV_CHROME() { return flags.chrome; },
}));
vi.mock("@/config/videoFlags", () => ({
  get ENABLE_SUBSYSTEM_REAL_DATA() { return flags.real; },
}));

const h = vi.hoisted(() => ({
  q: { data: undefined as unknown, isLoading: false, isError: false, refetch: vi.fn() },
  promptBlocks: [] as Record<string, unknown>[],
  addPromptBlock: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: { blockCombos: { list: { useQuery: () => h.q } } },
}));
vi.mock("@/spine/ProjectSpineProvider", () => ({
  useProjectSpine: () => ({ project: { promptBlocks: h.promptBlocks }, addPromptBlock: h.addPromptBlock }),
}));
// VaultBrowserPanel 走 chrome 路徑；此測試 chrome 全程 OFF，不會掛載，仍 stub 以免連動。
vi.mock("./VaultBrowserPanel", () => ({ VaultBrowserPanel: () => null }));

import { PromptsPanel } from "./PromptsPanel";

beforeEach(() => {
  flags.chrome = false;
  flags.real = false;
  h.promptBlocks = [];
  h.q.data = undefined;
  h.q.isLoading = false;
  h.q.isError = false;
});
afterEach(() => cleanup());

describe("PromptsPanel 積木 combo 接真實 procedure（AIDV-12）", () => {
  it("旗標 OFF（預設）：脊椎本地 promptBlocks 列、不調用 trpc（零變化）", () => {
    const spy = vi.spyOn(h.q, "refetch");
    h.promptBlocks = [{ id: "pb1", label: "脊椎積木", text: "本地", kind: "custom", uses: 3 }];
    const { container } = render(<PromptsPanel />);
    expect(container.textContent).toContain("脊椎積木");
    expect(spy).not.toHaveBeenCalled();
  });

  it("旗標 ON ＋ blockCombos.list 回資料 → 渲染真實 combo（name）", () => {
    flags.real = true;
    h.q.data = [{ id: 5, name: "雪山·combo", modality: "image", blockIds: ["b1", "b2"] }];
    render(<PromptsPanel />);
    expect(screen.getByText("雪山·combo")).toBeTruthy();
  });

  it("旗標 ON ＋ 載入中（脊椎有本地集合）→ 回退脊椎集合（不假空白）", () => {
    flags.real = true;
    h.q.isLoading = true;
    h.promptBlocks = [{ id: "pbX", label: "回退積木", text: "x", kind: "combo", uses: 0 }];
    const { container } = render(<PromptsPanel />);
    expect(container.textContent).toContain("回退積木");
  });

  it("旗標 ON ＋ 錯誤（脊椎空）→ 可重試錯誤態（不誤報為空）", () => {
    flags.real = true;
    h.q.isError = true;
    render(<PromptsPanel />);
    expect(screen.getByText(/提示詞積木庫讀取失敗/)).toBeTruthy();
  });
});
