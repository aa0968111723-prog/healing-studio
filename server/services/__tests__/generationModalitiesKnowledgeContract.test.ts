/**
 * generationModalitiesKnowledgeContract.test.ts — AIDV-631
 *
 * 守住 GENERATION_MODALITIES_KNOWLEDGE 的參數名與四個 compiler input schema 的欄位名同步：
 * 1. Schema shape guard — compiler schema 的 key 存在即通過；key 被改名時此測試先紅。
 * 2. Knowledge coverage guard — 知識文字包含各模態的核心參數名。
 *
 * 純靜態斷言，零 mock，零 DB/網路，跑在任何環境。
 */

import { describe, it, expect } from "vitest";
import {
  AudioCompilerInputSchema,
  VideoCompilerInputSchema,
  VoiceCompilerInputSchema,
} from "../compilerValidation";
import { GENERATION_MODALITIES_KNOWLEDGE } from "../siteKnowledge";

// ─── helpers ─────────────────────────────────────────────────────────────────

function schemaKeys<T extends { shape: Record<string, unknown> }>(schema: T): string[] {
  return Object.keys(schema.shape);
}

// ─── 1. Schema shape guards ───────────────────────────────────────────────────

describe("AIDV-631 compiler schema shape guards", () => {
  it("AudioCompilerInputSchema 含預期欄位", () => {
    const keys = schemaKeys(AudioCompilerInputSchema);
    const expected = [
      "blocks",
      "freePrompt",
      "moodKeywords",
      "lyrics",
      "targetDurationSec",
      "instrumental",
      "forceStructure",
      "bpmOverride",
    ];
    for (const k of expected) {
      expect(keys, `AudioCompilerInputSchema 缺少 key: ${k}`).toContain(k);
    }
  });

  it("VideoCompilerInputSchema 含預期欄位", () => {
    const keys = schemaKeys(VideoCompilerInputSchema);
    const expected = [
      "blocks",
      "freePrompt",
      "moodKeywords",
      "targetDurationSec",
      "forceCameraMode",
      "firstFrameUrl",
      "lastFrameUrl",
      "firstFrameDesc",
      "lastFrameDesc",
      "aspectRatio",
      "slowMotion",
      "styleOverride",
    ];
    for (const k of expected) {
      expect(keys, `VideoCompilerInputSchema 缺少 key: ${k}`).toContain(k);
    }
  });

  it("VoiceCompilerInputSchema 含預期欄位", () => {
    const keys = schemaKeys(VoiceCompilerInputSchema);
    const expected = [
      "script",
      "moodBlock",
      "vibeCardIds",
      "voiceId",
      "rateOverride",
      "enableHesitation",
      "customBreakpoints",
      "resolvedCustomProfile",
    ];
    for (const k of expected) {
      expect(keys, `VoiceCompilerInputSchema 缺少 key: ${k}`).toContain(k);
    }
  });
});

// ─── 2. Knowledge coverage guards ────────────────────────────────────────────

describe("AIDV-631 GENERATION_MODALITIES_KNOWLEDGE coverage", () => {
  it("圖片參數：核心 key 名出現在知識文字中", () => {
    const imgParams = ["aspectRatio", "quality", "guidance_scale", "num_inference_steps", "seed", "negative_prompt"];
    for (const param of imgParams) {
      expect(GENERATION_MODALITIES_KNOWLEDGE, `圖片知識缺少參數: ${param}`).toContain(param);
    }
  });

  it("影片參數：核心 key 名出現在知識文字中", () => {
    const vidParams = ["duration", "aspect_ratio", "negative_prompt", "cfg_scale", "camera_motion"];
    for (const param of vidParams) {
      expect(GENERATION_MODALITIES_KNOWLEDGE, `影片知識缺少參數: ${param}`).toContain(param);
    }
  });

  it("音樂參數：核心 key 名出現在知識文字中", () => {
    const audioParams = ["duration", "bpm", "lyrics"];
    for (const param of audioParams) {
      expect(GENERATION_MODALITIES_KNOWLEDGE, `音樂知識缺少參數: ${param}`).toContain(param);
    }
  });
});
