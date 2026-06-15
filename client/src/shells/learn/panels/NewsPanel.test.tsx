// @vitest-environment jsdom
/**
 * NewsPanel · NewsItem（U-2 / AIDV-92 逐殼採用 · /learn）行為測試。
 * 守住兩條路徑：
 *   · 旗標 OFF（預設）＝既有外連卡（<a href target=_blank>）＝零變化（不進 .aidv-kit 範圍）。
 *   · 旗標 ON       ＝design-kit 亮色暖光 IntelItem（進 .aidv-kit 範圍；title/來源/標籤都在、點擊開原文）。
 * 設計門依據（ui-ux-pro-max）：外連可辨識——兩版皆於新分頁開原文（noopener），來源/日期/標籤可見。
 * 只測 NewsItem（純展示）；面板的 trpc 不在本測涵蓋。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

const flags = vi.hoisted(() => ({ chrome: false }));
vi.mock("@/config/featureFlags", () => ({ get ENABLE_AIDV_CHROME() { return flags.chrome; } }));
vi.mock("@/lib/trpc", () => ({ trpc: {} }));

import { NewsItem } from "./NewsPanel";

const ITEM = { id: 1, title: "AI 模型大更新", source: "TechNews", tag: "model", url: "https://example.com/a" };

afterEach(() => { cleanup(); flags.chrome = false; vi.restoreAllMocks(); });

describe("NewsPanel · NewsItem（U-2 / AIDV-92 · /learn）", () => {
  it("旗標 OFF（預設）：既有外連卡，title/來源在、以 <a href> 連外、未進設計套件範圍", () => {
    flags.chrome = false;
    const { container } = render(<NewsItem item={ITEM} />);
    expect(screen.getByText("AI 模型大更新")).toBeTruthy();
    expect(screen.getByText(/TechNews/)).toBeTruthy();
    const a = container.querySelector("a[href='https://example.com/a']");
    expect(a).not.toBeNull();
    expect(a?.getAttribute("target")).toBe("_blank");
    expect(container.querySelector(".aidv-kit")).toBeNull();
  });

  it("旗標 ON：改用 design-kit IntelItem（進 .aidv-kit 範圍；title/來源/標籤保留、點擊以新分頁開原文）", () => {
    flags.chrome = true;
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const { container } = render(<NewsItem item={ITEM} />);
    expect(screen.getByText("AI 模型大更新")).toBeTruthy();
    expect(screen.getByText(/TechNews/)).toBeTruthy();
    expect(screen.getByText("#model")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(openSpy).toHaveBeenCalledWith("https://example.com/a", "_blank", "noopener,noreferrer");
  });

  it("缺欄位容錯：無 url → 標題仍在、不報錯（OFF 走 href='#'）", () => {
    flags.chrome = false;
    render(<NewsItem item={{ headline: "無連結快訊" }} />);
    expect(screen.getByText("無連結快訊")).toBeTruthy();
  });
});
