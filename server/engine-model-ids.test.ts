import { describe, it, expect } from "vitest";
import {
  normalizeEngineModelId,
  nativeElevenLabsModelId,
} from "../shared/engineModelIds";

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

  // DEF-V5：ElevenLabs TTS 家族 short-form 必須對應到各自 canonical，過去
  // flash / eleven-v3 / multilingual 都被誤指到 turbo-v2.5（複製貼上 bug），
  // 導致 brain-driven 的選擇全被默默換成 turbo。
  it("maps each ElevenLabs TTS short-form to its own canonical (not all to turbo)", () => {
    expect(normalizeEngineModelId("elevenlabs/turbo-v2.5")).toBe(
      "fal-ai/elevenlabs/tts/turbo-v2.5"
    );
    expect(normalizeEngineModelId("elevenlabs/flash-v2.5")).toBe(
      "fal-ai/elevenlabs/tts/flash-v2.5"
    );
    expect(normalizeEngineModelId("elevenlabs/eleven-v3")).toBe(
      "fal-ai/elevenlabs/tts/eleven-v3"
    );
    expect(normalizeEngineModelId("elevenlabs/multilingual-v2")).toBe(
      "fal-ai/elevenlabs/tts/multilingual-v2"
    );
  });
});

describe("nativeElevenLabsModelId", () => {
  // DEF-V10：fal proxy 需 body.model_id（原生 ElevenLabs id），director / orb
  // 路徑沒帶就會落到 fal 預設 Turbo。helper 必須能從 canonical 路徑反推。
  it("derives native ElevenLabs id from each canonical fal path", () => {
    expect(nativeElevenLabsModelId("fal-ai/elevenlabs/tts/turbo-v2.5")).toBe(
      "eleven_turbo_v2_5"
    );
    expect(nativeElevenLabsModelId("fal-ai/elevenlabs/tts/flash-v2.5")).toBe(
      "eleven_flash_v2_5"
    );
    expect(
      nativeElevenLabsModelId("fal-ai/elevenlabs/tts/multilingual-v2")
    ).toBe("eleven_multilingual_v2");
    expect(nativeElevenLabsModelId("fal-ai/elevenlabs/tts/eleven-v3")).toBe(
      "eleven_v3"
    );
  });

  it("returns null for non-ElevenLabs-TTS paths", () => {
    expect(nativeElevenLabsModelId("fal-ai/f5-tts")).toBeNull();
    expect(
      nativeElevenLabsModelId("fal-ai/qwen-3-tts/text-to-speech/1.7b")
    ).toBeNull();
    expect(
      nativeElevenLabsModelId("fal-ai/elevenlabs/sound-effects/v2")
    ).toBeNull();
  });
});
