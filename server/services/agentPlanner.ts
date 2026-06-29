import {
  invokeLLM,
  extractMessageText,
  type Message,
  type InvokeResult,
} from "../_core/llm";
import { logger } from "../_core/logger";
import { AGENT_PLAN_V3_JSON_SCHEMA } from "../../shared/agent-plan-schema";
import { summarizeGlobalCapabilityRegistry } from "../../shared/global-agent-capabilities";
import { summarizeTextToImageModelRegistry } from "../../shared/textToImageModelRegistry";
import { summarizeGlobalToolRegistry } from "../../shared/global-agent-tools";
import { IMAGE_TO_IMAGE_MODEL_REGISTRY } from "../../shared/imageToImageModelRegistry";
import { SKELETAL_MODEL_REGISTRY } from "../../shared/skeletalModelRegistry";
import { IMAGE_UPSCALE_MODEL_REGISTRY } from "../../shared/imageUpscaleModelRegistry";
import { summarizeStudioModelKnowledgeForAgent } from "../../shared/studioModelIntelligence";
import { summarizeModelPromptTemplates } from "../../shared/modelPromptTemplates";
import {
  adaptAgentPlanV3ToActions,
  buildAgentPlanV3SystemPrompt,
  parseAndGatePlan,
  type GatedAgentPlanResult,
} from "../../shared/agent-plan-adapter";
import type {
  AgentAction,
  AgentFeedbackEvent,
  PageAgentSnapshot,
  RunWorkflowAction,
} from "../../shared/agent-actions";
import type { AgentPlanV3 } from "../../shared/agent-plan-schema";
import type { AgentPreferences } from "../../shared/agent-preferences";
import {
  buildCritiquePromptForLLM,
  critiquePlan,
  type PlanCritiqueResult,
} from "../../shared/orb-plan-critic";
import {
  summarizeOrbQuotaForPlanner,
  type OrbQuotaSnapshot,
} from "./orbQuota";
import { TEXT_TO_IMAGE_MODEL_REGISTRY } from "../../shared/textToImageModelRegistry";
import { checkModalityCoherence } from "../../shared/orb-modality-coherence";
import { moderateOrbContent } from "../../shared/orb-content-moderation";

export type PlannerMultimodalKind = "image" | "audio" | "video" | "pdf" | "file";

export interface PlannerMultimodalPartSummary {
  kind: PlannerMultimodalKind;
  mimeType?: string;
  url?: string;
}

export interface AgentPlannerInput {
  messages: Message[];
  context?: string;
  personality?: string;
  pageSnapshot?: PageAgentSnapshot | null;
  recentFeedback?: AgentFeedbackEvent[];
  recentTaskMemorySummary?: string;
  recentOrbMemorySummary?: string;
  siteKnowledgeSummary?: string;
  preferences?: Pick<
    AgentPreferences,
    "confirmationPolicy" | "maxAutoStepsPerTask" | "autoApproveTools" | "blockedTools" | "allowedRiskLevels"
  > | null;
  /**
   * Remaining site-wide quota for today, keyed by category (planner /
   * generation / multimodal_analysis / code_task). When supplied the
   * planner is instructed to budget its plan against the remaining slots
   * and propose staged execution if the request would exceed the day's
   * cap. See `getOrbQuotaSnapshot()` in `services/orbQuota.ts`.
   */
  quotaSnapshot?: OrbQuotaSnapshot | null;
  maxTokens?: number;
  invoke?: typeof invokeLLM;
  /**
   * When true, after the initial plan is parsed and gated, run
   * `critiquePlan` against the converted RunWorkflowAction. If
   * `shouldRefine` is set (blockers OR score < refineBelow), build a
   * refine prompt with the issue list and re-invoke the planner ONCE.
   * Capped to 1 refine attempt to prevent infinite loops; defaults to
   * false so existing call sites are unaffected. Use this on the
   * agent-task path where the cost of a second LLM call is justified
   * by avoiding a wasted UI dispatch + workflow run.
   */
  enableCritique?: boolean;
  /**
   * Refine threshold (0..100). Plans with score >= this skip the refine
   * pass even when `enableCritique` is true. Defaults to 75 — same as
   * `critiquePlan`'s internal default.
   */
  critiqueRefineBelow?: number;
  /**
   * Maximum number of critique→refine round-trips when `enableCritique`
   * is true. Each round re-invokes the planner with a directed critique
   * prompt built from the BEST plan seen so far. The loop stops early
   * when the critic is satisfied (no blockers and score >= refineBelow)
   * OR a refined plan fails to beat the best score so far (no-improvement
   * guard) OR the refined plan no longer yields a workflow.
   *
   * Defaults to 1 — identical to the previous single-pass behaviour, so
   * existing call sites are unaffected unless they opt into more rounds.
   * Clamped to [1, 3] to bound LLM cost on a direct-to-production path.
   */
  maxRefineRounds?: number;
}

function summarizePreferencesForPlanner(
  preferences?: AgentPlannerInput["preferences"]
): string {
  if (!preferences) return "No user agent preferences (defaults apply).";
  return safeStringify({
    confirmationPolicy: preferences.confirmationPolicy,
    maxAutoStepsPerTask: preferences.maxAutoStepsPerTask,
    autoApproveTools: preferences.autoApproveTools?.slice(0, 24),
    blockedTools: preferences.blockedTools?.slice(0, 24),
    allowedRiskLevels: preferences.allowedRiskLevels,
    plannerHint:
      preferences.confirmationPolicy === "manual"
        ? "User selected pure-chat / manual mode. Do NOT include action steps; explain or ask instead."
        : preferences.confirmationPolicy === "confirm_all"
        ? "User wants every action confirmed. Default shouldAskClarification=true unless the request is unambiguous."
        : preferences.confirmationPolicy === "always_approve"
        ? "User pre-approves low-risk actions. Still ask for clarification when target is ambiguous."
        : "User confirms only high-risk actions; safe navigation may proceed automatically.",
  }, 1_500);
}

export interface AgentPlannerResult extends GatedAgentPlanResult {
  rawContent?: string;
  plannerUsed: boolean;
  usedMultimodalPlanner?: boolean;
  /** Set when `enableCritique` was true; null when critique was skipped. */
  critique?: PlanCritiqueResult | null;
  /** Set when the refine pass actually ran (the LLM was called twice). */
  critiqueRefined?: boolean;
  /**
   * Number of refine round-trips that actually ran (0 when critique was
   * skipped or the draft was already healthy). Bounded by
   * `maxRefineRounds`. Purely informational — callers/telemetry can read
   * it to see how hard the loop worked.
   */
  critiqueRounds?: number;
}

function safeStringify(value: unknown, maxLength = 3_000): string {
  try {
    return JSON.stringify(value, null, 2).slice(0, maxLength);
  } catch {
    return String(value).slice(0, maxLength);
  }
}

function mimeToPlannerKind(mimeType?: string): PlannerMultimodalKind {
  const lower = String(mimeType ?? "").toLowerCase();
  if (lower.startsWith("image/")) return "image";
  if (lower.startsWith("audio/")) return "audio";
  if (lower.startsWith("video/")) return "video";
  if (lower.includes("pdf")) return "pdf";
  return "file";
}

