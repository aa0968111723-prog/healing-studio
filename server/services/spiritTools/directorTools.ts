/**
 * server/services/spiritTools/directorTools.ts
 *
 * Tools for director (導導) spirit — turns 導導 into a real AI agent that can:
 *   1. compose multi-step, cross-page workflows (composeWorkflow)
 *   2. estimate the total point cost + suggest cheaper substitutes (estimateBudget)
 *   3. pick the right downstream specialist via the collab protocol (suggestHandoff)
 *   4. refine an existing workflow according to user instructions (refineWorkflow)
 *
 * These helpers are pure (no LLM calls themselves) — the LLM-driven planner
 * upstream feeds them concrete inputs, and they return deterministic,
 * inspectable results. That keeps 導導 explainable: every step it proposes
 * traces back to either the deterministic templates here or to a logged LLM
 * decision, never to opaque hand-waving.
 *
 * The LLM-driven entry point (director.suggestPlan) lives in
 * server/services/agentToolExecutor.ts → dispatchDirectorTool; the planning
 * tools here are server-side primitives the dispatcher can call to assemble
 * a richer plan around the LLM's structured output.
 */

import {
  estimatePoints,
  getModelPricing,
  pointsToUsd,
  type PointsEstimate,
} from "../modelPricing";
import {
  walkProtocolHandoffChain,
  pickBestHandoff,
  scoreProtocolHandoffs,
  getPrimaryNicknameForRole,
  SPIRIT_COLLAB_PROTOCOL,
  type AgentRole,
  type HandoffPickContext,
} from "../../../shared/orb-agent-roles";
import type {
  AgentWorkflowStep,
  RunWorkflowAction,
} from "../../../shared/agent-actions";
import { logger } from "../../_core/logger";
import type { OrbQuotaSnapshot } from "../orbQuota";

// ─── Workflow templates ─────────────────────────────────────────────────────
// 這些是 director 在沒有 LLM 補充時的安全 baseline。每個對應一條已驗證的
// 跨頁工作流（先出 key visual → 接成短片 → 加旁白 + BGM 之類），步驟 id
// 與下游的 step-ref resolver（`${step_xxx.image_url}`）對齊。LLM 可在此上
// 微調 prompt、加減步驟，但拓撲不會被打散。

export type WorkflowKind =
  | "short_video"
  | "image_only"
  | "music_only"
  | "voice_only"
  | "key_visual_to_video"
  | "tutorial_set";

export type BudgetMode = "cheap" | "balanced" | "premium";

export interface ComposeWorkflowInput {
  /** 使用者最終想交付什麼（一句話，會塞進每一步的 prompt） */
  brief: string;
  /** 工作流類型；不指定時依 brief 關鍵字推斷 */
  kind?: WorkflowKind;
  /** 平台規格 — 影響 aspect_ratio / 長度預設 */
  platform?: "instagram_reels" | "tiktok" | "youtube_shorts" | "youtube_long" | "general";
  /** 預算模式：cheap 走草稿級模型；balanced 預設；premium 走旗艦 */
  budgetMode?: BudgetMode;
  /** 加入「需要使用者批准 step-by-step」的閘門 */
  stepByStep?: boolean;
}

export interface ComposedWorkflow {
  /** 直接可送進 page-agent 的 RunWorkflowAction */
  workflow: RunWorkflowAction;
  /** 給 UI 顯示用：每步建議由哪位精靈接手（@暱稱） */
  handoffs: Array<{ stepId: string; spirit: AgentRole; nickname: string; reason: string }>;
  /** 給 UI 顯示用：偵測到的工作流類型 */
  kind: WorkflowKind;
}

const PLATFORM_DEFAULTS: Record<
  NonNullable<ComposeWorkflowInput["platform"]>,
  { aspectRatio: string; videoSeconds: number }
> = {
  instagram_reels: { aspectRatio: "9:16", videoSeconds: 30 },
  tiktok: { aspectRatio: "9:16", videoSeconds: 15 },
  youtube_shorts: { aspectRatio: "9:16", videoSeconds: 30 },
  youtube_long: { aspectRatio: "16:9", videoSeconds: 60 },
  general: { aspectRatio: "16:9", videoSeconds: 30 },
};

