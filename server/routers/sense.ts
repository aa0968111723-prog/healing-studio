/**
 * Sense Router — 代理意圖推論
 *
 * 接收前端 Sense Engine 的微行為特徵陣列，
 * 送至 Gemini（Director 角色）進行非同步心理判定推理。
 */

import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { invokeLLM, extractMessageJson } from "../_core/llm";
import { extractJsonObjectFromText } from "../../shared/agent-plan-adapter";
import { serverEnv } from "../_core/env.validated";

// Sense intent 推論逾時 — 讀 SENSE_INTENT_TIMEOUT_SECONDS，預設 45s
const SENSE_INTENT_TIMEOUT_MS = (() => {
  const parsed = parseInt(serverEnv.SENSE_INTENT_TIMEOUT_SECONDS, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed * 1000 : 45_000;
})();

// ─── Input Schema ──────────────────────────────────────────────────────────

const senseEventSchema = z.object({
  type: z.enum([
    "cardDwell",
    "scrollHesitation",
    "hoverIntent",
    "clickAbort",
    "sectionVisit",
    "rapidScan",
  ]),
  timestamp: z.number(),
  targetId: z.string(),
  meta: z.record(z.string(), z.unknown()),
});

const featureSummarySchema = z.object({
  totalEvents: z.number(),
  dwellCount: z.number(),
  hesitationCount: z.number(),
  highIntentCards: z.array(
    z.object({
      targetId: z.string(),
      title: z.string(),
      score: z.number(),
    })
  ),
  hesitationSections: z.array(
    z.object({
      section: z.string(),
      directionChanges: z.number(),
    })
  ),
  modalityPreference: z.record(z.string(), z.number()),
  abortCount: z.number(),
  rapidScanCount: z.number(),
  sessionStartedAt: z.number(),
});

// ─── Intent Inference Types ────────────────────────────────────────────────

/**
 * 心理判定類型：
 * - choice_paralysis: 選擇困難症（大量猶豫、反覆滾動、clickAbort）
 * - aesthetic_preference: 明顯偏好某美學（高意圖集中在特定風格/模態）
 * - exploration_mode: 探索模式（快速掃過、廣泛瀏覽、低停留）
 * - goal_oriented: 目標導向（快速找到目標、高意圖少猶豫）
 * - inspiration_seeking: 靈感枯竭/尋找靈感（中等停留、反覆瀏覽、無明確偏好）
 * - passive_browsing: 被動瀏覽（低互動、長時間停留但無行動）
 */
type IntentType =
  | "choice_paralysis"
  | "aesthetic_preference"
  | "exploration_mode"
  | "goal_oriented"
  | "inspiration_seeking"
  | "passive_browsing";

// ─── Director Prompt ───────────────────────────────────────────────────────

const DIRECTOR_INTENT_PROMPT = `你是「療癒工作室」的 Director AI，一位精通 OARS 動機式晤談法的使用者行為分析專家。

你的任務是根據使用者在首頁的微行為特徵陣列，推論其當下的心理狀態與創作意圖。

## OARS 分析框架

**O (Open-ended)**: 保持開放，不預設使用者的目的
**A (Affirming)**: 肯定使用者的每一個行為都有意義
**R (Reflective)**: 反映使用者行為背後的深層需求
**S (Summarizing)**: 將碎片化行為歸納為清晰的心理畫像

## 行為特徵解讀指南

| 行為特徵 | 心理意涵 |
|---------|---------|
| cardDwell（長時間停留）| 被某作品深深吸引，可能在想像自己的版本 |
| scrollHesitation（反覆滾動）| 選擇困難、資訊過載、或在比較不同選項 |
| hoverIntent 高分 | 對特定作品有強烈興趣但尚未行動 |
| clickAbort（猶豫點擊）| 想嘗試但缺乏信心，或擔心結果不如預期 |
| rapidScan（快速掃過）| 在尋找特定風格，或對當前內容不感興趣 |
| sectionVisit（區塊訪問）| 對特定類別有興趣 |

## 輸出要求

請以溫暖、非評判的語氣，用繁體中文回覆。你的分析應該讓使用者感到被理解，而非被監控。`;

// ─── Timeout Utility ───────────────────────────────────────────────────────

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = "API"
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(`${label} 回應超時（${Math.round(ms / 1000)}秒），請稍後再試`)
      );
    }, ms);
    promise
      .then(val => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch(err => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

// ─── Core Inference Function ───────────────────────────────────────────────

async function inferUserIntent(
  events: Array<{
    type: string;
    timestamp: number;
    targetId: string;
    meta: Record<string, unknown>;
  }>,
  summary: {
    totalEvents: number;
    dwellCount: number;
    hesitationCount: number;
    highIntentCards: Array<{ targetId: string; title: string; score: number }>;
    hesitationSections: Array<{ section: string; directionChanges: number }>;
    modalityPreference: Record<string, number>;
    abortCount: number;
    rapidScanCount: number;
    sessionStartedAt: number;
  }
) {
  const sessionDurationMs = Date.now() - summary.sessionStartedAt;
  const sessionDurationMin = Math.round((sessionDurationMs / 60000) * 10) / 10;

  // 構建行為摘要文本
  const behaviorReport = `
## 使用者行為報告

**工作階段時長**: ${sessionDurationMin} 分鐘
**總事件數**: ${summary.totalEvents}

### 停留行為
- 長時間停留次數: ${summary.dwellCount}
${
  summary.highIntentCards.length > 0
    ? `- 高意圖卡片:\n${summary.highIntentCards.map(c => `  - 「${c.title}」(意圖分數: ${c.score})`).join("\n")}`
    : "- 無明顯高意圖卡片"
}

### 猶豫行為
- 滾動猶豫次數: ${summary.hesitationCount}
- 點擊放棄次數: ${summary.abortCount}
${
  summary.hesitationSections.length > 0
    ? `- 猶豫區域:\n${summary.hesitationSections.map(s => `  - ${s.section} (方向變化: ${s.directionChanges}次)`).join("\n")}`
    : "- 無明顯猶豫區域"
}

### 瀏覽模式
- 快速掃過次數: ${summary.rapidScanCount}

### 模態偏好
${
  Object.keys(summary.modalityPreference).length > 0
    ? Object.entries(summary.modalityPreference)
        .sort(([, a], [, b]) => b - a)
        .map(([mod, count]) => `- ${mod}: ${count} 次停留`)
        .join("\n")
    : "- 尚無明確模態偏好"
}

### 最近事件序列（最新 5 筆）
${events
  .slice(-5)
  .map(e => {
    const time = new Date(e.timestamp).toLocaleTimeString("zh-TW");
    const metaStr = e.meta.cardTitle ? `「${e.meta.cardTitle}」` : e.targetId;
    return `- [${time}] ${e.type}: ${metaStr}`;
  })
  .join("\n")}
`;

  const result = await withTimeout(
    invokeLLM({
      runName: "sense-intent-inference",
      messages: [
        { role: "system", content: DIRECTOR_INTENT_PROMPT },
        { role: "user", content: behaviorReport },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "intent_inference",
          strict: true,
          schema: {
            type: "object",
            properties: {
              intentType: {
                type: "string",
                enum: [
                  "choice_paralysis",
                  "aesthetic_preference",
                  "exploration_mode",
                  "goal_oriented",
                  "inspiration_seeking",
                  "passive_browsing",
                ],
                description: "使用者當下的心理判定類型",
              },
              intentLabel: {
                type: "string",
                description:
                  "心理判定的繁中顯示標籤（如「選擇困難症」「明顯偏好某美學」）",
              },
              confidence: {
                type: "number",
                description: "信心度 0-1，基於行為數據的充分程度",
              },
              psychologicalInsight: {
                type: "string",
                description:
                  "OARS 風格的心理洞察，溫暖且非評判（繁中，50-100字）",
              },
              suggestedAction: {
                type: "string",
                enum: [
                  "recommend_modality",
                  "recommend_style",
                  "simplify_choices",
                  "proactive_guide",
                  "encourage_exploration",
                  "offer_quick_start",
                ],
                description: "建議的下一步行動類型",
              },
              actionDetail: {
                type: "string",
                description: "具體的行動建議內容（繁中，30-60字）",
              },
              detectedAesthetics: {
                type: "array",
                items: { type: "string" },
                description:
                  "偵測到的美學偏好標籤（如 cyberpunk, minimalist, dreamy 等）",
              },
              preferredModality: {
                type: "string",
                description:
                  "推測偏好的創作模態（image/video/music/voice/unknown）",
              },
            },
            required: [
              "intentType",
              "intentLabel",
              "confidence",
              "psychologicalInsight",
              "suggestedAction",
              "actionDetail",
              "detectedAesthetics",
              "preferredModality",
            ],
            additionalProperties: false,
          },
        },
      },
    }),
    SENSE_INTENT_TIMEOUT_MS,
    "意圖推論"
  );

  // Use the fence-tolerant extractor — Gemini's json_object mode (which
  // adaptResponseFormatForGemini falls back to because the strict
  // json_schema mode trips its "too many states" 400) sometimes wraps
  // the payload in ```json fences. A naive JSON.parse there would throw
  // and 500 the entire inferIntent request — the page just shows a
  // generic error toast instead of degrading to the encouraging fallback
  // message below. extractMessageJson 也容忍 array-form content。
  const parsed = extractMessageJson(
    result.choices[0]?.message?.content,
    extractJsonObjectFromText
  ) as
    | {
        intentType?: IntentType;
        intentLabel?: string;
        confidence?: number;
        psychologicalInsight?: string;
        suggestedAction?: string;
        actionDetail?: string;
        detectedAesthetics?: string[];
        preferredModality?: string;
      }
    | null;
  if (parsed && typeof parsed === "object" && parsed.intentType) {
    return {
      intentType: parsed.intentType,
      intentLabel: parsed.intentLabel ?? "",
      confidence:
        typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      psychologicalInsight: parsed.psychologicalInsight ?? "",
      suggestedAction: parsed.suggestedAction ?? "encourage_exploration",
      actionDetail: parsed.actionDetail ?? "",
      detectedAesthetics: Array.isArray(parsed.detectedAesthetics)
        ? parsed.detectedAesthetics
        : [],
      preferredModality: parsed.preferredModality ?? "unknown",
    };
  }

  // Fallback
  return {
    intentType: "exploration_mode" as IntentType,
    intentLabel: "探索模式",
    confidence: 0.3,
    psychologicalInsight:
      "目前行為數據不足以進行深入分析，但您的每一次瀏覽都在為靈感鋪路。",
    suggestedAction: "encourage_exploration",
    actionDetail:
      "繼續自由探索，當您找到感興趣的作品時，不妨點擊進入工作室體驗。",
    detectedAesthetics: [],
    preferredModality: "unknown",
  };
}

// ─── Router ────────────────────────────────────────────────────────────────

export const senseRouter = router({
  /**
   * 代理意圖推論
   *
   * 接收 Sense Engine 的特徵陣列與摘要，
   * 送至 Gemini Director 進行心理判定推理。
   *
   * 使用 publicProcedure 因為未登入使用者也需要推論。
   */
  inferIntent: publicProcedure
    .input(
      z.object({
        events: z.array(senseEventSchema).max(200),
        summary: featureSummarySchema,
      })
    )
    .mutation(async ({ input }) => {
      // 最少需要 3 個事件才有意義
      if (input.events.length < 3) {
        return {
          intentType: "exploration_mode" as IntentType,
          intentLabel: "探索模式",
          confidence: 0.1,
          psychologicalInsight: "您剛開始瀏覽，讓我們再觀察一下您的興趣方向。",
          suggestedAction: "encourage_exploration",
          actionDetail: "自由探索首頁的作品與情報，找到您感興趣的方向。",
          detectedAesthetics: [] as string[],
          preferredModality: "unknown",
        };
      }

      try {
        const result = await inferUserIntent(input.events, input.summary);
        return result;
      } catch (err) {
        console.error("[Sense] Intent inference failed:", err);
        // Graceful fallback — never block the user experience
        return {
          intentType: "exploration_mode" as IntentType,
          intentLabel: "探索模式",
          confidence: 0.2,
          psychologicalInsight: "我正在學習理解您的偏好，請繼續自由探索。",
          suggestedAction: "encourage_exploration",
          actionDetail: "繼續瀏覽，我會在適當時機提供個性化建議。",
          detectedAesthetics: [] as string[],
          preferredModality: "unknown",
        };
      }
    }),
});
