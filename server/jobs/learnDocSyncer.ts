/**
 * learnDocSyncer.ts — 學習文件自動同步排程
 *
 * 每週自動執行：
 *   1. 從 news_articles 表讀取近 7 天的 AI 新聞
 *   2. 使用 Gemini 將新聞合成深度學習文件（繁體中文 Markdown）
 *   3. 自動匯入至學習文件中心（learnHub in-memory store）
 *
 * 排程：每週一 03:00 UTC  ("0 3 * * 1")
 *
 * 模式：仿照 newsFetcher.ts 的 cron 排程模式
 *   - CircuitBreaker 防止 LLM API 連續失敗時過度重試
 *   - 去重鎖防止排程重疊
 */

import * as cron from "node-cron";
import { createHash } from "crypto";
import { getDb } from "../db";
import { newsArticles } from "../../drizzle/schema";
import { invokeLLM, extractMessageText } from "../_core/llm";
import { gte, desc, and, eq } from "drizzle-orm";
import { CircuitBreaker } from "./circuitBreaker";
import { serverEnv } from "../_core/env.validated";
import { addLearnDoc, hasLearnDoc } from "../routers/learnHub";
import type { LearnDoc, DocCategory } from "../routers/learnHub.seed";

// ─── Configuration ───────────────────────────────────────────────────────────

/** 抓取近幾天的新聞作為合成素材 */
const LOOKBACK_DAYS = 7;

/** 每次最多合成幾篇學習文件 */
const MAX_DOCS_PER_RUN = 3;

/** Gemini 呼叫逾時（毫秒）— 批次任務強制至少 120s，避免 60s 環境值導致大型 JSON 輸出超時 */
const LLM_TIMEOUT_MS = (() => {
  const parsed = parseInt(serverEnv.LLM_TIMEOUT_SECONDS, 10);
  const fromEnv = Number.isFinite(parsed) && parsed > 0 ? parsed * 1000 : 90_000;
  return Math.max(fromEnv, 120_000);
})();

/** 啟動後首次同步延遲（毫秒） */
const INITIAL_SYNC_DELAY_MS = 60_000;

/** 文件標題最大長度 */
const MAX_TITLE_LENGTH = 200;

/** 文件摘要最大長度 */
const MAX_SUMMARY_LENGTH = 500;

/** 每篇文件最多標籤數 */
const MAX_TAGS_PER_DOC = 10;

/** 閱讀時間範圍與預設值（分鐘） */
const MIN_READING_MINUTES = 1;
const MAX_READING_MINUTES = 120;
const DEFAULT_READING_MINUTES = 8;

// ─── State ──────────────────────────────────────────────────────────────────

let cronTask: cron.ScheduledTask | null = null;

const llmBreaker = new CircuitBreaker("LearnDocSyncer", {
  failureThreshold: 3,
  cooldownMs: 30 * 60_000, // 30 minutes cooldown
});

let isSyncRunning = false;

// ─── Logger ─────────────────────────────────────────────────────────────────

function logSync(level: "info" | "warn" | "error", message: string): void {
  const icon = level === "info" ? "📚" : level === "warn" ? "⚠️" : "❌";
  console[level](`[LearnDocSyncer] ${icon} ${message}`);
}

// ─── Interfaces ─────────────────────────────────────────────────────────────

interface NewsRow {
  id: number;
  title: string;
  oarsSummary: string;
  bodyMarkdown: string | null;
  category: string;
  tags: string[] | null;
  publishedAt: Date | null;
}

interface SynthesizedDoc {
  title: string;
  summary: string;
  content: string;
  tags: string[];
  difficulty: "beginner" | "intermediate" | "advanced";
  readingMinutes: number;
  category: DocCategory;
}

// ─── Step 1: Fetch recent news from DB ──────────────────────────────────────

async function fetchRecentNews(): Promise<NewsRow[]> {
  const db = await getDb();
  if (!db) {
    logSync("error", "資料庫連線失敗，無法讀取新聞。");
    return [];
  }

  const since = new Date();
  since.setDate(since.getDate() - LOOKBACK_DAYS);

  const rows = await db
    .select({
      id: newsArticles.id,
      title: newsArticles.title,
      oarsSummary: newsArticles.oarsSummary,
      bodyMarkdown: newsArticles.bodyMarkdown,
      category: newsArticles.category,
      tags: newsArticles.tags,
      publishedAt: newsArticles.publishedAt,
    })
    .from(newsArticles)
    .where(
      and(
        eq(newsArticles.isPublished, true),
        gte(newsArticles.publishedAt, since)
      )
    )
    .orderBy(desc(newsArticles.publishedAt))
    .limit(20);

  return rows as NewsRow[];
}

