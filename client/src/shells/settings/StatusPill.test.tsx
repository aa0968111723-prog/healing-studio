// @vitest-environment jsdom
/**
 * StatusPill（U-2 / AIDV-92 逐殼採用 · /settings）行為測試。
 * 守住兩條路徑：
 *   · 旗標 OFF（預設）＝既有 shadcn Badge＝零變化（不進 .aidv-kit 範圍）。
 *   · 旗標 ON       ＝design-kit 亮色暖光 Pill（進 .aidv-kit 範圍）。
 * 兩版皆原樣顯示狀態文字（不改判讀）；空值落「—」。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const flags = vi.hoisted(() => ({ chrome: false }));
vi.mock("@/config/featureFlags", () => ({ get ENABLE_AIDV_CHROME() { return flags.chrome; } }));

import { StatusPill } from "./StatusPill";

afterEach(() => { cleanup(); flags.chrome = false; });

describe("StatusPill（U-2 / AIDV-92 · /settings）", () => {
  it("旗標 OFF（預設）：既有 Badge，狀態文字在、未進設計套件範圍", () => {
    flags.chrome = false;
    const { container } = render(<StatusPill status="failed" />);
    expect(screen.getByText("failed")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).toBeNull();
  });

  it("旗標 ON：改用 design-kit Pill（進 .aidv-kit 範圍；狀態文字保留）", () => {
    flags.chrome = true;
    const { container } = render(<StatusPill status="done" />);
    expect(screen.getByText("done")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
  });

  it("空狀態落「—」", () => {
    flags.chrome = false;
    render(<StatusPill status="" />);
    expect(screen.getByText("—")).toBeTruthy();
  });
});
