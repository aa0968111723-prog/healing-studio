/**
 * Brain Auto-Repair & Self-Optimization Service
 * ────────────────────────────────────────────────────────────────────────────
 * 五大子系統：
 *   1. 自動修復 API + 提醒管理 — 偵測/修復損壞 API，提醒管理員
 *   2. 生成錯誤線索系統 — 追蹤失敗生成的錯誤痕跡
 *   3. 回饋自我反省優化系統 — AI 自我反思，修改前需管理員確認
 *   4. 爬網找資料功能 — 網路爬行搜尋開源模型/程式碼/文件
 *   5. AI 精準度測試 — 自行測試生成式 AI 精準度，提出優化方案
 *
 * 所有資料為 in-memory（與 learnHub 一致），不需要 DB migration。
 */

import {
  reportEngineFailure,
  reportEngineRecovery,
  getHealthSnapshot,
  BrainAuditLogger,
} from "../middleware/brainContext";
import { addLearnDoc, hasLearnDoc } from "../routers/learnHub";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/** API 健康警報 */
export interface ApiAlert {
  id: string;
  provider: string;
  engine: string;
  severity: "info" | "warning" | "critical";
  message: string;
  autoRepaired: boolean;
  repairedWith?: string;
  createdAt: number;
  dismissedAt?: number;
  dismissedBy?: number;
}

/** 生成錯誤線索 */
export interface ErrorTrace {
  id: string;
  userId: number;
  modality: "image" | "video" | "audio" | "voice" | "llm";
  engine: string;
  prompt: string;
  errorMessage: string;
  errorCode?: string;
  stackHint?: string;
  webSearchResult?: string;
  resolution?: string;
  resolvedAt?: number;
  createdAt: number;
}

/** 自我反省優化提案 */
export interface ReflectionProposal {
  id: string;
  category: "prompt_optimization" | "engine_switch" | "param_tuning" | "fallback_update" | "accuracy_fix";
  title: string;
  description: string;
  currentValue: string;
  proposedValue: string;
  reasoning: string;
  confidence: number; // 0-100
  status: "pending" | "approved" | "rejected";
  adminNote?: string;
  reviewedBy?: number;
  reviewedAt?: number;
  appliedAt?: number;
  createdAt: number;
}

/** 爬網研究結果 */
export interface WebResearchResult {
  id: string;
  query: string;
  source: string;
  title: string;
  summary: string;
  url: string;
  relevance: number; // 0-100
  addedToLearnHub: boolean;
  learnDocId?: string;
  createdAt: number;
}

