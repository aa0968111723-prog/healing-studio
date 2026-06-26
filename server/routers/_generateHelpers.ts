import { invokeLLM, extractMessageText, extractMessageJson } from "../_core/llm";
import { storagePut } from "../storage";
import { normalizeEngineModelId } from "../../shared/engineModelIds";
import { extractJsonObjectFromText } from "../../shared/agent-plan-adapter";
import { resolveSafetyFallback } from "../services/security/contentModeration";
import { withTimeout } from "../services/director/templates";

/**
 * fal-ai/lora 使用 image_size 而非 aspect_ratio。
 * 對應前端工作室的 aspectRatio 選項到 fal-ai/lora 的 enum。
 */
export function aspectRatioToImageSize(
  aspectRatio: string | undefined
): string {
  switch (aspectRatio) {
    case "1:1":
      return "square_hd";
    case "16:9":
      return "landscape_16_9";
    case "9:16":
      return "portrait_16_9";
    case "4:3":
    case "3:2":
      return "landscape_4_3";
    case "3:4":
    case "2:3":
      return "portrait_4_3";
    default:
      return "square_hd";
  }
}

export function getBrainSelectedEngine(
  brainRow: Record<string, unknown> | null,
  key: "imageEngine" | "videoEngine" | "audioEngine" | "voiceEngine"
): string | undefined {
  const value = brainRow?.[key];
  if (typeof value !== "string" || !value.trim()) return undefined;
  return normalizeEngineModelId(value.trim());
}

export function extFromMime(mimeType: string, fallback: string): string {
  const lower = mimeType.toLowerCase();
  if (lower.includes("png")) return "png";
  if (lower.includes("jpeg") || lower.includes("jpg")) return "jpg";
  if (lower.includes("webp")) return "webp";
  if (lower.includes("wav")) return "wav";
  if (lower.includes("mpeg") || lower.includes("mp3")) return "mp3";
  if (lower.includes("ogg")) return "ogg";
  return fallback;
}

export async function storeBase64Media(params: {
  base64: string;
  mimeType: string;
  prefix: string;
  fallbackExt: string;
}): Promise<string> {
  const ext = extFromMime(params.mimeType, params.fallbackExt);
  const key = `${params.prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const buffer = Buffer.from(params.base64, "base64");
  const stored = await storagePut(key, buffer, params.mimeType || "application/octet-stream");
  return stored.url;
}

// ─── Safety Moderation Middleware ────────────────────────────────────────────

/**
 * 單次 LLM 安全審核嘗試的結果：
 *  - kind:"verdict" → LLM 回了可靠判定（safe 為真 boolean），不需重試。
 *  - kind:"unparseable" → 有回應但形狀不符（缺 safe boolean / null / 非物件），可重試。
 *  - kind:"error" → 逾時或拋錯（含 LLM 不可用），可重試。
 */
export type SafetyAttempt =
  | { kind: "verdict"; safe: boolean; reason?: string }
  | { kind: "unparseable" }
  | { kind: "error" };

/** 每次安全審核 LLM 呼叫的 timeout（毫秒）。 */
export const SAFETY_ATTEMPT_TIMEOUT_MS = 8_000;
/** 安全審核總嘗試次數（1 次原始 + 1 次重試）。 */
export const SAFETY_MAX_ATTEMPTS = 2;

/** 單次安全審核 LLM 呼叫＋解析。帶 per-attempt timeout，永不拋出（一律歸類回傳）。 */
export async function checkSafetyAttempt(text: string): Promise<SafetyAttempt> {
  try {
    const result = await withTimeout(
      invokeLLM({
        messages: [
          {
            role: "system",
            content: `你是一個內容安全審核助手。請判斷以下內容是否安全、適當。
如果內容包含 NSFW、暴力、仇恨言論或其他不當內容，回覆 JSON: {"safe": false, "reason": "原因"}
如果內容安全，回覆 JSON: {"safe": true}
只回覆 JSON，不要其他文字。`,
          },
          { role: "user", content: text },
        ],
        runName: "safety-moderation",
        maxTokens: 256,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "safety_check",
            strict: true,
            schema: {
              type: "object",
              properties: {
                safe: { type: "boolean" },
                reason: { type: "string", description: "Reason if not safe" },
              },
              required: ["safe", "reason"],
              additionalProperties: false,
            },
          },
        },
      }),
      // AIDV-65：per-attempt timeout 縮為 8s（原單次 15s）。配合一次重試，最壞
      // 情況總等待 ~16s 與原本相當，但對「單次抖動」更有韌性、不致永久卡死。
      SAFETY_ATTEMPT_TIMEOUT_MS,
      "安全檢查"
    );
    // Fence-tolerant parse — Gemini json_object mode occasionally wraps
    // the response in ```json fences. A naive JSON.parse there throws,
    // the catch defaults to { safe: true }, and the safety gate becomes
    // permanently no-op without the operator noticing. Also handle
    // array-form content via extractMessageJson.
    const parsed = extractMessageJson(
      result.choices[0]?.message?.content,
      extractJsonObjectFromText
    ) as { safe?: unknown; reason?: unknown } | null;
    // AIDV-65：只有「可解析且 safe 為真 boolean」才算可靠判定。若 LLM 回了
    // 物件但缺 safe 欄位或型別不對（例如 `{}`、`{"reason":"..."}`），形狀不符＝
    // 無法可靠判定，視同無法解析 → unparseable（可重試／最終走 fail-closed gate），
    // 不再用 `parsed.safe !== false`（undefined !== false ⇒ true）誤判為 safe。
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.safe === "boolean"
    ) {
      return {
        kind: "verdict",
        safe: parsed.safe,
        ...(typeof parsed.reason === "string" ? { reason: parsed.reason } : {}),
      };
    }
    return { kind: "unparseable" };
  } catch {
    // 逾時或任何錯誤（含 LLM 無額度／金鑰失效）。歸類為可重試的 error。
    return { kind: "error" };
  }
}

