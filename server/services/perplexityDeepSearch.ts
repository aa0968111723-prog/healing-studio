/**
 * server/services/perplexityDeepSearch.ts
 *
 * 專用的 Perplexity 深度搜尋服務 — 讓光球代理能透過 Perplexity Sonar API
 * 進行外部網路搜尋，取得即時、有引用來源的搜尋結果。
 *
 * 與現有 `orbWebResearch.ts` 的差異：
 *   - orbWebResearch 是「被動觸發」：只在使用者訊息符合 RESEARCH_PATTERNS 時才觸發
 *   - perplexityDeepSearch 是「主動工具」：由 planner 或光球明確決定要搜尋時呼叫
 *   - 支援更豐富的搜尋參數（search_recency_filter、search_domain_filter 等）
 *   - 回傳結構化的搜尋結果，可直接注入光球回覆或存入學習文件中心
 *
 * 設計原則：
 *   1. 受 perplexityThrottle 統一管控（feature = "web_search"）
 *   2. 多層 fallback：Perplexity Native → OpenRouter Sonar → Brave Search
 *   3. 結果可選擇性寫入學習文件中心（addToLearnHub）
 *   4. 支援 per-user 節流，避免濫用
 */

import {
  checkPerplexityThrottle,
  recordPerplexityCall,
  describeThrottleReason,
  type ThrottleDenyReason,
} from "./perplexityThrottle";
import { serverEnv } from "../_core/env.validated";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DeepSearchQuery {
  /** 使用者的搜尋查詢（自然語言） */
  query: string;
  /** 搜尋時間範圍過濾 */
  recencyFilter?: "day" | "week" | "month" | "year";
  /** 限定搜尋的網域（最多 3 個） */
  domainFilter?: string[];
  /** 搜尋語言偏好 */
  language?: "zh-TW" | "zh-CN" | "en" | "ja" | "ko";
  /** 最大結果數量 */
  maxResults?: number;
  /** 是否將結果寫入學習文件中心 */
  addToLearnHub?: boolean;
  /** 呼叫者的 userId（用於 per-user 節流） */
  userId?: number | null;
}

export interface DeepSearchSource {
  title: string;
  url: string;
  snippet: string;
  domain?: string;
  publishedDate?: string;
}

