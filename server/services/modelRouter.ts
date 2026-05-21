import { MODEL_CAPABILITY_REGISTRY, type ModelProvider, type ModelTaskKind } from "../../shared/model-capability-registry";

export type ModelExecutionRequest = { taskId: string; taskType: ModelTaskKind; modelId: string; provider: ModelProvider; prompt?: string; negativePrompt?: string; inputUrls?: string[]; payload: Record<string, unknown>; dryRun?: boolean; };
export type ModelExecutionResult = { ok: boolean; taskId: string; status: "dry_run" | "queued" | "completed" | "failed"; resultUrls?: string[]; providerJobId?: string; error?: string; debug?: Record<string, unknown>; };

function providerEnvKeys(provider: ModelProvider): string[] {
  if (provider === "fal") return ["FAL_KEY"];
  if (provider === "replicate") return ["REPLICATE_API_TOKEN"];
  if (provider === "openai") return ["OPENAI_API_KEY"];
  if (provider === "elevenlabs") return ["ELEVENLABS_API_KEY"];
  if (provider === "suno") return ["SUNO_API_KEY"];
  return [];
}

export async function executeModelTask(request: ModelExecutionRequest): Promise<ModelExecutionResult> {
  const model = MODEL_CAPABILITY_REGISTRY.find(m => m.id === request.modelId);
  if (!model) return { ok: false, taskId: request.taskId, status: "failed", error: `model_not_found:${request.modelId}` };
  const envKeys = model.envKeys?.length ? model.envKeys : providerEnvKeys(request.provider);
  const missing = envKeys.filter(k => !process.env[k]);
  if (missing.length) return { ok: false, taskId: request.taskId, status: "failed", error: `missing_provider_keys:${missing.join(",")}` };
  if (request.dryRun) return { ok: true, taskId: request.taskId, status: "dry_run", debug: { provider: request.provider, modelId: request.modelId, taskType: request.taskType, payloadKeys: Object.keys(request.payload) } };
  return { ok: false, taskId: request.taskId, status: "failed", error: "內建模型批次執行尚未啟用，請先使用 dry-run 或代理 workflow" };
}