/**
 * 內容安全審核（AIDV-65 fail-closed）。
 *
 * 行為：
 *  - LLM 回可靠判定（safe boolean）→ 立即回傳該判定（不重試），safe/unsafe 都正常處理。
 *  - 逾時／錯誤／無法解析 → 最多重試 SAFETY_MAX_ATTEMPTS 次；皆失敗後交給
 *    resolveSafetyFallback：旗標 ON（**預設**）→ fail-closed 擋下（{ safe:false, reason }）；
 *    旗標明確回退 OFF → fail-open 放行（{ safe:true }）。
 *
 * 與 LLM 不可用的交互（勿再寫成「無新增負面影響」）：checkSafety 與下游 compileElitePrompt
 *  共用同一 LLM 路由，但兩者對 LLM 故障的處置**相反**——checkSafety 此處 fail-closed
 *  擋下；compileElitePrompt（見下方 ~1138）對 LLM 故障是 graceful fallback（回退原始
 *  prompt 後**照樣產圖**）。故 LLM 不可用時，fail-closed **確實會新增**擋下
 *  generate.multimodal / submitMultimodalAsync 的生成（舊 fail-open 會略過提示詞增強
 *  仍出圖）——這是刻意的安全取捨，非無影響。緊急回退：CONTENT_SAFETY_FAIL_CLOSED=false。
 */
export async function checkSafety(
  text: string
): Promise<{ safe: boolean; reason?: string }> {
  let sawError = false;
  for (let attempt = 1; attempt <= SAFETY_MAX_ATTEMPTS; attempt++) {
    const outcome = await checkSafetyAttempt(text);
    if (outcome.kind === "verdict") {
      // 可靠判定（safe 或 unsafe）→ 立即回傳，不需重試。
      return {
        safe: outcome.safe,
        ...(outcome.reason !== undefined ? { reason: outcome.reason } : {}),
      };
    }
    if (outcome.kind === "error") sawError = true;
    // unparseable / error → 若還有重試額度就再試一次，否則落到下方 fallback。
  }
  // AIDV-65：用盡重試仍逾時／錯誤／無法解析。旗標 ON（預設）→ fail-closed 擋下；
  // 旗標明確回退 OFF → fail-open 放行。reason 區分「逾時/錯誤」與「無法解析」。
  return resolveSafetyFallback(
    sawError
      ? "內容安全檢查暫時無法完成，請稍後重試"
      : "內容安全檢查無法解析結果，為安全起見暫不放行，請稍後重試"
  );
}

// ─── Elite Prompt Compiler ───────────────────────────────────────────────────

