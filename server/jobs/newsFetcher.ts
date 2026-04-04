/**
 * newsFetcher.ts — 首頁新聞雙活備援排程 (Dual Fail-over News Fetcher)
 *
 * 每 6 小時自動抓取 AI 創作相關新聞，寫入 news_articles 表。
 *
 * 主從備援機制 (Fail-over Strategy):
 *   主要來源: NewsAPI.org  (NEWS_API_KEY)
 *   備援來源: NewsData.io  (NEWSDATA_API_KEY)
 *
 * 若主要來源遭遇 Rate Limit (429)、Server Error (5xx) 或網路超時，
 * 系統自動 Catch 並優雅切換至備援來源，確保首頁情報板塊 99.9% 永不斷線。
 */

import * as cron from "node-cron";
import { getDb } from "../db";
import { newsArticles } from "../../drizzle/schema";
import { invokeLLM } from "../_core/llm";
import { eq } from "drizzle-orm";

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
const OARS_SUMMARY_TIMEOUT_MS = 30_000;

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

// ─── OARS Summary Generator (LLM) ────────────────────────────────────────────

async function generateOarsSummary(
  title: string,
  description: string | null
): Promise<string> {
  const content = description || title;

  try {
    const response = await Promise.race([
      invokeLLM({
        messages: [
          {
            role: "system",
            content: `你是一位溫暖、專業的 AI 創作新聞編輯。
請將以下新聞用 OARS 柔化語氣改寫為一段 TL;DR 摘要（50-80 字）。
要求：
- 語氣溫暖、低焦慮，像朋友分享好消息
- 使用繁體中文
- 避免驚嘆號和誇張用語
- 保留核心資訊但讓讀者感到安心
只回傳摘要文字，不要加任何前綴或標記。`,
          },
          {
            role: "user",
            content: `標題：${title}\n內容：${content}`,
          },
        ],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("OARS summary LLM timeout")),
          OARS_SUMMARY_TIMEOUT_MS
        )
      ),
    ]);

    const rawContent = response?.choices?.[0]?.message?.content;
    const summary = typeof rawContent === "string" ? rawContent.trim() : undefined;
    if (summary && summary.length > 0) return summary;
  } catch (err: any) {
    logOars("warn", `LLM 摘要生成失敗：${err.message}，使用原始描述作為摘要。`);
  }

  // Fallback: use original description or title
  return description
    ? description.substring(0, 200)
    : `${title} — 更多詳情請點擊閱讀。`;
}

// ─── Category Classifier ─────────────────────────────────────────────────────

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

// ─── Database Writer ──────────────────────────────────────────────────────────

async function writeArticlesToDb(result: FetchResult): Promise<number> {
  const db = await getDb();
  if (!db) {
    logOars("error", "資料庫連線失敗，無法寫入新聞。");
    return 0;
  }

  let written = 0;

  for (const article of result.articles) {
    try {
      // Skip articles without meaningful titles
      if (!article.title || article.title === "[Removed]" || article.title.length < 5) {
        continue;
      }

      // Generate OARS-style summary
      const oarsSummary = await generateOarsSummary(
        article.title,
        article.description
      );

      // Classify category
      const category = classifyCategory(article.title, article.description);

      // Extract tags from title
      const tags = extractTags(article.title, article.description);

      await db.insert(newsArticles).values({
        title: article.title.substring(0, 512),
        oarsSummary,
        bodyMarkdown: article.description || null,
        sourceName: `${article.source} (via ${result.provider === "newsapi" ? "NewsAPI" : "NewsData"})`,
        sourceUrl: article.url,
        coverImageUrl: article.imageUrl,
        category,
        tags,
        isPinned: false,
        isPublished: true,
        publishedAt: article.publishedAt ? new Date(article.publishedAt) : new Date(),
        authorUserId: null,
        viewCount: 0,
      });

      written++;
    } catch (err: any) {
      logOars("warn", `寫入文章「${article.title?.substring(0, 30)}...」失敗：${err.message}`);
    }
  }

  return written;
}

// ─── Tag Extractor ────────────────────────────────────────────────────────────

function extractTags(title: string, description: string | null): string[] {
  const text = `${title} ${description || ""}`.toLowerCase();
  const tagMap: Record<string, string> = {
    "stable diffusion": "Stable Diffusion",
    midjourney: "Midjourney",
    "dall-e": "DALL-E",
    "dall·e": "DALL-E",
    openai: "OpenAI",
    "runway": "Runway",
    "adobe": "Adobe",
    "comfyui": "ComfyUI",
    "flux": "Flux",
    "sora": "Sora",
    "gemini": "Gemini",
    "claude": "Claude",
    "generative ai": "Generative AI",
    "text to image": "Text-to-Image",
    "text to video": "Text-to-Video",
    "ai music": "AI Music",
    "ai voice": "AI Voice",
    "lora": "LoRA",
    "controlnet": "ControlNet",
  };

  const found: string[] = [];
  for (const [keyword, tag] of Object.entries(tagMap)) {
    if (text.includes(keyword) && !found.includes(tag)) {
      found.push(tag);
    }
  }

  return found.length > 0 ? found : ["AI", "Creative"];
}

// ─── Main Fetch Job ───────────────────────────────────────────────────────────

export async function runNewsFetchJob(): Promise<void> {
  const startTime = Date.now();
  logOars("info", "═══ 新聞抓取排程啟動 ═══");

  const result = await fetchNewsWithFailover();

  if (!result) {
    logOars("info", "═══ 新聞抓取排程結束（無資料）═══");
    return;
  }

  const written = await writeArticlesToDb(result);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  logOars(
    "info",
    `═══ 新聞抓取排程完成 ═══ 來源: ${result.provider} | 抓取: ${result.articles.length} 篇 | 寫入: ${written} 篇 | 耗時: ${elapsed}s`
  );
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

  logOars("info", "新聞抓取排程已註冊 — 每 6 小時執行一次 (0 */6 * * *)");

  // Initial fetch after 30s delay (let DB and server warm up)
  setTimeout(async () => {
    logOars("info", "伺服器啟動後首次新聞抓取...");
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
