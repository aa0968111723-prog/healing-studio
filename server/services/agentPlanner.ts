import { invokeLLM, type Message, type InvokeResult } from "../_core/llm";
import { AGENT_PLAN_JSON_SCHEMA } from "../../shared/agent-plan-schema";
import {
  adaptAgentPlanToActions,
  buildAgentPlanSystemPrompt,
  type AgentPlanAdapterResult,
} from "../../shared/agent-plan-adapter";
import type { AgentFeedbackEvent, PageAgentSnapshot } from "../../shared/agent-actions";

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
}

function safeStringify(value: unknown, maxLength = 3_000): string {
  try {
    return JSON.stringify(value, null, 2).slice(0, maxLength);
  } catch {
    return String(value).slice(0, maxLength);
  }
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
  const systemPrompt = buildAgentPlanSystemPrompt(pageSummary);
  const contextBlock = [
    input.context ? `Conversation context: ${input.context}` : undefined,
    input.personality ? `Orb personality: ${input.personality}` : undefined,
    `Recent execution feedback:\n${feedbackSummary}`,
    "Plan in Traditional Chinese labels where helpful, but keep action ids and page paths exact.",
    "Prefer asking one clarification question when the user's target output, modality, or destination is unclear.",
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
  const result = await llm({
    messages: buildAgentPlannerMessages(input),
    runName: "orb-agent-schema-first-planner",
    maxTokens: input.maxTokens ?? 2_500,
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
  };
}

export function plannerResultShouldFallback(result: AgentPlannerResult): boolean {
  return result.status === "invalid";
}
