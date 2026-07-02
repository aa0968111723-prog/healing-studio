// @vitest-environment jsdom
/**
 * VoiceAmbientCanvas（AIDV-254 · /video 旁白語音風格選擇器）行為測試。
 * Source-anchored 守四件事：
 *   ① 純函式 buildVoiceSubmitInput 的引擎×聲線映射（doSubmit 唯一提交來源）——
 *      qwen→voice、eleven→voice_id、環境音不吃聲線；「系統預設」→ undefined
 *      （序列化後不出現在請求體＝加性預設不變的硬承諾）。
 *   ② TTS 引擎顯示「語音風格」選擇器；環境音引擎不顯示。
 *   ③ 預設（未動選擇器）送出 → qwenTTS 收到 { text, voice: undefined }＝與既有行為位元相同。
 *   ④ 聲線清單查詢失敗 → 顯示回退說明、仍可送出（行為不變）。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  qwenMutateAsync: vi.fn(),
  elevenMutateAsync: vi.fn(),
  sfxMutateAsync: vi.fn(),
  voiceStylesData: undefined as unknown,
  voiceStylesError: false,
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
}));
vi.mock("@/config/videoFlags", () => ({ ENABLE_VIDEO_GATE_KIT: false }));
vi.mock("@/components/design-kit", () => ({
  AidvKit: ({ children }: { children?: unknown }) => children ?? null,
  Card: ({ children }: { children?: unknown }) => children ?? null,
  Pill: ({ children }: { children?: unknown }) => children ?? null,
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      generate: { estimateCost: { fetch: vi.fn(async () => ({ pointsCost: 3 })) } },
    }),
    proStudio: {
      qwenTTS: {
        useMutation: () => ({ mutateAsync: h.qwenMutateAsync, isPending: false }),
      },
      elevenLabsTTS: {
        useMutation: () => ({ mutateAsync: h.elevenMutateAsync, isPending: false }),
      },
      soundEffects: {
        useMutation: () => ({ mutateAsync: h.sfxMutateAsync, isPending: false }),
      },
      voiceStyles: {
        useQuery: () => ({
          data: h.voiceStylesData,
          isLoading: false,
          isError: h.voiceStylesError,
        }),
      },
    },
    brain: {
      providerSystemStatus: {
        useQuery: () => ({
          data: { status: "healthy", affectedProviders: [] as string[] },
          isLoading: false,
          isError: false,
        }),
      },
    },
  },
}));

// jsdom 無 ResizeObserver；Radix Select 觸發器需要（與其他座艙測試一致）。
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub;

import {
  VoiceAmbientCanvas,
  buildVoiceSubmitInput,
  VOICE_STYLE_DEFAULT,
} from "./VoiceAmbientCanvas";

const CATALOG = {
  elevenlabs: [
    { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", gender: "female", description: "平靜、年輕，適合敘事", language: "英文（美式）" },
    { id: "pNInz6obpgDQGcFmaJgB", name: "Adam", gender: "male", description: "深沉，紀錄片敘事", language: "英文（美式）" },
  ],
  qwen: [
    { id: "Vivian", name: "Vivian", gender: "female", description: "中文女聲・自然溫暖（後端預設）", language: "中文" },
    { id: "Dylan", name: "Dylan", gender: "male", description: "中文男聲・沉穩大氣", language: "中文" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  h.voiceStylesData = CATALOG;
  h.voiceStylesError = false;
  h.qwenMutateAsync.mockResolvedValue({ request_id: "req_qwen_123456789", estimated_credits: 3 });
  h.elevenMutateAsync.mockResolvedValue({ request_id: "req_el_123456789", estimated_credits: 5 });
  h.sfxMutateAsync.mockResolvedValue({ request_id: "req_sfx_123456789", estimated_credits: 2 });
});
afterEach(() => cleanup());

describe("buildVoiceSubmitInput（doSubmit 唯一提交映射）", () => {
  it("qwenTTS＋系統預設 → { text, voice: undefined }（鍵存在但值為 undefined＝序列化後消失）", () => {
    const r = buildVoiceSubmitInput("qwenTTS", "你好世界", VOICE_STYLE_DEFAULT);
    expect(r.engine).toBe("qwenTTS");
    expect(r.input).toEqual({ text: "你好世界", voice: undefined });
    // 加性硬承諾：與既有 { text } 請求序列化後位元相同。
    expect(JSON.stringify(r.input)).toBe(JSON.stringify({ text: "你好世界" }));
  });

  it("qwenTTS＋指定聲線 → voice 帶 Qwen 預訓練名稱", () => {
    const r = buildVoiceSubmitInput("qwenTTS", "你好", "Dylan");
    expect(r.input).toEqual({ text: "你好", voice: "Dylan" });
  });

  it("elevenLabsTTS＋系統預設 → voice_id undefined；指定聲線 → voice_id 帶真實 id", () => {
    const d = buildVoiceSubmitInput("elevenLabsTTS", "hello", VOICE_STYLE_DEFAULT);
    expect(d.input).toEqual({ text: "hello", voice_id: undefined });
    expect(JSON.stringify(d.input)).toBe(JSON.stringify({ text: "hello" }));
    const c = buildVoiceSubmitInput("elevenLabsTTS", "hello", "21m00Tcm4TlvDq8ikWAM");
    expect(c.input).toEqual({ text: "hello", voice_id: "21m00Tcm4TlvDq8ikWAM" });
  });

  it("soundEffects 不吃聲線：即使誤傳聲線也不進 payload，維持 500 字截斷＋固定秒數", () => {
    const long = "風".repeat(600);
    const r = buildVoiceSubmitInput("soundEffects", long, "Dylan");
    expect(r.engine).toBe("soundEffects");
    expect(r.input).toEqual({ text: "風".repeat(500), duration_seconds: 6 });
    expect(JSON.stringify(r.input)).not.toContain("Dylan");
  });
});

describe("VoiceAmbientCanvas 語音風格選擇器（AIDV-254）", () => {
  it("TTS 引擎（預設 qwenTTS）顯示語音風格選擇器，預設值＝系統預設", () => {
    render(<VoiceAmbientCanvas />);
    expect(screen.getByText("語音風格")).toBeTruthy();
    // Radix SelectValue 會渲染選中項文字（qwen 預設項標注 Vivian）。
    expect(screen.getByText(/系統預設（Vivian・中文女聲）/)).toBeTruthy();
  });

  it("切到環境音引擎 → 選擇器不渲染（環境音無聲線概念）", () => {
    render(<VoiceAmbientCanvas />);
    fireEvent.click(screen.getByText("環境音 / 音效"));
    expect(screen.queryByText("語音風格")).toBeNull();
  });

  it("預設（未動選擇器）送出 → qwenTTS 收到 voice: undefined（與既有行為位元相同）", async () => {
    render(<VoiceAmbientCanvas />);
    fireEvent.change(screen.getByPlaceholderText(/輸入要配音的旁白文字/), {
      target: { value: "今天的療癒故事" },
    });
    fireEvent.click(screen.getByText("確認生成"));
    await waitFor(() => expect(h.qwenMutateAsync).toHaveBeenCalledTimes(1));
    expect(h.qwenMutateAsync).toHaveBeenCalledWith({ text: "今天的療癒故事", voice: undefined });
    expect(h.elevenMutateAsync).not.toHaveBeenCalled();
  });

  it("切到 ElevenLabs 引擎送出 → elevenLabsTTS 收到 voice_id: undefined（預設不變）", async () => {
    render(<VoiceAmbientCanvas />);
    fireEvent.click(screen.getByText(/配音 · ElevenLabs/));
    fireEvent.change(screen.getByPlaceholderText(/輸入要配音的旁白文字/), {
      target: { value: "narration test" },
    });
    fireEvent.click(screen.getByText("確認生成"));
    await waitFor(() => expect(h.elevenMutateAsync).toHaveBeenCalledTimes(1));
    expect(h.elevenMutateAsync).toHaveBeenCalledWith({ text: "narration test", voice_id: undefined });
  });

  it("聲線清單查詢失敗 → 顯示回退說明，且仍可用系統預設送出（行為不變）", async () => {
    h.voiceStylesData = undefined;
    h.voiceStylesError = true;
    render(<VoiceAmbientCanvas />);
    expect(screen.getByText(/聲線清單載入失敗/)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/輸入要配音的旁白文字/), {
      target: { value: "退路測試" },
    });
    fireEvent.click(screen.getByText("確認生成"));
    await waitFor(() => expect(h.qwenMutateAsync).toHaveBeenCalledTimes(1));
    expect(h.qwenMutateAsync).toHaveBeenCalledWith({ text: "退路測試", voice: undefined });
  });
});