// 預算分級對應的代表模型 — 跟 modelPricing 目錄裡實際存在的 ID 對齊，
// 沒在目錄裡的 ID 會在 estimateWorkflowBudget 中被當成未知模型（5 pts）
// 處理，這時 caller 應改回 budgetMode=balanced。
const BUDGET_MODELS = {
  cheap: {
    image: "fal-ai/flux/schnell",
    video: "fal-ai/wan-i2v",
    music: "fal-ai/stable-audio",
    voice: "fal-ai/kokoro/american-english",
  },
  balanced: {
    image: "fal-ai/flux-pro/v1.1",
    video: "fal-ai/kling-video/v2.1/standard/image-to-video",
    music: "fal-ai/elevenlabs/music",
    voice: "elevenlabs/eleven-v3",
  },
  premium: {
    image: "fal-ai/flux-pro/v1.1-ultra",
    video: "fal-ai/kling-video/v2.1/pro/image-to-video",
    music: "fal-ai/suno-v4",
    voice: "elevenlabs/multilingual-v2",
  },
} as const;

function inferKind(brief: string): WorkflowKind {
  const low = brief.toLowerCase();
  if (/影片|短片|reels?|tiktok|video|短影音|mv/.test(low)) return "short_video";
  if (/音樂|歌|bgm|配樂|music/.test(low)) return "music_only";
  if (/配音|旁白|語音|voice|tts/.test(low)) return "voice_only";
  if (/教學|tutorial|step-by-step|系列/.test(low)) return "tutorial_set";
  if (/海報|插畫|圖|image|illustration|poster/.test(low)) return "image_only";
  return "short_video";
}

function inferPlatform(brief: string): NonNullable<ComposeWorkflowInput["platform"]> {
  const low = brief.toLowerCase();
  if (/tiktok|抖音/.test(low)) return "tiktok";
  if (/reels?|限動|instagram|ig\b/.test(low)) return "instagram_reels";
  if (/shorts/.test(low)) return "youtube_shorts";
  if (/youtube|長片|長版/.test(low)) return "youtube_long";
  return "general";
}

