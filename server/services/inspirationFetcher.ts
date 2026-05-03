/**
 * inspirationFetcher.ts — 即時靈感 / 時事 / 社群偏好查詢服務
 *
 * 用 Perplexity Sonar 把「現在這個主題在網路上長什麼樣子」打包成創作可
 * 直接消化的素材：visual styles、prompt keywords、mood board、quick facts、
 * 引用來源 URL。
 *
 * 設計原則：
 *   1. 多源備援：原生 Perplexity API > OpenRouter Sonar > （皆無時）抱歉訊息
 *   2. 結構化輸出：永遠回傳 inspirationCards[] + sources[]，呼叫端可直接渲染
 *   3. 短延遲：Sonar 平均 8-15 秒；總超時 25 秒避免拖累光球對話流程
 *   4. 防 hallucination：強制 JSON 輸出 + 過濾無效 URL
 *
 * 呼叫端：
 *   - server/services/agentToolExecutor.ts 的 inspiration.fetch tool
 *   - server/routers/director.ts 的 fetchTrendingInspiration endpoint
 */

import { ENV } from "../_core/env";
import {
  checkAndConsumePerplexity,
  describeThrottleReason,
} from "./perplexityThrottle";

const PERPLEXITY_TIMEOUT_MS = 25_000;
const OPENROUTER_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESULTS = 5;
const MAX_ALLOWED_RESULTS = 8;

export type InspirationModality =
  | "image"
  | "video"
  | "audio"
  | "voice"
  | "3d"
  | "general";

export type InspirationAngle =
  | "trending"
  | "community"
  | "news"
  | "seasonal"
  | "model_release";

export type InspirationFormat =
  | "visual_styles"
  | "prompt_keywords"
  | "mood_board"
  | "quick_facts";

export interface InspirationCard {
  /** 一句話的標題（可放到卡片頂部） */
  title: string;
  /** 適合直接塞進生成 prompt 的關鍵字 / 風格描述（英文，方便接 Flux / Sora 等） */
  promptKeywords: string;
  /** 給創作者看的繁中說明（為什麼這個方向值得試） */
  rationale: string;
  /** 引用的來源 URL（必填，無 URL 就過濾掉） */
  sourceUrl: string;
  /** 來源網域（顯示用） */
  sourceTitle: string;
}

export interface InspirationFetchResult {
  ok: boolean;
  /** 使用的搜尋來源（debug） */
  provider: "perplexity-native" | "openrouter-sonar" | "none";
  /** 結構化靈感卡片，呼叫端可直接 map 到 UI */
  cards: InspirationCard[];
  /** 全部引用來源（包含未進到 cards 的） */
  sources: Array<{ title: string; url: string }>;
  /** Sonar 給的整體摘要（適合放卡片下方） */
  summary: string;
  /** 錯誤訊息（ok=false 時填） */
  error?: string;
}

export interface InspirationFetchInput {
  topic: string;
  modality?: InspirationModality;
  angle?: InspirationAngle;
  format?: InspirationFormat;
  maxResults?: number;
  /**
   * Throttle 計費對象：tRPC / orb tool 呼叫填使用者 ID；cron / 系統內部
   * 呼叫填 null（仍受全站節流，但不算進 per-user 配額）。預設 null。
   */
  userId?: number | null;
}

function clampMaxResults(n: number | undefined): number {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) {
    return DEFAULT_MAX_RESULTS;
  }
  return Math.min(MAX_ALLOWED_RESULTS, Math.max(1, Math.round(n)));
}

