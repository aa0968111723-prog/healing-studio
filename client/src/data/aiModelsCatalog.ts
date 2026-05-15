/**
 * aiModelsCatalog.ts — AI 模型情報專區精選目錄
 *
 * 一份由人工策展的當代主流 AI 模型清單，提供：
 *   - 模型基本資訊（名稱、廠商、版本、發表時間）
 *   - 模態（文字 / 圖片 / 影片 / 音訊 / 多模態）
 *   - 上下文視窗、定價層級
 *   - 強項、弱項、建議使用情境
 *   - 官方連結
 *
 * 此資料為人工維護的策展層，與 news.list（動態新聞）互補。
 * 動態追蹤模型「發表事件」由 IntelBentoGrid 處理；
 * 此清單則用於提供穩定的「目前能用什麼模型」全景圖。
 */

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
  | "Udio";

export type ModelTier = "frontier" | "balanced" | "lightweight" | "open-source";

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
}

// ─── Provider styling ──────────────────────────────────────────────────────

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
};

// ─── Modality styling ──────────────────────────────────────────────────────

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

// ─── Tier styling ──────────────────────────────────────────────────────────

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

// ─── Curated model directory ───────────────────────────────────────────────

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
    limitations: [
      "最複雜的推理仍略遜於 Opus",
      "創意性內容偶爾不如 Opus 細膩",
    ],
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
    strengths: [
      "數學與科學推理 SOTA",
      "程式競賽級水準",
      "邏輯一致性高",
    ],
    limitations: ["延遲非常高，不適合即時互動", "Token 成本高"],
    useCases: ["數學證明", "科學研究", "演算法設計", "複雜決策"],
    contextWindow: "128K tokens",
    openWeight: false,
    tags: ["推理", "科學", "數學"],
    officialUrl: "https://openai.com/o1",
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
    strengths: [
      "Prompt 遵循度高",
      "文字渲染品質穩定",
      "整合於 ChatGPT 易用",
    ],
    limitations: [
      "風格多樣性不及 Midjourney",
      "細節控制較難（無 LoRA 概念）",
    ],
    useCases: ["商業插畫", "概念草圖", "對話式創作"],
    openWeight: false,
    tags: ["文生圖", "對話迭代"],
    officialUrl: "https://openai.com/dall-e-3",
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
    strengths: [
      "場景連續性業界頂尖",
      "物理動態合理",
      "長片段穩定",
    ],
    limitations: [
      "生成成本與時間高",
      "細節控制工具尚有限",
    ],
    useCases: ["故事板與分鏡", "概念影片", "短片創作"],
    openWeight: false,
    tags: ["文生影片", "高擬真"],
    featured: true,
    officialUrl: "https://openai.com/sora",
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
    strengths: [
      "鏡頭語言豐富（推拉搖移）",
      "4K 解析度輸出",
      "物理一致性強",
    ],
    limitations: ["生成成本高", "目前可用配額受限"],
    useCases: ["電影分鏡", "高品質宣傳影片"],
    openWeight: false,
    tags: ["文生影片", "4K", "電影感"],
    officialUrl: "https://deepmind.google/technologies/veo/",
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
    useCases: [
      "需要資料主權的企業部署",
      "客製化微調",
      "研究與學術用途",
    ],
    contextWindow: "128K tokens",
    openWeight: true,
    tags: ["開源", "可部署", "可微調"],
    featured: true,
    officialUrl: "https://llama.meta.com/",
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
    strengths: [
      "性價比業界頂尖",
      "程式碼與數學能力強",
      "完全開源可商用",
    ],
    limitations: ["中文文化細節仍有改進空間", "生態系仍在發展"],
    useCases: ["低預算企業部署", "程式碼助手", "教學研究"],
    contextWindow: "128K tokens",
    openWeight: true,
    tags: ["開源", "高 CP 值", "程式碼"],
    featured: true,
    officialUrl: "https://www.deepseek.com/",
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
    strengths: [
      "開源推理模型先驅",
      "數學與邏輯題強",
      "可自行微調思考鏈",
    ],
    limitations: ["延遲偏高（要思考）", "創意性輸出較弱"],
    useCases: ["邏輯推理應用", "數學競賽輔助", "可解釋 AI 研究"],
    contextWindow: "64K tokens",
    openWeight: true,
    tags: ["推理", "開源", "思考鏈"],
    officialUrl: "https://www.deepseek.com/",
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
    strengths: [
      "原生即時資訊源",
      "個性化人設明顯",
      "推理能力競爭力強",
    ],
    limitations: ["公開 API 仍在開放中", "需 X Premium 訂閱"],
    useCases: ["即時新聞分析", "社群輿情研究"],
    contextWindow: "128K tokens",
    openWeight: false,
    tags: ["即時資訊", "推理"],
    officialUrl: "https://x.ai/",
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
    strengths: [
      "藝術風格業界頂尖",
      "光影氛圍細膩",
      "社群分享文化活躍",
    ],
    limitations: ["僅透過 Discord / Web 使用", "無公開 API（需第三方）"],
    useCases: ["概念藝術", "視覺設計", "創意探索"],
    openWeight: false,
    tags: ["藝術", "風格化", "創意"],
    featured: true,
    officialUrl: "https://www.midjourney.com/",
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
    strengths: [
      "Prompt 遵循度業界頂尖",
      "文字渲染品質高",
      "提供 dev 開源版本",
    ],
    limitations: ["商用版本（Pro）需付費 API"],
    useCases: ["商業設計", "需高 prompt 控制的應用"],
    openWeight: false,
    tags: ["文生圖", "高遵循度"],
    officialUrl: "https://blackforestlabs.ai/",
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
    useCases: [
      "個人創作（離線）",
      "LoRA 訓練客製化角色",
      "ComfyUI 工作流",
    ],
    openWeight: true,
    tags: ["開源", "LoRA 生態", "可本地"],
    officialUrl: "https://stability.ai/",
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
    strengths: [
      "創意特效預設豐富",
      "介面易上手",
      "適合社群短片",
    ],
    limitations: ["寫實感不及 Sora / Veo", "高解析度片段較少"],
    useCases: ["TikTok / Reels 短片", "趣味視覺效果"],
    openWeight: false,
    tags: ["短片", "特效", "易用"],
    officialUrl: "https://pika.art/",
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
    strengths: [
      "音色擬真度業界頂尖",
      "32+ 語言支援",
      "音色複製只需短樣本",
    ],
    limitations: ["音色複製有倫理疑慮（已加 watermark）"],
    useCases: ["有聲書", "Podcast 配音", "多語影片配音", "遊戲 NPC"],
    openWeight: false,
    tags: ["TTS", "音色複製", "多語"],
    featured: true,
    officialUrl: "https://elevenlabs.io/",
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
    strengths: [
      "完整歌曲一鍵生成",
      "人聲擬真度高",
      "多曲風支援",
    ],
    limitations: ["商用授權需訂閱方案", "細節編輯有限"],
    useCases: ["音樂創作初稿", "影片配樂", "個人創作"],
    openWeight: false,
    tags: ["音樂", "歌詞", "完整歌曲"],
    officialUrl: "https://suno.com/",
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
export function sortByLatest(models: AIModelEntry[]): AIModelEntry[] {
  return [...models].sort((a, b) => {
    const ar = a.releaseDate ?? "";
    const br = b.releaseDate ?? "";
    if (ar !== br) return br.localeCompare(ar);
    return a.name.localeCompare(b.name);
  });
}
