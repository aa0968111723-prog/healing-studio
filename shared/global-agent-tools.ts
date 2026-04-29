export type GlobalAgentToolTarget =
  | "ui-only"
  | "server-side"
  | "claudeCode"
  | "external-provider";

export interface GlobalAgentToolDefinition {
  name: string;
  riskLevel: "low" | "medium" | "high";
  requiresHuman: boolean;
  allowedArgsSchema: Record<string, unknown>;
  executionTarget: GlobalAgentToolTarget;
}

export const GLOBAL_AGENT_TOOL_REGISTRY: GlobalAgentToolDefinition[] = [
  {
    name: "media.transcribe",
    riskLevel: "medium",
    requiresHuman: false,
    allowedArgsSchema: { url: "string", mimeType: "string?" },
    executionTarget: "external-provider",
  },
  {
    name: "media.caption",
    riskLevel: "medium",
    requiresHuman: false,
    allowedArgsSchema: { transcript: "string", style: "string?" },
    executionTarget: "server-side",
  },
  {
    name: "media.storyboard",
    riskLevel: "medium",
    requiresHuman: false,
    allowedArgsSchema: { summary: "string", durationSec: "number?" },
    executionTarget: "server-side",
  },
  {
    name: "media.summarizePdf",
    riskLevel: "medium",
    requiresHuman: false,
    allowedArgsSchema: { url: "string" },
    executionTarget: "external-provider",
  },
  {
    name: "media.extractPrompt",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: { text: "string?" },
    executionTarget: "server-side",
  },
  {
    name: "github.review",
    riskLevel: "high",
    requiresHuman: true,
    allowedArgsSchema: { repo: "string", pr: "number?" },
    executionTarget: "claudeCode",
  },
  {
    name: "github.pr.create",
    riskLevel: "high",
    requiresHuman: true,
    allowedArgsSchema: { repo: "string", title: "string", body: "string?" },
    executionTarget: "claudeCode",
  },
  {
    name: "deploy.preview",
    riskLevel: "high",
    requiresHuman: true,
    allowedArgsSchema: { service: "string", env: "string?" },
    executionTarget: "external-provider",
  },
  {
    name: "code.modifyWithClaudeCode",
    riskLevel: "high",
    requiresHuman: true,
    allowedArgsSchema: { task: "string", files: "string[]?" },
    executionTarget: "claudeCode",
  },
  // ─── 創作工作室生成工具（光球可在多步驟計畫中直接觸發生成） ──
  {
    name: "studio.generateImage",
    riskLevel: "medium",
    requiresHuman: true,
    allowedArgsSchema: {
      prompt: "string",
      modelId: "string?",
      aspect_ratio: "string?",
      num_images: "number?",
      negative_prompt: "string?",
    },
    executionTarget: "server-side",
  },
  {
    name: "studio.generateVideo",
    riskLevel: "medium",
    requiresHuman: true,
    allowedArgsSchema: {
      prompt: "string",
      modelId: "string?",
      image_url: "string?",
      duration: "number?",
      aspect_ratio: "string?",
    },
    executionTarget: "server-side",
  },
  {
    name: "studio.generateAudio",
    riskLevel: "medium",
    requiresHuman: true,
    allowedArgsSchema: {
      prompt: "string",
      modelId: "string?",
      lyrics: "string?",
      instrumental: "boolean?",
      duration: "number?",
    },
    executionTarget: "server-side",
  },
  {
    name: "studio.generateVoice",
    riskLevel: "medium",
    requiresHuman: true,
    allowedArgsSchema: {
      text: "string",
      modelId: "string?",
      voice_id: "string?",
      speed: "number?",
    },
    executionTarget: "server-side",
  },
  // ─── 導演 AI 規劃工具（光球可請導演為當前工作室規劃下一步） ──
  {
    name: "director.suggestPlan",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: {
      activeModality: "string",
      userIntent: "string?",
      selectedFalModelId: "string?",
      hasTokenWeights: "boolean?",
      hasFineTunedModel: "boolean?",
      personality: "string?",
    },
    executionTarget: "server-side",
  },
];

export function getGlobalAgentTool(name: string): GlobalAgentToolDefinition | null {
  return GLOBAL_AGENT_TOOL_REGISTRY.find(tool => tool.name === name) ?? null;
}

export function isKnownGlobalAgentTool(name: string): boolean {
  return Boolean(getGlobalAgentTool(name));
}

export function summarizeGlobalToolRegistry(limit = 40): string {
  return JSON.stringify({
    total: GLOBAL_AGENT_TOOL_REGISTRY.length,
    tools: GLOBAL_AGENT_TOOL_REGISTRY.slice(0, limit).map(tool => ({
      name: tool.name,
      riskLevel: tool.riskLevel,
      requiresHuman: tool.requiresHuman,
      executionTarget: tool.executionTarget,
    })),
  });
}