function buildSystemPrompt(input: InspirationFetchInput): string {
  const modality = input.modality ?? "general";
  const angle = input.angle ?? "trending";
  const format = input.format ?? "visual_styles";

  const angleHint = {
    trending: "目前在社群（IG / TikTok / Threads / 抖音 / Pinterest / X）熱門的方向",
    community: "社群（如 Reddit、Discord、巴哈姆特、Dcard、Twitter 創作圈）正在討論或推薦的方向",
    news: "近期新聞 / 文化時事 / 公眾事件相關的創作機會",
    seasonal: "本月份 / 本季 / 即將到來的節慶 / 季節相關的題材",
    model_release: "近期 AI 模型 / 工具更新（Flux / Sora / Nano Banana / ElevenLabs / Runway 等）帶來的新可能",
  }[angle];

  const modalityHint = {
    image: "靜態圖像生成",
    video: "短影片生成",
    audio: "音樂 / 音效生成",
    voice: "TTS / 語音克隆 / 數位人配音",
    "3d": "3D 模型 / 場景生成",
    general: "跨模態創作（任何媒材）",
  }[modality];

  const formatHint = {
    visual_styles:
      "每張卡片給一個具體的視覺風格名稱（如 'Lo-fi pastel anime', 'Brutalist editorial photo'）",
    prompt_keywords:
      "每張卡片提供可直接複製貼上到 Flux / Sora / Stable Diffusion 的英文 prompt keywords",
    mood_board:
      "每張卡片描述一組「氛圍 / 顏色 / 構圖 / 質感」的搭配，可作為 mood board 元素",
    quick_facts:
      "每張卡片給一個可信的事實或數據點（要附引用 URL），讓創作者把時事融入作品",
  }[format];

  return `你是一位即時情報研究員，正在為 Healing Studio 的創作者收集「${input.topic}」相關的${angleHint}。
模態目標：${modalityHint}
卡片格式：${formatHint}

請使用你的 web search 能力查詢 2025-2026 年最新內容，回覆 ONLY 一個合法的 JSON 物件，shape 如下：
{
  "summary": "1-2 句話總結這個主題目前的網路樣貌（繁體中文）",
  "cards": [
    {
      "title": "簡短標題（繁體中文）",
      "promptKeywords": "可直接塞進生成 prompt 的英文關鍵字 / 風格描述",
      "rationale": "為什麼值得創作者試這個方向（繁體中文 1-2 句）",
      "sourceUrl": "引用的真實 URL（必填）",
      "sourceTitle": "來源網域或文章標題"
    }
  ]
}
不要包裝 markdown 程式碼塊。每張卡片都必須有真實可點擊的 sourceUrl（不要編造 URL）。`;
}

function isValidUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

interface SonarRawResponse {
  choices?: Array<{ message?: { content?: string } }>;
  search_results?: Array<{ title?: string; url?: string }>;
  citations?: string[];
}

function parseSonarResponse(
  raw: SonarRawResponse,
  maxResults: number
): { cards: InspirationCard[]; summary: string; sources: Array<{ title: string; url: string }> } {
  const content = raw.choices?.[0]?.message?.content?.trim() ?? "";
  let parsed: { summary?: unknown; cards?: unknown } = {};
  try {
    parsed = JSON.parse(content);
  } catch {
    // 部分模型會包 markdown fence — 試著拆掉
    const cleaned = content
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // 仍失敗 → 回傳空 cards，呼叫端會展示 summary 文字 + sources
    }
  }

  const summary =
    typeof parsed.summary === "string" && parsed.summary.trim()
      ? parsed.summary.trim()
      : content.slice(0, 240);

  const rawCards = Array.isArray(parsed.cards) ? parsed.cards : [];
  const cards: InspirationCard[] = [];
  for (const c of rawCards) {
    if (!c || typeof c !== "object") continue;
    const card = c as Record<string, unknown>;
    if (
      typeof card.title === "string" &&
      typeof card.promptKeywords === "string" &&
      typeof card.rationale === "string" &&
      isValidUrl(card.sourceUrl)
    ) {
      cards.push({
        title: card.title.trim().slice(0, 120),
        promptKeywords: card.promptKeywords.trim().slice(0, 400),
        rationale: card.rationale.trim().slice(0, 240),
        sourceUrl: card.sourceUrl as string,
        sourceTitle:
          typeof card.sourceTitle === "string" && card.sourceTitle.trim()
            ? card.sourceTitle.trim().slice(0, 80)
            : new URL(card.sourceUrl as string).host,
      });
      if (cards.length >= maxResults) break;
    }
  }

  // 把 search_results / citations 收集成 sources 列表（包含 cards 沒用到的）
  const seen = new Set<string>();
  const sources: Array<{ title: string; url: string }> = [];
  for (const card of cards) {
    if (!seen.has(card.sourceUrl)) {
      sources.push({ title: card.sourceTitle, url: card.sourceUrl });
      seen.add(card.sourceUrl);
    }
  }
  for (const sr of raw.search_results ?? []) {
    if (!sr.url || seen.has(sr.url) || !isValidUrl(sr.url)) continue;
    let host = sr.url;
    try {
      host = new URL(sr.url).host;
    } catch {
      /* keep raw */
    }
    sources.push({ title: sr.title?.slice(0, 80) || host, url: sr.url });
    seen.add(sr.url);
  }
  for (const url of raw.citations ?? []) {
    if (!url || seen.has(url) || !isValidUrl(url)) continue;
    let host = url;
    try {
      host = new URL(url).host;
    } catch {
      /* keep raw */
    }
    sources.push({ title: host, url });
    seen.add(url);
  }

  return { cards, summary, sources };
}

