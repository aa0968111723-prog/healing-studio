/**
 * compositionSuggestionService.ts — AI 構圖建議生成（AIDV-847）
 *
 * 取代 worldbuilding.getCompositionSuggestions 的 mock stub：
 * 把構圖畫布上的元素佈局（位置、大小、層級、旋轉、姿勢）與世界觀脈絡
 * 摘要成文字，交給 LLM（走既有 invokeLLM router 慣例）生成 1-5 條
 * 具體的構圖建議（layout / balance / focus / depth / color_harmony）。
 *
 * 錯誤處理策略：本服務對「LLM 呼叫失敗 / 回應格式錯誤 / 超時」一律 throw，
 * 由呼叫端（router）決定降級行為 —— AIDV-847 的路由層 catch 後回傳
 * 空陣列（安全空結果），前端 CompositionAssistant 對空陣列不渲染建議面板。
 */

import { z } from "zod";
import { invokeLLM } from "../_core/llm";
import { withTimeout, extractMessageJson } from "./director/templates";
import type {
  CompositionSuggestion,
  CompositionSuggestionRequest,
} from "../../shared/worldbuilding-timeline";

/** 最多回傳幾條建議（LLM 超量時裁切） */
const MAX_SUGGESTIONS = 5;

const SUGGESTION_TYPES = [
  "layout",
  "balance",
  "focus",
  "depth",
  "color_harmony",
] as const;

const suggestionSchema = z.object({
  type: z.enum(SUGGESTION_TYPES),
  title: z.string().min(1).max(120),
  content: z.string().min(1).max(2000),
});

const suggestionsResponseSchema = z.object({
  suggestions: z.array(suggestionSchema).min(1),
});

/**
 * OpenAI-style strict json_schema：所有欄位 required、additionalProperties false。
 * 刻意不用 minItems/maxItems（部分 provider 的 strict 模式不支援），
 * 數量上限改由程式端 slice 裁切。
 */
const suggestionsJsonSchema = {
  type: "object" as const,
  properties: {
    suggestions: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          type: { type: "string" as const, enum: [...SUGGESTION_TYPES] },
          title: { type: "string" as const },
          content: { type: "string" as const },
        },
        required: ["type", "title", "content"],
        additionalProperties: false,
      },
    },
  },
  required: ["suggestions"],
  additionalProperties: false,
};

const FOCUS_GOAL_LABELS: Record<
  NonNullable<CompositionSuggestionRequest["focusGoal"]>,
  string
> = {
  balance: "視覺平衡",
  depth: "景深層次",
  drama: "戲劇張力",
  harmony: "和諧統一",
  dynamic: "動態感",
};

type WorldRow = {
  name: string;
  description?: string | null;
  genre?: string | null;
  era?: string | null;
  scenesJson?: unknown;
};

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** 把單一構圖元素摘要成一行 prompt 文字 */
function describeElement(
  el: CompositionSuggestionRequest["elements"][number],
  index: number
): string {
  const parts = [
    `#${index + 1} [${el.type}]`,
    `位置(${formatNumber(el.position.x)}, ${formatNumber(el.position.y)})`,
    `尺寸 ${formatNumber(el.size.width)}x${formatNumber(el.size.height)}`,
    `層級 z=${el.zIndex}`,
  ];
  if (el.rotation) parts.push(`旋轉 ${formatNumber(el.rotation)}°`);
  if (el.opacity !== undefined && el.opacity !== 1) {
    parts.push(`不透明度 ${formatNumber(el.opacity)}`);
  }
  if (el.characterId) parts.push(`角色 ${el.characterId}`);
  if (el.objectId) parts.push(`物件 ${el.objectId}`);
  if (el.pose) parts.push(`姿勢：${el.pose}`);
  return parts.join("，");
}

