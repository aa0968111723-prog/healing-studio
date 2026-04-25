import { APP_PAGE_REGISTRY } from "./appRegistry";
import type { AgentActionType } from "./agent-actions";

export type CapabilityRiskLevel = "low" | "medium" | "high";

export interface GlobalAgentCapability {
  id: string;
  pageId: string;
  pagePath: string;
  label: string;
  description: string;
  actionType: AgentActionType;
  riskLevel: CapabilityRiskLevel;
  requiresApproval: boolean;
  inputSchema: Record<string, unknown>;
  outputExpectation: string;
  supportedModalities: Array<"image" | "video" | "audio" | "voice" | "text" | "file">;
  enabled: boolean;
}

const DEFAULT_ACTION_CAPABILITIES: Array<Pick<GlobalAgentCapability,
  "actionType" | "label" | "description" | "riskLevel" | "requiresApproval" | "inputSchema" | "outputExpectation" | "supportedModalities"
>> = [
  {
    actionType: "fillPrompt",
    label: "填入提示詞",
    description: "填寫或追加 prompt",
    riskLevel: "low",
    requiresApproval: false,
    inputSchema: { text: "string", slot: "string?" },
    outputExpectation: "prompt updated",
    supportedModalities: ["text", "image", "video", "audio", "voice"],
  },
  {
    actionType: "setModel",
    label: "切換模型",
    description: "切換當頁模型",
    riskLevel: "low",
    requiresApproval: false,
    inputSchema: { modelId: "string" },
    outputExpectation: "model selected",
    supportedModalities: ["image", "video", "audio", "voice", "text"],
  },
  {
    actionType: "setMode",
    label: "切換模式",
    description: "切換模式",
    riskLevel: "low",
    requiresApproval: false,
    inputSchema: { modeId: "string" },
    outputExpectation: "mode selected",
    supportedModalities: ["image", "video", "audio", "voice"],
  },
  {
    actionType: "setParam",
    label: "調整參數",
    description: "修改生成參數",
    riskLevel: "medium",
    requiresApproval: false,
    inputSchema: { key: "string", value: "unknown" },
    outputExpectation: "parameter updated",
    supportedModalities: ["image", "video", "audio", "voice"],
  },
  {
    actionType: "applyPreset",
    label: "套用 preset",
    description: "套用預設配置",
    riskLevel: "high",
    requiresApproval: true,
    inputSchema: { presetId: "string" },
    outputExpectation: "preset applied",
    supportedModalities: ["image", "video", "audio", "voice"],
  },
  {
    actionType: "submit",
    label: "送出任務",
    description: "觸發生成/執行",
    riskLevel: "high",
    requiresApproval: true,
    inputSchema: { delayMs: "number?" },
    outputExpectation: "job submitted",
    supportedModalities: ["image", "video", "audio", "voice", "text"],
  },
  {
    actionType: "reset",
    label: "重設表單",
    description: "清空目前設定",
    riskLevel: "high",
    requiresApproval: true,
    inputSchema: {},
    outputExpectation: "state reset",
    supportedModalities: ["image", "video", "audio", "voice", "text"],
  },
  {
    actionType: "navigate",
    label: "跨頁導覽",
    description: "切換頁面",
    riskLevel: "low",
    requiresApproval: false,
    inputSchema: { path: "string" },
    outputExpectation: "navigated",
    supportedModalities: ["text"],
  },
  {
    actionType: "openDialog",
    label: "開啟對話框",
    description: "開啟面板或對話框",
    riskLevel: "low",
    requiresApproval: false,
    inputSchema: { dialogId: "string" },
    outputExpectation: "dialog opened",
    supportedModalities: ["text"],
  },
  {
    actionType: "runWorkflow",
    label: "建立流程",
    description: "跨頁工作流",
    riskLevel: "medium",
    requiresApproval: true,
    inputSchema: { steps: "array" },
    outputExpectation: "workflow created",
    supportedModalities: ["image", "video", "audio", "voice", "text", "file"],
  },
  {
    actionType: "search",
    label: "搜尋",
    description: "搜尋頁面資料",
    riskLevel: "low",
    requiresApproval: false,
    inputSchema: { query: "string" },
    outputExpectation: "search result list",
    supportedModalities: ["text"],
  },
  {
    actionType: "setModality",
    label: "切換模態",
    description: "切換 image/video/audio/voice",
    riskLevel: "medium",
    requiresApproval: true,
    inputSchema: { modality: "string" },
    outputExpectation: "modality selected",
    supportedModalities: ["image", "video", "audio", "voice"],
  },
];

export const GLOBAL_AGENT_CAPABILITY_REGISTRY: GlobalAgentCapability[] = APP_PAGE_REGISTRY
  .filter(page => page.supportsPageAgent)
  .flatMap(page =>
    DEFAULT_ACTION_CAPABILITIES.map(base => ({
      id: `${page.id}.${base.actionType}`,
      pageId: page.id,
      pagePath: page.path,
      label: base.label,
      description: base.description,
      actionType: base.actionType,
      riskLevel: base.riskLevel,
      requiresApproval: base.requiresApproval,
      inputSchema: base.inputSchema,
      outputExpectation: base.outputExpectation,
      supportedModalities: base.supportedModalities,
      enabled: true,
    }))
  );

export function validateCapabilityRegistry(
  registry: GlobalAgentCapability[] = GLOBAL_AGENT_CAPABILITY_REGISTRY
): { ok: boolean; duplicates: string[] } {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const item of registry) {
    if (seen.has(item.id)) duplicates.push(item.id);
    seen.add(item.id);
  }
  return { ok: duplicates.length === 0, duplicates };
}

export function hasCapabilityForPage(pagePath: string | undefined, actionType: string): boolean {
  if (!pagePath) return true;
  return GLOBAL_AGENT_CAPABILITY_REGISTRY.some(
    capability =>
      capability.enabled &&
      capability.pagePath === pagePath &&
      capability.actionType === actionType
  );
}

export function summarizeGlobalCapabilityRegistry(limit = 80): string {
  const validation = validateCapabilityRegistry();
  const items = GLOBAL_AGENT_CAPABILITY_REGISTRY.slice(0, limit).map(item => ({
    id: item.id,
    pageId: item.pageId,
    pagePath: item.pagePath,
    actionType: item.actionType,
    riskLevel: item.riskLevel,
    requiresApproval: item.requiresApproval,
    enabled: item.enabled,
  }));
  return JSON.stringify({
    total: GLOBAL_AGENT_CAPABILITY_REGISTRY.length,
    validation,
    items,
  });
}