export async function compileElitePrompt(payload: {
  prompt: string;
  vibeCardIds: string[];
  temperature: number;
  generationType: string;
  referenceImages?: {
    styleUrl?: string | null;
    vibeUrl?: string | null;
    characterUrl?: string | null;
  };
  memoryContext?: string; // Phase 14 RAG 記憶注入
  // ── AI 大腦組態注入（來自 ctx.brain）────────────────────
  brainModel?: string; // storyteller/director model override
  brainTemperature?: number; // storyteller.temperature
  brainTopP?: number; // storyteller.topP
}): Promise<{
  compiledPrompt: string;
  visualWeight: number;
  controlNetParams: Record<string, unknown>;
}> {
  const vibeDescriptions = payload.vibeCardIds.join(", ");

  // ── Visual Weight Calculation ──
  // When reference images are provided, calculate a visual weight factor
  // that adjusts how strongly the reference influences the generation
  const refImages = payload.referenceImages || {};
  const hasStyleRef = !!refImages.styleUrl;
  const hasVibeRef = !!refImages.vibeUrl;
  const hasCharRef = !!refImages.characterUrl;
  const refCount = [hasStyleRef, hasVibeRef, hasCharRef].filter(Boolean).length;

  // Visual weight: 0.0 (no refs) to 1.0 (all refs provided)
  // Each reference type contributes differently:
  //   style: 0.4, vibe: 0.3, character: 0.3
  const visualWeight =
    (hasStyleRef ? 0.4 : 0) + (hasVibeRef ? 0.3 : 0) + (hasCharRef ? 0.3 : 0);

  // ControlNet-compatible parameters for downstream model integration
  const controlNetParams: Record<string, unknown> = {
    enabled: refCount > 0,
    styleWeight: hasStyleRef ? 0.65 : 0,
    vibeWeight: hasVibeRef ? 0.5 : 0,
    characterWeight: hasCharRef ? 0.75 : 0,
    totalVisualWeight: visualWeight,
    referenceMode:
      refCount === 0 ? "none" : refCount === 1 ? "single" : "multi",
  };

  // Build reference context for the LLM
  const refContext =
    refCount > 0
      ? `\n\n參考圖片資訊：\n- 風格參考：${hasStyleRef ? "已提供（權重 0.65）" : "無"}\n- 氛圍參考：${hasVibeRef ? "已提供（權重 0.5）" : "無"}\n- 角色參考：${hasCharRef ? "已提供（權重 0.75）" : "無"}\n- 綜合視覺權重：${visualWeight.toFixed(2)}\n請在提示詞中加入 "maintaining visual consistency with reference" 等指令。`
      : "";

  const memorySection = payload.memoryContext || "";
  // Effective temperature: prefer brain-injected value, fallback to input.temperature
  const effectiveTemperature = payload.brainTemperature ?? payload.temperature;
  try {
    const result = await withTimeout(
      invokeLLM({
        messages: [
          {
            role: "system",
            content: `你是一位精英級 AI 提示詞編譯器。你的任務是將使用者的簡短描述擴展為一段優化的、敘事性的提示詞。

規則：
1. 必須使用正面解剖學約束（例如：「完美對稱的解剖結構、無瑕的比例」），絕對不使用負面提示
2. 融入氛圍描述：${vibeDescriptions}
3. 創意溫度：${effectiveTemperature}（0=保守精確，1=大膽創新）
4. 生成類型：${payload.generationType}
5. 輸出必須是一段流暢的英文敘事提示詞
6. 加入光線、構圖、色調等專業攝影/藝術指導
7. 確保人物描述包含：perfectly symmetrical anatomy, flawless proportions, natural pose${refContext}${memorySection}`,
          },
          { role: "user", content: payload.prompt },
        ],
        runName: "prompt-compiler",
        maxTokens: 2048,
        // Inject brain model & parameters when available
        ...(payload.brainModel ? { model: payload.brainModel } : {}),
        ...(payload.brainTemperature !== undefined
          ? { temperature: payload.brainTemperature }
          : {}),
        ...(payload.brainTopP !== undefined ? { topP: payload.brainTopP } : {}),
      }),
      30_000,
      "提示詞編譯"
    );
    const text = extractMessageText(result.choices[0]?.message?.content);
    const compiledPrompt = text || payload.prompt;
    return { compiledPrompt, visualWeight, controlNetParams };
  } catch {
    // LLM unavailable (e.g., no GEMINI_API_KEY in demo mode) — gracefully fall back to original prompt
    return { compiledPrompt: payload.prompt, visualWeight, controlNetParams };
  }
}

