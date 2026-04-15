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
import { ENV } from "../_core/env";

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

/** 錯誤分類 */
export type ErrorCategory =
  | "rate_limit"       // 速率限制 / 配額超過
  | "auth_failure"     // 認證失敗 / API Key 無效
  | "connection"       // 連線問題 / 一次連線太多
  | "timeout"          // 逾時
  | "missing_api"      // 缺失 API / 端點不存在
  | "broken_link"      // 連結中斷 / 資源不存在
  | "validation"       // 參數驗證錯誤
  | "server_error"     // 伺服器內部錯誤
  | "quota_exceeded"   // 配額用盡
  | "model_unavailable" // 模型不可用
  | "unknown";         // 未知

/** 步驟式解決方案 */
export interface SolutionStep {
  step: number;
  title: string;
  description: string;
  action: "check" | "fix" | "verify" | "fallback";
  command?: string; // 可選的指令或程式碼提示
}

/** 錯誤診斷結果 */
export interface ErrorDiagnosis {
  errorCategory: ErrorCategory;
  rootCause: string;
  rootCauseConfidence: number; // 0-100
  suggestedSteps: SolutionStep[];
  relatedTraceIds: string[];
  searchQueries: string[]; // 建議的搜尋關鍵字
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
  // ── 增強欄位：根因分析 ──
  errorCategory?: ErrorCategory;
  rootCause?: string;
  rootCauseConfidence?: number;
  suggestedSteps?: SolutionStep[];
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
  return `${prefix}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
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
  nvidia: {
    url: "https://integrate.api.nvidia.com/v1/models",
    method: "GET",
    headers: (): Record<string, string> => (process.env.NVIDA_API ? { Authorization: `Bearer ${process.env.NVIDA_API}` } : {}),
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
  // ── Gemini / Vertex AI 推理大腦 ──
  "gemini-2.5-pro": "gemini", "gemini-2.5-flash": "gemini",
  "gemini-1.5-pro": "gemini", "gemini-1.5-flash": "gemini",
  "vertex/gemini-2.5-pro": "gemini", "vertex/gemini-2.5-flash": "gemini",
  // ── MiniMax M2.7 via NVIDIA NIM（代理人推理引擎）──
  "minimaxai/minimax-m2.7": "nvidia",
  // ── 圖像生成（Fal.ai） ──
  "fal-ai/nano-banana-2": "fal", "fal-ai/nano-banana-pro": "fal",
  "fal-ai/nano-banana/edit": "fal", "fal-ai/nano-banana-2/edit": "fal",
  "fal-ai/nano-banana-pro/edit": "fal",
  "fal-ai/bytedance/seedream/v4/text-to-image": "fal",
  "fal-ai/bytedance/seedream/v4.5/edit": "fal",
  "fal-ai/bytedance/seedream/v5/lite/edit": "fal",
  "fal-ai/imagen4/preview": "fal",
  "fal-ai/gpt-image-1.5/edit": "fal",
  "fal-ai/flux-pro/kontext": "fal", "fal-ai/flux-2-pro/edit": "fal",
  "fal-ai/flux-pro/v1.1": "fal", "fal-ai/flux/dev": "fal",
  "fal-ai/stable-diffusion-v35-large": "fal", "fal-ai/fast-sdxl": "fal",
  "fal-ai/lora": "fal",
  "fal-ai/seedvr/upscale/image": "fal", "fal-ai/dwpose": "fal",
  // ── 圖像轉3D（Fal.ai） ──
  "fal-ai/trellis-2": "fal", "fal-ai/trellis": "fal",
  "fal-ai/sam-3/3d-objects": "fal", "fal-ai/hunyuan3d-v3/image-to-3d": "fal",
  "fal-ai/hyper3d/rodin": "fal", "fal-ai/hunyuan_world/image-to-world": "fal",
  // ── 影片生成（Fal.ai） ──
  "fal-ai/kling-video/v2.1/standard/text-to-video": "fal",
  "fal-ai/kling-video/v2.1/standard/image-to-video": "fal",
  "fal-ai/kling-video/v1.6/standard/video-to-video": "fal",
  "fal-ai/wan/v2.2-14b": "fal", "fal-ai/wan-t2v": "fal", "fal-ai/wan-i2v": "fal",
  "fal-ai/minimax/video-01": "fal", "fal-ai/minimax/video-01/image-to-video": "fal",
  "fal-ai/veo3": "fal", "fal-ai/sora": "fal",
  "fal-ai/ltx-video-13b-distilled": "fal", "fal-ai/ltx-video/image-to-video": "fal",
  "fal-ai/pixverse/v4.5/image-to-video": "fal",
  "fal-ai/runway-gen4-turbo/image-to-video": "fal",
  "fal-ai/animatediff-v2v": "fal", "fal-ai/depthcrafter": "fal",
  "fal-ai/cammaster": "fal", "fal-ai/vidu/q1/reference-to-video": "fal",
  // ── 音樂生成（Fal.ai） ──
  "fal-ai/sonauto": "fal", "fal-ai/ace-step": "fal",
  "fal-ai/stable-audio": "fal", "fal-ai/musicgen": "fal",
  // ── 語音 TTS / 聲音克隆（Fal.ai + ElevenLabs） ──
  "fal-ai/elevenlabs/tts/turbo-v2.5": "fal",
  "fal-ai/qwen-3-tts/text-to-speech/1.7b": "fal",
  "fal-ai/qwen-3-tts/clone-voice/1.7b": "fal",
  "fal-ai/qwen-3-tts/voice-design/1.7b": "fal",
  "fal-ai/dia-tts/voice-clone": "fal",
  // ── 音訊處理（Fal.ai） ──
  "fal-ai/demucs": "fal", "fal-ai/audioldm2": "fal",
  "fal-ai/elevenlabs/sound-effects/v2": "fal",
  "fal-ai/elevenlabs/audio-isolation": "fal",
  "fal-ai/nemotron/asr/stream": "fal",
  // ── 數位人 / 語音轉影片（Fal.ai） ──
  "fal-ai/echomimic-v3": "fal", "fal-ai/stable-avatar": "fal",
  "fal-ai/longcat-single-avatar/audio-to-video": "fal",
  "fal-ai/wan/v2.2-14b/speech-to-video": "fal",
  "fal-ai/ltx-2-19b/distilled/audio-to-video/lora": "fal",
  // ── 向後相容（舊別名） ──
  "flux-pro": "fal", "flux-schnell": "fal",
  "kling-v1": "fal", "kling-v1-5": "fal",
  "suno-v4": "fal", "suno-v3.5": "fal",
  "elevenlabs-v2": "elevenlabs", "elevenlabs-v1": "elevenlabs",
};

/** 備援鏈 */
const REPAIR_FALLBACK: Record<string, string[]> = {
  // ── 推理大腦 ──
  "gemini-2.5-pro": ["gemini-2.5-flash", "minimaxai/minimax-m2.7", "gemini-1.5-pro"],
  "gemini-2.5-flash": ["gemini-1.5-flash", "minimaxai/minimax-m2.7", "gemini-2.5-pro"],
  // ── MiniMax M2.7（NVIDIA NIM 代理人引擎）──
  "minimaxai/minimax-m2.7": ["gemini-2.5-flash", "gemini-2.5-pro"],
  // ── 圖像生成 ──
  "fal-ai/nano-banana-2": ["fal-ai/nano-banana-pro", "fal-ai/flux-pro/v1.1"],
  "fal-ai/nano-banana-pro": ["fal-ai/nano-banana-2", "fal-ai/flux-pro/v1.1"],
  "fal-ai/flux-pro/v1.1": ["fal-ai/fast-sdxl", "fal-ai/stable-diffusion-v35-large"],
  "fal-ai/imagen4/preview": ["fal-ai/nano-banana-2", "fal-ai/flux-pro/v1.1"],
  "fal-ai/bytedance/seedream/v4/text-to-image": ["fal-ai/nano-banana-2", "fal-ai/flux-pro/v1.1"],
  // ── 影片生成 ──
  "fal-ai/kling-video/v2.1/standard/text-to-video": ["fal-ai/wan/v2.2-14b", "fal-ai/minimax/video-01"],
  "fal-ai/kling-video/v2.1/standard/image-to-video": ["fal-ai/minimax/video-01/image-to-video", "fal-ai/pixverse/v4.5/image-to-video"],
  "fal-ai/wan/v2.2-14b": ["fal-ai/kling-video/v2.1/standard/text-to-video", "fal-ai/minimax/video-01"],
  "fal-ai/veo3": ["fal-ai/kling-video/v2.1/standard/text-to-video", "fal-ai/wan/v2.2-14b"],
  "fal-ai/minimax/video-01": ["fal-ai/kling-video/v2.1/standard/text-to-video", "fal-ai/wan/v2.2-14b"],
  // ── 音樂生成 ──
  "fal-ai/sonauto": ["fal-ai/ace-step", "fal-ai/stable-audio"],
  "fal-ai/ace-step": ["fal-ai/sonauto", "fal-ai/musicgen"],
  "fal-ai/stable-audio": ["fal-ai/sonauto", "fal-ai/musicgen"],
  // ── 語音 TTS ──
  "fal-ai/elevenlabs/tts/turbo-v2.5": ["fal-ai/qwen-3-tts/text-to-speech/1.7b", "fal-ai/dia-tts/voice-clone"],
  "fal-ai/qwen-3-tts/text-to-speech/1.7b": ["fal-ai/elevenlabs/tts/turbo-v2.5", "fal-ai/dia-tts/voice-clone"],
  // ── 向後相容（舊別名） ──
  "flux-pro": ["flux-schnell"],
  "kling-v1": ["kling-v1-5", "fal-ai/minimax/video-01"],
  "suno-v4": ["fal-ai/sonauto", "fal-ai/stable-audio"],
  "elevenlabs-v2": ["fal-ai/elevenlabs/tts/turbo-v2.5", "elevenlabs-v1"],
};

/** 根據引擎名稱推斷生成類型（more specific patterns checked first） */
function inferModality(engine: string): ErrorTrace["modality"] {
  const e = engine.toLowerCase();

  // 語音 / TTS（先於 audio，因為部分 TTS 引擎含 "audio" 字樣）
  const voicePatterns = ["tts", "voice", "dia-tts", "qwen-3-tts", "avatar", "echomimic", "elevenlabs/tts", "elevenlabs/voice", "elevenlabs/dubbing"];
  if (voicePatterns.some((p) => e.includes(p))) return "voice";

  // 音訊 / 音樂（先於 video，因為 "video-to-audio" 等含 video 字樣）
  const audioPatterns = ["audio", "sonauto", "musicgen", "ace-step", "stable-audio", "suno", "demucs", "audioldm", "sound-effects", "audio-isolation", "asr", "merge-audio"];
  if (audioPatterns.some((p) => e.includes(p))) return "audio";

  // 影片
  const videoPatterns = ["video", "kling", "wan", "minimax", "veo", "sora", "ltx-video", "pixverse", "runway", "animatediff", "depthcrafter", "cammaster", "vidu"];
  if (videoPatterns.some((p) => e.includes(p))) return "video";

  // LLM 推理
  const llmPatterns = ["gemini", "vertex", "llm", "any-llm", "minimaxai", "minimax-m2"];
  if (llmPatterns.some((p) => e.includes(p))) return "llm";

  return "image"; // 圖像生成為預設
}

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

      // 連動：記錄錯誤線索（已自動修復），觸發爬網搜尋根因
      recordErrorTrace({
        userId: 0,
        modality: inferModality(engine),
        engine,
        prompt: "[系統自動巡檢]",
        errorMessage: `${engine} 無法連線（${pingResult.error ?? "timeout"}），已自動切換至備援 ${candidate}`,
        errorCode: "AUTO_REPAIR_WARNING",
        stackHint: `Provider: ${provider}, Repaired with: ${candidate}`,
      });

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

  // 連動：自動建立錯誤線索 → 觸發爬網搜尋修復方案 → 建立修復提案
  recordErrorTrace({
    userId: 0, // system-generated
    modality: inferModality(engine),
    engine,
    prompt: "[系統自動巡檢]",
    errorMessage: `API 巡檢失敗：${engine} 及所有備援均無法連線。錯誤：${pingResult.error ?? "Provider unreachable"}`,
    errorCode: "AUTO_REPAIR_CRITICAL",
    stackHint: `Provider: ${provider}, Fallbacks tried: ${fallbacks.join(", ") || "none"}`,
  });

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

  // 自動根因分析
  enrichTraceWithDiagnosis(full);

  errorTraces.unshift(full);
  if (errorTraces.length > MAX_TRACES) errorTraces.length = MAX_TRACES;

  // 自動觸發爬網搜尋修復方案
  void autoSearchForFix(full);

  return full;
}

/** 自動爬網搜尋修復方案（增強版：根因導向搜尋） */
async function autoSearchForFix(trace: ErrorTrace): Promise<void> {
  try {
    // 建立根因導向的搜尋查詢
    let query: string;
    if (trace.errorCategory && trace.errorCategory !== "unknown") {
      const matched = classifyError(trace.errorMessage, trace.errorCode);
      const hints = matched?.searchHints ?? [];
      query = hints.length > 0
        ? `${trace.engine} ${hints[0]}`
        : `${trace.engine} ${trace.errorCategory} ${trace.errorMessage.slice(0, 80)} fix`;
    } else {
      query = `${trace.engine} ${trace.errorCode ?? ""} ${trace.errorMessage.slice(0, 100)} fix solution`;
    }

    const results = await webSearch(query, 2);

    if (results.length > 0) {
      const idx = errorTraces.findIndex((t) => t.id === trace.id);
      if (idx >= 0) {
        errorTraces[idx].webSearchResult = results
          .map((r) => `[${r.title}](${r.url}): ${r.summary}`)
          .join("\n\n");
      }

      // 建立修復提案（包含根因資訊）
      const categoryLabel = trace.errorCategory && trace.errorCategory !== "unknown"
        ? `[${ERROR_CATEGORY_LABELS[trace.errorCategory]}] `
        : "";
      createReflectionProposal({
        category: "accuracy_fix",
        title: `${categoryLabel}修復 ${trace.engine} 錯誤: ${trace.errorCode ?? trace.errorMessage.slice(0, 50)}`,
        description: `生成錯誤自動偵測到：${trace.errorMessage}\n\n${trace.rootCause ? `🔍 根因分析：${trace.rootCause}\n\n` : ""}爬網搜尋到以下相關資訊：\n${results.map((r) => `- ${r.title}: ${r.summary}`).join("\n")}`,
        currentValue: trace.engine,
        proposedValue: results[0].summary.slice(0, 200),
        reasoning: `根據根因分析（${trace.errorCategory ?? "未分類"}）和網路搜尋結果，此錯誤可能透過以下方式修復。需要管理員確認後才會套用變更。`,
        confidence: Math.min(results[0].relevance, trace.rootCauseConfidence ?? 50),
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
// 2b. 錯誤根因分析與步驟式解決方案
// ═══════════════════════════════════════════════════════════════════════════

/** 已知錯誤模式資料庫 */
interface KnownErrorPattern {
  category: ErrorCategory;
  patterns: RegExp[];       // errorMessage 或 errorCode 的正則匹配
  rootCause: string;
  steps: SolutionStep[];
  searchHints: string[];    // 針對性搜尋建議
}

const KNOWN_ERROR_PATTERNS: KnownErrorPattern[] = [
  // ── 速率限制 ──
  {
    category: "rate_limit",
    patterns: [
      /rate.?limit/i, /too many requests/i, /429/i, /quota.*exceeded/i,
      /resource.*exhausted/i, /RATE_LIMIT/i, /請求過於頻繁/,
    ],
    rootCause: "API 請求過於頻繁，超過供應商的速率限制。可能是短時間內發送了太多請求，或是免費方案的配額已用盡。",
    steps: [
      { step: 1, title: "確認目前配額狀態", description: "前往 API 供應商的控制台（如 Google AI Studio、Fal.ai Dashboard），檢查目前的用量與剩餘配額。", action: "check" },
      { step: 2, title: "減少請求頻率", description: "在設定頁面調整巡檢間隔（建議 5 分鐘以上），或減少同時進行的生成任務數量。", action: "fix" },
      { step: 3, title: "升級 API 方案", description: "若免費配額不足，考慮升級至付費方案以獲得更高的速率限制。", action: "fix", command: "前往供應商控制台 → Billing → Upgrade Plan" },
      { step: 4, title: "啟用備援引擎", description: "系統已自動嘗試切換備援引擎，確認備援是否成功。若備援也失敗，可手動在大腦組態中切換引擎。", action: "fallback" },
      { step: 5, title: "驗證修復結果", description: "等待 5-10 分鐘後，回到此頁面確認錯誤是否不再出現。可使用「精準度測試」頁籤測試引擎是否恢復。", action: "verify" },
    ],
    searchHints: ["rate limit error fix", "API quota exceeded solution", "429 too many requests workaround"],
  },
  // ── 認證失敗 ──
  {
    category: "auth_failure",
    patterns: [
      /api.?key.*invalid/i, /unauthorized/i, /401/i, /403/i,
      /authentication.*fail/i, /PERMISSION_DENIED/i, /invalid.*credential/i,
      /forbidden/i, /access.*denied/i,
    ],
    rootCause: "API Key 無效、過期或權限不足。可能是環境變數未設定，或 API Key 已被撤銷。",
    steps: [
      { step: 1, title: "檢查環境變數", description: "確認相關的 API Key 環境變數已正確設定。常見的有：GEMINI_API_KEY、FAL_API_KEY、ELEVENLABS_API_KEY、REPLICATE_API_TOKEN。", action: "check", command: "在 .env 檔案中檢查對應的 KEY 是否存在且不為空" },
      { step: 2, title: "驗證 API Key 有效性", description: "前往 API 供應商控制台，確認 Key 狀態為啟用中且未過期。嘗試在供應商的 API Playground 測試是否可用。", action: "check" },
      { step: 3, title: "重新產生 API Key", description: "若 Key 已過期或被撤銷，在供應商控制台重新產生新的 Key，並更新環境變數。", action: "fix", command: "1. 前往供應商 Dashboard\n2. API Keys → Create New Key\n3. 複製新 Key → 更新 .env 檔案\n4. 重新啟動伺服器" },
      { step: 4, title: "檢查 API 權限", description: "確認 API Key 擁有所需的 API 存取權限。部分供應商需要額外啟用特定 API（如 Gemini API 需要在 Google Cloud Console 啟用）。", action: "fix" },
      { step: 5, title: "重啟伺服器並驗證", description: "更新 Key 後重啟伺服器，並使用「精準度測試」頁籤驗證 API 是否恢復正常。", action: "verify" },
    ],
    searchHints: ["API key invalid fix", "authentication failed API", "401 unauthorized solution"],
  },
  // ── 連線過多 / 連線問題 ──
  {
    category: "connection",
    patterns: [
      /too many connections/i, /ECONNREFUSED/i, /ECONNRESET/i,
      /connection.*refused/i, /socket.*hang.*up/i, /network.*error/i,
      /ENOTFOUND/i, /DNS/i, /fetch.*failed/i, /connect.*timeout/i,
      /ERR_SOCKET/i, /EPIPE/i, /connection.*closed/i,
    ],
    rootCause: "網路連線問題。可能原因：一次開啟太多連線導致資源耗盡、目標伺服器暫時不可用、DNS 解析失敗、或防火牆阻擋。",
    steps: [
      { step: 1, title: "確認網路狀態", description: "檢查伺服器的網路連線是否正常。可嘗試 ping 目標 API 伺服器。", action: "check", command: "ping api.search.brave.com\nping generativelanguage.googleapis.com\nping queue.fal.run" },
      { step: 2, title: "減少同時連線數", description: "若錯誤是「too many connections」，需減少同時進行的任務。在大腦組態中降低巡檢頻率，或限制同時進行的生成任務數。", action: "fix" },
      { step: 3, title: "檢查 DNS 設定", description: "若錯誤包含 ENOTFOUND，代表 DNS 解析失敗。檢查伺服器的 DNS 設定，或嘗試使用 Google DNS (8.8.8.8) 或 Cloudflare DNS (1.1.1.1)。", action: "fix", command: "echo 'nameserver 8.8.8.8' | sudo tee /etc/resolv.conf" },
      { step: 4, title: "等待並重試", description: "如果是暫時性的網路問題，系統會自動重試。通常等待幾分鐘後即可恢復。", action: "fallback" },
      { step: 5, title: "確認恢復", description: "使用「警報」頁籤的巡檢功能確認 API 端點已恢復連線。", action: "verify" },
    ],
    searchHints: ["too many connections fix", "ECONNREFUSED solution", "socket hang up nodejs"],
  },
  // ── 逾時 ──
  {
    category: "timeout",
    patterns: [
      /timeout/i, /ETIMEDOUT/i, /timed?\s*out/i, /deadline.*exceeded/i,
      /request.*aborted/i, /AbortError/i, /took too long/i,
    ],
    rootCause: "請求逾時。API 伺服器回應時間過長，可能是因為任務太複雜、伺服器負載過高，或網路延遲。",
    steps: [
      { step: 1, title: "確認是偶發或持續性", description: "觀察此錯誤是否只出現一次還是反覆發生。偶發逾時通常可透過重試解決。", action: "check" },
      { step: 2, title: "降低任務複雜度", description: "嘗試使用較短的提示詞、較低的解析度或較短的影片長度。複雜任務更容易逾時。", action: "fix" },
      { step: 3, title: "切換到更快的模型", description: "考慮從 Pro 模型切換到 Flash 模型（如 gemini-2.5-flash），Flash 模型回應更快。", action: "fix" },
      { step: 4, title: "檢查伺服器負載", description: "若持續逾時，可能是 API 供應商伺服器過載。查看供應商的狀態頁面了解是否有服務中斷。", action: "check", command: "查看供應商狀態頁：\n- Google: status.cloud.google.com\n- Fal.ai: status.fal.ai" },
      { step: 5, title: "驗證修復", description: "調整後重新提交任務，確認不再出現逾時錯誤。", action: "verify" },
    ],
    searchHints: ["API timeout fix", "request timeout solution", "deadline exceeded API"],
  },
  // ── 缺失 API / 端點不存在 ──
  {
    category: "missing_api",
    patterns: [
      /not found/i, /404/i, /endpoint.*not.*exist/i, /no such/i,
      /model.*not.*found/i, /invalid.*model/i, /unknown.*model/i,
      /does not exist/i, /cannot find/i, /API.*not.*enabled/i,
    ],
    rootCause: "API 端點或模型不存在。可能是模型名稱拼寫錯誤、API 版本已更新、或該模型已被供應商下架。",
    steps: [
      { step: 1, title: "確認模型名稱", description: "檢查大腦組態中設定的模型名稱是否正確。對照供應商的文件確認最新的模型 ID。", action: "check" },
      { step: 2, title: "檢查 API 版本", description: "供應商可能已更新 API 版本。確認使用的 API URL 是否為最新版本。", action: "check", command: "查看供應商 API 文件：\n- Gemini: ai.google.dev/docs\n- Fal.ai: fal.ai/docs" },
      { step: 3, title: "更新模型設定", description: "在大腦組態頁面中，將引擎切換為可用的模型。可使用模型目錄查看所有支援的模型。", action: "fix" },
      { step: 4, title: "啟用所需的 API", description: "部分 API 需要在供應商控制台手動啟用。前往控制台確認已啟用所需的 API 服務。", action: "fix", command: "Google Cloud Console → APIs & Services → Enable APIs" },
      { step: 5, title: "測試新設定", description: "更新設定後，使用「精準度測試」驗證新模型是否正常運作。", action: "verify" },
    ],
    searchHints: ["API model not found fix", "404 endpoint not exist", "API not enabled solution"],
  },
  // ── 連結中斷 / 資源不存在 ──
  {
    category: "broken_link",
    patterns: [
      /broken.*link/i, /resource.*unavailable/i, /gone/i, /410/i,
      /permanently.*moved/i, /301/i, /302.*redirect/i,
      /cdn.*error/i, /asset.*not.*found/i,
    ],
    rootCause: "資源連結中斷或已失效。可能是 CDN 快取過期、遠端資源已被移除、或 URL 已變更。",
    steps: [
      { step: 1, title: "確認資源 URL", description: "檢查錯誤訊息中提到的 URL 是否可正常訪問。在瀏覽器中直接開啟測試。", action: "check" },
      { step: 2, title: "清除快取", description: "若使用了 CDN 或快取代理，嘗試清除快取並重新載入。", action: "fix" },
      { step: 3, title: "更新資源連結", description: "若資源已移動，更新系統中儲存的 URL 到新的位址。", action: "fix" },
      { step: 4, title: "確認恢復", description: "重新提交任務，確認資源可正常訪問。", action: "verify" },
    ],
    searchHints: ["broken link fix", "resource unavailable CDN", "410 gone error"],
  },
  // ── 參數驗證錯誤 ──
  {
    category: "validation",
    patterns: [
      /invalid.*param/i, /validation.*error/i, /bad.*request/i, /400/i,
      /invalid.*input/i, /malformed/i, /schema.*mismatch/i,
      /must be/i, /expected.*but.*got/i, /required.*field/i,
    ],
    rootCause: "API 請求參數不正確。可能是輸入值超出範圍、缺少必填欄位、或格式不符合要求。",
    steps: [
      { step: 1, title: "閱讀錯誤訊息", description: "錯誤訊息通常會指出具體哪個參數有問題。仔細閱讀錯誤詳情。", action: "check" },
      { step: 2, title: "檢查輸入值", description: "確認提示詞長度、圖片尺寸、影片長度等參數是否在允許的範圍內。", action: "check" },
      { step: 3, title: "修正輸入", description: "根據錯誤訊息調整輸入參數。常見問題：提示詞太長、含有不支援的特殊字元、圖片格式不正確。", action: "fix" },
      { step: 4, title: "重新提交", description: "修正參數後重新提交任務。", action: "verify" },
    ],
    searchHints: ["API bad request fix", "validation error parameter", "400 invalid input"],
  },
  // ── 伺服器內部錯誤 ──
  {
    category: "server_error",
    patterns: [
      /500/i, /internal.*server/i, /502/i, /503/i, /bad.*gateway/i,
      /service.*unavailable/i, /server.*error/i, /downstream/i,
    ],
    rootCause: "API 供應商的伺服器發生內部錯誤。這通常不是使用者端的問題，而是供應商服務暫時異常。",
    steps: [
      { step: 1, title: "檢查供應商狀態頁", description: "查看 API 供應商的服務狀態頁面，確認是否有已知的服務中斷事件。", action: "check", command: "常見狀態頁：\n- Google Cloud: status.cloud.google.com\n- Fal.ai: status.fal.ai\n- Replicate: status.replicate.com" },
      { step: 2, title: "等待恢復", description: "伺服器錯誤通常會在短時間內恢復。建議等待 10-30 分鐘後重試。", action: "fallback" },
      { step: 3, title: "使用備援引擎", description: "若等待後仍未恢復，可在大腦組態中手動切換到備援引擎。", action: "fallback" },
      { step: 4, title: "回報問題", description: "若超過 1 小時仍未恢復，建議向供應商回報問題。", action: "fix" },
      { step: 5, title: "確認恢復", description: "伺服器恢復後，使用「精準度測試」驗證功能是否正常。", action: "verify" },
    ],
    searchHints: ["API 500 internal server error", "502 bad gateway fix", "service unavailable workaround"],
  },
  // ── 配額用盡 ──
  {
    category: "quota_exceeded",
    patterns: [
      /quota/i, /billing/i, /payment.*required/i, /402/i,
      /credit.*insufficient/i, /plan.*limit/i, /usage.*limit/i,
    ],
    rootCause: "API 配額已用盡或帳戶餘額不足。需要升級方案或補充帳戶餘額。",
    steps: [
      { step: 1, title: "查看帳戶用量", description: "登入 API 供應商控制台，檢查目前的用量統計和剩餘配額。", action: "check" },
      { step: 2, title: "確認帳單狀態", description: "確認帳戶的付款方式有效且餘額充足。", action: "check" },
      { step: 3, title: "升級方案或充值", description: "若配額不足，考慮升級到更高的方案或充值帳戶餘額。", action: "fix", command: "前往供應商 Dashboard → Billing → Upgrade 或 Add Credits" },
      { step: 4, title: "暫時使用備援", description: "在等待配額恢復期間，可切換到其他供應商的替代引擎。", action: "fallback" },
      { step: 5, title: "設定用量警告", description: "建議在供應商控制台設定用量警告，避免再次耗盡配額。", action: "verify" },
    ],
    searchHints: ["API quota exceeded solution", "billing payment required fix", "credit insufficient API"],
  },
  // ── 模型不可用 ──
  {
    category: "model_unavailable",
    patterns: [
      /model.*unavailable/i, /model.*deprecated/i, /model.*retired/i,
      /model.*overloaded/i, /capacity/i, /region.*not.*supported/i,
      /not.*available.*region/i,
    ],
    rootCause: "所選模型目前不可用。可能是模型已被棄用、正在維護、過載，或在目前區域不支援。",
    steps: [
      { step: 1, title: "確認模型狀態", description: "查看供應商文件確認模型是否仍在支援中。部分模型可能已被新版本取代。", action: "check" },
      { step: 2, title: "切換替代模型", description: "在大腦組態中切換到可用的替代模型。查看模型目錄找到合適的替代品。", action: "fix" },
      { step: 3, title: "檢查區域限制", description: "部分模型僅在特定區域可用。確認帳戶所在區域是否支援該模型。", action: "check" },
      { step: 4, title: "等待恢復", description: "若模型因過載暫時不可用，等待幾分鐘後重試。", action: "fallback" },
      { step: 5, title: "驗證", description: "切換模型後，使用「精準度測試」驗證新模型是否正常運作。", action: "verify" },
    ],
    searchHints: ["model unavailable alternative", "deprecated model replacement", "model overloaded fix"],
  },
];

/** 錯誤分類的中文標籤 */
export const ERROR_CATEGORY_LABELS: Record<ErrorCategory, string> = {
  rate_limit: "速率限制",
  auth_failure: "認證失敗",
  connection: "連線問題",
  timeout: "請求逾時",
  missing_api: "缺失 API",
  broken_link: "連結中斷",
  validation: "參數錯誤",
  server_error: "伺服器錯誤",
  quota_exceeded: "配額用盡",
  model_unavailable: "模型不可用",
  unknown: "未知錯誤",
};

/** 分類錯誤：根據錯誤訊息和錯誤碼匹配已知模式 */
function classifyError(errorMessage: string, errorCode?: string): KnownErrorPattern | null {
  const combined = `${errorCode ?? ""} ${errorMessage}`;
  for (const pattern of KNOWN_ERROR_PATTERNS) {
    for (const regex of pattern.patterns) {
      if (regex.test(combined)) {
        return pattern;
      }
    }
  }
  return null;
}

/** 找出相關的歷史錯誤（同一引擎或同一分類） */
function findRelatedTraces(trace: ErrorTrace, category: ErrorCategory): string[] {
  return errorTraces
    .filter((t) =>
      t.id !== trace.id &&
      !t.resolvedAt &&
      (t.engine === trace.engine || t.errorCategory === category)
    )
    .slice(0, 5)
    .map((t) => t.id);
}

/** 生成針對性的搜尋查詢 */
function buildSearchQueries(trace: ErrorTrace, category: ErrorCategory): string[] {
  const provider = ENGINE_PROVIDER_MAP[trace.engine] ?? "unknown";
  const queries: string[] = [];

  // 通用搜尋
  queries.push(`${trace.engine} ${trace.errorCode ?? ""} error fix`);

  // 按分類建立針對性搜尋
  switch (category) {
    case "rate_limit":
      queries.push(`${provider} API rate limit increase workaround`);
      queries.push(`${trace.engine} 429 too many requests solution`);
      break;
    case "auth_failure":
      queries.push(`${provider} API key setup guide`);
      queries.push(`${trace.engine} authentication failed fix`);
      break;
    case "connection":
      queries.push(`${provider} connection error ECONNREFUSED fix nodejs`);
      queries.push(`too many connections ${provider} API limit`);
      break;
    case "timeout":
      queries.push(`${trace.engine} timeout increase limit`);
      queries.push(`${provider} API slow response fix`);
      break;
    case "missing_api":
      queries.push(`${trace.engine} model name latest version`);
      queries.push(`${provider} enable API setup guide`);
      break;
    case "broken_link":
      queries.push(`${provider} CDN resource unavailable fix`);
      break;
    case "validation":
      queries.push(`${trace.engine} input validation requirements`);
      queries.push(`${provider} API parameter limits`);
      break;
    case "server_error":
      queries.push(`${provider} status page outage`);
      queries.push(`${trace.engine} 500 server error workaround`);
      break;
    case "quota_exceeded":
      queries.push(`${provider} billing quota increase`);
      queries.push(`${trace.engine} free tier limits`);
      break;
    case "model_unavailable":
      queries.push(`${trace.engine} alternative replacement model`);
      queries.push(`${provider} model availability regions`);
      break;
    default:
      queries.push(`${trace.engine} ${trace.errorMessage.slice(0, 60)} solution`);
  }

  return queries;
}

/**
 * 完整的錯誤診斷：分類 + 根因分析 + 步驟式修復方案
 */
export function diagnoseError(traceId: string): ErrorDiagnosis | null {
  const trace = errorTraces.find((t) => t.id === traceId);
  if (!trace) return null;

  const matched = classifyError(trace.errorMessage, trace.errorCode);
  const category: ErrorCategory = matched?.category ?? "unknown";
  const relatedTraceIds = findRelatedTraces(trace, category);
  const searchQueries = buildSearchQueries(trace, category);

  // Confidence scoring constants
  const BASE_CONFIDENCE = 85;
  const UNMATCHED_CONFIDENCE = 30;
  const MAX_CONFIDENCE = 95;
  const MIN_RELATED_TRACES_FOR_BOOST = 2;
  const CONFIDENCE_BOOST_PER_TRACE = 3;

  let rootCause: string;
  let confidence: number;
  let steps: SolutionStep[];

  if (matched) {
    rootCause = matched.rootCause;
    confidence = BASE_CONFIDENCE;
    steps = matched.steps;

    // 若有多個相關錯誤，提高信心度
    if (relatedTraceIds.length >= MIN_RELATED_TRACES_FOR_BOOST) {
      confidence = Math.min(MAX_CONFIDENCE, confidence + relatedTraceIds.length * CONFIDENCE_BOOST_PER_TRACE);
    }
  } else {
    rootCause = `未能自動分類此錯誤。錯誤訊息：「${trace.errorMessage.slice(0, 100)}」。建議使用下方的搜尋關鍵字在網路上搜尋解決方案，或手動檢查 API 設定。`;
    confidence = UNMATCHED_CONFIDENCE;
    steps = [
      { step: 1, title: "閱讀錯誤訊息", description: "仔細閱讀完整的錯誤訊息，記下關鍵的錯誤碼和錯誤描述。", action: "check" },
      { step: 2, title: "搜尋解決方案", description: "使用下方的「爬網研究」功能搜尋錯誤訊息，尋找他人的解決經驗。", action: "check" },
      { step: 3, title: "檢查 API 設定", description: "在「大腦組態」頁籤確認所有 API Key 和模型設定正確。", action: "fix" },
      { step: 4, title: "嘗試備援引擎", description: "切換到備援引擎測試是否正常運作。", action: "fallback" },
      { step: 5, title: "聯繫支援", description: "若以上步驟皆無效，建議記錄完整錯誤訊息並聯繫技術支援。", action: "verify" },
    ];
  }

  return {
    errorCategory: category,
    rootCause,
    rootCauseConfidence: confidence,
    suggestedSteps: steps,
    relatedTraceIds,
    searchQueries,
  };
}

/**
 * 增強版：記錄錯誤時自動進行根因分析
 */
function enrichTraceWithDiagnosis(trace: ErrorTrace): void {
  const matched = classifyError(trace.errorMessage, trace.errorCode);
  if (matched) {
    trace.errorCategory = matched.category;
    trace.rootCause = matched.rootCause;
    trace.rootCauseConfidence = 85;
    trace.suggestedSteps = matched.steps;
  } else {
    trace.errorCategory = "unknown";
    trace.rootCauseConfidence = 0;
  }
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
 * 使用 Brave Search API 搜尋網路。
 * 若 Brave Search API Key 未設定，退回 GitHub 搜尋作為備援。
 */
export async function webSearch(query: string, maxResults = 5): Promise<WebResearchResult[]> {
  const results: WebResearchResult[] = [];

  // ── 嘗試 Brave Search API ──────────────────────────────────
  const braveApiKey = ENV.braveSearchApiKey;
  if (braveApiKey) {
    try {
      const encoded = encodeURIComponent(query);
      const braveUrl = `https://api.search.brave.com/res/v1/web/search?q=${encoded}&count=${maxResults}`;
      const res = await fetch(braveUrl, {
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": braveApiKey,
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (res.ok) {
        const data = await res.json() as {
          web?: {
            results?: Array<{
              title?: string;
              description?: string;
              url?: string;
            }>;
          };
        };

        if (data.web?.results) {
          for (const item of data.web.results.slice(0, maxResults)) {
            if (item.title && item.url) {
              results.push({
                id: genId("web"),
                query,
                source: "Brave Search",
                title: item.title.slice(0, 100),
                summary: item.description ?? item.title,
                url: item.url,
                relevance: 80,
                addedToLearnHub: false,
                createdAt: Date.now(),
              });
            }
          }
        }
      }
    } catch (err) {
      console.warn("[WebResearch] Brave Search 搜尋失敗:", err);
    }
  }

  // 若 Brave Search 沒有結果，嘗試 GitHub 公開搜尋 API
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
  {
    engine: "minimaxai/minimax-m2.7",
    testType: "response_quality",
    testPrompt: "用 30 字描述一朵花",
    expectedBehavior: "回傳包含花卉相關描述的繁體中文或英文文字，字數接近 30",
  },
  {
    engine: "minimaxai/minimax-m2.7",
    testType: "latency",
    testPrompt: "回答 2+2=?",
    expectedBehavior: "在 5 秒內回傳包含 '4' 的回應",
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
        if (actualResult === "[無回應內容]") {
          console.warn(`[BrainAutoRepair] 精準度測試: ${engine} 回傳非預期結構`, JSON.stringify(data).slice(0, 500));
        }

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
