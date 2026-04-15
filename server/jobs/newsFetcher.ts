/**
 * newsFetcher.ts — 首頁新聞雙活備援排程 + OARS NLP 柔化器
 *
 * 每 6 小時自動抓取 AI 創作相關新聞，經 Gemini Flash 批次 NLP 柔化處理後寫入 news_articles 表。
 *
 * 主從備援機制 (Fail-over Strategy):
 *   主要來源: NewsAPI.org  (NEWS_API_KEY)
 *   備援來源: NewsData.io  (NEWSDATA_API_KEY)
 *
 * OARS NLP 柔化管線 (Gemini Flash):
 *   1. 消除恐嚇性字眼（失業/淘汰/取代/威脅/末日）→ 轉譯為啟發性語氣
 *   2. 生成一句 TL;DR 柔化摘要（50-80 字，繁體中文）
 *   3. 自動給予權重標籤 (Model Breakthrough / Inspiration Tip / Industry Shift 等)
 *   4. 批次處理：一次送整批新聞給 Gemini，減少 API 呼叫次數
 */

import * as cron from "node-cron";
import { getDb } from "../db";
import { newsArticles } from "../../drizzle/schema";
import { invokeLLM } from "../_core/llm";
import { eq } from "drizzle-orm";
import { CircuitBreaker } from "./circuitBreaker";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawNewsItem {
  title: string;
  description: string | null;
  source: string;
  url: string | null;
  imageUrl: string | null;
  publishedAt: string | null;
}

interface FetchResult {
  provider: "newsapi" | "newsdata";
  articles: RawNewsItem[];
}

/** OARS NLP 柔化器輸出結構 */
interface OarsSoftened {
  /** 柔化後的標題（移除恐嚇字眼） */
  softenedTitle: string;
  /** TL;DR 柔化摘要（50-80 字） */
  tldr: string;
  /** 權重標籤 */
  weightLabel: WeightLabel;
  /** 自動提取的技術標籤 */
  tags: string[];
  /** 分類 */
  category: NewsCategory;
}

type WeightLabel =
  | "Model Breakthrough"
  | "Inspiration Tip"
  | "Industry Shift"
  | "Creative Tool"
  | "Community Spotlight"
  | "Tutorial Guide"
  | "General Update";

type NewsCategory =
  | "product_update"
  | "community_highlight"
  | "tutorial"
  | "industry_news"
  | "tips_and_tricks";

// ─── Configuration ────────────────────────────────────────────────────────────

const FETCH_KEYWORDS = "AI art OR AI image generation OR generative AI OR AI creative tools";
const MAX_ARTICLES_PER_FETCH = 10;
const FETCH_TIMEOUT_MS = 15_000;
const GEMINI_BATCH_TIMEOUT_MS = 60_000;

// ─── Circuit Breaker — Stops retrying when news APIs fail repeatedly ──────────
const newsApiBreaker = new CircuitBreaker("NewsFetcher", {
  failureThreshold: 3,
  cooldownMs: 30 * 60_000, // 30 minutes cooldown
});

// ─── Deduplication Lock — Prevents overlapping cron runs ──────────────────────
let isFetchRunning = false;

// ─── OARS Logger ──────────────────────────────────────────────────────────────

function logOars(level: "info" | "warn" | "error", message: string): void {
  const prefix = "[NewsFetcher]";
  const timestamp = new Date().toISOString();
  switch (level) {
    case "info":
      console.info(`${prefix} ${timestamp} ℹ️  ${message}`);
      break;
    case "warn":
      console.warn(`${prefix} ${timestamp} ⚠️  ${message}`);
      break;
    case "error":
      console.error(`${prefix} ${timestamp} ❌  ${message}`);
      break;
  }
}

// ─── Fetch with Timeout ───────────────────────────────────────────────────────

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Provider: NewsAPI.org (Primary) ──────────────────────────────────────────

