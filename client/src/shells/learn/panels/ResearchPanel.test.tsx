// @vitest-environment jsdom
/**
 * ResearchPanel · SourceItem（U-2 / AIDV-92 逐殼採用 · /learn）行為測試。
 * 守住兩條路徑：
 *   · 旗標 OFF（預設）＝既有外連卡（序號徽章＋<a href target=_blank>）＝零變化（不進 .aidv-kit 範圍）。
 *   · 旗標 ON       ＝design-kit 亮色暖光 SourceCite（進 .aidv-kit 範圍；標題/網址/摘要都在，仍是外連 <a>）。
 * 外連可辨識：兩版皆以新分頁開原文（target=_blank rel=noreferrer），標題/網址/摘要可見。
 * 只測 SourceItem（純展示）；面板的研究 adapter 不在本測涵蓋。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const flags = vi.hoisted(() => ({ chrome: false }));
vi.mock("@/config/featureFlags", () => ({ get ENABLE_AIDV_CHROME() { return flags.chrome; } }));

import { SourceItem } from "./ResearchPanel";

const SRC = { title: "跨鏡角色一致性技術", url: "https://example.com/paper", snip: "用 LoRA 與參考圖維持角色一致。" };

afterEach(() => { cleanup(); flags.chrome = false; });

describe("ResearchPanel · SourceItem（U-2 / AIDV-92 · /learn）", () => {
  it("旗標 OFF（預設）：既有外連卡，標題/網址/摘要在、序號徽章在、<a target=_blank>、未進設計套件範圍", () => {
    flags.chrome = false;
    const { container } = render(<SourceItem src={SRC} index={0} />);
    expect(screen.getByText("跨鏡角色一致性技術")).toBeTruthy();
    expect(screen.getByText("https://example.com/paper")).toBeTruthy();
    expect(screen.getByText(/LoRA/)).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy(); // 序號徽章 index+1
    const a = container.querySelector("a[href='https://example.com/paper']");
    expect(a?.getAttribute("target")).toBe("_blank");
    expect(a?.getAttribute("rel")).toBe("noreferrer");
    expect(container.querySelector(".aidv-kit")).toBeNull();
  });

  it("旗標 ON：改用 design-kit SourceCite（進 .aidv-kit 範圍；標題/網址/摘要保留、仍是外連 <a>）", () => {
    flags.chrome = true;
    const { container } = render(<SourceItem src={SRC} index={0} />);
    expect(screen.getByText("跨鏡角色一致性技術")).toBeTruthy();
    expect(screen.getByText("https://example.com/paper")).toBeTruthy();
    expect(screen.getByText(/LoRA/)).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
    const a = container.querySelector("a[href='https://example.com/paper']");
    expect(a?.getAttribute("target")).toBe("_blank");
    expect(a?.getAttribute("rel")).toBe("noreferrer");
  });

  it("缺摘要容錯：無 snip → 標題/網址仍在、不報錯（兩態）", () => {
    flags.chrome = true;
    render(<SourceItem src={{ title: "無摘要來源", url: "https://example.com/x" }} index={2} />);
    expect(screen.getByText("無摘要來源")).toBeTruthy();
  });
});
