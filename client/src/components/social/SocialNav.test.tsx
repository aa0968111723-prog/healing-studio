// @vitest-environment jsdom
/**
 * SocialNav · 子導覽列（U-6 / AIDV-96，屬 U-2/AIDV-92 逐殼採用 · /social 第 1 片）行為測試。
 * 守住兩條路徑：
 *   · 旗標 OFF（預設）＝既有 wouter Link 子導覽＝零變化（5 條連結帶 href，未進 .aidv-kit 範圍）。
 *   · 旗標 ON       ＝design-kit 亮色暖光 SubTabs（進 .aidv-kit 範圍；tablist + 5 個 tab，標籤都在）。
 * 設計門依據（ui-ux-pro-max）：色彩非唯一資訊(High)——兩版皆保留文字標籤＋選取態語意。
 * 只測 SocialNav；wouter 以最小 mock 隔離（提供 location 與 navigate）。
 * AIDV-96：新增第 5 條「旅程」tab（/social/journey）。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const flags = vi.hoisted(() => ({ chrome: false }));
const nav = vi.hoisted(() => ({ to: "" }));
vi.mock("@/config/featureFlags", () => ({ get ENABLE_AIDV_CHROME() { return flags.chrome; } }));
vi.mock("wouter", () => ({
  useLocation: () => ["/social", (to: string) => { nav.to = to; }],
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { SocialNav } from "./SocialNav";

afterEach(() => { cleanup(); flags.chrome = false; nav.to = ""; });

const LABELS = ["工作台", "圖像台", "品牌庫", "發佈/精選", "旅程"];

describe("SocialNav（U-6 / AIDV-96 · /social 逐殼採用第 1 片）", () => {
  it("旗標 OFF（預設）：既有 Link 子導覽，5 條帶 href、未進設計套件範圍", () => {
    flags.chrome = false;
    const { container } = render(<SocialNav />);
    for (const l of LABELS) expect(screen.getByText(l)).toBeTruthy();
    const links = container.querySelectorAll("a[href^='/social']");
    expect(links).toHaveLength(5);
    expect(container.querySelector(".aidv-kit")).toBeNull();
    expect(container.querySelector("[role='tablist']")).toBeNull();
  });

  it("旗標 ON：改用 design-kit SubTabs（進 .aidv-kit 範圍；tablist + 5 個 tab、標籤都在）", () => {
    flags.chrome = true;
    const { container } = render(<SocialNav />);
    for (const l of LABELS) expect(screen.getByText(l)).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
    expect(container.querySelector("[role='tablist']")).not.toBeNull();
    expect(container.querySelectorAll("[role='tab']")).toHaveLength(5);
  });

  it("旗標 ON：點 tab 走 wouter navigate（client-side，不碰 window.location）", () => {
    flags.chrome = true;
    render(<SocialNav />);
    (screen.getByText("品牌庫").closest("button") as HTMLButtonElement).click();
    expect(nav.to).toBe("/social/brand");
  });
});
