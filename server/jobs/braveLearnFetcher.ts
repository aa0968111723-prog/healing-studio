/**
 * braveLearnFetcher.ts — 每日自動使用 Brave Search 搜尋 AI 相關文章
 *
 * 每天自動執行：
 *   1. 使用 Brave Search API 搜尋 AI 生成、多模態等相關主題文章
 *   2. 使用 Gemini 合成摘要為繁體中文學習文件
 *   3. 自動匯入至學習文件中心（learnHub in-memory store）
 *
 * 排程：每天 04:00 UTC  ("0 4 * * *")
 *
 * 模式：仿照 learnDocSyncer.ts 的 cron 排程模式
 *   - CircuitBreaker 防止 API 連續失敗時過度重試
 *   - 去重鎖防止排程重疊
 */

import * as cron from "node-cron";
import { createHash } from "crypto";
import { invokeLLM } from "../_core/llm";
import { CircuitBreaker } from "./circuitBreaker";
import { ENV } from "../_core/env";
import { serverEnv } from "../_core/env.validated";
import {
  addLearnDoc,
  hasLearnDoc,
  type LearnDoc,
  type DocCategory,
} from "../routers/learnHub";

// ─── Configuration ───────────────────────────────────────────────────────────

/** 每次搜尋幾篇文章 */
const ARTICLES_PER_RUN = 5;

/** Gemini 呼叫逾時（毫秒）— 讀 LLM_TIMEOUT_SECONDS；批次任務預設 90s 比互動式長 */
const LLM_TIMEOUT_MS = (() => {
  const parsed = parseInt(serverEnv.LLM_TIMEOUT_SECONDS, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed * 1000 : 90_000;
})();

/** 啟動後首次同步延遲（毫秒） */
const INITIAL_DELAY_MS = 120_000;

/** 文件標題最大長度 */
const MAX_TITLE_LENGTH = 200;

/** 文件摘要最大長度 */
const MAX_SUMMARY_LENGTH = 500;

/** 每篇文件最多標籤數 */
const MAX_TAGS_PER_DOC = 10;

/** 每日輪替搜尋主題 */
const SEARCH_TOPICS = [
  "AI 生成式模型最新進展 2026",
  "multimodal AI image video generation techniques",
  "AI diffusion model optimization best practices",
  "text to image AI model comparison 2026",
  "AI video generation Kling Runway Sora latest",
  "AI voice synthesis text-to-speech advances",
  "AI LoRA training fine-tuning techniques",
  "generative AI prompt engineering advanced",
  "AI image editing inpainting outpainting tools",
  "multimodal large language model architecture",
];

// ─── State ───────────────────────────────────────────────────────────────────

let cronTask: cron.ScheduledTask | null = null;
let isRunning = false;
const breaker = new CircuitBreaker("BraveLearnFetcher", {
  failureThreshold: 3,
  cooldownMs: 10 * 60_000,
});

function logFetch(level: "info" | "warn" | "error", msg: string) {
  const prefix = "[BraveLearnFetcher]";
  if (level === "error") console.error(prefix, msg);
  else if (level === "warn") console.warn(prefix, msg);
  else console.log(prefix, msg);
}

// ─── Brave Search ────────────────────────────────────────────────────────────

interface BraveSearchResult {
  title: string;
  url: string;
  description: string;
}

async function searchBrave(
  query: string,
  count: number
): Promise<BraveSearchResult[]> {
  const apiKey = ENV.braveSearchApiKey;
  if (!apiKey) {
    logFetch("warn", "BRAVE_SEARCH_API_KEY 未設定，跳過搜尋");
    return [];
  }

  const encoded = encodeURIComponent(query);
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encoded}&count=${count}&freshness=pw`;

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Brave Search API 回傳 ${res.status}: ${res.statusText}`);
  }

  const data = (await res.json()) as {
    web?: {
      results?: Array<{
        title?: string;
        description?: string;
        url?: string;
      }>;
    };
  };

  return (data.web?.results ?? [])
    .filter((r): r is { title: string; description: string; url: string } =>
      Boolean(r.title && r.url && r.description)
    )
    .map(r => ({
      title: r.title,
      url: r.url,
      description: r.description,
    }));
}

// ─── LLM Synthesis ──────────────────────────────────────────────────────────

async function synthesizeArticles(articles: BraveSearchResult[]): Promise<
  Array<{
    title: string;
    summary: string;
    content: string;
    tags: string[];
    category: string;
    difficulty: string;
    readingMinutes: number;
  }>
