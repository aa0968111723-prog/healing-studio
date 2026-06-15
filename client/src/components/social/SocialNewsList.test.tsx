// @vitest-environment jsdom
/**
 * SocialNewsList · cockpit 時事選題列（U-6 / AIDV-96，屬 U-2/AIDV-92 逐殼採用 · /social 第 3 片）行為測試。
 * 守住兩條路徑：
 *   · 旗標 OFF（預設）＝既有列（標題 + 引用按鈕）＝零變化（未進 .aidv-kit 範圍）。
 *   · 旗標 ON       ＝design-kit 亮色暖光 IntelItem（進 .aidv-kit 範圍；整列可點＝引用，含來源/tag）。
 * 設計門依據（ui-ux-pro-max）：色彩非唯一資訊(High)——兩版皆以文字呈現標題/來源/tag。
 * 引用邏輯（帶進 brief）由呼叫端傳入；本測只證兩版皆能觸發 onCite 並傳回正確項。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const flags = vi.hoisted(() => ({ chrome: false }));
vi.mock("@/config/featureFlags", () => ({ get ENABLE_AIDV_CHROME() { return flags.chrome; } }));

import { SocialNewsList } from "./SocialNewsList";
import type { NewsItem } from "@/spine/types";

const NEWS: NewsItem[] = [
  { id: "n1", title: "放下的力量", source: "心靈電台", ts: "", tag: "療癒", url: "https://x/1" },
  { id: "n2", title: "正念練習指南", source: "週報", ts: "", tag: "正念", url: "https://x/2" },
];

afterEach(() => { cleanup(); flags.chrome = false; });

describe("SocialNewsList（U-6 / AIDV-96 · /social 逐殼採用第 3 片）", () => {
  it("旗標 OFF（預設）：既有列（標題 + 引用按鈕），未進設計套件範圍；點引用回傳該項", () => {
    flags.chrome = false;
    let cited = "";
    const { container } = render(<SocialNewsList news={NEWS} onCite={(n) => { cited = n.id; }} />);
    expect(screen.getByText("放下的力量")).toBeTruthy();
    expect(screen.getAllByText("引用")).toHaveLength(2);
    expect(container.querySelector(".aidv-kit")).toBeNull();
    (screen.getAllByText("引用")[1].closest("button") as HTMLButtonElement).click();
    expect(cited).toBe("n2");
  });

  it("旗標 ON：改用 design-kit IntelItem（進 .aidv-kit 範圍；標題/來源/tag 都在）；點整列回傳該項", () => {
    flags.chrome = true;
    let cited = "";
    const { container } = render(<SocialNewsList news={NEWS} onCite={(n) => { cited = n.id; }} />);
    expect(screen.getByText("放下的力量")).toBeTruthy();
    expect(screen.getByText("心靈電台")).toBeTruthy();
    expect(screen.getByText("療癒")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
    (screen.getByText("正念練習指南").closest("button") as HTMLButtonElement).click();
    expect(cited).toBe("n2");
  });
});