async function fetchViaPerplexityNative(
  input: InspirationFetchInput,
  systemPrompt: string,
  maxResults: number
): Promise<InspirationFetchResult> {
  const apiKey = ENV.perplexityApiKey;
  if (!apiKey) {
    return {
      ok: false,
      provider: "none",
      cards: [],
      sources: [],
      summary: "",
      error: "PERPLEXITY_API_KEY 未設定",
    };
  }

  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "sonar-reasoning-pro",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: input.topic },
      ],
      response_format: { type: "json_object" },
      max_tokens: 2000,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(PERPLEXITY_TIMEOUT_MS),
  });

  if (!res.ok) {
    return {
      ok: false,
      provider: "perplexity-native",
      cards: [],
      sources: [],
      summary: "",
      error: `Perplexity API ${res.status} ${res.statusText}`,
    };
  }

  const raw = (await res.json()) as SonarRawResponse;
  const parsed = parseSonarResponse(raw, maxResults);
  return {
    ok: true,
    provider: "perplexity-native",
    cards: parsed.cards,
    sources: parsed.sources,
    summary: parsed.summary,
  };
}

async function fetchViaOpenRouter(
  input: InspirationFetchInput,
  systemPrompt: string,
  maxResults: number
): Promise<InspirationFetchResult> {
  const apiKey = ENV.openRouterApiKey;
  if (!apiKey) {
    return {
      ok: false,
      provider: "none",
      cards: [],
      sources: [],
      summary: "",
      error: "OPENROUTER_API_KEY 未設定",
    };
  }
  const baseUrl = (ENV.openRouterBaseUrl || "https://openrouter.ai/api/v1").replace(
    /\/$/,
    ""
  );
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (ENV.openRouterHttpReferer) headers["HTTP-Referer"] = ENV.openRouterHttpReferer;
  if (ENV.openRouterXTitle) headers["X-Title"] = ENV.openRouterXTitle;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "perplexity/sonar-reasoning-pro",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: input.topic },
      ],
      response_format: { type: "json_object" },
      max_tokens: 2000,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(OPENROUTER_TIMEOUT_MS),
  });

  if (!res.ok) {
    return {
      ok: false,
      provider: "openrouter-sonar",
      cards: [],
      sources: [],
      summary: "",
      error: `OpenRouter Sonar ${res.status} ${res.statusText}`,
    };
  }

  const raw = (await res.json()) as SonarRawResponse;
  const parsed = parseSonarResponse(raw, maxResults);
  return {
    ok: true,
    provider: "openrouter-sonar",
    cards: parsed.cards,
    sources: parsed.sources,
    summary: parsed.summary,
  };
}

/**
 * 主入口：抓即時靈感。原生 Perplexity API 優先，失敗時降級到 OpenRouter Sonar，
 * 都不行回傳 ok=false（呼叫端應退回靜態建議）。
 */
export async function fetchInspiration(
  input: InspirationFetchInput
): Promise<InspirationFetchResult> {
  if (!input.topic || typeof input.topic !== "string" || !input.topic.trim()) {
    return {
      ok: false,
      provider: "none",
      cards: [],
      sources: [],
      summary: "",
      error: "topic 必填",
    };
  }

  // ── Throttle / Feature flag 閘門 ──────────────────────────────────────
  // 統一在這裡攔截：feature_disabled / user_hour_limit / user_day_limit /
  // global_minute_limit 都會回 ok=false 帶 reason，呼叫端可以用
  // describeThrottleReason() 把 reason 轉成繁中提示。
  const throttle = checkAndConsumePerplexity({
    feature: "inspiration",
    userId: input.userId ?? null,
  });
  if (!throttle.allowed) {
    return {
      ok: false,
      provider: "none",
      cards: [],
      sources: [],
      summary: "",
      error: throttle.reason
        ? `${describeThrottleReason(throttle.reason)}${
            throttle.retryAfterSec
              ? `（建議 ${throttle.retryAfterSec}s 後再試）`
              : ""
          }`
        : "Perplexity 節流",
    };
  }

  const maxResults = clampMaxResults(input.maxResults);
  const systemPrompt = buildSystemPrompt({ ...input, maxResults });

  // 優先：原生 Perplexity API
  if (ENV.perplexityApiKey) {
    try {
      const native = await fetchViaPerplexityNative(input, systemPrompt, maxResults);
      if (native.ok && native.cards.length > 0) return native;
      // 原生回 0 cards 就不繼續打 OpenRouter（避免雙倍費用），但保留錯誤訊息
      if (native.ok) return native;
      console.warn("[inspirationFetcher] Native Perplexity failed:", native.error);
    } catch (err) {
      console.warn(
        "[inspirationFetcher] Native Perplexity threw:",
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  // 降級：OpenRouter Sonar
  if (ENV.openRouterApiKey) {
    try {
      return await fetchViaOpenRouter(input, systemPrompt, maxResults);
    } catch (err) {
      return {
        ok: false,
        provider: "openrouter-sonar",
        cards: [],
        sources: [],
        summary: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return {
    ok: false,
    provider: "none",
    cards: [],
    sources: [],
    summary: "",
    error: "皆未設定 PERPLEXITY_API_KEY 或 OPENROUTER_API_KEY，無法取得即時靈感。",
  };
}
