/**
 * server/services/spiritTools/trainingSpecialistTools.ts
 *
 * 練練 (training-specialist) 的真實工具集 — 把 LoRA 訓練精靈從
 * 「system prompt 嘴砲 + 一支 studio.trainLora」升級成「會主動查使用者
 * 已訓模型、判斷資料集是否夠、推薦訓練參數、估時間 / 點數」的 AI agent。
 *
 * 之前的問題：
 *   - trainingSpecialist.train / getStatus 是錯誤 stub，呼叫只會丟
 *     「請改用 /models 頁」例外，根本沒接 DB（modelTrainer.ts 是空殼）。
 *   - 三支 trainingSpecialist.* tools 沒在 shared/global-agent-tools.ts
 *     註冊，LLM 看不到，永遠不會呼叫。
 *   - 練練只有 studio.trainLora 一支真工具，沒有任何 sensing 能力。
 *
 * 本檔提供六個工具，五個唯讀 + 一個唯計算，全部走真 DB / modelPricing：
 *   - listMyModels(userId)          — 列出使用者所有 fineTunedModels（狀態 + 觸發詞）
 *   - getModelStatus(userId, id)    — 查單一模型即時狀態 + 最新訓練任務進度
 *   - recommendParams(...)          — 依 modelType + 資料量推薦訓練參數
 *   - analyzeDataset(...)           — 評估資料集是否夠 / 給補件建議
 *   - estimateTraining(...)         — 估算訓練時間（分鐘）+ 預估點數
 *   - getTips(modelType?)           — 依訓練類別給針對性 tips（不再是固定字串）
 *
 * 真正啟動訓練仍走 studio.trainLora（在 agentToolExecutor.ts:5095
 * 的 dispatchTrainingTool，已有完整 fineTunedModels + backgroundJobs +
 * fal/replicate 背景任務 pipeline）。練練呼這六支 sensing 工具後再請
 * 使用者確認 → 呼叫 studio.trainLora 真正開訓。
 */

import { logger } from "../../_core/logger";
import {
  getFineTunedModelsByUser,
  getFineTunedModel,
  getTrainingJobsByModelId,
} from "../../db";
import { estimatePoints, getModelPricing } from "../modelPricing";

// ─── 共用：modelType 中文標籤 + 對應的 fal 訓練 modelId ─────────────────────

type TrainingModelType =
  | "image_subject"
  | "voice_clone"
  | "style_lora"
  | "scene_lora"
  | "video_lora"
  | "portrait_lora";

const TRAINING_MODEL_TYPE_LABEL: Record<TrainingModelType, string> = {
  image_subject: "角色 LoRA",
  voice_clone: "聲音克隆",
  style_lora: "風格 LoRA",
  scene_lora: "場景 LoRA",
  video_lora: "影片 LoRA",
  portrait_lora: "人像 LoRA",
};

// 對齊 server/services/falTrainer.ts:51 resolveFalTrainingModel —
// 不直接 import 是因為這個檔走 server 邊但 falTrainer 仍會帶進
// fal-client 等 heavy deps；複製這層映射常數重量為 0。
const TRAINING_MODEL_TO_FAL_ID: Record<TrainingModelType, string> = {
  portrait_lora: "fal-ai/flux-lora-portrait-trainer",
  style_lora: "fal-ai/flux-lora-fast-training",
  scene_lora: "fal-ai/flux-lora-fast-training",
  video_lora: "fal-ai/hunyuan-video-lora-training",
  image_subject: "fal-ai/flux-lora-fast-training",
  // voice_clone 不走 fal LoRA 訓練器（走 elevenlabs / fal voice clone）；
  // 算點數時退回標準 voice_clone 估法。
  voice_clone: "fal-ai/flux-lora-fast-training",
};

const isTrainingModelType = (v: unknown): v is TrainingModelType =>
  typeof v === "string" && v in TRAINING_MODEL_TYPE_LABEL;

// ─── 1. listMyModels — 列出使用者所有訓練過的模型 ──────────────────────────