// ─── Step 2: Synthesize deep-dive docs via Gemini ───────────────────────────

async function synthesizeDeepDiveDocs(
  newsItems: NewsRow[]
): Promise<SynthesizedDoc[]> {
  if (newsItems.length === 0) return [];

  // Build a summary of recent news for the LLM
  const newsSummary = newsItems
    .map(
      (n, i) =>
        `${i + 1}. 【${n.category}】${n.title}\n   摘要：${n.oarsSummary}\n   標籤：${(n.tags ?? []).join(", ")}`
    )
    .join("\n\n");

  const prompt = `你是 Healing Studio 學習文件中心的自動編輯器。
以下是本週抓取到的 ${newsItems.length} 篇 AI 新聞摘要：

${newsSummary}

請根據以上新聞，合成 ${MAX_DOCS_PER_RUN} 篇深度學習文件。

要求：
1. 每篇文件須為 **繁體中文** 的完整 Markdown 教學文章（800–1500 字）
2. 文件分類（category）必須是以下其中一種：technique, ai-news, workflow, model-guide
3. 難度（difficulty）：beginner / intermediate / advanced
4. 包含實際操作步驟或創作建議（不要只是新聞摘要）
5. 標題要吸引人、摘要控制在 50-80 字
6. 每篇文件提供 3-5 個標籤（繁體中文）
7. 估算閱讀時間（readingMinutes，3-15 分鐘）

回覆格式（嚴格 JSON 陣列，不要包含任何其他文字）：
[
  {
    "title": "文章標題",
    "summary": "50-80 字摘要",
    "content": "完整 Markdown 內容（800-1500 字）",
    "tags": ["標籤1", "標籤2", "標籤3"],
    "difficulty": "intermediate",
    "readingMinutes": 8,
    "category": "technique"
  }
]`;

  try {
    const llmPromise = invokeLLM({
      messages: [
        {
          role: "system",
          content:
            "你是專業的 AI 創作教學文件編輯器。回覆必須是合法的 JSON 陣列，不包含 markdown 程式碼塊標記。",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      maxTokens: 8192,  // 防止 Gemini MAX_TOKENS 截斷導致 JSON 不完整（原省略，預設 8192 够容納 3 篇文件）
      runName: "learn-doc-syncer-weekly",
    });

    // Apply timeout to prevent indefinite hangs
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`LLM 呼叫逾時（${LLM_TIMEOUT_MS}ms）`)),
        LLM_TIMEOUT_MS
      )
    );

    const result = await Promise.race([llmPromise, timeoutPromise]);

    const text = extractMessageText(
      result.choices?.[0]?.message?.content
    ).trim();

    // Strip potential markdown code block wrappers
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();

    // JSON 修復：如果 Gemini 回傳被 MAX_TOKENS 截斷，嘗試修復截斷的 JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // 嘗試截取到最後一個完整的 } 來修復截斷 JSON
      const lastBrace = cleaned.lastIndexOf("}");
      if (lastBrace > 0) {
        try {
          parsed = JSON.parse(cleaned.slice(0, lastBrace + 1) + "]");
          logSync("warn", "Gemini JSON 被截斷，已自動修復");
        } catch {
          logSync("warn", "× Gemini 合成學習文件失敗: 回傳 JSON 無法解析就算修復");
          return [];
        }
      } else {
        logSync("warn", "× Gemini 合成學習文件失敗: 回傳 JSON 無法解析");
        return [];
      }
    }

    if (!Array.isArray(parsed)) {
      logSync("warn", "Gemini 回覆不是陣列格式");
      return [];
    }

    const validCategories = [
      "getting-started",
      "model-guide",
      "api-docs",
      "technique",
      "ai-news",
      "workflow",
    ];
    const validDifficulties = ["beginner", "intermediate", "advanced"];

    return parsed
      .filter(
        (d: any) =>
          d.title &&
          d.summary &&
          d.content &&
          validCategories.includes(d.category)
      )
      .map((d: any) => ({
        title: String(d.title).substring(0, MAX_TITLE_LENGTH),
        summary: String(d.summary).substring(0, MAX_SUMMARY_LENGTH),
        content: String(d.content),
        tags: Array.isArray(d.tags)
          ? d.tags.map(String).slice(0, MAX_TAGS_PER_DOC)
          : ["AI", "自動生成"],
        difficulty: validDifficulties.includes(d.difficulty)
          ? (d.difficulty as SynthesizedDoc["difficulty"])
          : "intermediate",
        readingMinutes: Math.max(
          MIN_READING_MINUTES,
          Math.min(
            MAX_READING_MINUTES,
            Number(d.readingMinutes) || DEFAULT_READING_MINUTES
          )
        ),
        category: d.category as DocCategory,
      }))
      .slice(0, MAX_DOCS_PER_RUN);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logSync("error", `Gemini 合成學習文件失敗: ${msg}`);
    return [];
  }
}