async function fetchFromNewsAPI(apiKey: string): Promise<FetchResult> {
  logOars("info", "嘗試從主要來源 NewsAPI.org 抓取新聞...");

  const params = new URLSearchParams({
    q: FETCH_KEYWORDS,
    language: "en",
    sortBy: "publishedAt",
    pageSize: String(MAX_ARTICLES_PER_FETCH),
    apiKey,
  });

  const response = await fetchWithTimeout(
    `https://newsapi.org/v2/everything?${params.toString()}`
  );

  if (response.status === 429) {
    throw new Error(`RATE_LIMIT: NewsAPI.org 回傳 429 — 已達速率上限`);
  }
  if (response.status >= 500) {
    throw new Error(
      `SERVER_ERROR: NewsAPI.org 回傳 ${response.status} — 伺服器異常`
    );
  }
  if (!response.ok) {
    throw new Error(
      `HTTP_ERROR: NewsAPI.org 回傳 ${response.status} — ${response.statusText}`
    );
  }

  const data = await response.json();

  if (data.status !== "ok" || !Array.isArray(data.articles)) {
    throw new Error(`PARSE_ERROR: NewsAPI.org 回傳格式異常 — status: ${data.status}`);
  }

  const articles: RawNewsItem[] = data.articles.map((a: any) => ({
    title: a.title || "Untitled",
    description: a.description || a.content || null,
    source: a.source?.name || "Unknown",
    url: a.url || null,
    imageUrl: a.urlToImage || null,
    publishedAt: a.publishedAt || null,
  }));

  logOars("info", `NewsAPI.org 成功回傳 ${articles.length} 篇文章`);
  return { provider: "newsapi", articles };
}

// ─── Provider: NewsData.io (Fallback) ─────────────────────────────────────────

async function fetchFromNewsData(apiKey: string): Promise<FetchResult> {
  logOars("info", "切換至備援來源 NewsData.io 抓取新聞...");

  const params = new URLSearchParams({
    q: "AI art OR generative AI",
    language: "en",
    size: String(MAX_ARTICLES_PER_FETCH),
    apikey: apiKey,
  });

  const response = await fetchWithTimeout(
    `https://newsdata.io/api/1/latest?${params.toString()}`
  );

  if (response.status === 429) {
    throw new Error(`RATE_LIMIT: NewsData.io 回傳 429 — 已達速率上限`);
  }
  if (response.status >= 500) {
    throw new Error(
      `SERVER_ERROR: NewsData.io 回傳 ${response.status} — 伺服器異常`
    );
  }
  if (!response.ok) {
    throw new Error(
      `HTTP_ERROR: NewsData.io 回傳 ${response.status} — ${response.statusText}`
    );
  }

  const data = await response.json();

  if (data.status !== "success" || !Array.isArray(data.results)) {
    throw new Error(
      `PARSE_ERROR: NewsData.io 回傳格式異常 — status: ${data.status}`
    );
  }

  const articles: RawNewsItem[] = data.results.map((a: any) => ({
    title: a.title || "Untitled",
    description: a.description || a.content || null,
    source: a.source_name || a.source_id || "Unknown",
    url: a.link || null,
    imageUrl: a.image_url || null,
    publishedAt: a.pubDate || null,
  }));

  logOars("info", `NewsData.io 成功回傳 ${articles.length} 篇文章`);
  return { provider: "newsdata", articles };
}

// ─── Dual Fail-over Orchestrator ──────────────────────────────────────────────