export interface ListMyModelsResult {
  total: number;
  ready: number;
  training: number;
  failed: number;
  pending: number;
  models: Array<{
    modelId: number;
    name: string;
    modelType: string;
    status: string;
    triggerWord: string | null;
    trainedLoraUrl: string | null;
    usageCount: number;
    createdAt: string;
  }>;
}

/**
 * 列出使用者所有訓練過 / 訓練中的模型，含計數摘要。
 * 唯讀工具：練練看完即時狀態後才能回答「我訓過哪些？」「還有訓壞的嗎？」。
 */
export async function listMyModels(userId: number): Promise<ListMyModelsResult> {
  try {
    const rows = await getFineTunedModelsByUser(userId);
    const models = rows.map(r => {
      const cfg = (r.configJson ?? {}) as Record<string, unknown>;
      const triggerWord =
        typeof cfg.triggerWord === "string" && cfg.triggerWord.trim()
          ? cfg.triggerWord.trim()
          : null;
      return {
        modelId: r.id,
        name: r.name,
        modelType: r.modelType,
        status: r.status,
        triggerWord,
        trainedLoraUrl: r.trainedLoraUrl ?? null,
        usageCount: Number(r.usageCount ?? 0),
        createdAt: r.createdAt instanceof Date
          ? r.createdAt.toISOString()
          : String(r.createdAt),
      };
    });
    return {
      total: models.length,
      ready: models.filter(m => m.status === "ready").length,
      training: models.filter(m => m.status === "training").length,
      failed: models.filter(m => m.status === "failed").length,
      pending: models.filter(m => m.status === "pending").length,
      models,
    };
  } catch (err) {
    logger.warn("[TrainingSpecialistTools] listMyModels failed", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      total: 0,
      ready: 0,
      training: 0,
      failed: 0,
      pending: 0,
      models: [],
    };
  }
}

// ─── 2. getModelStatus — 單一模型的即時狀態 + 最新訓練任務 ─────────────────

export interface GetModelStatusResult {
  ok: boolean;
  /** 找不到模型 / 不屬於此 user 時為 true */
  notFound: boolean;
  modelId: number;
  name: string | null;
  modelType: string | null;
  status: string | null;
  trainedLoraUrl: string | null;
  triggerWord: string | null;
  trainingEngine: string | null;
  /** 最新一筆訓練任務的進度資訊（用以判斷「訓到哪了」） */
  latestJob: {
    jobId: number;
    status: string;
    progress: number;
    progressMessage: string | null;
    /** 任務建立時間 — 等價於「開訓時間」（backgroundJobs 沒有 startedAt 欄位） */
    queuedAt: string | null;
    /** 任務最後更新時間 — completed/failed 後等價於完成時間 */
    updatedAt: string | null;
  } | null;
  /** 中文短摘要：給 LLM 直接讀來回覆使用者 */
  summary: string;
}

/**
 * 給單一模型的即時狀態 — 把 fineTunedModels.status 跟最新的
 * backgroundJobs (jobType="model_training") 進度合在一起回。
 *
 * 若 modelId 不屬於這位 user → notFound=true（避免跨 user 洩漏資料）。
 */
