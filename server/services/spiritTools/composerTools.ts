/**
 * server/services/spiritTools/composerTools.ts
 *
 * Tools for 編編 (composer) — the in-room execution agent.
 *
 * 編編 is "the spirit who actually clicks the buttons". Its tools fall into
 * two layers:
 *   1. Page-action namespace (`page.*`) — opaque to the server; executed by
 *      the client's pageAgent dispatcher. The server's job is to validate
 *      the AgentAction shape and (if the user asked) hand it back to the
 *      client via a structured tool result.
 *   2. Multi-modal fal dispatch — when 編編 wants to go around the UI and
 *      generate an asset directly, it goes through `invokeSpiritModel`
 *      which inherits ALL_CATEGORIES capability for composer.
 *
 * Pure utility module: no DB, no router wiring; designed to be imported by
 * future tRPC endpoints + by orchestratorTools when the orchestrator needs
 * to "have 編編 execute on the current page".
 */

import { logger } from "../../_core/logger";
import {
  parseComposerImperatives,
  describeComposerActions,
  describeComposerMissing,
  type ComposerParseResult,
} from "../../../shared/composer-imperative-parser";
import type {
  AgentAction,
  PageAgentSnapshot,
} from "../../../shared/agent-actions";
import { invokeSpiritModel } from "../spiritDispatcher";
import { canSpiritCallCategory } from "../../../shared/orb-agent-roles";

// ─── Plan: imperative → actions ─────────────────────────────────────────────

export interface ComposerPlanInput {
  /** Free-form user instruction, e.g. "用 flux pro 比例 9:16 然後送出" */
  instruction: string;
  /**
   * Page snapshot the orb's pageAgent currently has. Determines which
   * AgentAction types are emittable (no setModel without a setModel cap).
   */
  snapshot: PageAgentSnapshot | null;
}

export interface ComposerPlanResult {
  ok: true;
  /** What 編編 would dispatch */
  actions: AgentAction[];
  /** What's missing — caller should reply with these as questions */
  missing: ComposerParseResult["missing"];
  /** Human-readable summary of dispatched actions */
  summary: string;
  /** Human-readable summary of what's still missing */
  followUp: string;
  /** Which parser rules fired — for telemetry */
  matchedRules: string[];
}

/**
 * Server-side mirror of the client's parser. Lets orchestrator / planner
 * pre-flight a 編編 dispatch ("what *would* 編編 do?") without round-
 * tripping to the browser. Pure — no I/O.
 */
export function planComposerActions(
  input: ComposerPlanInput,
): ComposerPlanResult {
  const parsed = parseComposerImperatives(input.instruction, input.snapshot);
  return {
    ok: true,
    actions: parsed.actions,
    missing: parsed.missing,
    summary: describeComposerActions(parsed.actions),
    followUp: describeComposerMissing(parsed.missing),
    matchedRules: parsed.matchedRules,
  };
}

// ─── Direct fal dispatch (when bypassing the UI is the right move) ─────────

export interface ComposerDispatchInput {
  userId: number;
  /** Picked by caller; composer is authorised across all categories. */
  modelId: string;
  prompt: string;
  imageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  aspectRatio?: string;
  durationSec?: number;
  seed?: number;
  numFrames?: number;
  fps?: number;
}

export interface ComposerDispatchResult {
  success: boolean;
  /** First-class asset URL extracted from the fal response, when present. */
  assetUrl: string | null;
  modelId: string;
  modelLabel: string;
  category: string;
  pointsDeducted: number;
  durationMs: number;
  message: string;
  error?: string;
}

/**
 * Have 編編 directly call a fal model (skipping the UI). Useful when the
 * orchestrator decides the user is offline / not at a studio page but
 * still wants the asset to land. Authorisation is double-checked inside
 * `invokeSpiritModel`; this wrapper just shapes the result for chat
 * surfaces.
 */