async function fetchNewsWithFailover(): Promise<FetchResult | null> {
  const newsApiKey = process.env.NEWS_API_KEY?.trim();
  const newsDataKey = process.env.NEWSDATA_API_KEY?.trim();

  // ── Attempt 1: Primary (NewsAPI.org) ──
  if (newsApiKey) {
    try {
      return await fetchFromNewsAPI(newsApiKey);
    } catch (primaryError: any) {
      logOars(
        "warn",
        `主要來源 NewsAPI.org 失敗：${primaryError.message}。正在啟動備援切換...`
      );
    }
  } else {
    logOars("warn", "NEWS_API_KEY 未設定，跳過主要來源。");
  }

  // ── Attempt 2: Fallback (NewsData.io) ──
  if (newsDataKey) {
    try {
      return await fetchFromNewsData(newsDataKey);
    } catch (fallbackError: any) {
      logOars(
        "error",
        `備援來源 NewsData.io 也失敗：${fallbackError.message}。本輪新聞抓取中止。`
      );
    }
  } else {
    logOars("warn", "NEWSDATA_API_KEY 未設定，無法啟動備援來源。");
  }

  // ── Both failed ──
  logOars(
    "error",
    "【雙活備援全部失敗】主從兩個新聞來源均無法連線。首頁將繼續顯示既有快取新聞。下次排程將自動重試。"
  );
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// OARS NLP 柔化器 — Gemini Flash 批次處理管線
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 恐嚇性字眼黑名單 — 這些詞彙在 AI 新聞中常引發焦慮，
 * Gemini 會被指示將它們轉譯為啟發性語氣。
 */
const FEAR_WORDS_BLACKLIST = [
  "失業", "淘汰", "取代", "威脅", "末日", "崩潰", "消滅", "毀滅",
  "恐慌", "危機", "滅亡", "被取代", "搶走工作", "人類末日",
  "job loss", "replace humans", "threat", "apocalypse", "doom",
  "eliminate jobs", "obsolete", "extinction", "destroy", "crisis",
  "layoff", "fired", "unemployed", "displacement", "disruption",
];

/**
 * 權重標籤定義 — Gemini 會根據新聞內容自動分配最適合的標籤
 */
const WEIGHT_LABEL_DEFINITIONS = `
- "Model Breakthrough": 重大模型發布、架構突破、SOTA 成果（如 GPT-5、Flux 2.0）
- "Inspiration Tip": 創作技巧、Prompt 心法、工作流程優化
- "Industry Shift": 產業趨勢、政策變化、市場動態
- "Creative Tool": 新工具發布、功能更新、平台整合
- "Community Spotlight": 社群作品、藝術家故事、比賽結果
- "Tutorial Guide": 教學指南、入門教程、操作步驟
- "General Update": 不屬於以上分類的一般更新
`;

/**
 * 分類對應表 — 將 Gemini 回傳的分類映射到 DB enum
 */
const CATEGORY_MAP: Record<string, NewsCategory> = {
  product_update: "product_update",
  community_highlight: "community_highlight",
  tutorial: "tutorial",
  industry_news: "industry_news",
  tips_and_tricks: "tips_and_tricks",
};

/**
 * Gemini Flash 批次 OARS NLP 柔化器
 *
 * 一次處理整批新聞（最多 10 篇），回傳結構化的柔化結果。
 * 包含：柔化標題、TL;DR 摘要、權重標籤、技術標籤、分類。
 */
async function batchOarsSoften(
  articles: RawNewsItem[]
): Promise<OarsSoftened[]> {
  if (articles.length === 0) return [];

  logOars("info", `啟動 Gemini Flash OARS NLP 柔化器 — 處理 ${articles.length} 篇文章...`);

  // 構建批次輸入
  const articlesPayload = articles.map((a, i) => ({
    index: i,
    title: a.title,
    content: a.description || a.title,
  }));

  const systemPrompt = `你是「OARS NLP 柔化器」— 一個專為 AI 創作社群設計的新聞轉譯引擎。

## 核心使命
將 AI 科技新聞從「恐嚇性報導」轉譯為「啟發性分享」，讓創作者感到安心、受到啟發。

## 恐嚇性字眼黑名單（必須轉譯）
以下字眼及其同義詞必須被消除，替換為正面、啟發性的表述：
${FEAR_WORDS_BLACKLIST.map(w => `「${w}」`).join("、")}

## 轉譯原則
1. 「AI 取代人類」→「AI 成為創作者的新夥伴」
2. 「大量失業」→「產業正在轉型，新的創作機會正在誕生」
3. 「威脅」→「帶來新的可能性」
4. 「末日/崩潰」→「正在經歷重要的轉變」
5. 保留核心事實資訊，只改變情緒基調
6. 語氣像一位溫暖的朋友在分享好消息

## 權重標籤定義（每篇必須選擇最適合的一個）
${WEIGHT_LABEL_DEFINITIONS}

## 分類定義（每篇必須選擇一個）
- "product_update": 產品更新、版本發布、功能上線
- "community_highlight": 社群作品、藝術家故事
- "tutorial": 教學、指南、入門
- "industry_news": 產業趨勢、市場動態
- "tips_and_tricks": 技巧、心法、工作流程

## 輸出要求
對每篇文章回傳：
1. softenedTitle: 柔化後的繁體中文標題（保留核心資訊，移除恐嚇字眼，20-40字）
2. tldr: TL;DR 柔化摘要（繁體中文，50-80字，溫暖啟發性語氣，像朋友分享好消息）
3. weightLabel: 從上述定義中選擇最適合的權重標籤（英文）
4. tags: 2-5 個技術標籤（如 "Stable Diffusion", "Text-to-Image", "OpenAI" 等）
5. category: 從上述分類中選擇一個（英文 key）

回傳嚴格 JSON 陣列，按照輸入的 index 順序排列。`;

  const userPrompt = `請處理以下 ${articles.length} 篇新聞：

${JSON.stringify(articlesPayload, null, 2)}

回傳格式（嚴格 JSON 陣列）：
[
  {
    "index": 0,
    "softenedTitle": "...",
    "tldr": "...",
    "weightLabel": "Model Breakthrough",
    "tags": ["tag1", "tag2"],
    "category": "industry_news"
  },
  ...
]`;

  try {
    const response = await Promise.race([
      invokeLLM({
        runName: "news-oars-batch",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "oars_batch_result",
            strict: true,
            schema: {
              type: "object",
              properties: {
                results: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      index: { type: "integer", description: "Article index" },
                      softenedTitle: { type: "string", description: "OARS-softened title in Traditional Chinese" },
                      tldr: { type: "string", description: "TL;DR summary, 50-80 chars, warm tone" },
                      weightLabel: {
                        type: "string",
                        enum: [
                          "Model Breakthrough",
                          "Inspiration Tip",
                          "Industry Shift",
                          "Creative Tool",
                          "Community Spotlight",
                          "Tutorial Guide",
                          "General Update",
                        ],
                        description: "Weight label for the article",
                      },
                      tags: {
                        type: "array",
                        items: { type: "string" },
                        description: "2-5 technical tags",
                      },
                      category: {
                        type: "string",
                        enum: [
                          "product_update",
                          "community_highlight",
                          "tutorial",
                          "industry_news",
                          "tips_and_tricks",
                        ],
                        description: "Article category",
                      },
                    },
                    required: ["index", "softenedTitle", "tldr", "weightLabel", "tags", "category"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["results"],
              additionalProperties: false,
            },
          },
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Gemini Flash OARS batch timeout")),
          GEMINI_BATCH_TIMEOUT_MS
        )
      ),
    ]);

    const rawContent = response?.choices?.[0]?.message?.content;
    if (typeof rawContent !== "string") {
      throw new Error("Gemini 回傳內容為空");
    }

    const parsed = JSON.parse(rawContent);
    const results: any[] = parsed.results || parsed;

    if (!Array.isArray(results)) {
      throw new Error("Gemini 回傳格式非陣列");
    }

    logOars("info", `Gemini Flash OARS 柔化完成 — 成功處理 ${results.length} 篇`);

    // Map results back to OarsSoftened array, maintaining original order
    const softenedMap = new Map<number, OarsSoftened>();
    for (const r of results) {
      const validLabel = isValidWeightLabel(r.weightLabel) ? r.weightLabel : "General Update";
      const validCategory = CATEGORY_MAP[r.category] || "industry_news";

      softenedMap.set(r.index, {
        softenedTitle: typeof r.softenedTitle === "string" ? r.softenedTitle : articles[r.index]?.title || "Untitled",
        tldr: typeof r.tldr === "string" ? r.tldr : "",
        weightLabel: validLabel,
        tags: Array.isArray(r.tags) ? r.tags.filter((t: any) => typeof t === "string") : [],
        category: validCategory,
      });
    }

    // Return in original order, with fallbacks for missing indices
    return articles.map((article, i) => {
      if (softenedMap.has(i)) {
        return softenedMap.get(i)!;
      }
      // Fallback for articles not processed by Gemini
      return createFallbackSoftened(article);
    });
  } catch (err: any) {
    logOars("warn", `Gemini Flash 批次柔化失敗：${err.message}。啟動本地 fallback 柔化器...`);
    // Fallback: use local softener for all articles
    return articles.map(createFallbackSoftened);
  }
}

/**
 * 驗證權重標籤是否有效
 */
function isValidWeightLabel(label: any): label is WeightLabel {
  return [
    "Model Breakthrough",
    "Inspiration Tip",
    "Industry Shift",
    "Creative Tool",
    "Community Spotlight",
    "Tutorial Guide",
    "General Update",
  ].includes(label);
}

/**
 * 本地 Fallback 柔化器 — 當 Gemini 不可用時的備援方案
 * 使用正則表達式進行基礎恐嚇字眼替換 + 規則分類
 */
function createFallbackSoftened(article: RawNewsItem): OarsSoftened {
  const title = localSoftenText(article.title);
  const desc = article.description ? localSoftenText(article.description) : title;

  return {
    softenedTitle: title,
    tldr: desc.length > 80 ? desc.substring(0, 77) + "..." : desc,
    weightLabel: classifyWeightLabel(article.title, article.description),
    tags: extractTags(article.title, article.description),
    category: classifyCategory(article.title, article.description),
  };
}

/**
 * 本地恐嚇字眼替換（Gemini 不可用時的 fallback）
 */
function localSoftenText(text: string): string {
  const replacements: [RegExp, string][] = [
    [/replace\s*humans?/gi, "collaborate with creators"],
    [/job\s*loss(es)?|layoffs?|fired|unemploy(ed|ment)/gi, "industry transformation"],
    [/threat(en)?s?/gi, "new possibilities"],
    [/apocalypse|doom|extinction|destroy/gi, "significant evolution"],
    [/crisis|panic|collapse/gi, "important transition"],
    [/obsolete/gi, "evolving"],
    [/eliminate\s*jobs?/gi, "reshape creative roles"],
    [/disrupt(ion|ive)?/gi, "innovative change"],
    [/失業|淘汰/g, "產業轉型"],
    [/取代|被取代/g, "協作夥伴"],
    [/威脅/g, "新可能性"],
    [/末日|崩潰|毀滅|滅亡/g, "重要轉變"],
    [/恐慌|危機/g, "轉型期"],
    [/搶走工作/g, "創造新機會"],
  ];

  let softened = text;
  for (const [pattern, replacement] of replacements) {
    softened = softened.replace(pattern, replacement);
  }
  return softened;
}

/**
 * 本地權重標籤分類（Gemini 不可用時的 fallback）
 */
function classifyWeightLabel(title: string, description: string | null): WeightLabel {
  const text = `${title} ${description || ""}`.toLowerCase();

  if (/breakthrough|sota|state.of.the.art|new model|gpt|claude|gemini|llama/i.test(text)) {
    return "Model Breakthrough";
  }
  if (/tip|trick|prompt|workflow|technique|how to/i.test(text)) {
    return "Inspiration Tip";
  }
  if (/industry|market|policy|regulation|billion|funding|acquisition/i.test(text)) {
    return "Industry Shift";
  }
  if (/tool|app|platform|release|update|feature|launch/i.test(text)) {
    return "Creative Tool";
  }
  if (/community|artist|creator|gallery|showcase|winner|contest/i.test(text)) {
    return "Community Spotlight";
  }
  if (/tutorial|guide|learn|beginner|step.by.step|course/i.test(text)) {
    return "Tutorial Guide";
  }
  return "General Update";
}

/**
 * 本地分類器（Gemini 不可用時的 fallback）
 */
function classifyCategory(title: string, description: string | null): NewsCategory {
  const text = `${title} ${description || ""}`.toLowerCase();

  if (/tutorial|how to|guide|learn|step.by.step|beginner/i.test(text)) {
    return "tutorial";
  }
  if (/tips?|trick|hack|workflow|productivity/i.test(text)) {
    return "tips_and_tricks";
  }
  if (/update|release|launch|announce|version|new feature/i.test(text)) {
    return "product_update";
  }
  if (/community|showcase|artist|creator|gallery|winner/i.test(text)) {
    return "community_highlight";
  }
  return "industry_news";
}

/**
 * 本地標籤提取器（Gemini 不可用時的 fallback）
 */
function extractTags(title: string, description: string | null): string[] {
  const text = `${title} ${description || ""}`.toLowerCase();
  const tagMap: Record<string, string> = {
    "stable diffusion": "Stable Diffusion",
    midjourney: "Midjourney",
    "dall-e": "DALL-E",
    "dall·e": "DALL-E",
    openai: "OpenAI",
    runway: "Runway",
    adobe: "Adobe",
    comfyui: "ComfyUI",
    flux: "Flux",
    sora: "Sora",
    gemini: "Gemini",
    claude: "Claude",
    "generative ai": "Generative AI",
    "text to image": "Text-to-Image",
    "text to video": "Text-to-Video",
    "ai music": "AI Music",
    "ai voice": "AI Voice",
    lora: "LoRA",
    controlnet: "ControlNet",
  };

  const found: string[] = [];
  for (const [keyword, tag] of Object.entries(tagMap)) {
    if (text.includes(keyword) && !found.includes(tag)) {
      found.push(tag);
    }
  }

  return found.length > 0 ? found : ["AI", "Creative"];
}

// ─── Database Writer (with OARS NLP Pipeline) ────────────────────────────────

async function writeArticlesToDb(result: FetchResult): Promise<number> {
  const db = await getDb();
  if (!db) {
    logOars("error", "資料庫連線失敗，無法寫入新聞。");
    return 0;
  }

  // Filter valid articles first
  const validArticles = result.articles.filter(
    (a) => a.title && a.title !== "[Removed]" && a.title.length >= 5
  );

  if (validArticles.length === 0) {
    logOars("warn", "所有文章均不符合品質標準，跳過寫入。");
    return 0;
  }

  // ── Gemini Flash 批次 OARS NLP 柔化 ──
  logOars("info", `準備對 ${validArticles.length} 篇有效文章進行 OARS NLP 柔化處理...`);
  const softenedResults = await batchOarsSoften(validArticles);

  let written = 0;

  for (let i = 0; i < validArticles.length; i++) {
    const article = validArticles[i];
    const softened = softenedResults[i];

    try {
      // Merge weight label into tags array (prepend for visibility)
      const allTags = [softened.weightLabel, ...softened.tags];
      // Deduplicate
      const uniqueTags = Array.from(new Set(allTags));

      await db.insert(newsArticles).values({
        title: softened.softenedTitle.substring(0, 512),
        oarsSummary: softened.tldr,
        bodyMarkdown: article.description || null,
        sourceName: `${article.source} (via ${result.provider === "newsapi" ? "NewsAPI" : "NewsData"})`,
        sourceUrl: article.url,
        coverImageUrl: article.imageUrl,
        category: softened.category,
        tags: uniqueTags,
        isPinned: softened.weightLabel === "Model Breakthrough", // Auto-pin breakthroughs
        isPublished: true,
        publishedAt: article.publishedAt ? new Date(article.publishedAt) : new Date(),
        authorUserId: null,
        viewCount: 0,
      });

      written++;
      logOars(
        "info",
        `  ✅ [${softened.weightLabel}] ${softened.softenedTitle.substring(0, 40)}...`
      );
    } catch (err: any) {
      logOars("warn", `寫入文章「${article.title?.substring(0, 30)}...」失敗：${err.message}`);
    }
  }

  // Log summary
  const labelCounts = new Map<string, number>();
  for (const s of softenedResults) {
    labelCounts.set(s.weightLabel, (labelCounts.get(s.weightLabel) || 0) + 1);
  }
  const labelSummary = Array.from(labelCounts.entries())
    .map(([label, count]) => `${label}: ${count}`)
    .join(" | ");
  logOars("info", `OARS NLP 柔化統計 — ${labelSummary}`);

  return written;
}

// ─── Main Fetch Job ───────────────────────────────────────────────────────────

export async function runNewsFetchJob(): Promise<void> {
  // Deduplication: prevent overlapping runs
  if (isFetchRunning) {
    logOars("warn", "前一輪新聞抓取仍在執行中，跳過本次排程。");
    return;
  }

  // Circuit breaker: stop hammering failed APIs
  if (!newsApiBreaker.canExecute()) {
    logOars("warn", `Circuit breaker OPEN（狀態: ${newsApiBreaker.getState()}），跳過本次排程。`);
    return;
  }

  isFetchRunning = true;
  const startTime = Date.now();
  logOars("info", "═══ 新聞抓取排程啟動（含 Gemini Flash OARS NLP 柔化）═══");

  try {
    const result = await fetchNewsWithFailover();

    if (!result) {
      newsApiBreaker.recordFailure();
      logOars("info", "═══ 新聞抓取排程結束（無資料）═══");
      return;
    }

    const written = await writeArticlesToDb(result);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    newsApiBreaker.recordSuccess();
    logOars(
      "info",
      `═══ 新聞抓取排程完成 ═══ 來源: ${result.provider} | 抓取: ${result.articles.length} 篇 | 柔化+寫入: ${written} 篇 | 耗時: ${elapsed}s`
    );
  } catch (err: any) {
    newsApiBreaker.recordFailure();
    throw err;
  } finally {
    isFetchRunning = false;
  }
}

// ─── Cron Scheduler ───────────────────────────────────────────────────────────

let cronTask: cron.ScheduledTask | null = null;

/**
 * Initialize the news fetcher cron job.
 * Runs every 6 hours: "0 *\/6 * * *"
 * Also performs an initial fetch on startup (delayed 30s to let DB warm up).
 */
export function initNewsFetcherCron(): void {
  const newsApiKey = process.env.NEWS_API_KEY?.trim();
  const newsDataKey = process.env.NEWSDATA_API_KEY?.trim();

  if (!newsApiKey && !newsDataKey) {
    logOars(
      "warn",
      "NEWS_API_KEY 與 NEWSDATA_API_KEY 均未設定。新聞抓取排程將不會啟動。" +
        "請在環境變數中至少設定一組金鑰以啟用首頁新聞功能。"
    );
    return;
  }

  // Schedule: every 6 hours at minute 0
  cronTask = cron.schedule("0 */6 * * *", async () => {
    try {
      await runNewsFetchJob();
    } catch (err: any) {
      logOars("error", `排程執行異常：${err.message}`);
    }
  });

  logOars("info", "新聞抓取排程已註冊 — 每 6 小時執行一次 (含 Gemini Flash OARS NLP 柔化)");

  // Initial fetch after 30s delay (let DB and server warm up)
  setTimeout(async () => {
    logOars("info", "伺服器啟動後首次新聞抓取（含 OARS NLP 柔化）...");
    try {
      await runNewsFetchJob();
    } catch (err: any) {
      logOars("error", `首次抓取異常：${err.message}`);
    }
  }, 30_000);
}

/**
 * Stop the cron job (for graceful shutdown).
 */
export function stopNewsFetcherCron(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    logOars("info", "新聞抓取排程已停止。");
  }
}