// Reject attachment URLs that aren't safe to embed in the planner prompt:
// data: / javascript: / file: schemes, raw bytes, control characters,
// extremely long blobs, or anything that's not http(s). Without this,
// a corrupt upload (or a malicious one) can blow up the planner's token
// budget or smuggle prompt-injection text into the system message.
const SAFE_URL_RE = /^https?:\/\/[^\s]+$/;
const MAX_URL_LENGTH = 2_048;
const MAX_MIME_LENGTH = 120;
function sanitizeAttachmentUrl(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  if (!url.length || url.length > MAX_URL_LENGTH) return undefined;
  if (!SAFE_URL_RE.test(url)) return undefined;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(url)) return undefined;
  return url;
}
function sanitizeMimeType(mimeType: unknown): string | undefined {
  if (typeof mimeType !== "string") return undefined;
  if (!mimeType.length || mimeType.length > MAX_MIME_LENGTH) return undefined;
  if (!/^[a-zA-Z0-9!#$&^_+\-.]+\/[a-zA-Z0-9!#$&^_+\-.]+$/.test(mimeType)) return undefined;
  return mimeType.toLowerCase();
}

function summarizeMessagePart(part: unknown): PlannerMultimodalPartSummary | null {
  if (!part || typeof part !== "object") return null;
  const record = part as Record<string, unknown>;

  if (record.type === "image_url") {
    const image = record.image_url as Record<string, unknown> | undefined;
    const url = sanitizeAttachmentUrl(image?.url);
    if (!url) return null;
    return {
      kind: "image",
      url,
    };
  }

  if (record.type === "file_url") {
    const file = record.file_url as Record<string, unknown> | undefined;
    const url = sanitizeAttachmentUrl(file?.url);
    if (!url) return null;
    const mimeType = sanitizeMimeType(file?.mime_type);
    return {
      kind: mimeToPlannerKind(mimeType),
      mimeType,
      url,
    };
  }

  return null;
}

export function collectMultimodalParts(messages: Message[]): PlannerMultimodalPartSummary[] {
  const parts: PlannerMultimodalPartSummary[] = [];

  for (const message of messages) {
    const content = Array.isArray(message.content) ? message.content : [message.content];
    for (const part of content) {
      const summary = summarizeMessagePart(part);
      if (summary) parts.push(summary);
    }
  }

  return parts;
}

export function hasMultimodalPlannerInput(messages: Message[]): boolean {
  return collectMultimodalParts(messages).length > 0;
}

export function summarizeMultimodalInputsForPlanner(messages: Message[]): string {
  const parts = collectMultimodalParts(messages);
  if (!parts.length) return "No multimodal attachments.";

  return safeStringify({
    count: parts.length,
    kinds: Array.from(new Set(parts.map(part => part.kind))),
    attachments: parts.map((part, index) => ({
      index,
      kind: part.kind,
      mimeType: part.mimeType,
      url: part.url,
    })),
    plannerInstruction:
      "Use these attachments as source material. If the format cannot be directly interpreted, ask for conversion to PDF/PNG/MP3/MP4 or pasted text.",
  }, 2_500);
}

export function summarizePageSnapshotForPlanner(snapshot?: PageAgentSnapshot | null): string {
  if (!snapshot) return "No active page snapshot.";
  return safeStringify({
    pageId: snapshot.pageId,
    pageLabel: snapshot.pageLabel,
    pagePath: snapshot.pagePath,
    activeMode: snapshot.activeMode,
    activeModel: snapshot.activeModel,
    selectedPreset: snapshot.selectedPreset,
    availableModels: snapshot.availableModels?.slice(0, 20),
    availableModes: snapshot.availableModes?.slice(0, 20),
    availableParameters: snapshot.availableParameters?.slice(0, 40),
    currentPrompt: snapshot.currentPrompt?.slice(0, 500),
    hasUnsavedChanges: snapshot.hasUnsavedChanges,
    warnings: snapshot.warnings?.slice(0, 8),
    capabilities: snapshot.capabilities.map(capability => ({
      action: capability.action,
      label: capability.label,
      hint: capability.hint,
      currentId: capability.currentId,
      options: capability.options?.slice(0, 12).map(option => ({
        id: option.id,
        label: option.label,
        description: option.description,
      })),
    })),
    state: snapshot.state,
  });
}

export function summarizeRecentFeedbackForPlanner(feedback?: AgentFeedbackEvent[]): string {
  if (!feedback?.length) return "No recent feedback.";
  return safeStringify(feedback.slice(-12).map(event => ({
    status: event.status,
    actionType: event.actionType,
    pageId: event.pageId,
    note: event.note,
  })), 2_000);
}

export function summarizeTextToImageModelRegistryForPlanner(): string {
  return safeStringify({
    note: "全站光球代理共用模型資料庫（文字生圖）",
    models: TEXT_TO_IMAGE_MODEL_REGISTRY.map(model => ({
      modelId: model.modelId,
      label: model.label,
      provider: model.provider,
      strengths: model.strengths,
      avoidWhen: model.avoidWhen,
      promptKeywords: model.promptKeywords,
    })),
    plannerInstruction:
      "若使用者提出 Stable Diffusion / SD / LoRA / 負面提示詞等意圖，優先從這份資料庫挑選最接近的 modelId，避免幻想不存在的模型名稱。",
  }, 3_000);
}

export function summarizeImageToImageModelRegistryForPlanner(): string {
  return safeStringify({
    note: "全站光球代理共用模型資料庫（圖生圖 / 進階控制）",
    models: IMAGE_TO_IMAGE_MODEL_REGISTRY.map(model => ({
      modelId: model.modelId,
      label: model.label,
      category: model.category,
      strengths: model.strengths,
      avoidWhen: model.avoidWhen,
      promptKeywords: model.promptKeywords,
    })),
    plannerInstruction:
      "若使用者提出 ControlNet / 姿勢控制 / 深度感知 / 圖片編輯 / 風格遷移 / 去背等意圖，優先從這份資料庫挑選對應的進階控制模型，依任務類型選擇：control (ControlNet/pose) → style-transfer (i2i) → edit (RemBG)。",
  }, 3_000);
}

export function summarizeSkeletalModelRegistryForPlanner(): string {
  return safeStringify({
    note: "全站光球代理共用模型資料庫（骨骼 / 3D 模型）",
    models: SKELETAL_MODEL_REGISTRY.map(model => ({
      modelId: model.modelId,
      label: model.label,
      category: model.category,
      strengths: model.strengths,
      avoidWhen: model.avoidWhen,
      promptKeywords: model.promptKeywords,
    })),
    plannerInstruction:
      "若使用者提出 3D 建模 / 角色雕塑 / 場景生成 / 物件重建等意圖，優先從這份資料庫挑選對應的 3D 模型。image-to-3d 用於圖片轉 3D，image-to-world 用於場景 / 環境生成。",
  }, 2_000);
}

export function summarizeImageUpscaleModelRegistryForPlanner(): string {
  return safeStringify({
    note: "全站光球代理共用模型資料庫（影像放大）",
    models: IMAGE_UPSCALE_MODEL_REGISTRY.map(model => ({
      modelId: model.modelId,
      label: model.label,
      strengths: model.strengths,
      avoidWhen: model.avoidWhen,
      promptKeywords: model.promptKeywords,
    })),
    plannerInstruction:
      "若使用者提出影像放大 / 超解析度 / 畫質提升 / 4K/8K 等意圖，優先從這份資料庫挑選對應的放大模型。SeedVR 適合高品質真實照片，AuraSR 適合快速批次處理。",
  }, 2_000);
}

export function buildAgentPlannerMessages(input: AgentPlannerInput): Message[] {
  const pageSummary = summarizePageSnapshotForPlanner(input.pageSnapshot);
  const feedbackSummary = summarizeRecentFeedbackForPlanner(input.recentFeedback);
  const multimodalSummary = summarizeMultimodalInputsForPlanner(input.messages);
  const systemPrompt = buildAgentPlanV3SystemPrompt(pageSummary);
  const capabilitySummary = summarizeGlobalCapabilityRegistry(120);
  const toolSummary = summarizeGlobalToolRegistry(60);
  const textToImageModelSummary = summarizeTextToImageModelRegistryForPlanner();
  const imageToImageModelSummary = summarizeImageToImageModelRegistryForPlanner();
  const skeletalModelSummary = summarizeSkeletalModelRegistryForPlanner();
  const imageUpscaleModelSummary = summarizeImageUpscaleModelRegistryForPlanner();
  const studioModelKnowledgeSummary = summarizeStudioModelKnowledgeForAgent();
  const modelPromptTemplateSummary = summarizeModelPromptTemplates();
  const preferencesSummary = summarizePreferencesForPlanner(input.preferences);
  const quotaSummary = input.quotaSnapshot
    ? summarizeOrbQuotaForPlanner(input.quotaSnapshot)
    : null;
  // ── Mode-specific directive ─────────────────────────────────────
  // The chat layer threads the user's selected composer mode (多步驟代理 /
  // 計畫 / 跳頁 / 功能詢問) into `input.context` as "使用者選擇模式: <id>".
  // Surface that as a top-level directive so the LLM treats it as a hard
  // contract rather than a soft hint. When the user explicitly clicked
  // 多步驟代理 we MUST commit to either clarification (gather more info)
  // or tasked (run real tools) — never a chatty plan-as-text reply.
  const requestedModeMatch = input.context
    ? input.context.match(/使用者選擇模式[:：]\s*([a-z_-]+)/i)
    : null;
  const requestedMode = requestedModeMatch?.[1]?.toLowerCase() ?? null;
  // Escape hatch — 使用者明確說「急 / 直接做 / 別問了」時，多步驟模式不再
  // 強制 MIN 3 輪澄清。逐字偵測：避免誤判「我慢慢來」之類反向訊號。
  // 偵測來源：最後一輪使用者文字 + 已有的 [使用者澄清/...] / [總總澄清/...]
  // 答案（如果使用者上一輪已選「急件」維度的選項，這裡也算）。
  const latestUserText = extractLatestUserTextFromMessages(input.messages);
  const urgencySource = `${latestUserText}\n${input.context ?? ""}`;
  const URGENT_MARKERS = /別問了|不要再問|直接做|直接執行|直接跑|我趕時間|趕件|急件|很急|今天就要|現在就要|just do it|skip clarification|stop asking|run it now|go ahead/i;
  const isUrgentSkip = URGENT_MARKERS.test(urgencySource);
  const modeDirective = (() => {
    switch (requestedMode) {
      case "multi-step":
        return [
          "User-selected composer mode (極為重要 / very important): 多步驟代理 (multi-step agent).",
          "The user explicitly opted into autonomous multi-step execution. You MUST commit to one of:",
          "  • decision.mode='clarification' with clarificationQuestion + 2-4 clarificationOptions — used when ANY wizard dimension (format / length / style / platform / audience / subject) is still unknown. The first turn for an ambiguous request defaults here.",
          "  • decision.mode='tasked' with concrete toolName + toolArgs steps — used ONLY when every required wizard dimension is already pinned down (look in `[使用者澄清/...]:` AND `[總總澄清/...]:` lines + recalled memory — BOTH namespaces count as confirmed answers; treat `[總總澄清/goal]:` as confirming the wizard's `format` dimension).",
          "FORBIDDEN in this mode:",
          "  • decision.mode='direct' (multi-step needs the WorkflowConfirmationCard, not a single dispatch).",
          "  • Reply text containing numbered '步驟 1 / 步驟 2 / Step 1 / Step 2' lists — that's the phantom-plan anti-pattern.",
          "  • Asking the user '從哪個步驟開始？' or 'which step do you want to start with?' (commit to clarification or tasked instead).",
          "  • Empty / chatty replies that don't move the wizard forward.",
          isUrgentSkip
            ? "URGENT ESCAPE HATCH ACTIVE — user explicitly asked to skip clarification (急件 / 直接做 / skip-asking marker detected). Skip the MIN 3 rounds rule: if you have even ONE confirmed dimension (主題 OR 格式) AND a sensible default for the rest based on registry priors (e.g. 15 秒、IG 直式、品牌調性 vivid), commit to decision.mode='tasked' THIS turn. In summaryForUser, state explicitly which defaults you picked so the user can override after the fact."
            : null,
        ].filter(Boolean).join("\n");
      case "plan":
        return [
          "User-selected composer mode (重要): 計畫 (planning).",
          "The user wants a runnable plan with explicit steps. You MUST return decision.mode='tasked' (with toolName/toolArgs) OR decision.mode='clarification' if a key parameter is missing. Do NOT return a chatty reply that only describes a plan in prose; let summaryForUser carry the human-friendly summary while plan.steps carry the structure.",
        ].join("\n");
      case "navigate":
        return [
          "User-selected composer mode: 跳頁 (navigate).",
          "The user wants to be taken to a feature page. Return decision.mode='direct' with a single navigate step. If the destination is ambiguous, ask one short clarification with topic-aware options instead.",
          "HARD CONSTRAINT (絕對不可違反): every navigate step's `path` MUST exactly match a path listed in the 'Global capability registry summary' above. Do NOT invent plausible-sounding routes (例如 /voice-studio-pro、/podcast、/做配音) — the SPA has no such routes and the user will land on a blank screen. If the user's intent does not unambiguously point to one registered page, return decision.mode='clarification' with clarificationQuestion 「想去哪個工具頁？」 + 2-4 clarificationOptions drawn from the registered page labels that match the user's modality (例如「VoiceStudio · 配音工作室」「Director · 旁白生成」). Always prefer asking once over jumping to a guessed path.",
        ].join("\n");
      case "ask-feature":
        return [
          "User-selected composer mode: 功能詢問 (feature Q&A).",
          "The user is asking what the site can do. Return a conversational reply describing the relevant features — do NOT emit any execution steps. Use decision.mode='direct' with steps=[] when supported, otherwise decision.mode='clarification'.",
        ].join("\n");
      default:
        return null;
    }
  })();

  const contextBlock = [
    modeDirective ? `User mode directive:\n${modeDirective}` : undefined,
    input.context ? `Conversation context: ${input.context}` : undefined,
    input.personality ? `Orb personality: ${input.personality}` : undefined,
    `Recent execution feedback:\n${feedbackSummary}`,
    `Recent task memory:\n${input.recentTaskMemorySummary ?? "No recent task memory."}`,
    `Recent long-term memory (含 failed_workflow / prompt_pattern / tool_feedback 教訓):\n${input.recentOrbMemorySummary ?? "No long-term memory."}`,
    "若 memory 中存在 lessonHint 或 failed_workflow，請避免重現同樣的步驟組合與模型選擇；改採替代工具或拆解路徑，並在 reply 中向使用者說明繞道原因。",
    input.siteKnowledgeSummary ? `Site knowledge summary:\n${input.siteKnowledgeSummary}` : undefined,
    `Global capability registry summary:\n${capabilitySummary}`,
    `Global tool registry summary:\n${toolSummary}`,
    `Text-to-image model registry summary:\n${textToImageModelSummary}`,
    `Image-to-image (advanced control) model registry summary:\n${imageToImageModelSummary}`,
    `Skeletal / 3D model registry summary:\n${skeletalModelSummary}`,
    `Image upscale model registry summary:\n${imageUpscaleModelSummary}`,
    `Per-model prompt template policy（執行器會自動套用，請在挑模型時把模板特性納入考量；不要把這裡的 prefix/suffix 重複塞進 toolArgs.prompt）:\n${modelPromptTemplateSummary}`,
    `Multimodal attachments:\n${multimodalSummary}`,
    `User agent preferences:\n${preferencesSummary}`,
    quotaSummary
      ? `${quotaSummary}\n\n配額分階段規則（極為重要 / very important）：\n- 計算 plan 中真正會消耗 generation 額度的步驟數（每個 studio.generateImage / studio.generate3D / studio.generateVideo / studio.generateAudio / studio.generateVoice / studio.enhanceVideo / studio.trainLora 算 1 個 generation 額度；planner 額度由本次規劃自動扣除，無需自行加總；multimodal_analysis 用於分析上傳的圖／影／音／PDF；code_task 用於 code/github/deploy 真正改檔工作）。\n- 若所需 generation 步驟數 ≤ 剩餘 generation 額度，可一次規劃完整 plan。\n- 若所需 generation 步驟數 > 剩餘 generation 額度，必須分階段：把 plan 切成 ≤ 剩餘額度的「第一階段」與後續「第 N 階段」；只提交第一階段為 tasked plan，並在 summaryForUser 與 reply 中明確告知使用者「今日只能執行 X 步，剩下 Y 步明日再續」並把後續 step 列入 followUpStages 文字描述（不要放進當次 steps）。\n- 若 generation 額度 = 0：直接回覆 clarification（或 blocked），告知使用者今日 generation 額度已滿，並建議改成預覽／分鏡／文字腳本等不耗 generation 的步驟；不要送出空 tasked plan。\n- 若 multimodal_analysis = 0 且使用者上傳了圖／影／音／PDF：說明今日無法分析附件，請使用者明日再試或先以文字描述需求。\n- 若 code_task = 0 且使用者請求改檔／GitHub／部署：直接回覆額度已滿，不要建立 code task。\n- 千萬不要為了規劃而規劃 — 只有實際會被執行的步驟才能算進當次 plan，宣告 followUpStages 時要清楚標註「Stage 2 (明日)」之類的文字。`
      : undefined,
    "Plan in Traditional Chinese labels where helpful, but keep action ids and page paths exact.",
    "When the user's target output, modality, destination page, chosen model, constraints, or success criteria are unclear, you MUST return shouldAskClarification=true with a single clarificationQuestion (Traditional Chinese, ≤80 字) and 2-4 short clarificationOptions covering the likely choices. Do NOT include any steps in clarification mode.",
    `Anti-pattern (絕對禁止 / strictly forbidden) — "phantom plan + which step?":
Do NOT respond with a numbered list of steps in the chat reply text and then ask the user "你想從哪個步驟開始？/ which step do you want to start with?". That is exactly the moment where the orb should commit to decision.mode='clarification' with structured clarificationQuestion + clarificationOptions — describing the steps in chat and asking "which one" leaves the user with a wall of text and no way to act.

Detection signal — if you ever feel tempted to write **步驟 1 / 步驟 2 / Step 1 / Step 2** in the chat reply:
- If you do not yet know the user's chosen format / length / style / audience / platform → return decision.mode='clarification', and let clarificationQuestion ask ONE concrete dimension (e.g., "想做幾秒的影片？") with clarificationOptions that echo the user's own topic (e.g., "茶道體驗短片（30 秒）" instead of generic "30 秒").
- If the user has already given enough info → produce a real decision.mode='tasked' plan with concrete toolName/toolArgs steps, and let summaryForUser describe the plan succinctly. DO NOT also ask "從哪一步開始" — once you commit to tasked the orchestrator runs the steps in order.
- DO NOT print numbered steps in the chat reply when decision.mode='direct' or 'clarification'. The 'reply' field in those modes is conversational (≤160 字) — short acknowledgement + the question. Save the step list for the structured plan.

Truly understand the user before planning (真實理解使用者，不要為了規劃而規劃):
- Re-read the user's latest message AND the recalled long-term memory before each turn. If the user named a specific subject (a person / topic / mood / location / brand), echo that subject back inside clarificationOptions so they feel heard.
- If the user's request is purely exploratory ("幫我想一下", "有什麼建議"), open the wizard at the 'format' dimension first — never jump to length/style before format is locked.
- When the user has uploaded an attachment, infer modality from the attachment first (image upload → image edit / image-to-video; audio upload → transcription / dubbing) and ask about the goal, not the format.
- Generic clarificationOptions that could apply to any user ("我先看流程再決定", "請再說明一下", "你決定就好") are FORBIDDEN — every option must reference the user's own topic or one of the registered concrete formats / lengths / styles for their modality.`,
    `Multi-step wizard rule (極為重要 / very important):
Before producing a 'tasked' plan (multi-step / cross-page execution), you MUST gather the key parameters with a step-by-step quick-select wizard. Even if you can guess, ASK FIRST.

How the wizard works:
- Ask ONE clarifying question at a time (decision.mode='clarification' + clarificationQuestion + 2-4 clarificationOptions). Never ask multiple questions in a single message.
- Re-read the conversation each turn — earlier '[使用者澄清/...]:' AND '[總總澄清/...]:' lines BOTH count as already-confirmed parameters; do NOT ask the same dimension twice. Map 總總's dimensions onto wizard dimensions when checking: goal→format, scope→(plan size), complexity→(handoff needs). If 總總's goal answer already named a modality + length (e.g. 「一支短影片（15-60 秒）」), treat BOTH format AND a rough duration band as confirmed.
- Continue clarification rounds until ALL the following MANDATORY dimensions for the user's modality are pinned down before switching to decision.mode='tasked'. For cross-page agent workflows you MUST run a minimum of 3 clarification rounds (主題 + 時長 + 風格 + 平台) before committing — even if you think you can guess, ASK. EXCEPTION — if the URGENT ESCAPE HATCH was activated above (user said 急/直接做/skip), drop the MIN 3 rule and ship a tasked plan as soon as ONE dimension is confirmed, picking registry-default values for the rest and disclosing them in summaryForUser. The orb's job is to feel like a human director who actually understands the brief, not a one-shot dispatcher.
  • Video (影片) — REQUIRED: 主題/主角、時長、風格/調性、平台/比例。MIN 3 rounds. RECOMMENDED extra: 素材來源 (手邊素材 vs AI 生成)、受眾、情緒節奏、配樂風格。
  • Image (圖片) — REQUIRED: 主體/構圖、風格/氛圍、比例/尺寸。RECOMMENDED extra: 用途／投放、模型偏好、色調。
  • Voice / 配音 — REQUIRED: 文本內容或主題、語氣/角色、語言、時長/字數。RECOMMENDED extra: 場景情境、引擎/聲線。
  • Music / 音樂 — REQUIRED: 用途 (BGM / 廣告 / 短影音)、時長、情緒/曲風、是否需要人聲。RECOMMENDED extra: BPM 區間、主要樂器、結構（前奏／主題／尾奏）。
  • Script / 腳本 — REQUIRED: 平台/受眾、主題與目標、長度、風格 (搞笑 / 嚴肅 / 教學 …)。RECOMMENDED extra: 鏡頭 / 章節結構、CTA。
  • LoRA / Training — REQUIRED: 訓練主體、素材數量、目標風格、輸出用途。RECOMMENDED extra: trigger word、預期 epoch/learning rate。
- Wizard ordering (照這個順序問，不要亂跳)：主題/主角 → 時長/長度 → 風格/調性 → 平台/受眾 → (optional) 素材來源 → (optional) 情緒節奏 → (optional) 配樂風格。
- Each clarificationQuestion MUST include a one-line rationale explaining WHY this dimension matters for the output (e.g. "想做多長的影片？時長直接決定運鏡密度──15 秒一個鏡頭一種情緒、30 秒可拼三幕節奏、60 秒以上才裝得下完整故事弧。"). Bare questions without rationale ("想做多長？") feel like bureaucratic forms — we want the user to feel the orb is reasoning with them.
- Each clarificationOptions list should reflect THIS user's prompt (use their own wording / topic when sensible) — never generic fillers, never options unrelated to their topic, and NEVER use the literal placeholder string "你的主題" inside an option label (that means topic extraction failed — drop the topic prefix entirely instead).
- Switch to decision.mode='direct' only for single-page low-risk fillPrompt-style requests where every parameter is already explicit.
- Switch to decision.mode='tasked' only after the wizard has all required dimensions confirmed; the steps you produce must reflect each confirmed answer.

Tasked-plan auto-fill rule (極為重要 / very important):
When you commit to decision.mode='tasked' (or convert a workflow into RunWorkflowAction steps), every fillPrompt / toolArgs.prompt / payload value MUST be a concrete, ready-to-submit prompt — NEVER leave the literal strings "[使用者澄清]" / "你的主題" / "<待填入>" / "TBD" inside the prompt slot. The orb is supposed to FILL the prompt for the user, not show the user a half-empty form on the destination page. Concrete steps:
- For each step that fills a prompt, weave together: the user's original goal + every confirmed clarification answer + the step's specific creative direction (e.g. "拍特寫鏡頭 + 電影感打光 + 30 秒節奏").
- Reference the page snapshot's currentPrompt field — if the user already had text in the editor, MERGE the new prompt with that text instead of overwriting.
- For multi-step pipelines, each downstream step's prompt should reflect what the previous step produced (image prompt → video prompt of that image → voiceover script that matches the video).
- If after all clarifications the user did NOT name a concrete subject, do NOT ship a tasked plan — return ONE more clarification round asking the subject directly. A workflow that runs with placeholder prompts is worse than one that asks again.

Pause-for-user-action rule (重要):
If a step in the tasked plan genuinely needs the user to upload a file, pick a face image, sign in to a third-party service, or otherwise do something the orb can't do for them, mark that step's requiresApproval=true and put a one-line expectedOutput string describing exactly what the user needs to do (e.g. "請從圖庫挑一張主角人物照"). The executor will pause on that step, the user will do the manual setup, and execution will continue from the next step on resume — DO NOT cancel the whole plan when one step needs human input.

Autonomous-execution rule (極為重要 / very important):
After the wizard collects all parameters, the orb MUST actually run the generation for the user — not merely navigate to a page or describe what to do. The user said: "需要真實執行多步驟執行代理，不能只是跳頁或聊天跟使用者自己用".

How to produce a real executable tasked plan:
- Map the confirmed parameters onto a registered server-side studio.* tool from the 'Global tool registry summary' and emit a step with BOTH:
    • toolName: '<registered tool name>' (e.g., 'studio.generateVideo', 'studio.generateImage', 'studio.generate3D', 'studio.generateAudio', 'studio.generateVoice', 'studio.enhanceVideo', 'studio.trainLora')
    • toolArgs: { ...the actual prompt/modelId/duration/aspect_ratio/etc derived from the wizard answers }
  The orchestrator will dispatch the tool to fal.ai / Suno / ElevenLabs server-side and stream the request_id back — that's the real generation, not a UI hint.
- For LoRA / 風格 / 角色 / 場景 / 影片 LoRA / 肖像 / 配音 clone training, emit a 'studio.trainLora' step with toolArgs:
    { modelType: 'image_subject'|'portrait_lora'|'style_lora'|'scene_lora'|'video_lora'|'voice_clone'|'concept_lora'|'product_lora'|'fashion_lora'|'pose_lora',
      name: '<user-friendly model name>',
      triggerWord: '<short token to invoke this LoRA in future prompts>',
      trainingEngine: 'fal' (default) | 'replicate',
      datasetImages: [{ url, fileKey? }, ...],   // user-uploaded refs
      datasetVideos: [{ url, fileKey? }, ...],   // for video_lora
      epochs?: number, learningRate?: number, isStyle?: boolean }
  Training takes 5–30 minutes — the tool returns immediately with { modelId, jobId, status: 'queued', monitorUrl }. The orb's reply must surface monitorUrl so the user can watch progress; do NOT await results in the same plan, and do NOT chain a downstream studio.generateImage step that depends on the trained model in the SAME tasked plan (it won't be ready). After kicking off training, hand the user the monitorUrl and offer to check back later.
- Pair each tool-call step with the matching UI action so the user sees it happen on the right studio page (e.g., navigate to /video-studio, fillPrompt with the same prompt, then submit). Both run together: uiActions for visibility, toolCalls for autonomous execution.
- For multi-step pipelines (subtitle → dubbing → render, or storyboard → image → video), chain the steps so each downstream step consumes the previous step's output. Use 'condition' / 'dependsOn' when ordering matters.
- To reference an earlier step's tool result inside a later step's toolArgs, write the placeholder \`\${<stepId>.<key>}\` (or \`\${<stepId>.output.<key>}\`) in the toolArgs string value. The orchestrator substitutes the real value at runtime. Examples:
    • step1 toolName='studio.generateVideo' returns \`{ request_id, video_url? }\` →
      step2 toolName='studio.enhanceVideo', toolArgs={ video_url: "\${step1.video_url}", operation: "upscale" }
    • step1 toolName='media.transcribe' returns \`{ transcript }\` →
      step2 toolName='media.caption', toolArgs={ transcript: "\${step1.transcript}", style: "搞笑可愛" }
    • step1 toolName='studio.generateImage' returns \`{ request_id, image_url? }\` →
      step2 toolName='studio.generateVideo', toolArgs={ prompt: "...", image_url: "\${step1.image_url}" }
    • 圖片編輯（image-to-image）— 同一個 studio.generateImage 工具可同時處理 t2i 與 edit；
      只要在 toolArgs 帶上 image_url(必填) 與可選 image_urls[]（多參考圖融合）+ modelId
      指向 edit 模型即可，例如:
        toolName='studio.generateImage', toolArgs={
          modelId: 'fal-ai/nano-banana-pro/edit',
          prompt: '把背景換成日落海邊',
          image_url: '\${step1.image_url}',
          image_urls: ['\${step1.image_url}']
        }
      代理會自動以 image-to-image 路徑提交，沒有獨立的 studio.editImage 工具。
    • 3D 建模（image-to-3d / text-to-3d）— studio.generate3D 是 5 個 3D 模型
      （trellis-2 / sam-3/3d-objects / hunyuan3d-v3 / hyper3d/rodin / hunyuan_world）
      共用入口，executor 依 modelId / prompt / image_url 自動推 category。例：
        toolName='studio.generate3D', toolArgs={
          modelId: 'fal-ai/trellis-2',
          image_url: '\${step1.image_url}',
          resolution: '1024',
          texture_size: '2048'
        }
      Rodin 純文字模式（無 image_url）會走 text-to-3d；HunYuan3D v3 用 input_image_url
      + 可選 back/left/right_image_url 多視角。3D 推論 1-5 分鐘，會立即回 request_id。
  Use these placeholders ONLY for values produced by registered tool calls in earlier steps of the SAME plan; do not invent variables for parameters the user gave you (those are already known and should be inlined verbatim).
- Keep risk gates honest: studio.generate* tools are medium-risk + requiresHuman; the workflow confirmation card already approves them as a batch, so set requiresApproval=true on the step but DO NOT block on each individual sub-step at runtime.
- Forbidden lazy outputs: do NOT respond with only a navigate step + a chat message that tells the user to fill the prompt and click submit themselves. That defeats the purpose of the agent — always emit the actual toolName/toolArgs whenever a registered server-side tool covers the user's goal.
- HARD CONSTRAINT for tasked plans (絕對不可違反): every tasked plan MUST contain at least one step that actually does work — either a registered tool call (toolName=studio.*/director.*/media.*/pro-studio.*) OR a non-navigation UI action (fillPrompt / submit / runWorkflow / applyPreset / setModel / setMode / setParam / setTab / setModality / toggleSetting). A tasked plan whose steps are ALL "navigate" or "focusElement" will be rejected by the gating layer (status="invalid") and the user will see only a generic fallback reply. So if you only need to take the user somewhere, use decision.mode="direct" with a single navigate step; if you intend a real multi-step workflow, you MUST emit the executing step(s) in the same plan. 「光跳頁不執行」= 任務代理失敗。

Never dispatch navigate, fillPrompt, applyPreset, submit, or runWorkflow when the request is ambiguous — ask first.

Before proposing any execution step, infer the user's real goal, constraints, and desired outcome. If any key assumption is unverified, ask a clarifying question first instead of guessing.

Every proposed step must map to an explicit user intent or clarified preference; avoid speculative steps that are not directly aligned with what the user asked. 每一步都要確實符合使用者需求與意圖。

Prefer accuracy over speed: keep plans minimal, verify assumptions before each step, and ask clarification whenever confidence is not high. 寧可慢一點先對齊，也不要快但做錯。`,
    "When you base your plan on a recalled memory, registered page capability, or named tool, populate `citations`: [{ kind: 'memory'|'page'|'tool'|'web', id: '<source id>', label?: '<short human label>' }]. Reuse the memoryId values from the 'Recent long-term memory' summary verbatim. Skip citations when the response is fully novel. For 'web' citations, only include URLs that come from the provided 【網路研究】 block AND match the user's actual topic — drop any source whose title/summary is unrelated to what the user asked (寧可不引用，也不要引用離題的來源).",
    "For image uploads, plan image-to-video, image analysis, or prompt extraction workflows when requested.",
    "For audio/video/PDF uploads, use the attachment as source material and create analysis, transcription, storyboard, caption, or conversion workflows when requested.",
    "Do not use unregistered action types or tool names. If unavailable on this page, return clarification or blocked.",
    `External web search intent detection (極為重要 / very important):
When the user asks to SEARCH, LOOK UP, FIND, RESEARCH, COMPARE, or asks about LATEST TRENDS, NEWS, HOW-TO, WHAT IS, etc. — this is an EXTERNAL KNOWLEDGE QUERY, NOT a generation request.

Detection signals (any of these = external search intent):
- Chinese: 搜尋 / 查詢 / 查找 / 最新 / 趨勢 / 新聞 / 比較 / 推薦 / 怎麼做 / 是什麼 / 如何 / 為什麼 / 哪個好 / 幫我找 / 幫我查 / 了解一下 / 研究一下 / 有沒有關於
- English: search / find / look up / latest / trending / compare / recommend / how to / what is / research
- Context: user mentions a year (e.g. 2026), a technology name, a product, a concept they want to learn about

When external search intent is detected:
1. Use toolName='research.deepSearch' with toolArgs={ query: "<optimized search query>", language: "zh-TW", recencyFilter?: "month" }
2. decision.mode='tasked' with a single research.deepSearch step
3. DO NOT navigate to any studio page or trigger any generation tool
4. DO NOT interpret "搜尋 AI 圖片生成技術" as "generate an AI image" — it means "search for information about AI image generation technology"

Critical anti-pattern: "幫我搜尋 X" ≠ "幫我生成 X"。搜尋是查資料，生成是做東西。分清楚再行動。`,
  ].filter(Boolean).join("\n\n");

  return [
    { role: "system", content: `${systemPrompt}\n\n${contextBlock}` },
    ...input.messages,
  ];
}

function extractPlannerContent(result: InvokeResult): string {
  return extractMessageText(result.choices[0]?.message?.content);
}

function extractLatestUserTextFromMessages(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m || m.role !== "user") continue;
    const content = m.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .filter((part): part is { type: "text"; text: string } => {
          return Boolean(part) && (part as { type?: string }).type === "text";
        })
        .map(part => part.text)
        .join("\n");
    }
    if (content && typeof content === "object" && (content as { type?: string }).type === "text") {
      return (content as { text?: string }).text ?? "";
    }
  }
  return "";
}