export async function dispatchAsComposer(
  input: ComposerDispatchInput,
): Promise<ComposerDispatchResult> {
  try {
    const result = await invokeSpiritModel({
      spirit: "composer",
      userId: input.userId,
      modelId: input.modelId,
      prompt: input.prompt,
      imageUrl: input.imageUrl,
      videoUrl: input.videoUrl,
      audioUrl: input.audioUrl,
      aspectRatio: input.aspectRatio,
      durationSec: input.durationSec,
      seed: input.seed,
      numFrames: input.numFrames,
      fps: input.fps,
    });

    const assetUrl = pickAssetUrl(result.data as Record<string, unknown>);

    if (!result.success) {
      logger.warn("composer_dispatch_failed", {
        userId: input.userId,
        modelId: input.modelId,
        error: result.error,
      });
      return {
        success: false,
        assetUrl: null,
        modelId: result.modelId,
        modelLabel: result.modelLabel,
        category: result.category,
        pointsDeducted: result.pointsDeducted,
        durationMs: result.durationMs,
        message: `編編沒能呼叫 ${result.modelLabel || result.modelId}：${result.error ?? "未知錯誤"}`,
        error: result.error,
      };
    }

    logger.info("composer_dispatch_success", {
      userId: input.userId,
      modelId: result.modelId,
      category: result.category,
      pointsDeducted: result.pointsDeducted,
      durationMs: result.durationMs,
    });

    return {
      success: true,
      assetUrl,
      modelId: result.modelId,
      modelLabel: result.modelLabel,
      category: result.category,
      pointsDeducted: result.pointsDeducted,
      durationMs: result.durationMs,
      message: assetUrl
        ? `編編用 ${result.modelLabel || result.modelId} 完成了。`
        : `編編完成了，但沒取到輸出 URL。`,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error("composer_dispatch_exception", {
      userId: input.userId,
      modelId: input.modelId,
      error: reason,
    });
    return {
      success: false,
      assetUrl: null,
      modelId: input.modelId,
      modelLabel: input.modelId,
      category: "unknown",
      pointsDeducted: 0,
      durationMs: 0,
      message: `編編呼叫時拋例外：${reason}`,
      error: reason,
    };
  }
}

/**
 * 把 fal.ai 各模型回應 shape 的差異統一成一個 URL。Mirror of the
 * extraction in GlobalOrbChatContext.spiritInvokeMut handler so server-side
 * callers don't have to re-derive it.
 */
function pickAssetUrl(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null;
  const direct = (data.url ?? (data as { output?: unknown }).output) as unknown;
  if (typeof direct === "string" && direct) return direct;
  const images = (data.images as Array<{ url?: string }> | undefined)
    ?? (data as { image?: { url?: string } | string }).image;
  if (Array.isArray(images) && images[0]?.url) return images[0].url;
  if (typeof images === "string") return images;
  const video = data.video as { url?: string } | undefined;
  if (video?.url) return video.url;
  const audio = data.audio as { url?: string } | undefined;
  if (audio?.url) return audio.url;
  return null;
}

// ─── Authorisation introspection ───────────────────────────────────────────

/**
 * Surface 編編's per-modality authorisation in one call — useful when an
 * orchestrator is deciding whether to delegate a task TO 編編 or to a more
 * specialised spirit. Returns `true` for every modality because composer's
 * `SPIRIT_MODEL_CAPABILITIES = ALL_CATEGORIES`; if that ever changes this
 * stays in sync because `canSpiritCallCategory` is the source of truth.
 */
export function getComposerCategoryMatrix(): Record<
  | "text-to-image"
  | "text-to-video"
  | "text-to-audio"
  | "text-to-speech"
  | "image-to-image"
  | "image-to-video"
  | "video-to-video"
  | "training",
  boolean
> {
  return {
    "text-to-image":  canSpiritCallCategory("composer", "text-to-image"),
    "text-to-video":  canSpiritCallCategory("composer", "text-to-video"),
    "text-to-audio":  canSpiritCallCategory("composer", "text-to-audio"),
    "text-to-speech": canSpiritCallCategory("composer", "text-to-speech"),
    "image-to-image": canSpiritCallCategory("composer", "image-to-image"),
    "image-to-video": canSpiritCallCategory("composer", "image-to-video"),
    "video-to-video": canSpiritCallCategory("composer", "video-to-video"),
    "training":       canSpiritCallCategory("composer", "training"),
  };
}
