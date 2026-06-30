// @vitest-environment jsdom
/**
 * AssetsPanel 真實 procedure 接線（AIDV-12）行為測試。
 * 守住：
 *   · 旗標 ENABLE_SUBSYSTEM_REAL_DATA OFF（預設）＝讀脊椎本地 p.assets，**不發 trpc 查詢**＝零變化。
 *   · 旗標 ON ＋ assets.myAssets 回資料 → 渲染真實資產列（標題 / sourceStudio）。
 *   · 旗標 ON ＋ 載入中／錯誤 → 回退脊椎本地集合（additive fallback，不假空白）。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const flags = vi.hoisted(() => ({ real: false }));
vi.mock("@/config/videoFlags", () => ({
  get ENABLE_SUBSYSTEM_REAL_DATA() { return flags.real; },
}));
// design-kit chrome 維持 OFF（空態走既有 Tailwind Empty）。
vi.mock("@/config/featureFlags", () => ({
  get ENABLE_AIDV_CHROME() { return false; },
}));

const h = vi.hoisted(() => ({
  q: { data: undefined as unknown, isLoading: false, isError: false, refetch: vi.fn() },
  assets: [] as Record<string, unknown>[],
}));
vi.mock("@/lib/trpc", () => ({
  trpc: { assets: { myAssets: { useQuery: () => h.q } } },
}));
vi.mock("@/spine/ProjectSpineProvider", () => ({
  useProjectSpine: () => ({ project: { assets: h.assets } }),
}));

import { AssetsPanel } from "./AssetsPanel";

beforeEach(() => {
  flags.real = false;
  h.assets = [];
  h.q.data = undefined;
  h.q.isLoading = false;
  h.q.isError = false;
});
afterEach(() => cleanup());

describe("AssetsPanel 真實 procedure（AIDV-12）", () => {
  it("旗標 OFF（預設）：讀脊椎本地 p.assets，不調用 trpc（零變化）", () => {
    const spy = vi.spyOn(h.q, "refetch");
    h.assets = [{ id: "a1", kind: "image", shotNo: "脊椎鏡", modelId: "m1", sourceStudio: "video-studio", provider: "mock", costUsd: 0, ts: "now" }];
    const { container } = render(<AssetsPanel />);
    expect(container.textContent).toContain("脊椎鏡");
    expect(spy).not.toHaveBeenCalled();
  });

  it("旗標 ON ＋ myAssets 回資料 → 渲染真實資產（title / sourceStudio）", () => {
    flags.real = true;
    h.q.data = { items: [
      { id: 11, title: "雪山晨光", assetType: "image", sourceStudio: "image", modelId: "flux", provider: "fal", createdAt: Date.now() },
    ], nextCursor: null };
    const { container } = render(<AssetsPanel />);
    expect(screen.getByText(/雪山晨光/)).toBeTruthy();
    expect(container.textContent).toContain("image");
  });

  it("旗標 ON ＋ 載入中（脊椎有本地集合）→ 回退脊椎集合（不假空白）", () => {
    flags.real = true;
    h.q.isLoading = true;
    h.assets = [{ id: "a9", kind: "image", shotNo: "回退鏡", modelId: "m", sourceStudio: "s", provider: "hf", costUsd: 0, ts: "t" }];
    const { container } = render(<AssetsPanel />);
    expect(container.textContent).toContain("回退鏡");
  });

  it("旗標 ON ＋ 錯誤（脊椎空）→ 可重試錯誤態（不誤報為空）", () => {
    flags.real = true;
    h.q.isError = true;
    render(<AssetsPanel />);
    expect(screen.getByText(/資產庫讀取失敗/)).toBeTruthy();
  });
});