> {
  if (articles.length === 0) return [];

  const articlesSummary = articles
    .map((a, i) => `${i + 1}. [${a.title}](${a.url})\n   ${a.description}`)
    .join("\n\n");

  const systemPrompt = `你是一位 AI 技術文件撰寫專家。請根據搜尋結果撰寫高品質的繁體中文學習文件。`;

  const userPrompt = `請根據以下搜尋結果，撰寫高品質的繁體中文學習文件。

## 搜尋結果

${articlesSummary}

## 輸出要求

請回傳 JSON 陣列，每篇文件格式如下：
\`\`\`json
[
  {
    "title": "文件標題（50-100 字）",
    "summary": "50-80 字摘要",
    "content": "800-1500 字的繁體中文 Markdown 內容，包含技術細節、使用建議、程式碼範例",
    "tags": ["標籤1", "標籤2", "標籤3"],
    "category": "technique | ai-news | workflow | model-guide",
    "difficulty": "beginner | intermediate | advanced",
    "readingMinutes": 3
  }
]
\`\`\`

限制：
- 最多產出 ${Math.min(articles.length, 5)} 篇文件
- 內容必須為繁體中文
- 每篇標籤 3-5 個
- 閱讀時間 3-15 分鐘
- 僅回傳 JSON 陣列，不要包含其他文字`;

  const result = await invokeLLM({
    runName: "brave-learn-summarize",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    maxTokens: 4096,
    temperature: 0.4,
  });

  // Extract text from result
  const firstChoice = result.choices?.[0];
  const raw =
    typeof firstChoice?.message?.content === "string"
      ? firstChoice.message.content
      : "";

  // Parse JSON from response
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    logFetch("warn", "LLM 回傳無法解析為 JSON");
    return [];
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      title?: string;
      summary?: string;
      content?: string;
      tags?: string[];
      category?: string;
      difficulty?: string;
      readingMinutes?: number;
    }>;

    return parsed
      .filter(d => d.title && d.content)
      .map(d => ({
        title: (d.title ?? "").slice(0, MAX_TITLE_LENGTH),
        summary: (d.summary ?? d.title ?? "").slice(0, MAX_SUMMARY_LENGTH),
        content: d.content ?? "",
        tags: (d.tags ?? []).slice(0, MAX_TAGS_PER_DOC),
        category: d.category ?? "ai-news",
        difficulty: d.difficulty ?? "intermediate",
        readingMinutes: d.readingMinutes ?? 5,
      }));
  } catch {
    logFetch("warn", "JSON 解析失敗");
    return [];
  }
}

// ─── Import to LearnHub ─────────────────────────────────────────────────────

function importToLearnHub(
  docs: Array<{
    title: string;
    summary: string;
    content: string;
    tags: string[];
    category: string;
    difficulty: string;
    readingMinutes: number;
  }>
): number {
  let imported = 0;
  for (const doc of docs) {
    const hash = createHash("md5").update(doc.title).digest("hex").slice(0, 12);
    const docId = `brave-learn-${hash}`;

    if (hasLearnDoc(docId)) {
      logFetch("info", `跳過重複文件: ${doc.title}`);
      continue;
    }

    const learnDoc: LearnDoc = {
      id: docId,
      title: doc.title,
      summary: doc.summary,
      content: doc.content,
      tags: doc.tags,
      category: doc.category as DocCategory,
      difficulty: doc.difficulty as "beginner" | "intermediate" | "advanced",
      readingMinutes: doc.readingMinutes,
      publishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      featured: false,
      authorName: "AI 自動學習合成",
    };

    addLearnDoc(learnDoc);
    imported++;
    logFetch("info", `✅ 已匯入: ${doc.title}`);
  }
  return imported;
}

// ─── Main Job ───────────────────────────────────────────────────────────────

async function runBraveLearnFetchJob(): Promise<void> {
  if (isRunning) {
    logFetch("info", "上次執行尚未結束，跳過本次");
    return;
  }
  if (!breaker.canExecute()) {
    logFetch("warn", "Circuit breaker 開啟中，跳過執行");
    return;
  }
  if (!ENV.braveSearchApiKey) {
    logFetch("warn", "BRAVE_SEARCH_API_KEY 未設定，跳過每日學習文件搜尋");
    return;
  }

  isRunning = true;
  logFetch("info", "開始每日 Brave Search 學習文件搜尋...");

  try {
    // Pick today's topic (rotate through topics by day of year)
    const dayOfYear = Math.floor(
      (Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) /
        86400000
    );
    const topic = SEARCH_TOPICS[dayOfYear % SEARCH_TOPICS.length];

    logFetch("info", `今日搜尋主題: ${topic}`);

    // Step 1: Search via Brave
    const articles = await searchBrave(topic, ARTICLES_PER_RUN);
    logFetch("info", `找到 ${articles.length} 篇文章`);

    if (articles.length === 0) {
      logFetch("warn", "Brave Search 未找到文章，跳過合成");
      breaker.recordSuccess();
      return;
    }

    // Step 2: Synthesize via LLM
    const docs = await synthesizeArticles(articles);
    logFetch("info", `LLM 合成了 ${docs.length} 篇學習文件`);

    // Step 3: Import to LearnHub
    const imported = importToLearnHub(docs);
    logFetch("info", `成功匯入 ${imported} 篇文件至學習文件中心`);

    breaker.recordSuccess();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logFetch("error", `執行失敗: ${message}`);
    breaker.recordFailure();
  } finally {
    isRunning = false;
  }
}

// ─── Cron Initialization ────────────────────────────────────────────────────

/**
 * Initialize the daily Brave Search learn fetcher cron job.
 * Runs every day at 04:00 UTC: "0 4 * * *"
 */
export function initBraveLearnFetcherCron(): void {
  cronTask = cron.schedule("0 4 * * *", async () => {
    try {
      await runBraveLearnFetchJob();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logFetch("error", `排程執行異常: ${message}`);
    }
  });

  logFetch(
    "info",
    "每日 Brave Search 學習文件搜尋排程已註冊 — 每天 04:00 UTC 執行"
  );

  // Initial fetch after 2 min delay (let server warm up)
  setTimeout(async () => {
    logFetch("info", "伺服器啟動後首次 Brave Search 學習文件搜尋...");
    try {
      await runBraveLearnFetchJob();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logFetch("error", `首次搜尋異常: ${message}`);
    }
  }, INITIAL_DELAY_MS);
}

/**
 * Stop the cron job (for graceful shutdown).
 */
export function stopBraveLearnFetcherCron(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    logFetch("info", "每日 Brave Search 學習文件搜尋排程已停止");
  }
}