export async function getModelStatus(input: {
  userId: number;
  modelId: number;
}): Promise<GetModelStatusResult> {
  try {
    const model = await getFineTunedModel(input.modelId);
    if (!model || model.userId !== input.userId) {
      return {
        ok: false,
        notFound: true,
        modelId: input.modelId,
        name: null,
        modelType: null,
        status: null,
        trainedLoraUrl: null,
        triggerWord: null,
        trainingEngine: null,
        latestJob: null,
        summary: `找不到模型 ${input.modelId}（可能不存在或不屬於你）`,
      };
    }

    const cfg = (model.configJson ?? {}) as Record<string, unknown>;
    const triggerWord =
      typeof cfg.triggerWord === "string" && cfg.triggerWord.trim()
        ? cfg.triggerWord.trim()
        : null;

    let latestJob: GetModelStatusResult["latestJob"] = null;
    try {
      const jobs = await getTrainingJobsByModelId(input.modelId);
      const j = jobs[0];
      if (j) {
        latestJob = {
          jobId: j.id,
          status: j.status,
          progress: Number(j.progress ?? 0),
          progressMessage: j.progressMessage ?? null,
          queuedAt: j.createdAt instanceof Date
            ? j.createdAt.toISOString()
            : j.createdAt
              ? String(j.createdAt)
              : null,
          updatedAt: j.updatedAt instanceof Date
            ? j.updatedAt.toISOString()
            : j.updatedAt
              ? String(j.updatedAt)
              : null,
        };
      }
    } catch (innerErr) {
      logger.warn("[TrainingSpecialistTools] training-job lookup failed", {
        modelId: input.modelId,
        error: innerErr instanceof Error ? innerErr.message : String(innerErr),
      });
    }

    const summary = formatModelStatusSummary(model.status, model.name, latestJob);

    return {
      ok: true,
      notFound: false,
      modelId: model.id,
      name: model.name,
      modelType: model.modelType,
      status: model.status,
      trainedLoraUrl: model.trainedLoraUrl ?? null,
      triggerWord,
      trainingEngine: model.trainingEngine ?? null,
      latestJob,
      summary,
    };
  } catch (err) {
    logger.warn("[TrainingSpecialistTools] getModelStatus failed", {
      userId: input.userId,
      modelId: input.modelId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      notFound: false,
      modelId: input.modelId,
      name: null,
      modelType: null,
      status: null,
      trainedLoraUrl: null,
      triggerWord: null,
      trainingEngine: null,
      latestJob: null,
      summary: `查詢模型 ${input.modelId} 失敗：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function formatModelStatusSummary(
  status: string,
  name: string,
  latestJob: GetModelStatusResult["latestJob"]
): string {
  if (status === "ready") return `${name} 已訓練完成，可以拿去 /studio 用了`;
  if (status === "failed") {
    const reason = latestJob?.progressMessage ?? "未知原因";
    return `${name} 訓練失敗（${reason}）— 可重新訓練`;
  }
  if (status === "training") {
    const pct = latestJob?.progress ?? 0;
    const note = latestJob?.progressMessage ?? "訓練中";
    return `${name} 訓練中（進度 ${pct}%）— ${note}`;
  }
  return `${name} 狀態：${status}`;
}

// ─── 3. recommendParams — 依 modelType + 資料量推薦訓練參數 ─────────────────

export interface RecommendParamsInput {
  modelType: TrainingModelType;
  /** 圖片張數（image-based LoRA 用） */
  imageCount?: number;
  /** 影片片段數（video_lora 用） */
  videoCount?: number;
  /** 使用者傾向：speed=快出結果、quality=高品質、balanced=平衡（預設） */
  preference?: "speed" | "quality" | "balanced";
}

export interface RecommendParamsResult {
  modelType: TrainingModelType;
  modelTypeLabel: string;
  /** 建議參數（直接餵給 studio.trainLora 的 args） */
  recommended: {
    epochs: number;
    learningRate: number;
    batchSize: number;
    isStyle: boolean;
  };
  /** 估算的 effectiveSteps（agentToolExecutor.ts:5164 的算法） */
  estimatedSteps: number;
  /** 資料量評語（足夠 / 偏少 / 不夠） */
  datasetAdequacy: "sufficient" | "marginal" | "insufficient";
  /** 推薦的觸發詞範例（不是強制；使用者可改） */
  suggestedTriggerWord: string;
  /** 給使用者看的逐項理由 */
  reasoning: string[];
}

/**
 * 依「訓練類別 × 資料量 × 偏好」推薦訓練參數。
 *
 * 預設來源：shared/orb-agent-roles.ts:1335 練練系統提示已寫過的 baseline
 *   - 角色 LoRA：rank=16、lr=1e-4、step≈1500、batch=1（圖片 15-20）
 *   - 風格 LoRA：rank=32、step=2000-2500（30+ 圖）
 *   - 影片 LoRA：10-20 段短片
 * 這支工具把上面字面值轉成函式 — 加上資料量足夠性判斷 + 偏好調整。
 */
export function recommendParams(input: RecommendParamsInput): RecommendParamsResult {
  const dataCount = (input.imageCount ?? 0) + (input.videoCount ?? 0);
  const pref = input.preference ?? "balanced";
  const reasoning: string[] = [];

  // ── 1. 依 modelType 設 baseline ────────────────────────────────────────
  let epochs: number;
  let learningRate: number;
  let batchSize: number;
  let isStyle = false;
  let minRecommendedData = 15;

  switch (input.modelType) {
    case "style_lora":
      epochs = 25; // step ≈ 2500（agentToolExecutor STEPS_PER_EPOCH=100）
      learningRate = 0.0001;
      batchSize = 1;
      isStyle = true;
      minRecommendedData = 30;
      reasoning.push("風格 LoRA：建議 30+ 張同調性作品，rank 偏高、step 拉到 2500");
      break;
    case "scene_lora":
      epochs = 20;
      learningRate = 0.0001;
      batchSize = 1;
      isStyle = true;
      minRecommendedData = 20;
      reasoning.push("場景 LoRA：建議 20+ 張同類場景，與風格 LoRA 類似但 step 稍降");
      break;
    case "video_lora":
      epochs = 15; // step ≈ 1500
      learningRate = 0.00008;
      batchSize = 1;
      minRecommendedData = 10;
      reasoning.push("影片 LoRA：10-20 段同一動作 / 鏡位的短片；學習率偏低避免過擬合");
      break;
    case "portrait_lora":
      epochs = 18;
      learningRate = 0.0001;
      batchSize = 1;
      minRecommendedData = 15;
      reasoning.push("人像 LoRA：15-20 張多角度多表情，避免同一姿勢重複");
      break;
    case "voice_clone":
      epochs = 10;
      learningRate = 0.0001;
      batchSize = 1;
      minRecommendedData = 1; // 1 段 30s+ 純人聲樣本即可
      reasoning.push("聲音克隆：需 30s+ 純人聲、安靜背景、單一說話者");
      break;
    case "image_subject":
    default:
      epochs = 15; // step ≈ 1500
      learningRate = 0.0001;
      batchSize = 1;
      minRecommendedData = 15;
      reasoning.push("角色 LoRA：15-20 張多角度多表情、不同光、避免同姿勢重複");
      break;
  }

  // ── 2. 偏好調整 ────────────────────────────────────────────────────────
  if (pref === "speed") {
    epochs = Math.max(8, Math.round(epochs * 0.6));
    reasoning.push(`speed 偏好：epochs 降到 ${epochs}（≈ ${epochs * 100} step），省時間但品質可能略降`);
  } else if (pref === "quality") {
    epochs = Math.round(epochs * 1.3);
    reasoning.push(`quality 偏好：epochs 拉到 ${epochs}（≈ ${epochs * 100} step），訓更久換更好的細節`);
  }

  // ── 3. 資料量足夠性 ────────────────────────────────────────────────────
  let datasetAdequacy: RecommendParamsResult["datasetAdequacy"] = "sufficient";
  if (dataCount === 0) {
    datasetAdequacy = "insufficient";
    reasoning.push(`尚未提供訓練資料 — ${TRAINING_MODEL_TYPE_LABEL[input.modelType]} 建議至少 ${minRecommendedData} 張/段`);
  } else if (dataCount < Math.floor(minRecommendedData * 0.6)) {
    datasetAdequacy = "insufficient";
    reasoning.push(`資料量 ${dataCount} 不足（建議 ${minRecommendedData}+）— 強烈建議補件，否則模型容易 overfit`);
  } else if (dataCount < minRecommendedData) {
    datasetAdequacy = "marginal";
    reasoning.push(`資料量 ${dataCount} 接近下限（建議 ${minRecommendedData}+）— 可以開訓，但補幾張更穩`);
  } else {
    reasoning.push(`資料量 ${dataCount} ≥ ${minRecommendedData}，資料充足`);
  }

  // ── 4. effectiveSteps（對齊 agentToolExecutor 的算法） ──────────────────
  const STEPS_PER_EPOCH = 100;
  const MIN_STEPS = 200;
  const MAX_STEPS = 4_000;
  const estimatedSteps = Math.min(
    Math.max(epochs * STEPS_PER_EPOCH, MIN_STEPS),
    MAX_STEPS
  );

  // ── 5. 觸發詞範例 ──────────────────────────────────────────────────────
  // 預設用 modelType 縮寫 + 隨機提示，例如 "mychar_lora"、"mystyle_lora"
  const triggerStub = input.modelType.replace(/_lora|_subject|_clone/g, "").slice(0, 6);
  const suggestedTriggerWord = `${triggerStub}_lora`;

  return {
    modelType: input.modelType,
    modelTypeLabel: TRAINING_MODEL_TYPE_LABEL[input.modelType],
    recommended: {
      epochs,
      learningRate,
      batchSize,
      isStyle,
    },
    estimatedSteps,
    datasetAdequacy,
    suggestedTriggerWord,
    reasoning,
  };
}

// ─── 4. analyzeDataset — 評估資料集是否夠 + 風險與改進建議 ─────────────────

export interface AnalyzeDatasetInput {
  modelType: TrainingModelType;
  imageCount?: number;
  videoCount?: number;
}

export interface AnalyzeDatasetResult {
  modelType: TrainingModelType;
  modelTypeLabel: string;
  totalCount: number;
  adequacy: "sufficient" | "marginal" | "insufficient";
  /** 中文一句話結論 */
  verdict: string;
  /** 1-3 條補強建議；資料夠時為空 */
  recommendations: string[];
  /** 練練該採取的下一步動作（給 LLM 用） */
  nextStep: "request-more-data" | "request-trigger-word" | "ready-to-train";
}

/**
 * 不需要真讀檔，只依「張數 vs modelType 最低需求」做判斷 — 真讀檔的
 * 多模態分析應走 image-specialist / quality-coach 工具。這支設計成可
 * 在不調 LLM 的情況下立即回答「我的 18 張夠不夠？」。
 */
export function analyzeDataset(input: AnalyzeDatasetInput): AnalyzeDatasetResult {
  const total = (input.imageCount ?? 0) + (input.videoCount ?? 0);
  const label = TRAINING_MODEL_TYPE_LABEL[input.modelType];

  // 同 recommendParams 的 minRecommendedData
  const minMap: Record<TrainingModelType, number> = {
    image_subject: 15,
    portrait_lora: 15,
    style_lora: 30,
    scene_lora: 20,
    video_lora: 10,
    voice_clone: 1,
  };
  const min = minMap[input.modelType];
  const recommendations: string[] = [];

  let adequacy: AnalyzeDatasetResult["adequacy"];
  let verdict: string;
  let nextStep: AnalyzeDatasetResult["nextStep"];

  if (total === 0) {
    adequacy = "insufficient";
    verdict = `還沒有任何訓練素材 — ${label} 至少需要 ${min} 張/段`;
    recommendations.push(`先上傳 ${min}+ 張/段參考素材到 /models 或附在訊息裡`);
    if (input.modelType === "image_subject" || input.modelType === "portrait_lora") {
      recommendations.push("多角度（正面 / 側面 / 3/4 view）、多表情、不同光線、避免同一姿勢重複");
    }
    if (input.modelType === "style_lora" || input.modelType === "scene_lora") {
      recommendations.push("素材整體風格 / 色調要一致，主題 / 構圖可變化");
    }
    if (input.modelType === "voice_clone") {
      recommendations.push("一段 30s+ 純人聲、安靜背景、單一說話者");
    }
    nextStep = "request-more-data";
  } else if (total < Math.floor(min * 0.6)) {
    adequacy = "insufficient";
    verdict = `只有 ${total} 張/段，遠低於 ${label} 的 ${min}+ 標準 — 直接開訓很容易過擬合`;
    recommendations.push(`先補到至少 ${min} 張/段；少於 ${Math.floor(min * 0.6)} 不建議啟動`);
    nextStep = "request-more-data";
  } else if (total < min) {
    adequacy = "marginal";
    verdict = `有 ${total} 張/段，接近 ${label} 的 ${min}+ 下限 — 可以訓但補幾張更穩`;
    recommendations.push(`補到 ${min}+ 張/段最理想`);
    if (input.modelType !== "voice_clone") {
      recommendations.push("確認資料覆蓋角度 / 表情 / 光線多樣性，避免重複");
    }
    nextStep = "ready-to-train";
  } else {
    adequacy = "sufficient";
    verdict = `${total} 張/段 ≥ ${label} 建議的 ${min}+，資料充足，可以開訓`;
    nextStep = "request-trigger-word";
  }

  return {
    modelType: input.modelType,
    modelTypeLabel: label,
    totalCount: total,
    adequacy,
    verdict,
    recommendations,
    nextStep,
  };
}

// ─── 5. estimateTraining — 估算訓練時間 + 點數 ──────────────────────────────

export interface EstimateTrainingInput {
  modelType: TrainingModelType;
  /** 預期的訓練步數；不傳則用 recommendParams 預設 */
  steps?: number;
  /** 強制覆寫 fal modelId（少見） */
  falModelId?: string;
}

export interface EstimateTrainingResult {
  modelType: TrainingModelType;
  modelTypeLabel: string;
  /** 走哪一個 fal 訓練 model */
  resolvedFalModelId: string;
  /** 模型本身的 label / tier（從 modelPricing 抓） */
  modelLabel: string | null;
  tier: string | null;
  /** 估算 step 數 */
  steps: number;
  /** 估算點數（已套 minPoints / maxPoints clamp） */
  estimatedPoints: number;
  /** 估算 USD 等值（modelPricing baseCostUsd × ratio） */
  estimatedUsd: number | null;
  /** 估算耗時（分鐘）— 走「每 100 step 約 1-2 分鐘」的經驗值 */
  estimatedMinutes: { min: number; max: number };
  /** 中文逐項說明 */
  breakdown: string;
}

/**
 * 估算單次訓練的「點數 + 時間」。
 * 點數走 modelPricing.estimatePoints（含 pointsPerStep × steps 計費）。
 * 時間走經驗值：image-based 每 100 step 約 0.8-1.5 分鐘；
 *              video-based 每 100 step 約 2-3 分鐘。
 */
export function estimateTraining(input: EstimateTrainingInput): EstimateTrainingResult {
  const falModelId =
    (input.falModelId && input.falModelId.trim()) ||
    TRAINING_MODEL_TO_FAL_ID[input.modelType];

  // 沒傳 steps → 用 recommendParams 預設
  const steps = input.steps ?? recommendParams({ modelType: input.modelType }).estimatedSteps;

  const pricing = getModelPricing(falModelId);
  const est = estimatePoints(falModelId, { trainingSteps: steps });

  // 時間估算：image-based 0.8-1.5 min/100 step；video-based 2-3 min/100 step
  const isVideo = input.modelType === "video_lora";
  const minPer100 = isVideo ? 2.0 : 0.8;
  const maxPer100 = isVideo ? 3.0 : 1.5;
  const estimatedMinutes = {
    min: Math.round((steps / 100) * minPer100),
    max: Math.round((steps / 100) * maxPer100),
  };

  // USD：modelPricing 的 baseCostUsd 對應 basePoints；按比例 scale
  let estimatedUsd: number | null = null;
  if (pricing) {
    const ratio = est.totalPoints / Math.max(1, pricing.basePoints);
    estimatedUsd = Math.round(pricing.baseCostUsd * ratio * 100) / 100;
  }

  return {
    modelType: input.modelType,
    modelTypeLabel: TRAINING_MODEL_TYPE_LABEL[input.modelType],
    resolvedFalModelId: falModelId,
    modelLabel: pricing?.label ?? null,
    tier: pricing?.tier ?? null,
    steps,
    estimatedPoints: est.totalPoints,
    estimatedUsd,
    estimatedMinutes,
    breakdown: est.breakdown,
  };
}

// ─── 6. getTips — 依 modelType 給針對性 tips ────────────────────────────────

export interface GetTipsInput {
  modelType?: TrainingModelType;
}

export interface GetTipsResult {
  modelType: TrainingModelType | "general";
  tips: string[];
}

/**
 * 給訓練相關 tips。傳 modelType 會挑出該類別專屬建議；不傳走通用清單。
 * 之前是固定 8 條字串，現在依類別給針對性內容。
 */
export function getTips(input: GetTipsInput = {}): GetTipsResult {
  if (!input.modelType) {
    return {
      modelType: "general",
      tips: [
        "訓練前先想清楚：要訓的是「角色」「風格」還是「影片動作」？三種資料準備邏輯完全不同",
        "圖片解析度建議 512×512 或更高；avoid 重複 / 模糊 / 浮水印",
        "訓練前用 analyzeDataset 確認資料量；不夠就先補不要硬訓",
        "觸發詞（trigger word）要選獨特的英數組合，避免被自然語料蓋掉（例如 mychar_v1）",
        "LoRA 訓練 5-30 分鐘不等；訓完用 listMyModels 查 status='ready'",
        "訓練失敗最常見原因：資料集過小、URL 抓不到、解析度過低；看 backgroundJobs.progressMessage",
        "估點數前先呼叫 estimateTraining，避免 200 點起跳的訓練吃掉預算還訓不出來",
        "訓完先請圖圖出第一張示範 → 再請品品評估資料集是否要補 → 再 retrain",
      ],
    };
  }
  switch (input.modelType) {
    case "image_subject":
      return {
        modelType: "image_subject",
        tips: [
          "15-20 張角色圖；多角度（正面 / 側面 / 3/4 view）+ 多表情",
          "服裝 / 髮型 / 配件如果想固定，整套資料統一；想可變則混搭",
          "避免同一姿勢重複（會 overfit 到那個姿勢）",
          "背景簡單比複雜好（讓模型 focus 在角色本身）",
          "rank=16、lr=1e-4、step≈1500、batch=1 是穩定起點",
        ],
      };
    case "portrait_lora":
      return {
        modelType: "portrait_lora",
        tips: [
          "走 fal-ai/flux-lora-portrait-trainer，比一般 LoRA 更擅長人像細節",
          "15-20 張清晰人臉照（不模糊、無大角度遮擋）",
          "多角度 + 多表情 + 多光線；避免全部濾鏡同款",
          "如果有 ID 用途敏感性，記得讓使用者簽 modelTrainingConsent",
        ],
      };
    case "style_lora":
      return {
        modelType: "style_lora",
        tips: [
          "30+ 張同調性作品；主題可變，「畫風 / 用色 / 線條」要一致",
          "isStyle=true 啟用 + rank=32 + step≈2500",
          "如果是水彩 / 油畫風，避免混入像素 / 卡通畫；模型會學歪",
          "觸發詞建議帶 style 字根，例如 inkwash_style、retro_style",
        ],
      };
    case "scene_lora":
      return {
        modelType: "scene_lora",
        tips: [
          "20+ 張同類場景；地點 / 天氣 / 光照可變化，主體 / 構圖風格要一致",
          "適合「賽博龐克街道」「日式昭和咖啡廳」這種有強氛圍的場景",
          "step≈2000、isStyle=true，與風格 LoRA 類似但稍輕",
        ],
      };
    case "video_lora":
      return {
        modelType: "video_lora",
        tips: [
          "10-20 段同一動作 / 鏡位的短片（3-5s 最佳）",
          "鏡頭運動如果是訓重點（推 / 拉 / 軌道），整批都要該類運鏡",
          "走 fal-ai/hunyuan-video-lora-training；訓練比圖像 LoRA 慢 2-3 倍",
          "學習率調低（8e-5）避免動作模糊化",
        ],
      };
    case "voice_clone":
      return {
        modelType: "voice_clone",
        tips: [
          "30s+ 純人聲樣本（最好 1-2 分鐘）；安靜環境、無 BGM",
          "單一說話者；混入多人會炸",
          "建議走 fal voice clone / elevenlabs 而非 LoRA 訓練器",
          "克隆前用 designVoice 先試一個合成聲，不夠像再克隆",
        ],
      };
    default:
      return { modelType: "general", tips: [] };
  }
}

// ─── 共用 type guard 匯出（agentToolExecutor 用） ─────────────────────────

export { isTrainingModelType };
export type { TrainingModelType };
