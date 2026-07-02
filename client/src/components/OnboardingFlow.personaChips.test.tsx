// @vitest-environment jsdom
/**
 * OnboardingFlow ×「下一步」chips persona 重排（AIDV-965）。
 * 守住：
 *   ① 【HARD 零回歸】未設 persona（localStorage 無 learn:beginner-path:persona）→
 *      chips 順序與現行 AIDV-810 完全相同（🎵→🎬→🎭→🖼️）。
 *   ② persona=brand → 🎭 導演最前、🎬 圖生影次之（依 CHIP_PRIORITY 重排）。
 *   ③ persona=general → 原順序（等同未選）。
 * mock 鷹架與 OnboardingFlow.test.tsx 相同（framer-motion 直通、trpc/sonner stub）。
 */
import type { ReactNode } from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, act, within } from "@testing-library/react";

const captured = vi.hoisted(() => ({ onSuccess: null as null | ((d: unknown) => void) }));
const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), message: vi.fn() }));

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
import { PERSONA_LS_KEY } from "@/shells/learn/beginnerPathPersonas";

// Map 版 localStorage stub：loadPersona／handleComplete 皆走這裡。
// 注意：stub 必須在 beforeEach 內設置、afterEach 內還原（vi.unstubAllGlobals）。
// module scope stub 不會自動還原，vitest fork worker 跨檔重用時會洩漏到
// 其他測試檔（或被其他檔的 stub 蓋掉），造成間歇性 flake。
const store = new Map<string, string>();
const localStorageStub = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => { store.clear(); },
};

beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", localStorageStub);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  captured.onSuccess = null;
});

/** 進到 result 慶祝態並回傳「下一步選項」group 內的 chip 標籤（依 DOM 順序）。 */
function renderAndGetChipLabels(): string[] {
  render(<OnboardingFlow onComplete={vi.fn()} onSkip={vi.fn()} />);
  expect(captured.onSuccess).toBeTypeOf("function");
  act(() => captured.onSuccess!({ resultUrl: "https://cdn.example/i.png" }));
  const group = screen.getByRole("group", { name: "下一步選項" });
  return within(group).getAllByRole("button").map((b) => b.textContent ?? "");
}

const ORIGINAL = [
  "🎵 配上一段音樂，作品就活了",
  "🎬 讓這張圖動起來（圖生影）",
  "🎭 做整支短片？交給導演 AI",
  "🖼️ 再生一張，換個風格試試",
];

describe("OnboardingFlow「下一步」chips persona 重排（AIDV-965）", () => {
  it("【HARD 零回歸】未設 persona → 順序與現行 AIDV-810 完全相同", () => {
    expect(renderAndGetChipLabels()).toEqual(ORIGINAL);
  });

  it("persona=general → 原順序（等同未選）", () => {
    store.set(PERSONA_LS_KEY, "general");
    expect(renderAndGetChipLabels()).toEqual(ORIGINAL);
  });

  it("persona=brand → 🎭 導演最前、🎬 圖生影次之", () => {
    store.set(PERSONA_LS_KEY, "brand");
    expect(renderAndGetChipLabels()).toEqual([
      "🎭 做整支短片？交給導演 AI",
      "🎬 讓這張圖動起來（圖生影）",
      "🎵 配上一段音樂，作品就活了",
      "🖼️ 再生一張，換個風格試試",
    ]);
  });

  it("persona=ecommerce → 🖼️ 再生一張最前（多張主圖最相關）", () => {
    store.set(PERSONA_LS_KEY, "ecommerce");
    expect(renderAndGetChipLabels()[0]).toBe("🖼️ 再生一張，換個風格試試");
  });

  it("localStorage 存了非法值 → 視同未選、原順序", () => {
    store.set(PERSONA_LS_KEY, "not-a-persona");
    expect(renderAndGetChipLabels()).toEqual(ORIGINAL);
  });
});