/** 從世界的 scenesJson 找出背景場景，摘要環境/氛圍/光線供 prompt 用 */
function describeBackgroundScene(
  world: WorldRow,
  backgroundSceneId: string | undefined
): string {
  if (!backgroundSceneId || !Array.isArray(world.scenesJson)) return "";
  const scene = (
    world.scenesJson as Array<{
      id?: string;
      name?: string;
      environment?: string;
      mood?: string;
      lighting?: string;
    }>
  ).find(s => s?.id === backgroundSceneId);
  if (!scene) return "";
  const lines = [`背景場景：${scene.name ?? backgroundSceneId}`];
  if (scene.environment) lines.push(`環境：${scene.environment}`);
  if (scene.mood) lines.push(`氛圍：${scene.mood}`);
  if (scene.lighting) lines.push(`光線：${scene.lighting}`);
  return lines.join("\n");
}

/** 把世界觀 + 構圖請求組成 user prompt */
export function buildCompositionPrompt(
  world: WorldRow,
  request: CompositionSuggestionRequest
): string {
  const worldLines = [`世界名稱：${world.name}`];
  if (world.description) worldLines.push(`世界描述：${world.description}`);
  if (world.genre) worldLines.push(`類型：${world.genre}`);
  if (world.era) worldLines.push(`時代：${world.era}`);

  const canvasLine =
    request.canvasWidth && request.canvasHeight
      ? `畫布尺寸：${request.canvasWidth}x${request.canvasHeight}（元素座標以左上角為原點）`
      : "畫布尺寸：未提供（元素座標以左上角為原點）";

  const elementLines = request.elements.length
    ? request.elements.map((el, i) => describeElement(el, i)).join("\n")
    : "（畫布目前沒有元素）";

  const backgroundBlock = describeBackgroundScene(
    world,
    request.backgroundSceneId
  );

  const goalLine = request.focusGoal
    ? `使用者的構圖目標：${FOCUS_GOAL_LABELS[request.focusGoal]}（${request.focusGoal}）`
    : "";

  return [
    "【世界觀】",
    worldLines.join("\n"),
    "",
    "【構圖現況】",
    canvasLine,
    elementLines,
    backgroundBlock,
    goalLine,
    "",
    "請根據以上構圖現況，給出具體、可操作的構圖建議。",
  ]
    .filter(Boolean)
    .join("\n");
}

const SYSTEM_PROMPT = `你是資深動畫分鏡與攝影指導，專長是畫面構圖分析。
使用者會給你一個場景構圖畫布的元素佈局（座標、尺寸、層級），請依據構圖原則
（三分法、視覺平衡、焦點引導、景深層次、色彩和諧）給出 2-4 條建議。

規則：
- type 必須是 layout / balance / focus / depth / color_harmony 之一，依建議性質選擇。
- title 不超過 15 字，一眼看懂建議方向。
- content 2-3 句，必須針對「這個」佈局的具體元素（引用元素編號或角色），
  給出可直接操作的調整（往哪移、放大縮小多少、層級如何調），不要空泛套話。
- 若畫布沒有元素，給 layout 類型的起手構圖建議。
- 全部使用繁體中文。`;

/**
 * 呼叫 LLM 生成構圖建議。失敗（超時 / API 錯誤 / 回應格式錯誤）時 throw，
 * 降級策略由呼叫端決定。
 */
export async function generateCompositionSuggestions(params: {
  world: WorldRow;
  request: CompositionSuggestionRequest;
}): Promise<CompositionSuggestion[]> {
  const result = await withTimeout(
    invokeLLM({
      runName: "worldbuilding-composition-suggestions",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildCompositionPrompt(params.world, params.request) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "composition_suggestions",
          strict: true,
          schema: suggestionsJsonSchema,
        },
      },
      temperature: 0.7,
      maxTokens: 1024,
    }),
    60_000,
    "構圖建議生成"
  );

  const extracted = extractMessageJson(result.choices[0]?.message?.content);
  const parsed = suggestionsResponseSchema.safeParse(extracted);
  if (!parsed.success) {
    throw new Error(`構圖建議回應格式錯誤：${parsed.error.message}`);
  }

  return parsed.data.suggestions
    .slice(0, MAX_SUGGESTIONS)
    .map(s => ({ type: s.type, title: s.title, content: s.content }));
}