// ─── Step 3: Import synthesized docs into learn hub ─────────────────────────

function importDocsToLearnHub(synthesized: SynthesizedDoc[]): number {
  let imported = 0;
  const now = new Date().toISOString();

  for (const doc of synthesized) {
    // Generate deterministic ID based on title hash to prevent duplicates
    const idHash = contentHash(doc.title);
    const docId = `auto-${idHash}`;

    if (hasLearnDoc(docId)) {
      logSync("info", `跳過已存在的文件: ${doc.title.substring(0, 40)}...`);
      continue;
    }

    const learnDoc: LearnDoc = {
      id: docId,
      category: doc.category,
      title: doc.title,
      summary: doc.summary,
      content: doc.content,
      tags: [...doc.tags, "自動同步"],
      difficulty: doc.difficulty,
      readingMinutes: doc.readingMinutes,
      publishedAt: now,
      updatedAt: now,
      featured: false,
      authorName: "AI 自動編輯器",
    };

    addLearnDoc(learnDoc);
    imported++;
    logSync("info", `  ✅ 匯入文件: ${doc.title.substring(0, 50)}`);
  }

  return imported;
}

// ─── Helper: Deterministic content hash ─────────────────────────────────────

function contentHash(str: string): string {
  return createHash("sha256").update(str).digest("hex").substring(0, 12);
}

// ─── Main Sync Job ──────────────────────────────────────────────────────────

export async function runLearnDocSyncJob(): Promise<void> {
  if (isSyncRunning) {
    logSync("warn", "前一輪同步仍在執行中，跳過本次排程。");
    return;
  }

  if (!llmBreaker.canExecute()) {
    logSync(
      "warn",
      `Circuit breaker OPEN（狀態: ${llmBreaker.getState()}），跳過本次排程。`
    );
    return;
  }

  isSyncRunning = true;
  logSync("info", "═══ 學習文件自動同步開始 ═══");

  try {
    // Step 1: Fetch recent news
    const newsItems = await fetchRecentNews();
    logSync("info", `取得 ${newsItems.length} 篇近 ${LOOKBACK_DAYS} 天新聞`);

    if (newsItems.length === 0) {
      logSync("info", "無新聞資料，本週跳過合成。");
      llmBreaker.recordSuccess();
      return;
    }

    // Step 2: Synthesize deep-dive docs via Gemini
    const synthesized = await synthesizeDeepDiveDocs(newsItems);
    logSync("info", `Gemini 合成了 ${synthesized.length} 篇學習文件`);

    if (synthesized.length === 0) {
      logSync("warn", "Gemini 未能合成有效文件。");
      // Don't count as failure — might be a content issue, not API failure
      llmBreaker.recordSuccess();
      return;
    }

    // Step 3: Import into learn hub
    const imported = importDocsToLearnHub(synthesized);
    logSync(
      "info",
      `成功匯入 ${imported} 篇新文件（跳過 ${synthesized.length - imported} 篇已存在的文件）`
    );

    llmBreaker.recordSuccess();
    logSync("info", "═══ 學習文件自動同步完成 ═══");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logSync("error", `同步執行異常: ${msg}`);
    llmBreaker.recordFailure();
  } finally {
    isSyncRunning = false;
  }
}

// ─── Cron Initialization ────────────────────────────────────────────────────

/**
 * Initialize the learn doc syncer cron job.
 * Runs every Monday at 03:00 UTC: "0 3 * * 1"
 */
export function initLearnDocSyncerCron(): void {
  // Schedule: every Monday at 03:00 UTC
  cronTask = cron.schedule("0 3 * * 1", async () => {
    try {
      await runLearnDocSyncJob();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logSync("error", `排程執行異常: ${message}`);
    }
  });

  logSync(
    "info",
    "學習文件自動同步排程已註冊 — 每週一 03:00 UTC 執行（從新聞合成深度學習文件）"
  );

  // Initial sync after 60s delay (let DB, news fetcher, and server warm up)
  setTimeout(async () => {
    logSync("info", "伺服器啟動後首次學習文件同步...");
    try {
      await runLearnDocSyncJob();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logSync("error", `首次同步異常: ${message}`);
    }
  }, INITIAL_SYNC_DELAY_MS);
}

/**
 * Stop the cron job (for graceful shutdown).
 */
export function stopLearnDocSyncerCron(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    logSync("info", "學習文件自動同步排程已停止");
  }
}
