/**
 * compilerValidation.ts — AIDV-172 Compiler Input Schema Validation
 *
 * Zod schemas for the three compiler inputs. Called at the top of each
 * compiler's compile() method. When COMPILER_SCHEMA_VALIDATION=0 the
 * validation only logs a warning and allows the call to proceed — providing
 * a fast rollback path if a legitimate edge-case input is too strict.
 *
 * Default: ON (validation errors throw and surface to the caller with a
 * structured COMPILER_INPUT_INVALID code).
 */

import { z } from "zod";
import { logger } from "../_core/logger";

export type CompilerName = "audio" | "video" | "voice";

// ─── AIDV-676: shared compiler contract ──────────────────────────────────────

/** Structural contract all compiler classes must satisfy. */
export interface ICompiler<TInput, TOutput> {
  compile(input: TInput): TOutput;
}

function isEnabled() {
  return process.env.COMPILER_SCHEMA_VALIDATION !== "0";
}

// ─── Audio ───────────────────────────────────────────────────────────────────

const AudioBlockSchema = z.object({
  id: z.string().max(200),
  category: z.enum(["instrument", "genre", "tempo", "ambiance"]),
  label: z.string().max(200),
  prompt: z.string().max(500),
});

export const AudioCompilerInputSchema = z.object({
  blocks: z.array(AudioBlockSchema).max(50),
  freePrompt: z.string().max(2_000).optional(),
  moodKeywords: z.array(z.string().max(100)).max(20).optional(),
  lyrics: z.string().max(5_000).optional(),
  targetDurationSec: z.number().min(1).max(600).optional(),
  instrumental: z.boolean().optional(),
  forceStructure: z
    .enum(["pop", "ambient", "edm", "ballad", "cinematic", "lofi", "minimal"])
    .optional(),
  bpmOverride: z.number().min(40).max(300).optional(),
});

// ─── Video ───────────────────────────────────────────────────────────────────

const VideoBlockSchema = z.object({
  id: z.string().max(200),
  category: z.enum(["subject", "action", "environment", "camera", "mood", "style"]),
  label: z.string().max(200),
  prompt: z.string().max(1_000),
});

export const VideoCompilerInputSchema = z.object({
  blocks: z.array(VideoBlockSchema).max(50),
  freePrompt: z.string().max(5_000).optional(),
  moodKeywords: z.array(z.string().max(100)).max(20).optional(),
  targetDurationSec: z.number().min(0.5).max(60).optional(),
  forceCameraMode: z
    .enum([
      "static",
      "dolly_in",
      "dolly_out",
      "pan_left",
      "pan_right",
      "tilt_up",
      "tilt_down",
      "orbit",
      "crane_up",
      "crane_down",
      "tracking",
      "handheld",
      "aerial_descent",
      "aerial_ascent",
      "push_in",
      "pull_out",
    ])
    .optional(),
  firstFrameUrl: z.string().max(2_048).optional(),
  lastFrameUrl: z.string().max(2_048).optional(),
  firstFrameDesc: z.string().max(500).optional(),
  lastFrameDesc: z.string().max(500).optional(),
  aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:3"]).optional(),
  slowMotion: z.boolean().optional(),
  styleOverride: z.string().max(200).optional(),
});

// ─── Voice ───────────────────────────────────────────────────────────────────

export const VoiceCompilerInputSchema = z.object({
  script: z
    .string()
    .min(1, "script 不能為空")
    .max(5_000, "script 超過 ElevenLabs 5000 字元上限"),
  moodBlock: z
    .object({
      blockId: z.string().max(200),
      label: z.string().max(200),
      prompt: z.string().max(1_000),
      emoji: z.string().optional(),
      isCustom: z.boolean(),
      customBlockId: z.number().optional(),
      emotionOverride: z.string().max(200).optional(),
    })
    .nullable()
    .optional(),
  vibeCardIds: z.array(z.string().max(100)).max(20).optional(),
  voiceId: z.string().max(100).optional(),
  rateOverride: z.string().max(20).optional(),
  enableHesitation: z.boolean().optional(),
  customBreakpoints: z.array(z.string().max(200)).max(20).optional(),
  resolvedCustomProfile: z.record(z.string(), z.unknown()).optional(),
});

// ─── Shared validate helper ───────────────────────────────────────────────────

export function validateCompilerInput(
  compiler: CompilerName,
  input: unknown,
  schema: z.ZodTypeAny
): void {
  const result = schema.safeParse(input);
  if (result.success) return;

  const issues = result.error.issues
    .map(i => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");

  const msg = `[${compiler}Compiler] 輸入驗證失敗 — ${issues}`;

  if (!isEnabled()) {
    logger.warn(msg, { compiler, issues: result.error.issues });
    return;
  }

  logger.error(msg, { compiler, issues: result.error.issues });
  const err = new Error(msg);
  (err as any).code = "COMPILER_INPUT_INVALID";
  (err as any).issues = result.error.issues;
  throw err;
}
