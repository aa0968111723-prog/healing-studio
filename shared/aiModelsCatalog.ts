/**
 * shared/aiModelsCatalog.ts — AI 模型情報專區（共享層）
 *
 * 這個檔案放在 shared/ 是為了讓 **server**（auto-research 後端、cron job、
 * tRPC router）和 **client**（AI Models Hub 頁面）共用同一份型別與基準資料。
 *
 * 設計重點：
 *   1. 基準資料（baseline catalog）：人工策展的目錄，包含名稱、廠商、模態、
 *      強弱項等核心欄位。這是 source of truth，不會被自動研究覆蓋。
 *   2. 自動研究擴充欄位（enriched fields）：定價、基準分數、最新動態、事實
 *      查核狀態與來源、上次驗證時間。這些由 modelResearcher 透過 Perplexity
 *      深度搜尋週期性自動更新。
 *   3. 合併語意：呼叫端把 baseline + enrichment 合併成 `EnrichedAIModelEntry`，
 *      未經自動研究的模型仍能正常顯示，只是 verification badge 為 "pending"。
 *
 * 自動研究流程：
 *   - cron 每週執行一次 `researchAndFactCheckAllModels()`
 *   - 每個 model 呼叫 Perplexity sonar-pro，要求：
 *       a) 確認模型仍可用且資訊正確
 *       b) 拿到最新定價（每百萬 input/output token）
 *       c) 拿到主要 benchmark 分數（MMLU/HumanEval/GPQA 等）
 *       d) 拿到最近 30 天內的重要更新
 *       e) 提供 3-5 個可點擊的引用來源 URL
 *   - 結果寫入 in-memory cache，並 broadcast 給前端
 */

// ─── Core enums ────────────────────────────────────────────────────────────

export type ModelModality =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "multimodal"
  | "embedding"
  | "agent";

export type ModelProvider =
  | "Anthropic"
  | "OpenAI"
  | "Google"
  | "Meta"
  | "Mistral"
  | "DeepSeek"
  | "xAI"
  | "Alibaba"
  | "Stability AI"
  | "Midjourney"
  | "Black Forest Labs"
  | "Runway"
  | "Pika"
  | "Luma"
  | "ElevenLabs"
  | "Suno"
  | "Udio"
  | "Microsoft"
  | "Moonshot"
  | "Zhipu"
  | "Tencent"
  | "Kling AI"
  | "Cohere"
  | "Voyage AI"
  | "MiniMax"
  | "Ideogram"
  | "Recraft"
  | "NVIDIA"
  | "GitHub"
  | "Cognition"
  | "Replit"
  | "Cursor"
  | "Manus"
  | "Perplexity"
  | "LangChain";

export type LatencyClass = "realtime" | "fast" | "standard" | "slow";

export type SafetyTier = "high" | "medium" | "low" | "unrestricted";

export type ComplianceTag = "SOC2" | "HIPAA" | "GDPR" | "ISO27001" | "FedRAMP";

/**
 * 模型能力矩陣。所有欄位皆為可選（undefined 表示「未知 / 未確認」），
 * 自動研究會嘗試填上明確的 true / false。
 */
export interface ModelCapabilities {
  /** 是否支援讀取圖像輸入 */
  visionInput?: boolean;
  /** 是否支援讀取音訊輸入 */
  audioInput?: boolean;
  /** 是否支援讀取影片輸入 */
  videoInput?: boolean;
  /** 是否支援 function / tool calling */
  functionCalling?: boolean;
  /** 是否支援 JSON / 結構化輸出 */
  structuredOutput?: boolean;
  /** 是否支援串流（streaming）輸出 */
  streaming?: boolean;
  /** 是否支援 fine-tuning */
  fineTuning?: boolean;
  /** 是否內建程式碼執行（code interpreter） */
  codeExecution?: boolean;
  /** 是否內建瀏覽 / 網路搜尋工具 */
  webSearch?: boolean;
  /** 是否支援 prompt caching（顯著降低重複 input 成本） */
  promptCaching?: boolean;
  /** 是否支援批次（batch）API（通常 50% 折扣） */
  batchApi?: boolean;
}

export type ModelTier = "frontier" | "balanced" | "lightweight" | "open-source";

export type PricingTier =
  | "free"
  | "low"
  | "medium"
  | "high"
  | "premium"
  | "self-host";

export type FactCheckStatus =
  | "verified"
  | "auto-checked"
  | "pending"
  | "stale"
  | "error";

// ─── Enriched (auto-researched) sub-types ──────────────────────────────────

export interface ModelPricing {
  /** 每百萬 input token 的價格（USD），或自行部署時為 "self-host" */
  inputPerMillion?: string;
  /** 每百萬 output token 的價格（USD） */
  outputPerMillion?: string;
  /** 通用顯示單位，例如「USD / 1M tokens」、「USD / image」、「USD / second」 */
  unit: string;
  /** 額外說明（例如 cached prompt 折扣、batch API 折扣等） */
  note?: string;
  /** 粗略的價格區段 */
  tier: PricingTier;
}

export interface BenchmarkScore {
  /** 基準名稱：MMLU、HumanEval、GPQA、SWE-bench、Math-500、etc */
  name: string;
  /** 分數本身（可能是百分比或絕對分數） */
  score: string;
  /** 在排行榜上的相對位置（可選） */
  rank?: string;
  /** 來源 URL（必填，用來證明這個分數是真的） */
  sourceUrl?: string;
}

export interface ModelUpdate {
  /** ISO date 或 YYYY-MM 字串 */
  date: string;
  /** 1-2 句中文摘要 */
  summary: string;
  /** 來源連結（必填，用來驗證） */
  url?: string;
}

export interface FactCheckSource {
  title: string;
  url: string;
  /** 1-2 句節錄，說明這個來源證實了什麼 */
  snippet?: string;
  /** 來源網域，用來顯示 favicon / 信譽指示 */
  domain?: string;
}

export interface ModelAvailability {
  /** 是否提供官方 API */
  api: boolean;
  /** 是否有 web UI 直接使用 */
  web: boolean;
  /** 是否可自行部署（含開源權重的情況） */
  selfHost: boolean;
  /** 區域限制或其他補充 */
  notes?: string;
}

export interface FactCheckMeta {
  status: FactCheckStatus;
  /** ISO timestamp 上次自動研究完成的時間 */
  checkedAt?: string;
  /** Perplexity / OpenRouter / Brave 哪個提供者實際給出結果 */
  provider?: string;
  /** 引用來源（必填於 verified / auto-checked 狀態） */
  sources: FactCheckSource[];
  /** 補充說明（例如「找不到 v3 的正式公告，建議手動覆核」） */
  notes?: string;
  /** 自動研究是否有發現顯著的事實差異（讓 UI 警示） */
  hasDiscrepancy?: boolean;
}

// ─── Base (manually curated) entry ─────────────────────────────────────────

export interface AIModelEntry {
  id: string;
  /** Display name, e.g. "Claude Opus 4.7" */
  name: string;
  /** Short code-style version label, e.g. "claude-opus-4-7" */
  apiId?: string;
  provider: ModelProvider;
  modality: ModelModality;
  /** Tier classification for sorting and filtering. */
  tier: ModelTier;
  /** Approximate release / latest update date in ISO format. */
  releaseDate: string;
  /** One-line tagline shown on cards. */
  tagline: string;
  /** 2-4 sentence description shown in detail modal. */
  description: string;
  /** Top 3-5 strengths. */
  strengths: string[];
  /** Top 2-3 limitations / trade-offs. */
  limitations: string[];
  /** Suggested user scenarios. */
  useCases: string[];
  /** Context window in tokens for text models, or notable spec for other modalities. */
  contextWindow?: string;
  /** Whether the model is open-weight / open-source. */
  openWeight: boolean;
  /** Tag-style chips on the card. */
  tags: string[];
  /** Whether to spotlight the model at the top of the page. */
  featured?: boolean;
  /** Provider's official link. */
  officialUrl?: string;

  // ─── Enriched fields (populated by manual seed + auto-research) ──────────

  /** 結構化定價資訊 */
  pricing?: ModelPricing;
  /** 主要 benchmark 分數（auto-research 會嘗試補上來源 URL） */
  benchmarks?: BenchmarkScore[];
  /** 過去 90 天內的重要更新事件（cron 會持續累積最近 8 筆） */
  latestUpdates?: ModelUpdate[];
  /** 取得 / 部署管道 */
  availability?: ModelAvailability;
  /** 事實查核 metadata */
  factCheck?: FactCheckMeta;
  /** 搜尋建議關鍵字（auto-research 用，用來提示 Perplexity 該找什麼） */
  researchKeywords?: string[];

  // ─── Additional facets（細節擴充） ───────────────────────────────────────

  /** 訓練資料截止月份，例如「2024-12」。auto-research 也會嘗試更新。 */
  trainingCutoff?: string;
  /** 主要支援語言（顯示前 5 個）；可放 ISO 代碼或顯示名稱。 */
  languages?: string[];
  /** 典型回應延遲分級。 */
  latencyClass?: LatencyClass;
  /** 地理可用性或主要可用區域備註，例如「中國大陸限定」、「歐洲未上線」。 */
  region?: string;
  /** 結構化能力旗標（vision input、function calling、batch API 等） */
  capabilities?: ModelCapabilities;
  /** 內容安全 / 對齊分級 */
  safetyTier?: SafetyTier;
  /** 已取得的合規憑證 / 標籤（SOC2、HIPAA、GDPR…） */
  compliance?: ComplianceTag[];
  /** 相似 / 競品模型 ID 清單（顯示為「相似模型」推薦） */
  peers?: string[];
  /** 是否支援同廠商 API 即時轉換到其他版本（用於版本血緣展示） */
  predecessorId?: string;
}

/** Server-side enriched entry — same shape, but factCheck is guaranteed to exist after auto-research. */
export type EnrichedAIModelEntry = AIModelEntry & {
  factCheck: FactCheckMeta;
};

// ─── Provider / modality / tier styling (shared for SSR) ───────────────────

export const PROVIDER_STYLE: Record<
  ModelProvider,
  { accent: string; bg: string; ring: string; label: string }
> = {
  Anthropic: {
    accent: "text-orange-700",
    bg: "bg-orange-50",
    ring: "ring-orange-200",
    label: "Anthropic",
  },
  OpenAI: {
    accent: "text-emerald-700",
    bg: "bg-emerald-50",
    ring: "ring-emerald-200",
    label: "OpenAI",
  },
  Google: {
    accent: "text-blue-700",
    bg: "bg-blue-50",
    ring: "ring-blue-200",
    label: "Google",
  },
  Meta: {
    accent: "text-indigo-700",
    bg: "bg-indigo-50",
    ring: "ring-indigo-200",
    label: "Meta",
  },
  Mistral: {
    accent: "text-rose-700",
    bg: "bg-rose-50",
    ring: "ring-rose-200",
    label: "Mistral AI",
  },
  DeepSeek: {
    accent: "text-cyan-700",
    bg: "bg-cyan-50",
    ring: "ring-cyan-200",
    label: "DeepSeek",
  },
  xAI: {
    accent: "text-slate-700",
    bg: "bg-slate-100",
    ring: "ring-slate-300",
    label: "xAI",
  },
  Alibaba: {
    accent: "text-amber-700",
    bg: "bg-amber-50",
    ring: "ring-amber-200",
    label: "Alibaba / Qwen",
  },
  "Stability AI": {
    accent: "text-purple-700",
    bg: "bg-purple-50",
    ring: "ring-purple-200",
    label: "Stability AI",
  },
  Midjourney: {
    accent: "text-fuchsia-700",
    bg: "bg-fuchsia-50",
    ring: "ring-fuchsia-200",
    label: "Midjourney",
  },
  "Black Forest Labs": {
    accent: "text-stone-700",
    bg: "bg-stone-100",
    ring: "ring-stone-300",
    label: "Black Forest Labs",
  },
  Runway: {
    accent: "text-teal-700",
    bg: "bg-teal-50",
    ring: "ring-teal-200",
    label: "Runway",
  },
  Pika: {
    accent: "text-pink-700",
    bg: "bg-pink-50",
    ring: "ring-pink-200",
    label: "Pika",
  },
  Luma: {
    accent: "text-violet-700",
    bg: "bg-violet-50",
    ring: "ring-violet-200",
    label: "Luma AI",
  },
  ElevenLabs: {
    accent: "text-sky-700",
    bg: "bg-sky-50",
    ring: "ring-sky-200",
    label: "ElevenLabs",
  },
  Suno: {
    accent: "text-red-700",
    bg: "bg-red-50",
    ring: "ring-red-200",
    label: "Suno",
  },
  Udio: {
    accent: "text-yellow-700",
    bg: "bg-yellow-50",
    ring: "ring-yellow-200",
    label: "Udio",
  },
  Microsoft: {
    accent: "text-sky-700",
    bg: "bg-sky-50",
    ring: "ring-sky-200",
    label: "Microsoft",
  },
  Moonshot: {
    accent: "text-indigo-700",
    bg: "bg-indigo-50",
    ring: "ring-indigo-200",
    label: "Moonshot AI",
  },
  Zhipu: {
    accent: "text-emerald-700",
    bg: "bg-emerald-50",
    ring: "ring-emerald-200",
    label: "Zhipu AI",
  },
  Tencent: {
    accent: "text-blue-700",
    bg: "bg-blue-50",
    ring: "ring-blue-200",
    label: "Tencent",
  },
  "Kling AI": {
    accent: "text-fuchsia-700",
    bg: "bg-fuchsia-50",
    ring: "ring-fuchsia-200",
    label: "Kling AI",
  },
  Cohere: {
    accent: "text-violet-700",
    bg: "bg-violet-50",
    ring: "ring-violet-200",
    label: "Cohere",
  },
  "Voyage AI": {
    accent: "text-cyan-700",
    bg: "bg-cyan-50",
    ring: "ring-cyan-200",
    label: "Voyage AI",
  },
  MiniMax: {
    accent: "text-rose-700",
    bg: "bg-rose-50",
    ring: "ring-rose-200",
    label: "MiniMax",
  },
  Ideogram: {
    accent: "text-pink-700",
    bg: "bg-pink-50",
    ring: "ring-pink-200",
    label: "Ideogram",
  },
  Recraft: {
    accent: "text-amber-700",
    bg: "bg-amber-50",
    ring: "ring-amber-200",
    label: "Recraft",
  },
  NVIDIA: {
    accent: "text-emerald-700",
    bg: "bg-emerald-50",
    ring: "ring-emerald-200",
    label: "NVIDIA",
  },
  GitHub: {
    accent: "text-slate-800",
    bg: "bg-slate-100",
    ring: "ring-slate-300",
    label: "GitHub",
  },
  Cognition: {
    accent: "text-zinc-800",
    bg: "bg-zinc-100",
    ring: "ring-zinc-300",
    label: "Cognition",
  },
  Replit: {
    accent: "text-orange-700",
    bg: "bg-orange-50",
    ring: "ring-orange-200",
    label: "Replit",
  },
  Cursor: {
    accent: "text-neutral-800",
    bg: "bg-neutral-100",
    ring: "ring-neutral-300",
    label: "Cursor",
  },
  Manus: {
    accent: "text-amber-700",
    bg: "bg-amber-50",
    ring: "ring-amber-200",
    label: "Manus AI",
  },
  Perplexity: {
    accent: "text-teal-700",
    bg: "bg-teal-50",
    ring: "ring-teal-200",
    label: "Perplexity",
  },
  LangChain: {
    accent: "text-emerald-800",
    bg: "bg-emerald-50",
    ring: "ring-emerald-200",
    label: "LangChain",
  },
};

export const MODALITY_STYLE: Record<
  ModelModality,
  { label: string; emoji: string; chipBg: string; chipText: string }
> = {
  text: {
    label: "文字",
    emoji: "💬",
    chipBg: "bg-blue-50",
    chipText: "text-blue-700",
  },
  image: {
    label: "圖片",
    emoji: "🎨",
    chipBg: "bg-purple-50",
    chipText: "text-purple-700",
  },
  video: {
    label: "影片",
    emoji: "🎬",
    chipBg: "bg-rose-50",
    chipText: "text-rose-700",
  },
  audio: {
    label: "音訊",
    emoji: "🎵",
    chipBg: "bg-amber-50",
    chipText: "text-amber-700",
  },
  multimodal: {
    label: "多模態",
    emoji: "✨",
    chipBg: "bg-emerald-50",
    chipText: "text-emerald-700",
  },
  embedding: {
    label: "嵌入向量",
    emoji: "🔗",
    chipBg: "bg-slate-50",
    chipText: "text-slate-700",
  },
  agent: {
    label: "代理",
    emoji: "🤖",
    chipBg: "bg-indigo-50",
    chipText: "text-indigo-700",
  },
};

export const TIER_STYLE: Record<
  ModelTier,
  { label: string; chipBg: string; chipText: string; description: string }
> = {
  frontier: {
    label: "旗艦",
    chipBg: "bg-amber-50",
    chipText: "text-amber-800",
    description: "效能最強、用於最複雜任務的頂層模型",
  },
  balanced: {
    label: "均衡",
    chipBg: "bg-emerald-50",
    chipText: "text-emerald-800",
    description: "成本與效能間取得平衡，日常使用首選",
  },
  lightweight: {
    label: "輕量",
    chipBg: "bg-sky-50",
    chipText: "text-sky-800",
    description: "速度快、延遲低，適合即時互動",
  },
  "open-source": {
    label: "開源",
    chipBg: "bg-violet-50",
    chipText: "text-violet-800",
    description: "權重公開可自行部署",
  },
};

export const PRICING_TIER_STYLE: Record<
  PricingTier,
  { label: string; chipBg: string; chipText: string; hint: string }
> = {
  free: {
    label: "免費",
    chipBg: "bg-emerald-50",
    chipText: "text-emerald-700",
    hint: "提供免費額度或完全免費",
  },
  low: {
    label: "低成本",
    chipBg: "bg-sky-50",
    chipText: "text-sky-700",
    hint: "$ — 大量使用負擔小",
  },
  medium: {
    label: "中等",
    chipBg: "bg-blue-50",
    chipText: "text-blue-700",
    hint: "$$ — 日常生產力可接受",
  },
  high: {
    label: "高",
    chipBg: "bg-amber-50",
    chipText: "text-amber-800",
    hint: "$$$ — 旗艦級用量需控管",
  },
  premium: {
    label: "頂級",
    chipBg: "bg-rose-50",
    chipText: "text-rose-700",
    hint: "$$$$ — 僅在需要時開啟",
  },
  "self-host": {
    label: "自架",
    chipBg: "bg-violet-50",
    chipText: "text-violet-700",
    hint: "推論成本 = 自己的 GPU 電費",
  },
};

export const FACT_CHECK_STATUS_STYLE: Record<
  FactCheckStatus,
  { label: string; chipBg: string; chipText: string; description: string }
> = {
  verified: {
    label: "已查核",
    chipBg: "bg-emerald-50",
    chipText: "text-emerald-700",
    description: "人工 + 自動雙重驗證，附引用來源",
  },
  "auto-checked": {
    label: "自動驗證",
    chipBg: "bg-blue-50",
    chipText: "text-blue-700",
    description: "由自動研究管線於上次掃描中驗證",
  },
  pending: {
    label: "待驗證",
    chipBg: "bg-gray-100",
    chipText: "text-gray-600",
    description: "尚未進入自動研究週期",
  },
  stale: {
    label: "需更新",
    chipBg: "bg-amber-50",
    chipText: "text-amber-700",
    description: "上次驗證超過 14 天，下次排程將自動更新",
  },
  error: {
    label: "驗證失敗",
    chipBg: "bg-rose-50",
    chipText: "text-rose-700",
    description: "自動研究遭遇錯誤，請手動確認",
  },
};

// ─── Curated baseline catalog ──────────────────────────────────────────────

/**
 * 注意：這裡的 pricing / benchmarks / latestUpdates 是 **人工種子（seed）**，
 * 是某個時間點的合理估計，旨在讓首次部署時 UI 就有內容可顯示。
 * 自動研究 cron 會週期性覆蓋這些欄位（並把 factCheck.status 變成 "auto-checked"）。
 */