function plannerStepsForCoherence(
  gated: GatedAgentPlanResult
): Array<{ action?: { type?: string; modality?: string; path?: string }; pagePath?: string }> {
  const plan = gated.plan;
  if (!plan || !("steps" in plan) || !Array.isArray(plan.steps)) return [];
  return (plan.steps as Array<unknown>).map(step => {
    const s = step as { action?: { type?: string; modality?: string; path?: string }; pagePath?: string };
    return { action: s.action, pagePath: s.pagePath };
  });
}

/**
 * Apply Phase 2 safety gates to a freshly gated planner result:
 *   1. Modality coherence — if the user clearly asked for "video" but the
 *      plan navigated to /image-studio, append a warning so the caller sees
 *      the mismatch. Replanning happens in the wrapper below.
 *   2. Content moderation — when the planner reply contains blocked
 *      categories (violence/hate/explicit), force status="blocked" and
 *      replace the reply text with a safe redirect.
 */
function applyModerationGate(gated: GatedAgentPlanResult): {
  next: GatedAgentPlanResult;
  blocked: boolean;
  warned: boolean;
} {
  const moderation = moderateOrbContent(gated.reply ?? "");
  if (moderation.action === "block") {
    const categories = Array.from(
      new Set(moderation.findings.map(f => f.category))
    ).join(",");
    return {
      next: {
        ...gated,
        status: "blocked",
        ok: false,
        actions: [],
        reply: moderation.text,
        warnings: [
          ...gated.warnings,
          `Content moderation blocked reply (categories: ${categories})`,
        ],
      },
      blocked: true,
      warned: false,
    };
  }
  if (moderation.action === "warn") {
    return {
      next: {
        ...gated,
        reply: moderation.text,
        warnings: [
          ...gated.warnings,
          "Content moderation prepended a warning to reply",
        ],
      },
      blocked: false,
      warned: true,
    };
  }
  return { next: gated, blocked: false, warned: false };
}

