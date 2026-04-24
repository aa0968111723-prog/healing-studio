import { invokeLLM, type Message, type InvokeResult } from "../_core/llm";
import { AGENT_PLAN_JSON_SCHEMA } from "../../shared/agent-plan-schema";
import {
  adaptAgentPlanToActions,
  buildAgentPlanSystemPrompt,
  type AgentPlanAdapterResult,
} from "../../shared/agent-plan-adapter";
import type { AgentFeedbackEvent, PageAgentSnapshot } from "../../shared/agent-actions";

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
  maxTokens?: number;
  invoke?: typeof invokeLLM;
}

export interface AgentPlannerResult extends AgentPlanAdapterResult {
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
  const systemPrompt = buildAgentPlanSystemPrompt(pageSummary);
  const contextBlock = [
    input.context ? `Conversation context: ${input.context}` : undefined,
    input.personality ? `Orb personality: ${input.personality}` : undefined,
    `Recent execution feedback:\n${feedbackSummary}`,
    `Multimodal attachments:\n${multimodalSummary}`,
    "Plan in Traditional Chinese labels where helpful, but keep action ids and page paths exact.",
    "Prefer asking one clarification question when the user's target output, modality, or destination is unclear.",
    "For image uploads, plan image-to-video, image analysis, or prompt extraction workflows when requested.",
    "For audio/video/PDF uploads, use the attachment as source material and create analysis, transcription, storyboard, caption, or conversion workflows when requested.",
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
      json_schema: AGENT_PLAN_JSON_SCHEMA as unknown as {
        name: string;
        schema: Record<string, unknown>;
        strict?: boolean;
      },
    },
  });

  const rawContent = extractPlannerContent(result);
  const adapted = adaptAgentPlanToActions(rawContent);
  return {
    ...adapted,
    rawContent,
    plannerUsed: true,
    usedMultimodalPlanner,
  };
}

export function plannerResultShouldFallback(result: AgentPlannerResult): boolean {
  return result.status === "invalid";
}