export const AI_MODELS_CATALOG: AIModelEntry[] = [
  // ── Anthropic ──────────────────────────────────────────────────────────
  {
    id: "claude-opus-4-7",
    name: "Claude Opus 4.7",
    apiId: "claude-opus-4-7",
    provider: "Anthropic",
    modality: "text",
    tier: "frontier",
    releaseDate: "2026-03",
    tagline: "Anthropic 最強旗艦模型，擅長深度推理與代理任務",
    description:
      "Claude 4 系列的最高階模型，在程式設計、長文本理解、複雜代理工作流（agentic workflow）中表現卓越。具備強化的反思與計畫能力，可在多步驟任務中保持脈絡一致。",
    strengths: [
      "頂尖的程式設計與重構能力",
      "長脈絡推理穩定，少出現主題漂移",
      "複雜代理任務的工具呼叫精準",
      "符合 Anthropic 安全性對齊原則",
    ],
    limitations: ["延遲較高，不適合即時互動", "Token 成本最高"],
    useCases: [
      "需要深度推理的程式開發",
      "長文件分析與摘要",
      "多步驟自主代理工作流",
      "研究級內容創作",
    ],
    contextWindow: "200K tokens",
    openWeight: false,
    tags: ["代理任務", "程式設計", "長脈絡"],
    featured: true,
    officialUrl: "https://www.anthropic.com/claude",
    pricing: {
      inputPerMillion: "$15",
      outputPerMillion: "$75",
      unit: "USD / 1M tokens",
      note: "Prompt caching 可省最多 90%；Batch API 折扣 50%",
      tier: "premium",
    },
    benchmarks: [
      { name: "SWE-bench Verified", score: "72%+" },
      { name: "MMLU", score: "88%+" },
      { name: "HumanEval", score: "94%+" },
    ],
    availability: {
      api: true,
      web: true,
      selfHost: false,
      notes:
        "Web 版位於 claude.ai；API 於 Anthropic / AWS Bedrock / GCP Vertex",
    },
    researchKeywords: [
      "Claude Opus 4.7 pricing 2026",
      "Claude Opus 4.7 benchmarks",
      "Anthropic Claude 4 release notes",
    ],
    factCheck: {
      status: "pending",
      sources: [],
    },
    capabilities: {
      visionInput: true,
      functionCalling: true,
      structuredOutput: true,
      streaming: true,
      promptCaching: true,
      batchApi: true,
      fineTuning: false,
    },
    safetyTier: "high",
    compliance: ["SOC2", "HIPAA", "GDPR", "ISO27001"],
    peers: ["gpt-5", "gemini-3-pro", "claude-sonnet-4-6"],
  },
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    apiId: "claude-sonnet-4-6",
    provider: "Anthropic",
    modality: "text",
    tier: "balanced",
    releaseDate: "2026-02",
    tagline: "速度與品質兼具，日常生產力首選",
    description:
      "Sonnet 4.6 是 Claude 4 系列的均衡型號，輸出品質接近 Opus，但速度與成本顯著降低。適合日常開發、寫作助手與 RAG 應用。",
    strengths: [
      "回應速度快，品質仍接近頂級",
      "上下文掌握度高",
      "工具呼叫穩定",
      "Token 成本比 Opus 低約 5 倍",
    ],
    limitations: ["最複雜的推理仍略遜於 Opus", "創意性內容偶爾不如 Opus 細膩"],
    useCases: [
      "日常程式開發助手",
      "客服與企業內部工具",
      "長文件 RAG 問答",
      "內容創作與編輯",
    ],
    contextWindow: "200K tokens",
    openWeight: false,
    tags: ["均衡", "高 CP 值", "通用"],
    featured: true,
    officialUrl: "https://www.anthropic.com/claude",
    pricing: {
      inputPerMillion: "$3",
      outputPerMillion: "$15",
      unit: "USD / 1M tokens",
      note: "Batch API 折扣 50%；prompt caching 顯著降低重複請求成本",
      tier: "medium",
    },
    benchmarks: [
      { name: "SWE-bench Verified", score: "65%+" },
      { name: "MMLU", score: "85%+" },
      { name: "HumanEval", score: "92%+" },
    ],
    availability: {
      api: true,
      web: true,
      selfHost: false,
    },
    researchKeywords: [
      "Claude Sonnet 4.6 pricing",
      "Claude Sonnet 4.6 vs GPT-4o benchmarks",
    ],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      visionInput: true,
      functionCalling: true,
      structuredOutput: true,
      streaming: true,
      promptCaching: true,
      batchApi: true,
    },
    safetyTier: "high",
    compliance: ["SOC2", "HIPAA", "GDPR", "ISO27001"],
    peers: ["claude-opus-4-7", "gpt-4o", "gemini-3-pro", "mistral-medium-3"],
  },
  {
    id: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    apiId: "claude-haiku-4-5",
    provider: "Anthropic",
    modality: "text",
    tier: "lightweight",
    releaseDate: "2025-10",
    tagline: "極速輕量模型，即時互動的最佳搭檔",
    description:
      "Haiku 4.5 為 Claude 系列中速度最快的版本，延遲極低、成本親民。適合需要即時回應的場景，例如聊天介面、訊息分類、即時工具呼叫。",
    strengths: ["延遲極低，毫秒級回應", "成本最低", "穩定處理高量並發"],
    limitations: ["複雜推理能力有限", "長脈絡時細節掌握略弱"],
    useCases: [
      "即時聊天介面",
      "意圖分類與路由",
      "簡單文本處理",
      "高量批次任務",
    ],
    contextWindow: "200K tokens",
    openWeight: false,
    tags: ["極速", "低成本", "即時"],
    officialUrl: "https://www.anthropic.com/claude",
    pricing: {
      inputPerMillion: "$1",
      outputPerMillion: "$5",
      unit: "USD / 1M tokens",
      tier: "low",
    },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["Claude Haiku 4.5 pricing latency"],
    factCheck: { status: "pending", sources: [] },
  },

  // ── OpenAI ─────────────────────────────────────────────────────────────
  {
    id: "gpt-4o",
    name: "GPT-4o",
    apiId: "gpt-4o",
    provider: "OpenAI",
    modality: "multimodal",
    tier: "frontier",
    releaseDate: "2024-05",
    tagline: "原生多模態，能同時處理文字、圖像與語音",
    description:
      "OpenAI 的旗艦多模態模型，可在單一模型中處理文字、圖像和音訊輸入，並輸出文字或語音。具備即時對話的低延遲特性。",
    strengths: [
      "原生語音 / 影像 / 文字統一架構",
      "即時對話延遲低",
      "推理能力強，工具呼叫穩定",
      "生態系完整",
    ],
    limitations: ["訓練資料截止時間較舊", "高用量成本不低"],
    useCases: [
      "多模態互動式應用",
      "語音助手",
      "圖像理解與分析",
      "通用聊天助手",
    ],
    contextWindow: "128K tokens",
    openWeight: false,
    tags: ["多模態", "語音", "視覺"],
    featured: true,
    officialUrl: "https://openai.com/gpt-4o",
    pricing: {
      inputPerMillion: "$2.50",
      outputPerMillion: "$10",
      unit: "USD / 1M tokens",
      note: "Realtime API 語音模式另計",
      tier: "medium",
    },
    benchmarks: [
      { name: "MMLU", score: "88.7%" },
      { name: "HumanEval", score: "90.2%" },
      { name: "Math (MATH)", score: "76.6%" },
    ],
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: [
      "GPT-4o latest update pricing",
      "OpenAI gpt-4o benchmark",
    ],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      visionInput: true,
      audioInput: true,
      functionCalling: true,
      structuredOutput: true,
      streaming: true,
      fineTuning: true,
      promptCaching: true,
      batchApi: true,
      webSearch: true,
      codeExecution: true,
    },
    safetyTier: "high",
    compliance: ["SOC2", "HIPAA", "GDPR"],
    peers: ["claude-sonnet-4-6", "gemini-3-pro", "gpt-5"],
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o mini",
    apiId: "gpt-4o-mini",
    provider: "OpenAI",
    modality: "text",
    tier: "lightweight",
    releaseDate: "2024-07",
    tagline: "輕量版 GPT-4o，成本極低且支援工具呼叫",
    description:
      "GPT-4o mini 是 GPT-4o 的輕量化版本，犧牲少許品質換取更低延遲與成本。適合大規模批次處理或預算敏感的應用。",
    strengths: ["成本極低", "速度快", "支援工具呼叫"],
    limitations: ["複雜推理能力不及 4o", "創意輸出較弱"],
    useCases: ["大量分類任務", "簡易聊天機器人", "預算敏感的批次處理"],
    contextWindow: "128K tokens",
    openWeight: false,
    tags: ["低成本", "輕量"],
    officialUrl: "https://openai.com/gpt-4o-mini",
    pricing: {
      inputPerMillion: "$0.15",
      outputPerMillion: "$0.60",
      unit: "USD / 1M tokens",
      tier: "low",
    },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["GPT-4o mini pricing"],
    factCheck: { status: "pending", sources: [] },
  },
  {
    id: "o1-reasoning",
    name: "OpenAI o1",
    apiId: "o1",
    provider: "OpenAI",
    modality: "text",
    tier: "frontier",
    releaseDate: "2024-12",
    tagline: "專為複雜推理設計，內建思考鏈",
    description:
      "o1 系列採用內建思考鏈（chain-of-thought）的訓練方式，在數學、程式與科學推理基準上達到頂尖水準。適合需要深度思考的任務。",
    strengths: ["數學與科學推理 SOTA", "程式競賽級水準", "邏輯一致性高"],
    limitations: ["延遲非常高，不適合即時互動", "Token 成本高"],
    useCases: ["數學證明", "科學研究", "演算法設計", "複雜決策"],
    contextWindow: "128K tokens",
    openWeight: false,
    tags: ["推理", "科學", "數學"],
    officialUrl: "https://openai.com/o1",
    pricing: {
      inputPerMillion: "$15",
      outputPerMillion: "$60",
      unit: "USD / 1M tokens",
      note: "Thinking tokens 也計費，整體成本可能高於表定價",
      tier: "premium",
    },
    benchmarks: [
      { name: "AIME 2024", score: "83.3%" },
      { name: "GPQA Diamond", score: "78%" },
      { name: "Codeforces", score: "Elo 1843" },
    ],
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["OpenAI o1 benchmark pricing", "o1 reasoning model"],
    factCheck: { status: "pending", sources: [] },
  },
  {
    id: "dall-e-3",
    name: "DALL·E 3",
    apiId: "dall-e-3",
    provider: "OpenAI",
    modality: "image",
    tier: "balanced",
    releaseDate: "2023-10",
    tagline: "整合於 ChatGPT 的高品質文生圖模型",
    description:
      "DALL·E 3 在文字理解方面顯著優於前代，能更準確地依照 prompt 細節生成圖像。已整合於 ChatGPT 內，可透過對話迭代修改。",
    strengths: ["Prompt 遵循度高", "文字渲染品質穩定", "整合於 ChatGPT 易用"],
    limitations: ["風格多樣性不及 Midjourney", "細節控制較難（無 LoRA 概念）"],
    useCases: ["商業插畫", "概念草圖", "對話式創作"],
    openWeight: false,
    tags: ["文生圖", "對話迭代"],
    officialUrl: "https://openai.com/dall-e-3",
    pricing: {
      unit: "USD / image",
      note: "1024×1024 約 $0.04；HD 1024×1024 約 $0.08",
      tier: "medium",
    },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["DALL-E 3 pricing API"],
    factCheck: { status: "pending", sources: [] },
  },
  {
    id: "sora",
    name: "Sora",
    provider: "OpenAI",
    modality: "video",
    tier: "frontier",
    releaseDate: "2024-12",
    tagline: "高擬真文生影片，最長可達一分鐘",
    description:
      "OpenAI 的旗艦影片模型，可從文字描述生成最長 60 秒的高解析度影片，具備優異的場景連續性與物理直覺。",
    strengths: ["場景連續性業界頂尖", "物理動態合理", "長片段穩定"],
    limitations: ["生成成本與時間高", "細節控制工具尚有限"],
    useCases: ["故事板與分鏡", "概念影片", "短片創作"],
    openWeight: false,
    tags: ["文生影片", "高擬真"],
    featured: true,
    officialUrl: "https://openai.com/sora",
    pricing: {
      unit: "ChatGPT Plus / Pro 訂閱含額度",
      note: "Plus 每月約 50 部短片；Pro 含 500 部 + 慢速 unlimited",
      tier: "high",
    },
    availability: { api: false, web: true, selfHost: false },
    researchKeywords: ["Sora pricing OpenAI", "Sora video model availability"],
    factCheck: { status: "pending", sources: [] },
  },

  // ── Google ─────────────────────────────────────────────────────────────
  {
    id: "gemini-2-pro",
    name: "Gemini 2.0 Pro",
    apiId: "gemini-2.0-pro",
    provider: "Google",
    modality: "multimodal",
    tier: "frontier",
    releaseDate: "2025-02",
    tagline: "Google 旗艦多模態模型，原生支援 2M token 長脈絡",
    description:
      "Gemini 2.0 Pro 以超長脈絡見長，可一次處理整本書或大型程式碼庫。原生整合 Google 工作流（Search、Workspace），多模態能力全面。",
    strengths: [
      "業界最長脈絡視窗",
      "深度整合 Google 生態",
      "多模態理解強",
      "程式與資料分析穩定",
    ],
    limitations: ["創意性輸出風格較保守", "高並發時偶有延遲"],
    useCases: [
      "整本書級別分析",
      "大型 codebase 理解",
      "深度資料挖掘",
      "Google Workspace 整合應用",
    ],
    contextWindow: "2M tokens",
    openWeight: false,
    tags: ["長脈絡", "多模態", "資料分析"],
    featured: true,
    officialUrl: "https://deepmind.google/technologies/gemini/",
    pricing: {
      inputPerMillion: "$1.25",
      outputPerMillion: "$5",
      unit: "USD / 1M tokens",
      note: ">128K 的 prompt 計價較高，請查官方表",
      tier: "medium",
    },
    benchmarks: [
      { name: "MMLU-Pro", score: "75%+" },
      { name: "GPQA", score: "62%+" },
    ],
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: [
      "Gemini 2.0 Pro pricing context window",
      "Gemini 2 release",
    ],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      visionInput: true,
      audioInput: true,
      videoInput: true,
      functionCalling: true,
      structuredOutput: true,
      streaming: true,
      fineTuning: true,
      promptCaching: true,
      batchApi: true,
      webSearch: true,
      codeExecution: true,
    },
    safetyTier: "high",
    compliance: ["SOC2", "HIPAA", "GDPR", "ISO27001"],
    peers: ["gemini-3-pro", "gpt-4o", "claude-sonnet-4-6"],
  },
  {
    id: "gemini-2-flash",
    name: "Gemini 2.0 Flash",
    apiId: "gemini-2.0-flash",
    provider: "Google",
    modality: "multimodal",
    tier: "lightweight",
    releaseDate: "2025-02",
    tagline: "極速版 Gemini，免費額度慷慨",
    description:
      "Gemini 2.0 Flash 為 Google 的高速多模態模型，在保持 1M token 脈絡的同時，延遲與成本顯著降低。免費層級額度大，適合大量探索性使用。",
    strengths: ["速度快", "1M token 脈絡", "免費額度高"],
    limitations: ["複雜推理略遜於 Pro"],
    useCases: ["大量批次處理", "教學示範", "原型開發"],
    contextWindow: "1M tokens",
    openWeight: false,
    tags: ["輕量", "免費友善", "長脈絡"],
    officialUrl: "https://deepmind.google/technologies/gemini/",
    pricing: {
      inputPerMillion: "$0.10",
      outputPerMillion: "$0.40",
      unit: "USD / 1M tokens",
      note: "AI Studio 免費層級每天有大額額度",
      tier: "free",
    },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["Gemini 2 Flash pricing free tier"],
    factCheck: { status: "pending", sources: [] },
  },
  {
    id: "imagen-3",
    name: "Imagen 3",
    provider: "Google",
    modality: "image",
    tier: "balanced",
    releaseDate: "2024-08",
    tagline: "Google 旗艦文生圖，細節豐富與寫實感兼備",
    description:
      "Imagen 3 在質感、光影與細節呈現上表現出色，特別擅長真實風格的攝影感。整合於 Gemini 與 Vertex AI 平台。",
    strengths: ["寫實風格出色", "細節豐富", "整合 GCP 部署便利"],
    limitations: ["風格化作品略遜於 Midjourney"],
    useCases: ["產品攝影風格", "寫實人像", "場景生成"],
    openWeight: false,
    tags: ["文生圖", "寫實"],
    officialUrl: "https://deepmind.google/technologies/imagen-3/",
    pricing: {
      unit: "USD / image",
      note: "Vertex AI 約 $0.04 / image",
      tier: "low",
    },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["Imagen 3 pricing Vertex AI"],
    factCheck: { status: "pending", sources: [] },
  },
  {
    id: "veo-2",
    name: "Veo 2",
    provider: "Google",
    modality: "video",
    tier: "frontier",
    releaseDate: "2024-12",
    tagline: "Google DeepMind 的高品質文生影片",
    description:
      "Veo 2 強調電影感的鏡頭運動與物理一致性，支援 4K 解析度輸出，並可透過自然語言精準控制鏡頭語言。",
    strengths: ["鏡頭語言豐富（推拉搖移）", "4K 解析度輸出", "物理一致性強"],
    limitations: ["生成成本高", "目前可用配額受限"],
    useCases: ["電影分鏡", "高品質宣傳影片"],
    openWeight: false,
    tags: ["文生影片", "4K", "電影感"],
    officialUrl: "https://deepmind.google/technologies/veo/",
    pricing: {
      unit: "USD / second of video",
      note: "Vertex AI 公告價格約 $0.50 / 秒",
      tier: "high",
    },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["Veo 2 pricing Vertex AI"],
    factCheck: { status: "pending", sources: [] },
  },

  // ── Meta ───────────────────────────────────────────────────────────────
  {
    id: "llama-3-3-70b",
    name: "Llama 3.3 70B",
    provider: "Meta",
    modality: "text",
    tier: "open-source",
    releaseDate: "2024-12",
    tagline: "Meta 最強開源模型，可自行部署",
    description:
      "Llama 3.3 70B 是目前社群部署最廣泛的開源模型之一。整體品質接近 GPT-4 級，可透過自架 GPU 或多家雲端推論平台使用。",
    strengths: [
      "開源權重可自行部署",
      "社群生態豐富（量化、LoRA、fine-tune）",
      "推理能力接近頂級閉源模型",
    ],
    limitations: ["部署成本與技術門檻高", "多模態能力有限"],
    useCases: ["需要資料主權的企業部署", "客製化微調", "研究與學術用途"],
    contextWindow: "128K tokens",
    openWeight: true,
    tags: ["開源", "可部署", "可微調"],
    featured: true,
    officialUrl: "https://llama.meta.com/",
    pricing: {
      unit: "Self-host 或第三方 inference",
      note: "Groq / Together / Fireworks 等可低於 $1 / 1M tokens",
      tier: "self-host",
    },
    benchmarks: [
      { name: "MMLU", score: "86%" },
      { name: "HumanEval", score: "88%+" },
    ],
    availability: {
      api: true,
      web: true,
      selfHost: true,
      notes: "權重可在 HuggingFace 下載；商用需遵守 Llama Community License",
    },
    researchKeywords: ["Llama 3.3 70B benchmark community license"],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      functionCalling: true,
      structuredOutput: true,
      streaming: true,
      fineTuning: true,
    },
    safetyTier: "medium",
    peers: ["mistral-large-2", "qwen-2-5-72b", "deepseek-v3"],
  },
  {
    id: "llama-3-2-vision",
    name: "Llama 3.2 Vision",
    provider: "Meta",
    modality: "multimodal",
    tier: "open-source",
    releaseDate: "2024-09",
    tagline: "Meta 首款開源視覺語言模型",
    description:
      "Llama 3.2 引入視覺能力，可理解圖像並用於 OCR、圖像描述、視覺問答。同樣以開源權重發布。",
    strengths: ["開源視覺能力", "可在本地部署", "易於微調"],
    limitations: ["圖像理解仍遜於 GPT-4o", "中文視覺場景略弱"],
    useCases: ["本地化文件 OCR", "視覺 QA 應用", "離線環境部署"],
    contextWindow: "128K tokens",
    openWeight: true,
    tags: ["開源", "視覺", "可部署"],
    officialUrl: "https://llama.meta.com/",
    pricing: { unit: "Self-host or third-party API", tier: "self-host" },
    availability: { api: true, web: false, selfHost: true },
    researchKeywords: ["Llama 3.2 Vision benchmark"],
    factCheck: { status: "pending", sources: [] },
  },

  // ── Mistral ────────────────────────────────────────────────────────────
  {
    id: "mistral-large-2",
    name: "Mistral Large 2",
    provider: "Mistral",
    modality: "text",
    tier: "balanced",
    releaseDate: "2024-07",
    tagline: "歐洲旗艦模型，多語言與程式碼俱優",
    description:
      "Mistral Large 2 在多語言支援與程式碼生成方面表現突出，是歐洲 AI 主權生態的代表。同時也提供 Codestral 等專業變體。",
    strengths: ["多語言能力強", "程式碼生成優秀", "歐洲合規友善"],
    limitations: ["生態系規模較小", "中文細節略弱"],
    useCases: ["歐洲企業合規部署", "多語應用", "程式碼生成"],
    contextWindow: "128K tokens",
    openWeight: false,
    tags: ["多語言", "程式碼", "歐洲"],
    officialUrl: "https://mistral.ai/",
    pricing: {
      inputPerMillion: "$2",
      outputPerMillion: "$6",
      unit: "USD / 1M tokens",
      tier: "medium",
    },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["Mistral Large 2 pricing benchmark"],
    factCheck: { status: "pending", sources: [] },
  },
  {
    id: "mixtral-8x22b",
    name: "Mixtral 8x22B",
    provider: "Mistral",
    modality: "text",
    tier: "open-source",
    releaseDate: "2024-04",
    tagline: "稀疏混合專家架構的開源代表",
    description:
      "Mixtral 採用 MoE（Mixture of Experts）稀疏架構，在推理速度與成本上取得優勢，同時保持開源權重。",
    strengths: ["MoE 高效", "開源權重", "推理速度快"],
    limitations: ["記憶體需求大（部署門檻）"],
    useCases: ["研究 MoE 架構", "自架推論服務"],
    contextWindow: "64K tokens",
    openWeight: true,
    tags: ["MoE", "開源", "高效"],
    officialUrl: "https://mistral.ai/",
    pricing: { unit: "Self-host 或第三方 inference", tier: "self-host" },
    availability: { api: true, web: false, selfHost: true },
    researchKeywords: ["Mixtral 8x22B benchmark"],
    factCheck: { status: "pending", sources: [] },
  },

  // ── DeepSeek ───────────────────────────────────────────────────────────
  {
    id: "deepseek-v3",
    name: "DeepSeek V3",
    provider: "DeepSeek",
    modality: "text",
    tier: "open-source",
    releaseDate: "2024-12",
    tagline: "高 CP 值開源模型，推理與程式碼俱佳",
    description:
      "DeepSeek V3 以極低成本訓練，但綜合表現接近頂級閉源模型，特別在程式碼與數學推理方面強勢。權重完全開源。",
    strengths: ["性價比業界頂尖", "程式碼與數學能力強", "完全開源可商用"],
    limitations: ["中文文化細節仍有改進空間", "生態系仍在發展"],
    useCases: ["低預算企業部署", "程式碼助手", "教學研究"],
    contextWindow: "128K tokens",
    openWeight: true,
    tags: ["開源", "高 CP 值", "程式碼"],
    featured: true,
    officialUrl: "https://www.deepseek.com/",
    pricing: {
      inputPerMillion: "$0.27",
      outputPerMillion: "$1.10",
      unit: "USD / 1M tokens",
      note: "Off-peak 折扣可再低 50%",
      tier: "low",
    },
    benchmarks: [
      { name: "MMLU", score: "88%+" },
      { name: "HumanEval", score: "89%+" },
    ],
    availability: { api: true, web: true, selfHost: true },
    researchKeywords: ["DeepSeek V3 pricing benchmark"],
    factCheck: { status: "pending", sources: [] },
  },
  {
    id: "deepseek-r1",
    name: "DeepSeek R1",
    provider: "DeepSeek",
    modality: "text",
    tier: "open-source",
    releaseDate: "2025-01",
    tagline: "開源推理模型，比肩 o1",
    description:
      "DeepSeek R1 是首款全面開源的推理（reasoning）模型，採用強化學習訓練思考鏈，在數學與邏輯題上接近 OpenAI o1 的水準。",
    strengths: ["開源推理模型先驅", "數學與邏輯題強", "可自行微調思考鏈"],
    limitations: ["延遲偏高（要思考）", "創意性輸出較弱"],
    useCases: ["邏輯推理應用", "數學競賽輔助", "可解釋 AI 研究"],
    contextWindow: "64K tokens",
    openWeight: true,
    tags: ["推理", "開源", "思考鏈"],
    officialUrl: "https://www.deepseek.com/",
    pricing: {
      inputPerMillion: "$0.55",
      outputPerMillion: "$2.19",
      unit: "USD / 1M tokens",
      tier: "low",
    },
    benchmarks: [
      { name: "AIME 2024", score: "79.8%" },
      { name: "MATH-500", score: "97.3%" },
    ],
    availability: { api: true, web: true, selfHost: true },
    researchKeywords: ["DeepSeek R1 reasoning benchmark vs o1"],
    factCheck: { status: "pending", sources: [] },
  },

  // ── xAI ────────────────────────────────────────────────────────────────
  {
    id: "grok-3",
    name: "Grok 3",
    provider: "xAI",
    modality: "multimodal",
    tier: "frontier",
    releaseDate: "2025-02",
    tagline: "xAI 旗艦模型，整合 X 平台即時資訊",
    description:
      "Grok 3 在數學、科學與程式上表現強勢，並原生整合 X（Twitter）的即時資訊源，能引用最新貼文進行推理。",
    strengths: ["原生即時資訊源", "個性化人設明顯", "推理能力競爭力強"],
    limitations: ["公開 API 仍在開放中", "需 X Premium 訂閱"],
    useCases: ["即時新聞分析", "社群輿情研究"],
    contextWindow: "128K tokens",
    openWeight: false,
    tags: ["即時資訊", "推理"],
    officialUrl: "https://x.ai/",
    pricing: {
      inputPerMillion: "$3",
      outputPerMillion: "$15",
      unit: "USD / 1M tokens",
      note: "需 X Premium+ 或 xAI Console 訂閱",
      tier: "high",
    },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["Grok 3 pricing benchmark xAI"],
    factCheck: { status: "pending", sources: [] },
  },

  // ── Alibaba ────────────────────────────────────────────────────────────
  {
    id: "qwen-2-5-72b",
    name: "Qwen 2.5 72B",
    provider: "Alibaba",
    modality: "multimodal",
    tier: "open-source",
    releaseDate: "2024-09",
    tagline: "阿里旗艦開源模型，中文與多語言皆強",
    description:
      "Qwen 2.5 系列為阿里雲 DAMO 開源模型，在中文場景中表現尤為亮眼，涵蓋文字、程式碼、視覺等多種變體。",
    strengths: [
      "中文表現業界領先",
      "完整開源變體（Coder、VL、Math）",
      "可商用授權",
    ],
    limitations: ["英文創意性略遜於頂級閉源", "需自行部署"],
    useCases: ["中文應用首選", "中港台合規部署", "多語企業內部 AI"],
    contextWindow: "128K tokens",
    openWeight: true,
    tags: ["中文", "開源", "多模態"],
    featured: true,
    officialUrl: "https://qwenlm.github.io/",
    pricing: { unit: "Self-host 或阿里雲百煉", tier: "self-host" },
    availability: { api: true, web: true, selfHost: true },
    researchKeywords: ["Qwen 2.5 72B benchmark Chinese"],
    factCheck: { status: "pending", sources: [] },
  },

  // ── Image specialists ──────────────────────────────────────────────────
  {
    id: "midjourney-v6",
    name: "Midjourney v6",
    provider: "Midjourney",
    modality: "image",
    tier: "frontier",
    releaseDate: "2023-12",
    tagline: "藝術感最強的文生圖模型",
    description:
      "Midjourney v6 在風格化、構圖、光影細膩度方面業界領先。v6 顯著改進了文字渲染與 prompt 遵循度。",
    strengths: ["藝術風格業界頂尖", "光影氛圍細膩", "社群分享文化活躍"],
    limitations: ["僅透過 Discord / Web 使用", "無公開 API（需第三方）"],
    useCases: ["概念藝術", "視覺設計", "創意探索"],
    openWeight: false,
    tags: ["藝術", "風格化", "創意"],
    featured: true,
    officialUrl: "https://www.midjourney.com/",
    pricing: {
      unit: "USD / month subscription",
      note: "Basic $10、Standard $30、Pro $60、Mega $120",
      tier: "medium",
    },
    availability: {
      api: false,
      web: true,
      selfHost: false,
      notes: "需 Discord 帳號；Web alpha 對訂閱戶開放",
    },
    researchKeywords: ["Midjourney v6 subscription pricing"],
    factCheck: { status: "pending", sources: [] },
  },
  {
    id: "flux-1-pro",
    name: "FLUX.1 Pro",
    provider: "Black Forest Labs",
    modality: "image",
    tier: "frontier",
    releaseDate: "2024-08",
    tagline: "新一代文生圖王者，prompt 遵循度頂尖",
    description:
      "FLUX.1 來自 Stable Diffusion 原班人馬，在 prompt 遵循度、文字渲染與多元風格的平衡上樹立新標竿。Pro / Dev / Schnell 三個變體。",
    strengths: ["Prompt 遵循度業界頂尖", "文字渲染品質高", "提供 dev 開源版本"],
    limitations: ["商用版本（Pro）需付費 API"],
    useCases: ["商業設計", "需高 prompt 控制的應用"],
    openWeight: false,
    tags: ["文生圖", "高遵循度"],
    officialUrl: "https://blackforestlabs.ai/",
    pricing: {
      unit: "USD / image",
      note: "Pro 約 $0.05 / image；Dev 開源權重可自架",
      tier: "medium",
    },
    availability: { api: true, web: true, selfHost: true },
    researchKeywords: ["FLUX 1 Pro pricing Black Forest Labs"],
    factCheck: { status: "pending", sources: [] },
  },
  {
    id: "stable-diffusion-3-5",
    name: "Stable Diffusion 3.5",
    provider: "Stability AI",
    modality: "image",
    tier: "open-source",
    releaseDate: "2024-10",
    tagline: "開源生態最豐富的文生圖模型",
    description:
      "SD 3.5 延續 Stable Diffusion 開源傳統，配合 ComfyUI、AUTOMATIC1111 等社群工具與大量 LoRA、ControlNet 擴展，是個人創作者的首選。",
    strengths: [
      "完全開源可自行部署",
      "LoRA / ControlNet 生態最豐富",
      "可本地離線運行",
    ],
    limitations: ["原生品質略遜於 Midjourney/Flux", "需技術知識"],
    useCases: ["個人創作（離線）", "LoRA 訓練客製化角色", "ComfyUI 工作流"],
    openWeight: true,
    tags: ["開源", "LoRA 生態", "可本地"],
    officialUrl: "https://stability.ai/",
    pricing: { unit: "Self-host 或第三方 API", tier: "self-host" },
    availability: { api: true, web: true, selfHost: true },
    researchKeywords: ["Stable Diffusion 3.5 license community"],
    factCheck: { status: "pending", sources: [] },
  },

  // ── Video specialists ──────────────────────────────────────────────────
  {
    id: "runway-gen-3",
    name: "Runway Gen-3 Alpha",
    provider: "Runway",
    modality: "video",
    tier: "frontier",
    releaseDate: "2024-06",
    tagline: "創作者首選的影片生成工具",
    description:
      "Gen-3 Alpha 為 Runway 主力影片模型，配合其完整的影片編輯工具鏈（Image-to-Video、Motion Brush、Director Mode），是創作者使用率最高的影片平台之一。",
    strengths: [
      "完整影片編輯工具鏈",
      "Image-to-Video 穩定",
      "Motion Brush 精準控制",
    ],
    limitations: ["每月配額計費", "長片段連續性仍有限"],
    useCases: ["短影音創作", "MV 概念片段", "廣告 motion graphics"],
    openWeight: false,
    tags: ["I2V", "創作工具", "編輯整合"],
    officialUrl: "https://runwayml.com/",
    pricing: {
      unit: "USD / month + credit",
      note: "Standard $15、Pro $35、Unlimited $95；每 5 秒影片約 50 credits",
      tier: "high",
    },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["Runway Gen-3 pricing credit cost"],
    factCheck: { status: "pending", sources: [] },
  },
  {
    id: "luma-dream-machine",
    name: "Luma Dream Machine",
    provider: "Luma",
    modality: "video",
    tier: "balanced",
    releaseDate: "2024-06",
    tagline: "高擬真物理動態的文生影片",
    description:
      "Luma Dream Machine 以擬真物理動態見長，特別擅長人物動作、自然景觀與相機運動的流暢感。",
    strengths: ["物理動態自然", "人物動作流暢", "免費額度可試用"],
    limitations: ["長片段一致性仍待加強"],
    useCases: ["自然景觀片段", "人物動作生成", "Lifestyle 內容"],
    openWeight: false,
    tags: ["擬真", "動態自然"],
    officialUrl: "https://lumalabs.ai/dream-machine",
    pricing: {
      unit: "USD / month subscription",
      note: "Free 試用、Standard $9.99、Pro $29.99 起",
      tier: "low",
    },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["Luma Dream Machine pricing"],
    factCheck: { status: "pending", sources: [] },
  },
  {
    id: "pika-1-5",
    name: "Pika 1.5",
    provider: "Pika",
    modality: "video",
    tier: "balanced",
    releaseDate: "2024-10",
    tagline: "新增特效預設的趣味影片模型",
    description:
      "Pika 主打使用者友善與創意特效預設（爆炸、融化、變身等 Pikaffect）。適合社群媒體創作與趣味短片。",
    strengths: ["創意特效預設豐富", "介面易上手", "適合社群短片"],
    limitations: ["寫實感不及 Sora / Veo", "高解析度片段較少"],
    useCases: ["TikTok / Reels 短片", "趣味視覺效果"],
    openWeight: false,
    tags: ["短片", "特效", "易用"],
    officialUrl: "https://pika.art/",
    pricing: {
      unit: "USD / month subscription",
      note: "Free / Standard $10 / Pro $35",
      tier: "low",
    },
    availability: { api: false, web: true, selfHost: false },
    researchKeywords: ["Pika 1.5 pricing pikaffect"],
    factCheck: { status: "pending", sources: [] },
  },

  // ── Audio ─────────────────────────────────────────────────────────────
  {
    id: "elevenlabs-v3",
    name: "ElevenLabs v3",
    provider: "ElevenLabs",
    modality: "audio",
    tier: "frontier",
    releaseDate: "2024-08",
    tagline: "業界最擬真的語音合成（TTS）",
    description:
      "ElevenLabs 的最新語音模型支援 32 種語言，可進行音色複製、情感表達、口音調整。是 podcast、有聲書、配音的首選。",
    strengths: ["音色擬真度業界頂尖", "32+ 語言支援", "音色複製只需短樣本"],
    limitations: ["音色複製有倫理疑慮（已加 watermark）"],
    useCases: ["有聲書", "Podcast 配音", "多語影片配音", "遊戲 NPC"],
    openWeight: false,
    tags: ["TTS", "音色複製", "多語"],
    featured: true,
    officialUrl: "https://elevenlabs.io/",
    pricing: {
      unit: "USD / month + 字元配額",
      note: "Free 1 萬字元、Starter $5、Creator $22、Pro $99",
      tier: "medium",
    },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["ElevenLabs v3 pricing voice cloning"],
    factCheck: { status: "pending", sources: [] },
  },
  {
    id: "suno-v4",
    name: "Suno v4",
    provider: "Suno",
    modality: "audio",
    tier: "frontier",
    releaseDate: "2024-11",
    tagline: "歌詞 + 歌曲完整生成",
    description:
      "Suno v4 可從文字描述直接生成完整歌曲，包含歌詞、人聲與伴奏。v4 顯著提升音質與人聲擬真度。",
    strengths: ["完整歌曲一鍵生成", "人聲擬真度高", "多曲風支援"],
    limitations: ["商用授權需訂閱方案", "細節編輯有限"],
    useCases: ["音樂創作初稿", "影片配樂", "個人創作"],
    openWeight: false,
    tags: ["音樂", "歌詞", "完整歌曲"],
    officialUrl: "https://suno.com/",
    pricing: {
      unit: "USD / month subscription",
      note: "Free 50 credits / day、Pro $10、Premier $30",
      tier: "low",
    },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["Suno v4 pricing commercial license"],
    factCheck: { status: "pending", sources: [] },
  },
  {
    id: "udio",
    name: "Udio",
    provider: "Udio",
    modality: "audio",
    tier: "balanced",
    releaseDate: "2024-04",
    tagline: "音質細膩的 AI 音樂生成",
    description:
      "Udio 由前 Google DeepMind 成員創辦，主打音質細節與曲式結構控制，可生成最長 15 分鐘的高品質音樂作品。",
    strengths: ["音質細節豐富", "曲式結構控制力強", "支援長片段"],
    limitations: ["介面學習曲線略陡"],
    useCases: ["專業音樂創作", "影片配樂", "氛圍音樂"],
    openWeight: false,
    tags: ["音樂", "高音質", "長片段"],
    officialUrl: "https://www.udio.com/",
    pricing: {
      unit: "USD / month subscription",
      note: "Free / Standard $10 / Pro $30",
      tier: "low",
    },
    availability: { api: false, web: true, selfHost: false },
    researchKeywords: ["Udio music pricing"],
    factCheck: { status: "pending", sources: [] },
  },

  // ── 2025-2026 旗艦補齊 ─────────────────────────────────────────────────
  {
    id: "gpt-5",
    name: "GPT-5",
    apiId: "gpt-5",
    provider: "OpenAI",
    modality: "multimodal",
    tier: "frontier",
    releaseDate: "2025-08",
    tagline: "OpenAI 2025 旗艦，整合推理、視覺與工具的統一模型",
    description:
      "GPT-5 把 o 系列的深度推理與 GPT 系列的速度合而為一，預設依任務複雜度自動切換 fast / thinking 模式，並原生支援影像、聲音與螢幕操作。",
    strengths: [
      "推理與直覺對話無縫切換",
      "視覺與螢幕操作能力大幅躍進",
      "工具呼叫與長代理工作流穩定",
      "幻覺率比 GPT-4o 顯著降低",
    ],
    limitations: ["thinking 模式延遲較高", "頂級配額昂貴"],
    useCases: ["複雜代理任務", "資料分析與決策支援", "視覺問答", "高階寫作"],
    contextWindow: "400K tokens",
    openWeight: false,
    tags: ["旗艦", "推理", "多模態"],
    featured: true,
    officialUrl: "https://openai.com/gpt-5",
    trainingCutoff: "2024-10",
    languages: ["en", "zh", "ja", "es", "fr"],
    latencyClass: "standard",
    pricing: {
      inputPerMillion: "$10",
      outputPerMillion: "$30",
      unit: "USD / 1M tokens",
      note: "Cached input 折扣可達 75%；Realtime API 另計",
      tier: "high",
    },
    benchmarks: [
      { name: "SWE-bench Verified", score: "74%+" },
      { name: "GPQA Diamond", score: "85%+" },
      { name: "MMMU", score: "80%+" },
    ],
    availability: {
      api: true,
      web: true,
      selfHost: false,
      notes: "ChatGPT Plus/Pro 與 OpenAI / Azure OpenAI API 皆有提供",
    },
    researchKeywords: ["GPT-5 pricing", "GPT-5 benchmarks SWE-bench"],
    factCheck: { status: "pending", sources: [] },
  },
  {
    id: "o3",
    name: "OpenAI o3",
    apiId: "o3",
    provider: "OpenAI",
    modality: "text",
    tier: "frontier",
    releaseDate: "2025-04",
    tagline: "高強度推理鏈，數學與程式競賽級任務首選",
    description:
      "o3 沿用 o1 的 chain-of-thought 訓練法但規模放大，在 ARC-AGI、Codeforces、Frontier Math 等高難度測試上創下新高，適合需要長思考鏈的研究與工程任務。",
    strengths: ["數學與證明推理頂尖", "程式競賽級代碼能力", "支援搜尋與工具呼叫"],
    limitations: ["回應延遲長", "輸出 token 成本高", "不適合即時互動"],
    useCases: ["數學研究", "演算法設計", "嚴謹技術文件", "競賽編程"],
    contextWindow: "200K tokens",
    openWeight: false,
    tags: ["推理", "數學", "程式"],
    officialUrl: "https://openai.com/o3",
    trainingCutoff: "2024-06",
    latencyClass: "slow",
    pricing: {
      inputPerMillion: "$20",
      outputPerMillion: "$80",
      unit: "USD / 1M tokens",
      note: "reasoning tokens 也計費；o3-mini 為廉價版本",
      tier: "premium",
    },
    benchmarks: [
      { name: "ARC-AGI", score: "87.5%" },
      { name: "Codeforces Elo", score: "2727" },
      { name: "FrontierMath", score: "25.2%" },
    ],
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["OpenAI o3 ARC-AGI", "o3 reasoning pricing"],
    factCheck: { status: "pending", sources: [] },
  },
  {
    id: "sora-2",
    name: "Sora 2",
    apiId: "sora-2",
    provider: "OpenAI",
    modality: "video",
    tier: "frontier",
    releaseDate: "2025-09",
    tagline: "原生帶聲音的影片生成，物理與時序大幅改善",
    description:
      "Sora 2 在第一代基礎上加入同步語音／環境音、改進物理一致性與長鏡頭穩定度，最長可生成 60 秒 1080p 影片，並支援以參考圖像延伸。",
    strengths: ["影片同時生成原生音軌", "物理動作合理性提升", "支援角色一致性與場景延續"],
    limitations: ["複雜手部動作仍會崩壞", "高解析度耗用配額大"],
    useCases: ["廣告與行銷影片", "概念分鏡", "社群短片", "教育動畫"],
    openWeight: false,
    tags: ["影片", "原生音軌", "1080p"],
    featured: true,
    officialUrl: "https://openai.com/sora",
    trainingCutoff: "2025-06",
    latencyClass: "slow",
    pricing: {
      unit: "USD / second video",
      note: "Plus 內含每月配額；Pro 解鎖 1080p / 20s 模式",
      tier: "high",
    },
    availability: {
      api: true,
      web: true,
      selfHost: false,
      notes: "API 已於 OpenAI Platform 開放，部分地區仍受限",
    },
    researchKeywords: ["Sora 2 audio video", "Sora 2 pricing API"],
    factCheck: { status: "pending", sources: [] },
  },
  {
    id: "gemini-3-pro",
    name: "Gemini 3 Pro",
    apiId: "gemini-3-pro",
    provider: "Google",
    modality: "multimodal",
    tier: "frontier",
    releaseDate: "2025-11",
    tagline: "Google 最新旗艦，原生 2M token 與全模態理解",
    description:
      "Gemini 3 Pro 為 Google DeepMind 2025 末的旗艦模型，原生支援 2M token 長脈絡、圖像／影片／音訊輸入，以及 Deep Think 模式做高強度推理。",
    strengths: [
      "2M token 長脈絡業界最長",
      "全模態原生輸入（圖／影／音）",
      "Deep Think 模式對標 o3",
      "Workspace / Search 整合最深",
    ],
    limitations: ["Deep Think 延遲高", "部分區域 API 限定"],
    useCases: ["長影片摘要", "整本書理解", "多模態研究", "代理工作流"],
    contextWindow: "2M tokens",
    openWeight: false,
    tags: ["長脈絡", "多模態", "Deep Think"],
    featured: true,
    officialUrl: "https://deepmind.google/models/gemini/",
    trainingCutoff: "2025-04",
    languages: ["en", "zh", "ja", "ko", "es", "fr", "de"],
    latencyClass: "standard",
    pricing: {
      inputPerMillion: "$2.5",
      outputPerMillion: "$15",
      unit: "USD / 1M tokens",
      note: "超過 200K 上下文每百萬 input 加價；Deep Think 額外計費",
      tier: "medium",
    },
    benchmarks: [
      { name: "MMLU-Pro", score: "85%+" },
      { name: "MMMU", score: "82%+" },
      { name: "LiveCodeBench", score: "70%+" },
    ],
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["Gemini 3 Pro Deep Think", "Gemini 3 pricing"],
    factCheck: { status: "pending", sources: [] },
  },
  {
    id: "veo-3",
    name: "Veo 3",
    apiId: "veo-3",
    provider: "Google",
    modality: "video",
    tier: "frontier",
    releaseDate: "2025-05",
    tagline: "Google 帶原生音訊的長秒數影片生成",
    description:
      "Veo 3 升級到原生音訊輸出（含對白、環境音、配樂），單片最長 60 秒、解析度可達 1080p，並可從文字、圖像或開頭幀生成。",
    strengths: ["原生影片 + 音訊一次生成", "鏡頭運動指令解析準確", "與 Imagen 風格鎖定整合"],
    limitations: ["人物口型仍偶爾不同步", "需 Google Cloud / Vertex AI 帳號"],
    useCases: ["廣告 / 行銷影片", "電商素材", "故事板", "教育影音"],
    openWeight: false,
    tags: ["影片", "音訊", "Vertex AI"],
    officialUrl: "https://deepmind.google/technologies/veo/",
    trainingCutoff: "2025-02",
    latencyClass: "slow",
    pricing: {
      unit: "USD / second video",
      note: "Vertex AI 計費；高解析另加價",
      tier: "high",
    },
    availability: {
      api: true,
      web: true,
      selfHost: false,
      notes: "Gemini App / Vertex AI / Flow（影片工作站）可用",
    },
    researchKeywords: ["Veo 3 pricing audio video"],
    factCheck: { status: "pending", sources: [] },
  },
  {
    id: "imagen-4",
    name: "Imagen 4",
    apiId: "imagen-4",
    provider: "Google",
    modality: "image",
    tier: "balanced",
    releaseDate: "2025-05",
    tagline: "Google 高保真圖像生成，含文字渲染強化版",
    description:
      "Imagen 4 提升細節、光線與材質寫實度，並推出 Ultra 版本擅長處理小型文字、排版與品牌素材，已整合進 Gemini App 與 Vertex AI。",
    strengths: ["寫實光影細節", "文字渲染準確（Ultra 版）", "風格指令服從度高"],
    limitations: ["人臉一致性仍弱於 Midjourney v7", "Ultra 版較貴"],
    useCases: ["品牌素材", "廣告插畫", "海報排版", "概念圖"],
    openWeight: false,
    tags: ["圖像", "排版", "Vertex AI"],
    officialUrl: "https://deepmind.google/technologies/imagen/",
    trainingCutoff: "2025-02",
    latencyClass: "fast",
    pricing: {
      unit: "USD / image",
      note: "Standard / Ultra / Fast 三檔；Vertex AI 計費",
      tier: "low",
    },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["Imagen 4 Ultra pricing"],
    factCheck: { status: "pending", sources: [] },
  },
  {
    id: "llama-4-maverick",
    name: "Llama 4 Maverick",
    apiId: "llama-4-maverick",
    provider: "Meta",
    modality: "multimodal",
    tier: "frontier",
    releaseDate: "2025-04",
    tagline: "Meta 首款原生多模態 MoE 開源模型",
    description:
      "Llama 4 Maverick 為 17B 啟用 / 400B 總參數的 Mixture-of-Experts，原生多模態輸入，原生 1M token 上下文，是目前能自架的最強多模態模型之一。",
    strengths: [
      "原生多模態 + 1M token 脈絡",
      "MoE 架構推論成本相對親民",
      "Llama 商用授權（有條件）開源",
    ],
    limitations: ["記憶體需求大（建議 H100 多卡）", "中文表現略遜中國原生模型"],
    useCases: ["企業自架旗艦", "長脈絡 RAG", "多模態研究", "fine-tune 起點"],
    contextWindow: "1M tokens",
    openWeight: true,
    tags: ["開源", "MoE", "多模態"],
    featured: true,
    officialUrl: "https://ai.meta.com/llama/",
    trainingCutoff: "2024-08",
    languages: ["en", "es", "fr", "de", "hi", "th"],
    latencyClass: "standard",
    pricing: {
      unit: "self-host 或第三方 API",
      note: "Meta 商用授權 7 億 MAU 以上需另談；Groq / Together / Fireworks 提供 API",
      tier: "self-host",
    },
    benchmarks: [
      { name: "MMLU-Pro", score: "80%+" },
      { name: "LMSYS Arena", score: "Top 10" },
    ],
    availability: {
      api: true,
      web: false,
      selfHost: true,
      notes: "Hugging Face / Meta 官網下載；多家 API 託管",
    },
    researchKeywords: ["Llama 4 Maverick benchmarks", "Llama 4 MoE pricing"],
    factCheck: { status: "pending", sources: [] },
  },
  {
    id: "grok-4",
    name: "Grok 4",
    apiId: "grok-4",
    provider: "xAI",
    modality: "multimodal",
    tier: "frontier",
    releaseDate: "2025-07",
    tagline: "xAI 旗艦，搭配 X 即時資訊與工具代理",
    description:
      "Grok 4 在 xAI 自建 Colossus 叢集上訓練，主打與 X 平台即時資訊整合、Heavy 模式可同時跑多代理協作來解難題。",
    strengths: ["X 即時情報整合", "Heavy 模式多代理協作", "風格較不審慎，創意空間大"],
    limitations: ["訓練資料偏 X 言論立場", "Heavy 模式僅 Pro 訂閱可用"],
    useCases: ["即時新聞分析", "社群輿論", "創意寫作", "代理研究"],
    contextWindow: "256K tokens",
    openWeight: false,
    tags: ["即時資訊", "代理", "X 整合"],
    officialUrl: "https://x.ai/grok",
    trainingCutoff: "2025-04",
    latencyClass: "standard",
    pricing: {
      inputPerMillion: "$3",
      outputPerMillion: "$15",
      unit: "USD / 1M tokens",
      note: "X Premium+ 訂戶免費使用 web 版；Heavy 模式 SuperGrok 才可用",
      tier: "medium",
    },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["Grok 4 Heavy pricing", "Grok 4 benchmarks"],
    factCheck: { status: "pending", sources: [] },
  },
  {
    id: "qwen3-max",
    name: "Qwen3 Max",
    apiId: "qwen3-max",
    provider: "Alibaba",
    modality: "multimodal",
    tier: "frontier",
    releaseDate: "2025-09",
    tagline: "阿里巴巴最新旗艦，中文場景表現業界最強",
    description:
      "Qwen3 Max 為阿里 2025 末旗艦，原生支援 thinking / instruct 雙模式、1M token 上下文，中文寫作與工具呼叫表現領先業界中文模型。",
    strengths: ["中文表達細膩自然", "工具呼叫 + Function Calling 穩定", "thinking 模式可關閉節省成本"],
    limitations: ["英文略遜西方旗艦", "歐美區域延遲較高"],
    useCases: ["中文客服", "中文長文寫作", "電商導購", "中文代理"],
    contextWindow: "1M tokens",
    openWeight: false,
    tags: ["中文旗艦", "thinking", "工具呼叫"],
    officialUrl: "https://qwen.aliyun.com/",
    trainingCutoff: "2025-06",
    languages: ["zh", "en", "ja", "ko", "ar"],
    latencyClass: "standard",
    region: "中國大陸節點為主，海外可走 DashScope",
    pricing: {
      inputPerMillion: "¥6 / $0.85",
      outputPerMillion: "¥24 / $3.4",
      unit: "RMB or USD / 1M tokens",
      note: "thinking 模式 output 另計；長脈絡分段加價",
      tier: "low",
    },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["Qwen3 Max pricing benchmarks"],
    factCheck: { status: "pending", sources: [] },
  },
  {
    id: "mistral-medium-3",
    name: "Mistral Medium 3",
    apiId: "mistral-medium-3",
    provider: "Mistral",
    modality: "text",
    tier: "balanced",
    releaseDate: "2025-05",
    tagline: "Mistral 重新打造的旗艦中階，性價比直挑 GPT-4o",
    description:
      "Mistral Medium 3 是 Mistral AI 2025 端對端重訓的中階模型，效能逼近 Mistral Large 2、定價砍半，並支援自架部署。",
    strengths: ["性價比突出", "可自架推論（含 on-prem）", "工具呼叫與結構化輸出穩定"],
    limitations: ["脈絡視窗 128K 略小於旗艦", "多模態能力有限"],
    useCases: ["企業內部部署", "高量 SaaS API", "RAG 後端", "客服自動化"],
    contextWindow: "128K tokens",
    openWeight: false,
    tags: ["中階", "可自架", "高 CP 值"],
    officialUrl: "https://mistral.ai/news/mistral-medium-3/",
    trainingCutoff: "2024-12",
    latencyClass: "fast",
    pricing: {
      inputPerMillion: "$0.4",
      outputPerMillion: "$2",
      unit: "USD / 1M tokens",
      note: "On-prem 部署另談；Le Chat 也直接可用",
      tier: "low",
    },
    availability: { api: true, web: true, selfHost: true },
    researchKeywords: ["Mistral Medium 3 pricing on-prem"],
    factCheck: { status: "pending", sources: [] },
  },
  {
    id: "midjourney-v7",
    name: "Midjourney v7",
    apiId: "midjourney-v7",
    provider: "Midjourney",
    modality: "image",
    tier: "frontier",
    releaseDate: "2025-06",
    tagline: "個人風格訓練 + Omni-Reference，藝術感再升級",
    description:
      "Midjourney v7 加入 Omni-Reference（多參考圖融合）與個人風格 profile，畫面細節、皮膚質感、光線美感都比 v6 顯著提升，並推出 Draft Mode 加速試樣。",
    strengths: ["美學細膩、構圖卓越", "Omni-Reference 角色一致性", "Draft Mode 試樣速度極快"],
    limitations: ["仍以 Discord / Web 操作為主", "無正式 API（僅第三方逆向）"],
    useCases: ["藝術插畫", "概念設計", "時尚與廣告", "角色一致性故事板"],
    openWeight: false,
    tags: ["藝術", "風格訓練", "Omni-Reference"],
    featured: true,
    officialUrl: "https://www.midjourney.com/",
    latencyClass: "fast",
    pricing: {
      unit: "USD / month subscription",
      note: "Basic $10 / Standard $30 / Pro $60 / Mega $120",
      tier: "medium",
    },
    availability: { api: false, web: true, selfHost: false },
    researchKeywords: ["Midjourney v7 Omni-Reference pricing"],
    factCheck: { status: "pending", sources: [] },
  },
  {
    id: "kling-2",
    name: "Kling 2.0",
    apiId: "kling-2",
    provider: "Kling AI",
    modality: "video",
    tier: "frontier",
    releaseDate: "2025-04",
    tagline: "快手 Kling，物理動作擬真度業界領先的影片模型",
    description:
      "Kling 2.0 由快手（Kuaishou）推出，最長 2 分鐘、解析度 1080p，物理動作擬真度與運鏡語意理解被多家社群評為超越 Sora、Runway。",
    strengths: ["物理動作與肢體擬真", "運鏡與分鏡指令理解佳", "影片長度業界較長"],
    limitations: ["介面與付款偏中國大陸體驗", "海外 API 文件較少"],
    useCases: ["廣告影片", "MV / 短片", "電商商品演示", "教育動畫"],
    openWeight: false,
    tags: ["影片", "物理擬真", "1080p"],
    officialUrl: "https://klingai.com/",
    trainingCutoff: "2025-02",
    latencyClass: "slow",
    region: "中國大陸為主，海外透過 Kling AI Global",
    pricing: {
      unit: "USD / video credits",
      note: "Standard / Pro / Master 三檔；包月可省",
      tier: "medium",
    },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["Kling 2.0 pricing benchmark"],
    factCheck: { status: "pending", sources: [] },
  },

  // ── 亞洲與開源新勢力 ───────────────────────────────────────────────────
  {
    id: "kimi-k2",
    name: "Kimi K2",
    apiId: "kimi-k2",
    provider: "Moonshot",
    modality: "text",
    tier: "open-source",
    releaseDate: "2025-07",
    tagline: "Moonshot 1T 參數 MoE，開源旗艦級代理模型",
    description:
      "Kimi K2 為 Moonshot AI 開源的 1 兆參數 MoE 模型（32B 啟用），主打代理工具呼叫與長脈絡，在公開排行榜上對標 Claude Sonnet。",
    strengths: ["代理工具呼叫表現突出", "權重完全開源（修改版 MIT）", "長脈絡穩定"],
    limitations: ["自架需要大量 GPU 記憶體", "中文以外語言略弱"],
    useCases: ["開源代理工作流", "企業自架 RAG", "中文寫作", "fine-tune 起點"],
    contextWindow: "128K tokens",
    openWeight: true,
    tags: ["開源", "代理", "MoE"],
    officialUrl: "https://github.com/MoonshotAI/Kimi-K2",
    trainingCutoff: "2024-12",
    languages: ["zh", "en"],
    latencyClass: "standard",
    pricing: {
      unit: "self-host 或第三方 API",
      note: "Moonshot 官方 API 與 Together / Groq / Fireworks 皆有提供",
      tier: "self-host",
    },
    availability: { api: true, web: true, selfHost: true },
    researchKeywords: ["Kimi K2 open source benchmark"],
    factCheck: { status: "pending", sources: [] },
  },
  {
    id: "glm-4-6",
    name: "GLM-4.6",
    apiId: "glm-4-6",
    provider: "Zhipu",
    modality: "text",
    tier: "open-source",
    releaseDate: "2025-09",
    tagline: "智譜 GLM-4.6，性價比突出的開源中文旗艦",
    description:
      "智譜 AI 推出的 GLM-4.6 為 355B / 32B 啟用的 MoE，原生 200K 脈絡並對標 GPT-4 級別性能，價格極具競爭力，且權重在 Hugging Face 開源。",
    strengths: ["中文場景表現極佳", "推論成本極低", "Hugging Face 全開源"],
    limitations: ["英文略弱", "工具生態以中國為主"],
    useCases: ["中文 RAG", "教育與政府應用", "電商客服", "fine-tune 起點"],
    contextWindow: "200K tokens",
    openWeight: true,
    tags: ["開源", "中文", "MoE"],
    officialUrl: "https://github.com/THUDM/GLM-4",
    trainingCutoff: "2025-04",
    languages: ["zh", "en"],
    latencyClass: "fast",
    pricing: {
      inputPerMillion: "¥1 / $0.14",
      outputPerMillion: "¥4 / $0.55",
      unit: "RMB or USD / 1M tokens",
      tier: "low",
    },
    availability: { api: true, web: true, selfHost: true },
    researchKeywords: ["GLM-4.6 open source pricing"],
    factCheck: { status: "pending", sources: [] },
  },
  {
    id: "phi-4",
    name: "Phi-4",
    apiId: "phi-4",
    provider: "Microsoft",
    modality: "text",
    tier: "open-source",
    releaseDate: "2024-12",
    tagline: "Microsoft 14B 小模型，數學推理打趴大它好幾倍的對手",
    description:
      "Phi-4 為 Microsoft Research 訓練的 14B 模型，主打「教學品質資料」帶來的高效率推理，在 MATH、GSM8K 等數理題上超越許多 70B 級別模型。",
    strengths: ["數學與邏輯推理 outsized", "14B 可在單張 RTX 4090 跑", "MIT 授權"],
    limitations: ["脈絡視窗僅 16K", "創意寫作弱於通用大模型"],
    useCases: ["邊緣設備推論", "數學工具", "教育應用", "小型 fine-tune"],
    contextWindow: "16K tokens",
    openWeight: true,
    tags: ["小模型", "數學", "MIT 授權"],
    officialUrl: "https://huggingface.co/microsoft/phi-4",
    trainingCutoff: "2024-06",
    latencyClass: "realtime",
    pricing: {
      unit: "self-host",
      note: "Hugging Face 下載；Azure AI Studio 也可一鍵部署",
      tier: "self-host",
    },
    availability: { api: true, web: false, selfHost: true },
    researchKeywords: ["Phi-4 MATH benchmark"],
    factCheck: { status: "pending", sources: [] },
  },
  {
    id: "hunyuan-video",
    name: "HunyuanVideo",
    apiId: "hunyuan-video",
    provider: "Tencent",
    modality: "video",
    tier: "open-source",
    releaseDate: "2024-12",
    tagline: "騰訊 13B 開源影片模型，可自架的高品質生成",
    description:
      "HunyuanVideo 是騰訊釋出的 13B 參數開源影片生成模型，畫質與時序一致性接近商用閉源模型，並於 2025 加入 I2V（image-to-video）與聲音生成模組。",
    strengths: ["畫質接近 Runway / Kling", "權重 Apache 2.0 商用可用", "可自架（A100 / H100 多卡）"],
    limitations: ["生成時間長", "中文 prompt 表現更好"],
    useCases: ["可控自架影片管線", "電商商品演示", "研究與 fine-tune", "本地化內容工廠"],
    openWeight: true,
    tags: ["開源", "影片", "Apache 2.0"],
    officialUrl: "https://github.com/Tencent/HunyuanVideo",
    trainingCutoff: "2024-09",
    languages: ["zh", "en"],
    latencyClass: "slow",
    pricing: {
      unit: "self-host or Tencent Cloud",
      tier: "self-host",
    },
    availability: { api: true, web: true, selfHost: true },
    researchKeywords: ["HunyuanVideo open source benchmark"],
    factCheck: { status: "pending", sources: [] },
  },

  // ── Embedding / 程式專用 ──────────────────────────────────────────────
  {
    id: "openai-embedding-3-large",
    name: "text-embedding-3-large",
    apiId: "text-embedding-3-large",
    provider: "OpenAI",
    modality: "embedding",
    tier: "balanced",
    releaseDate: "2024-01",
    tagline: "OpenAI 3 代嵌入向量，可調維度的 RAG 主力",
    description:
      "text-embedding-3-large 為 OpenAI 第三代嵌入模型，預設 3072 維、可降維至 256 / 1024 兼顧精度與向量資料庫成本，MIRACL 多語檢索基準上業界頂尖。",
    strengths: ["多語檢索準確度高", "可降維節省儲存成本", "與 OpenAI 工具生態整合佳"],
    limitations: ["閉源、需走 API", "極長文件仍須分段"],
    useCases: ["RAG 檢索層", "語意搜尋", "聚類與去重", "推薦系統"],
    contextWindow: "8K tokens / 輸入",
    openWeight: false,
    tags: ["嵌入向量", "RAG", "多語"],
    officialUrl: "https://platform.openai.com/docs/guides/embeddings",
    latencyClass: "realtime",
    pricing: {
      inputPerMillion: "$0.13",
      unit: "USD / 1M tokens",
      tier: "low",
    },
    benchmarks: [
      { name: "MIRACL（多語）", score: "54.9" },
      { name: "MTEB", score: "64.6" },
    ],
    availability: { api: true, web: false, selfHost: false },
    researchKeywords: ["text-embedding-3-large MIRACL MTEB"],
    factCheck: { status: "pending", sources: [] },
  },
  {
    id: "codestral-25-01",
    name: "Codestral 25.01",
    apiId: "codestral-2501",
    provider: "Mistral",
    modality: "text",
    tier: "lightweight",
    releaseDate: "2025-01",
    tagline: "Mistral 程式碼專用模型，IDE 內補全與 FIM 兼顧",
    description:
      "Codestral 25.01 為 Mistral AI 程式碼專用模型，原生支援 80+ 程式語言、Fill-In-The-Middle，並有 256K 脈絡讓整個 repo 級任務可行。",
    strengths: ["FIM / 中段補全表現頂尖", "80+ 程式語言覆蓋", "256K 脈絡能放整個專案"],
    limitations: ["僅供商用授權；自架需另談", "通用聊天表現有限"],
    useCases: ["IDE 內 AI 補全", "整 repo 重構", "code review 助手", "教學與練習"],
    contextWindow: "256K tokens",
    openWeight: false,
    tags: ["程式專用", "FIM", "256K"],
    officialUrl: "https://mistral.ai/news/codestral-25-01/",
    trainingCutoff: "2024-10",
    latencyClass: "fast",
    pricing: {
      inputPerMillion: "$0.3",
      outputPerMillion: "$0.9",
      unit: "USD / 1M tokens",
      tier: "low",
    },
    benchmarks: [
      { name: "HumanEval", score: "86.6%" },
      { name: "RepoBench", score: "Top tier" },
    ],
    availability: { api: true, web: true, selfHost: true },
    researchKeywords: ["Codestral 25.01 HumanEval RepoBench"],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      functionCalling: true,
      structuredOutput: true,
      streaming: true,
      fineTuning: true,
      promptCaching: false,
      visionInput: false,
    },
    safetyTier: "medium",
    peers: ["deepseek-v3", "qwen-2-5-72b"],
  },

  // ── 第三波擴充：補齊嵌入向量、企業旗艦、亞洲影片新勢力 ──────────────
  {
    id: "cohere-command-a",
    name: "Command A",
    apiId: "command-a-03-2025",
    provider: "Cohere",
    modality: "text",
    tier: "balanced",
    releaseDate: "2025-03",
    tagline: "Cohere 旗艦級企業模型，主打可自架的 RAG 與多語",
    description:
      "Command A 為 Cohere 2025 推出的旗艦，111B 參數、256K 上下文，主打企業可在 2 張 A100 / H100 上自架，內建 RAG 引用標註與工具呼叫。",
    strengths: [
      "原生 23 種語言支援",
      "內建 RAG 引用標註（grounded generation）",
      "2 張 GPU 即可自架，企業內網友善",
      "工具呼叫與結構化輸出穩定",
    ],
    limitations: ["創意寫作弱於 Claude / GPT", "中文略遜 Qwen / GLM"],
    useCases: ["企業 RAG", "多語客服", "On-prem 部署", "金融 / 法律檢索"],
    contextWindow: "256K tokens",
    openWeight: true,
    tags: ["企業", "可自架", "多語 RAG"],
    officialUrl: "https://cohere.com/command",
    trainingCutoff: "2024-12",
    languages: ["en", "fr", "es", "de", "ja", "ko", "zh", "ar", "pt"],
    latencyClass: "fast",
    pricing: {
      inputPerMillion: "$2.5",
      outputPerMillion: "$10",
      unit: "USD / 1M tokens",
      note: "Hugging Face 權重採非商用授權；商用需與 Cohere 簽約",
      tier: "medium",
    },
    availability: {
      api: true,
      web: true,
      selfHost: true,
      notes: "AWS Bedrock / Azure / Sagemaker / Oracle 都有託管",
    },
    researchKeywords: ["Cohere Command A pricing RAG benchmark"],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      functionCalling: true,
      structuredOutput: true,
      streaming: true,
      fineTuning: true,
      webSearch: true,
      promptCaching: false,
      batchApi: false,
    },
    safetyTier: "high",
    compliance: ["SOC2", "GDPR", "ISO27001"],
    peers: ["claude-sonnet-4-6", "mistral-large-2", "llama-3-3-70b"],
  },
  {
    id: "voyage-3-large",
    name: "Voyage 3 Large",
    apiId: "voyage-3-large",
    provider: "Voyage AI",
    modality: "embedding",
    tier: "balanced",
    releaseDate: "2025-01",
    tagline: "Voyage（Anthropic 旗下）嵌入旗艦，檢索精度業界領先",
    description:
      "Voyage 3 Large 為 Voyage AI（已被 Anthropic 收購）的旗艦嵌入模型，預設 1024 維、可調至 2048 / 512 / 256；MTEB / MIRACL / 程式碼搜尋等基準上多項業界第一。",
    strengths: [
      "MTEB / 程式碼搜尋分數頂尖",
      "可調維度兼顧成本與精度",
      "領域版本（finance / legal / code）可選",
    ],
    limitations: ["僅供 API，無開源權重", "需要 Voyage / Anthropic 帳號"],
    useCases: ["高精度 RAG", "程式碼搜尋", "金融 / 法律文件檢索", "Claude RAG 配套"],
    contextWindow: "32K tokens / 輸入",
    openWeight: false,
    tags: ["嵌入向量", "RAG", "可調維度"],
    officialUrl: "https://www.voyageai.com/",
    languages: ["en", "zh", "ja", "ko", "es", "fr", "de"],
    latencyClass: "realtime",
    pricing: {
      inputPerMillion: "$0.18",
      unit: "USD / 1M tokens",
      note: "voyage-3-lite 與領域版本另計價",
      tier: "low",
    },
    benchmarks: [
      { name: "MTEB（平均）", score: "66.3" },
      { name: "程式碼檢索", score: "業界第一" },
    ],
    availability: { api: true, web: false, selfHost: false },
    researchKeywords: ["Voyage 3 Large MTEB MIRACL"],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      streaming: false,
      fineTuning: false,
      structuredOutput: false,
    },
    safetyTier: "high",
    compliance: ["SOC2"],
    peers: ["openai-embedding-3-large"],
  },
  {
    id: "hailuo-02",
    name: "MiniMax Hailuo 02",
    apiId: "hailuo-02",
    provider: "MiniMax",
    modality: "video",
    tier: "balanced",
    releaseDate: "2025-06",
    tagline: "MiniMax 海螺，物理動作社群評分業界前段",
    description:
      "Hailuo 02 是 MiniMax 的影片旗艦，原生 1080p / 6-10s，主打物理擬真與 prompt 服從度，在 LMArena 影片排行榜上多次擠進前三。",
    strengths: ["物理動作擬真度高", "prompt 服從度好", "首末幀控制完整"],
    limitations: ["僅支援短秒數（10s 上限）", "API 文件英文版較少"],
    useCases: ["廣告短片", "電商商品演示", "社群短片", "概念分鏡"],
    openWeight: false,
    tags: ["影片", "首末幀", "1080p"],
    officialUrl: "https://hailuoai.video/",
    trainingCutoff: "2025-04",
    latencyClass: "slow",
    region: "中國大陸 + 海外節點，需註冊 MiniMax",
    pricing: {
      unit: "USD / video credits",
      note: "Standard / Pro 兩檔；包月可省",
      tier: "medium",
    },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["Hailuo 02 MiniMax video benchmark"],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      streaming: false,
      fineTuning: false,
    },
    safetyTier: "medium",
    peers: ["kling-2", "sora-2", "runway-gen-3", "veo-3"],
  },
  {
    id: "minimax-m1",
    name: "MiniMax M1",
    apiId: "minimax-m1",
    provider: "MiniMax",
    modality: "text",
    tier: "open-source",
    releaseDate: "2025-06",
    tagline: "MiniMax 開源 MoE 文字旗艦，1M 上下文且 thinking 模式",
    description:
      "M1 為 MiniMax 開源的 456B / 45.9B 啟用 MoE 文字模型，原生 1M 上下文，採用 Lightning Attention 架構，推論成本比同級 dense 模型低約 75%。",
    strengths: ["1M 上下文 + 低成本", "thinking 模式可關閉", "Apache 2.0 商用可用"],
    limitations: ["需要 H100 多卡才能跑 thinking 模式", "中文外語言略弱"],
    useCases: ["長脈絡 RAG", "代理工作流", "fine-tune 起點", "可控自架旗艦"],
    contextWindow: "1M tokens",
    openWeight: true,
    tags: ["開源", "1M 脈絡", "MoE", "thinking"],
    officialUrl: "https://github.com/MiniMax-AI/MiniMax-M1",
    trainingCutoff: "2025-02",
    languages: ["zh", "en"],
    latencyClass: "standard",
    pricing: {
      unit: "self-host 或第三方 API",
      note: "MiniMax 官方 API 與 Together / Fireworks 提供",
      tier: "self-host",
    },
    availability: { api: true, web: true, selfHost: true },
    researchKeywords: ["MiniMax M1 open source thinking benchmark"],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      functionCalling: true,
      structuredOutput: true,
      streaming: true,
      fineTuning: true,
      promptCaching: false,
    },
    safetyTier: "medium",
    peers: ["kimi-k2", "deepseek-v3", "llama-4-maverick", "glm-4-6"],
  },
  {
    id: "pika-2-2",
    name: "Pika 2.2",
    apiId: "pika-2-2",
    provider: "Pika",
    modality: "video",
    tier: "balanced",
    releaseDate: "2025-02",
    tagline: "Pika 影片 2.2，主打 Pikaframes 過場與創意效果",
    description:
      "Pika 2.2 升級到 1080p / 10s，新增 Pikaframes（雙幀內插）與 Pikadditions（把物體合成進既有影片），主打容易上手與創意效果。",
    strengths: [
      "Pikaframes 雙幀內插效果佳",
      "Pikadditions 物體合成自然",
      "UI 對新手友善",
    ],
    limitations: ["寫實鏡頭略遜 Kling / Sora", "進階控制有限"],
    useCases: ["社群短影音", "創意特效", "教育動畫", "電商素材"],
    openWeight: false,
    tags: ["影片", "Pikaframes", "1080p"],
    officialUrl: "https://pika.art/",
    trainingCutoff: "2024-12",
    latencyClass: "slow",
    pricing: {
      unit: "USD / month subscription",
      note: "Free / Standard $10 / Pro $35 / Fancy $95",
      tier: "low",
    },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["Pika 2.2 Pikaframes pricing"],
    factCheck: { status: "pending", sources: [] },
    capabilities: { streaming: false, fineTuning: false },
    safetyTier: "medium",
    peers: ["runway-gen-3", "luma-dream-machine", "hailuo-02"],
  },
  {
    id: "ideogram-3",
    name: "Ideogram 3.0",
    apiId: "ideogram-3-0",
    provider: "Ideogram",
    modality: "image",
    tier: "balanced",
    releaseDate: "2025-03",
    tagline: "排版與文字渲染最強的圖像模型，海報設計首選",
    description:
      "Ideogram 3.0 在圖內文字、字型還原、排版規畫上業界領先，新增 Magic Fill / Magic Expand 編輯流程，並支援風格參考圖。",
    strengths: ["圖內文字準確度業界第一", "排版設計感強", "風格參考圖控制細膩"],
    limitations: ["寫實人物略遜 Midjourney", "影片 / 3D 不支援"],
    useCases: ["海報 / 名片設計", "Logo 草稿", "社群圖文", "Banner 與廣告"],
    openWeight: false,
    tags: ["圖像", "文字渲染", "排版"],
    officialUrl: "https://ideogram.ai/",
    trainingCutoff: "2025-01",
    latencyClass: "fast",
    pricing: {
      unit: "USD / month subscription",
      note: "Free / Basic $7 / Plus $16 / Pro $48",
      tier: "low",
    },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["Ideogram 3.0 typography benchmark"],
    factCheck: { status: "pending", sources: [] },
    capabilities: { streaming: false, fineTuning: false },
    safetyTier: "high",
    peers: ["midjourney-v7", "imagen-4", "flux-1-pro", "recraft-v3"],
  },
  {
    id: "recraft-v3",
    name: "Recraft V3",
    apiId: "recraft-v3",
    provider: "Recraft",
    modality: "image",
    tier: "balanced",
    releaseDate: "2024-10",
    tagline: "唯一同時輸出向量 + 點陣的圖像模型",
    description:
      "Recraft V3（紅熊貓代號 red_panda）2024 末登上 LMSYS 圖像排行第一，主打可同時輸出 SVG 向量與 PNG 點陣，並有完整的品牌一致性風格控制。",
    strengths: ["SVG 向量輸出（業界唯一）", "品牌風格鎖定強", "圖內文字準確"],
    limitations: ["寫實人物表現中等", "極複雜場景偶會崩"],
    useCases: ["Logo / 圖標", "品牌素材", "印刷物排版", "UI 插畫"],
    openWeight: false,
    tags: ["向量輸出", "品牌設計", "Logo"],
    officialUrl: "https://www.recraft.ai/",
    trainingCutoff: "2024-08",
    latencyClass: "fast",
    pricing: {
      unit: "USD / month subscription",
      note: "Free / Basic $12 / Advanced $33 / Pro $60",
      tier: "low",
    },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["Recraft V3 SVG vector pricing"],
    factCheck: { status: "pending", sources: [] },
    capabilities: { streaming: false, fineTuning: false },
    safetyTier: "high",
    peers: ["ideogram-3", "midjourney-v7", "imagen-4"],
  },
  {
    id: "deepseek-v3-1",
    name: "DeepSeek V3.1",
    apiId: "deepseek-v3-1",
    provider: "DeepSeek",
    modality: "text",
    tier: "open-source",
    releaseDate: "2025-08",
    tagline: "DeepSeek V3 系列 hybrid 推理版本，think / non-think 雙模式",
    description:
      "V3.1 整合 reasoning 與 chat 為同一個模型，可由 chat-template flag 切換 thinking / non-thinking 模式，並提供 128K 上下文與全開源權重。",
    strengths: ["hybrid thinking / chat 雙模式", "權重 MIT 開源", "中英文程式表現均衡"],
    limitations: ["thinking 模式 token 成本上升", "工具呼叫穩定度仍弱於 GPT-5"],
    useCases: ["可控自架 RAG / 代理", "中英文程式助手", "fine-tune 起點"],
    contextWindow: "128K tokens",
    openWeight: true,
    tags: ["開源", "hybrid 推理", "MIT"],
    officialUrl: "https://github.com/deepseek-ai/DeepSeek-V3",
    trainingCutoff: "2025-04",
    languages: ["en", "zh"],
    latencyClass: "fast",
    pricing: {
      inputPerMillion: "$0.27",
      outputPerMillion: "$1.1",
      unit: "USD / 1M tokens",
      note: "cached input 折扣大，thinking 模式 output 另計",
      tier: "low",
    },
    availability: { api: true, web: true, selfHost: true },
    researchKeywords: ["DeepSeek V3.1 hybrid pricing benchmark"],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      functionCalling: true,
      structuredOutput: true,
      streaming: true,
      fineTuning: true,
      promptCaching: true,
    },
    safetyTier: "medium",
    peers: ["kimi-k2", "glm-4-6", "minimax-m1", "qwen3-max"],
    predecessorId: "deepseek-v3",
  },
  {
    id: "gpt-image-1",
    name: "GPT Image 1",
    apiId: "gpt-image-1",
    provider: "OpenAI",
    modality: "image",
    tier: "frontier",
    releaseDate: "2025-04",
    tagline: "OpenAI 把 ChatGPT 的圖像生成抽出來，文字渲染與精細編輯",
    description:
      "GPT Image 1 為 OpenAI 把 ChatGPT 內建圖像生成抽出開放的 API，主打世界知識整合與圖內文字準確度，並支援帶遮罩編輯與多圖參考輸入。",
    strengths: [
      "圖內文字渲染準確",
      "世界知識融入畫面（圖表 / 海報）",
      "支援多參考圖 + 遮罩編輯",
    ],
    limitations: ["生成時間中等", "極端寫實角色仍偶有瑕疵"],
    useCases: ["品牌素材", "PPT / 報告插圖", "圖表化說明", "圖像編輯"],
    openWeight: false,
    tags: ["圖像", "文字渲染", "編輯"],
    officialUrl: "https://platform.openai.com/docs/guides/image-generation",
    trainingCutoff: "2024-12",
    latencyClass: "standard",
    pricing: {
      unit: "USD / image",
      note: "Low / Medium / High 三檔解析度；高解析另計",
      tier: "medium",
    },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["GPT Image 1 pricing API"],
    factCheck: { status: "pending", sources: [] },
    capabilities: { streaming: false, fineTuning: false },
    safetyTier: "high",
    compliance: ["SOC2", "GDPR"],
    peers: ["dall-e-3", "imagen-4", "midjourney-v7", "ideogram-3"],
    predecessorId: "dall-e-3",
  },
  {
    id: "nemotron-nano-9b",
    name: "Nemotron Nano 9B v2",
    apiId: "nemotron-nano-9b-v2",
    provider: "NVIDIA",
    modality: "text",
    tier: "open-source",
    releaseDate: "2025-08",
    tagline: "NVIDIA 開源 9B 推理模型，可在單張 RTX 4090 上跑",
    description:
      "NVIDIA Nemotron Nano 9B v2 為 9B 蒸餾模型，主打單張消費級 GPU 即可跑高品質推理，並支援 thinking budget 控制（限制思考 tokens 數）。",
    strengths: [
      "9B 體型即達 30B 級表現",
      "thinking budget 可顯式控制",
      "NVIDIA Open Model License 商用可用",
    ],
    limitations: ["脈絡視窗 128K", "中文較弱"],
    useCases: ["邊緣推理", "本地 fine-tune", "教育與研究", "成本敏感 SaaS"],
    contextWindow: "128K tokens",
    openWeight: true,
    tags: ["小模型", "thinking budget", "本地推論"],
    officialUrl: "https://huggingface.co/nvidia/Nemotron-Nano-9B-v2",
    trainingCutoff: "2025-04",
    latencyClass: "fast",
    pricing: {
      unit: "self-host or build.nvidia.com",
      tier: "self-host",
    },
    availability: { api: true, web: true, selfHost: true },
    researchKeywords: ["Nemotron Nano 9B v2 benchmark"],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      functionCalling: true,
      structuredOutput: true,
      streaming: true,
      fineTuning: true,
    },
    safetyTier: "medium",
    peers: ["phi-4", "llama-3-3-70b", "deepseek-v3-1"],
  },

  // ── NVIDIA 全棧整合：推理 LLM、世界模型、嵌入、語音、影像、虛擬人 ────
  {
    id: "llama-nemotron-ultra-253b",
    name: "Llama Nemotron Ultra 253B v1",
    apiId: "llama-3.1-nemotron-ultra-253b-v1",
    provider: "NVIDIA",
    modality: "text",
    tier: "frontier",
    releaseDate: "2025-04",
    tagline: "NVIDIA 推理旗艦，從 Llama 3.1 405B 蒸餾的 thinking 模型",
    description:
      "Llama Nemotron Ultra 253B 是 NVIDIA 以 Llama 3.1 405B 為基底、透過 NAS（神經架構搜尋）壓縮並進行多階段強化學習後訓練的開源推理旗艦，支援可切換的 thinking / non-thinking 模式，可在單台 8x H100 節點上推論。",
    strengths: [
      "頂級推理 / 數學 / 科學表現（接近 DeepSeek R1 / o3）",
      "可切換 thinking 模式，控制延遲與成本",
      "NVIDIA Open Model License，企業可商用",
      "原生整合 NIM 微服務與 TensorRT-LLM",
    ],
    limitations: [
      "推論需要 8x H100 / B200 級硬體",
      "中文能力相較英文略弱",
    ],
    useCases: [
      "企業可自架的推理代理",
      "科學 / 數學 / 程式設計研究",
      "高品質合成資料生成",
      "與 NIM 工作流結合的私有部署",
    ],
    contextWindow: "128K tokens",
    openWeight: true,
    tags: ["推理", "thinking 模式", "開源", "企業自架"],
    featured: true,
    officialUrl:
      "https://huggingface.co/nvidia/Llama-3_1-Nemotron-Ultra-253B-v1",
    trainingCutoff: "2025-03",
    languages: ["en", "zh", "ja", "es", "fr", "de"],
    latencyClass: "slow",
    pricing: {
      unit: "self-host / build.nvidia.com",
      note: "build.nvidia.com 提供免費試用額度；NIM 訂閱與 DGX Cloud 另計",
      tier: "self-host",
    },
    benchmarks: [
      { name: "GPQA-Diamond", score: "76%+" },
      { name: "MATH-500", score: "97%+" },
      { name: "LiveCodeBench", score: "頂尖" },
    ],
    availability: {
      api: true,
      web: true,
      selfHost: true,
      notes: "build.nvidia.com、NGC、Hugging Face；可選 NIM 容器一鍵部署",
    },
    researchKeywords: [
      "Llama Nemotron Ultra 253B benchmark",
      "NVIDIA Nemotron reasoning model",
    ],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      functionCalling: true,
      structuredOutput: true,
      streaming: true,
      fineTuning: true,
      promptCaching: false,
    },
    safetyTier: "medium",
    compliance: ["SOC2"],
    peers: ["deepseek-r1", "o3", "claude-opus-4-7", "qwen3-max"],
    predecessorId: "nemotron-nano-9b",
  },
  {
    id: "llama-nemotron-super-49b",
    name: "Llama Nemotron Super 49B v1.5",
    apiId: "llama-3.3-nemotron-super-49b-v1.5",
    provider: "NVIDIA",
    modality: "text",
    tier: "balanced",
    releaseDate: "2025-07",
    tagline: "單張 H100 即可跑的均衡推理模型，CP 值出色",
    description:
      "Llama Nemotron Super 49B v1.5 由 Llama 3.3 70B 蒸餾而來，透過 NAS 壓縮為 49B，目標是在單張 H100 80GB 上推論並維持接近原模型的能力，並支援 thinking budget 控制。",
    strengths: [
      "單張 H100 即可跑，硬體門檻低",
      "thinking budget 可調，平衡延遲與品質",
      "NVIDIA Open Model License，可商用",
      "代理任務工具呼叫穩定",
    ],
    limitations: ["脈絡 128K", "極長代理鏈仍略弱於 Ultra 版"],
    useCases: [
      "中型企業可控自架旗艦",
      "代理任務與工具呼叫",
      "本地 fine-tune 起點",
      "成本敏感的推理 SaaS",
    ],
    contextWindow: "128K tokens",
    openWeight: true,
    tags: ["均衡", "thinking 模式", "單卡 H100", "開源"],
    officialUrl:
      "https://huggingface.co/nvidia/Llama-3_3-Nemotron-Super-49B-v1_5",
    trainingCutoff: "2025-05",
    languages: ["en", "zh", "ja", "es", "fr", "de"],
    latencyClass: "fast",
    pricing: {
      unit: "self-host / build.nvidia.com",
      tier: "self-host",
    },
    benchmarks: [
      { name: "MMLU", score: "85%+" },
      { name: "HumanEval", score: "88%+" },
      { name: "BFCL（工具呼叫）", score: "頂尖" },
    ],
    availability: { api: true, web: true, selfHost: true },
    researchKeywords: [
      "Llama Nemotron Super 49B v1.5 benchmark",
      "NVIDIA NIM Nemotron Super",
    ],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      functionCalling: true,
      structuredOutput: true,
      streaming: true,
      fineTuning: true,
    },
    safetyTier: "medium",
    peers: [
      "llama-nemotron-ultra-253b",
      "nemotron-nano-9b",
      "deepseek-v3-1",
      "qwen-2-5-72b",
    ],
    predecessorId: "nemotron-nano-9b",
  },
  {
    id: "cosmos-predict-2",
    name: "Cosmos Predict 2",
    apiId: "cosmos-predict2",
    provider: "NVIDIA",
    modality: "video",
    tier: "open-source",
    releaseDate: "2025-06",
    tagline: "NVIDIA 物理 AI 世界模型，模擬真實世界物理的影片生成",
    description:
      "Cosmos Predict 2 是 NVIDIA Cosmos 世界基礎模型家族的影片預測版本，從文字 + 起始影像生成符合物理規律的影片，主打機器人、自駕車與工業仿真場景的合成資料生成。",
    strengths: [
      "原生考慮物理規律的影片生成",
      "適合機器人 / 自駕車合成資料",
      "NVIDIA Open Model License 商用可用",
      "與 Omniverse / Isaac Sim 直連",
    ],
    limitations: [
      "輸出風格偏寫實 / 工業，非藝術用途",
      "需要 H100 / B200 級硬體推論",
    ],
    useCases: [
      "機器人策略訓練合成資料",
      "自駕車邊角案例模擬",
      "工業數位孿生",
      "物理 AI 研究",
    ],
    openWeight: true,
    tags: ["世界模型", "物理 AI", "合成資料", "開源"],
    featured: true,
    officialUrl: "https://www.nvidia.com/en-us/ai/cosmos/",
    trainingCutoff: "2025-04",
    latencyClass: "slow",
    pricing: {
      unit: "self-host / build.nvidia.com",
      note: "Hugging Face 釋出權重；NIM 容器可在 DGX Cloud 部署",
      tier: "self-host",
    },
    availability: { api: true, web: true, selfHost: true },
    researchKeywords: [
      "NVIDIA Cosmos Predict 2 world foundation model",
      "Cosmos physical AI video",
    ],
    factCheck: { status: "pending", sources: [] },
    capabilities: { streaming: false, fineTuning: true },
    safetyTier: "medium",
    peers: ["sora-2", "veo-3", "hunyuan-video", "runway-gen-3"],
  },
  {
    id: "nv-embed-v2",
    name: "NV-Embed v2",
    apiId: "nv-embed-v2",
    provider: "NVIDIA",
    modality: "embedding",
    tier: "balanced",
    releaseDate: "2024-09",
    tagline: "NVIDIA 以 Mistral 7B 為底的 SOTA 嵌入模型",
    description:
      "NV-Embed v2 是 NVIDIA 基於 Mistral 7B、加入 latent attention pooling 與兩階段對比學習訓練的嵌入模型，曾位居 MTEB 排行榜第一，預設 4096 維、支援多種任務指令。",
    strengths: [
      "MTEB 多項任務頂尖",
      "instruction-aware 嵌入，可指定檢索 / 分類 / 聚類",
      "可自架（單張 A100 / H100）",
    ],
    limitations: [
      "非商用授權（CC BY-NC 4.0），商用需另談",
      "4096 維向量儲存成本較高",
    ],
    useCases: [
      "高精度 RAG 檢索",
      "語意搜尋 / 推薦",
      "資料去重與聚類",
      "向量資料庫評估基準",
    ],
    contextWindow: "32K tokens / 輸入",
    openWeight: true,
    tags: ["嵌入向量", "RAG", "instruction-aware"],
    officialUrl: "https://huggingface.co/nvidia/NV-Embed-v2",
    latencyClass: "realtime",
    pricing: {
      unit: "self-host / build.nvidia.com",
      note: "權重為 CC BY-NC 4.0；NIM 商用需洽 NVIDIA",
      tier: "self-host",
    },
    benchmarks: [
      { name: "MTEB（平均）", score: "72.31" },
      { name: "BEIR 檢索", score: "業界頂尖" },
    ],
    availability: { api: true, web: false, selfHost: true },
    researchKeywords: ["NV-Embed v2 MTEB leaderboard"],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      streaming: false,
      fineTuning: true,
      structuredOutput: false,
    },
    safetyTier: "medium",
    peers: ["openai-embedding-3-large", "voyage-3-large"],
  },
  {
    id: "parakeet-tdt-0-6b-v2",
    name: "Parakeet TDT 0.6B v2",
    apiId: "parakeet-tdt-0.6b-v2",
    provider: "NVIDIA",
    modality: "audio",
    tier: "open-source",
    releaseDate: "2025-05",
    tagline: "NVIDIA 開源 ASR，60 分鐘音檔 2 秒內轉文字",
    description:
      "Parakeet TDT 0.6B v2 是 NVIDIA NeMo 團隊推出的英文 ASR 模型，採用 FastConformer + TDT 解碼器架構，僅 600M 參數即在 HuggingFace Open ASR Leaderboard 名列前茅，並以 CC-BY-4.0 釋出可商用。",
    strengths: [
      "1 小時音檔 RTF<0.05，極致即時",
      "CC-BY-4.0 商用可用",
      "原生支援逐字時間戳與標點",
      "可在單張消費級 GPU 部署",
    ],
    limitations: [
      "主要支援英文（其他語言看 Canary 系列）",
      "未含語者分離（diarization）",
    ],
    useCases: [
      "Podcast / 會議即時轉錄",
      "客服音檔批次轉文字",
      "影片字幕生成",
      "邊緣裝置語音輸入",
    ],
    openWeight: true,
    tags: ["ASR", "即時", "開源", "可商用"],
    officialUrl: "https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2",
    languages: ["en"],
    latencyClass: "realtime",
    pricing: {
      unit: "self-host / build.nvidia.com",
      tier: "self-host",
    },
    benchmarks: [
      { name: "Open ASR Leaderboard（WER）", score: "業界前段" },
    ],
    availability: { api: true, web: true, selfHost: true },
    researchKeywords: [
      "Parakeet TDT 0.6B v2 WER benchmark",
      "NVIDIA NeMo ASR",
    ],
    factCheck: { status: "pending", sources: [] },
    capabilities: { streaming: true, fineTuning: true },
    safetyTier: "medium",
    peers: ["elevenlabs-v3"],
  },
  {
    id: "nvidia-edify-image",
    name: "NVIDIA Edify Image",
    apiId: "edify-image",
    provider: "NVIDIA",
    modality: "image",
    tier: "balanced",
    releaseDate: "2024-11",
    tagline: "商用授權資料訓練的企業級圖像生成 NIM",
    description:
      "Edify Image 為 NVIDIA Picasso 平台的影像生成 NIM 微服務，與 Getty Images、Shutterstock 等合作以授權資料訓練，主打企業可放心商用的高解析品牌素材，支援 4K 輸出與 PBR 材質感。",
    strengths: [
      "訓練資料皆授權，商用無侵權風險",
      "原生 4K 輸出",
      "與 Omniverse / USD 工作流整合",
      "可微調生成自家品牌風格",
    ],
    limitations: [
      "目前以 NIM / 合作夥伴管道為主，非自助 SaaS",
      "創意風格化稍弱於 Midjourney",
    ],
    useCases: [
      "品牌素材量產",
      "電商商品圖",
      "PBR 材質與 3D 場景輔助",
      "企業合規行銷視覺",
    ],
    openWeight: false,
    tags: ["企業合規", "授權資料", "4K", "NIM"],
    officialUrl: "https://www.nvidia.com/en-us/ai/picasso/",
    latencyClass: "standard",
    pricing: {
      unit: "USD / image via NIM or partner",
      note: "透過 Getty Generative AI、Shutterstock AI、NVIDIA NIM 訂閱",
      tier: "medium",
    },
    availability: {
      api: true,
      web: true,
      selfHost: false,
      notes: "Getty / Shutterstock 商用入口、NVIDIA NIM 企業部署",
    },
    researchKeywords: [
      "NVIDIA Edify Image Picasso enterprise",
      "Getty Shutterstock NVIDIA Edify",
    ],
    factCheck: { status: "pending", sources: [] },
    capabilities: { streaming: false, fineTuning: true },
    safetyTier: "high",
    compliance: ["SOC2"],
    peers: ["midjourney-v7", "imagen-4", "flux-1-pro", "ideogram-3"],
  },
  {
    id: "audio2face-3d",
    name: "NVIDIA Audio2Face-3D",
    apiId: "audio2face-3d",
    provider: "NVIDIA",
    modality: "audio",
    tier: "balanced",
    releaseDate: "2025-03",
    tagline: "即時音檔驅動 3D 臉部動畫，數位人 / 遊戲 NPC 通用",
    description:
      "Audio2Face-3D 是 NVIDIA ACE 數位人套件中的 NIM 微服務，輸入語音音檔即可即時輸出符合語意與情緒的 3D 臉部 blendshape 動畫，並於 2025 開源 SDK 與訓練框架。",
    strengths: [
      "即時推論（單張 RTX 即可）",
      "支援情緒控制",
      "與 Unreal / Unity / Omniverse 直接整合",
      "SDK 與訓練框架開源",
    ],
    limitations: [
      "需自備 3D 角色模型",
      "亞洲語言情緒擬真仍在優化",
    ],
    useCases: [
      "遊戲 NPC 對話動畫",
      "數位主播 / 虛擬客服",
      "影視前期分鏡",
      "教學虛擬人",
    ],
    openWeight: true,
    tags: ["數位人", "Lip Sync", "NIM", "即時"],
    officialUrl: "https://www.nvidia.com/en-us/ai/ace/",
    latencyClass: "realtime",
    pricing: {
      unit: "self-host / NIM 訂閱",
      note: "SDK 開源；NIM 企業部署需 NVIDIA AI Enterprise",
      tier: "self-host",
    },
    availability: { api: true, web: true, selfHost: true },
    researchKeywords: ["NVIDIA Audio2Face-3D NIM ACE digital human"],
    factCheck: { status: "pending", sources: [] },
    capabilities: { streaming: true, fineTuning: true },
    safetyTier: "medium",
    peers: ["elevenlabs-v3"],
  },

  // ── 2026 catalog 補齊：旗艦變體、reasoning 輕量、開源權重、語音 / 嵌入 ──
  //
  // 這一批是「研究 = 發現」政策上線時的 baseline 擴張：把幾家主要廠商在 2025
  // 下半年到 2026 初的關鍵發表補齊，避免 catalog 只剩 64 款（用戶反饋「不夠多」）。
  // 每筆 factCheck 起點 = pending；discovery 找到動態時會 flag 重新驗證。

  // —— Anthropic ——
  {
    id: "claude-3-5-haiku",
    name: "Claude 3.5 Haiku",
    apiId: "claude-3-5-haiku-20241022",
    provider: "Anthropic",
    modality: "text",
    tier: "lightweight",
    releaseDate: "2024-11",
    tagline: "Anthropic 3.x 系列輕量代表，延遲低、適合即時互動",
    description:
      "Claude 3.5 Haiku 是 Claude 4 系列上線前的官方輕量旗艦，在程式設計與多輪對話的速度 / 品質曲線都很好，目前仍在 Anthropic API 上長期供應，作為 4.5 Haiku 的成本替代。",
    strengths: [
      "首 token 延遲低，可作即時介面",
      "在 Vision input + 程式任務上 cost / quality 漂亮",
      "API 穩定、文件成熟",
    ],
    limitations: ["長脈絡推理不如 Sonnet/Opus", "已被 4.5 Haiku 取代為新標準"],
    useCases: ["即時聊天 UI", "輕量 RAG", "前端輔助 / 程式碼補全"],
    contextWindow: "200K tokens",
    openWeight: false,
    tags: ["輕量", "即時", "vision"],
    officialUrl: "https://www.anthropic.com/claude",
    pricing: {
      inputPerMillion: "$1",
      outputPerMillion: "$5",
      unit: "USD / 1M tokens",
      tier: "low",
    },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["Claude 3.5 Haiku pricing", "Claude 3.5 Haiku benchmarks"],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      visionInput: true,
      functionCalling: true,
      structuredOutput: true,
      streaming: true,
      promptCaching: true,
      batchApi: true,
    },
    safetyTier: "high",
    peers: ["claude-haiku-4-5", "gpt-4o-mini", "gemini-2-flash"],
  },

  // —— OpenAI ——
  {
    id: "gpt-4-1",
    name: "GPT-4.1",
    apiId: "gpt-4.1",
    provider: "OpenAI",
    modality: "text",
    tier: "balanced",
    releaseDate: "2025-04",
    tagline: "OpenAI 2025 中段班通用旗艦，長脈絡與代碼能力大幅升級",
    description:
      "GPT-4.1 是 OpenAI 在 GPT-5 之前釋出的新世代主力，重點強化長脈絡精準度（1M tokens）、程式設計與指令遵循。仍是現行 API 用量主力之一。",
    strengths: [
      "1M tokens 長脈絡記憶準確度高",
      "程式任務、長文件 RAG 表現穩定",
      "成本比 GPT-5 / o3 友善",
    ],
    limitations: ["最頂級推理略遜 GPT-5", "新功能（agent tools）優先給 5 系列"],
    useCases: ["長文件分析", "程式輔助", "企業 RAG"],
    contextWindow: "1M tokens",
    openWeight: false,
    tags: ["長脈絡", "通用", "高 CP"],
    officialUrl: "https://platform.openai.com/docs/models",
    pricing: {
      inputPerMillion: "$2",
      outputPerMillion: "$8",
      unit: "USD / 1M tokens",
      tier: "medium",
    },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["GPT-4.1 pricing", "GPT-4.1 benchmarks 1M context"],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      visionInput: true,
      functionCalling: true,
      structuredOutput: true,
      streaming: true,
      promptCaching: true,
      batchApi: true,
    },
    safetyTier: "high",
    peers: ["gpt-5", "claude-sonnet-4-6", "gemini-3-pro"],
  },
  {
    id: "gpt-4-1-mini",
    name: "GPT-4.1 mini",
    apiId: "gpt-4.1-mini",
    provider: "OpenAI",
    modality: "text",
    tier: "lightweight",
    releaseDate: "2025-04",
    tagline: "GPT-4.1 的輕量版本，速度快、單位 token 成本低",
    description:
      "GPT-4.1 mini 是 GPT-4.1 家族的小尺寸成員，保留長脈絡與 vision 能力，是大規模生產線（客服 / 內容處理）的主力選項之一。",
    strengths: ["速度快、延遲低", "Vision input 支援", "Batch API 大幅折扣"],
    limitations: ["複雜推理仍輸 GPT-4.1 / GPT-5"],
    useCases: ["大量內容生成", "客服機器人", "簡易 RAG"],
    contextWindow: "1M tokens",
    openWeight: false,
    tags: ["輕量", "高效率", "batch"],
    officialUrl: "https://platform.openai.com/docs/models",
    pricing: {
      inputPerMillion: "$0.4",
      outputPerMillion: "$1.6",
      unit: "USD / 1M tokens",
      tier: "low",
    },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["GPT-4.1 mini pricing benchmarks"],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      visionInput: true,
      functionCalling: true,
      structuredOutput: true,
      streaming: true,
      batchApi: true,
    },
    safetyTier: "high",
    peers: ["gpt-4o-mini", "claude-3-5-haiku", "gemini-2-flash"],
  },
  {
    id: "o4-mini",
    name: "o4-mini",
    apiId: "o4-mini",
    provider: "OpenAI",
    modality: "text",
    tier: "balanced",
    releaseDate: "2025-04",
    tagline: "OpenAI 推理系列輕量旗艦，agent / 數理任務的成本之選",
    description:
      "o4-mini 是 o-series 推理模型的小尺寸版本，主打 agent 工具使用、數學與程式設計，在 ARC-AGI 與 SWE-bench 等任務上仍維持 o-series 等級表現，價格遠低於 o3。",
    strengths: [
      "Agent 工具使用穩定（內建 web / code）",
      "數理 / 程式任務性價比高",
      "可控的 reasoning effort（low/medium/high）",
    ],
    limitations: ["長脈絡寫作不如 GPT-4.1", "推理時間較長"],
    useCases: ["AI agents", "程式 + 工具呼叫", "教育解題"],
    contextWindow: "200K tokens",
    openWeight: false,
    tags: ["推理", "agent", "輕量"],
    officialUrl: "https://platform.openai.com/docs/models",
    pricing: {
      inputPerMillion: "$1.1",
      outputPerMillion: "$4.4",
      unit: "USD / 1M tokens",
      note: "推理 token 額外計費",
      tier: "medium",
    },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["o4-mini pricing reasoning benchmarks"],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      visionInput: true,
      functionCalling: true,
      structuredOutput: true,
      streaming: true,
      codeExecution: true,
      webSearch: true,
    },
    safetyTier: "high",
    peers: ["o3", "deepseek-r1", "qwq-32b"],
  },
  {
    id: "whisper-large-v3",
    name: "Whisper large-v3",
    apiId: "whisper-large-v3",
    provider: "OpenAI",
    modality: "audio",
    tier: "open-source",
    releaseDate: "2023-11",
    tagline: "OpenAI 開源 ASR 標準，99 種語言通用",
    description:
      "Whisper large-v3 是 OpenAI 公開權重的多語 ASR 模型，業界 RAG / 影片字幕 / 通話轉錄主流選擇。也以 API（whisper-1）形式提供。",
    strengths: ["99 種語言", "MIT-style 權重可自架", "API + 開源權重雙軌"],
    limitations: ["即時 RTF 不及 Parakeet 0.6B", "中文標點仍偶有錯字"],
    useCases: ["影片字幕", "Podcast 轉錄", "客服語音分析"],
    openWeight: true,
    tags: ["ASR", "多語", "開源"],
    officialUrl: "https://github.com/openai/whisper",
    languages: ["zh", "en", "ja", "ko", "es", "fr"],
    pricing: {
      unit: "$0.006 USD / 分鐘（OpenAI API）或自架免費",
      tier: "low",
    },
    availability: { api: true, web: false, selfHost: true },
    researchKeywords: ["Whisper large v3 WER multilingual"],
    factCheck: { status: "pending", sources: [] },
    capabilities: { fineTuning: true },
    safetyTier: "medium",
    peers: ["parakeet-tdt-0-6b-v2"],
  },
  {
    id: "openai-embedding-3-small",
    name: "text-embedding-3-small",
    apiId: "text-embedding-3-small",
    provider: "OpenAI",
    modality: "embedding",
    tier: "lightweight",
    releaseDate: "2024-01",
    tagline: "OpenAI 預設嵌入模型，便宜、速度快、品質夠用",
    description:
      "text-embedding-3-small 是 OpenAI 給大多數 RAG 應用建議的預設嵌入模型，1536 維（可降維）、$0.02/1M tokens，幾乎是業界最便宜的高品質嵌入。",
    strengths: ["極低 $/1M tokens", "可動態 dimension（256/512/1536）", "MTEB 仍勝多數開源"],
    limitations: ["品質遜於 3-large 與 NV-Embed v2"],
    useCases: ["大規模 RAG 索引", "向量去重", "推薦系統"],
    openWeight: false,
    tags: ["嵌入向量", "RAG", "省成本"],
    officialUrl: "https://platform.openai.com/docs/guides/embeddings",
    pricing: {
      unit: "USD / 1M tokens",
      note: "$0.02 / 1M tokens",
      tier: "low",
    },
    availability: { api: true, web: false, selfHost: false },
    researchKeywords: ["text-embedding-3-small MTEB benchmark"],
    factCheck: { status: "pending", sources: [] },
    capabilities: { batchApi: true },
    safetyTier: "high",
    peers: ["openai-embedding-3-large", "voyage-3-large", "nv-embed-v2"],
  },
  {
    id: "gpt-realtime",
    name: "GPT-Realtime",
    apiId: "gpt-realtime",
    provider: "OpenAI",
    modality: "multimodal",
    tier: "frontier",
    releaseDate: "2025-08",
    tagline: "OpenAI 端到端語音對語音模型，原生支援即時語音 agent",
    description:
      "GPT-Realtime 是 OpenAI 取代過渡版 gpt-4o-realtime-preview 的正式語音 agent 旗艦，端到端 audio-in / audio-out、原生支援工具呼叫與打斷，是建構電話 / IVR / 即時客服的首選。",
    strengths: [
      "端到端語音延遲 < 500ms",
      "原生支援打斷與多輪語音",
      "工具呼叫於語音流中",
    ],
    limitations: ["以 audio token 計費，成本不低", "繁體中文情緒仍待加強"],
    useCases: ["語音 agent", "即時客服", "電話 IVR", "語言學習"],
    openWeight: false,
    tags: ["即時語音", "agent", "多模態"],
    officialUrl: "https://platform.openai.com/docs/guides/realtime",
    latencyClass: "realtime",
    pricing: {
      unit: "USD / 1M audio tokens",
      note: "input $32 / output $64 約略；text token 另計",
      tier: "premium",
    },
    availability: { api: true, web: false, selfHost: false },
    researchKeywords: ["OpenAI Realtime API pricing"],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      audioInput: true,
      functionCalling: true,
      streaming: true,
    },
    safetyTier: "high",
    peers: ["elevenlabs-v3", "audio2face-3d"],
  },

  // —— Google ——
  {
    id: "gemma-3-27b",
    name: "Gemma 3 27B",
    apiId: "gemma-3-27b-it",
    provider: "Google",
    modality: "text",
    tier: "open-source",
    releaseDate: "2025-03",
    tagline: "Google 開源權重旗艦，27B 即接近 GPT-4o 級水準",
    description:
      "Gemma 3 27B 是 Google DeepMind 釋出的最新開源權重模型，原生 multimodal（vision）、128K 上下文，在 LMSYS Chatbot Arena 上是同尺寸開源領先。",
    strengths: [
      "Apache-style 商用授權",
      "原生 vision 多模態",
      "128K 上下文（同尺寸開源領先）",
    ],
    limitations: [
      "推論需單張 H100 / A100",
      "中文表現略遜 Qwen3 同尺寸",
    ],
    useCases: ["企業內部 LLM 自架", "RAG 後端", "可微調的開源底座"],
    contextWindow: "128K tokens",
    openWeight: true,
    tags: ["開源", "多模態", "可商用"],
    officialUrl: "https://ai.google.dev/gemma",
    pricing: { unit: "self-host / Vertex AI 預設定價", tier: "self-host" },
    availability: { api: true, web: false, selfHost: true },
    researchKeywords: ["Gemma 3 27B benchmark Chatbot Arena"],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      visionInput: true,
      streaming: true,
      fineTuning: true,
      structuredOutput: true,
    },
    safetyTier: "medium",
    peers: ["llama-3-3-70b", "qwen3-32b", "deepseek-v3-1"],
  },
  {
    id: "gemini-2-flash-thinking",
    name: "Gemini 2.0 Flash Thinking",
    apiId: "gemini-2.0-flash-thinking-exp",
    provider: "Google",
    modality: "text",
    tier: "balanced",
    releaseDate: "2025-01",
    tagline: "Gemini Flash 的推理變體，把思考過程攤在使用者眼前",
    description:
      "Gemini 2.0 Flash Thinking 在 Flash 模型上接上長思考鏈，輸出時會把推理步驟一併展示。在數理與多步問題上比一般 Flash 提升顯著。",
    strengths: ["思考過程可見", "數理推理勝率高", "Flash 級成本"],
    limitations: ["輸出較長（含思考）", "需要使用者習慣 thinking UI"],
    useCases: ["教育解題", "需要可解釋性的決策", "輕量 agent"],
    contextWindow: "1M tokens",
    openWeight: false,
    tags: ["推理", "thinking", "高 CP"],
    officialUrl: "https://ai.google.dev/gemini-api",
    pricing: { unit: "USD / 1M tokens", tier: "low" },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["Gemini 2.0 Flash Thinking benchmark"],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      visionInput: true,
      functionCalling: true,
      structuredOutput: true,
      streaming: true,
    },
    safetyTier: "high",
    peers: ["o4-mini", "deepseek-r1", "qwq-32b"],
  },
  {
    id: "google-text-embedding-005",
    name: "text-embedding-005",
    apiId: "text-embedding-005",
    provider: "Google",
    modality: "embedding",
    tier: "balanced",
    releaseDate: "2024-11",
    tagline: "Google Vertex AI 嵌入模型最新版，768 維、支援降維",
    description:
      "text-embedding-005 是 Vertex AI 上的最新生產嵌入模型，預設 768 維、支援 Matryoshka 降維（256 / 512），多語表現穩定。",
    strengths: [
      "Vertex AI 整合好",
      "支援降維儲存",
      "與 Gemini 工具鏈共生",
    ],
    limitations: [
      "純粹 MTEB 排名不如 NV-Embed v2 / 3-large",
    ],
    useCases: ["GCP 內 RAG", "向量搜尋", "推薦"],
    openWeight: false,
    tags: ["嵌入向量", "Vertex AI", "多語"],
    officialUrl: "https://cloud.google.com/vertex-ai/generative-ai/docs/embeddings",
    pricing: { unit: "USD / 1M characters via Vertex", tier: "low" },
    availability: { api: true, web: false, selfHost: false },
    researchKeywords: ["Google text-embedding-005 Vertex pricing"],
    factCheck: { status: "pending", sources: [] },
    capabilities: {},
    safetyTier: "high",
    peers: ["openai-embedding-3-large", "voyage-3-large"],
  },

  // —— Meta ——
  {
    id: "llama-4-scout",
    name: "Llama 4 Scout",
    apiId: "llama-4-scout-17b",
    provider: "Meta",
    modality: "text",
    tier: "open-source",
    releaseDate: "2025-04",
    tagline: "Meta Llama 4 系列的高效率 MoE 版本，10M 級長脈絡",
    description:
      "Llama 4 Scout 是 Llama 4 家族的中尺寸 MoE 模型（17B 啟用 / 109B 總參數），主打 10M tokens 級長脈絡與快速推理，採 Llama 4 Community License。",
    strengths: [
      "極長脈絡（聲稱 10M tokens）",
      "MoE 推論成本低於同等實力 dense",
      "原生 multimodal（vision in）",
    ],
    limitations: [
      "授權對 7 億 MAU 以上有額外限制",
      "10M 脈絡實務檢索準確度待驗證",
    ],
    useCases: ["長文件代理", "可商用開源底座", "本地化部署"],
    contextWindow: "10M tokens",
    openWeight: true,
    tags: ["開源", "MoE", "長脈絡"],
    officialUrl: "https://ai.meta.com/llama/",
    pricing: { unit: "self-host / Bedrock / Vertex 行情", tier: "self-host" },
    availability: { api: true, web: false, selfHost: true },
    researchKeywords: ["Llama 4 Scout pricing benchmarks long context"],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      visionInput: true,
      functionCalling: true,
      structuredOutput: true,
      streaming: true,
      fineTuning: true,
    },
    safetyTier: "medium",
    peers: ["llama-4-maverick", "deepseek-v3-1", "qwen3-32b"],
  },
  {
    id: "llama-4-behemoth",
    name: "Llama 4 Behemoth",
    apiId: "llama-4-behemoth",
    provider: "Meta",
    modality: "text",
    tier: "frontier",
    releaseDate: "2025-04",
    tagline: "Meta 公告中的 2T 參數教師模型，對標 GPT-5 / Gemini 3",
    description:
      "Llama 4 Behemoth 為 Meta 於 2025 公開預告的最大尺寸模型（約 2T 參數 MoE），用於蒸餾 Scout / Maverick；目前以預告 + 內部測試為主，公開可用情況待確認。",
    strengths: [
      "對標前沿閉源旗艦的開源候選",
      "巨大蒸餾來源，影響整個 Llama 4 家族",
    ],
    limitations: [
      "尚未廣泛公開可用",
      "推論硬體需求極高",
    ],
    useCases: ["旗艦級研究參考", "蒸餾教師"],
    openWeight: true,
    tags: ["開源", "旗艦", "巨型"],
    officialUrl: "https://ai.meta.com/llama/",
    pricing: { unit: "self-host / Bedrock", tier: "self-host" },
    availability: {
      api: false,
      web: false,
      selfHost: true,
      notes: "公告中，公開可用性待確認",
    },
    researchKeywords: ["Llama 4 Behemoth release date availability"],
    factCheck: { status: "pending", sources: [] },
    capabilities: { fineTuning: true, structuredOutput: true },
    safetyTier: "medium",
    peers: ["gpt-5", "claude-opus-4-7", "gemini-3-pro"],
  },

  // —— Mistral ——
  {
    id: "pixtral-large",
    name: "Pixtral Large",
    apiId: "pixtral-large-latest",
    provider: "Mistral",
    modality: "multimodal",
    tier: "balanced",
    releaseDate: "2024-11",
    tagline: "Mistral 124B 視覺旗艦，文件 / 圖表理解強",
    description:
      "Pixtral Large 是 Mistral 推出的 124B 多模態模型（Mistral Large 2 + 視覺編碼器），主打文件 / 圖表 / 截圖理解，於 OCR 與圖表 QA 場景表現亮眼。",
    strengths: [
      "文件 / 圖表 / 截圖理解強",
      "Apache 2.0 商用開放",
      "支援 128K 脈絡",
    ],
    limitations: [
      "純文字仍略遜 Sonnet 4.6 / GPT-4.1",
      "影片輸入支援有限",
    ],
    useCases: ["文件處理", "報表分析", "OCR + 結構化抽取"],
    contextWindow: "128K tokens",
    openWeight: true,
    tags: ["多模態", "文件", "開源"],
    officialUrl: "https://mistral.ai/news/pixtral-large/",
    pricing: {
      inputPerMillion: "$2",
      outputPerMillion: "$6",
      unit: "USD / 1M tokens",
      tier: "medium",
    },
    availability: { api: true, web: true, selfHost: true },
    researchKeywords: ["Pixtral Large benchmark document understanding"],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      visionInput: true,
      functionCalling: true,
      structuredOutput: true,
      streaming: true,
      fineTuning: true,
    },
    safetyTier: "medium",
    peers: ["gpt-4o", "claude-sonnet-4-6", "qwen3-32b"],
  },
  {
    id: "ministral-3b",
    name: "Ministral 3B",
    apiId: "ministral-3b-latest",
    provider: "Mistral",
    modality: "text",
    tier: "lightweight",
    releaseDate: "2024-10",
    tagline: "Mistral 邊緣級小模型，手機 / 邊緣裝置可跑",
    description:
      "Ministral 3B 是 Mistral 在 La Plateforme 上的最小尺寸生產模型，主打邊緣 / 手機部署，仍保留 128K 脈絡與函式呼叫。",
    strengths: ["可在手機 / Jetson 跑", "128K 脈絡", "函式呼叫"],
    limitations: ["品質明顯遜於 7B+ 級", "中文較弱"],
    useCases: ["邊緣裝置助手", "離線 RAG 簡化模型"],
    contextWindow: "128K tokens",
    openWeight: false,
    tags: ["邊緣", "輕量"],
    officialUrl: "https://mistral.ai/news/ministraux/",
    pricing: {
      inputPerMillion: "$0.04",
      outputPerMillion: "$0.04",
      unit: "USD / 1M tokens",
      tier: "low",
    },
    availability: { api: true, web: false, selfHost: false },
    researchKeywords: ["Ministral 3B benchmark edge"],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      functionCalling: true,
      structuredOutput: true,
      streaming: true,
    },
    safetyTier: "medium",
    peers: ["phi-4", "gemma-3-27b"],
  },

  // —— DeepSeek ——
  {
    id: "deepseek-r1-distill-llama-70b",
    name: "DeepSeek R1 Distill (Llama 70B)",
    apiId: "deepseek-r1-distill-llama-70b",
    provider: "DeepSeek",
    modality: "text",
    tier: "open-source",
    releaseDate: "2025-01",
    tagline: "DeepSeek R1 的 Llama 70B 蒸餾版，開源權重可自架",
    description:
      "DeepSeek R1 Distill Llama 70B 把 R1 的 reasoning 能力蒸餾進 Llama 3.3 70B 底座，是社群最熱門的「能在自家 GPU 跑的 reasoning 模型」之一。",
    strengths: [
      "開源權重可自架",
      "Reasoning 能力顯著高於同尺寸 base",
      "與 Llama 工具鏈相容",
    ],
    limitations: ["推論需 2x H100 / B200", "中文略遜 Qwen 系列"],
    useCases: ["本地 reasoning agent", "離線數學 / 程式輔助"],
    contextWindow: "128K tokens",
    openWeight: true,
    tags: ["開源", "推理", "蒸餾"],
    officialUrl: "https://github.com/deepseek-ai/DeepSeek-R1",
    pricing: { unit: "self-host", tier: "self-host" },
    availability: { api: true, web: false, selfHost: true },
    researchKeywords: ["DeepSeek R1 Distill Llama 70B benchmark"],
    factCheck: { status: "pending", sources: [] },
    capabilities: { streaming: true, fineTuning: true },
    safetyTier: "low",
    peers: ["deepseek-r1", "qwq-32b", "o4-mini"],
  },
  {
    id: "deepseek-coder-v2",
    name: "DeepSeek Coder V2",
    apiId: "deepseek-coder",
    provider: "DeepSeek",
    modality: "text",
    tier: "open-source",
    releaseDate: "2024-07",
    tagline: "DeepSeek 程式專用 MoE，236B 參數 / 21B 啟用",
    description:
      "DeepSeek Coder V2 是專注程式設計的開源 MoE 模型，HumanEval / MBPP / LiveCodeBench 等程式 benchmark 上是同尺寸開源領先，被廣泛用作本地 Copilot 後端。",
    strengths: ["程式 benchmark 開源頂尖", "支援 338 種程式語言", "可商用"],
    limitations: ["普通對話不如同尺寸通用模型", "需要充足 VRAM"],
    useCases: ["本地 Copilot 替代", "程式靜態分析輔助"],
    contextWindow: "128K tokens",
    openWeight: true,
    tags: ["程式", "開源", "MoE"],
    officialUrl: "https://github.com/deepseek-ai/DeepSeek-Coder-V2",
    pricing: { unit: "self-host / DeepSeek API 行情", tier: "self-host" },
    availability: { api: true, web: false, selfHost: true },
    researchKeywords: ["DeepSeek Coder V2 HumanEval benchmark"],
    factCheck: { status: "pending", sources: [] },
    capabilities: { streaming: true, fineTuning: true, structuredOutput: true },
    safetyTier: "low",
    peers: ["codestral-25-01", "deepseek-v3-1"],
  },

  // —— Alibaba / Qwen ——
  {
    id: "qwen3-32b",
    name: "Qwen3 32B",
    apiId: "qwen3-32b",
    provider: "Alibaba",
    modality: "text",
    tier: "open-source",
    releaseDate: "2025-04",
    tagline: "Qwen3 系列 32B 開源權重，中文與多語通用主力",
    description:
      "Qwen3 32B 是 Alibaba Qwen3 家族的中尺寸開源模型，支援可切換 thinking / non-thinking 模式、128K 脈絡，是社群中文場景的開源首選之一。",
    strengths: [
      "可切換 thinking / non-thinking 模式",
      "中文場景社群首選",
      "Apache 2.0 商用",
    ],
    limitations: ["推論需 1x H100 / 4x L40s"],
    useCases: ["中文 RAG / agent 自架", "可微調底座"],
    contextWindow: "128K tokens",
    openWeight: true,
    tags: ["開源", "中文", "thinking"],
    officialUrl: "https://qwenlm.github.io/",
    pricing: { unit: "self-host / DashScope API", tier: "self-host" },
    availability: { api: true, web: true, selfHost: true },
    researchKeywords: ["Qwen3 32B benchmark Chatbot Arena thinking"],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      functionCalling: true,
      structuredOutput: true,
      streaming: true,
      fineTuning: true,
    },
    safetyTier: "medium",
    peers: ["qwen-2-5-72b", "gemma-3-27b", "deepseek-v3-1"],
  },
  {
    id: "qwq-32b",
    name: "QwQ 32B",
    apiId: "qwq-32b",
    provider: "Alibaba",
    modality: "text",
    tier: "open-source",
    releaseDate: "2025-03",
    tagline: "Alibaba 推理專門 32B 模型，可媲美 R1 / o3-mini",
    description:
      "QwQ 32B 是 Qwen 團隊推出的推理專用模型，以 32B 參數逼近 DeepSeek R1 671B 的推理表現，特別在數學與程式設計任務上具有代表性的開源水準。",
    strengths: [
      "推理 benchmark 同尺寸頂尖",
      "32B 即可自架，平易",
      "Apache 2.0",
    ],
    limitations: ["輸出冗長", "中文以外語言略遜"],
    useCases: ["本地推理 agent", "教育 / 科研數學輔助"],
    contextWindow: "128K tokens",
    openWeight: true,
    tags: ["開源", "推理", "中文"],
    officialUrl: "https://qwenlm.github.io/blog/qwq-32b/",
    pricing: { unit: "self-host", tier: "self-host" },
    availability: { api: true, web: true, selfHost: true },
    researchKeywords: ["QwQ 32B reasoning benchmark"],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      streaming: true,
      fineTuning: true,
      structuredOutput: true,
    },
    safetyTier: "medium",
    peers: ["deepseek-r1", "o4-mini", "gemini-2-flash-thinking"],
  },

  // —— Microsoft ——
  {
    id: "phi-3-5-moe",
    name: "Phi-3.5 MoE",
    apiId: "phi-3.5-moe-instruct",
    provider: "Microsoft",
    modality: "text",
    tier: "open-source",
    releaseDate: "2024-08",
    tagline: "Microsoft 小型 MoE 開源旗艦，16x3.8B 設計",
    description:
      "Phi-3.5 MoE 是 Microsoft Phi 系列首個 Mixture-of-Experts 模型，總參數 41.9B / 啟用 6.6B，主打可在單機部署的小型企業助手。",
    strengths: [
      "MoE 推論成本低於同 quality dense",
      "MIT 商用授權",
      "資料品質導向訓練",
    ],
    limitations: [
      "推理能力遜於同期 R1 / o-series",
      "中文不是主力",
    ],
    useCases: ["企業本地 LLM", "邊緣裝置助手"],
    contextWindow: "128K tokens",
    openWeight: true,
    tags: ["開源", "MoE", "輕量"],
    officialUrl: "https://huggingface.co/microsoft/Phi-3.5-MoE-instruct",
    pricing: { unit: "self-host", tier: "self-host" },
    availability: { api: true, web: false, selfHost: true },
    researchKeywords: ["Phi-3.5 MoE benchmark MIT license"],
    factCheck: { status: "pending", sources: [] },
    capabilities: { streaming: true, fineTuning: true, structuredOutput: true },
    safetyTier: "medium",
    peers: ["phi-4", "mistral-medium-3"],
  },

  // —— Stability AI ——
  {
    id: "stable-video-3d",
    name: "Stable Video 3D",
    apiId: "stable-video-3d",
    provider: "Stability AI",
    modality: "video",
    tier: "open-source",
    releaseDate: "2024-03",
    tagline: "Stability 開源 3D / 軌道環繞影片生成",
    description:
      "Stable Video 3D 從單張圖生成 3D 環繞影片或 NeRF 風格軌道視角，主打 3D 資產初稿與 AR/VR 開發者的速寫工具。",
    strengths: [
      "從單圖生成 3D 視角",
      "開源權重 (CC BY-NC 4.0)",
      "可自架",
    ],
    limitations: [
      "非商用授權，商用需另簽",
      "輸出幀數有限（短軌道）",
    ],
    useCases: ["3D 物件素材", "AR 預覽", "影片合成輔助"],
    openWeight: true,
    tags: ["3D", "影片", "開源", "非商用"],
    officialUrl: "https://stability.ai/news/introducing-stable-video-3d",
    pricing: { unit: "self-host", tier: "self-host" },
    availability: { api: false, web: false, selfHost: true },
    researchKeywords: ["Stable Video 3D research paper"],
    factCheck: { status: "pending", sources: [] },
    capabilities: { streaming: false, fineTuning: true },
    safetyTier: "medium",
    peers: ["cosmos-predict-2", "luma-dream-machine"],
  },
  {
    id: "stable-audio-2",
    name: "Stable Audio 2",
    apiId: "stable-audio-2",
    provider: "Stability AI",
    modality: "audio",
    tier: "balanced",
    releaseDate: "2024-04",
    tagline: "Stability 文字轉音樂 / 音效，3 分鐘輸出",
    description:
      "Stable Audio 2 是 Stability 的文字到音樂 / 音效模型，可生成最長 3 分鐘音樂段落並支援 audio-to-audio。",
    strengths: ["3 分鐘音樂段落", "音效（SFX）與音樂雙模式", "商用方案完善"],
    limitations: ["人聲合成不如 Suno / Udio", "繁體中文歌詞支援弱"],
    useCases: ["影片配樂", "遊戲 SFX", "Podcast bumper"],
    openWeight: false,
    tags: ["音樂", "SFX", "TTM"],
    officialUrl: "https://stability.ai/stable-audio",
    pricing: { unit: "USD / 訂閱 / API", tier: "medium" },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["Stable Audio 2 generation quality"],
    factCheck: { status: "pending", sources: [] },
    capabilities: { streaming: false },
    safetyTier: "medium",
    peers: ["suno-v4", "udio"],
  },

  // —— xAI ——
  {
    id: "grok-2",
    name: "Grok 2",
    apiId: "grok-2",
    provider: "xAI",
    modality: "text",
    tier: "balanced",
    releaseDate: "2024-08",
    tagline: "xAI 第二代旗艦，整合 X / Twitter 即時資訊",
    description:
      "Grok 2 是 xAI 於 2024 中推出的旗艦模型，主打與 X 平台即時搜尋整合與較寬鬆的內容對齊，是 Grok 3 / 4 上線前的主力 API 提供。",
    strengths: ["X 即時資訊整合", "對齊較寬鬆", "API 可程式化呼叫"],
    limitations: ["Benchmark 已被 3/4 系列超越", "中文表現中等"],
    useCases: ["社群資訊 agent", "即時新聞摘要"],
    contextWindow: "128K tokens",
    openWeight: false,
    tags: ["即時資訊", "API"],
    officialUrl: "https://x.ai/",
    pricing: {
      inputPerMillion: "$2",
      outputPerMillion: "$10",
      unit: "USD / 1M tokens",
      tier: "medium",
    },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["Grok 2 pricing benchmarks"],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      visionInput: true,
      functionCalling: true,
      streaming: true,
    },
    safetyTier: "low",
    peers: ["grok-3", "gpt-4o", "claude-sonnet-4-6"],
  },

  // —— Cohere ——
  {
    id: "cohere-command-r-plus",
    name: "Command R+",
    apiId: "command-r-plus-08-2024",
    provider: "Cohere",
    modality: "text",
    tier: "balanced",
    releaseDate: "2024-08",
    tagline: "Cohere RAG / 工具使用旗艦，企業多語 + 引用內建",
    description:
      "Command R+ 是 Cohere 為 RAG 與工具使用設計的旗艦，原生支援 grounded generation（自帶引用）與多語檢索，企業合規與部署彈性高。",
    strengths: [
      "原生 RAG 引用",
      "多語檢索（10 種主要語言）",
      "可自架 / VPC 部署",
    ],
    limitations: [
      "純對話品質遜旗艦閉源",
      "中文不是主力",
    ],
    useCases: ["企業 RAG agent", "多語客服", "合規部署"],
    contextWindow: "128K tokens",
    openWeight: false,
    tags: ["RAG", "企業", "多語"],
    officialUrl: "https://cohere.com/command",
    pricing: {
      inputPerMillion: "$2.5",
      outputPerMillion: "$10",
      unit: "USD / 1M tokens",
      tier: "medium",
    },
    availability: { api: true, web: true, selfHost: true },
    researchKeywords: ["Cohere Command R Plus benchmarks RAG"],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      functionCalling: true,
      structuredOutput: true,
      streaming: true,
      fineTuning: true,
    },
    safetyTier: "high",
    compliance: ["SOC2", "HIPAA"],
    peers: ["cohere-command-a", "gpt-4-1", "claude-sonnet-4-6"],
  },

  // —— Voyage AI ——
  {
    id: "voyage-multimodal-3",
    name: "Voyage Multimodal 3",
    apiId: "voyage-multimodal-3",
    provider: "Voyage AI",
    modality: "embedding",
    tier: "balanced",
    releaseDate: "2024-11",
    tagline: "Voyage 文字 + 圖像混合嵌入，PDF / 圖表 RAG 利器",
    description:
      "Voyage Multimodal 3 同時對文字與圖像嵌入到同一向量空間，特別適合需要對 PDF 圖表、截圖、混排文件做 RAG 的場景。",
    strengths: [
      "文字 + 圖像同空間",
      "PDF / 圖表場景 SOTA",
      "API 易整合",
    ],
    limitations: ["僅 API、不開源", "影片 / 音訊不支援"],
    useCases: ["文件智能（圖表 + 文字）", "電商 (圖 + 描述) 檢索"],
    openWeight: false,
    tags: ["嵌入向量", "多模態", "RAG"],
    officialUrl: "https://blog.voyageai.com/2024/11/12/voyage-multimodal-3/",
    pricing: { unit: "USD / 1M tokens 或 / image", tier: "medium" },
    availability: { api: true, web: false, selfHost: false },
    researchKeywords: ["Voyage multimodal 3 benchmark"],
    factCheck: { status: "pending", sources: [] },
    capabilities: {},
    safetyTier: "high",
    peers: ["voyage-3-large", "nv-embed-v2"],
  },

  // —— Black Forest Labs ——
  {
    id: "flux-1-1-pro-ultra",
    name: "FLUX 1.1 [pro] Ultra",
    apiId: "flux-1.1-pro-ultra",
    provider: "Black Forest Labs",
    modality: "image",
    tier: "frontier",
    releaseDate: "2024-11",
    tagline: "FLUX pro 系列頂規，4MP 高解析、寫實風頂尖",
    description:
      "FLUX 1.1 [pro] Ultra 是 Black Forest Labs 在 fal / replicate / together 上廣泛部署的高解析圖像旗艦，最高 4MP 直出，寫實 / 排版 / 細節質感都明顯超越同期。",
    strengths: ["4MP 直出", "寫實質感 / 排版頂尖", "API 廣泛部署"],
    limitations: ["閉源 API", "風格化弱於 Midjourney"],
    useCases: ["高解析行銷視覺", "電商主圖", "印刷素材"],
    openWeight: false,
    tags: ["寫實", "高解析", "API"],
    officialUrl: "https://blackforestlabs.ai/",
    pricing: { unit: "USD / image", note: "約 $0.06 / image", tier: "medium" },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["FLUX 1.1 pro Ultra pricing benchmark"],
    factCheck: { status: "pending", sources: [] },
    capabilities: { streaming: false },
    safetyTier: "medium",
    peers: ["flux-1-pro", "midjourney-v7", "imagen-4"],
  },

  // —— Kling AI ——
  {
    id: "kling-1-6",
    name: "Kling 1.6",
    apiId: "kling-1.6",
    provider: "Kling AI",
    modality: "video",
    tier: "balanced",
    releaseDate: "2025-01",
    tagline: "Kling 二代過渡版本，速度更快、提示遵循更佳",
    description:
      "Kling 1.6 是 Kling AI 在 2.0 上線前的中段版本，主打速度與提示遵循度提升，相對 1.0 在亞洲臉部與細節表現都有改善。",
    strengths: ["速度比 2.0 快", "亞洲臉部品質好", "API 穩定"],
    limitations: ["品質仍遜 Kling 2 / Veo 3", "10 秒上限"],
    useCases: ["短影片素材", "社群短片試做"],
    openWeight: false,
    tags: ["亞洲", "短影片", "性價比"],
    officialUrl: "https://kling.kuaishou.com/",
    pricing: { unit: "USD / generation", tier: "medium" },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["Kling 1.6 benchmark"],
    factCheck: { status: "pending", sources: [] },
    capabilities: { streaming: false },
    safetyTier: "medium",
    peers: ["kling-2", "hailuo-02", "runway-gen-3"],
  },

  // —— MiniMax ——
  {
    id: "minimax-speech-02",
    name: "MiniMax Speech-02",
    apiId: "speech-02-hd",
    provider: "MiniMax",
    modality: "audio",
    tier: "balanced",
    releaseDate: "2025-04",
    tagline: "MiniMax 新一代多語 TTS，繁中 / 粵語 / 多情緒",
    description:
      "MiniMax Speech-02 是 MiniMax 推出的新世代 TTS 模型，主打繁中 / 粵語等亞洲語言的細緻表達與多情緒輸出，並支援 voice cloning。",
    strengths: [
      "繁中 / 粵語 / 日韓表現好",
      "情緒控制細緻",
      "Voice cloning 友善",
    ],
    limitations: [
      "Voice cloning 需遵守地區法規",
      "歐美語言主流仍偏向 ElevenLabs",
    ],
    useCases: ["亞洲市場語音內容", "Podcast 主持人虛擬化", "客服 IVR"],
    openWeight: false,
    tags: ["TTS", "亞洲", "多情緒"],
    officialUrl: "https://www.minimax.io/audio",
    pricing: { unit: "USD / 1M characters", tier: "low" },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["MiniMax Speech-02 TTS Chinese benchmarks"],
    factCheck: { status: "pending", sources: [] },
    capabilities: { streaming: true },
    safetyTier: "medium",
    peers: ["elevenlabs-v3", "gpt-realtime"],
  },

  // —— Pika ——
  {
    id: "pika-2-0",
    name: "Pika 2.0",
    apiId: "pika-2.0",
    provider: "Pika",
    modality: "video",
    tier: "balanced",
    releaseDate: "2024-12",
    tagline: "Pika 第二代影片生成，Scene Ingredients 結構化合成",
    description:
      "Pika 2.0 推出 Scene Ingredients（同時上傳角色、物件、場景，由模型合成），是社群創意短片工作流的主力之一。",
    strengths: [
      "Scene Ingredients 結構化輸入",
      "風格化短片擅長",
      "社群素材豐富",
    ],
    limitations: ["寫實感不及 Veo 3 / Sora 2", "10 秒上限"],
    useCases: ["風格化短片", "社群創意素材", "MV 草稿"],
    openWeight: false,
    tags: ["影片", "創意", "Scene Ingredients"],
    officialUrl: "https://pika.art/",
    pricing: { unit: "USD / generation 或訂閱", tier: "medium" },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["Pika 2.0 Scene Ingredients"],
    factCheck: { status: "pending", sources: [] },
    capabilities: { streaming: false },
    safetyTier: "medium",
    peers: ["pika-1-5", "pika-2-2", "runway-gen-3"],
  },

  // —— Ideogram ——
  {
    id: "ideogram-2",
    name: "Ideogram 2.0",
    apiId: "ideogram-2.0",
    provider: "Ideogram",
    modality: "image",
    tier: "balanced",
    releaseDate: "2024-08",
    tagline: "Ideogram 第二代，文字準確度仍是社群冠軍",
    description:
      "Ideogram 2.0 在「圖像內生成準確文字」上仍維持業界領先，是行銷文案海報 / 包裝設計的常駐選擇。",
    strengths: ["圖像內文字準確", "排版 / 海報擅長", "API 與 web 雙軌"],
    limitations: ["藝術風格化不及 Midjourney", "解析上限低於 4MP"],
    useCases: ["海報 / 包裝", "Logo 草稿", "社群圖文素材"],
    openWeight: false,
    tags: ["文字準確", "排版", "海報"],
    officialUrl: "https://ideogram.ai/",
    pricing: { unit: "USD / image 或訂閱", tier: "medium" },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["Ideogram 2.0 text-in-image benchmark"],
    factCheck: { status: "pending", sources: [] },
    capabilities: {},
    safetyTier: "high",
    peers: ["ideogram-3", "flux-1-pro", "recraft-v3"],
  },

  // —— Runway ——
  {
    id: "runway-gen-4",
    name: "Runway Gen-4",
    apiId: "gen-4",
    provider: "Runway",
    modality: "video",
    tier: "frontier",
    releaseDate: "2025-03",
    tagline: "Runway 第四代影片旗艦，物件 / 場景一致性大幅提升",
    description:
      "Runway Gen-4 是 Gen-3 的後繼，主打跨鏡頭物件一致性、影像 + 文字混合條件控制與更高解析輸出，是影視前期分鏡與廣告創意主力之一。",
    strengths: [
      "跨鏡頭物件一致性",
      "影像 + 文字混合條件",
      "影視級色彩與構圖",
    ],
    limitations: ["仍受限於每段秒數", "API 訂閱費用較高"],
    useCases: ["影視前期 / 廣告", "MV 視覺草稿", "概念驗證"],
    openWeight: false,
    tags: ["影片", "影視", "Gen-4"],
    officialUrl: "https://runwayml.com/",
    pricing: { unit: "USD / 訂閱 + per-credit", tier: "high" },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["Runway Gen-4 release benchmark"],
    factCheck: { status: "pending", sources: [] },
    capabilities: { streaming: false },
    safetyTier: "high",
    peers: ["runway-gen-3", "sora-2", "veo-3", "kling-2"],
  },

  // —— Luma ——
  {
    id: "luma-ray-2",
    name: "Luma Ray 2",
    apiId: "ray-2",
    provider: "Luma",
    modality: "video",
    tier: "frontier",
    releaseDate: "2025-01",
    tagline: "Luma 新世代影片模型，物理動作擬真度大幅提升",
    description:
      "Luma Ray 2 是 Dream Machine 系列的後繼，主打高保真動作物理、長鏡頭穩定性與多鏡頭一致性，目標對標 Veo / Sora。",
    strengths: ["物理動作擬真", "長鏡頭穩定", "多鏡頭一致"],
    limitations: ["輸出仍以短片段為主", "高品質模式較慢"],
    useCases: ["寫實短片", "廣告 / 視覺概念", "動作研究"],
    openWeight: false,
    tags: ["寫實影片", "物理擬真"],
    officialUrl: "https://lumalabs.ai/",
    pricing: { unit: "USD / generation 或訂閱", tier: "high" },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["Luma Ray 2 release benchmark"],
    factCheck: { status: "pending", sources: [] },
    capabilities: { streaming: false },
    safetyTier: "medium",
    peers: ["luma-dream-machine", "sora-2", "veo-3", "runway-gen-4"],
  },

  // ── AI Agent 代理模型 ───────────────────────────────────────────────────
  // 這個區塊收錄「以代理（agent）為產品主體」的模型，與傳統「文字模型」分開
  // 排序：代理產品的賣點是「自主完成多步驟任務」而非單次 token 輸出，定價、
  // benchmark 與評測方式都有別。
  {
    id: "claude-code",
    name: "Claude Code",
    apiId: "claude-code",
    provider: "Anthropic",
    modality: "agent",
    tier: "frontier",
    releaseDate: "2025-02",
    tagline: "Anthropic 官方終端代理，跑在 CLI / IDE / Web / 雲端",
    description:
      "Claude Code 是 Anthropic 的官方代理產品，底層由 Claude 4.x 系列驅動，可在終端、VS Code、JetBrains、Web、行動裝置與雲端 GitHub Actions 中執行多步驟程式碼任務（讀檔、編輯、跑測試、開 PR）。內建 Hooks / Skills / SDK 擴充機制。",
    strengths: [
      "深度整合 Git 與 GitHub（自動 commit / push / PR）",
      "可呼叫工具、執行 Bash、讀寫檔案，亦支援 MCP server",
      "Hooks / Skills 自訂自動化",
      "支援 Web / 行動裝置 / GitHub Actions 等遠端執行",
    ],
    limitations: [
      "需綁定 Anthropic API 額度，連續長任務可能高成本",
      "對非程式類任務支援有限",
    ],
    useCases: [
      "程式碼重構與功能開發",
      "PR 自動審查與修補",
      "CI / CD 故障診斷",
      "技術文件補齊",
    ],
    contextWindow: "200K tokens（背後模型決定）",
    openWeight: false,
    tags: ["代理任務", "程式設計", "終端", "Web"],
    featured: true,
    officialUrl: "https://www.anthropic.com/claude-code",
    pricing: {
      unit: "USD / API 用量 + 訂閱",
      note: "依背後 Claude 模型計費（Opus / Sonnet / Haiku 任選）",
      tier: "high",
    },
    availability: {
      api: true,
      web: true,
      selfHost: false,
      notes: "CLI / VS Code / JetBrains / Web / iOS / Android / GitHub Actions",
    },
    researchKeywords: [
      "Claude Code release notes 2026",
      "Claude Code SDK skills hooks",
      "Anthropic agent CLI pricing",
    ],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      visionInput: true,
      functionCalling: true,
      structuredOutput: true,
      streaming: true,
      codeExecution: true,
      webSearch: true,
    },
    safetyTier: "high",
    compliance: ["SOC2", "HIPAA", "GDPR", "ISO27001"],
    peers: [
      "cursor-composer-agent",
      "github-copilot-agent",
      "devin",
      "openai-codex-cli",
    ],
  },
  {
    id: "claude-computer-use",
    name: "Claude Computer Use",
    apiId: "claude-computer-use",
    provider: "Anthropic",
    modality: "agent",
    tier: "frontier",
    releaseDate: "2024-10",
    tagline: "讓 Claude 直接操作滑鼠 / 鍵盤的桌面代理",
    description:
      "Claude Computer Use 是 Anthropic 推出的桌面操作能力，模型可看截圖、移動滑鼠、輸入鍵盤指令，跨任意 GUI 軟體完成任務。屬於 beta，需自行架設 sandbox 環境。",
    strengths: [
      "原生螢幕視覺 + GUI 控制",
      "可在沒有 API 的軟體中執行",
      "與 Claude tool use 一致的開發體驗",
    ],
    limitations: [
      "Beta 階段，可靠度仍在演進",
      "需自行隔離環境，避免誤操作",
      "延遲較高、單次任務成本不低",
    ],
    useCases: [
      "桌面 RPA",
      "舊系統自動化",
      "QA 截圖 / 操作回放",
    ],
    openWeight: false,
    tags: ["桌面代理", "GUI", "RPA", "Beta"],
    featured: true,
    officialUrl: "https://docs.anthropic.com/en/docs/build-with-claude/computer-use",
    pricing: {
      unit: "USD / token（含影像）",
      note: "影像 token 比文字成本高，連續操作可能快速累積",
      tier: "high",
    },
    availability: { api: true, web: false, selfHost: false },
    researchKeywords: [
      "Claude Computer Use beta benchmark",
      "Anthropic computer use OSWorld",
    ],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      visionInput: true,
      functionCalling: true,
      streaming: true,
    },
    safetyTier: "high",
    peers: ["openai-operator", "manus-ai"],
  },
  {
    id: "openai-codex-cli",
    name: "OpenAI Codex CLI",
    apiId: "codex-cli",
    provider: "OpenAI",
    modality: "agent",
    tier: "frontier",
    releaseDate: "2025-04",
    tagline: "OpenAI 官方終端編程代理，底層走 o-系列推理",
    description:
      "Codex CLI 是 OpenAI 2025 推出的開源終端代理（與 ChatGPT 內建 Codex 共用模型），可在本機 sandbox 中讀寫檔案、執行命令並串接 GitHub。預設使用 o-mini / o-series 推理模型。",
    strengths: [
      "開源 (Apache-2.0)",
      "推理模型驅動，可長程規劃",
      "可串接 GitHub PR / Issue",
    ],
    limitations: [
      "需要 ChatGPT Plus / Pro 或 API key",
      "對非 OpenAI 模型支援有限",
    ],
    useCases: ["終端編程代理", "PR 自動化", "腳本 / DevOps 任務"],
    openWeight: true,
    tags: ["代理", "終端", "開源"],
    officialUrl: "https://github.com/openai/codex",
    pricing: {
      unit: "依背後模型 token 計費",
      note: "免費版受限；Plus / Pro 訂閱可享較高用量",
      tier: "medium",
    },
    availability: { api: true, web: true, selfHost: true },
    researchKeywords: [
      "OpenAI Codex CLI release",
      "ChatGPT Codex agent benchmark",
    ],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      functionCalling: true,
      codeExecution: true,
      streaming: true,
    },
    safetyTier: "high",
    peers: ["claude-code", "cursor-composer-agent", "devin"],
  },
  {
    id: "openai-operator",
    name: "OpenAI Operator",
    apiId: "operator",
    provider: "OpenAI",
    modality: "agent",
    tier: "frontier",
    releaseDate: "2025-01",
    tagline: "OpenAI 的瀏覽器代理，可自主完成網頁任務",
    description:
      "Operator 是 OpenAI 推出的瀏覽器代理產品，模型在雲端虛擬瀏覽器中操作網頁 — 訂位、購物、表單填寫、資料收集等。背後模型為 CUA（Computer-Using Agent）。",
    strengths: [
      "雲端瀏覽器 sandbox，安全隔離",
      "原生網頁操作，相容大多數 SaaS",
      "需要授權時自動暫停請使用者確認",
    ],
    limitations: [
      "需 ChatGPT Pro 訂閱",
      "對驗證碼 / 嚴格反爬蟲網站失敗率高",
      "區域限制（部分國家未開放）",
    ],
    useCases: ["購物 / 訂位代辦", "資料抓取", "重複網頁流程自動化"],
    openWeight: false,
    tags: ["瀏覽器代理", "雲端 sandbox"],
    featured: true,
    officialUrl: "https://operator.chatgpt.com/",
    pricing: {
      unit: "USD / 訂閱（ChatGPT Pro）",
      note: "目前綁定 ChatGPT Pro $200/月，後續可能擴張至 API",
      tier: "premium",
    },
    availability: {
      api: false,
      web: true,
      selfHost: false,
      notes: "美國等部分地區優先",
    },
    researchKeywords: [
      "OpenAI Operator benchmark WebArena",
      "ChatGPT Operator pricing",
    ],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      visionInput: true,
      functionCalling: true,
      webSearch: true,
    },
    safetyTier: "high",
    peers: ["claude-computer-use", "manus-ai"],
  },
  {
    id: "github-copilot-agent",
    name: "GitHub Copilot Agent",
    apiId: "copilot-agent",
    provider: "GitHub",
    modality: "agent",
    tier: "frontier",
    releaseDate: "2025-05",
    tagline: "GitHub 原生代理，從 issue 直接交付 PR",
    description:
      "Copilot Agent（Workspace + Agent Mode）讓開發者把 issue 派給 Copilot，代理會自行讀懂專案、寫程式、跑測試、開 PR。背後可選 GPT、Claude、Gemini 等多家模型。",
    strengths: [
      "深度整合 GitHub Issues / PR / Actions",
      "多家模型可選（GPT / Claude / Gemini）",
      "企業 SSO / 稽核完備",
    ],
    limitations: [
      "需要 Copilot 訂閱（個人 / Enterprise）",
      "長程任務仍依賴人類審 PR",
    ],
    useCases: [
      "Issue → PR 自動化",
      "PR 審查與修補",
      "技術債清理",
    ],
    openWeight: false,
    tags: ["代理", "PR 自動化", "GitHub"],
    featured: true,
    officialUrl: "https://github.com/features/copilot",
    pricing: {
      unit: "USD / 訂閱（含代理用量配額）",
      note: "Copilot Pro / Business / Enterprise 等多層級",
      tier: "medium",
    },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: [
      "GitHub Copilot Agent release",
      "Copilot Workspace Coding Agent SWE-bench",
    ],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      functionCalling: true,
      codeExecution: true,
      streaming: true,
    },
    safetyTier: "high",
    compliance: ["SOC2", "ISO27001"],
    peers: ["claude-code", "cursor-composer-agent", "devin", "google-jules"],
  },
  {
    id: "cursor-composer-agent",
    name: "Cursor Composer Agent",
    apiId: "cursor-agent",
    provider: "Cursor",
    modality: "agent",
    tier: "frontier",
    releaseDate: "2025-03",
    tagline: "Cursor IDE 內建代理，整個 repo 級別重構",
    description:
      "Cursor Composer 的 Agent Mode 是 IDE 內建的多檔代理 — 在開發者監督下執行跨檔案重構、新功能落地、bug 修補。預設整合 Claude / GPT / Gemini 任選。",
    strengths: [
      "IDE 內即時 diff 預覽",
      "可任意切換背後模型",
      "對大型 repo 索引快、能聚焦相關檔案",
    ],
    limitations: [
      "Cursor 訂閱才有完整 Agent",
      "Token 用量大，重度使用可能撞月配額",
    ],
    useCases: ["跨檔重構", "新功能撰寫", "Bug 修補"],
    openWeight: false,
    tags: ["IDE 代理", "重構", "多模型"],
    officialUrl: "https://www.cursor.com/",
    pricing: {
      unit: "USD / 訂閱（含模型用量）",
      note: "Pro $20、Business 等",
      tier: "medium",
    },
    availability: { api: false, web: false, selfHost: false, notes: "桌面 IDE" },
    researchKeywords: ["Cursor Composer Agent SWE-bench", "Cursor agent pricing"],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      functionCalling: true,
      codeExecution: true,
      streaming: true,
    },
    safetyTier: "medium",
    peers: ["claude-code", "github-copilot-agent", "devin"],
  },
  {
    id: "devin",
    name: "Devin",
    apiId: "devin-2",
    provider: "Cognition",
    modality: "agent",
    tier: "frontier",
    releaseDate: "2024-03",
    tagline: "Cognition 的自主軟體工程師代理",
    description:
      "Devin 是 Cognition 推出的全自動軟體工程代理，預設提供瀏覽器、終端與長期記憶；可在背景跑數小時的任務、自行除錯、開 PR。Devin 2 起加入多代理協作與更佳的 SWE-bench 表現。",
    strengths: [
      "原生長程任務（hours-scale）",
      "獨立 sandbox + 工具集",
      "Slack / Linear / GitHub 整合",
    ],
    limitations: [
      "企業訂閱定價偏高",
      "對小型 / 新 repo 仍偶有迷路",
    ],
    useCases: [
      "背景跑長任務（migration / 升版）",
      "Bug triage + 修補",
      "技術債清理",
    ],
    openWeight: false,
    tags: ["代理", "SWE", "長程任務"],
    featured: true,
    officialUrl: "https://devin.ai/",
    pricing: {
      unit: "USD / ACU（agent-compute unit）",
      note: "Team $500/月 起，依 ACU 計費",
      tier: "premium",
    },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: [
      "Cognition Devin 2 release",
      "Devin SWE-bench Verified score",
    ],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      functionCalling: true,
      codeExecution: true,
      webSearch: true,
      streaming: true,
    },
    safetyTier: "high",
    compliance: ["SOC2"],
    peers: ["claude-code", "github-copilot-agent", "google-jules"],
  },
  {
    id: "replit-agent",
    name: "Replit Agent",
    apiId: "replit-agent-3",
    provider: "Replit",
    modality: "agent",
    tier: "balanced",
    releaseDate: "2024-09",
    tagline: "Replit 內建代理，從零打造可部署的 App",
    description:
      "Replit Agent 把「Idea → Prototype → 可部署 App」打通成單一對話流程：建立專案結構、撰寫程式、設置資料庫、部署到 Replit 雲端。Agent 3 起支援更長的自主執行與多檔協作。",
    strengths: [
      "Prototype → Deploy 一條龍",
      "內建雲端執行環境（無需自架）",
      "對非工程背景使用者特別友善",
    ],
    limitations: [
      "受限於 Replit 平台架構",
      "對 production 級別系統仍需人類審閱",
    ],
    useCases: ["MVP / Prototype 快速生成", "教學 / 學生專題", "內部小工具"],
    openWeight: false,
    tags: ["代理", "全端", "Prototype"],
    officialUrl: "https://replit.com/agent",
    pricing: {
      unit: "USD / Replit 訂閱 + agent checkpoints",
      note: "Core $20/月 含一定 agent 額度",
      tier: "medium",
    },
    availability: { api: false, web: true, selfHost: false },
    researchKeywords: ["Replit Agent 3 release pricing"],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      functionCalling: true,
      codeExecution: true,
      streaming: true,
    },
    safetyTier: "medium",
    peers: ["cursor-composer-agent", "claude-code", "github-copilot-agent"],
  },
  {
    id: "manus-ai",
    name: "Manus AI",
    apiId: "manus",
    provider: "Manus",
    modality: "agent",
    tier: "frontier",
    releaseDate: "2025-03",
    tagline: "通用任務型代理，雲端虛擬機跑數小時",
    description:
      "Manus 是來自中國團隊的通用型代理產品，可在雲端虛擬機中跑數小時任務 — 從研究、寫報告、做網站到資料分析。主打跨模態工具整合與「主動回報」式介面。",
    strengths: [
      "通用任務廣度（非僅程式碼）",
      "雲端執行，閉手機後仍會持續",
      "可同時開多 session 並行",
    ],
    limitations: [
      "繁中介面但偏簡中思維",
      "資安 / 合規規範相對較新",
    ],
    useCases: [
      "深度研究報告",
      "資料收集 + 圖表",
      "個人助理 / 行程規劃",
    ],
    openWeight: false,
    tags: ["通用代理", "雲端", "多任務"],
    officialUrl: "https://manus.im/",
    pricing: {
      unit: "USD / 訂閱（含 task credits）",
      tier: "medium",
    },
    availability: { api: false, web: true, selfHost: false },
    researchKeywords: ["Manus AI agent benchmark GAIA"],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      visionInput: true,
      functionCalling: true,
      webSearch: true,
      codeExecution: true,
    },
    safetyTier: "medium",
    peers: ["openai-operator", "claude-computer-use", "google-jules"],
  },
  {
    id: "google-jules",
    name: "Google Jules",
    apiId: "jules",
    provider: "Google",
    modality: "agent",
    tier: "balanced",
    releaseDate: "2025-05",
    tagline: "Google 的非同步編程代理，與 GitHub 深度整合",
    description:
      "Jules 是 Google 在 I/O 2025 推出的編程代理，採非同步模式：派任務 → 雲端 sandbox 執行 → 開 PR。底層由 Gemini 系列驅動，主打對既有 repo 的低摩擦接入。",
    strengths: [
      "非同步背景執行，不需開著 IDE",
      "與 GitHub PR 流程零摩擦",
      "Gemini 長脈絡優勢",
    ],
    limitations: [
      "目前 beta，免費額度有限",
      "對非 Google Cloud 部署的 repo 限制較多",
    ],
    useCases: ["背景修 bug", "升版 / 依賴遷移", "測試補齊"],
    openWeight: false,
    tags: ["代理", "非同步", "GitHub"],
    officialUrl: "https://jules.google/",
    pricing: {
      unit: "USD / 月（beta 期間有免費額度）",
      tier: "low",
    },
    availability: { api: false, web: true, selfHost: false },
    researchKeywords: ["Google Jules agent SWE-bench", "Google Jules release"],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      functionCalling: true,
      codeExecution: true,
      streaming: true,
    },
    safetyTier: "high",
    compliance: ["SOC2", "ISO27001"],
    peers: ["github-copilot-agent", "devin", "claude-code"],
  },
  {
    id: "microsoft-copilot-studio",
    name: "Microsoft Copilot Studio",
    apiId: "copilot-studio",
    provider: "Microsoft",
    modality: "agent",
    tier: "balanced",
    releaseDate: "2024-11",
    tagline: "企業端的低程式代理建構器，整合 Microsoft 365",
    description:
      "Copilot Studio 讓企業以低程式方式建構代理：定義工具、知識庫、流程，並佈署到 Teams / Outlook / SharePoint。底層可選 GPT / Phi 等模型。",
    strengths: [
      "與 Microsoft 365 / Power Platform 深度整合",
      "可視化編排 + 角色權限",
      "企業合規完整",
    ],
    limitations: [
      "對非 Microsoft 生態整合較弱",
      "進階用法仍需熟悉 Power Platform",
    ],
    useCases: ["企業內部代理", "客服 / HR 自動化", "知識庫問答"],
    openWeight: false,
    tags: ["低程式", "企業代理", "M365"],
    officialUrl: "https://copilotstudio.microsoft.com/",
    pricing: {
      unit: "USD / 訊息或訂閱",
      note: "依 message-pack 或 M365 套餐定價",
      tier: "medium",
    },
    availability: { api: true, web: true, selfHost: false },
    researchKeywords: ["Microsoft Copilot Studio pricing 2026"],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      functionCalling: true,
      structuredOutput: true,
      webSearch: true,
    },
    safetyTier: "high",
    compliance: ["SOC2", "HIPAA", "GDPR", "ISO27001", "FedRAMP"],
    peers: ["github-copilot-agent", "openai-operator"],
  },
  {
    id: "perplexity-comet",
    name: "Perplexity Comet",
    apiId: "comet",
    provider: "Perplexity",
    modality: "agent",
    tier: "balanced",
    releaseDate: "2025-07",
    tagline: "Perplexity 的 agentic 瀏覽器，搜尋即操作",
    description:
      "Comet 是 Perplexity 推出的 agentic 瀏覽器，把搜尋、研究與網頁操作合而為一。模型可代為比價、整理資料、跨網站填表，並把結果一鍵彙整成報告。",
    strengths: [
      "搜尋 + 操作一體",
      "研究流程加速顯著",
      "與 Perplexity 引用機制原生整合",
    ],
    limitations: [
      "瀏覽器尚未全面開放",
      "對需登入的網站要授權",
    ],
    useCases: ["市場研究", "比價 / 採購", "資料蒐集 + 報告"],
    openWeight: false,
    tags: ["瀏覽器代理", "研究", "搜尋"],
    officialUrl: "https://www.perplexity.ai/comet",
    pricing: {
      unit: "USD / 訂閱（Pro / Max）",
      tier: "medium",
    },
    availability: { api: false, web: true, selfHost: false },
    researchKeywords: ["Perplexity Comet browser launch", "Comet agent benchmark"],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      visionInput: true,
      webSearch: true,
      functionCalling: true,
    },
    safetyTier: "high",
    peers: ["openai-operator", "manus-ai"],
  },
  {
    id: "langgraph-agents",
    name: "LangGraph Agents",
    apiId: "langgraph",
    provider: "LangChain",
    modality: "agent",
    tier: "open-source",
    releaseDate: "2024-06",
    tagline: "建構代理用的開源圖式框架（含託管平台）",
    description:
      "LangGraph 是 LangChain 推出的代理框架，採有向圖 + 狀態機建構多步驟代理工作流；可自架或使用 LangGraph Cloud 託管。生態系成熟，模板與評測工具豐富。",
    strengths: [
      "開源（MIT），自由部署",
      "圖式 + 狀態機，可控且可觀察",
      "LangSmith 配套 tracing / eval",
    ],
    limitations: [
      "需要工程能力，非「即裝即用」產品",
      "效能取決於底層 LLM 選擇",
    ],
    useCases: [
      "自家代理基礎建設",
      "可審計的代理流程",
      "客製化多代理協作",
    ],
    openWeight: true,
    tags: ["框架", "開源", "多代理"],
    officialUrl: "https://www.langchain.com/langgraph",
    pricing: {
      unit: "免費（自架）/ LangGraph Cloud 訂閱",
      note: "自架免費；雲端依執行時數計費",
      tier: "self-host",
    },
    availability: { api: true, web: true, selfHost: true },
    researchKeywords: ["LangGraph release notes", "LangChain agent benchmarks"],
    factCheck: { status: "pending", sources: [] },
    capabilities: {
      functionCalling: true,
      structuredOutput: true,
      streaming: true,
    },
    safetyTier: "medium",
    peers: ["llamaindex", "autogen"],
  },
];