export async function runSchemaFirstAgentPlanner(
  input: AgentPlannerInput
): Promise<AgentPlannerResult> {
  const llm = input.invoke ?? invokeLLM;
  const usedMultimodalPlanner = hasMultimodalPlannerInput(input.messages);
  const result = await llm({
    messages: buildAgentPlannerMessages(input),
    runName: usedMultimodalPlanner
      ? "orb-agent-gemini-multimodal-planner"
      : "orb-agent-schema-first-planner",
    maxTokens: input.maxTokens ?? 2_500,
    preferEngine: usedMultimodalPlanner ? "gemini" : undefined,
    response_format: {
      type: "json_schema",
      json_schema: AGENT_PLAN_V3_JSON_SCHEMA as unknown as {
        name: string;
        schema: Record<string, unknown>;
        strict?: boolean;
      },
    },
  });

  // Thread the user-selected composer mode into the gate so it can enforce
  // mode contracts that the LLM may have skipped (e.g. 多步驟代理 forbids
  // decision.mode='direct' and phantom-plan replies).
  const gateRequestedModeMatch = input.context
    ? input.context.match(/使用者選擇模式[:：]\s*([a-z_-]+)/i)
    : null;
  const gateRequestedMode = gateRequestedModeMatch?.[1]?.toLowerCase() ?? undefined;
  const gateOptions = gateRequestedMode ? { requestedMode: gateRequestedMode } : undefined;

  let rawContent = extractPlannerContent(result);
  let gated = parseAndGatePlan(rawContent, gateOptions);

  // ─── Mode-contract replan (bounded to 2 attempts) ────────────────────
  // When the gate rejects a multi-step plan because the LLM emitted
  // decision.mode='direct' or a phantom-plan reply, re-invoke the planner
  // with an explicit refine message naming the violation. Bounded to 2
  // retries so a stubborn LLM that still violates on attempt 2 can recover
  // on attempt 3 — but we never loop indefinitely. Cycle protection: each
  // retry's `reason` is compared against the previous to detect "the same
  // violation 3 times in a row" and bail early so we don't burn budget on
  // a model that's clearly stuck.
  const MAX_MODE_REPLAN_ATTEMPTS = 2;
  let modeReplanAttempts = 0;
  let lastReplanReason: string | null = null;
  while (
    gateRequestedMode === "multi-step" &&
    gated.status === "invalid" &&
    typeof gated.reason === "string" &&
    /Multi-step mode contract violated/i.test(gated.reason) &&
    modeReplanAttempts < MAX_MODE_REPLAN_ATTEMPTS
  ) {
    // Cycle break: if the LLM produced the same gate-rejection reason as
    // last attempt, further retries are unlikely to converge. Bail.
    if (lastReplanReason !== null && lastReplanReason === gated.reason) {
      gated = {
        ...gated,
        warnings: [
          ...gated.warnings,
          `Mode-contract replan bailed: same violation repeated ${modeReplanAttempts + 1}×.`,
        ],
      };
      break;
    }
    lastReplanReason = gated.reason;
    const refineMessages: Message[] = [
      ...input.messages,
      {
        role: "user",
        content:
          `[Orb safety gate] 第 ${modeReplanAttempts + 1} 次：上一版計畫違反多步驟代理契約：${gated.reason}\n` +
          `請改用 decision.mode='clarification' (單一問題 + 2-4 選項) 或 decision.mode='tasked'（每步必須有 toolName 或非 navigate 的 UI action）。不要把步驟條列寫在 reply 中，也不要問「你想從哪一步開始」。`,
      } as Message,
    ];
    const modeReplan = await llm({
      messages: buildAgentPlannerMessages({
        ...input,
        messages: refineMessages,
      }),
      runName: usedMultimodalPlanner
        ? `orb-agent-gemini-multimodal-planner-mode-refine-${modeReplanAttempts + 1}`
        : `orb-agent-schema-first-planner-mode-refine-${modeReplanAttempts + 1}`,
      maxTokens: input.maxTokens ?? 2_500,
      preferEngine: usedMultimodalPlanner ? "gemini" : undefined,
      response_format: {
        type: "json_schema",
        json_schema: AGENT_PLAN_V3_JSON_SCHEMA as unknown as {
          name: string;
          schema: Record<string, unknown>;
          strict?: boolean;
        },
      },
    });
    const modeReplanRaw = extractPlannerContent(modeReplan);
    const modeReplanGated = parseAndGatePlan(modeReplanRaw, gateOptions);
    modeReplanAttempts += 1;
    if (modeReplanGated.status !== "invalid") {
      rawContent = modeReplanRaw;
      gated = {
        ...modeReplanGated,
        warnings: [
          ...modeReplanGated.warnings,
          `Mode-contract replan succeeded on attempt ${modeReplanAttempts} (multi-step mode enforcement).`,
        ],
      };
      break;
    }
    // Still invalid — replace `gated` so the next loop iteration sees the
    // latest reason for cycle detection and the refine prompt above
    // references the most recent attempt's violation.
    gated = modeReplanGated;
  }

  // ─── Navigate-mode replan (single-pass) ──────────────────────────────
  // Mirrors the multi-step replan above for the 跳頁 contract: when the
  // gate rejected a direct plan because the target path isn't in
  // APP_PAGE_REGISTRY, re-invoke the planner ONCE telling it which path
  // was wrong and demanding clarification with registry-backed options.
  if (
    gateRequestedMode === "navigate" &&
    gated.status === "invalid" &&
    typeof gated.reason === "string" &&
    /Navigate-mode contract violated/i.test(gated.reason)
  ) {
    const refineMessages: Message[] = [
      ...input.messages,
      {
        role: "user",
        content:
          `[Orb safety gate] 上一版跳頁計畫違反 navigate 契約：${gated.reason}\n` +
          `請改用 decision.mode='clarification'，clarificationQuestion 用「想去哪個工具頁？」之類的問法，clarificationOptions 必須選自 Global capability registry summary 中真實存在的頁面標題（2-4 個最相近的選項）。不要再產生 'direct' 計畫指向未註冊路徑。`,
      } as Message,
    ];
    const navReplan = await llm({
      messages: buildAgentPlannerMessages({
        ...input,
        messages: refineMessages,
      }),
      runName: usedMultimodalPlanner
        ? "orb-agent-gemini-multimodal-planner-navigate-refine"
        : "orb-agent-schema-first-planner-navigate-refine",
      maxTokens: input.maxTokens ?? 2_500,
      preferEngine: usedMultimodalPlanner ? "gemini" : undefined,
      response_format: {
        type: "json_schema",
        json_schema: AGENT_PLAN_V3_JSON_SCHEMA as unknown as {
          name: string;
          schema: Record<string, unknown>;
          strict?: boolean;
        },
      },
    });
    const navReplanRaw = extractPlannerContent(navReplan);
    const navReplanGated = parseAndGatePlan(navReplanRaw, gateOptions);
    if (navReplanGated.status !== "invalid") {
      rawContent = navReplanRaw;
      gated = {
        ...navReplanGated,
        warnings: [
          ...navReplanGated.warnings,
          "Mode-contract replan triggered (navigate mode enforcement).",
        ],
      };
    }
  }

  // ─── Phase 2 modality coherence gate (single-pass replan) ────────────
  // When the user clearly declared a modality (e.g. "做一支 30 秒影片") but
  // the planner navigated to a different studio (image / audio / voice),
  // re-invoke the planner ONCE with an explicit refine message naming the
  // mismatch. Bounded to one extra LLM call so we never loop. If the gate
  // already accepted a plan as `clarification` / `blocked` / `invalid` we
  // skip — the user-facing ask itself stops the wrong-modality dispatch.
  const userTextForGate = extractLatestUserTextFromMessages(input.messages);
  if (
    userTextForGate &&
    (gated.status === "tasked" || gated.status === "converted")
  ) {
    const coherence = checkModalityCoherence({
      userText: userTextForGate,
      steps: plannerStepsForCoherence(gated),
    });
    if (coherence.mismatch) {
      const refineMessages: Message[] = [
        ...input.messages,
        {
          role: "user",
          content:
            `[Orb safety gate] 上一版計畫的模態與使用者意圖不符（declared=${coherence.declared}, selected=${coherence.selected}）。${coherence.message} ` +
            `請改用「${coherence.declared}」對應的頁面、模型與步驟重產整份計畫，不要保留錯模態的步驟。`,
        } as Message,
      ];
      const replan = await llm({
        messages: buildAgentPlannerMessages({
          ...input,
          messages: refineMessages,
        }),
        runName: usedMultimodalPlanner
          ? "orb-agent-gemini-multimodal-planner-modality-refine"
          : "orb-agent-schema-first-planner-modality-refine",
        maxTokens: input.maxTokens ?? 2_500,
        preferEngine: usedMultimodalPlanner ? "gemini" : undefined,
        response_format: {
          type: "json_schema",
          json_schema: AGENT_PLAN_V3_JSON_SCHEMA as unknown as {
            name: string;
            schema: Record<string, unknown>;
            strict?: boolean;
          },
        },
      });
      const replanRaw = extractPlannerContent(replan);
      const replanGated = parseAndGatePlan(replanRaw, gateOptions);
      if (
        replanGated.status === "tasked" ||
        replanGated.status === "converted" ||
        replanGated.status === "clarification"
      ) {
        rawContent = replanRaw;
        gated = {
          ...replanGated,
          warnings: [
            ...replanGated.warnings,
            `Modality replan triggered: ${coherence.message}`,
          ],
        };
      } else {
        gated = {
          ...gated,
          warnings: [...gated.warnings, coherence.message],
        };
      }
    }
  }

  if (
    usedMultimodalPlanner &&
    gated.version === "agent-plan.v3" &&
    gated.plan &&
    "routing" in gated.plan
  ) {
    const plan = gated.plan;
    const routing = plan.routing ?? {
      preferredEngine: "auto",
      capabilities: [],
      pageScope: "single",
    };
    const capabilities = Array.isArray(routing.capabilities) ? routing.capabilities : [];
    if (!capabilities.includes("multimodal")) {
      const nextPlan = {
        ...plan,
        routing: {
          ...routing,
          capabilities: [...capabilities, "multimodal"],
        },
      };
      gated = {
        ...gated,
        plan: nextPlan,
        warnings: [...gated.warnings, "已自動標記 routing.capabilities 包含 multimodal。"],
      };
    }
  }

  // ─── Phase 2 content moderation gate ─────────────────────────────────
  // Block on violence / hate / explicit; warn (prepend) on self-harm.
  const moderated = applyModerationGate(gated);
  gated = moderated.next;

  // Multimodal-derived planner always prefers Gemini routing for the next
  // engine pick, regardless of what the model declared.
  const preferredEngine = usedMultimodalPlanner ? "gemini" : gated.preferredEngine;
  return {
    ...gated,
    preferredEngine,
    rawContent,
    plannerUsed: true,
    usedMultimodalPlanner,
  };
}

