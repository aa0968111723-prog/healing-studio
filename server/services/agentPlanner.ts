import { invokeLLM, type Message, type InvokeResult } from "../_core/llm";
import { AGENT_PLAN_V3_JSON_SCHEMA } from "../../shared/agent-plan-schema";
import { summarizeGlobalCapabilityRegistry } from "../../shared/global-agent-capabilities";
import { summarizeGlobalToolRegistry } from "../../shared/global-agent-tools";
import {
  buildAgentPlanV3SystemPrompt,
  parseAndGatePlan,
  type GatedAgentPlanResult,
} from "../../shared/agent-plan-adapter";
import type { AgentFeedbackEvent, PageAgentSnapshot } from "../../shared/agent-actions";
import type { AgentPreferences } from "../../shared/agent-preferences";

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
  maxTokens?: number;
  invoke?: typeof invokeLLM;
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

function summarizeMessagePart(part: unknown): PlannerMultimodalPartSummary | null {
  if (!part || typeof part !== "object") return null;
  const record = part as Record<string, unknown>;

  if (record.type === "image_url") {
    const image = record.image_url as Record<string, unknown> | undefined;
    return {
      kind: "image",
      url: typeof image?.url === "string" ? image.url : undefined,
    };
  }

  if (record.type === "file_url") {
    const file = record.file_url as Record<string, unknown> | undefined;
    const mimeType = typeof file?.mime_type === "string" ? file.mime_type : undefined;
    return {
      kind: mimeToPlannerKind(mimeType),
      mimeType,
      url: typeof file?.url === "string" ? file.url : undefined,
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

export function buildAgentPlannerMessages(input: AgentPlannerInput): Message[] {
  const pageSummary = summarizePageSnapshotForPlanner(input.pageSnapshot);
  const feedbackSummary = summarizeRecentFeedbackForPlanner(input.recentFeedback);
  const multimodalSummary = summarizeMultimodalInputsForPlanner(input.messages);
  const systemPrompt = buildAgentPlanV3SystemPrompt(pageSummary);
  const capabilitySummary = summarizeGlobalCapabilityRegistry(120);
  const toolSummary = summarizeGlobalToolRegistry(60);
  const preferencesSummary = summarizePreferencesForPlanner(input.preferences);
  const contextBlock = [
    input.context ? `Conversation context: ${input.context}` : undefined,
    input.personality ? `Orb personality: ${input.personality}` : undefined,
    `Recent execution feedback:\n${feedbackSummary}`,
    `Recent task memory:\n${input.recentTaskMemorySummary ?? "No recent task memory."}`,
    `Recent long-term memory:\n${input.recentOrbMemorySummary ?? "No long-term memory."}`,
    input.siteKnowledgeSummary ? `Site knowledge summary:\n${input.siteKnowledgeSummary}` : undefined,
    `Global capability registry summary:\n${capabilitySummary}`,
    `Global tool registry summary:\n${toolSummary}`,
    `Multimodal attachments:\n${multimodalSummary}`,
    `User agent preferences:\n${preferencesSummary}`,
    "Plan in Traditional Chinese labels where helpful, but keep action ids and page paths exact.",
    "When the user's target output, modality, destination page, chosen model, constraints, or success criteria are unclear, you MUST return shouldAskClarification=true with a single clarificationQuestion (Traditional Chinese, ≤80 字) and 2-4 short clarificationOptions covering the likely choices. Do NOT include any steps in clarification mode.",
    `Multi-step wizard rule (極為重要 / very important):
Before producing a 'tasked' plan (multi-step / cross-page execution), you MUST gather the key parameters with a step-by-step quick-select wizard. Even if you can guess, ASK FIRST.

How the wizard works:
- Ask ONE clarifying question at a time (decision.mode='clarification' + clarificationQuestion + 2-4 clarificationOptions). Never ask multiple questions in a single message.
- Re-read the conversation each turn — earlier '[使用者澄清]:' answers count as already-confirmed parameters; do NOT ask the same dimension twice.
- Continue clarification rounds until ALL the following dimensions for the user's modality are pinned down before switching to decision.mode='tasked':
  • Video (影片): 時長 (e.g., 15s / 30-60s / 1分鐘以上)、風格/調性、素材來源 (手邊素材 vs AI 生成)、目標平台/比例。
  • Image (圖片): 比例/尺寸、風格/氛圍、主體/構圖、模型偏好 (若已知)。
  • Voice / 配音: 語氣/角色、語言、時長或字數、輸出格式。
  • Music / 音樂: 用途 (BGM / 廣告 / 短影音)、時長、情緒/曲風、是否需要人聲。
  • Script / 腳本: 平台/受眾、主題與目標、長度、風格 (搞笑 / 嚴肅 / 教學 …)。
  • LoRA / Training: 訓練主體、素材數量、目標風格、輸出用途。
- Each clarificationOptions list should reflect THIS user's prompt (use their own wording / topic when sensible) — never generic fillers, never options unrelated to their topic.
- Switch to decision.mode='direct' only for single-page low-risk fillPrompt-style requests where every parameter is already explicit.
- Switch to decision.mode='tasked' only after the wizard has all required dimensions confirmed; the steps you produce must reflect each confirmed answer.

Autonomous-execution rule (極為重要 / very important):
After the wizard collects all parameters, the orb MUST actually run the generation for the user — not merely navigate to a page or describe what to do. The user said: "需要真實執行多步驟執行代理，不能只是跳頁或聊天跟使用者自己用".

How to produce a real executable tasked plan:
- Map the confirmed parameters onto a registered server-side studio.* tool from the 'Global tool registry summary' and emit a step with BOTH:
    • toolName: '<registered tool name>' (e.g., 'studio.generateVideo', 'studio.generateImage', 'studio.generateAudio', 'studio.generateVoice', 'studio.enhanceVideo')
    • toolArgs: { ...the actual prompt/modelId/duration/aspect_ratio/etc derived from the wizard answers }
  The orchestrator will dispatch the tool to fal.ai / Suno / ElevenLabs server-side and stream the request_id back — that's the real generation, not a UI hint.
- Pair each tool-call step with the matching UI action so the user sees it happen on the right studio page (e.g., navigate to /video-studio, fillPrompt with the same prompt, then submit). Both run together: uiActions for visibility, toolCalls for autonomous execution.
- For multi-step pipelines (subtitle → dubbing → render, or storyboard → image → video), chain the steps so each downstream step consumes the previous step's output. Use 'condition' / 'dependsOn' when ordering matters.
- To reference an earlier step's tool result inside a later step's toolArgs, write the placeholder \`\${<stepId>.<key>}\` (or \`\${<stepId>.output.<key>}\`) in the toolArgs string value. The orchestrator substitutes the real value at runtime. Examples:
    • step1 toolName='studio.generateVideo' returns \`{ request_id, video_url? }\` →
      step2 toolName='studio.enhanceVideo', toolArgs={ video_url: "\${step1.video_url}", operation: "upscale" }
    • step1 toolName='media.transcribe' returns \`{ transcript }\` →
      step2 toolName='media.caption', toolArgs={ transcript: "\${step1.transcript}", style: "搞笑可愛" }
    • step1 toolName='studio.generateImage' returns \`{ request_id, image_url? }\` →
      step2 toolName='studio.generateVideo', toolArgs={ prompt: "...", image_url: "\${step1.image_url}" }
  Use these placeholders ONLY for values produced by registered tool calls in earlier steps of the SAME plan; do not invent variables for parameters the user gave you (those are already known and should be inlined verbatim).
- Keep risk gates honest: studio.generate* tools are medium-risk + requiresHuman; the workflow confirmation card already approves them as a batch, so set requiresApproval=true on the step but DO NOT block on each individual sub-step at runtime.
- Forbidden lazy outputs: do NOT respond with only a navigate step + a chat message that tells the user to fill the prompt and click submit themselves. That defeats the purpose of the agent — always emit the actual toolName/toolArgs whenever a registered server-side tool covers the user's goal.

Never dispatch navigate, fillPrompt, applyPreset, submit, or runWorkflow when the request is ambiguous — ask first.

Before proposing any execution step, infer the user's real goal, constraints, and desired outcome. If any key assumption is unverified, ask a clarifying question first instead of guessing.

Every proposed step must map to an explicit user intent or clarified preference; avoid speculative steps that are not directly aligned with what the user asked. 每一步都要確實符合使用者需求與意圖。

Prefer accuracy over speed: keep plans minimal, verify assumptions before each step, and ask clarification whenever confidence is not high. 寧可慢一點先對齊，也不要快但做錯。`,
    "When you base your plan on a recalled memory, registered page capability, or named tool, populate `citations`: [{ kind: 'memory'|'page'|'tool'|'web', id: '<source id>', label?: '<short human label>' }]. Reuse the memoryId values from the 'Recent long-term memory' summary verbatim. Skip citations when the response is fully novel. For 'web' citations, only include URLs that come from the provided 【網路研究】 block AND match the user's actual topic — drop any source whose title/summary is unrelated to what the user asked (寧可不引用，也不要引用離題的來源).",
    "For image uploads, plan image-to-video, image analysis, or prompt extraction workflows when requested.",
    "For audio/video/PDF uploads, use the attachment as source material and create analysis, transcription, storyboard, caption, or conversion workflows when requested.",
    "Do not use unregistered action types or tool names. If unavailable on this page, return clarification or blocked.",
  ].filter(Boolean).join("\n\n");

  return [
    { role: "system", content: `${systemPrompt}\n\n${contextBlock}` },
    ...input.messages,
  ];
}

function extractPlannerContent(result: InvokeResult): string {
  const content = result.choices[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map(part => part.type === "text" ? part.text : "")
      .filter(Boolean)
      .join("\n");
  }
  return "";
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

  const rawContent = extractPlannerContent(result);
  let gated = parseAndGatePlan(rawContent);
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