function summarizeBrief(brief: string, maxLen = 200): string {
  const trimmed = brief.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}…`;
}

/**
 * 組出一條跨頁、可由 page agent 依序執行的 workflow。
 * 結果是純資料 — caller 可直接放進 AgentAction[] 回給前端，前端
 * page-agent-orchestrator 會依序執行（含 step-ref 解析 `${stepId.image_url}`）。
 */
export function composeWorkflow(input: ComposeWorkflowInput): ComposedWorkflow {
  const brief = summarizeBrief(input.brief);
  const kind = input.kind ?? inferKind(brief);
  const platform = input.platform ?? inferPlatform(brief);
  const budget = input.budgetMode ?? "balanced";
  const models = BUDGET_MODELS[budget];
  const defaults = PLATFORM_DEFAULTS[platform];
  const confirmationMode = input.stepByStep ? "step-by-step" : "all-at-once";

  let workflow: RunWorkflowAction;
  let handoffs: ComposedWorkflow["handoffs"];

  switch (kind) {
    case "image_only":
      workflow = {
        type: "runWorkflow",
        name: "導導：圖片企劃 → 生成",
        confirmationMode,
        steps: [
          {
            id: "step_image",
            path: "/image-studio",
            actionType: "submit",
            payload: "",
            label: "圖圖：依企劃生成主視覺",
            toolName: "studio.generateImage",
            toolArgs: {
              prompt: brief,
              modelId: models.image,
              aspect_ratio: defaults.aspectRatio,
            },
          },
        ],
      };
      handoffs = [
        { stepId: "step_image", spirit: "image-specialist", nickname: getPrimaryNicknameForRole("image-specialist"), reason: "圖像生成" },
      ];
      break;

    case "music_only":
      workflow = {
        type: "runWorkflow",
        name: "導導：BGM 規劃 → 生成",
        confirmationMode,
        steps: [
          {
            id: "step_music",
            path: "/pro-studio",
            actionType: "submit",
            payload: "",
            label: "音音：依企劃生成 BGM",
            toolName: "studio.generateAudio",
            toolArgs: { prompt: brief, modelId: models.music },
          },
        ],
      };
      handoffs = [
        { stepId: "step_music", spirit: "music-specialist", nickname: getPrimaryNicknameForRole("music-specialist"), reason: "音樂生成" },
      ];
      break;

    case "voice_only":
      workflow = {
        type: "runWorkflow",
        name: "導導：旁白稿 → 配音",
        confirmationMode,
        steps: [
          {
            id: "step_voice",
            path: "/pro-studio",
            actionType: "submit",
            payload: "",
            label: "聲聲：依旁白稿生成配音",
            toolName: "studio.generateVoice",
            toolArgs: { prompt: brief, modelId: models.voice },
          },
        ],
      };
      handoffs = [
        { stepId: "step_voice", spirit: "voice-specialist", nickname: getPrimaryNicknameForRole("voice-specialist"), reason: "語音合成" },
      ];
      break;

    case "key_visual_to_video":
      workflow = {
        type: "runWorkflow",
        name: "導導：主視覺 → 動畫化",
        confirmationMode,
        steps: [
          {
            id: "step_image",
            path: "/image-studio",
            actionType: "submit",
            payload: "",
            label: "圖圖：建立主視覺 key frame",
            toolName: "studio.generateImage",
            toolArgs: {
              prompt: `${brief}（key visual，留標題與字幕空間）`,
              modelId: models.image,
              aspect_ratio: defaults.aspectRatio,
            },
          },
          {
            id: "step_video",
            path: "/video-studio",
            actionType: "submit",
            payload: "",
            label: "影影：把主視覺延伸成短片",
            toolName: "studio.generateVideo",
            dependsOn: ["step_image"],
            toolArgs: {
              prompt: `${brief}（依 key visual 延伸 ${defaults.videoSeconds}s 短片）`,
              modelId: models.video,
              image_url: "${step_image.image_url}",
              duration: defaults.videoSeconds,
              aspect_ratio: defaults.aspectRatio,
            },
          },
        ],
      };
      handoffs = [
        { stepId: "step_image", spirit: "image-specialist", nickname: getPrimaryNicknameForRole("image-specialist"), reason: "key visual" },
        { stepId: "step_video", spirit: "video-specialist", nickname: getPrimaryNicknameForRole("video-specialist"), reason: "i2v 動畫" },
      ];
      break;

    case "tutorial_set":
      workflow = {
        type: "runWorkflow",
        name: "導導：教學系列 → 三張示範圖",
        confirmationMode,
        steps: [
          {
            id: "step_intro",
            path: "/image-studio",
            actionType: "submit",
            payload: "",
            label: "圖圖：教學首頁封面",
            toolName: "studio.generateImage",
            toolArgs: {
              prompt: `${brief}（教學系列封面：標題清楚、留字區）`,
              modelId: models.image,
              aspect_ratio: "16:9",
            },
          },
          {
            id: "step_step1",
            path: "/image-studio",
            actionType: "submit",
            payload: "",
            label: "圖圖：步驟 1 示範圖",
            toolName: "studio.generateImage",
            toolArgs: {
              prompt: `${brief}（教學步驟 1：清楚示範動作）`,
              modelId: models.image,
              aspect_ratio: "16:9",
            },
          },
          {
            id: "step_step2",
            path: "/image-studio",
            actionType: "submit",
            payload: "",
            label: "圖圖：步驟 2 示範圖",
            toolName: "studio.generateImage",
            toolArgs: {
              prompt: `${brief}（教學步驟 2：對照 step 1 的延伸動作）`,
              modelId: models.image,
              aspect_ratio: "16:9",
            },
          },
        ],
      };
      handoffs = [
        { stepId: "step_intro", spirit: "image-specialist", nickname: getPrimaryNicknameForRole("image-specialist"), reason: "封面" },
        { stepId: "step_step1", spirit: "image-specialist", nickname: getPrimaryNicknameForRole("image-specialist"), reason: "示範圖" },
        { stepId: "step_step2", spirit: "image-specialist", nickname: getPrimaryNicknameForRole("image-specialist"), reason: "示範圖" },
      ];
      break;

    case "short_video":
    default:
      // 完整跨頁四模態流程：圖 → 影 → 配音 → BGM
      workflow = {
        type: "runWorkflow",
        name: `導導：${defaults.videoSeconds}s 短片生成流程`,
        confirmationMode,
        steps: [
          {
            id: "step_image",
            path: "/image-studio",
            actionType: "submit",
            payload: "",
            label: "圖圖：產出 key visual",
            toolName: "studio.generateImage",
            toolArgs: {
              prompt: `${brief}（短片的 key visual：留標題 / 字幕空間、電影感光影）`,
              modelId: models.image,
              aspect_ratio: defaults.aspectRatio,
            },
          },
          {
            id: "step_video",
            path: "/video-studio",
            actionType: "submit",
            payload: "",
            label: "影影：把 key visual 延伸成短片",
            toolName: "studio.generateVideo",
            dependsOn: ["step_image"],
            toolArgs: {
              prompt: `${brief}（${defaults.videoSeconds}s、3 鏡頭切換、情緒節奏起承轉）`,
              modelId: models.video,
              image_url: "${step_image.image_url}",
              duration: defaults.videoSeconds,
              aspect_ratio: defaults.aspectRatio,
            },
          },
          {
            id: "step_voice",
            path: "/pro-studio",
            actionType: "submit",
            payload: "",
            label: "聲聲：旁白配音",
            toolName: "studio.generateVoice",
            toolArgs: {
              prompt: `${brief}（${defaults.videoSeconds}s 短片旁白稿，60-80 字、收尾留記憶點）`,
              modelId: models.voice,
            },
          },
          {
            id: "step_music",
            path: "/pro-studio",
            actionType: "submit",
            payload: "",
            label: "音音：BGM 配樂",
            toolName: "studio.generateAudio",
            toolArgs: {
              prompt: `${brief}（${defaults.videoSeconds}s BGM、開頭鋪墊、中段堆疊、結尾淡出，不搶旁白）`,
              modelId: models.music,
            },
          },
        ],
      };
      handoffs = [
        { stepId: "step_image", spirit: "image-specialist", nickname: getPrimaryNicknameForRole("image-specialist"), reason: "key visual" },
        { stepId: "step_video", spirit: "video-specialist", nickname: getPrimaryNicknameForRole("video-specialist"), reason: "i2v 動畫" },
        { stepId: "step_voice", spirit: "voice-specialist", nickname: getPrimaryNicknameForRole("voice-specialist"), reason: "旁白" },
        { stepId: "step_music", spirit: "music-specialist", nickname: getPrimaryNicknameForRole("music-specialist"), reason: "BGM" },
      ];
      break;
  }

  logger.debug("director_workflow_composed", {
    kind,
    platform,
    budgetMode: budget,
    stepCount: workflow.steps.length,
  });

  return { workflow, handoffs, kind };
}

// ─── Budget estimation ──────────────────────────────────────────────────────

export interface EstimateWorkflowBudgetInput {
  /** 要估算的 workflow steps（從 composeWorkflow 拿，或前端組好的） */
  steps: AgentWorkflowStep[];
  /** 不指定時取每步 toolArgs.duration / num_images / charCount 估算 */
}

export interface StepBudget {
  stepId: string;
  label: string;
  modelId: string | null;
  estimate: PointsEstimate;
  cheaperAlternative?: {
    modelId: string;
    savedPoints: number;
    note: string;
  };
}

export interface WorkflowBudgetReport {
  totalPoints: number;
  totalUsd: string;
  stepBudgets: StepBudget[];
  /** 整條 workflow 的省錢建議：列出所有可替換的步驟 */
  savingsSuggestions: Array<{
    stepId: string;
    fromModel: string;
    toModel: string;
    savedPoints: number;
    note: string;
  }>;
  /** 給導導 / 財財顯示用的人類可讀摘要（一句話） */
  summary: string;
}

// 同類但較便宜的替代模型；只有 catalogue 裡有 pricing 的對才會走進建議。
// 鍵 = "貴的"；值 = 草稿級替代。空陣列代表不建議降級（保留高品質）。
const CHEAPER_ALTERNATIVES: Record<string, { modelId: string; note: string }> = {
  // image
  "fal-ai/flux-pro/v1.1": { modelId: "fal-ai/flux/schnell", note: "草稿先用 schnell 試版、定稿再上 FLUX Pro" },
  "fal-ai/flux-pro/v1.1-ultra": { modelId: "fal-ai/flux/schnell", note: "ultra 適合定稿、草稿改 schnell 省點" },
  "fal-ai/bytedance/seedream/v4/text-to-image": { modelId: "fal-ai/flux/schnell", note: "東方美學試版用 schnell 先看構圖" },
  // video
  "fal-ai/kling-video/v2.1/pro/image-to-video": { modelId: "fal-ai/wan-i2v", note: "Wan 2.1 高 CP 開源、適合預覽運鏡" },
  "fal-ai/kling-video/v2.1/standard/image-to-video": { modelId: "fal-ai/wan-i2v", note: "預覽用 Wan、定剪再切回 Kling Standard" },
  "fal-ai/runway-gen4-turbo/image-to-video": { modelId: "fal-ai/wan-i2v", note: "Runway 較貴、先用 Wan 看分鏡邏輯" },
  // music
  "fal-ai/suno-v4": { modelId: "fal-ai/stable-audio", note: "Suno 有人聲較貴、純 BGM 改 stable-audio" },
  "fal-ai/elevenlabs/music": { modelId: "fal-ai/stable-audio", note: "短 BGM 用 stable-audio 通常更省" },
  // voice
  "elevenlabs/multilingual-v2": { modelId: "fal-ai/kokoro/american-english", note: "草稿配音用 kokoro、定稿再切 ElevenLabs" },
  "elevenlabs/eleven-v3": { modelId: "fal-ai/kokoro/american-english", note: "中文 v3 適合定稿、草稿 kokoro 試節奏" },
};

function pickStepParams(args: Record<string, unknown>): {
  durationSec?: number;
  charCount?: number;
  imageCount?: number;
} {
  const out: { durationSec?: number; charCount?: number; imageCount?: number } = {};
  if (typeof args.duration === "number" && args.duration > 0) {
    out.durationSec = args.duration;
  } else if (typeof args.seconds_total === "number" && args.seconds_total > 0) {
    out.durationSec = args.seconds_total;
  }
  if (typeof args.num_images === "number" && args.num_images > 0) {
    out.imageCount = args.num_images;
  }
  if (typeof args.prompt === "string" && args.prompt.length > 0) {
    out.charCount = args.prompt.length;
  } else if (typeof args.text === "string") {
    out.charCount = args.text.length;
  }
  return out;
}

export function estimateWorkflowBudget(
  input: EstimateWorkflowBudgetInput,
): WorkflowBudgetReport {
  const stepBudgets: StepBudget[] = [];
  const savingsSuggestions: WorkflowBudgetReport["savingsSuggestions"] = [];
  let total = 0;

  for (const step of input.steps) {
    const args = (step.toolArgs ?? {}) as Record<string, unknown>;
    const modelId =
      typeof args.modelId === "string" && args.modelId.trim().length > 0
        ? args.modelId
        : null;

    // 沒有 modelId（純 UI step 或無法估算）— 不算錢。
    if (!modelId) {
      stepBudgets.push({
        stepId: step.id ?? step.label,
        label: step.label,
        modelId: null,
        estimate: {
          modelId: "",
          basePoints: 0,
          multipliers: {},
          totalPoints: 0,
          breakdown: "非生成步驟",
        },
      });
      continue;
    }

    const params = pickStepParams(args);
    const estimate = estimatePoints(modelId, params);
    total += estimate.totalPoints;

    const cheaper = CHEAPER_ALTERNATIVES[modelId];
    let cheaperAlternative: StepBudget["cheaperAlternative"];
    if (cheaper && getModelPricing(cheaper.modelId)) {
      const altEstimate = estimatePoints(cheaper.modelId, params);
      const saved = estimate.totalPoints - altEstimate.totalPoints;
      if (saved > 0) {
        cheaperAlternative = {
          modelId: cheaper.modelId,
          savedPoints: saved,
          note: cheaper.note,
        };
        savingsSuggestions.push({
          stepId: step.id ?? step.label,
          fromModel: modelId,
          toModel: cheaper.modelId,
          savedPoints: saved,
          note: cheaper.note,
        });
      }
    }

    stepBudgets.push({
      stepId: step.id ?? step.label,
      label: step.label,
      modelId,
      estimate,
      cheaperAlternative,
    });
  }

  const totalSavings = savingsSuggestions.reduce((acc, s) => acc + s.savedPoints, 0);
  const summary = totalSavings > 0
    ? `整條約 ${total} pts (${pointsToUsd(total)})；切替代模型可省 ${totalSavings} pts`
    : `整條約 ${total} pts (${pointsToUsd(total)})`;

  logger.debug("director_workflow_budget_estimated", {
    totalPoints: total,
    stepCount: stepBudgets.length,
    savingsSuggestionCount: savingsSuggestions.length,
  });

  return {
    totalPoints: total,
    totalUsd: pointsToUsd(total),
    stepBudgets,
    savingsSuggestions,
    summary,
  };
}

// ─── Resource-Aware Budget Selection (AIDV-660 ADP-3) ──────────────────────

const BUDGET_TIGHT_RATIO = 0.33;    // < 33% remaining → cheap
const BUDGET_MODERATE_RATIO = 0.66; // < 66% remaining → balanced

export interface BudgetModeSelection {
  mode: BudgetMode;
  reason: string;
  autoSelected: boolean;
}

/**
 * Selects a budget mode (cheap / balanced / premium) based on the user's
 * remaining generation quota. User-specified costPreference always wins.
 *
 * Thresholds:
 *   remaining < 33% of daily limit → cheap  (quota pressure: high)
 *   remaining < 66% of daily limit → balanced (quota pressure: moderate)
 *   remaining >= 66%               → premium  (quota pressure: low)
 */
export function selectBudgetModeFromQuota(
  quotaSnapshot: OrbQuotaSnapshot | null | undefined,
  costPreference?: BudgetMode,
): BudgetModeSelection {
  if (costPreference) {
    return {
      mode: costPreference,
      reason: `使用者指定 ${costPreference}，不自動調整`,
      autoSelected: false,
    };
  }

  if (!quotaSnapshot) {
    return {
      mode: "balanced",
      reason: "無配額資訊，預設 balanced",
      autoSelected: true,
    };
  }

  const gen = quotaSnapshot.categories.find(c => c.category === "generation");
  if (!gen || gen.limit === 0) {
    return {
      mode: "balanced",
      reason: "無 generation 配額記錄，預設 balanced",
      autoSelected: true,
    };
  }

  const ratio = gen.remaining / gen.limit;
  const pct = Math.round(ratio * 100);

  if (ratio < BUDGET_TIGHT_RATIO) {
    return {
      mode: "cheap",
      reason: `generation 配額剩餘 ${gen.remaining}/${gen.limit}（${pct}%），預算吃緊 → 自動選 cheap`,
      autoSelected: true,
    };
  }
  if (ratio < BUDGET_MODERATE_RATIO) {
    return {
      mode: "balanced",
      reason: `generation 配額剩餘 ${gen.remaining}/${gen.limit}（${pct}%），預算適中 → 自動選 balanced`,
      autoSelected: true,
    };
  }
  return {
    mode: "premium",
    reason: `generation 配額剩餘 ${gen.remaining}/${gen.limit}（${pct}%），配額充足 → 自動選 premium`,
    autoSelected: true,
  };
}

// ─── Handoff suggestion ─────────────────────────────────────────────────────

export interface SuggestHandoffInput {
  /** 從哪一棒開始算（預設導導本人） */
  fromRole?: AgentRole;
  /** 使用者目前的需求 / 上下文，餵給 hint scorer */
  userIntent?: string;
  /** 額外的 hint token（已標準化過） */
  hintTokens?: readonly string[];
  /** mutedRoles：使用者已關閉的精靈，會被剔除 */
  mutedRoles?: readonly AgentRole[];
  /** busyRoles：目前忙線中的精靈，會被扣分但不剔除 */
  busyRoles?: readonly AgentRole[];
  /** 已在最近幾步用過的精靈，避免 cycle */
  recentRoles?: readonly AgentRole[];
  /** 要走幾步（預設 3 — director → next → critic 風格） */
  maxDepth?: number;
}

export interface HandoffSuggestion {
  /** 推薦的精靈鏈（含起點） */
  chain: AgentRole[];
  /** 暱稱版（@OO 串接好） */
  chainNicknames: string[];
  /** 第一棒（從 fromRole）為什麼選這位 */
  primaryRationale: string | null;
  /** 完整 scored 報告（debug 用） */
  scored: ReturnType<typeof scoreProtocolHandoffs>;
}

export function suggestHandoff(input: SuggestHandoffInput): HandoffSuggestion {
  const fromRole: AgentRole = input.fromRole ?? "director";
  const ctx: HandoffPickContext = {
    whenHint: input.userIntent,
    hintTokens: input.hintTokens,
    mutedRoles: input.mutedRoles,
    busyRoles: input.busyRoles,
    recentRoles: input.recentRoles,
  };
  const chain = walkProtocolHandoffChain(fromRole, {
    ...ctx,
    maxDepth: input.maxDepth ?? 3,
  });
  const scored = scoreProtocolHandoffs(fromRole, ctx);
  const top = pickBestHandoff(fromRole, ctx);
  const chainNicknames = chain.map(role => `@${getPrimaryNicknameForRole(role)}`);

  logger.debug("director_handoff_suggested", {
    fromRole,
    chain,
    hasIntent: Boolean(input.userIntent),
  });

  return {
    chain,
    chainNicknames,
    primaryRationale: top
      ? `下一棒交給 @${getPrimaryNicknameForRole(top.to)}：${top.reason}（觸發條件：${top.when}）`
      : null,
    scored,
  };
}

// ─── Workflow refinement ────────────────────────────────────────────────────
//
// 純資料變換版本：使用者說「把第 2 步換成 Wan」「砍掉 BGM 那步」「全部加上
// step-by-step 確認」這類「機械式」指令，可以直接在這裡解析。LLM-driven
// 的「大改」（重排敘事結構、改變鏡頭數）走 dispatchDirectorTool 內 LLM
// refineWorkflow 路徑。

export interface RefineWorkflowInput {
  workflow: RunWorkflowAction;
  /** 機械式指令清單，沒命中時 caller 應 fallback 到 LLM */
  operations: Array<
    | { op: "remove_step"; stepId: string }
    | { op: "swap_model"; stepId: string; modelId: string }
    | { op: "set_confirmation"; mode: NonNullable<RunWorkflowAction["confirmationMode"]> }
    | { op: "set_step_param"; stepId: string; key: string; value: unknown }
  >;
}

export interface RefineWorkflowResult {
  workflow: RunWorkflowAction;
  /** 每條 op 是否套用成功；caller 可把未套用的轉交 LLM */
  applied: Array<{ op: string; ok: boolean; reason?: string }>;
}

export function refineWorkflowMechanically(
  input: RefineWorkflowInput,
): RefineWorkflowResult {
  // shallow clone（steps 是陣列，內部物件用 spread 保留不被原物件牽連）
  const next: RunWorkflowAction = {
    ...input.workflow,
    steps: input.workflow.steps.map(s => ({
      ...s,
      toolArgs: s.toolArgs ? { ...s.toolArgs } : undefined,
    })),
  };
  const applied: RefineWorkflowResult["applied"] = [];

  for (const op of input.operations) {
    switch (op.op) {
      case "remove_step": {
        const idx = next.steps.findIndex(s => s.id === op.stepId);
        if (idx < 0) {
          applied.push({ op: op.op, ok: false, reason: `step not found: ${op.stepId}` });
          break;
        }
        next.steps.splice(idx, 1);
        // 同時清掉其它步驟對它的 dependsOn 引用，避免拓撲死結
        for (const s of next.steps) {
          if (s.dependsOn) {
            s.dependsOn = s.dependsOn.filter(id => id !== op.stepId);
            if (s.dependsOn.length === 0) delete s.dependsOn;
          }
        }
        applied.push({ op: op.op, ok: true });
        break;
      }
      case "swap_model": {
        const step = next.steps.find(s => s.id === op.stepId);
        if (!step) {
          applied.push({ op: op.op, ok: false, reason: `step not found: ${op.stepId}` });
          break;
        }
        step.toolArgs = { ...(step.toolArgs ?? {}), modelId: op.modelId };
        applied.push({ op: op.op, ok: true });
        break;
      }
      case "set_confirmation": {
        next.confirmationMode = op.mode;
        applied.push({ op: op.op, ok: true });
        break;
      }
      case "set_step_param": {
        const step = next.steps.find(s => s.id === op.stepId);
        if (!step) {
          applied.push({ op: op.op, ok: false, reason: `step not found: ${op.stepId}` });
          break;
        }
        step.toolArgs = { ...(step.toolArgs ?? {}), [op.key]: op.value };
        applied.push({ op: op.op, ok: true });
        break;
      }
    }
  }

  logger.debug("director_workflow_refined", {
    opCount: input.operations.length,
    okCount: applied.filter(a => a.ok).length,
  });

  return { workflow: next, applied };
}

// ─── Static summary of director's own collab protocol（給 UI 顯示用） ─────

export function getDirectorHandoffCatalog(): Array<{
  to: AgentRole;
  nickname: string;
  reason: string;
  when: string;
}> {
  const spec = SPIRIT_COLLAB_PROTOCOL.director;
  return spec.handoffs.map(h => ({
    to: h.to,
    nickname: getPrimaryNicknameForRole(h.to),
    reason: h.reason,
    when: h.when,
  }));
}
