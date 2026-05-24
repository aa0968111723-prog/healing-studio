/**
 * trainingTrackService — M 訓練 track：用團隊資料訓練團隊專屬模型
 * ────────────────────────────────────────────────────────────────────────────
 * 從團隊 archive 的「圖片」素材組裝 LoRA 訓練資料集，沿用既有 Replicate 訓練流程
 * （ostris/flux-dev-lora-trainer），產出綁定團隊的 team_shared fine_tuned_model。
 *
 * 安全 / 治理：
 *   - 僅團隊 owner / admin 可發起訓練。
 *   - 只收 team_shared、且 project_data_access_rules 解析層級為 `full_reference`
 *     的素材（訓練比讀取更敏感，要求最高層級才可作訓練來源）。
 *   - 發起時必須勾選「已取得訓練資料使用授權」(consentAcknowledged)。
 *   - credential / 訓練不在無 REPLICATE_API_TOKEN 時進行。
 */

import * as db from "../../db";
import { signWebhookToken } from "../../_core/webhookTokens";
import { buildAndUploadZip } from "../../services/falTrainer";
import { startReplicateTraining } from "../../services/replicateClient";
import type { AccessLevel } from "../contextPackets/contracts";
import type { ProjectDataAccessRule } from "../../../drizzle/schema";

const MIN_TRAINING_IMAGES = 4;
const MAX_TRAINING_IMAGES = 50;

export type TrainableModelType =
  | "image_subject"
  | "style_lora"
  | "scene_lora"
  | "portrait_lora";

