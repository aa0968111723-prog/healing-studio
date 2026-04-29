import Replicate from "replicate";

/**
 * Cached Replicate SDK client keyed by auth token.
 * Avoids constructing a new Replicate instance on every API call
 * (each construction re-parses config and sets up HTTP internals).
 */
const clientCache = new Map<string, Replicate>();

export function getReplicateClient(token?: string): Replicate {
  const auth = token || process.env.REPLICATE_API_TOKEN || "";
  if (!auth) {
    throw new Error(
      "[ReplicateClient] No API token provided and REPLICATE_API_TOKEN is not set"
    );
  }

  let client = clientCache.get(auth);
  if (!client) {
    client = new Replicate({ auth });
    clientCache.set(auth, client);
  }
  return client;
}

// ═══════════════════════════════════════════════════════════════════════════
// LoRA Training — ostris/flux-dev-lora-trainer (預設) 與其他相容 trainer
// ═══════════════════════════════════════════════════════════════════════════

export interface ReplicateTrainingInput {
  zipUrl: string;
  triggerWord: string;
  steps: number;
  learningRate: number;
  /** Replicate 上的 trainer，例如 "ostris/flux-dev-lora-trainer" */
  baseModel?: string;
  /** 訓練後產生的目標模型路徑 "owner/model-slug"。會自動建立（若不存在） */
  destination: string;
  /**
   * 訓練完成時主動 POST 回呼到此 URL（Replicate 標準 webhook）。
   * 不帶則僅能用 getReplicateTrainingStatus 輪詢。
   */
  webhook?: string;
}

export interface ReplicateTrainingResult {
  trainingId: string;
  status: string;
}

async function ensureDestinationModel(
  client: Replicate,
  destination: string
): Promise<void> {
  const [owner, name] = destination.split("/");
  if (!owner || !name) {
    throw new Error(
      `[ReplicateClient] Invalid destination format "${destination}", expected "owner/name"`
    );
  }
  try {
    await client.models.get(owner, name);
  } catch {
    // 不存在則建立
    await client.models.create(owner, name, {
      visibility: "private",
      hardware: "gpu-t4",
    });
  }
}

/**
 * 啟動 Replicate LoRA 訓練（async，立即回 trainingId）。
 * Replicate 端會在背景執行，需用 getReplicateTrainingStatus 輪詢。
 */
export async function startReplicateTraining(
  input: ReplicateTrainingInput
): Promise<ReplicateTrainingResult> {
  const client = getReplicateClient();
  const baseModel = input.baseModel ?? "ostris/flux-dev-lora-trainer";
  const [owner, name] = baseModel.split("/");
  if (!owner || !name) {
    throw new Error(
      `[ReplicateClient] Invalid baseModel "${baseModel}", expected "owner/name"`
    );
  }

  await ensureDestinationModel(client, input.destination);

  const versionsPage = (await client.models.versions.list(owner, name)) as
    | { results?: Array<{ id: string }> }
    | Array<{ id: string }>;
  const versionsArr: Array<{ id: string }> = Array.isArray(versionsPage)
    ? versionsPage
    : (versionsPage.results ?? []);
  const latest = versionsArr[0]?.id;
  if (!latest) {
    throw new Error(
      `[ReplicateClient] No versions found for trainer ${baseModel}`
    );
  }

  const createOptions: Record<string, unknown> = {
    destination: input.destination as `${string}/${string}`,
    input: {
      input_images: input.zipUrl,
      trigger_word: input.triggerWord,
      steps: input.steps,
      learning_rate: input.learningRate,
    },
  };
  if (input.webhook) {
    createOptions.webhook = input.webhook;
    createOptions.webhook_events_filter = ["completed"];
  }

  const training = await client.trainings.create(
    owner,
    name,
    latest,
    createOptions as Parameters<typeof client.trainings.create>[3]
  );

  return {
    trainingId: training.id,
    status: training.status,
  };
}

/**
 * 查詢 Replicate 訓練狀態。
 *
 * status 可能為：starting | processing | succeeded | failed | canceled
 */
export async function getReplicateTrainingStatus(
  trainingId: string
): Promise<{
  id: string;
  status: string;
  output: unknown;
  error: unknown;
}> {
  const client = getReplicateClient();
  const t = await client.trainings.get(trainingId);
  return {
    id: t.id,
    status: t.status,
    output: (t as unknown as { output?: unknown }).output ?? null,
    error: (t as unknown as { error?: unknown }).error ?? null,
  };
}
