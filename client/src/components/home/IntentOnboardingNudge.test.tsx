// @vitest-environment jsdom
/**
 * IntentOnboardingNudge（I-9 Sense 意圖個人化引導，AIDV-87 · Phase 1）行為測試。
 *
 * 守住：
 *   1. 不同 intentType → 不同引導路徑（goal_oriented→/create、choice_paralysis→/director、
 *      aesthetic_preference→/playground）；皆對映 appRegistry 真實路由。
 *   2. 信心度過低（<0.4）或無推論結果 → 不顯示（不打擾）。
 *   3. 按「不用了」→ 卡片消失（＝可關閉個人化的最小落地）。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("wouter", () => ({ useLocation: () => ["/", h.navigate] }));

import { IntentOnboardingNudge } from "./IntentOnboardingNudge";
import type { IntentResult } from "@/hooks/useIntentInference";

function intent(over: Partial<IntentResult> = {}): IntentResult {
  return {
    intentType: "goal_oriented",
    intentLabel: "目標導向",
    confidence: 0.8,
    psychologicalInsight: "",
    suggestedAction: "offer_quick_start",
    actionDetail: "",
    detectedAesthetics: [],
    preferredModality: "unknown",
    inferredAt: 0,
    ...over,
  };
}

beforeEach(() => {
  h.navigate.mockReset();
  try { localStorage.clear(); } catch { /* localStorage 在某些 jsdom 環境不可用 */ }
});
afterEach(() => cleanup());

describe("IntentOnboardingNudge（I-9 / AIDV-87）", () => {
  it("目標導向 → CTA 導向 /create", () => {
    render(<IntentOnboardingNudge intentResult={intent()} />);
    fireEvent.click(screen.getByText("直接開始創作"));
    expect(h.navigate).toHaveBeenCalledWith("/create");
  });

  it("選擇困難 → CTA 導向 /director", () => {
    render(<IntentOnboardingNudge intentResult={intent({ intentType: "choice_paralysis", intentLabel: "選擇困難" })} />);
    fireEvent.click(screen.getByText("用導演企劃台一步步來"));
    expect(h.navigate).toHaveBeenCalledWith("/director");
  });

  it("明顯美學偏好 → CTA 導向 /playground", () => {
    render(<IntentOnboardingNudge intentResult={intent({ intentType: "aesthetic_preference" })} />);
    fireEvent.click(screen.getByText("挑模型開始生成"));
    expect(h.navigate).toHaveBeenCalledWith("/playground");
  });

  it("信心度過低（<0.4）→ 不顯示", () => {
    const { container } = render(<IntentOnboardingNudge intentResult={intent({ confidence: 0.3 })} />);
    expect(container.firstChild).toBeNull();
  });

  it("無推論結果 → 不顯示", () => {
    const { container } = render(<IntentOnboardingNudge intentResult={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("找靈感 → CTA 導向 /studio", () => {
    render(<IntentOnboardingNudge intentResult={intent({ intentType: "inspiration_seeking" })} />);
    fireEvent.click(screen.getByText("逛六大系統找靈感"));
    expect(h.navigate).toHaveBeenCalledWith("/studio");
  });

  it("探索模式 → CTA 導向 /studio", () => {
    render(<IntentOnboardingNudge intentResult={intent({ intentType: "exploration_mode" })} />);
    fireEvent.click(screen.getByText("自由探索六大系統"));
    expect(h.navigate).toHaveBeenCalledWith("/studio");
  });

  it("按「不用了」→ 卡片消失（關閉個人化）", () => {
    render(<IntentOnboardingNudge intentResult={intent()} />);
    expect(screen.getByText("直接開始創作")).toBeTruthy();
    fireEvent.click(screen.getByText("不用了，我自己逛"));
    expect(screen.queryByText("直接開始創作")).toBeNull();
  });

  it("按「不用了」後重新掛載仍不顯示（localStorage 持久化）", () => {
    const { unmount } = render(<IntentOnboardingNudge intentResult={intent()} />);
    fireEvent.click(screen.getByText("不用了，我自己逛"));
    unmount();
    render(<IntentOnboardingNudge intentResult={intent()} />);
    expect(screen.queryByText("直接開始創作")).toBeNull();
  });
});