/** 精準度測試結果 */
export interface AccuracyTest {
  id: string;
  engine: string;
  testType: "response_quality" | "latency" | "consistency" | "error_rate";
  testPrompt: string;
  expectedBehavior: string;
  actualResult: string;
  score: number; // 0-100
  passed: boolean;
  suggestions: string[];
  proposal?: ReflectionProposal;
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// In-Memory Stores (同 learnHub 模式)
// ═══════════════════════════════════════════════════════════════════════════

const apiAlerts: ApiAlert[] = [];
const errorTraces: ErrorTrace[] = [];
const reflectionProposals: ReflectionProposal[] = [];
const webResearchResults: WebResearchResult[] = [];
const accuracyTests: AccuracyTest[] = [];

// Max items per store to prevent memory overflow
const MAX_ALERTS = 200;
const MAX_TRACES = 500;
const MAX_PROPOSALS = 100;
const MAX_RESEARCH = 200;
const MAX_TESTS = 200;

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. 自動修復 API + 提醒管理
// ═══════════════════════════════════════════════════════════════════════════

/** API 端點探測設定 */
const PROVIDER_ENDPOINTS: Record<string, { url: string; method: string; headers?: () => Record<string, string> }> = {
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    method: "GET",
  },
  fal: {
    url: "https://queue.fal.run/fal-ai/flux/requests",
    method: "GET",
    headers: (): Record<string, string> => (process.env.FAL_API_KEY ? { Authorization: `Key ${process.env.FAL_API_KEY}` } : {}),
  },
  elevenlabs: {
    url: "https://api.elevenlabs.io/v1/user",
    method: "GET",
    headers: (): Record<string, string> => (process.env.ELEVENLABS_API_KEY ? { "xi-api-key": process.env.ELEVENLABS_API_KEY } : {}),
  },
  replicate: {
    url: "https://api.replicate.com/v1/models",
    method: "GET",
    headers: (): Record<string, string> => (process.env.REPLICATE_API_TOKEN ? { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}` } : {}),
  },
};

/** 已知引擎對應的 provider */
const ENGINE_PROVIDER_MAP: Record<string, string> = {
  "gemini-2.5-pro": "gemini", "gemini-2.5-flash": "gemini",
  "gemini-1.5-pro": "gemini", "gemini-1.5-flash": "gemini",
  "vertex/gemini-2.5-pro": "gemini", "vertex/gemini-2.5-flash": "gemini",
  "flux-pro": "fal", "flux-schnell": "fal",
  "kling-v1": "fal", "kling-v1-5": "fal",
  "suno-v4": "fal", "suno-v3.5": "fal",
  "elevenlabs-v2": "elevenlabs", "elevenlabs-v1": "elevenlabs",
};

/** 備援鏈 */
const REPAIR_FALLBACK: Record<string, string[]> = {
  "gemini-2.5-pro": ["gemini-2.5-flash", "gemini-1.5-pro"],
  "gemini-2.5-flash": ["gemini-1.5-flash", "gemini-2.5-pro"],
  "flux-pro": ["flux-schnell"],
  "kling-v1": ["kling-v1-5", "minimax-video"],
  "suno-v4": ["suno-v3.5"],
  "elevenlabs-v2": ["elevenlabs-v1"],
};

/**
 * 對單一 provider 執行健康探測。
 * 回傳 { ok, latencyMs, error? }
 */
async function pingProvider(provider: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const config = PROVIDER_ENDPOINTS[provider];
  if (!config) return { ok: false, latencyMs: 0, error: `Unknown provider: ${provider}` };

  const start = Date.now();
  try {
    const headers = config.headers?.() ?? {};
    const res = await fetch(config.url, {
      method: config.method,
      headers,
      signal: AbortSignal.timeout(8_000),
    });
    const latencyMs = Date.now() - start;
    // 401/403 = service alive but key issue
    const ok = res.ok || res.status === 401 || res.status === 403;
    return { ok, latencyMs };
  } catch (e) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * 嘗試自動修復引擎 — 探測 provider，若斷線則嘗試備援
 */
async function attemptAutoRepair(engine: string): Promise<ApiAlert> {
  const provider = ENGINE_PROVIDER_MAP[engine] ?? "unknown";
  const pingResult = await pingProvider(provider);

  if (pingResult.ok) {
    // Provider 正常，可能是暫時性問題
    reportEngineRecovery(engine);
    const alert: ApiAlert = {
      id: genId("alert"),
      provider,
      engine,
      severity: "info",
      message: `${engine} 已自動恢復正常（延遲 ${pingResult.latencyMs}ms）`,
      autoRepaired: true,
      repairedWith: engine,
      createdAt: Date.now(),
    };
    addAlert(alert);
    return alert;
  }

  // Provider 不健康 — 嘗試備援
  const fallbacks = REPAIR_FALLBACK[engine] ?? [];
  for (const candidate of fallbacks) {
    const candidateProvider = ENGINE_PROVIDER_MAP[candidate] ?? provider;
    const candidatePing = await pingProvider(candidateProvider);
    if (candidatePing.ok) {
      reportEngineRecovery(candidate);
      const alert: ApiAlert = {
        id: genId("alert"),
        provider,
        engine,
        severity: "warning",
        message: `${engine} 無法連線（${pingResult.error ?? "timeout"}），已自動切換至備援 ${candidate}`,
        autoRepaired: true,
        repairedWith: candidate,
        createdAt: Date.now(),
      };
      addAlert(alert);
      return alert;
    }
  }

  // 所有備援都失敗 — 通知管理員
  reportEngineFailure(engine, pingResult.error ?? "Provider unreachable");
  const alert: ApiAlert = {
    id: genId("alert"),
    provider,
    engine,
    severity: "critical",
    message: `⚠️ ${engine} 及所有備援均無法連線，請管理員檢查 API Key 或服務狀態。錯誤：${pingResult.error ?? "Unknown"}`,
    autoRepaired: false,
    createdAt: Date.now(),
  };
  addAlert(alert);
  return alert;
}

function addAlert(alert: ApiAlert): void {
  apiAlerts.unshift(alert);
  if (apiAlerts.length > MAX_ALERTS) apiAlerts.length = MAX_ALERTS;
}

/** 取得所有警報 */
export function getAlerts(limit = 50): ApiAlert[] {
  return apiAlerts.slice(0, limit);
}

/** 標記警報已處理 */
export function dismissAlert(alertId: string, userId: number): boolean {
  const alert = apiAlerts.find((a) => a.id === alertId);
  if (!alert) return false;
  alert.dismissedAt = Date.now();
  alert.dismissedBy = userId;
  return true;
}

/** 取得未處理的嚴重警報數量 */
export function getActiveAlertCount(): number {
  return apiAlerts.filter((a) => !a.dismissedAt && a.severity !== "info").length;
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. 生成錯誤線索系統
// ═══════════════════════════════════════════════════════════════════════════

/** 記錄一個生成錯誤 */
export function recordErrorTrace(trace: Omit<ErrorTrace, "id" | "createdAt">): ErrorTrace {
  const full: ErrorTrace = {
    ...trace,
    id: genId("err"),
    createdAt: Date.now(),
  };
  errorTraces.unshift(full);
  if (errorTraces.length > MAX_TRACES) errorTraces.length = MAX_TRACES;

  // 自動觸發爬網搜尋修復方案
  void autoSearchForFix(full);

  return full;
}

/** 自動爬網搜尋修復方案 */
async function autoSearchForFix(trace: ErrorTrace): Promise<void> {
  try {
    const query = `${trace.engine} ${trace.errorCode ?? ""} ${trace.errorMessage.slice(0, 100)} fix solution`;
    const results = await webSearch(query, 2);

    if (results.length > 0) {
      const idx = errorTraces.findIndex((t) => t.id === trace.id);
      if (idx >= 0) {
        errorTraces[idx].webSearchResult = results
          .map((r) => `[${r.title}](${r.url}): ${r.summary}`)
          .join("\n\n");
      }

      // 建立修復提案
      createReflectionProposal({
        category: "accuracy_fix",
        title: `修復 ${trace.engine} 錯誤: ${trace.errorCode ?? trace.errorMessage.slice(0, 50)}`,
        description: `生成錯誤自動偵測到：${trace.errorMessage}\n\n爬網搜尋到以下相關資訊：\n${results.map((r) => `- ${r.title}: ${r.summary}`).join("\n")}`,
        currentValue: trace.engine,
        proposedValue: results[0].summary.slice(0, 200),
        reasoning: `根據網路搜尋結果，此錯誤可能透過以下方式修復。需要管理員確認後才會套用變更。`,
        confidence: Math.min(results[0].relevance, 80),
      });
    }
  } catch (err) {
    console.warn("[BrainAutoRepair] 自動搜尋修復失敗:", err);
  }
}

/** 取得錯誤線索 */
export function getErrorTraces(limit = 50, modality?: string): ErrorTrace[] {
  let traces = errorTraces;
  if (modality) traces = traces.filter((t) => t.modality === modality);
  return traces.slice(0, limit);
}

/** 手動標記錯誤已解決 */
export function resolveErrorTrace(traceId: string, resolution: string): boolean {
  const trace = errorTraces.find((t) => t.id === traceId);
  if (!trace) return false;
  trace.resolution = resolution;
  trace.resolvedAt = Date.now();
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. 回饋自我反省優化系統
// ═══════════════════════════════════════════════════════════════════════════

/** 建立優化提案（AI 自動或手動觸發） */
export function createReflectionProposal(input: {
  category: ReflectionProposal["category"];
  title: string;
  description: string;
  currentValue: string;
  proposedValue: string;
  reasoning: string;
  confidence: number;
}): ReflectionProposal {
  const proposal: ReflectionProposal = {
    ...input,
    id: genId("prop"),
    status: "pending",
    createdAt: Date.now(),
  };
  reflectionProposals.unshift(proposal);
  if (reflectionProposals.length > MAX_PROPOSALS) reflectionProposals.length = MAX_PROPOSALS;
  return proposal;
}

/** 取得提案清單 */
export function getProposals(status?: ReflectionProposal["status"]): ReflectionProposal[] {
  if (status) return reflectionProposals.filter((p) => p.status === status);
  return [...reflectionProposals];
}

/** 管理員批准提案 */
export function approveProposal(proposalId: string, adminUserId: number, note?: string): boolean {
  const proposal = reflectionProposals.find((p) => p.id === proposalId);
  if (!proposal || proposal.status !== "pending") return false;
  proposal.status = "approved";
  proposal.reviewedBy = adminUserId;
  proposal.reviewedAt = Date.now();
  proposal.appliedAt = Date.now();
  proposal.adminNote = note;

  console.log(
    `[BrainAutoRepair] ✅ 提案已批准 id=${proposalId} by userId=${adminUserId}: ${proposal.title}`
  );
  return true;
}

/** 管理員拒絕提案 */
export function rejectProposal(proposalId: string, adminUserId: number, note?: string): boolean {
  const proposal = reflectionProposals.find((p) => p.id === proposalId);
  if (!proposal || proposal.status !== "pending") return false;
  proposal.status = "rejected";
  proposal.reviewedBy = adminUserId;
  proposal.reviewedAt = Date.now();
  proposal.adminNote = note;

  console.log(
    `[BrainAutoRepair] ❌ 提案已拒絕 id=${proposalId} by userId=${adminUserId}: ${proposal.title}`
  );
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. 爬網找資料功能
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 使用公開搜尋 API 爬網搜尋。
 * 策略：嘗試 DuckDuckGo Instant Answer API（免費，不需 API Key）。
 * 若失敗，使用 Gemini LLM 生成摘要作為備援。
 */
export async function webSearch(query: string, maxResults = 5): Promise<WebResearchResult[]> {
  const results: WebResearchResult[] = [];

  try {
    // DuckDuckGo Instant Answer API (zero-click)
    const encoded = encodeURIComponent(query);
    const ddgUrl = `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(ddgUrl, { signal: AbortSignal.timeout(10_000) });

    if (res.ok) {
      const data = await res.json() as {
        Abstract?: string;
        AbstractSource?: string;
        AbstractURL?: string;
        AbstractText?: string;
        RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
      };

      // Main abstract
      if (data.Abstract && data.AbstractURL) {
        const item: WebResearchResult = {
          id: genId("web"),
          query,
          source: data.AbstractSource ?? "DuckDuckGo",
          title: data.Abstract.slice(0, 100),
          summary: data.AbstractText ?? data.Abstract,
          url: data.AbstractURL,
          relevance: 85,
          addedToLearnHub: false,
          createdAt: Date.now(),
        };
        results.push(item);
      }

      // Related topics
      if (data.RelatedTopics) {
        for (const topic of data.RelatedTopics.slice(0, maxResults - results.length)) {
          if (topic.Text && topic.FirstURL) {
            const item: WebResearchResult = {
              id: genId("web"),
              query,
              source: "DuckDuckGo",
              title: topic.Text.slice(0, 100),
              summary: topic.Text,
              url: topic.FirstURL,
              relevance: 60,
              addedToLearnHub: false,
              createdAt: Date.now(),
            };
            results.push(item);
          }
        }
      }
    }
  } catch (err) {
    console.warn("[WebResearch] DuckDuckGo 搜尋失敗:", err);
  }

  // 若 DuckDuckGo 沒有結果，嘗試 GitHub 公開搜尋 API
  if (results.length === 0) {
    try {
      const ghQuery = encodeURIComponent(query);
      const ghRes = await fetch(
        `https://api.github.com/search/repositories?q=${ghQuery}&sort=stars&per_page=${maxResults}`,
        {
          headers: { Accept: "application/vnd.github.v3+json", "User-Agent": "HealingStudio/1.0" },
          signal: AbortSignal.timeout(10_000),
        }
      );

      if (ghRes.ok) {
        const ghData = await ghRes.json() as {
          items?: Array<{ full_name: string; description: string; html_url: string; stargazers_count: number }>;
        };
        for (const repo of (ghData.items ?? []).slice(0, maxResults)) {
          const item: WebResearchResult = {
            id: genId("web"),
            query,
            source: "GitHub",
            title: repo.full_name,
            summary: `${repo.description ?? "No description"} (⭐ ${repo.stargazers_count})`,
            url: repo.html_url,
            relevance: Math.min(90, 50 + Math.floor(repo.stargazers_count / 100)),
            addedToLearnHub: false,
            createdAt: Date.now(),
          };
          results.push(item);
        }
      }
    } catch (err) {
      console.warn("[WebResearch] GitHub 搜尋失敗:", err);
    }
  }

  // 存入結果庫
  for (const r of results) {
    webResearchResults.unshift(r);
  }
  if (webResearchResults.length > MAX_RESEARCH) webResearchResults.length = MAX_RESEARCH;

  return results;
}

/** 將研究結果加入學習文件庫 */
export function addResearchToLearnHub(researchId: string): boolean {
  const item = webResearchResults.find((r) => r.id === researchId);
  if (!item || item.addedToLearnHub) return false;

  const docId = `web-research-${item.id}`;
  if (hasLearnDoc(docId)) return false;

  addLearnDoc({
    id: docId,
    title: `[爬網] ${item.title}`,
    summary: item.summary.slice(0, 200),
    content: `# ${item.title}\n\n**來源:** ${item.source}\n**連結:** ${item.url}\n**搜尋詞:** ${item.query}\n\n---\n\n${item.summary}`,
    category: "technique",
    tags: ["爬網研究", item.source.toLowerCase()],
    difficulty: "intermediate",
    readingMinutes: 2,
    publishedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    featured: false,
  });

  item.addedToLearnHub = true;
  item.learnDocId = docId;
  return true;
}

/** 取得研究結果 */
export function getResearchResults(limit = 50): WebResearchResult[] {
  return webResearchResults.slice(0, limit);
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. AI 精準度測試系統
// ═══════════════════════════════════════════════════════════════════════════

/** 預定義的測試案例 */
const ACCURACY_TEST_CASES: Array<{
  engine: string;
  testType: AccuracyTest["testType"];
  testPrompt: string;
  expectedBehavior: string;
}> = [
  {
    engine: "gemini-2.5-pro",
    testType: "response_quality",
    testPrompt: "用 30 字描述一棵樹",
    expectedBehavior: "回傳包含樹木相關描述的繁體中文文字，字數接近 30",
  },
  {
    engine: "gemini-2.5-flash",
    testType: "latency",
    testPrompt: "回答 1+1=?",
    expectedBehavior: "在 3 秒內回傳包含 '2' 的回應",
  },
  {
    engine: "gemini-2.5-pro",
    testType: "consistency",
    testPrompt: "用 JSON 格式回傳 {\"status\": \"ok\"}",
    expectedBehavior: "回傳合法 JSON 且包含 status 欄位",
  },
];

/**
 * 執行單一精準度測試
 */
export async function runAccuracyTest(
  engine: string,
  testType: AccuracyTest["testType"],
  testPrompt: string,
  expectedBehavior: string
): Promise<AccuracyTest> {
  const startTime = Date.now();
  let actualResult = "";
  let score = 0;
  let passed = false;
  const suggestions: string[] = [];

  try {
    // 嘗試透過 Gemini API 進行測試
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      actualResult = "[無法測試] GEMINI_API_KEY 未設定";
      score = 0;
      suggestions.push("請設定 GEMINI_API_KEY 環境變數以啟用精準度測試");
    } else {
      const model = engine.startsWith("vertex/") ? "gemini-2.5-flash" : engine;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: testPrompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 256 },
        }),
        signal: AbortSignal.timeout(15_000),
      });

      const latencyMs = Date.now() - startTime;

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        actualResult = `HTTP ${res.status}: ${errText.slice(0, 300)}`;
        score = 0;
        suggestions.push(`引擎 ${engine} 回傳錯誤，建議檢查 API Key 或切換引擎`);
      } else {
        const data = await res.json() as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        actualResult = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "[無回應內容]";

        // 評分邏輯
        switch (testType) {
          case "response_quality":
            score = actualResult.length > 5 ? 80 : 20;
            if (actualResult.length > 10 && actualResult.length < 500) score = 90;
            break;
          case "latency":
            score = latencyMs < 3000 ? 95 : latencyMs < 5000 ? 70 : 40;
            if (latencyMs > 5000) suggestions.push(`延遲 ${latencyMs}ms 偏高，建議切換至 Flash 模型`);
            break;
          case "consistency":
            try {
              JSON.parse(actualResult);
              score = 95;
            } catch {
              score = 30;
              suggestions.push("回應非合法 JSON，建議調整 system prompt 或溫度參數");
            }
            break;
          case "error_rate":
            score = actualResult.includes("[error]") ? 20 : 90;
            break;
        }

        passed = score >= 70;
      }
    }
  } catch (err) {
    actualResult = `測試例外: ${err instanceof Error ? err.message : String(err)}`;
    score = 0;
    suggestions.push("測試過程中發生例外，建議檢查網路連線或 API 配額");
  }

  const test: AccuracyTest = {
    id: genId("test"),
    engine,
    testType,
    testPrompt,
    expectedBehavior,
    actualResult,
    score,
    passed,
    suggestions,
    createdAt: Date.now(),
  };

  // 若分數低於門檻，自動建立優化提案
  if (score < 70) {
    const proposal = createReflectionProposal({
      category: "accuracy_fix",
      title: `精準度不足：${engine} ${testType} 測試得分 ${score}/100`,
      description: `測試提示詞：${testPrompt}\n預期行為：${expectedBehavior}\n實際結果：${actualResult.slice(0, 300)}\n\n建議：${suggestions.join("；")}`,
      currentValue: engine,
      proposedValue: suggestions[0] ?? "需要進一步分析",
      reasoning: `自動精準度測試發現此引擎的 ${testType} 表現低於 70 分門檻（得分 ${score}）。`,
      confidence: score,
    });
    test.proposal = proposal;
  }

  accuracyTests.unshift(test);
  if (accuracyTests.length > MAX_TESTS) accuracyTests.length = MAX_TESTS;

  return test;
}

