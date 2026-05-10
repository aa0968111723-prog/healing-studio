/**
 * spiritDispatcher.ts — 「精靈直接呼叫 fal.ai 模型」的入口
 *
 * 把 shared/orb-agent-roles.ts 的精靈授權白名單與 server/services/falDispatcher.ts
 * 的真實 fal.ai 呼叫接通：每位精靈只能呼叫自己分類內的模型，呼叫真的會打 API、
 * 真的會扣點、真的會回傳生成結果。
 *
 * 設計：
 *   - 入口只有一個 `invokeSpiritModel({ spirit, modelId, ... })`
 *   - 模型 category 從 fal 目錄查表，不要呼叫端自己決定
 *   - 授權失敗 → 直接回 FalDispatchResult { success: false, error }，不打 API
 *   - 授權通過 → 走 dispatchFalTask（已含降級鏈、超時、LangSmith、扣點）
 *
 * 用途：
 *   - server/routers/spiritRouter.ts 的 trpc.spirit.invoke 端點
 *   - 未來 orb chat / agentCollaborationOrchestrator 直接讓精靈下單
 */

import {
  dispatchFalTask,
  type FalDispatchInput,
  type FalDispatchResult,
} from "./falDispatcher";
import {
  canSpiritCallFalModel,
  getFalModelById,
  getFalModelsForSpirit,
} from "./falModels";
import {
  getCategoriesForSpirit,
  type AgentRole,
} from "../../shared/orb-agent-roles";

/**
 * 為精靈挑一個預設可用模型 — 用於使用者只給「@圖圖 一隻貓」沒指定 modelId
 * 的場景。規則：
 *   - 有 imageUrl → 偏好 image-to-* 類別
 *   - 否則 → 偏好 text-to-* 類別
 * 若兩種偏好都沒命中，退而求其次取該精靈第一個未 disable 的模型。
 * 找不到任何模型回 null（呼叫端會回 success:false）。
 */
export function pickDefaultModelForSpirit(
  role: AgentRole,
  options: { hasImageInput?: boolean } = {},
): string | null {
  const models = getFalModelsForSpirit(role);
  if (models.length === 0) return null;
  const preferImage = options.hasImageInput;
  const preferred = preferImage
    ? models.find(m => m.category.startsWith("image-"))
    : models.find(m => m.category.startsWith("text-"));
  return (preferred ?? models[0]).modelId;
}

/**
 * 呼叫端傳入：哪位精靈要打哪個 fal 模型 + 任務輸入。
 * 不需要呼叫端帶 `category`，spiritDispatcher 會從 fal 目錄查表。
 */
export interface InvokeSpiritModelInput
  extends Omit<FalDispatchInput, "category" | "spirit" | "modelId"> {
  /** 哪位精靈要呼叫（圖圖 / 影影 / 音音 / 聲聲 / 練練 / 編編 …） */
  spirit: AgentRole;
  /**
   * 指定模型 ID。省略時會走 `pickDefaultModelForSpirit` 自動選一個 —
   * 用於 orb chat「@圖圖 畫一隻貓」這種使用者沒挑模型的場景。
   */
  modelId?: string;
}

/**
 * 由精靈直接呼叫一個 fal.ai 模型。
 *
 * 流程：
 *   1. 查 fal 目錄取得 modelId 的 category（找不到就回失敗，不打 API）
 *   2. 用 canSpiritCallFalModel 做授權檢查
 *   3. 通過則交給 dispatchFalTask 真實打 fal.ai
 *
 * 回傳的 FalDispatchResult 結構與既有 dispatch* 一致，呼叫端可直接拿 data。
 */
export async function invokeSpiritModel(
  input: InvokeSpiritModelInput,
): Promise<FalDispatchResult> {
  const { spirit, modelId: providedModelId, ...rest } = input;

  // 沒指定模型 → 為該精靈挑一個預設可用模型。挑不到（例如暖暖 / 路路
  // 這種沒有 fal 模型的精靈）就 fail-fast。
  const modelId =
    providedModelId ??
    pickDefaultModelForSpirit(spirit, {
      hasImageInput: !!rest.imageUrl,
    });
  if (!modelId) {
    return {
      success: false,
      modelId: providedModelId ?? "(unspecified)",
      modelLabel: providedModelId ?? "(unspecified)",
      category: "unknown",
      data: {},
      durationMs: 0,
      pointsDeducted: 0,
      pointsBreakdown: "0 (未呼叫：精靈無可用模型)",
      error: `精靈 "${spirit}" 沒有可呼叫的 fal 模型；請改用其他精靈或指定 modelId`,
    };
  }

  // Step 1: 查表取得 category。不在目錄裡就直接拒絕 —— 沒有 category 就無法
  // 走 dispatchFalTask 的降級鏈與計費邏輯，硬打也只是浪費點數。
  const modelConfig = getFalModelById(modelId);
  if (!modelConfig) {
    return {
      success: false,
      modelId,
      modelLabel: modelId,
      category: "unknown",
      data: {},
      durationMs: 0,
      pointsDeducted: 0,
      pointsBreakdown: "0 (未呼叫：模型不在 fal 目錄)",
      error: `模型 "${modelId}" 不在 fal 目錄中，無法分派`,
    };
  }

  // Step 2: 授權檢查 —— 即使 dispatchFalTask 也會檢查，這裡先擋一輪可以
  // 給呼叫端更早 fail-fast 的訊息，並把允許的類別列在錯誤裡方便除錯。
  if (!canSpiritCallFalModel(spirit, modelId)) {
    const allowed = getCategoriesForSpirit(spirit).join(", ") || "(無)";
    return {
      success: false,
      modelId,
      modelLabel: modelConfig.label,
      category: modelConfig.category,
      data: {},
      durationMs: 0,
      pointsDeducted: 0,
      pointsBreakdown: "0 (未呼叫：精靈無此模型權限)",
      error: `精靈 "${spirit}" 沒有呼叫模型 "${modelId}" (${modelConfig.category}) 的權限。允許的類別：${allowed}`,
    };
  }

  // Step 3: 真實打 fal.ai —— 走既有 dispatcher 拿到降級、超時、LangSmith、扣點。
  return dispatchFalTask({
    ...rest,
    modelId,
    category: modelConfig.category,
    spirit,
  });
}
