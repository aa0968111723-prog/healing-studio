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
  | "embedding";

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
  | "NVIDIA";

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

/** Treat a fact-check as stale once it's older than 14 days. */
export const FACT_CHECK_STALE_DAYS = 14;

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