/** 執行全部預定義測試 */
export async function runAllAccuracyTests(): Promise<AccuracyTest[]> {
  const results: AccuracyTest[] = [];
  for (const tc of ACCURACY_TEST_CASES) {
    const result = await runAccuracyTest(tc.engine, tc.testType, tc.testPrompt, tc.expectedBehavior);
    results.push(result);
  }
  return results;
}

/** 取得測試結果 */
export function getAccuracyTests(limit = 50): AccuracyTest[] {
  return accuracyTests.slice(0, limit);
}

// ═══════════════════════════════════════════════════════════════════════════
// Cron Job Entry Point (供 apiHealthMonitor 呼叫)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 完整的健康巡檢 — 由 cron job 定時呼叫。
 * 1. 探測所有 provider
 * 2. 對不健康的引擎嘗試自動修復
 * 3. 記錄警報
 */
export async function runHealthPatrol(): Promise<{ checked: number; alerts: number }> {
  const snapshot = getHealthSnapshot();
  let alertCount = 0;
  const engines = Object.keys(snapshot);

  // 探測所有已知 provider
  const providers = Object.keys(PROVIDER_ENDPOINTS);
  const providerStatus: Record<string, boolean> = {};

  for (const p of providers) {
    const result = await pingProvider(p);
    providerStatus[p] = result.ok;

    if (!result.ok) {
      // 找出此 provider 對應的所有引擎
      for (const [eng, prov] of Object.entries(ENGINE_PROVIDER_MAP)) {
        if (prov === p) {
          const alert = await attemptAutoRepair(eng);
          if (alert.severity !== "info") alertCount++;
        }
      }
    }
  }

  // 檢查快取中標記為不健康的引擎
  for (const [engine, entry] of Object.entries(snapshot)) {
    if (!entry.healthy && entry.consecutiveFailures >= 2) {
      const existing = apiAlerts.find(
        (a) => a.engine === engine && !a.dismissedAt && Date.now() - a.createdAt < 300_000
      );
      if (!existing) {
        const alert = await attemptAutoRepair(engine);
        if (alert.severity !== "info") alertCount++;
      }
    }
  }

  return { checked: engines.length + providers.length, alerts: alertCount };
}

/** 統計摘要 */
export function getSystemSummary(): {
  activeAlerts: number;
  unresolvedErrors: number;
  pendingProposals: number;
  totalResearch: number;
  recentTestScore: number | null;
} {
  return {
    activeAlerts: getActiveAlertCount(),
    unresolvedErrors: errorTraces.filter((t) => !t.resolvedAt).length,
    pendingProposals: reflectionProposals.filter((p) => p.status === "pending").length,
    totalResearch: webResearchResults.length,
    recentTestScore: accuracyTests.length > 0
      ? Math.round(accuracyTests.slice(0, 10).reduce((sum, t) => sum + t.score, 0) / Math.min(accuracyTests.length, 10))
      : null,
  };
}