export class TrainingTrackError extends Error {
  constructor(
    public readonly reason: "not_found" | "forbidden" | "precondition",
    message?: string
  ) {
    super(message ?? reason);
    this.name = "TrainingTrackError";
  }
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function assertTeamMember(userId: number, teamId: number) {
  const membership = await db.getTeamMembership(teamId, userId);
  if (!membership) {
    throw new TrainingTrackError("forbidden", "你不是此團隊的成員");
  }
  return membership;
}

async function assertTeamAdmin(userId: number, teamId: number) {
  const membership = await assertTeamMember(userId, teamId);
  if (membership.role !== "owner" && membership.role !== "admin") {
    throw new TrainingTrackError(
      "forbidden",
      "只有團隊 owner / admin 可發起團隊模型訓練"
    );
  }
  return membership;
}

/** 解析某素材在此 team/project 的存取層級（忽略連接層級規則）。 */
function resolveLevel(
  rules: ProjectDataAccessRule[],
  materialId: number,
  projectId: number | null
): AccessLevel {
  let best: ProjectDataAccessRule | null = null;
  let bestScore = -1;
  for (const r of rules) {
    if (r.connectionId != null) continue;
    const materialOk = r.materialId === materialId || r.materialId === null;
    const projectOk =
      projectId == null
        ? r.projectId === null
        : r.projectId === projectId || r.projectId === null;
    if (!materialOk || !projectOk) continue;
    const materialScore = r.materialId === materialId ? 2 : 1;
    const projectScore = r.projectId === projectId ? 2 : 1;
    const score = materialScore * 10 + projectScore;
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return best?.accessLevel ?? "summary_only";
}

export interface TrainingImage {
  id: number;
  title: string;
  url: string;
}

/**
 * 蒐集團隊可作訓練來源的圖片：team_shared、mediaType=image、有 fileUrl，且存取
 * 規則解析層級為 full_reference。caller 需先驗成員身分。
 */
export async function collectTeamTrainingImages(args: {
  userId: number;
  teamId: number;
  projectId: number | null;
}): Promise<TrainingImage[]> {
  const materials = await db.listTeachingMaterialsForUser(
    args.userId,
    { mediaType: "image" },
    { teamIds: [args.teamId], only: "team" }
  );
  const rules = await db.listProjectDataAccessRules(args.teamId, args.projectId);

  const images: TrainingImage[] = [];
  for (const m of materials) {
    if (m.teamId !== args.teamId || !m.fileUrl) continue;
    if (resolveLevel(rules, m.id, args.projectId) !== "full_reference") continue;
    images.push({ id: m.id, title: m.title, url: m.fileUrl });
    if (images.length >= MAX_TRAINING_IMAGES) break;
  }
  return images;
}

export async function previewTeamTrainingDataset(
  userId: number,
  args: { teamId: number; projectId: number | null }
): Promise<{ count: number; minRequired: number; sample: Array<{ id: number; title: string }> }> {
  await assertTeamMember(userId, args.teamId);
  const images = await collectTeamTrainingImages({
    userId,
    teamId: args.teamId,
    projectId: args.projectId,
  });
  return {
    count: images.length,
    minRequired: MIN_TRAINING_IMAGES,
    sample: images.slice(0, 8).map(i => ({ id: i.id, title: i.title })),
  };
}

export interface StartTeamTrainingInput {
  teamId: number;
  projectId: number | null;
  modelName: string;
  triggerWord: string;
  modelType: TrainableModelType;
  steps?: number;
  learningRate?: number;
  baseModel?: string;
  consentAcknowledged: boolean;
}

export async function startTeamModelTraining(
  userId: number,
  input: StartTeamTrainingInput
): Promise<{ modelId: number; status: string; imageCount: number }> {
  await assertTeamAdmin(userId, input.teamId);

  if (!input.consentAcknowledged) {
    throw new TrainingTrackError(
      "precondition",
      "請先確認已取得訓練資料的使用授權"
    );
  }
  if (!process.env.REPLICATE_API_TOKEN) {
    throw new TrainingTrackError(
      "precondition",
      "REPLICATE_API_TOKEN 未設定，無法發起訓練"
    );
  }

  const images = await collectTeamTrainingImages({
    userId,
    teamId: input.teamId,
    projectId: input.projectId,
  });
  if (images.length < MIN_TRAINING_IMAGES) {
    throw new TrainingTrackError(
      "precondition",
      `可作訓練來源的圖片不足（需至少 ${MIN_TRAINING_IMAGES} 張，目前 ${images.length} 張）。` +
        `請將更多 team_shared 圖片的存取層級設為「完整引用」。`
    );
  }
  const imageUrls = images.map(i => i.url);
  const steps = input.steps ?? 1000;
  const learningRate = input.learningRate ?? 0.0004;

  const modelId = await db.createFineTunedModel({
    userId,
    teamId: input.teamId,
    name: input.modelName,
    modelType: input.modelType,
    status: "pending",
    trainingEngine: "replicate",
    visibility: "team_shared",
    configJson: {
      triggerWord: input.triggerWord,
      steps,
      learningRate,
    },
  });

  try {
    const zipUrl = await buildAndUploadZip(imageUrls, userId, modelId, "replicate");
    const slug = input.modelName
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50);
    const destination = `user-${userId}/${slug || `team-lora-${modelId}`}`;
    const siteUrl = process.env.VITE_SITE_URL?.trim();
    const webhookToken = signWebhookToken("replicate", modelId);
    const webhook = siteUrl
      ? `${siteUrl}/api/webhook/replicate?modelId=${modelId}${webhookToken ? `&token=${webhookToken}` : ""}`
      : undefined;

    const { trainingId, status } = await startReplicateTraining({
      zipUrl,
      triggerWord: input.triggerWord,
      steps,
      learningRate,
      baseModel: input.baseModel,
      destination,
      webhook,
    });

    await db.updateFineTunedModel(modelId, {
      status: "training",
      replicatePredictionId: trainingId,
      configJson: {
        triggerWord: input.triggerWord,
        steps,
        learningRate,
        zipUrl,
        predictionId: trainingId,
        submittedAt: Date.now(),
      },
    });

    return { modelId, status, imageCount: images.length };
  } catch (err) {
    await db.updateFineTunedModel(modelId, { status: "failed" }).catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    throw new TrainingTrackError("precondition", `團隊模型訓練啟動失敗：${msg}`);
  }
}

export interface TeamModelView {
  id: number;
  name: string;
  modelType: string;
  status: "pending" | "training" | "ready" | "failed";
  triggerWord: string | null;
  teamId: number | null;
  createdAt: string;
}

export async function listTeamModels(
  userId: number,
  teamId: number
): Promise<TeamModelView[]> {
  await assertTeamMember(userId, teamId);
  const rows = await db.getFineTunedModelsByTeam(teamId);
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    modelType: r.modelType,
    status: r.status,
    triggerWord: (r.configJson as { triggerWord?: string } | null)?.triggerWord ?? null,
    teamId: r.teamId ?? null,
    createdAt: toIso(r.createdAt) ?? new Date(0).toISOString(),
  }));
}
