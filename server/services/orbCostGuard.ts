import { deductUserPoints, refundUserPoints } from "../db";

export type OrbCostTier = "free" | "low" | "medium" | "high" | "unknown";

export interface OrbCostEstimateInput {
  providerId: string;
  modality: "text" | "image" | "audio" | "video" | "pdf" | "code" | "mixed";
  attachmentBytes?: number;
  attachmentCount?: number;
  expectedOutput: "text" | "image" | "video" | "audio" | "voice" | "code" | "deploy";
  estimatedTokens?: number;
  estimatedDurationSec?: number;
  estimatedAssetCount?: number;
  crossPageSteps?: number;
  retryCount?: number;
  /**
   * Names of registered tools the plan will invoke. Used to detect
   * outsized workloads (LoRA / fine-tune training) that the asset-count
   * heuristic alone undercounts — a single studio.trainLora step costs
   * far more than three studio.generateImage calls.
   */
  toolNames?: string[];
}

/** Tools whose presence forces tier="high" regardless of asset count. */
const HIGH_COST_TOOL_PREFIXES = [
  "studio.trainLora",
  "studio.fineTune",
  "studio.train",
] as const;

export interface OrbCostEstimate {
  tier: OrbCostTier;
  reasons: string[];
  requiresHuman: boolean;
  askBeforeAct: boolean;
  prompt: string | null;
}

export function estimateOrbTaskCost(input: OrbCostEstimateInput): OrbCostEstimate {
  const reasons: string[] = [];
  let tier: OrbCostTier = "low";

  const attachments = input.attachmentCount ?? 0;
  const attachmentBytes = input.attachmentBytes ?? 0;
  const duration = input.estimatedDurationSec ?? 0;
  const assets = input.estimatedAssetCount ?? 1;
  const retries = input.retryCount ?? 0;
  const crossPageSteps = input.crossPageSteps ?? 0;

  const highByOutput = input.expectedOutput === "video" || input.expectedOutput === "deploy" || input.expectedOutput === "code";
  if (highByOutput) {
    tier = "high";
    reasons.push("high_cost_output");
  }

  if (input.modality === "video" || duration > 180 || attachmentBytes > 20 * 1024 * 1024) {
    tier = "high";
    reasons.push("heavy_media_analysis");
  }

  if (assets >= 3 || attachments >= 3) {
    tier = tier === "high" ? "high" : "medium";
    reasons.push("multiple_assets");
  }

  if (crossPageSteps >= 4) {
    tier = "high";
    reasons.push("cross_page_workflow");
  }

  if (input.providerId === "claudeCode" || input.providerId === "codex") {
    tier = "high";
    reasons.push("code_collaboration");
  }

  // LoRA / fine-tune training jobs each cost 5–30 minutes of GPU time and
  // burn the user's training quota — far more than the asset-count
  // heuristic above can capture. Force high tier so the cost-guard prompt
  // surfaces the explicit confirmation card before kicking the job off.
  const toolNames = input.toolNames ?? [];
  const usesTrainingTool = toolNames.some(name =>
    HIGH_COST_TOOL_PREFIXES.some(prefix => name.startsWith(prefix))
  );
  if (usesTrainingTool) {
    tier = "high";
    reasons.push("model_training_workload");
  }

  if (retries > 1) {
    tier = "high";
    reasons.push("retry_over_budget");
  }

  if (tier === "low" && (input.estimatedTokens ?? 0) > 12_000) {
    tier = "medium";
    reasons.push("token_volume");
  }

  const requiresHuman = tier === "medium" || tier === "high";
  const askBeforeAct = requiresHuman;
  const prompt = requiresHuman
    ? "這個流程可能會使用較多生成額度，包含影片生成或多步驟工作流。我需要你確認後再執行。"
    : null;

  return { tier, reasons, requiresHuman, askBeforeAct, prompt };
}

export async function deductCredits(userId: number, amount: number): Promise<void> {
  const cost = Math.max(0, Math.round(amount));
  if (cost <= 0) return;
  await deductUserPoints(userId, cost);
}

export async function reconcileCredits(
  userId: number,
  estimated: number,
  actual: number
): Promise<void> {
  const estimatedRounded = Math.max(0, Math.round(estimated));
  const actualRounded = Math.max(0, Math.round(actual));
  if (actualRounded > estimatedRounded) {
    await deductCredits(userId, actualRounded - estimatedRounded);
    return;
  }
  if (actualRounded < estimatedRounded) {
    await refundUserPoints(userId, estimatedRounded - actualRounded);
  }
}