export function plannerResultShouldFallback(result: AgentPlannerResult): boolean {
  return result.status === "invalid";
}

// ─── Plan self-critique with auto-refine ──────────────────────────────────
//
// Runs the schema-first planner, then submits the converted workflow to
// the semantic critic (`critiquePlan`). When the critic reports
// `shouldRefine` (blockers present or score below threshold), the planner
// is invoked AGAIN with the original messages plus a refine prompt
// describing the issues; the second result replaces the first. Capped at
// one refine pass.
//
// Why two passes instead of asking the LLM to be careful upfront: the
// planner system prompt is already 8k tokens and adding "please don't
// make these mistakes" rarely changes behaviour. A directed refine
// prompt that names each concrete issue (forward-reference at step 3,
// unresolved-placeholder at step 5, …) lands far more reliably.

/**
 * Find the workflow representation of a planner result regardless of how
 * the gating layer classified it.
 *
 *   - status="converted"  → workflow lives in `result.actions[0]`.
 *   - status="tasked"     → `result.actions` is empty (the gate routed it
 *                           through OrbTask draft); we project the v3
 *                           plan back into a RunWorkflowAction so the
 *                           critic can still inspect tool / step shape.
 */
function extractWorkflowFromResult(
  result: AgentPlannerResult
): RunWorkflowAction | null {
  for (const action of result.actions) {
    if (action.type === "runWorkflow") return action;
  }
  if (
    result.status === "tasked" &&
    result.version === "agent-plan.v3" &&
    result.plan &&
    "steps" in result.plan
  ) {
    // The status + version narrowing already established v3-shape, but
    // the typed union still includes the legacy v1 plan. Cast at the call
    // boundary; runtime check has already validated.
    const projected = adaptAgentPlanV3ToActions(result.plan as AgentPlanV3);
    for (const action of projected) {
      if (action.type === "runWorkflow") return action;
    }
  }
  return null;
}

