import { describe, it, expect } from "vitest";
import { normalizeEngineModelId } from "../shared/engineModelIds";

describe("normalizeEngineModelId", () => {
  it("normalizes common legacy Fal IDs to canonical IDs", () => {
    expect(normalizeEngineModelId("fal/flux-pro-1.1")).toBe(
      "fal-ai/flux-pro/v1.1"
    );
    expect(normalizeEngineModelId("fal/kling-v2.1-pro-t2v")).toBe(
      "fal-ai/kling-video/v2.1/pro/text-to-video"
    );
    expect(normalizeEngineModelId("fal/playai-tts")).toBe("fal-ai/f5-tts");
    expect(normalizeEngineModelId("fal/wan-v2v")).toBe(
      "fal-ai/wan/v2.1/video-to-video"
    );
  });

  it("returns original value when no alias exists", () => {
    expect(normalizeEngineModelId("fal-ai/flux/dev")).toBe("fal-ai/flux/dev");
    expect(normalizeEngineModelId("gemini/veo-3")).toBe("gemini/veo-3");
  });

  // DEF-So1：Sonauto canonical id 不在 fal endpoint 上，必須改寫。
  it("rewrites fal-ai/sonauto to the real fal queue path", () => {
    expect(normalizeEngineModelId("fal-ai/sonauto")).toBe(
      "sonauto/v2/text-to-music"
    );
    expect(normalizeEngineModelId("fal/sonauto")).toBe(
      "sonauto/v2/text-to-music"
    );
  });

  // DEF-A1：fal.ai 下架 fal-ai/audioldm2，全部別名到 fal-ai/mmaudio-v2，
  // 阻止 dispatcher 因 catalog 不到而誤降級到 ace-step（音樂引擎）。
  it("rewrites all audioldm2 aliases to fal-ai/mmaudio-v2", () => {
    expect(normalizeEngineModelId("fal-ai/audioldm2")).toBe(
      "fal-ai/mmaudio-v2"
    );
    expect(normalizeEngineModelId("fal/audioldm2")).toBe("fal-ai/mmaudio-v2");
    expect(normalizeEngineModelId("fal/audioldm2-v2a")).toBe(
      "fal-ai/mmaudio-v2"
    );
  });

  // DEF-EL5：ElevenLabs SFX endpoint 帶 /v2 後綴。早期 catalog 用無 /v2 拼法
  // 註冊，必須改寫到真實 endpoint，否則 dispatcher 會把 SFX 請求降級到
  // text-to-audio[0] = fal-ai/ace-step（音樂引擎，產出根本不是音效）。
  it("rewrites ElevenLabs sound-effects to v2 canonical", () => {
    expect(normalizeEngineModelId("fal-ai/elevenlabs/sound-effects")).toBe(
      "fal-ai/elevenlabs/sound-effects/v2"
    );
  });
});
