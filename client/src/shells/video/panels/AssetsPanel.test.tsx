// @vitest-environment jsdom
/**
 * AssetsPanel 空狀態（U-5 / AIDV-95 · /video S3 四態）行為測試。
 * 守住：空態改用共用 Empty（→ PanelEmpty），與 Shot/Character/Scene 一致：
 *   · 旗標 OFF（預設）＝既有 Tailwind PanelEmpty（role="status"、'尚無資產'）、不進 .aidv-kit。
 *   · 旗標 ON       ＝design-kit 亮色暖光 EmptyState（進 .aidv-kit、保留文字）。
 * 並驗有資產時照常渲染資產列（非空態）。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const flags = vi.hoisted(() => ({ chrome: false }));
vi.mock("@/config/featureFlags", () => ({
  get ENABLE_AIDV_CHROME() { return flags.chrome; },
}));

const h = vi.hoisted(() => ({ assets: [] as Record<string, unknown>[] }));
vi.mock("@/spine/ProjectSpineProvider", () => ({
  useProjectSpine: () => ({ project: { assets: h.assets } }),
}));

import { AssetsPanel } from "./AssetsPanel";

beforeEach(() => { h.assets = []; });
afterEach(() => { cleanup(); flags.chrome = false; });

describe("AssetsPanel 空狀態（U-5 / AIDV-95 · /video S3 四態）", () => {
  it("旗標 OFF（預設）：空態用共用 Empty（role=status、'尚無資產'）、未進設計套件範圍", () => {
    flags.chrome = false;
    const { container } = render(<AssetsPanel />);
    expect(screen.getByText("尚無資產")).toBeTruthy();
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.querySelector(".aidv-kit")).toBeNull();
  });

  it("旗標 ON：空態改用 design-kit EmptyState（進 .aidv-kit、保留文字）", () => {
    flags.chrome = true;
    const { container } = render(<AssetsPanel />);
    expect(screen.getByText("尚無資產")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
  });

  it("有資產 → 渲染資產列（非空態）", () => {
    h.assets = [{ id: "a1", kind: "image", shotNo: "S01", modelId: "m1", sourceStudio: "video-studio", provider: "mock", costUsd: 0, ts: "now" }];
    const { container } = render(<AssetsPanel />);
    expect(screen.queryByText("尚無資產")).toBeNull();
    expect(container.textContent).toContain("S01");
  });
});