// ─── Helper aggregations ───────────────────────────────────────────────────

export function getUniqueProviders(): ModelProvider[] {
  const set = new Set<ModelProvider>();
  for (const m of AI_MODELS_CATALOG) set.add(m.provider);
  return Array.from(set);
}

export function getModelCountByModality(): Record<ModelModality, number> {
  const counts: Record<ModelModality, number> = {
    text: 0,
    image: 0,
    video: 0,
    audio: 0,
    multimodal: 0,
    embedding: 0,
    agent: 0,
  };
  for (const m of AI_MODELS_CATALOG) counts[m.modality]++;
  return counts;
}

export function getFeaturedModels(): AIModelEntry[] {
  return AI_MODELS_CATALOG.filter(m => m.featured);
}

/** Sort models by release date desc, falling back to name. */
export function sortByLatest<T extends AIModelEntry>(models: T[]): T[] {
  return [...models].sort((a, b) => {
    const ar = a.releaseDate ?? "";
    const br = b.releaseDate ?? "";
    if (ar !== br) return br.localeCompare(ar);
    return a.name.localeCompare(b.name);
  });
}

/**
 * Treat a fact-check as stale once it's older than 60 days.
 *
 * 政策變更（2026-05）：原本 14 天就 stale，導致每天都重抓 64 個模型，常常因
 * Perplexity 節流或 key 缺失爆出「64 個模型驗證失敗」。新政策是：模型一旦
 * 驗證過，2 個月內視為健康；自動研究的重點改為「發現新模型 / 新論文」
 * （discoveryStore），而非反覆 re-validate 已知模型。
 */
export const FACT_CHECK_STALE_DAYS = 60;

export function computeFactCheckStatus(
  current: FactCheckMeta | undefined,
  now: Date = new Date()
): FactCheckStatus {
  if (!current) return "pending";
  if (current.status === "error") return "error";
  if (!current.checkedAt) return current.status;
  const checked = new Date(current.checkedAt);
  if (Number.isNaN(checked.getTime())) return current.status;
  const ageDays = (now.getTime() - checked.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays > FACT_CHECK_STALE_DAYS) return "stale";
  return current.status;
}

/** Merge a baseline entry with auto-research enrichment. The enrichment overrides only the auto-research fields. */
export function mergeEnrichment(
  base: AIModelEntry,
  enrichment: Partial<
    Pick<
      AIModelEntry,
      "pricing" | "benchmarks" | "latestUpdates" | "availability" | "factCheck"
    >
  >
): AIModelEntry {
  return {
    ...base,
    pricing: enrichment.pricing ?? base.pricing,
    benchmarks: enrichment.benchmarks ?? base.benchmarks,
    latestUpdates: enrichment.latestUpdates ?? base.latestUpdates,
    availability: enrichment.availability ?? base.availability,
    factCheck: enrichment.factCheck ?? base.factCheck,
  };
}