/**
 * Run the planner with optional critique + bounded-iterative refine.
 *
 * Falls back to `runSchemaFirstAgentPlanner` semantics whenever critique
 * is disabled, the gating layer rejected the plan, or no `runWorkflow`
 * came out of the conversion.
 *
 * When `enableCritique` is true the function runs a Generator→Critic loop
 * (Reflection pattern): the draft is scored, and while the critic is
 * unsatisfied it re-invokes the planner with a directed critique prompt,
 * up to `maxRefineRounds` times. It tracks the BEST-scoring plan across
 * rounds and returns that — never a refined plan that scored worse than
 * what we already had. The loop stops early on any of:
 *   - the critic is satisfied (no blockers, score >= refineBelow),
 *   - a refined round fails to improve on the best score (no-improvement
 *     guard — avoids burning LLM budget on a model that's stuck),
 *   - a refined round no longer yields a workflow (clarification/invalid),
 *   - a refine LLM call throws.
 *
 * `maxRefineRounds` defaults to 1, which is byte-for-byte the previous
 * single-pass behaviour for existing callers. Each refine round is wrapped
 * in try/catch so a malformed second response degrades to the best plan so
 * far rather than crashing the chat.
 */
export async function runSchemaFirstAgentPlannerWithCritique(
  input: AgentPlannerInput
): Promise<AgentPlannerResult> {
  const draft = await runSchemaFirstAgentPlanner(input);
  if (!input.enableCritique) {
    return { ...draft, critique: null, critiqueRefined: false, critiqueRounds: 0 };
  }
  // Critique is meaningful only on plans the gate already accepted as a
  // workflow; clarification / blocked / invalid statuses skip refinement.
  if (draft.status !== "converted" && draft.status !== "tasked") {
    return { ...draft, critique: null, critiqueRefined: false, critiqueRounds: 0 };
  }
  const draftWorkflow = extractWorkflowFromResult(draft);
  if (!draftWorkflow) {
    return { ...draft, critique: null, critiqueRefined: false, critiqueRounds: 0 };
  }

  const refineBelow = input.critiqueRefineBelow ?? 75;
  const maxRounds = Math.max(1, Math.min(3, Math.trunc(input.maxRefineRounds ?? 1)));
  // Pass the latest user utterance into the critic so the modality coherence
  // check has something to compare against; without it the critic skips
  // coherence silently (back-compat).
  const userText = extractLatestUserTextFromMessages(input.messages);
  const llm = input.invoke ?? invokeLLM;
  // Re-detect the user-selected mode once so every refine round keeps the
  // gate enforcing multi-step / navigate contracts on the refined plan too.
  const critiqueGateModeMatch = input.context
    ? input.context.match(/使用者選擇模式[:：]\s*([a-z_-]+)/i)
    : null;
  const critiqueGateMode = critiqueGateModeMatch?.[1]?.toLowerCase();
  const gateOptions = critiqueGateMode ? { requestedMode: critiqueGateMode } : undefined;

  // `best*` always holds the highest-scoring plan we've produced so far.
  // We seed it with the draft and only replace it when a refined round
  // strictly beats it, so a regression can never be returned.
  let bestResult: AgentPlannerResult = draft;
  let bestWorkflow: RunWorkflowAction = draftWorkflow;
  let bestCritique = critiquePlan(draftWorkflow, { refineBelow, userText });
  let rounds = 0;

  while (rounds < maxRounds && bestCritique.shouldRefine) {
    // The refine prompt is always built from the BEST plan so far — the
    // critic's issue list describes exactly that plan, so the LLM gets a
    // coherent "fix these N problems in this exact JSON" instruction.
    const refinePrompt = buildCritiquePromptForLLM(bestWorkflow, bestCritique);
    const refineMessages: Message[] = [
      ...input.messages,
      { role: "user", content: refinePrompt } as Message,
    ];

    let refinedGated: ReturnType<typeof parseAndGatePlan>;
    let refinedRaw: string;
    try {
      const refineResult = await llm({
        messages: buildAgentPlannerMessages({ ...input, messages: refineMessages }),
        runName:
          rounds === 0
            ? "orb-agent-schema-first-planner-refine"
            : `orb-agent-schema-first-planner-refine-${rounds + 1}`,
        maxTokens: input.maxTokens ?? 2_500,
        response_format: {
          type: "json_schema",
          json_schema: AGENT_PLAN_V3_JSON_SCHEMA as unknown as {
            name: string;
            schema: Record<string, unknown>;
            strict?: boolean;
          },
        },
      });
      refinedRaw = extractPlannerContent(refineResult);
      refinedGated = parseAndGatePlan(refinedRaw, gateOptions);
    } catch (err) {
      // refine 失敗 — 保留目前 best + 其 critique，比 crash 整條 chat 強。
      logger.warn("planner_refine_failed", {
        error: err instanceof Error ? err.message : String(err),
        draftStatus: draft.status,
        round: rounds + 1,
      });
      break;
    }
    rounds += 1;

    // Build the refined plan into the SAME AgentPlannerResult shape the
    // draft uses, then extract its workflow with the SAME helper
    // (extractWorkflowFromResult). Critical: a "tasked" v3 plan carries no
    // `runWorkflow` in its gated `actions` — the workflow only exists after
    // adaptAgentPlanV3ToActions projection, which extractWorkflowFromResult
    // performs. A plain `runWorkflow` scan here would return null for every
    // tasked plan and silently stop the loop after one round (defeating the
    // whole bounded-iteration / best-of mechanism).
    const refinedResult: AgentPlannerResult = {
      ...refinedGated,
      rawContent: refinedRaw,
      plannerUsed: true,
      usedMultimodalPlanner: draft.usedMultimodalPlanner,
    };
    // A refined round that no longer yields a workflow (e.g. the LLM bailed
    // to clarification, or the gate rejected it) can't be scored — keep the
    // best plan so far and stop.
    const refinedWorkflow = extractWorkflowFromResult(refinedResult);
    if (!refinedWorkflow) break;

    const refinedCritique = critiquePlan(refinedWorkflow, { refineBelow, userText });
    // No-improvement guard: only adopt the refined plan when it strictly
    // beats the best score. Otherwise stop — further rounds are unlikely
    // to converge and each one costs an LLM call.
    if (refinedCritique.score <= bestCritique.score) break;

    bestResult = refinedResult;
    bestWorkflow = refinedWorkflow;
    bestCritique = refinedCritique;
  }

  return {
    ...bestResult,
    critique: bestCritique,
    critiqueRefined: rounds > 0,
    critiqueRounds: rounds,
  };
}

// Re-export so other modules can build their own critique flows without
// reaching across the shared boundary.
export { critiquePlan, buildCritiquePromptForLLM } from "../../shared/orb-plan-critic";
export type { PlanCritiqueResult } from "../../shared/orb-plan-critic";
