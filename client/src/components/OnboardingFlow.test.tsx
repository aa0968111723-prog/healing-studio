// @vitest-environment jsdom
/**
 * OnboardingFlow result-step guard — AIDV-637
 * 驗收條件（首次體驗的誤導性成功態）：
 * - 生成 onSuccess 帶空/空白/null resultUrl → 不顯示「你的第一件作品完成了！」、跳 toast.error、不進慶祝態
 * - 生成 onSuccess 帶有效 resultUrl → 顯示慶祝標題與作品圖
 */
import type { ReactNode } from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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
    const img = screen.getByAltText("Your first creation") as HTMLImageElement;
    expect(img.getAttribute("src")).toContain("https://cdn.example/i.png");
    expect(toastMock.error).not.toHaveBeenCalled();
  });
});
