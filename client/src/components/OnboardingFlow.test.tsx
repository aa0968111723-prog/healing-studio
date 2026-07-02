// @vitest-environment jsdom
/**
 * OnboardingFlow result-step guard — AIDV-637
 * 驗收條件（首次體驗的誤導性成功態）：
 * - 生成 onSuccess 帶空/空白/null resultUrl → 不顯示「你的第一件作品完成了！」、跳 toast.error、不進慶祝態
 * - 生成 onSuccess 帶有效 resultUrl → 顯示慶祝標題與作品圖
 */
import type { ReactNode } from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, act } from "@testing-library/react";

const captured = vi.hoisted(() => ({ onSuccess: null as null | ((d: unknown) => void) }));
const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), message: vi.fn() }));

// framer-motion 在 jsdom 下的進出場動畫非同步、會讓步驟切換不同步渲染；
// mock 成同步直通，讓 setStep 後的內容立即出現在 DOM。
vi.mock("framer-motion", async () => {
  const react = await import("react");
  const STRIP = new Set([
    "initial", "animate", "exit", "transition", "variants",
    "whileHover", "whileTap", "whileInView", "whileFocus",
    "layout", "layoutId", "drag", "custom",
  ]);
  const clean = (props: Record<string, unknown> = {}) =>
    Object.fromEntries(
      Object.entries(props).filter(([k]) => !STRIP.has(k) && k !== "children"),
    );
  const motion = new Proxy(
    {},
    {
      get:
        (_t, tag: string) =>
        (props: Record<string, unknown> = {}) =>
          react.createElement(tag, clean(props), props.children as ReactNode),
    },
  );
  return {
    __esModule: true,
    motion,
    AnimatePresence: ({ children }: { children?: ReactNode }) =>
      react.createElement(react.Fragment, null, children),
    // OnboardingFlow 用到 useReducedMotion；mock 缺此匯出會整檔紅（AIDV-965 順手修）。
    useReducedMotion: () => false,
  };
});

vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/contexts/AIStateContext", () => ({
  useAIState: () => ({ setAIState: vi.fn(), personality: "warm" }),
}));
vi.mock("./VisualSoul", () => ({ default: () => null }));
vi.mock("./ThoughtIslandChain", () => ({ default: () => null }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    evaluate: {
      suggestChips: { useMutation: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false }) },
    },
    generate: {
      prepareJob: {
        useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
      },
      multimodal: {
        useMutation: (opts: { onSuccess?: (d: unknown) => void }) => {
          captured.onSuccess = opts?.onSuccess ?? null;
          return { mutate: vi.fn(), isPending: false, reset: vi.fn() };
        },
      },
    },
  },
}));

import OnboardingFlow from "./OnboardingFlow";

// 此 jsdom 設定未提供 localStorage 全域；handleBranchNavigate/handleComplete 會
// 呼叫 localStorage.setItem，故補一個 stub 讓分支導航測試不致丟錯。
// stub 在 beforeEach 設置、afterEach 還原（vi.unstubAllGlobals）——
// module scope stub 會在 vitest fork worker 跨檔重用時洩漏到其他測試檔
// （getItem 恆回 null 會蓋掉別檔的 Map 版 stub），造成間歇性 flake。
const localStorageStub = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

beforeEach(() => {
  vi.stubGlobal("localStorage", localStorageStub);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  captured.onSuccess = null;
});

const CELEBRATE = "你的第一件作品完成了！";

function renderFlow() {
  render(<OnboardingFlow onComplete={vi.fn()} onSkip={vi.fn()} />);
  expect(captured.onSuccess).toBeTypeOf("function");
  return captured.onSuccess!;
}

describe("OnboardingFlow result guard (AIDV-637)", () => {
  it("空字串 resultUrl → 不慶祝、跳 toast.error", () => {
    const onSuccess = renderFlow();
    act(() => onSuccess({ resultUrl: "" }));
    expect(screen.queryByText(CELEBRATE)).toBeNull();
    expect(toastMock.error).toHaveBeenCalledTimes(1);
  });

  it("純空白 resultUrl → 不慶祝、跳 toast.error", () => {
    const onSuccess = renderFlow();
    act(() => onSuccess({ resultUrl: "   " }));
    expect(screen.queryByText(CELEBRATE)).toBeNull();
    expect(toastMock.error).toHaveBeenCalledTimes(1);
  });

  it("null resultUrl → 不慶祝、跳 toast.error", () => {
    const onSuccess = renderFlow();
    act(() => onSuccess({ resultUrl: null }));
    expect(screen.queryByText(CELEBRATE)).toBeNull();
    expect(toastMock.error).toHaveBeenCalledTimes(1);
  });

  it("有效 resultUrl → 顯示慶祝標題與作品圖、不跳 error", () => {
    const onSuccess = renderFlow();
    act(() => onSuccess({ resultUrl: "https://cdn.example/i.png" }));
    expect(screen.getByText(CELEBRATE)).toBeTruthy();
    const img = screen.getByAltText("您的第一個創作") as HTMLImageElement;
    expect(img.getAttribute("src")).toContain("https://cdn.example/i.png");
    expect(toastMock.error).not.toHaveBeenCalled();
  });
});

/**
 * AIDV-836: 分支 chip 導航不應污染瀏覽器 history。
 * 有 onBranchComplete → 單次導航（只呼叫 onBranchComplete(path)，不呼叫 onComplete）；
 * 沒傳 → 退回舊雙導航行為（呼叫 onComplete）。
 */
describe("OnboardingFlow branch navigation history (AIDV-836)", () => {
  const MUSIC_CHIP = /配上一段音樂/;

  it("有 onBranchComplete → 點分支 chip 只呼叫 onBranchComplete(path)、不呼叫 onComplete", () => {
    const onComplete = vi.fn();
    const onBranchComplete = vi.fn();
    render(
      <OnboardingFlow
        onComplete={onComplete}
        onSkip={vi.fn()}
        onBranchComplete={onBranchComplete}
      />,
    );
    act(() => captured.onSuccess!({ resultUrl: "https://cdn.example/i.png" }));
    const chip = screen.getByRole("button", { name: MUSIC_CHIP });
    act(() => chip.click());
    expect(onBranchComplete).toHaveBeenCalledTimes(1);
    expect(onBranchComplete).toHaveBeenCalledWith("/pro-studio");
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("未傳 onBranchComplete → 退回舊行為，呼叫 onComplete", () => {
    const onComplete = vi.fn();
    render(<OnboardingFlow onComplete={onComplete} onSkip={vi.fn()} />);
    act(() => captured.onSuccess!({ resultUrl: "https://cdn.example/i.png" }));
    const chip = screen.getByRole("button", { name: MUSIC_CHIP });
    act(() => chip.click());
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
