// @vitest-environment jsdom
/**
 * AidvOrbView/AidvOrbMount（AIDV-114 第3–7片）— U-11 新光球純呈現 View ＋資料 adapter。
 * 容器 AidvOrbMount 走 hooks/tRPC（需 provider，不在此直接 render）；本檔測純呈現 View
 * 與純對應函式（orbStateToMood / pathToPageLabel / toOrbChatMsgs / toPromptItems / queryToTabState）。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import {
  AidvOrbView, orbStateToMood, pathToPageLabel, toOrbChatMsgs, toPromptItems, queryToTabState,
  type AidvOrbViewProps,
} from "./AidvOrbMount";

afterEach(() => cleanup());

const baseProps: AidvOrbViewProps = {
  mood: "idle",
  pageLabel: "影片工作室",
  chatMsgs: [],
  prompts: { state: "empty", items: [] },
  credits: { state: "ready", remaining: 0, usedPct: 0 },
  onOpenNotes: () => {},
};

describe("AidvOrbMount 純對應（U-11 / AIDV-114）", () => {
  it("orbStateToMood：活動狀態 → 心情四態", () => {
    expect(orbStateToMood("idle")).toBe("idle");
    expect(orbStateToMood("thinking")).toBe("thinking");
    expect(orbStateToMood("searching")).toBe("thinking");
    expect(orbStateToMood("listening")).toBe("thinking");
    expect(orbStateToMood("executing")).toBe("working");
    expect(orbStateToMood("success")).toBe("done");
    expect(orbStateToMood("error")).toBe("idle");
  });

  it("pathToPageLabel：路由 → 友善標籤；未知 → 本頁", () => {
    expect(pathToPageLabel("/video")).toBe("影片工作室");
    expect(pathToPageLabel("/video/director")).toBe("影片工作室");
    expect(pathToPageLabel("/settings")).toBe("設定");
    expect(pathToPageLabel("/unknown")).toBe("本頁");
  });

  it("toOrbChatMsgs：orb→agent 對應、取最近 N 筆", () => {
    const src = Array.from({ length: 25 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "orb") as "user" | "orb",
      text: `m${i}`,
      at: i,
    }));
    const out = toOrbChatMsgs(src, 20);
    expect(out).toHaveLength(20);
    expect(out[0].text).toBe("m5"); // 最近 20 筆 = m5..m24
    expect(out[0].role).toBe("agent"); // m5 role=orb→agent
    expect(out[out.length - 1].role).toBe("user"); // m24 role=user
  });

  it("toPromptItems：DB 列 → 提示詞項（title/content/useCount→uses）", () => {
    const out = toPromptItems([{ id: 7, title: "療癒開場", content: "soft warm light...", useCount: 3 }]);
    expect(out).toEqual([{ id: "7", title: "療癒開場", content: "soft warm light...", uses: 3 }]);
  });

  it("queryToTabState：error > loading > empty > ready", () => {
    expect(queryToTabState({ isError: true, isLoading: true })).toBe("error");
    expect(queryToTabState({ isLoading: true })).toBe("loading");
    expect(queryToTabState({ isEmpty: true })).toBe("empty");
    expect(queryToTabState({})).toBe("ready");
  });
});

describe("AidvOrbView 純呈現（U-11 / AIDV-114）", () => {
  it("掛載：渲染光球 FAB（aria-expanded 預設 false）", () => {
    render(<AidvOrbView {...baseProps} />);
    const fab = screen.getByRole("button", { name: "光球助手" });
    expect(fab.getAttribute("aria-expanded")).toBe("false");
  });

  it("本頁分頁：開面板顯示情境提示＋Flow 展示牆", () => {
    render(<AidvOrbView {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: "光球助手" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/點上方分頁看本頁提示/)).toBeTruthy();
    expect(screen.getByText("Flow 展示牆")).toBeTruthy();
  });

  it("提示詞分頁：有資料 → 渲染提示詞積木", () => {
    render(<AidvOrbView {...baseProps} prompts={{ state: "ready", items: [{ id: "1", title: "療癒開場", content: "warm light", uses: 2 }] }} />);
    fireEvent.click(screen.getByRole("button", { name: "光球助手" }));
    fireEvent.click(screen.getByRole("tab", { name: /提示詞/ }));
    expect(screen.getByText("療癒開場")).toBeTruthy();
    expect(screen.getByText("warm light")).toBeTruthy();
  });

  it("積分分頁：顯示剩餘積分與用量", () => {
    render(<AidvOrbView {...baseProps} credits={{ state: "ready", remaining: 420, usedPct: 35, topModel: "veo-3" }} />);
    fireEvent.click(screen.getByRole("button", { name: "光球助手" }));
    fireEvent.click(screen.getByRole("tab", { name: /積分/ }));
    expect(screen.getByText("420")).toBeTruthy();
    expect(screen.getByText(/已用 35%/)).toBeTruthy();
  });

  it("筆記分頁：開啟筆記抽屜 → 呼叫 onOpenNotes", () => {
    const onOpenNotes = vi.fn();
    render(<AidvOrbView {...baseProps} onOpenNotes={onOpenNotes} />);
    fireEvent.click(screen.getByRole("button", { name: "光球助手" }));
    fireEvent.click(screen.getByRole("tab", { name: /筆記/ }));
    fireEvent.click(screen.getByText("開啟筆記抽屜"));
    expect(onOpenNotes).toHaveBeenCalledTimes(1);
  });
});