export interface DeepSearchResult {
  ok: boolean;
  /** 搜尋摘要（Perplexity 生成的綜合回答） */
  summary: string;
  /** 引用來源列表 */
  sources: DeepSearchSource[];
  /** 搜尋提供者 */
  provider: "perplexity-native" | "openrouter-sonar" | "brave" | "none";
  /** 搜尋耗時（毫秒） */
  durationMs: number;
  /** 錯誤訊息（如果有） */
  error?: string;
  /** 節流拒絕原因 */
  throttleReason?: ThrottleDenyReason;
  /** 學習文件 ID（如果已寫入學習文件中心） */
  learnDocIds?: string[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";
const DEFAULT_MAX_RESULTS = 5;
const SEARCH_TIMEOUT_MS = 20_000;

// ─── Helpers ────────────────────────────────────────────────────────────────

function getPerplexityApiKey(): string | undefined {
  return (
    process.env.PERPLEXITY_API_KEY ??
    serverEnv.PERPLEXITY_API_KEY ??
    undefined
  );
}

function getOpenRouterApiKey(): string | undefined {
  return (
    process.env.OPENROUTER_API_KEY ??
    (serverEnv as Record<string, string | undefined>).OPENROUTER_API_KEY ??
    undefined
  );
}

function getBraveSearchApiKey(): string | undefined {
  return (
    process.env.BRAVE_SEARCH_API_KEY ??
    serverEnv.BRAVE_SEARCH_API_KEY ??
    undefined
  );
}

/**
 * 建構 Perplexity 搜尋用的系統提示詞。
 * 根據語言偏好調整回覆語言。
 */
function buildSearchSystemPrompt(language?: string): string {
  const langHint =
    language === "zh-TW" || language === "zh-CN"
      ? "請用繁體中文回答。"
      : language === "ja"
        ? "日本語で回答してください。"
        : language === "ko"
          ? "한국어로 답변해 주세요."
          : "Reply in English.";

  return [
    "You are a research assistant performing web searches for users.",
    "Provide a concise, factual summary (under 500 characters) of the search results.",
    "Focus on the most recent and relevant information.",
    "Always cite your sources.",
    langHint,
  ].join(" ");
}

/**
 * 從 URL 提取網域名稱。
 */
function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ─── Core Search Functions ──────────────────────────────────────────────────

/**
 * 透過 Perplexity Native API 搜尋。
 */
async function searchViaPerplexityNative(
  query: string,
  options: {
    recencyFilter?: string;
    domainFilter?: string[];
    language?: string;
    maxResults?: number;
  }
): Promise<{ summary: string; sources: DeepSearchSource[] } | null> {
  const apiKey = getPerplexityApiKey();
  if (!apiKey) return null;

  const body: Record<string, unknown> = {
    model: "sonar-pro",
    messages: [
      { role: "system", content: buildSearchSystemPrompt(options.language) },
      { role: "user", content: query },
    ],
    max_tokens: 800,
    temperature: 0.2,
    return_related_questions: false,
  };

  // 加入搜尋過濾參數
  if (options.recencyFilter) {
    body.search_recency_filter = options.recencyFilter;
  }
  if (options.domainFilter && options.domainFilter.length > 0) {
    body.search_domain_filter = options.domainFilter.slice(0, 3);
  }

  const res = await fetch(PERPLEXITY_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    console.warn(
      `[DeepSearch] Perplexity Native API returned ${res.status}: ${res.statusText}`
    );
    return null;
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    search_results?: Array<{
      title?: string;
      url?: string;
      snippet?: string;
      date?: string;
    }>;
    citations?: string[];
  };

  const summary = (data.choices?.[0]?.message?.content ?? "").trim();
  const sources: DeepSearchSource[] = [];

  // 優先使用 search_results 欄位
  if (data.search_results && data.search_results.length > 0) {
    for (const item of data.search_results.slice(
      0,
      options.maxResults ?? DEFAULT_MAX_RESULTS
    )) {
      if (item.url) {
        sources.push({
          title: item.title ?? extractDomain(item.url),
          url: item.url,
          snippet: item.snippet ?? summary.slice(0, 200),
          domain: extractDomain(item.url),
          publishedDate: item.date,
        });
      }
    }
  }
  // 備援：使用 citations URL 陣列
  else if (data.citations && data.citations.length > 0) {
    for (const url of data.citations.slice(
      0,
      options.maxResults ?? DEFAULT_MAX_RESULTS
    )) {
      try {
        const domain = extractDomain(url);
        sources.push({
          title: domain,
          url,
          snippet: summary.slice(0, 200),
          domain,
        });
      } catch {
        // 無效 URL — 略過
      }
    }
  }

  return { summary, sources };
}

/**
 * 透過 OpenRouter 的 Perplexity Sonar 搜尋（備援）。
 */
async function searchViaOpenRouterSonar(
  query: string,
  options: {
    language?: string;
    maxResults?: number;
  }
): Promise<{ summary: string; sources: DeepSearchSource[] } | null> {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) return null;

  const baseUrl = (
    process.env.OPENROUTER_BASE_URL ||
    (serverEnv as Record<string, string | undefined>).OPENROUTER_BASE_URL ||
    "https://openrouter.ai/api/v1"
  ).replace(/\/$/, "");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "perplexity/sonar-pro",
      messages: [
        {
          role: "system",
          content: buildSearchSystemPrompt(options.language),
        },
        { role: "user", content: query },
      ],
      response_format: { type: "json_object" },
      max_tokens: 800,
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });

  if (!res.ok) return null;

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  if (!content) return null;

  try {
    const parsed = JSON.parse(content) as {
      summary?: string;
      results?: Array<{
        title?: string;
        url?: string;
        summary?: string;
        snippet?: string;
      }>;
    };
    const summary = parsed.summary ?? content.slice(0, 500);
    const sources: DeepSearchSource[] = [];
    for (const item of (parsed.results ?? []).slice(
      0,
      options.maxResults ?? DEFAULT_MAX_RESULTS
    )) {
      if (item.url) {
        sources.push({
          title: item.title ?? extractDomain(item.url),
          url: item.url,
          snippet: item.snippet ?? item.summary ?? "",
          domain: extractDomain(item.url),
        });
      }
    }
    return { summary, sources };
  } catch {
    return { summary: content.slice(0, 500), sources: [] };
  }
}

