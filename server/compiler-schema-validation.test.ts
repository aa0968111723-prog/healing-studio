/**
 * compiler-schema-validation.test.ts — AIDV-172
 *
 * 驗收（AIDV-172 工作表）：
 *   1. 餵超長 prompt/壞 SSML input → 回明確錯誤（code=COMPILER_INPUT_INVALID）
 *   2. 正常輸入照常通過
 *   3. COMPILER_SCHEMA_VALIDATION=0 → 僅 warn，不擋（fail-open 退路）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── logger mock (prevents actual log output + lets us assert warn/error) ────

const loggerMock = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }));
vi.mock("./_core/logger", () => ({ logger: loggerMock }));

import {
  AudioCompilerInputSchema,
  VideoCompilerInputSchema,
  VoiceCompilerInputSchema,
  validateCompilerInput,
} from "./services/compilerValidation";
import { AudioCompiler } from "./services/audioCompiler";
import { VideoCompiler } from "./services/videoCompiler";
import { VoiceCompiler } from "./services/voiceCompiler";

// ─── helpers ─────────────────────────────────────────────────────────────────

function mkAudioBlock(prompt = "piano", category = "instrument" as const) {
  return { id: `b_${category}`, category, label: prompt, prompt };
}

function mkVideoBlock(prompt = "sunset", category = "environment" as const) {
  return { id: `v_${category}`, category, label: prompt, prompt };
}

const audioCompiler = new AudioCompiler();
const videoCompiler = new VideoCompiler();
const voiceCompiler = new VoiceCompiler();

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.COMPILER_SCHEMA_VALIDATION;
});

afterEach(() => {
  delete process.env.COMPILER_SCHEMA_VALIDATION;
});

// ─── Unit: schema validation module ──────────────────────────────────────────

describe("validateCompilerInput — unit", () => {
  it("valid input passes silently", () => {
    expect(() =>
      validateCompilerInput("audio", { blocks: [mkAudioBlock()] }, AudioCompilerInputSchema)
    ).not.toThrow();
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it("invalid input throws with code=COMPILER_INPUT_INVALID (flag ON)", () => {
    const tooLong = "x".repeat(2_001);
    let err: any;
    try {
      validateCompilerInput(
        "audio",
        { blocks: [mkAudioBlock()], freePrompt: tooLong },
        AudioCompilerInputSchema
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeTruthy();
    expect(err.code).toBe("COMPILER_INPUT_INVALID");
    expect(err.message).toContain("audioCompiler");
    expect(loggerMock.error).toHaveBeenCalled();
  });

  it("COMPILER_SCHEMA_VALIDATION=0 → warns but does NOT throw", () => {
    process.env.COMPILER_SCHEMA_VALIDATION = "0";
    const tooLong = "x".repeat(2_001);
    expect(() =>
      validateCompilerInput(
        "audio",
        { blocks: [mkAudioBlock()], freePrompt: tooLong },
        AudioCompilerInputSchema
      )
    ).not.toThrow();
    expect(loggerMock.warn).toHaveBeenCalled();
    expect(loggerMock.error).not.toHaveBeenCalled();
  });
});

// ─── AudioCompiler.compile() integration ─────────────────────────────────────

describe("AudioCompiler — schema validation (AIDV-172)", () => {
  it("valid minimal input compiles normally", () => {
    const result = audioCompiler.compile({ blocks: [mkAudioBlock()] });
    expect(result.prompt).toBeTruthy();
  });

  it("超長 freePrompt（2001 chars）→ throws COMPILER_INPUT_INVALID", () => {
    expect(() =>
      audioCompiler.compile({
        blocks: [mkAudioBlock()],
        freePrompt: "x".repeat(2_001),
      })
    ).toThrow(/COMPILER_INPUT_INVALID|audioCompiler/);
  });

  it("超出 BPM 上限（301）→ throws", () => {
    expect(() =>
      audioCompiler.compile({ blocks: [mkAudioBlock()], bpmOverride: 301 })
    ).toThrow();
  });

  it("BPM 下限以下（39）→ throws", () => {
    expect(() =>
      audioCompiler.compile({ blocks: [mkAudioBlock()], bpmOverride: 39 })
    ).toThrow();
  });

  it("blocks 超過 50 個 → throws", () => {
    const blocks = Array.from({ length: 51 }, (_, i) => mkAudioBlock(`p${i}`));
    expect(() => audioCompiler.compile({ blocks })).toThrow();
  });

  it("forceStructure 非法值 → throws", () => {
    expect(() =>
      audioCompiler.compile({
        blocks: [mkAudioBlock()],
        forceStructure: "invalid_structure" as any,
      })
    ).toThrow();
  });

  it("flag=0 → freePrompt 超長仍可通過（fail-open）", () => {
    process.env.COMPILER_SCHEMA_VALIDATION = "0";
    const result = audioCompiler.compile({
      blocks: [mkAudioBlock()],
      freePrompt: "x".repeat(2_001),
    });
    expect(result.prompt).toBeTruthy();
    expect(loggerMock.warn).toHaveBeenCalled();
  });
});

// ─── VideoCompiler.compile() integration ─────────────────────────────────────

describe("VideoCompiler — schema validation (AIDV-172)", () => {
  it("valid input compiles normally", () => {
    const result = videoCompiler.compile({
      blocks: [mkVideoBlock()],
      aspectRatio: "16:9",
    });
    expect(result.prompt).toBeTruthy();
  });

  it("超長 freePrompt（5001 chars）→ throws", () => {
    expect(() =>
      videoCompiler.compile({
        blocks: [mkVideoBlock()],
        freePrompt: "y".repeat(5_001),
      })
    ).toThrow();
  });

  it("targetDurationSec 超過 60 秒 → throws", () => {
    expect(() =>
      videoCompiler.compile({
        blocks: [mkVideoBlock()],
        targetDurationSec: 61,
      })
    ).toThrow();
  });

  it("非法 aspectRatio → throws", () => {
    expect(() =>
      videoCompiler.compile({
        blocks: [mkVideoBlock()],
        aspectRatio: "3:2" as any,
      })
    ).toThrow();
  });

  it("非法 forceCameraMode → throws", () => {
    expect(() =>
      videoCompiler.compile({
        blocks: [mkVideoBlock()],
        forceCameraMode: "zoom_in" as any,
      })
    ).toThrow();
  });

  it("flag=0 → 超長 freePrompt 仍可通過", () => {
    process.env.COMPILER_SCHEMA_VALIDATION = "0";
    const result = videoCompiler.compile({
      blocks: [mkVideoBlock()],
      freePrompt: "y".repeat(5_001),
    });
    expect(result.prompt).toBeTruthy();
    expect(loggerMock.warn).toHaveBeenCalled();
  });
});

// ─── VoiceCompiler.compile() integration ─────────────────────────────────────

describe("VoiceCompiler — schema validation (AIDV-172)", () => {
  it("valid input compiles normally", () => {
    const result = voiceCompiler.compile({ script: "你好世界" });
    expect(result.ssml).toContain("<speak>");
  });

  it("空 script → throws", () => {
    expect(() => voiceCompiler.compile({ script: "" })).toThrow();
  });

  it("超長 script（5001 chars）→ throws（ElevenLabs 上限）", () => {
    expect(() =>
      voiceCompiler.compile({ script: "a".repeat(5_001) })
    ).toThrow(/5000|COMPILER_INPUT_INVALID/);
  });

  it("超長 voiceId（101 chars）→ throws", () => {
    expect(() =>
      voiceCompiler.compile({
        script: "hello",
        voiceId: "v".repeat(101),
      })
    ).toThrow();
  });

  it("flag=0 → 空 script 仍可通過（fail-open）", () => {
    process.env.COMPILER_SCHEMA_VALIDATION = "0";
    expect(() => voiceCompiler.compile({ script: "" })).not.toThrow();
    expect(loggerMock.warn).toHaveBeenCalled();
  });
});
