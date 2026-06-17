// @vitest-environment jsdom
/**
 * design-kit OrbAssistant 光球助手（U-11 / AIDV-114 第1片）行為測試。
 * 守住互動：FAB 開關＋aria-expanded、Esc 關、6 分頁切換、提示詞分頁掛 VaultBrowser、
 * 主動泡泡 CTA／關閉、人格切換、分頁四態。純元件、不接 spine。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import { OrbAssistant, ORB_TABS, ProactiveBubble, OrbPageTab, OrbChatTab, type OrbFlowItem } from "./orb";
import type { WorkflowStep } from "./WorkflowBuilder";

afterEach(() => cleanup());

const STEPS: WorkflowStep[] = [
  { id: "s1", name: "世界觀", required: true, enabled: true },
  { id: "s2", name: "劇本", required: true, enabled: true },
  { id: "s3", name: "分鏡", required: false, enabled: true },
];

describe("design-kit OrbAssistant（U-11 / AIDV-114）", () => {
  it("FAB：預設收合、aria-expanded=false；點擊 → 開面板＋onOpenChange(true)", () => {
    const onOpenChange = vi.fn();
    render(<OrbAssistant onOpenChange={onOpenChange} name="光球助手" />);
    const fab = screen.getByRole("button", { name: "光球助手" });
    expect(fab.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(fab);
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(fab.getAttribute("aria-expanded")).toBe("true");
  });

  it("Esc：面板開啟時按 Esc → 收合", () => {
    render(<OrbAssistant defaultOpen name="光球助手" />);
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("6 情境分頁：渲染六頁籤、點「提示詞」→ onTabChange('prompts')", () => {
    const onTabChange = vi.fn();
    render(<OrbAssistant defaultOpen onTabChange={onTabChange} />);
    for (const t of ORB_TABS) {
      expect(screen.getByText(new RegExp(t.label))).toBeTruthy();
    }
    fireEvent.click(screen.getByText(/提示詞/));
    expect(onTabChange).toHaveBeenCalledWith("prompts");
  });

  it("提示詞分頁：active=prompts＋promptVault → 掛 VaultBrowser（空態文案）", () => {
    render(<OrbAssistant defaultOpen activeTab="prompts" promptVault={{ state: "empty" }} />);
    expect(screen.getByText("還沒有存過提示詞")).toBeTruthy();
  });

  it("分頁四態：state=error → 顯示 ErrorState＋重試 onRetry", () => {
    const onRetry = vi.fn();
    render(<OrbAssistant defaultOpen activeTab="page" state="error" onRetry={onRetry} />);
    fireEvent.click(screen.getByText("重試"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("分頁內容：state=content → 渲染 tabContent[active]", () => {
    render(<OrbAssistant defaultOpen activeTab="notes" tabContent={{ notes: <p>我的筆記內容</p> }} />);
    expect(screen.getByText("我的筆記內容")).toBeTruthy();
  });

  it("人格切換：面板內點「創意」→ onPersonaChange('creative')", () => {
    const onPersonaChange = vi.fn();
    render(<OrbAssistant defaultOpen persona="calm" onPersonaChange={onPersonaChange} />);
    fireEvent.click(screen.getByText("創意"));
    expect(onPersonaChange).toHaveBeenCalledWith("creative");
  });

  it("主動泡泡：給 proactive → FAB 亮提醒；CTA 與關閉可點", () => {
    const onCta = vi.fn();
    const onDismiss = vi.fn();
    render(
      <OrbAssistant
        defaultOpen
        proactive={{ emoji: "🪄", name: "靈感精靈", text: "提示詞太短了", cta: "幫我補寫", onCta, onDismiss, level: "hint" }}
      />,
    );
    const bubble = screen.getByRole("status");
    expect(within(bubble).getByText("靈感精靈")).toBeTruthy();
    fireEvent.click(screen.getByText("幫我補寫"));
    expect(onCta).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("關閉提醒"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("ProactiveBubble：aria-live polite（給螢幕報讀）", () => {
    render(<ProactiveBubble text="完成囉" name="導演腦" />);
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
  });

  it("OrbPageTab：空（無提示無 flow）→ 空態文案", () => {
    render(<OrbPageTab />);
    expect(screen.getByText("這個頁面還沒有情境提示")).toBeTruthy();
  });

  it("OrbPageTab：情境提示 CTA → onCta；Flow 一鍵重跑 → onRerun", () => {
    const onCta = vi.fn();
    const onRerun = vi.fn();
    const flows: OrbFlowItem[] = [{ id: "f1", name: "成片工作流", steps: STEPS, current: 1 }];
    render(
      <OrbPageTab
        pageLabel="導演台"
        hints={[{ id: "h1", text: "提示詞太短", cta: "幫我補寫", onCta }]}
        flows={flows}
        onRerun={onRerun}
      />,
    );
    expect(screen.getByText("Flow 展示牆")).toBeTruthy();
    expect(screen.getByText("成片工作流")).toBeTruthy();
    fireEvent.click(screen.getByText("幫我補寫"));
    expect(onCta).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("↻ 重跑"));
    expect(onRerun).toHaveBeenCalledWith(flows[0]);
  });

  it("本頁分頁：active=page＋pageContext → 掛 OrbPageTab", () => {
    render(<OrbAssistant defaultOpen activeTab="page" pageContext={{ hints: [{ id: "h1", text: "本頁提示一句" }] }} />);
    expect(screen.getByText("本頁提示一句")).toBeTruthy();
  });

  it("OrbChatTab：空 → 空態；有訊息 → 依序渲染泡泡", () => {
    const { rerender } = render(<OrbChatTab messages={[]} />);
    expect(screen.getByText("還沒有對話")).toBeTruthy();
    rerender(
      <OrbChatTab messages={[
        { id: "m1", role: "user", text: "我想做一支療癒短片" },
        { id: "m2", role: "agent", text: "好的，先從世界觀開始吧" },
      ]} />,
    );
    expect(screen.getByText("我想做一支療癒短片")).toBeTruthy();
    expect(screen.getByText("好的，先從世界觀開始吧")).toBeTruthy();
  });

  it("對話分頁：active=chat＋tabContent.chat → 掛 OrbChatTab", () => {
    render(
      <OrbAssistant defaultOpen activeTab="chat" tabContent={{ chat: <OrbChatTab messages={[{ id: "m1", role: "agent", text: "嗨，我是光球" }]} /> }} />,
    );
    expect(screen.getByText("嗨，我是光球")).toBeTruthy();
  });
});