/**
 * 透過 Brave Search API 搜尋（第三層備援）。
 */
async function searchViaBrave(
  query: string,
  options: {
    maxResults?: number;
  }
): Promise<{ summary: string; sources: DeepSearchSource[] } | null> {
  const apiKey = getBraveSearchApiKey();
  if (!apiKey) return null;

  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
  const encoded = encodeURIComponent(query);
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encoded}&count=${maxResults}`;

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) return null;

  const data = (await res.json()) as {
    web?: {
      results?: Array<{
        title?: string;
        description?: string;
        url?: string;
      }>;
    };
  };

  const results = data.web?.results ?? [];
  if (results.length === 0) return null;

  const sources: DeepSearchSource[] = results
    .filter((r) => r.title && r.url)
    .slice(0, maxResults)
    .map((r) => ({
      title: r.title!,
      url: r.url!,
      snippet: r.description ?? "",
      domain: extractDomain(r.url!),
    }));

  const summary = sources
    .slice(0, 3)
    .map((s) => s.snippet)
    .join(" ")
    .slice(0, 500);

  return { summary, sources };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * 執行 Perplexity 深度搜尋。
 *
 * 多層 fallback 策略：
 *   1. Perplexity Native API（最佳品質，含 search_results）
 *   2. OpenRouter Sonar（備援，透過 OpenRouter 轉接）
 *   3. Brave Search（最後備援，純搜尋引擎結果）
 *
 * 所有路徑都受 perplexityThrottle 統一管控。
 */
export async function executeDeepSearch(
  input: DeepSearchQuery
): Promise<DeepSearchResult> {
  const startTime = Date.now();
  const maxResults = input.maxResults ?? DEFAULT_MAX_RESULTS;

  // ── 節流檢查 ──────────────────────────────────────────────────────
  const throttleCheck = checkPerplexityThrottle({
    feature: "web_search",
    userId: input.userId ?? null,
  });

  if (!throttleCheck.allowed) {
    return {
      ok: false,
      summary: "",
      sources: [],
      provider: "none",
      durationMs: Date.now() - startTime,
      error: describeThrottleReason(throttleCheck.reason!),
      throttleReason: throttleCheck.reason,
    };
  }

  // ── 嘗試 Perplexity Native API ────────────────────────────────────
  try {
    const result = await searchViaPerplexityNative(input.query, {
      recencyFilter: input.recencyFilter,
      domainFilter: input.domainFilter,
      language: input.language ?? "zh-TW",
      maxResults,
    });

    if (result && (result.summary || result.sources.length > 0)) {
      recordPerplexityCall({
        feature: "web_search",
        userId: input.userId ?? null,
      });
      return {
        ok: true,
        summary: result.summary,
        sources: result.sources,
        provider: "perplexity-native",
        durationMs: Date.now() - startTime,
      };
    }
  } catch (err) {
    console.warn("[DeepSearch] Perplexity Native failed:", err);
  }

  // ── 嘗試 OpenRouter Sonar ─────────────────────────────────────────
  try {
    const result = await searchViaOpenRouterSonar(input.query, {
      language: input.language ?? "zh-TW",
      maxResults,
    });

    if (result && (result.summary || result.sources.length > 0)) {
      recordPerplexityCall({
        feature: "web_search",
        userId: input.userId ?? null,
      });
      return {
        ok: true,
        summary: result.summary,
        sources: result.sources,
        provider: "openrouter-sonar",
        durationMs: Date.now() - startTime,
      };
    }
  } catch (err) {
    console.warn("[DeepSearch] OpenRouter Sonar failed:", err);
  }

  // ── 嘗試 Brave Search ────────────────────────────────────────────
  try {
    const result = await searchViaBrave(input.query, { maxResults });

    if (result && result.sources.length > 0) {
      return {
        ok: true,
        summary: result.summary,
        sources: result.sources,
        provider: "brave",
        durationMs: Date.now() - startTime,
      };
    }
  } catch (err) {
    console.warn("[DeepSearch] Brave Search failed:", err);
  }

  // ── 全部失敗 ──────────────────────────────────────────────────────
  return {
    ok: false,
    summary: "",
    sources: [],
    provider: "none",
    durationMs: Date.now() - startTime,
    error: "所有搜尋提供者均無法取得結果，請稍後再試。",
  };
}

/**
 * 將深度搜尋結果格式化為光球系統提示詞區塊。
 */
export function formatDeepSearchForPrompt(
  result: DeepSearchResult,
  mode: "agent" | "qna" = "agent"
): string {
  if (!result.ok || result.sources.length === 0) return "";

  const sourceLines = result.sources.map(
    (s, i) =>
      `${i + 1}. **${s.title}** — ${s.snippet.slice(0, 180)}\n   ${s.url}`
  );

  if (mode === "agent") {
    return [
      "【Perplexity 深度搜尋結果（即時外部網路資料）】",
      `搜尋提供者：${result.provider}｜耗時：${result.durationMs}ms`,
      "",
      "以下是即時搜到的外部網路來源，請作為回答的事實參考：",
      "",
      result.summary,
      "",
      "引用來源：",
      ...sourceLines,
      "",
      "→ 規則：在回覆中引用 1–3 條最相關的 URL；不相關的來源直接捨棄。",
    ].join("\n");
  }

  return [
    "【Perplexity 深度搜尋結果（即時外部網路資料）】",
    `搜尋提供者：${result.provider}`,
    "",
    result.summary,
    "",
    "引用來源：",
    ...sourceLines,
    "",
    "回覆規範：",
    "- 用條列式整理 3–8 個重點。",
    "- 在最後附上「來源：<url1>、<url2>」讓使用者可驗證。",
    "- 若沒有任何來源符合主題，這一行就省略。",
  ].join("\n");
}

/**
 * 將深度搜尋結果轉為學習文件中心的文件格式。
 */
export function formatDeepSearchAsLearnDoc(
  query: string,
  result: DeepSearchResult
): {
  id: string;
  title: string;
  summary: string;
  content: string;
  category: string;
  tags: string[];
  difficulty: string;
  readingMinutes: number;
} | null {
  if (!result.ok || result.sources.length === 0) return null;

  const docId = `deep-search-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const sourcesMarkdown = result.sources
    .map(
      (s, i) =>
        `${i + 1}. [${s.title}](${s.url})${s.publishedDate ? ` (${s.publishedDate})` : ""}\n   ${s.snippet}`
    )
    .join("\n\n");

  return {
    id: docId,
    title: `[深度搜尋] ${query.slice(0, 60)}`,
    summary: result.summary.slice(0, 220),
    content: `# ${query}

## 搜尋摘要

${result.summary}

---

## 引用來源

${sourcesMarkdown}

---

## 搜尋資訊

- **搜尋提供者**：${result.provider}
- **搜尋時間**：${new Date().toISOString()}
- **搜尋耗時**：${result.durationMs}ms
- **來源數量**：${result.sources.length}

---

## 建議下一步

1. 點擊上方來源連結查看完整文章。
2. 使用光球進一步搜尋相關主題。
3. 將此文件加入收藏以便日後參考。`,
    category: "technique",
    tags: [
      "深度搜尋",
      "perplexity",
      ...query
        .split(/[\s,，、/|]+/)
        .filter((w) => w.length >= 2)
        .slice(0, 4),
    ],
    difficulty: "intermediate",
    readingMinutes: 3,
  };
}
