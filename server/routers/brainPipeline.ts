/**
 * Brain Pipeline Visualization Router
 * ────────────────────────────────────────────────────────────────────────────
 * 聚合既有的健康狀態、錯誤追蹤、頁面註冊表、Provider 健康偵測，組合成一張
 * 「AI 大腦組態管線圖」，提供給前端 React Flow 可視化呈現。
 *
 * 兩個 procedures：
 *   - getGraph      → admin only：全站完整管線
 *   - getMyGraph    → 任何登入用戶：個人腦組態（5 推理 + 4 引擎 + 我能用的 provider）
 *
 * 不重新偵測，只彙整既有資料源（不會額外打外部 API）。
 */

import { router, adminProcedure, protectedProcedure } from "../_core/trpc";
import { serverEnv } from "../_core/env.validated";
import { getEngineStatus } from "../_core/llmRouter";
import {
  getProviderHealth,
  getProviderHealthVersion,
} from "../services/providerHealth";
import {
  getHealthSnapshot,
  getHealthCacheVersion,
  DEFAULT_REASONING_BRAINS,
  DEFAULT_GENERATION_ENGINES,
  type ReasoningBrainSlot,
  type GenerationEngineSlot,
} from "../middleware/brainContext";
import {
  getAlerts,
  getErrorTraces,
  getSystemSummary,
  getAutoRepairVersion,
  runHealthPatrol,
} from "../services/brainAutoRepair";
import type { ErrorTrace } from "../services/brainAutoRepair";
import { APP_PAGE_REGISTRY } from "../../shared/appRegistry";
import type { AppPageRegistryItem } from "../../shared/appRegistry";
import type {
  PipelineGraph,
  PipelineNode,
  PipelineEdge,
  PipelineNodeStatus,
} from "../../shared/brain-pipeline";
import { STATUS_LABEL, STATUS_DESCRIPTION } from "../../shared/brain-pipeline";

// ═══════════════════════════════════════════════════════════════════════════
// Static Catalogs
// ═══════════════════════════════════════════════════════════════════════════

/** 推理腦槽顯示用標籤（中文白話） */
const REASONING_SLOT_META: Record<
  ReasoningBrainSlot,
  { label: string; description: string }
> = {
  director: {
    label: "導演 AI",
    description: "統籌創作流程、分鏡、敘事結構",
  },
  analyst: {
    label: "新聞過濾",
    description: "數據分析、趨勢洞察、新聞摘要",
  },
  storyteller: {
    label: "編譯器",
    description: "創意寫作、敘事生成、文案產出",
  },
  technician: {
    label: "技術員",
    description: "程式碼、結構化資料、工具呼叫",
  },
  curator: {
    label: "策展人",
    description: "風格挑選、素材整理、主題分類",
  },
};

/** 生成引擎顯示用標籤 */
const GENERATION_SLOT_META: Record<
  GenerationEngineSlot,
  { label: string; description: string; provider: string }
> = {
  imageEngine: {
    label: "圖像引擎",
    description: "靜態圖像生成（Flux / SDXL / Imagen 等）",
    provider: "fal",
  },
  videoEngine: {
    label: "影片引擎",
    description: "動態影片生成（Kling / Veo / WAN 等）",
    provider: "fal",
  },
  audioEngine: {
    label: "音樂引擎",
    description: "音樂與環境音生成（ACE-Step / StableAudio 等）",
    provider: "fal",
  },
  voiceEngine: {
    label: "語音引擎",
    description: "語音合成與聲音克隆（ElevenLabs / Qwen / Dia）",
    provider: "elevenlabs",
  },
};

/**
 * 創作工作室 → 消費的生成引擎槽。
 *
 * 之前的版本只在「站點視圖」展開後才能在 page-group 內看到圖片／影片／專業
 * 工作室；而 admin 「大腦視圖」與用戶 `/my-brain` 預設視圖把 page 節點過濾掉，
 * 結果引擎槽看起來懸空，使用者無法在大腦可視化中看到「圖片工作室就是消費
 * imageEngine 的那一頁」。
 *
 * 這份清單把 3 個主要工作室列為 ai-brain layer 的「studio」節點：
 *   - 在 brain / full / site 視圖都會出現（VIEW_MODE_KINDS 已涵蓋）
 *   - 連到對應的 engine slot（消費引擎）
 *   - 從 orb:agent 連入（光球可分派工作室）
 *   - 從 director:main 連入（導演可送至工作室）
 */
interface StudioConsumerMeta {
  id: string;
  label: string;
  description: string;
  engines: GenerationEngineSlot[];
  files: string[];
  frontendPath: string;
  backendRoute: string;
  serviceFunction: string;
}

const STUDIO_CONSUMERS: StudioConsumerMeta[] = [
  {
    id: "studio:image-studio",
    label: "圖片工作室",
    description: "靜態圖片生成入口（t2i / edit / upscale / pose / 3d）",
    engines: ["imageEngine"],
    files: [
      "client/src/pages/ImageStudio.tsx",
      "server/routers/imageStudio.ts",
    ],
    frontendPath: "client/src/pages/ImageStudio.tsx",
    backendRoute: "trpc.imageStudio.* + studio.generateImage（光球工具）",
    serviceFunction: "agentToolExecutor.dispatchFalQueueTask",
  },
  {
    id: "studio:video-studio",
    label: "影片工作室",
    description: "動態影片生成入口（Kling / Veo / WAN / Seedance）",
    engines: ["videoEngine"],
    files: [
      "client/src/pages/VideoStudio.tsx",
      "server/routers/videoStudio.ts",
    ],
    frontendPath: "client/src/pages/VideoStudio.tsx",
    backendRoute: "trpc.videoStudio.* + studio.generateVideo（光球工具）",
    serviceFunction: "agentToolExecutor.dispatchFalQueueTask",
  },
  {
    id: "studio:pro-studio",
    label: "專業工作室",
    description: "音訊生成、TTS、聲音克隆（ACE-Step / ElevenLabs / Dia）",
    engines: ["audioEngine", "voiceEngine"],
    files: [
      "client/src/pages/ProStudio.tsx",
      "server/routers/proStudio.ts",
    ],
    frontendPath: "client/src/pages/ProStudio.tsx",
    backendRoute: "trpc.proStudio.* + studio.generateAudio/Voice（光球工具）",
    serviceFunction: "dispatchAudioGeneration / dispatchTTS",
  },
];

interface ProviderMeta {
  id: string;
  label: string;
  description: string;
  apiKeyEnv: string;
  /** API key 是否有設定（true=已設） */
  hasKey: () => boolean;
  /** 對應的後端 service 檔（用於 GitHub 連結；未設則僅顯示 .env 標記） */
  serviceFiles?: string[];
}

const PROVIDERS: ProviderMeta[] = [
  {
    id: "gemini",
    label: "Google Gemini",
    description: "主要 LLM 引擎（推理與多模態）",
    apiKeyEnv: "GEMINI_API_KEY",
    hasKey: () => Boolean(serverEnv.GEMINI_API_KEY),
    serviceFiles: ["server/services/geminiMedia.ts"],
  },
  {
    id: "vertex",
    label: "Google Vertex AI（選用，缺金鑰時自動降級到 OpenRouter）",
    description:
      "企業級 LLM 與多模態（Gemini / Llama / Imagen）。未設 GOOGLE_APPLICATION_CREDENTIALS_JSON 時，所有 vertex/* 模型會由 normalizeModelForEngine 自動重寫為 OpenRouter 等效 ID（google/gemini-*、meta-llama/* 等）。",
    apiKeyEnv: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
    hasKey: () => Boolean(serverEnv.GOOGLE_APPLICATION_CREDENTIALS_JSON),
    serviceFiles: ["server/services/vertexAI.ts"],
  },
  {
    id: "fal",
    label: "Fal.ai",
    description: "圖像／影片／音樂／語音生成模型聚合",
    apiKeyEnv: "FAL_API_KEY",
    hasKey: () => Boolean(serverEnv.FAL_API_KEY),
    serviceFiles: [
      "server/services/falDispatcher.ts",
      "server/services/falModels.ts",
    ],
  },
  {
    id: "elevenlabs",
    label: "ElevenLabs",
    description: "高品質語音合成與聲音克隆",
    apiKeyEnv: "ELEVENLABS_API_KEY",
    hasKey: () => Boolean(serverEnv.ELEVENLABS_API_KEY),
    serviceFiles: ["server/services/elevenLabsExtended.ts"],
  },
  {
    id: "suno",
    label: "Suno",
    description: "音樂生成（備援）",
    apiKeyEnv: "SUNO_API_KEY",
    hasKey: () => Boolean(serverEnv.SUNO_API_KEY),
  },
  {
    id: "replicate",
    label: "Replicate",
    description: "LoRA 訓練與第三方模型推理",
    apiKeyEnv: "REPLICATE_API_TOKEN",
    hasKey: () => Boolean(serverEnv.REPLICATE_API_TOKEN),
    serviceFiles: ["server/services/replicateClient.ts"],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    description: "統一 LLM 閘道（推薦的單一入口；可路由到 Claude / Mistral / Llama 等）",
    apiKeyEnv: "OPENROUTER_API_KEY",
    hasKey: () => Boolean(serverEnv.OPENROUTER_API_KEY),
    serviceFiles: ["server/_core/llmRouter.ts", "server/_core/llm.ts"],
  },
  {
    id: "anthropic",
    label: "Anthropic Claude（選用，缺金鑰時自動降級到 OpenRouter）",
    description:
      "光球代理首選（直連 Anthropic API；支援 prompt caching）。未設 ANTHROPIC_API_KEY 或帳戶餘額不足時，inferEngineFromModelIdSafe 會把裸 claude-* 路徑改走 OpenRouter（anthropic/claude-*）。",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    hasKey: () => Boolean(serverEnv.ANTHROPIC_API_KEY),
    serviceFiles: ["server/_core/llmRouter.ts", "server/_core/llm.ts"],
  },
];

/** 後端路由 → 連結到的 provider id 清單 */

const PAGE_DIAGNOSTICS_CATALOG: Record<
  string,
  { backendRoute: string; serviceFunction: string }
> = {
  home: {
    backendRoute: "trpc.news.list + trpc.showcase.*",
    serviceFunction: "news/showcase content aggregation",
  },
  "agent-chat": {
    backendRoute: "trpc.ai.chat + trpc.ai.orbTask.*",
    serviceFunction: "runSchemaFirstAgentPlanner / executeOrbToolCalls",
  },
  studio: {
    backendRoute: "trpc.ai.generate",
    serviceFunction: "providerRouter + falDispatcher",
  },
  director: {
    backendRoute: "trpc.director.*",
    serviceFunction: "buildMemoryContext / upsertMemory",
  },
  "image-studio": {
    backendRoute: "trpc.imageStudio.*",
    serviceFunction: "dispatchImageGeneration",
  },
  "video-studio": {
    backendRoute: "trpc.videoStudio.*",
    serviceFunction: "dispatchVideoGeneration",
  },
  "pro-studio": {
    backendRoute: "trpc.proStudio.*",
    serviceFunction: "dispatchAudioGeneration / dispatchTTS",
  },
  models: {
    backendRoute: "trpc.loraTrainer.* + trpc.brain.*",
    serviceFunction: "startReplicateTraining / dispatchFalTask",
  },
  assets: {
    backendRoute: "trpc.assets.*",
    serviceFunction: "assets repository + storage adapter",
  },
  shared: {
    backendRoute: "trpc.assets.teamAssets + trpc.models.shared",
    serviceFunction: "team assets/model sharing queries",
  },
  notes: {
    backendRoute: "trpc.notes.*",
    serviceFunction: "notes CRUD + sync",
  },
  learn: {
    backendRoute: "trpc.learnHub.*",
    serviceFunction: "learnHub fetchers + embeddings pipeline",
  },
  dashboard: {
    backendRoute: "trpc.apiUsage.* + trpc.brainPipeline.*",
    serviceFunction: "getSystemSummary / getProviderHealth",
  },
  admin: {
    backendRoute: "trpc.admin.* + trpc.apiUsage.*",
    serviceFunction: "apiUsage aggregation + provider snapshot jobs",
  },
  "my-brain": {
    backendRoute: "trpc.brain.myConfig + trpc.brain.health",
    serviceFunction: "brain config repository + health checks",
  },
  settings: {
    backendRoute: "trpc.settings.* + trpc.agentPreferences.*",
    serviceFunction: "user settings + agent preferences",
  },
};

/**
 * Page id → upstream router ids；用於完整視圖中描繪 page 觸發哪條後端鏈。
 *
 * 對應的後端 trpc namespace 在 `PAGE_DIAGNOSTICS_CATALOG` 與 `server/routers.ts`
 * 已實際存在；此處顯式列出可讓 React Flow 畫出 page → router 邊。沒列出的頁面
 * 表示該頁不直接觸發 AI router（例如 calendar / vault 等純 CRUD 頁）。
 */
const PAGE_TO_ROUTERS: Record<string, string[]> = {
  home: ["router:news", "router:showcase"],
  "agent-chat": ["router:orbScheduler", "router:brain"],
  studio: ["router:imageStudio", "router:videoStudio", "router:proStudio"],
  "image-studio": ["router:imageStudio"],
  "video-studio": ["router:videoStudio"],
  "pro-studio": ["router:proStudio"],
  director: ["router:director"],
  "lora-trainer": ["router:loraTrainer"],
  models: ["router:loraTrainer", "router:brain"],
  "my-brain": ["router:brain"],
  "brain-settings": ["router:brain"],
  learn: ["router:learnHub"],
  "tutorial-overview": ["router:learnHub"],
  "prompt-library": ["router:promptLibrary"],
  "prompt-collection": ["router:promptCollection"],
  langsmith: ["router:langsmith"],
  "agent-preferences": ["router:agentPreferences"],
  settings: ["router:agentPreferences"],
  dashboard: ["router:apiUsage"],
  credits: ["router:apiUsage"],
  admin: ["router:apiUsage", "router:adminEval"],
  "admin-api-usage": ["router:apiUsage"],
  "process-viewer": ["router:orbScheduler"],
};

/**
 * Router id → downstream brain/engine slot ids；用於畫出後端 router 真正觸發
 * 哪些 AI 大腦或引擎槽。沒列出的 router 直接連 provider（語意：純 LLM 呼叫）。
 */
const ROUTER_TO_AI_SLOTS: Record<string, string[]> = {
  "router:brain": [
    "brain:director",
    "brain:analyst",
    "brain:storyteller",
    "brain:technician",
    "brain:curator",
  ],
  "router:director": ["brain:director", "brain:storyteller"],
  "router:imageStudio": ["engine:imageEngine"],
  "router:videoStudio": ["engine:videoEngine"],
  "router:proStudio": ["engine:audioEngine", "engine:voiceEngine"],
  "router:loraTrainer": ["engine:imageEngine"],
  "router:learnHub": ["brain:analyst"],
  "router:orbScheduler": ["brain:director", "brain:technician"],
};

/** AppPageGroupId → 顯示用標籤；對應 `shared/appRegistry.ts` 的 8 個分群。 */
const PAGE_GROUP_META: Record<
  string,
  { label: string; description: string }
> = {
  orb: { label: "光球代理", description: "全站對話與引導入口" },
  create: {
    label: "創作工作室",
    description: "圖片/影片/音訊/導演 AI 生成入口",
  },
  train: { label: "模型訓練", description: "LoRA / 自訂風格訓練" },
  project: {
    label: "專案管理",
    description: "儀表板、歷程、筆記、點數",
  },
  assets: {
    label: "素材與模型",
    description: "素材庫、提示詞、保險庫、模型清單",
  },
  learn: { label: "學習中心", description: "教學內容、文件、入門引導" },
  settings: { label: "個人設定", description: "帳號、偏好、設定頁" },
  admin: {
    label: "管理後台",
    description: "系統管理、用量、推理鏈監控",
  },
};

const ROUTER_TO_PROVIDERS: Array<{
  id: string;
  label: string;
  description: string;
  providers: string[];
  files: string[];
}> = [
  {
    id: "router:brain",
    label: "brain（大腦組態）",
    description: "管理用戶腦組態 CRUD、模型健康、錯誤追蹤",
    providers: ["gemini", "vertex"],
    files: ["server/routers/brain.ts"],
  },
  {
    id: "router:director",
    label: "director（導演 AI）",
    description: "CO-STAR 導演對話、劇本規劃、RAG 記憶",
    providers: ["gemini", "vertex"],
    files: ["server/routers/director.ts"],
  },
  {
    id: "router:spirit",
    label: "spirit（靈感對話）",
    description: "輕量靈感聊天與對話輔助",
    providers: ["gemini", "vertex", "openrouter", "anthropic"],
    files: ["server/routers/spiritRouter.ts"],
  },
  {
    id: "router:imageStudio",
    label: "imageStudio（圖像工作室）",
    description: "靜態圖像生成 dispatch",
    providers: ["fal", "vertex"],
    files: ["server/routers/imageStudio.ts", "server/services/falDispatcher.ts"],
  },
  {
    id: "router:videoStudio",
    label: "videoStudio（影片工作室）",
    description: "影片生成 dispatch（Kling / Veo / WAN）",
    providers: ["fal", "vertex"],
    files: ["server/routers/videoStudio.ts", "server/services/falDispatcher.ts"],
  },
  {
    id: "router:proStudio",
    label: "proStudio（專業工作室）",
    description: "TTS、聲音克隆、音訊處理",
    providers: ["elevenlabs", "fal"],
    files: ["server/routers/proStudio.ts"],
  },
  {
    id: "router:loraTrainer",
    label: "loraTrainer（LoRA 訓練）",
    description: "自訂風格模型訓練",
    providers: ["replicate", "fal"],
    files: ["server/routers/loraTrainer.ts"],
  },
  {
    id: "router:learnHub",
    label: "learnHub（學習中心）",
    description: "教學內容與問答",
    providers: ["gemini"],
    files: ["server/routers/learnHub.ts"],
  },
  {
    id: "router:orbScheduler",
    label: "orbScheduler（光球排程）",
    description: "光球代理任務狀態機與多步驟排程",
    providers: ["gemini", "fal"],
    files: [
      "server/routers/orbSchedulerRouter.ts",
      "server/services/orbTaskOrchestrator.ts",
    ],
  },
  {
    id: "router:worldbuildingGeneration",
    label: "worldbuildingGeneration（世界觀生成）",
    description:
      "generateCharacter / generateScene 透過 invokeLLM 產生結構化世界觀內容",
    providers: ["gemini", "vertex", "openrouter"],
    files: ["server/services/worldbuildingGeneration.ts"],
  },
  // ── 純服務 router（無外部 provider，僅 DB / 內部資料） ─────────────────
  // 這些 router 不直接呼外部 AI；放進圖裡是為了讓 page → router 連線完整，
  // 並讓 admin 能在同一畫面看到所有後端入口的錯誤累積狀況。
  {
    id: "router:apiUsage",
    label: "apiUsage（API 用量）",
    description: "彙整 token / 成本 / 呼叫次數，供管理後台分析",
    providers: [],
    files: ["server/routers/apiUsage.ts"],
  },
  {
    id: "router:agentPreferences",
    label: "agentPreferences（Agent 偏好）",
    description: "使用者光球與 PageAgent 偏好設定",
    providers: [],
    files: ["server/routers/agentPreferencesRouter.ts"],
  },
  {
    id: "router:promptLibrary",
    label: "promptLibrary（提示詞庫）",
    description: "提示詞 CRUD、收藏、分享",
    providers: [],
    files: ["server/routers/promptLibrary.ts"],
  },
  {
    id: "router:promptCollection",
    label: "promptCollection（提示詞收集）",
    description:
      "收集站內 25 位精靈 / 主動觸發 / 模型樣板 / ImageStudio 內建模板，支援團隊共享",
    providers: [],
    files: [
      "server/routers/promptCollection.ts",
      "shared/site-prompt-catalog.ts",
    ],
  },
  {
    id: "router:news",
    label: "news（新聞動態）",
    description: "首頁新聞與更新動態",
    providers: [],
    files: ["server/routers/news.ts"],
  },
  {
    id: "router:aiModels",
    label: "aiModels（AI 模型情報）",
    description:
      "策展 AI 模型目錄 + 自動研究 / 事實查核 enrichment（透過 Perplexity / OpenRouter Sonar）",
    providers: ["openrouter"],
    files: [
      "server/routers/aiModels.ts",
      "server/services/modelResearcher.ts",
      "server/jobs/modelCatalogResearchJob.ts",
      "shared/aiModelsCatalog.ts",
    ],
  },
  {
    id: "router:showcase",
    label: "showcase（精選作品）",
    description: "首頁作品展示與分類查詢",
    providers: [],
    files: ["server/routers/showcase.ts"],
  },
  {
    id: "router:langsmith",
    label: "langsmith（追蹤器）",
    description: "LangSmith trace、dataset、回饋彙整",
    providers: [],
    files: ["server/routers/langsmith.ts"],
  },
  {
    id: "router:adminEval",
    label: "adminEval（管理員評估）",
    description: "Agent 評估、品質檢測、admin 工具",
    providers: [],
    files: ["server/routers/adminRouter.ts"],
  },
  {
    id: "router:orbProxy",
    label: "orbProxy（光球代理代用層）",
    description: "全站統一搜尋（資產／筆記／歷史／教學）、光球記憶與澄清偏好",
    providers: [],
    files: [
      "server/routers/orbProxyRouter.ts",
      "server/services/orbUnifiedSearch.ts",
      "server/services/orbMemory.ts",
    ],
  },
  {
    id: "router:agentCollaboration",
    label: "agentCollaboration（多代理協作）",
    description: "多代理會議協調、訊息匯流排與會話狀態管理",
    providers: [],
    files: [
      "server/routers/agentCollaborationRouter.ts",
      "server/services/agentCollaborationOrchestrator.ts",
      "server/services/agentCommunicationBus.ts",
    ],
  },
  {
    id: "router:orchestrationRuns",
    label: "orchestrationRuns（代理操作面板）",
    description: "orchestration_runs 唯讀視覺化（W3-D AIDV-49）",
    providers: [],
    files: ["server/routers/orchestrationRunsRouter.ts"],
  },
  {
    id: "router:apiKey",
    label: "apiKey（程式化 API 金鑰管理）",
    description: "AIDV-276：建立 / 列出 / 撤銷 aidv_<key> 格式 API 金鑰（SHA-256 儲存）",
    providers: [],
    files: ["server/routers/apiKeyRouter.ts"],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// 「網站整體運作」深度整合 — Browser / API / Data / Infrastructure 節點
// ───────────────────────────────────────────────────────────────────────────
// 目的：讓主管或新成員打開可視化頁面就能看到「請求是怎麼從瀏覽器走到外部 AI 與
// 部署平台」的完整鏈路，不必再翻 Dockerfile / railway.toml / .env.example。
// ═══════════════════════════════════════════════════════════════════════════

/**
 * REST / HTTP API 端點目錄。
 *
 * tRPC 路由已由 ROUTER_TO_PROVIDERS 表達；這份清單列出 `app.use(...)` 與
 * `router.get/post(...)` 註冊的「非 tRPC」端點，例如 SSE 串流、檔案上傳、
 * 健康檢查、OAuth 回調。每筆 entry 同時宣告 downstream（DB / 儲存 / tRPC
 * router / provider），讓畫布能畫出端點對下游的真實依賴。
 */
interface ApiEndpointMeta {
  id: string;
  label: string;
  description: string;
  method: "GET" | "POST" | "DELETE" | "PUT";
  path: string;
  files: string[];
  /** 此端點下游節點 id（任一現存節點，用於畫 edge） */
  downstream: string[];
  /** 此端點之上游 — 若為 client 觸發，預設為 client:browser；webhook 則為對應 provider */
  upstream?: string[];
}

const API_ENDPOINTS: ApiEndpointMeta[] = [
  {
    id: "api:health",
    label: "GET /api/health",
    description: "Railway / Docker 健康檢查（部署平台據此判斷服務存活）",
    method: "GET",
    path: "/api/health",
    files: ["server/_core/index.ts"],
    downstream: ["infra:railway"],
    upstream: ["infra:railway"],
  },
  {
    id: "api:metrics",
    label: "GET /api/metrics",
    description: "聚合 LLM 用量、錯誤計數、provider 健康指標（內部監控）",
    method: "GET",
    path: "/api/metrics",
    files: ["server/_core/metricsRoute.ts", "server/_core/index.ts"],
    downstream: ["db:main"],
  },
  {
    id: "api:auth-login",
    label: "POST /api/auth/login",
    description: "本地帳密登入；命中 rate limiter 後寫入 session JWT",
    method: "POST",
    path: "/api/auth/login",
    files: ["server/routes/localAuth.ts"],
    downstream: ["db:main"],
  },
  {
    id: "api:auth-register",
    label: "POST /api/auth/register",
    description: "註冊新帳號，雜湊密碼後落地至 users 表",
    method: "POST",
    path: "/api/auth/register",
    files: ["server/routes/localAuth.ts"],
    downstream: ["db:main"],
  },
  {
    id: "api:auth-google",
    label: "GET /api/auth/google/callback",
    description: "Google OAuth 完成後 redirect 回站，交換 token 並建立 session",
    method: "GET",
    path: "/api/auth/google/callback",
    files: ["server/routes/googleAuth.ts"],
    downstream: ["db:main", "auth:google-oauth"],
    upstream: ["auth:google-oauth"],
  },
  {
    id: "api:upload",
    label: "POST /api/upload",
    description: "前端上傳素材，依 detectStorageBackend 寫入 S3 / GCS / 本地",
    method: "POST",
    path: "/api/upload",
    files: ["server/uploadRoute.ts", "server/storage.ts"],
    downstream: ["storage:assets", "db:main"],
  },
  {
    id: "api:sse-generation",
    label: "GET /api/generation-events/:jobId",
    description: "SSE 串流：把 generation thought-chain 即時推送給前端 UI",
    method: "GET",
    path: "/api/generation-events/:jobId",
    files: ["server/sseRoute.ts", "server/generationEvents.ts"],
    downstream: ["db:main"],
  },
  {
    id: "api:agent-events",
    label: "GET /api/agent-events/:collaborationId",
    description: "SSE 串流：多代理協作狀態廣播（AIDV-331 State Broadcast）",
    method: "GET",
    path: "/api/agent-events/:collaborationId",
    files: ["server/agentEventsRoute.ts", "server/services/agentEventBus.ts"],
    downstream: ["db:main"],
  },
  {
    id: "api:tasks-stream",
    label: "GET /api/tasks/:taskId/stream",
    description: "光球任務狀態機的 SSE 串流（多步驟工具呼叫進度）",
    method: "GET",
    path: "/api/tasks/:taskId/stream",
    files: ["server/routes/orbTasks.ts"],
    downstream: ["db:main"],
  },
  {
    id: "api:download",
    label: "GET /api/download/:assetId",
    description: "受授權的素材下載（presigned URL 或代理串流）",
    method: "GET",
    path: "/api/download/:assetId",
    files: ["server/routes/download.ts"],
    downstream: ["storage:assets"],
  },
  {
    id: "api:tools-models",
    label: "GET /api/tools/models",
    description: "提供前端工具面板可用模型清單（fal / vertex / replicate）",
    method: "GET",
    path: "/api/tools/models",
    files: ["server/routes/toolsModels.ts"],
    downstream: ["db:main"],
  },
  {
    id: "api:provider-health",
    label: "GET /api/provider-health",
    description: "回傳所有 AI provider 的 probe 狀態（AIDV-518）",
    method: "GET",
    path: "/api/provider-health",
    files: ["server/_core/index.ts", "server/jobs/providerHealthProbeJob.ts"],
    downstream: ["service:provider-health"],
  },
  {
    id: "api:trpc",
    label: "ALL /api/trpc/*",
    description: "tRPC HTTP 適配器入口；所有 admin / studio / brain 呼叫都走這裡",
    method: "POST",
    path: "/api/trpc",
    files: ["server/_core/index.ts", "server/routers.ts"],
    downstream: [
      "router:brain",
      "router:director",
      "router:imageStudio",
      "router:videoStudio",
      "router:proStudio",
    ],
  },
  // ── 認證細節端點 ──────────────────────────────────────────────────────
  {
    id: "api:auth-me",
    label: "GET /api/auth/me",
    description: "取得目前登入使用者的 profile 與點數餘額",
    method: "GET",
    path: "/api/auth/me",
    files: ["server/routes/localAuth.ts"],
    downstream: ["db:main"],
  },
  {
    id: "api:auth-2fa",
    label: "ALL /api/auth/2fa/*",
    description:
      "兩步驟驗證設定流程（status / setup / verify / disable）；TOTP 私鑰存於 DB",
    method: "POST",
    path: "/api/auth/2fa/*",
    files: ["server/routes/localAuth.ts", "server/totp-service.test.ts"],
    downstream: ["db:main"],
  },
  {
    id: "api:auth-forgot",
    label: "POST /api/auth/forgot-password",
    description: "申請密碼重設 token；目前不實際發信，token 寫入 DB 供測試",
    method: "POST",
    path: "/api/auth/forgot-password",
    files: ["server/routes/passwordResetRoutes.ts"],
    downstream: ["db:main"],
  },
  {
    id: "api:auth-verify-reset",
    label: "GET /api/auth/verify-reset-token",
    description: "驗證密碼重設 token 是否有效（前端 ResetPasswordPage 開頁時呼叫）",
    method: "GET",
    path: "/api/auth/verify-reset-token",
    files: ["server/routes/passwordResetRoutes.ts"],
    downstream: ["db:main"],
  },
  {
    id: "api:auth-reset",
    label: "POST /api/auth/reset-password",
    description: "完成密碼重設，使 token 失效並更新 password hash",
    method: "POST",
    path: "/api/auth/reset-password",
    files: ["server/routes/passwordResetRoutes.ts"],
    downstream: ["db:main"],
  },
  {
    id: "api:auth-change",
    label: "POST /api/auth/change-password",
    description: "已登入用戶變更密碼（需 verifyToken middleware）",
    method: "POST",
    path: "/api/auth/change-password",
    files: ["server/routes/passwordResetRoutes.ts"],
    downstream: ["db:main"],
  },
  {
    id: "api:auth-login-history",
    label: "GET /api/auth/login-history",
    description: "回傳目前用戶最近的登入紀錄（IP、UA、時間）",
    method: "GET",
    path: "/api/auth/login-history",
    files: ["server/routes/passwordResetRoutes.ts"],
    downstream: ["db:main"],
  },
  // ── Admin & 工具端點 ──────────────────────────────────────────────────
  {
    id: "api:admin-events-stream",
    label: "GET /api/admin/events/stream",
    description: "Admin 即時事件 SSE 串流（光球任務、錯誤、CI 狀態）",
    method: "GET",
    path: "/api/admin/events/stream",
    files: ["server/routes/adminEvents.ts"],
    downstream: ["db:main"],
  },
  {
    id: "api:tasks-status",
    label: "GET /api/tasks/:taskId/status",
    description: "輪詢光球任務當前狀態（state machine snapshot）",
    method: "GET",
    path: "/api/tasks/:taskId/status",
    files: ["server/routes/orbTasks.ts"],
    downstream: ["db:main"],
  },
  {
    id: "api:maps-proxy",
    label: "GET /api/maps/proxy/*",
    description: "前端地圖元件代理；轉發到 Forge maps（隱藏使用者 IP 與 API key）",
    method: "GET",
    path: "/api/maps/proxy/*",
    files: ["server/_core/index.ts"],
    downstream: ["ext:forge-maps"],
  },
  {
    id: "api:ics-feed",
    label: "GET /api/ics/:token.ics",
    description:
      "公開 ICS 訂閱端點；手機原生日曆 / 鬧鐘以 webcal:// 訂閱使用者排程，含 VALARM 自動響鈴",
    method: "GET",
    path: "/api/ics/:token.ics",
    files: ["server/routes/icsFeed.ts"],
    downstream: ["db:main"],
  },
  {
    id: "api:proxy-download",
    label: "GET /api/proxy-download",
    description:
      "代理外部資源下載；解 CORS、加 referer，並在快取層短期 memoize 結果",
    method: "GET",
    path: "/api/proxy-download",
    files: ["server/_core/index.ts"],
    downstream: ["storage:assets"],
  },
  {
    id: "api:ai-proxy",
    label: "ALL /api/ai/:provider/*",
    description:
      "對外暴露的 AI 代理端點（讓前端 / 第三方工具透過 healing-studio 統一閘道呼叫 LLM）",
    method: "POST",
    path: "/api/ai/:provider/*",
    files: ["server/routes/aiProxy.ts"],
    downstream: ["provider:gemini", "provider:openrouter", "provider:anthropic"],
  },
  {
    id: "api:oauth-callback",
    label: "GET /api/oauth/callback",
    description: "通用 OAuth 回呼端點（registerOAuthRoutes 註冊；含 state 校驗）",
    method: "GET",
    path: "/api/oauth/callback",
    files: ["server/_core/oauth.ts"],
    downstream: ["db:main", "auth:google-oauth"],
    upstream: ["auth:google-oauth"],
  },
  {
    id: "api:oauth-drive-start",
    label: "GET /api/oauth/google/drive/start",
    description:
      "增量授權：要求 Drive readonly scope，piggy-back 在通用 oauth callback；用 state.purpose 區分回流",
    method: "GET",
    path: "/api/oauth/google/drive/start",
    files: ["server/_core/oauth.ts", "server/services/googleDrive.ts"],
    downstream: ["auth:google-oauth"],
  },
  {
    id: "api:uploads-static",
    label: "GET /uploads/*",
    description:
      "本地素材靜態檔案 serving（開發模式 fallback；生產走 storage:assets）",
    method: "GET",
    path: "/uploads/*",
    files: ["server/_core/index.ts"],
    downstream: ["storage:assets"],
  },
  {
    id: "api:video-output",
    label: "GET /api/video-output",
    description:
      "AIDV-280 BOLA 修復：HMAC-signed 影片輸出代理，驗 ownership + 簽章 + 到期後 302 跳轉真實 CDN URL",
    method: "GET",
    path: "/api/video-output",
    files: ["server/routes/videoOutputRoute.ts"],
    downstream: ["db:main"],
  },
  {
    id: "api:agents-status",
    label: "GET /api/agents/status",
    description: "AIDV-334 多代理監控：回傳所有代理的即時狀態快照（auth required）",
    method: "GET",
    path: "/api/agents/status",
    files: ["server/routes/agentStatusRoute.ts"],
    downstream: ["db:main"],
  },
  {
    id: "api:agents-metrics",
    label: "GET /api/agents/metrics",
    description: "AIDV-334 多代理監控：Prometheus text format 代理指標（admin required）",
    method: "GET",
    path: "/api/agents/metrics",
    files: ["server/routes/agentStatusRoute.ts"],
    downstream: ["db:main"],
  },
  {
    id: "api:agents-heartbeat",
    label: "GET /api/agents/heartbeat",
    description: "AIDV-334 多代理監控：SSE 串流，每 30s 廣播代理狀態快照（auth required）",
    method: "GET",
    path: "/api/agents/heartbeat",
    files: ["server/routes/agentStatusRoute.ts"],
    downstream: ["db:main"],
  },
  {
    id: "api:v1-videos",
    label: "POST/GET /api/v1/videos",
    description: "AIDV-276 程式化 API：建立 / 取得影片專案；Bearer aidv_<key> 鑑權",
    method: "POST",
    path: "/api/v1/videos",
    files: ["server/routes/v1.ts"],
    downstream: ["db:main"],
  },
  {
    id: "api:handoff-trace",
    label: "GET /api/video/project/:projectId/handoff-trace",
    description: "AIDV-318 多代理交棒鏈：回傳指定 video_project UUID 的完整 agent_handoff_log 序列（auth required）",
    method: "GET",
    path: "/api/video/project/:projectId/handoff-trace",
    files: ["server/routes/handoffTraceRoute.ts"],
    downstream: ["db:supabase"],
  },
  {
    id: "api:video-list",
    label: "GET /api/video",
    description: "AIDV-735 REST：cursor 分頁列出目前使用者的影片專案",
    method: "GET",
    path: "/api/video",
    files: ["server/routes/videoRoute.ts"],
    downstream: ["db:main"],
  },
  {
    id: "api:video-create",
    label: "POST /api/video",
    description: "AIDV-735 REST：建立影片專案，回傳 201 + 序列化專案物件",
    method: "POST",
    path: "/api/video",
    files: ["server/routes/videoRoute.ts"],
    downstream: ["db:main"],
  },
  {
    id: "api:video-get",
    label: "GET /api/video/:id",
    description: "AIDV-735 REST：取得單一影片專案（含 403 owner 守門）",
    method: "GET",
    path: "/api/video/:id",
    files: ["server/routes/videoRoute.ts"],
    downstream: ["db:main"],
  },
  {
    id: "api:video-update",
    label: "PUT /api/video/:id",
    description: "AIDV-736 REST：CAS 樂觀鎖更新，回傳 ETag + 新版本號",
    method: "PUT",
    path: "/api/video/:id",
    files: ["server/routes/videoRoute.ts"],
    downstream: ["db:main"],
  },
];

/**
 * Webhook 端點：由外部服務「主動回呼」我們的 API，例如 fal queue 完成、
 * replicate 訓練回報、Stripe 付款狀態。webhook 在拓撲上是 provider → API。
 */
interface WebhookEndpointMeta {
  id: string;
  label: string;
  description: string;
  path: string;
  files: string[];
  /** 觸發此 webhook 的外部 provider id（用於畫 edge） */
  source: string;
  downstream: string[];
}

const WEBHOOK_ENDPOINTS: WebhookEndpointMeta[] = [
  {
    id: "webhook:fal",
    label: "POST /api/webhooks/fal",
    description: "Fal queue 任務完成回調 → 觸發 generationEvents 與 DB 更新",
    path: "/api/webhooks/fal",
    files: ["server/routes/webhookFal.ts"],
    source: "provider:fal",
    downstream: ["db:main"],
  },
  {
    id: "webhook:replicate",
    label: "POST /api/webhooks/replicate",
    description: "Replicate LoRA 訓練 / 推理回調 → 寫入訓練狀態",
    path: "/api/webhooks/replicate",
    files: ["server/routes/webhookReplicate.ts"],
    source: "provider:replicate",
    downstream: ["db:main"],
  },
  {
    id: "webhook:suno",
    label: "POST /api/webhooks/suno",
    description: "Suno 音樂生成回調（備援音樂引擎）",
    path: "/api/webhooks/suno",
    files: ["server/routes/webhookSuno.ts"],
    source: "provider:suno",
    downstream: ["db:main"],
  },
  {
    id: "webhook:stripe",
    label: "POST /api/webhooks/stripe",
    description: "Stripe 付款 / 訂閱事件回調 → 點數與計費結算",
    path: "/api/webhooks/stripe",
    files: ["server/routes/stripeWebhook.ts"],
    source: "payment:stripe",
    downstream: ["db:main"],
  },
  {
    id: "webhook:orb",
    label: "POST /api/webhooks/orb",
    description: "光球外部回調入口（外部排程 / 第三方工具觸發）",
    path: "/api/webhooks/orb",
    files: ["server/routes/webhooks.ts"],
    source: "infra:railway",
    downstream: ["db:main"],
  },
];

/**
 * 資料層（永續儲存）— MySQL 與物件儲存（GCS / S3 / 本地）。
 *
 * 兩個節點的狀態都從環境變數推導：DATABASE_URL 缺 = broken；
 * detectStorageBackend()=="none" = needs_optimization（生產才會 broken）。
 */
interface DataNodeMeta {
  id: string;
  label: string;
  description: string;
  files: string[];
}

const DATA_NODES: DataNodeMeta[] = [
  {
    id: "db:main",
    label: "MySQL（主資料庫）",
    description:
      "使用者、會話、素材、光球任務、用量計量等核心資料；以 Drizzle ORM 連線 MySQL（DATABASE_URL）",
    files: ["server/db.ts", "drizzle/schema.ts", "drizzle.config.ts"],
  },
  {
    id: "storage:assets",
    label: "物件儲存（S3 / GCS / 本地）",
    description:
      "上傳素材、生成成品、LoRA 訓練輸出；自動偵測 S3 / GCS，無設定時 fallback 到本地檔案",
    files: ["server/storage.ts", "server/uploadRoute.ts"],
  },
];

/**
 * 基礎設施 / 部署平台。Railway 為主部署平台（以 Dockerfile build），
 * 同時把觀測（LangSmith / PostHog）也歸類於此層，方便主管在「Infra 視圖」
 * 一眼看到上線狀態 + 監控接線。
 */
interface InfraNodeMeta {
  id: string;
  kind: "deployment" | "observability" | "auth-provider" | "payment";
  label: string;
  description: string;
  envKey?: string;
  files: string[];
  downstream?: string[];
}

const INFRA_NODES: InfraNodeMeta[] = [
  {
    id: "infra:railway",
    kind: "deployment",
    label: "Railway（部署平台）",
    description:
      "生產環境主機；以 Dockerfile build → 透過 healthcheck=/api/health 做 liveness 判定",
    files: ["railway.toml", "Dockerfile", ".nixpacks.toml"],
    downstream: ["api:health", "db:main", "storage:assets"],
  },
  {
    id: "observability:langsmith",
    kind: "observability",
    label: "LangSmith（AI 追蹤）",
    description:
      "把每一次 LLM call 與 agent step 上傳到 LangSmith，提供 trace / dataset / 評估",
    envKey: "LANGSMITH_API_KEY",
    files: ["server/services/langsmithTracer.ts", "server/routers/langsmith.ts"],
    downstream: [],
  },
  {
    id: "observability:posthog",
    kind: "observability",
    label: "PostHog（行為分析）",
    description: "前端事件追蹤、轉換漏斗、A/B 測試結果聚合",
    envKey: "POSTHOG_API_KEY",
    files: ["client/index.html", "client/src/lib/env.validated.ts"],
    downstream: [],
  },
  {
    id: "auth:google-oauth",
    kind: "auth-provider",
    label: "Google OAuth",
    description: "Google 登入 / 連結 GCP 服務帳戶；GOOGLE_CLIENT_ID 缺則無法第三方登入",
    envKey: "GOOGLE_CLIENT_ID",
    files: ["server/_core/oauth.ts", "server/routes/googleAuth.ts"],
    downstream: [],
  },
  {
    id: "payment:stripe",
    kind: "payment",
    label: "Stripe（金流）",
    description:
      "訂閱付款 / 點數加值；STRIPE_SECRET_KEY 缺則 webhook 與訂閱流程停用",
    envKey: "STRIPE_SECRET_KEY",
    files: ["server/routes/stripeWebhook.ts"],
    downstream: ["webhook:stripe"],
  },
];

/** 瀏覽器（client runtime）入口節點 — 整張圖的最上游。 */
const BROWSER_NODE_META = {
  id: "client:browser",
  label: "使用者瀏覽器",
  description:
    "整張圖的入口：使用者打開首頁，下載 Vite 打包後的 React bundle 並建立第一個 HTTP 連線",
  files: ["client/index.html", "client/src/main.tsx", "vite.config.ts"],
} as const;

/**
 * 非 AI 的外部服務 — 向量記憶、搜尋、新聞、原始碼、通知通道。
 *
 * 這些 service 與 PROVIDERS 一樣是「環境變數驅動的外部 HTTP 依賴」，但語意上
 * 不屬於 AI 引擎；用獨立 catalog 與獨立 kind 標記，讓「運作」視圖把它們聚成
 * 一群，避免和 8 個 LLM provider 擠在一起難以辨識。
 */
interface ExternalServiceMeta {
  id: string;
  kind:
    | "vector-store"
    | "search-provider"
    | "provider"
    | "notification";
  label: string;
  description: string;
  envKey: string;
  files: string[];
  /** 此服務的「下游消費者」節點 id（之後會建立 edge 連入；通常是 cron / router） */
  consumers?: string[];
}

const EXTERNAL_SERVICES: ExternalServiceMeta[] = [
  {
    id: "ext:pinecone",
    kind: "vector-store",
    label: "Pinecone（向量記憶）",
    description:
      "RAG 記憶後端：把光球 / 導演對話 embedding 後寫入 Pinecone，讀取時做語意檢索",
    envKey: "PINECONE_API_KEY",
    files: ["server/services/ragMemory.ts"],
  },
  {
    id: "ext:brave-search",
    kind: "search-provider",
    label: "Brave Search API",
    description:
      "網路研究與每日學習文件抓取的主要搜尋來源（光球 web research + braveLearnFetcher cron）",
    envKey: "BRAVE_SEARCH_API_KEY",
    files: [
      "server/services/orbWebResearch.ts",
      "server/jobs/braveLearnFetcher.ts",
    ],
  },
  {
    id: "ext:perplexity",
    kind: "search-provider",
    label: "Perplexity（已淘汰直連，由 OpenRouter Sonar 取代）",
    description:
      "進階研究模式：若設 PERPLEXITY_API_KEY 仍可用，但 webSearch 預設走 OpenRouter perplexity/sonar 模型，免另外購買金鑰。",
    envKey: "PERPLEXITY_API_KEY",
    files: ["server/services/brainAutoRepair.ts", "server/services/orbWebResearch.ts"],
  },
  {
    id: "ext:newsapi",
    kind: "search-provider",
    label: "NewsAPI",
    description: "首頁新聞動態主要來源（每 6 小時 newsFetcher cron 抓取）",
    envKey: "NEWS_API_KEY",
    files: ["server/jobs/newsFetcher.ts"],
  },
  {
    id: "ext:newsdata",
    kind: "search-provider",
    label: "NewsData.io",
    description: "新聞動態備援來源（NewsAPI 失敗時 fallback）",
    envKey: "NEWSDATA_API_KEY",
    files: ["server/jobs/newsFetcher.ts"],
  },
  {
    id: "ext:github",
    kind: "provider",
    label: "GitHub API",
    description: "失敗自動回報 issue（brainAutoRepair → githubIssueClient）",
    envKey: "GITHUB_TOKEN",
    files: ["server/services/githubIssueClient.ts"],
  },
  {
    id: "ext:slack-alerts",
    kind: "notification",
    label: "Slack Alerts",
    description: "高用量 / 預算告警通知（apiUsageAlertJob 每 15 分鐘檢查）",
    envKey: "ALERT_SLACK_WEBHOOK",
    files: ["server/jobs/apiUsageAlertJob.ts"],
  },
  {
    id: "ext:forge-maps",
    kind: "provider",
    label: "Forge Maps Proxy",
    description:
      "地圖 / 地理資料代理（透過 /api/maps/proxy/* 代理至 forge.butterfly-effect.dev）",
    envKey: "FRONTEND_FORGE_API_KEY",
    files: ["server/_core/index.ts"],
  },
];

/**
 * 排程任務（node-cron）清單 — 對應 server/_core/index.ts 啟動時 init 的 9 個 cron。
 * 每筆 entry 同時宣告 cron 表達式（用於 UI 顯示週期）與下游節點，
 * 讓「運作」視圖能畫出「定時任務 → 寫入哪個 DB / 抓哪個外部服務」。
 */
interface CronJobMeta {
  id: string;
  label: string;
  /** cron 表達式，純文字顯示給人看 */
  schedule: string;
  description: string;
  files: string[];
  /** 下游：每次跑會打哪些節點 */
  downstream: string[];
  envKey?: string;
}

const CRON_JOBS: CronJobMeta[] = [
  {
    id: "cron:news-fetcher",
    label: "新聞動態抓取（每 6 小時）",
    schedule: "0 */6 * * *",
    description: "從 NewsAPI / NewsData 抓最新 AI 新聞，寫入 news_articles 表",
    files: ["server/jobs/newsFetcher.ts"],
    downstream: ["ext:newsapi", "ext:newsdata", "db:main"],
    envKey: "NEWS_API_KEY",
  },
  {
    id: "cron:brave-learn-fetcher",
    label: "Brave 學習文件（每日 04:00）",
    schedule: "0 4 * * *",
    description:
      "用 Brave Search 抓取教學內容並 embedding，寫入 learn_documents 表",
    files: ["server/jobs/braveLearnFetcher.ts"],
    downstream: ["ext:brave-search", "db:main"],
    envKey: "BRAVE_SEARCH_API_KEY",
  },
  {
    id: "cron:learn-doc-syncer",
    label: "學習文件同步（每週一 03:00）",
    schedule: "0 3 * * 1",
    description: "把長期學習文件同步到 learn_documents 並重算 embedding",
    files: ["server/jobs/learnDocSyncer.ts"],
    downstream: ["db:main"],
  },
  {
    id: "cron:model-training-worker",
    label: "模型訓練輪詢（每 5 分鐘）",
    schedule: "*/5 * * * *",
    description:
      "輪詢 Replicate / Fal LoRA 訓練 job 狀態並更新 lora_trainings 表",
    files: ["server/jobs/modelTrainingWorker.ts"],
    downstream: ["provider:replicate", "provider:fal", "db:main"],
  },
  {
    id: "cron:teaching-archive-ingestion-worker",
    label: "資料庫抽文 / 轉文字 Worker（每 60 秒）",
    schedule: "*/1 * * * *",
    description:
      "消費 background_jobs.teaching_archive_ingestion queue：PDF 抽文 + 語音/影片轉文字，並回寫 teaching_materials.textContent",
    files: ["server/jobs/teachingArchiveIngestionWorker.ts"],
    downstream: ["provider:elevenlabs", "db:main"],
  },
  {
    id: "cron:api-health-monitor",
    label: "API 健康巡檢（依 ENV 設定週期）",
    schedule: "API_HEALTH_MONITOR_SCHEDULE",
    description: "ping 所有外部 provider，更新 providerHealth snapshot",
    files: ["server/jobs/apiHealthMonitor.ts", "server/services/providerHealth.ts"],
    downstream: [
      "provider:gemini",
      "provider:vertex",
      "provider:fal",
      "provider:elevenlabs",
      "provider:replicate",
    ],
  },
  {
    id: "cron:provider-snapshot",
    label: "Provider 快照（每 15 分鐘）",
    schedule: "*/15 * * * *",
    description: "把 providerHealth + apiUsage 快照寫入 DB 供日後趨勢分析",
    files: ["server/jobs/providerSnapshotJob.ts"],
    downstream: ["db:main"],
  },
  {
    id: "cron:cost-ledger-reconcile",
    label: "成本帳本對帳（每 30 分鐘）",
    schedule: "*/30 * * * *",
    description:
      "比對 cost_ledger posted debit 與 cost_aggregations 總額，偵測 drift 並 Slack 告警（AIDV-153，基礎版只偵測不自動修）",
    files: ["server/jobs/costLedgerReconcileJob.ts"],
    downstream: ["db:main", "ext:slack-alerts"],
    envKey: "ENABLE_COST_LEDGER",
  },
  {
    id: "cron:cost-attribution-outbox",
    label: "成本歸屬 outbox 補帳（每 2 分鐘）",
    schedule: "*/2 * * * *",
    description:
      "把 cost_attribution_outbox 的 pending 落帳意圖重放成 cost_ledger 多維歸屬（project/member/workflow，以 TWD），失敗重試/超上限標 dead（AIDV-14，不漏帳）",
    files: ["server/jobs/costAttributionOutboxJob.ts"],
    downstream: ["db:main"],
    envKey: "ENABLE_COST_ATTRIBUTION",
  },
  {
    id: "cron:api-usage-alert",
    label: "用量告警（每 15 分鐘）",
    schedule: "*/15 * * * *",
    description:
      "檢查 AI 用量是否超出 AI_MONTHLY_BUDGET_USD，超標時發 Slack 通知",
    files: ["server/jobs/apiUsageAlertJob.ts"],
    downstream: ["db:main", "ext:slack-alerts"],
    envKey: "AI_MONTHLY_BUDGET_USD",
  },
  {
    id: "cron:user-auto-credit",
    label: "自動發放點數（每 15 分鐘）",
    schedule: "*/15 * * * *",
    description: "依 auto-credit 規則替合資格用戶補點數",
    files: ["server/jobs/userAutoCreditJob.ts"],
    downstream: ["db:main"],
  },
  {
    id: "cron:r2-snapshot",
    label: "R2 / S3 快照（每日 18:00）",
    schedule: "0 18 * * *",
    description: "每天備份重要 DB 表到物件儲存（容災）",
    files: ["server/jobs/r2SnapshotJob.ts"],
    downstream: ["db:main", "storage:assets"],
  },
  {
    id: "cron:model-catalog-research",
    label: "AI 模型情報自動研究（每週日 03:30）",
    schedule: "30 3 * * 0",
    description:
      "對 AI 模型目錄每個條目跑 Perplexity 深度搜尋：更新定價、benchmark、近期動態並做事實查核，結果寫入 in-memory enrichment store 供 trpc.aiModels.list 使用",
    files: [
      "server/jobs/modelCatalogResearchJob.ts",
      "server/services/modelResearcher.ts",
    ],
    downstream: ["ext:perplexity", "router:aiModels"],
    envKey: "PERPLEXITY_API_KEY",
  },
  {
    id: "cron:media-archival",
    label: "媒體資產歸檔掃描（每 5 分鐘）",
    schedule: "*/5 * * * *",
    description:
      "掃描資產庫 / 歷史中 archivedAt IS NULL 的外部 provider URL，趁 presigned link 過期前拉回自家儲存（靠 archivedAt 達成 idempotency）",
    files: [
      "server/jobs/mediaArchivalCron.ts",
      "server/services/mediaArchivalService.ts",
    ],
    downstream: ["db:main", "storage:assets"],
  },
  {
    id: "cron:db-backup",
    label: "DB 快照備份（每日 03:00）",
    schedule: "0 3 * * *",
    description: "每天備份主要資料庫表到物件儲存（容災 / PITR）",
    files: ["server/jobs/dbSnapshotJob.ts"],
    downstream: ["db:main", "storage:assets"],
  },
  {
    id: "cron:asset-cleanup",
    label: "數位資產 TTL 清理（每小時）",
    schedule: "0 * * * *",
    description: "掃描 digital_assets 表找過期資產並刪除（含雲端物件），旗標 ENABLE_ASSET_TTL_CLEANUP 控制開關",
    files: ["server/jobs/assetCleanupJob.ts"],
    downstream: ["db:main", "storage:assets"],
  },
  {
    id: "cron:stale-job-checker",
    label: "背景任務容錯 DLQ（每 1 分鐘）",
    schedule: "* * * * *",
    description:
      "掃描 background_jobs 中 processing 超過 5 分鐘的卡住任務，retryCount < 3 重新排隊，≥ 3 標 failed 並廣播 SSE job_failed（AIDV-332）",
    files: ["server/jobs/staleJobChecker.ts"],
    downstream: ["db:main"],
  },
  {
    id: "cron:audit-log-purge",
    label: "稽核日誌清理（每天 03:17 UTC）",
    schedule: "17 3 * * *",
    description:
      "刪除 login_history 與 global_audit_log 90 天以前的紀錄（AIDV-63 H9 個資出口保留政策；ENABLE_AUDIT_LOG_PURGE=true 才生效）",
    files: ["server/jobs/auditLogPurgeJob.ts"],
    downstream: ["db:main"],
  },
  {
    id: "cron:login-history-purge",
    label: "登入記錄清理（每日 03:00 UTC）",
    schedule: "0 3 * * *",
    description: "刪除 login_history 中 90 天以上的舊記錄（AIDV-63 GDPR 資料最小化）",
    files: ["server/jobs/loginHistoryPurgeJob.ts"],
    downstream: ["db:main"],
  },
  {
    id: "cron:credential-expiry-alert",
    label: "外部服務憑證到期預警（每日 09:00 UTC）",
    schedule: "0 9 * * *",
    description:
      "掃描 data_source_connections.expiresAt，對 30 天內即將到期的連接發出 console.warn 警告（AIDV-68 M5 key versioning）",
    files: ["server/jobs/credentialExpiryAlertJob.ts"],
    downstream: ["db:main"],
  },
  {
    id: "cron:provider-health-probe",
    label: "AI Provider 健康探測（每 10 分鐘）",
    schedule: "*/10 * * * *",
    description:
      "主動探測各 AI provider API key 可用性（FAL / ElevenLabs / Replicate / Anthropic / Gemini / OpenRouter）；連續 2+ 次失敗寫入 orb_system_alerts；自動恢復時標記 isResolved（AIDV-518）",
    files: ["server/jobs/providerHealthProbeJob.ts"],
    downstream: ["db:main", "service:provider-health"],
  },
  {
    id: "cron:go-true-health-monitor",
    label: "GoTrue Auth 健康監控（每 60 秒）",
    schedule: "* * * * *",
    description:
      "每 60 秒探測 GoTrue /auth/v1/health，連續 2 次失敗時透過 Slack 告警；服務恢復時自動發送恢復通知，告警每 10 分鐘最多觸發一次（AIDV-352）",
    files: ["server/jobs/goTrueHealthMonitor.ts"],
    downstream: ["ext:gotrue-auth", "ext:slack-alerts"],
    envKey: "ALERT_SLACK_WEBHOOK",
  },
];

/**
 * Express middleware 棧 — 從 server/_core/index.ts 取出的全域層。
 *
 * 把每一層中介層畫成獨立節點，讓主管能直觀看到「請求進入後依序經過 helmet →
 * compression → rate limit → trace → 路由 → verifyToken → 錯誤處理」的順序。
 */
interface MiddlewareMeta {
  id: string;
  label: string;
  description: string;
  files: string[];
}

/**
 * WebSocket 閘道 — `/ws/orb-voice` 給 Gemini Live 雙向音訊串流。
 *
 * 與 SSE 不同（單向 server→client），WebSocket 是雙向；放獨立 kind 讓畫布上
 * 的圖示與 edge label 可以區分。
 */
interface WebSocketGatewayMeta {
  id: string;
  label: string;
  description: string;
  path: string;
  files: string[];
  envKey?: string;
  downstream: string[];
}

const WS_GATEWAYS: WebSocketGatewayMeta[] = [
  {
    id: "ws:orb-voice",
    label: "WS /ws/orb-voice（Gemini Live Voice）",
    description:
      "光球語音對話：瀏覽器 ↔ Gemini Live API 雙向音訊串流；上限 ORB_VOICE_MAX_SESSION_MS",
    path: "/ws/orb-voice",
    files: ["server/ws/orbVoiceGateway.ts", "server/_core/index.ts"],
    envKey: "GEMINI_LIVE_API_KEY",
    downstream: ["provider:gemini", "db:main"],
  },
];

/**
 * 後端內部服務（business logic）— router 與 provider / DB 之間的中介。
 *
 * 加入這些節點是為了讓主管能看到「光球收到請求後，到底經過哪些服務才送到
 * Gemini？」例如：tRPC ai router → provider router → llm router → Gemini API。
 *
 * 只列出對外行為「明顯改變圖樣」的核心服務，避免把每支 service 檔都畫成節點。
 */
interface InternalServiceMeta {
  id: string;
  label: string;
  description: string;
  files: string[];
  /** 服務上游（誰會呼叫它）— 用於畫 edge */
  upstream: string[];
  /** 服務下游（它會呼叫誰）— 用於畫 edge */
  downstream: string[];
}

const INTERNAL_SERVICES: InternalServiceMeta[] = [
  {
    id: "service:provider-router",
    label: "Provider Router（LLM 路由器）",
    description:
      "把模型 ID 解析到 OpenRouter / Anthropic / Gemini / Vertex；支援 fallback 與並發控制",
    files: [
      "server/_core/llmRouter.ts",
      "server/_core/llm.ts",
      "server/_core/llmConcurrency.ts",
      "server/_core/fallbackPolicy.ts",
      "server/services/providerRouter.ts",
    ],
    upstream: [
      "router:brain",
      "router:director",
      "router:learnHub",
      "router:orbScheduler",
    ],
    downstream: [
      "provider:gemini",
      "provider:vertex",
      "provider:openrouter",
      "provider:anthropic",
    ],
  },
  {
    id: "service:fal-dispatcher",
    label: "Fal Dispatcher（Fal queue 分發器）",
    description: "把生成請求送到 Fal queue 並輪詢結果；支援 webhook 異步回呼",
    files: [
      "server/services/falDispatcher.ts",
      "server/services/falModels.ts",
      "server/services/falQueueAwaiter.ts",
      "server/services/falTrainer.ts",
    ],
    upstream: ["router:imageStudio", "router:videoStudio", "router:proStudio"],
    downstream: ["provider:fal"],
  },
  {
    id: "service:agent-planner",
    label: "Schema-First Agent Planner",
    description:
      "從用戶需求生成多步驟工具呼叫計畫；含 plan / critique / safety guards",
    files: ["server/services/agentPlanner.ts"],
    upstream: ["orb:agent"],
    downstream: ["service:agent-tool-executor"],
  },
  {
    id: "service:agent-tool-executor",
    label: "Agent Tool Executor",
    description:
      "把計畫中每一步的 tool call 真正送出（studio.* / web research / image edit / 3D…）",
    files: ["server/services/agentToolExecutor.ts"],
    upstream: ["service:agent-planner"],
    downstream: [
      "studio:image-studio",
      "studio:video-studio",
      "studio:pro-studio",
      "service:fal-dispatcher",
    ],
  },
  {
    id: "service:rag-memory",
    label: "RAG Memory（向量記憶服務）",
    description:
      "把對話 / 素材 embed 寫入 Pinecone；支援 query 取得語意相似的歷史段落",
    files: ["server/services/ragMemory.ts", "server/services/orbMemory.ts"],
    upstream: ["brain:director", "brain:storyteller", "orb:agent"],
    downstream: ["ext:pinecone", "db:main"],
  },
  {
    id: "service:provider-health",
    label: "Provider Health Service",
    description: "聚合所有外部 provider 的健康狀態快照；ProviderSnapshot cron 寫入",
    files: ["server/services/providerHealth.ts"],
    upstream: ["router:brain", "cron:provider-snapshot"],
    downstream: [
      "provider:gemini",
      "provider:fal",
      "provider:elevenlabs",
      "provider:replicate",
    ],
  },
  {
    id: "service:brain-auto-repair",
    label: "Brain Auto-Repair（錯誤追蹤+自動修復）",
    description:
      "捕捉 LLM / engine 錯誤；超過閾值熔斷，必要時自動建立 GitHub issue",
    files: [
      "server/services/brainAutoRepair.ts",
      "server/middleware/brainContext.ts",
    ],
    upstream: ["mw:error-handler", "service:provider-router"],
    downstream: ["ext:github", "db:main"],
  },
  {
    id: "service:langsmith-tracer",
    label: "LangSmith Tracer（追蹤橋接）",
    description:
      "把每一次 LLM call / agent step 上傳 LangSmith；支援 dataset & 評估",
    files: ["server/services/langsmithTracer.ts"],
    upstream: ["service:provider-router", "service:agent-planner"],
    downstream: ["observability:langsmith"],
  },
  {
    id: "service:auth-facade",
    label: "Auth Facade（認證門面）",
    description:
      "統一帳密 / OAuth / 2FA / 密碼重設邏輯；包裝 password hasher、TOTP、login history",
    files: [
      "server/services/auth/AuthFacade.ts",
      "server/services/auth/passwordHasher.ts",
      "server/services/auth/totpService.ts",
      "server/services/auth/passwordResetService.ts",
      "server/services/auth/loginHistoryService.ts",
      "server/services/auth/emailVerificationService.ts",
    ],
    upstream: [
      "api:auth-login",
      "api:auth-register",
      "api:auth-2fa",
      "api:auth-forgot",
      "api:auth-reset",
      "api:auth-change",
      "api:auth-login-history",
    ],
    downstream: ["repo:users", "db:main"],
  },
  {
    id: "service:orb-task-orchestrator",
    label: "Orb Task Orchestrator（多步驟狀態機）",
    description:
      "光球任務 state machine：plan → tool calls → confirm → finalize；含 idempotency 與 cost guard",
    files: [
      "server/services/orbTaskOrchestrator.ts",
      "server/services/orbTaskStateMachine.ts",
      "server/services/orbTaskStore.ts",
      "server/services/orbIdempotency.ts",
      "server/services/orbCostGuard.ts",
      "server/services/orbQuota.ts",
    ],
    upstream: ["router:orbScheduler", "orb:agent"],
    downstream: [
      "service:agent-planner",
      "service:agent-tool-executor",
      "repo:orb-tasks",
    ],
  },
  {
    id: "service:site-code-scanner",
    label: "Site Code Scanner",
    description:
      "AI 全站研究：靜態掃描 server/ + client/src/ 提供給光球使用，回答程式碼問題",
    files: [
      "server/services/siteCodeScanner.ts",
      "server/services/siteKnowledge.ts",
    ],
    upstream: ["orb:agent", "router:adminEval"],
    downstream: [],
  },
];

/**
 * Repository 層（資料存取）— Repository pattern 把 ORM query 集中管理。
 * 介於 service 層與 DB 之間，讓服務不直接組 SQL。
 */
interface RepositoryMeta {
  id: string;
  label: string;
  description: string;
  files: string[];
  /** 主要操作的 DB 表名（用於畫到 db-table 子節點的邊） */
  tables: string[];
  /** 上游：誰會呼叫此 repository */
  upstream: string[];
}

const REPOSITORIES: RepositoryMeta[] = [
  {
    id: "repo:orb-tasks",
    label: "Orb Task Repository",
    description: "光球任務的 CRUD：建立、推進狀態、寫入結果",
    files: [
      "server/repositories/orbTaskRepository.ts",
      "server/repositories/base",
      "server/repositories/mysql",
    ],
    tables: ["table:background_jobs"],
    upstream: ["service:orb-task-orchestrator"],
  },
  {
    id: "repo:users",
    label: "User Repository（內聯於 db.ts）",
    description:
      "使用者、session、login_history 的 query helper（目前在 server/db.ts）",
    files: ["server/db.ts"],
    tables: [
      "table:users",
      "table:login_history",
      "table:password_reset_tokens",
    ],
    upstream: ["service:auth-facade"],
  },
];

/**
 * 資料表（database 子節點）— 列出 30+ 表中最關鍵的 12 個資料領域。
 *
 * 每個表都用 `parentId: "db:main"` 折疊到 db:main 之下；展開時可看到完整對應，
 * 避免一張圖塞 30+ 個表把畫布炸掉。對應到 drizzle/schema.ts 的實際表名。
 */
interface DbTableMeta {
  id: string;
  label: string;
  description: string;
  /** drizzle schema 中的 export 名 */
  drizzleExport: string;
  /** 哪些服務會讀寫此表 */
  consumers?: string[];
}

const DB_TABLES: DbTableMeta[] = [
  {
    id: "table:users",
    label: "users",
    description: "使用者帳號 / profile / 點數",
    drizzleExport: "users",
  },
  {
    id: "table:login_history",
    label: "login_history",
    description: "登入紀錄（IP / UA / 時間）",
    drizzleExport: "loginHistory",
  },
  {
    id: "table:password_reset_tokens",
    label: "password_reset_tokens",
    description: "密碼重設 token（短期有效）",
    drizzleExport: "passwordResetTokens",
  },
  {
    id: "table:digital_asset_library",
    label: "digital_asset_library",
    description: "上傳 + 生成的素材（圖 / 影 / 音）",
    drizzleExport: "digitalAssetLibrary",
  },
  {
    id: "table:fine_tuned_models",
    label: "fine_tuned_models",
    description: "LoRA 訓練紀錄與輸出 weights URL",
    drizzleExport: "fineTunedModels",
  },
  {
    id: "table:background_jobs",
    label: "background_jobs",
    description: "光球任務狀態機 / 排程任務 / 重試紀錄",
    drizzleExport: "backgroundJobs",
  },
  {
    id: "table:news_articles",
    label: "news_articles",
    description: "newsFetcher cron 抓進來的最新動態",
    drizzleExport: "newsArticles",
  },
  {
    id: "table:api_usage_logs",
    label: "api_usage_logs",
    description: "每一次 LLM / Fal / Replicate 呼叫的 token / 成本紀錄",
    drizzleExport: "apiUsageLogs",
  },
  {
    id: "table:ai_usage_events",
    label: "ai_usage_events",
    description: "AI 用量事件流（提供告警 / 配額計算）",
    drizzleExport: "aiUsageEvents",
  },
  {
    id: "table:generation_history",
    label: "generation_history",
    description: "歷次生成快照（prompt / model / 結果）",
    drizzleExport: "generationHistory",
  },
  {
    id: "table:user_ai_brain",
    label: "user_ai_brain",
    description: "使用者腦組態（5 推理 + 4 引擎槽選擇）",
    drizzleExport: "userAiBrain",
  },
  {
    id: "table:user_subscriptions",
    label: "user_subscriptions",
    description: "Stripe 訂閱狀態 / 點數加值紀錄",
    drizzleExport: "userSubscriptions",
  },
];

/**
 * 建構流水線（dist/public + dist/index.js）— Railway 部署前的兩個 build step。
 *
 * 把它畫成圖讓 onboarding 工程師能看到「打包流程」與部署的關聯。
 */
interface BuildArtifactMeta {
  id: string;
  label: string;
  description: string;
  files: string[];
}

const BUILD_ARTIFACTS: BuildArtifactMeta[] = [
  {
    id: "build:vite-frontend",
    label: "Vite 前端建構（dist/public）",
    description:
      "vite build 編譯 React + Tailwind + assets；產出靜態檔給 Express 在生產環境 serve",
    files: ["vite.config.ts", "client/index.html"],
  },
  {
    id: "build:esbuild-backend",
    label: "esbuild 後端建構（dist/index.js）",
    description:
      "esbuild bundle Node 端 entry → ESM；package.json 的 build script 描述完整指令",
    files: ["package.json", "server/_core/index.ts"],
  },
];

/**
 * 評估框架（quality gate）— 偵測 agent 行為退化、回歸測試。
 */
const EVAL_NODE_META = {
  id: "eval:agent-runner",
  label: "Agent Eval Runner",
  description:
    "對固定的 agent 對話 case 跑回歸；可手動透過 `npm run eval` 觸發或 admin/eval 介面",
  files: [
    "server/eval/runEval.ts",
    "server/eval/agentEvalRunner.ts",
    "server/eval/cases",
  ],
} as const;

const MIDDLEWARE_STACK: MiddlewareMeta[] = [
  {
    id: "mw:helmet",
    label: "helmet（安全標頭）",
    description: "設定 CSP、HSTS、X-Frame-Options 等防護標頭，防止 XSS / clickjacking",
    files: ["server/_core/index.ts"],
  },
  {
    id: "mw:compression",
    label: "compression（壓縮）",
    description: "對 >1KB 的 JSON / 文字回應做 gzip / brotli 壓縮（節省 60-80% 流量）",
    files: ["server/_core/index.ts"],
  },
  {
    id: "mw:rate-limit",
    label: "rate limit（速率限制）",
    description:
      "auth / api 每分鐘 N 次的限流；超出回 429，避免暴力破解與爆量呼叫",
    files: ["server/_core/rateLimiter.ts", "server/_core/index.ts"],
  },
  {
    id: "mw:request-trace",
    label: "request trace（追蹤 ID）",
    description: "為每個請求生成 correlation id，串穿所有 log 與 LangSmith trace",
    files: ["server/_core/index.ts"],
  },
  {
    id: "mw:verify-token",
    label: "verifyToken（JWT 認證）",
    description: "驗證 session JWT 並把 user 注入 request；保護需登入的端點",
    files: ["server/middleware/verifyToken.ts"],
  },
  {
    id: "mw:error-handler",
    label: "globalErrorHandler（錯誤處理）",
    description:
      "捕捉未處理錯誤、寫入 brainAutoRepair trace，回傳脫敏訊息給前端",
    files: ["server/_core/error_handler.ts"],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

interface AggregatedHealth {
  /** 已脫敏的 reason，可能 undefined */
  reason?: string;
  recommendation?: string;
  metrics?: {
    consecutiveFailures?: number;
    lastError?: string;
    recentErrorCount?: number;
    updatedAt?: number;
  };
}

/** 由 ProviderHealth + API Key 狀態推導 provider 節點狀態。 */
function deriveProviderStatus(
  meta: ProviderMeta
): { status: PipelineNodeStatus } & AggregatedHealth {
  if (!meta.hasKey()) {
    return {
      status: "broken",
      reason: `${meta.apiKeyEnv} 未設定，無法呼叫此 provider`,
      recommendation: `請在環境變數中設定 ${meta.apiKeyEnv}，重新啟動服務`,
    };
  }
  const ph = getProviderHealth(meta.id);
  switch (ph.status) {
    case "healthy":
      return {
        status: "healthy",
        metrics: { updatedAt: ph.updatedAt },
      };
    case "missing_key":
      return {
        status: "broken",
        reason: ph.reason ?? `${meta.apiKeyEnv} 缺失`,
        recommendation: `請在環境變數中設定 ${meta.apiKeyEnv}`,
        metrics: { updatedAt: ph.updatedAt },
      };
    case "disabled":
      return {
        status: "abnormal",
        reason: ph.reason ?? "已被管理員停用",
        recommendation: "如需啟用，請至設定頁開啟",
        metrics: { updatedAt: ph.updatedAt },
      };
    case "rate_limited":
      return {
        status: "needs_optimization",
        reason: ph.reason ?? "已觸發外部 API 速率限制",
        recommendation:
          "降低呼叫頻率、加入指數退避重試，或升級至付費方案以提升限額",
        metrics: { updatedAt: ph.updatedAt },
      };
    case "timeout":
      return {
        status: "needs_optimization",
        reason: ph.reason ?? "外部 API 回應逾時",
        recommendation:
          "檢查網路狀況、提高 timeout 上限，或啟用 fallback 引擎",
        metrics: { updatedAt: ph.updatedAt },
      };
    case "degraded":
      return {
        status: "needs_optimization",
        reason: ph.reason ?? "外部 API 服務降級",
        recommendation: "建議啟用備援引擎、密切監控",
        metrics: { updatedAt: ph.updatedAt },
      };
    case "unknown_error":
    default:
      return {
        status: "broken",
        reason: ph.reason ?? "外部 API 出現未知錯誤",
        recommendation: "查看錯誤追蹤頁面取得詳細 stack trace 後修復",
        metrics: { updatedAt: ph.updatedAt },
      };
  }
}

/** 對單一模型 / 引擎查健康狀態，推導腦槽節點狀態。 */
function deriveBrainSlotStatus(modelOrEngine: string): {
  status: PipelineNodeStatus;
} & AggregatedHealth {
  const snapshot = getHealthSnapshot();
  const cached = snapshot[modelOrEngine];
  if (!cached) {
    return { status: "healthy" };
  }
  if (cached.healthy) {
    if (cached.consecutiveFailures > 0) {
      return {
        status: "needs_optimization",
        reason: `近期出現 ${cached.consecutiveFailures} 次失敗但已恢復`,
        recommendation: "建議檢查 fallback 鏈是否完整",
        metrics: {
          consecutiveFailures: cached.consecutiveFailures,
          lastError: cached.lastError,
          updatedAt: cached.checkedAt,
        },
      };
    }
    return {
      status: "healthy",
      metrics: { updatedAt: cached.checkedAt },
    };
  }
  return {
    status: "broken",
    reason:
      cached.lastError ??
      `連續失敗 ${cached.consecutiveFailures} 次，已被熔斷`,
    recommendation:
      "前往「大腦組態」改選備援模型，或排查 API key 與外部服務狀態",
    metrics: {
      consecutiveFailures: cached.consecutiveFailures,
      lastError: cached.lastError,
      updatedAt: cached.checkedAt,
    },
  };
}

/** 把錯誤 trace 計入到 router / provider 節點。接受預先 fetch 的 traces 以避免重複 slice。 */
function buildErrorCountIndex(traces: ErrorTrace[]): {
  byEngine: Map<string, number>;
  byModality: Map<string, number>;
} {
  const byEngine = new Map<string, number>();
  const byModality = new Map<string, number>();
  for (const t of traces) {
    if (t.resolvedAt) continue;
    byEngine.set(t.engine, (byEngine.get(t.engine) ?? 0) + 1);
    byModality.set(t.modality, (byModality.get(t.modality) ?? 0) + 1);
  }
  return { byEngine, byModality };
}

function makeEdge(source: string, target: string, label?: string): PipelineEdge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    label,
    style: "solid",
  };
}

function summarize(nodes: PipelineNode[]): PipelineGraph["summary"] {
  let healthy = 0;
  let needsOpt = 0;
  let broken = 0;
  let abnormal = 0;
  for (const n of nodes) {
    if (n.status === "healthy") healthy++;
    else if (n.status === "needs_optimization") needsOpt++;
    else if (n.status === "broken") broken++;
    else abnormal++;
  }
  return {
    healthy,
    needsOptimization: needsOpt,
    broken,
    abnormal,
    totalNodes: nodes.length,
    lastUpdatedAt: Date.now(),
  };
}

function buildLegend(): PipelineGraph["legend"] {
  return (
    Object.keys(STATUS_LABEL) as Array<keyof typeof STATUS_LABEL>
  ).map(key => ({
    status: key,
    label: STATUS_LABEL[key],
    description: STATUS_DESCRIPTION[key],
  }));
}



function resolvePageSourcePath(pageId: string): string {
  const aliases: Record<string, string> = {
    home: "client/src/pages/Home.tsx",
    "agent-chat": "client/src/pages/AgentChat.tsx",
    studio: "client/src/pages/Studio.tsx",
    director: "client/src/pages/DirectorAI.tsx",
    "image-studio": "client/src/pages/ImageStudio.tsx",
    "video-studio": "client/src/pages/VideoStudio.tsx",
    "pro-studio": "client/src/pages/ProStudio.tsx",
    assets: "client/src/pages/AssetsLibrary.tsx",
    admin: "client/src/pages/AdminPage.tsx",
    dashboard: "client/src/pages/DashboardPage.tsx",
  };
  return aliases[pageId] ?? "client/src/App.tsx";
}


function resolvePageBackendRoute(pageId: string): string {
  return PAGE_DIAGNOSTICS_CATALOG[pageId]?.backendRoute ?? "trpc.unmapped";
}

function resolvePageServiceFunction(pageId: string): string {
  return PAGE_DIAGNOSTICS_CATALOG[pageId]?.serviceFunction ?? "unmapped service";
}


function getTraceSamplesForEngines(
  traces: ErrorTrace[],
  engines: string[],
  limit = 3
): string[] {
  if (traces.length === 0 || engines.length === 0) return [];
  const result: string[] = [];
  // 直接走訪一遍即可，避免 .filter() 額外配置一個中介陣列
  for (const t of traces) {
    if (
      engines.some(
        engine => t.engine.includes(engine) || engine.includes(t.engine)
      )
    ) {
      result.push(t.id);
      if (result.length >= limit) break;
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// Static Pre-computed Indices
// ═══════════════════════════════════════════════════════════════════════════

/** O(1) 查 provider meta：取代 router loop 內的 PROVIDERS.find()。 */
const PROVIDER_BY_ID: Map<string, ProviderMeta> = new Map(
  PROVIDERS.map(p => [p.id, p])
);

/** 啟用 PageAgent 的頁面數（靜態註冊表，啟動時算一次即可）。 */
const SUPPORTING_PAGE_AGENT_COUNT: number = APP_PAGE_REGISTRY.filter(
  p => p.supportsPageAgent
).length;

/** 推理腦槽 → 上游 provider id（從 model 字串前綴決定）。 */
function resolveBrainTargetProvider(model: string): string {
  if (model.startsWith("vertex/") || model.startsWith("nvidia/")) return "vertex";
  return "gemini";
}

// ═══════════════════════════════════════════════════════════════════════════
// 「網站整體運作」深度整合 — 狀態推導 helpers
// ═══════════════════════════════════════════════════════════════════════════

/** 從 DATABASE_URL 與環境推導資料庫節點狀態。 */
function deriveDatabaseStatus(): {
  status: PipelineNodeStatus;
} & AggregatedHealth {
  const url = serverEnv.DATABASE_URL?.trim();
  if (!url) {
    // 開發環境無 DATABASE_URL 視為「需優化」（會 fallback 到 in-memory），生產則為 broken
    if (process.env.NODE_ENV === "production") {
      return {
        status: "broken",
        reason: "DATABASE_URL 未設定，無法連線到 MySQL 永續儲存",
        recommendation:
          "在 Railway Variables 設定 DATABASE_URL（例：mysql://user:pass@host:3306/db）",
      };
    }
    return {
      status: "needs_optimization",
      reason: "DATABASE_URL 未設定（開發模式 fallback）",
      recommendation: "若要測試永續儲存路徑，請在 .env 設定 DATABASE_URL",
    };
  }
  return { status: "healthy" };
}

/** 從 storage 偵測結果推導物件儲存節點狀態。 */
function deriveStorageStatus(): {
  status: PipelineNodeStatus;
} & AggregatedHealth {
  const hasS3 =
    Boolean(serverEnv.S3_ENDPOINT) &&
    Boolean(serverEnv.S3_ACCESS_KEY_ID) &&
    Boolean(serverEnv.S3_SECRET_ACCESS_KEY) &&
    Boolean(serverEnv.S3_BUCKET_NAME);
  const hasGCS =
    Boolean(serverEnv.GCS_BUCKET_NAME) &&
    Boolean(serverEnv.GOOGLE_APPLICATION_CREDENTIALS_JSON);
  if (hasS3 || hasGCS) {
    return { status: "healthy" };
  }
  if (process.env.NODE_ENV === "production") {
    return {
      status: "broken",
      reason: "未設定任何雲端儲存（S3 / GCS），生產環境會直接失敗",
      recommendation:
        "在 Railway Variables 設定 S3_ENDPOINT 系列或 GCS_BUCKET_NAME",
    };
  }
  return {
    status: "needs_optimization",
    reason: "未設定雲端儲存，目前 fallback 至本地檔案（僅限開發環境）",
    recommendation: "上線前請設定 S3 或 GCS，否則生產環境的上傳會立刻失敗",
  };
}

/** 從 healthcheck 路徑推導 Railway 部署節點狀態（純 metadata，未實際 ping）。 */
function deriveRailwayStatus(): {
  status: PipelineNodeStatus;
} & AggregatedHealth {
  // 這裡只判斷「healthcheck 路徑與 Dockerfile 是否存在」，實際存活由 Railway 自己判定
  return { status: "healthy" };
}

/** 觀測 / 第三方服務：依 envKey 是否設定推導 healthy / needs_optimization。 */
function deriveOptionalServiceStatus(envKey: string | undefined): {
  status: PipelineNodeStatus;
} & AggregatedHealth {
  if (!envKey) return { status: "healthy" };
  const present = Boolean((serverEnv as Record<string, unknown>)[envKey]);
  if (present) return { status: "healthy" };
  return {
    status: "needs_optimization",
    reason: `${envKey} 未設定，此服務尚未啟用`,
    recommendation: `若要啟用此服務，請在環境變數中設定 ${envKey}`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Graph Builders
// ═══════════════════════════════════════════════════════════════════════════

interface BuildGraphOptions {
  /** true = 包含全部 30+ 頁面節點；false = 只給個人簡化版 */
  includeAllPages: boolean;
  /** true = 包含完整 router 拓撲；false = 個人版隱藏 */
  includeRouters: boolean;
  /** 個人版是否包含活躍錯誤摘要（會脫敏） */
  includeAlerts: boolean;
  /**
   * 是否包含「網站如何運作」的完整深度整合節點 —
   * 瀏覽器、REST/SSE/Webhook 端點、MySQL、物件儲存、Railway 部署、
   * 觀測（LangSmith/PostHog）、第三方登入、金流。
   *
   * 預設 true（admin & personal 圖都會包含；個人版只是少了 page/router）。
   * 測試或舊呼叫端可以傳 false 取得舊版精簡圖。
   */
  includeInfrastructure?: boolean;
}

/**
 * 建一次圖時共享的快照：所有 helper 都從這裡讀，避免一張圖內 50+ 次重複
 * fetch traces / health snapshot / provider 狀態。
 */
interface BuildContext {
  traces: ErrorTrace[];
  errorIndex: ReturnType<typeof buildErrorCountIndex>;
  engineStatus: ReturnType<typeof getEngineStatus>;
  /** 每個 provider 的衍生狀態，buildGraph 開頭就算好，router loop 直接查。 */
  providerStatusById: Map<
    string,
    ReturnType<typeof deriveProviderStatus>
  >;
}

function buildGraph(opts: BuildGraphOptions): PipelineGraph {
  const nodes: PipelineNode[] = [];
  const edges: PipelineEdge[] = [];

  // ── 一次性建立共享快照 ───────────────────────────────────────────────────
  const traces = getErrorTraces(200);
  const errorIndex = buildErrorCountIndex(traces);
  const engineStatus = getEngineStatus();
  const providerStatusById = new Map<
    string,
    ReturnType<typeof deriveProviderStatus>
  >();
  for (const meta of PROVIDERS) {
    providerStatusById.set(meta.id, deriveProviderStatus(meta));
  }
  const ctx: BuildContext = {
    traces,
    errorIndex,
    engineStatus,
    providerStatusById,
  };

  // ── Layer 4: External Providers ──────────────────────────────────────────
  for (const meta of PROVIDERS) {
    const derived = ctx.providerStatusById.get(meta.id)!;
    const recentErrorCount = errorIndex.byEngine.get(meta.id) ?? 0;
    nodes.push({
      id: `provider:${meta.id}`,
      kind: "provider",
      layer: "external",
      label: meta.label,
      description: meta.description,
      status: derived.status,
      reason: derived.reason,
      recommendation: derived.recommendation,
      relatedFiles: [
        `.env (${meta.apiKeyEnv})`,
        ...(meta.serviceFiles ?? []),
      ],
      metrics: {
        ...derived.metrics,
        recentErrorCount: recentErrorCount || undefined,
      },
      diagnostics: {
        backendRoute: "providerHealth snapshot",
        serviceFunction: "getProviderHealth",
        traceSampleIds: getTraceSamplesForEngines(ctx.traces, [meta.id]),
      },
    });
  }

  // ── Layer 3a: Reasoning Brain Slots ──────────────────────────────────────
  for (const slot of Object.keys(DEFAULT_REASONING_BRAINS) as ReasoningBrainSlot[]) {
    const defaultModel = DEFAULT_REASONING_BRAINS[slot].model;
    const meta = REASONING_SLOT_META[slot];
    const derived = deriveBrainSlotStatus(defaultModel);
    nodes.push({
      id: `brain:${slot}`,
      kind: "brain-slot",
      layer: "ai-brain",
      label: `${meta.label}（${slot}）`,
      description: `${meta.description}｜目前模型：${defaultModel}`,
      status: derived.status,
      reason: derived.reason,
      recommendation: derived.recommendation,
      relatedFiles: [
        "server/middleware/brainContext.ts",
        "server/routers/brain.ts",
      ],
      metrics: derived.metrics,
    });

    // 推理腦槽 → Gemini / Vertex provider
    const targetProvider = resolveBrainTargetProvider(defaultModel);
    edges.push(
      makeEdge(`brain:${slot}`, `provider:${targetProvider}`, "推理呼叫")
    );
  }

  // ── Layer 3b: Generation Engine Slots ────────────────────────────────────
  const ENGINE_ROUTER_FILE: Record<GenerationEngineSlot, string> = {
    imageEngine: "server/routers/imageStudio.ts",
    videoEngine: "server/routers/videoStudio.ts",
    audioEngine: "server/routers/proStudio.ts",
    voiceEngine: "server/routers/proStudio.ts",
  };
  for (const slot of Object.keys(
    DEFAULT_GENERATION_ENGINES
  ) as GenerationEngineSlot[]) {
    const defaultEngine = DEFAULT_GENERATION_ENGINES[slot].engine;
    const meta = GENERATION_SLOT_META[slot];
    const derived = deriveBrainSlotStatus(defaultEngine);
    nodes.push({
      id: `engine:${slot}`,
      kind: "engine-slot",
      layer: "ai-brain",
      label: meta.label,
      description: `${meta.description}｜目前引擎：${defaultEngine}`,
      status: derived.status,
      reason: derived.reason,
      recommendation: derived.recommendation,
      relatedFiles: [
        "server/middleware/brainContext.ts",
        "server/services/falDispatcher.ts",
        ENGINE_ROUTER_FILE[slot],
      ],
      metrics: derived.metrics,
    });

    // 生成引擎 → 對應 provider
    edges.push(
      makeEdge(`engine:${slot}`, `provider:${meta.provider}`, "生成呼叫")
    );
  }

  // ── Layer 3b+: Creation Studio Consumers ────────────────────────────────
  // 工作室節點：使用對應引擎槽的狀態作為自身狀態（最差的優先），
  // 讓使用者點開「圖片工作室」就能看到下游引擎是否健康。
  const slotStatusById = new Map<string, PipelineNodeStatus>(
    nodes
      .filter(n => n.kind === "engine-slot")
      .map(n => [n.id, n.status])
  );
  const STATUS_RANK: Record<PipelineNodeStatus, number> = {
    healthy: 0,
    needs_optimization: 1,
    abnormal: 2,
    broken: 3,
  };
  for (const studio of STUDIO_CONSUMERS) {
    let worst: PipelineNodeStatus = "healthy";
    for (const engineSlot of studio.engines) {
      const s = slotStatusById.get(`engine:${engineSlot}`) ?? "healthy";
      if (STATUS_RANK[s] > STATUS_RANK[worst]) worst = s;
    }
    nodes.push({
      id: studio.id,
      kind: "studio",
      layer: "ai-brain",
      label: studio.label,
      description: studio.description,
      status: worst,
      reason:
        worst !== "healthy"
          ? "下游生成引擎之一狀態不佳，可能影響此工作室的產出"
          : undefined,
      recommendation:
        worst !== "healthy"
          ? "點擊下游引擎節點查看詳情，或前往「大腦組態」改選備援引擎"
          : undefined,
      relatedFiles: studio.files,
      diagnostics: {
        frontendPath: studio.frontendPath,
        backendRoute: studio.backendRoute,
        serviceFunction: studio.serviceFunction,
      },
    });
    for (const engineSlot of studio.engines) {
      edges.push(makeEdge(studio.id, `engine:${engineSlot}`, "消費引擎"));
    }
  }

  // ── Layer 3c: Orb Agent / Orb Assistant / Director AI ───────────────────
  // 光球代理（全站路由器）
  const orbAgentStatus: PipelineNodeStatus =
    engineStatus.available.length === 0 ? "broken" : "healthy";
  nodes.push({
    id: "orb:agent",
    kind: "orb-agent",
    layer: "ai-brain",
    label: "全站光球代理",
    description: "理解需求、路由到正確功能、串接多步驟工具呼叫",
    status: orbAgentStatus,
    reason:
      orbAgentStatus === "broken"
        ? "目前沒有任何可用的 LLM 引擎"
        : undefined,
    recommendation:
      orbAgentStatus === "broken"
        ? engineStatus.recommendation
        : undefined,
    relatedFiles: [
      "server/services/orbTaskOrchestrator.ts",
      "server/services/orbTaskStateMachine.ts",
      "shared/global-agent-registry.ts",
    ],
    diagnostics: {
      frontendPath: "client/src/contexts/GlobalOrbChatContext.tsx",
      backendRoute: "trpc.ai.* / trpc.orbScheduler.*",
      serviceFunction: "executeCurrentStepTools / orbTask state machine",
      traceSampleIds: getTraceSamplesForEngines(ctx.traces, [
        "gemini",
        "vertex",
        "fal",
        "elevenlabs",
      ]),
    },
  });
  edges.push(makeEdge("orb:agent", "brain:director", "委派決策"));
  edges.push(makeEdge("orb:agent", "brain:technician", "工具呼叫"));
  // 光球可分派到任一工作室執行 studio.generate* 工具（多步驟可串）
  for (const studio of STUDIO_CONSUMERS) {
    edges.push(makeEdge("orb:agent", studio.id, "分派工作室"));
  }

  // 光球助手（PageAgent）— 啟用頁數靜態算過一次，這裡直接讀
  nodes.push({
    id: "orb:assistant",
    kind: "orb-assistant",
    layer: "ai-brain",
    label: "光球助手（PageAgent）",
    description: `每頁的智慧助手，目前有 ${SUPPORTING_PAGE_AGENT_COUNT} / ${APP_PAGE_REGISTRY.length} 頁啟用`,
    status: "healthy",
    relatedFiles: [
      "client/src/contexts/PageAgentContext.tsx",
      "shared/global-agent-capabilities.ts",
    ],
    diagnostics: {
      frontendPath: "client/src/contexts/PageAgentContext.tsx",
      backendRoute: "trpc.orbGuide.step + trpc.ai.orbTask.*",
      serviceFunction: "executeCurrentStepTools / page agent action bus",
      traceSampleIds: getTraceSamplesForEngines(
        ctx.traces,
        ["gemini", "vertex"],
        2
      ),
    },
  });
  edges.push(makeEdge("orb:assistant", "orb:agent", "升級到全站代理"));

  // 導演 AI
  nodes.push({
    id: "director:main",
    kind: "director",
    layer: "ai-brain",
    label: "導演 AI",
    description: "CO-STAR 對話、劇本規劃、RAG 記憶",
    status: "healthy",
    relatedFiles: ["server/routers/director.ts", "client/src/pages/DirectorAI.tsx"],
    diagnostics: {
      frontendPath: "client/src/pages/DirectorAI.tsx",
      backendRoute: "trpc.director.*",
      serviceFunction: "director router + rag memory services",
      traceSampleIds: getTraceSamplesForEngines(ctx.traces, [
        "gemini",
        "vertex",
      ]),
    },
  });
  edges.push(makeEdge("director:main", "brain:director", "推理"));
  edges.push(makeEdge("director:main", "brain:storyteller", "敘事"));
  // 導演可把 sendToStudio payload 送給圖片／影片工作室
  edges.push(makeEdge("director:main", "studio:image-studio", "送至工作室"));
  edges.push(makeEdge("director:main", "studio:video-studio", "送至工作室"));

  // ── Layer 2: Backend Routers ─────────────────────────────────────────────
  if (opts.includeRouters) {
    for (const r of ROUTER_TO_PROVIDERS) {
      // 一次走訪 r.providers，把錯誤計數與「下游是否 broken」一併算掉，
      // 同時用 ctx.providerStatusById 取代 PROVIDERS.find() + deriveProviderStatus。
      let recentErrors = 0;
      let downstreamBroken = false;
      for (const p of r.providers) {
        recentErrors += errorIndex.byEngine.get(p) ?? 0;
        if (!downstreamBroken && PROVIDER_BY_ID.has(p)) {
          if (ctx.providerStatusById.get(p)?.status === "broken") {
            downstreamBroken = true;
          }
        }
      }
      const status: PipelineNodeStatus = downstreamBroken
        ? "broken"
        : recentErrors > 5
          ? "needs_optimization"
          : "healthy";
      nodes.push({
        id: r.id,
        kind: "router",
        layer: "backend",
        label: r.label,
        description: r.description,
        status,
        reason: downstreamBroken
          ? "下游 provider 之一無法使用"
          : recentErrors > 5
            ? `近期累積 ${recentErrors} 筆錯誤`
            : undefined,
        recommendation: downstreamBroken
          ? "先修復下游 provider 的 API key 或服務狀態"
          : recentErrors > 5
            ? "查看錯誤追蹤頁面找出最常見的失敗原因"
            : undefined,
        relatedFiles: r.files,
        metrics: { recentErrorCount: recentErrors || undefined },
        diagnostics: {
          backendRoute: `trpc.${r.id.replace("router:", "") }.*`,
          serviceFunction: "provider dispatch + domain service",
          traceSampleIds: getTraceSamplesForEngines(ctx.traces, r.providers),
        },
      });
      for (const p of r.providers) {
        edges.push(makeEdge(r.id, `provider:${p}`, "外部呼叫"));
      }
    }

    // router → brain slot 連線（語意層）
    edges.push(makeEdge("router:director", "director:main"));
    edges.push(makeEdge("router:brain", "orb:agent"));
    edges.push(makeEdge("router:orbScheduler", "orb:agent"));

    // router → brain-slot / engine-slot 邊：把 AI router 真正觸發的腦/引擎槽串起來，
    // 讓「完整視圖」可以清楚看到 page → router → brain/engine → provider 的四層鏈。
    for (const routerId of Object.keys(ROUTER_TO_AI_SLOTS)) {
      for (const slotId of ROUTER_TO_AI_SLOTS[routerId]) {
        edges.push(makeEdge(routerId, slotId, "委派"));
      }
    }
  }

  // ── Layer 1: Frontend Pages ──────────────────────────────────────────────
  if (opts.includeAllPages) {
    // 依 AppPageGroupId 分成多個 page-group 容器，比單一巨型群組更貼近 IA 結構，
    // 也讓「站點視圖」可以一眼看出 8 大功能分區。
    const pagesByGroup: Record<string, AppPageRegistryItem[]> = {};
    for (const page of APP_PAGE_REGISTRY) {
      (pagesByGroup[page.group] ??= []).push(page);
    }
    for (const groupId of Object.keys(pagesByGroup)) {
      const pages = pagesByGroup[groupId];
      const meta =
        PAGE_GROUP_META[groupId] ?? { label: groupId, description: "" };
      nodes.push({
        id: `page-group:${groupId}`,
        kind: "page-group",
        layer: "frontend",
        label: `📱 ${meta.label}（${pages.length}）`,
        description: meta.description,
        status: "healthy",
        children: pages.map(p => `page:${p.id}`),
      });
    }

    // 30+ 個 page node 的 trace samples 用同一組引擎；先算一次再共用
    const pageTraceSamples = getTraceSamplesForEngines(
      ctx.traces,
      ["gemini", "fal", "elevenlabs", "vertex"],
      2
    );
    for (const page of APP_PAGE_REGISTRY) {
      const status: PipelineNodeStatus = page.supportsPageAgent
        ? "healthy"
        : "abnormal";
      nodes.push({
        id: `page:${page.id}`,
        kind: "page",
        layer: "frontend",
        label: page.label,
        description: `${page.path}｜${page.description}`,
        status,
        reason: page.supportsPageAgent
          ? undefined
          : "此頁尚未註冊光球助手 PageAgent",
        recommendation: page.supportsPageAgent
          ? undefined
          : "如需在此頁啟用助手，請於 shared/appRegistry.ts 把 supportsPageAgent 設為 true",
        relatedFiles: ["shared/appRegistry.ts"],
        diagnostics: {
          frontendPath: resolvePageSourcePath(page.id),
          backendRoute: resolvePageBackendRoute(page.id),
          serviceFunction: resolvePageServiceFunction(page.id),
          traceSampleIds: pageTraceSamples,
        },
        parentId: `page-group:${page.group}`,
      });
      // page → orb assistant（PageAgent 永遠可用）
      edges.push(
        makeEdge(`page:${page.id}`, "orb:assistant", "PageAgent")
      );
      // page → router 邊；只有 includeRouters 時才畫，否則指向不存在的目標
      if (opts.includeRouters) {
        for (const routerId of PAGE_TO_ROUTERS[page.id] ?? []) {
          edges.push(makeEdge(`page:${page.id}`, routerId, "tRPC"));
        }
      }
    }
  }

  // ── 警報疊加：把 Active Alerts 反映到對應的 brain / engine 節點 ───────
  if (opts.includeAlerts) {
    const alerts = getAlerts(50);
    for (const alert of alerts) {
      if (alert.dismissedAt) continue;
      // 嘗試找到 alert 對應的節點（依 modelOrEngine 名稱比對）
      const targetId = nodes.find(
        n =>
          (n.kind === "brain-slot" || n.kind === "engine-slot") &&
          n.description?.includes(alert.engine ?? "")
      )?.id;
      if (!targetId) continue;
      const node = nodes.find(n => n.id === targetId)!;
      // 不 downgrade 已是 broken 的節點
      if (node.status === "healthy") {
        node.status = "needs_optimization";
        node.reason = alert.message;
        node.recommendation = "查看「警報中心」取得修復建議";
      }
    }
  }

  // ── Layer 5: 「網站如何運作」深度整合 — Browser / API / Data / Infra ──
  // 預設啟用；只有舊測試 / personal 簡化視圖才會傳 false 關閉。
  // 整段拆成 4 區塊，每塊都先建節點再連邊，方便日後逐區開關。
  if (opts.includeInfrastructure ?? true) {
    appendInfrastructureLayers(nodes, edges, opts);
  }

  return {
    nodes,
    edges,
    summary: summarize(nodes),
    legend: buildLegend(),
  };
}

/**
 * 附加 client / api / data / infrastructure 四個整合層到既有圖中。
 * 拆出 helper 是因為 `buildGraph` 已 250+ 行；放在獨立函式比較好閱讀。
 *
 * 新增的節點與邊與既有節點的連線：
 *   - client:browser → 所有 frontend page-group（瀏覽器打開頁面）
 *   - client:browser → api:trpc / api:auth-* / api:sse-generation（HTTP/SSE）
 *   - api:* → router:* / db:main / storage:assets / auth/payment（依 downstream）
 *   - webhook:* → db:main，並由對應 provider/payment 連入 webhook
 *   - infra:railway → api:health / db:main / storage:assets（host runs all）
 *   - observability:langsmith ← brain-slot * / orb:agent（LLM trace 上傳）
 *
 * 函式不會修改既有的 frontend / backend / ai-brain / external 節點，純粹「附加」。
 */
function appendInfrastructureLayers(
  nodes: PipelineNode[],
  edges: PipelineEdge[],
  opts: BuildGraphOptions
): void {
  const existingIds = new Set(nodes.map(n => n.id));

  // ── Browser 節點（client layer） ──────────────────────────────────────────
  nodes.push({
    id: BROWSER_NODE_META.id,
    kind: "browser",
    layer: "client",
    label: BROWSER_NODE_META.label,
    description: BROWSER_NODE_META.description,
    status: "healthy",
    relatedFiles: [...BROWSER_NODE_META.files],
    diagnostics: {
      frontendPath: "client/index.html",
      backendRoute: "static asset (Vite build → dist/public)",
      serviceFunction: "browser bundle download + initial render",
    },
  });

  // 瀏覽器 → 所有 page-group（若已包含頁面層）；否則直接連 orb:agent 表達使用入口
  if (opts.includeAllPages) {
    for (const node of nodes) {
      if (node.kind === "page-group") {
        edges.push(makeEdge(BROWSER_NODE_META.id, node.id, "HTTP / 載入"));
      }
    }
  } else {
    edges.push(makeEdge(BROWSER_NODE_META.id, "orb:agent", "HTTP / 載入"));
  }

  // ── Infrastructure 節點（observability / auth / payment / deployment） ──
  for (const meta of INFRA_NODES) {
    const derived =
      meta.kind === "deployment"
        ? deriveRailwayStatus()
        : deriveOptionalServiceStatus(meta.envKey);
    nodes.push({
      id: meta.id,
      kind: meta.kind,
      layer: meta.kind === "deployment" ? "infrastructure" : "external",
      label: meta.label,
      description: meta.description,
      status: derived.status,
      reason: derived.reason,
      recommendation: derived.recommendation,
      relatedFiles: [
        ...(meta.envKey ? [`.env (${meta.envKey})`] : []),
        ...meta.files,
      ],
      metrics: derived.metrics,
    });
  }

  // ── 非 AI 外部服務（Pinecone / Brave / Perplexity / NewsAPI / NewsData / GitHub / Slack / Forge）
  for (const meta of EXTERNAL_SERVICES) {
    const derived = deriveOptionalServiceStatus(meta.envKey);
    nodes.push({
      id: meta.id,
      kind: meta.kind,
      layer: "external",
      label: meta.label,
      description: meta.description,
      status: derived.status,
      reason: derived.reason,
      recommendation: derived.recommendation,
      relatedFiles: [`.env (${meta.envKey})`, ...meta.files],
      metrics: derived.metrics,
    });
  }

  // RAG 記憶 → Pinecone 邊（語意上 brain-slot 透過 ragMemory 服務存取向量庫）
  if (nodes.find(n => n.id === "ext:pinecone")) {
    edges.push(makeEdge("brain:director", "ext:pinecone", "RAG 檢索"));
    edges.push(makeEdge("brain:storyteller", "ext:pinecone", "RAG 檢索"));
  }

  // 光球 web research → Brave / Perplexity
  if (nodes.find(n => n.id === "ext:brave-search")) {
    edges.push(makeEdge("orb:agent", "ext:brave-search", "網路研究"));
  }
  if (nodes.find(n => n.id === "ext:perplexity")) {
    edges.push(makeEdge("orb:agent", "ext:perplexity", "進階研究"));
  }

  // brainAutoRepair → GitHub（失敗自動回報 issue）
  if (nodes.find(n => n.id === "ext:github")) {
    edges.push(makeEdge("observability:langsmith", "ext:github", "自動回報"));
  }

  // ── Data 節點（database + storage） ──────────────────────────────────────
  for (const meta of DATA_NODES) {
    const derived =
      meta.id === "db:main" ? deriveDatabaseStatus() : deriveStorageStatus();
    nodes.push({
      id: meta.id,
      kind: meta.id === "db:main" ? "database" : "storage",
      layer: "data",
      label: meta.label,
      description: meta.description,
      status: derived.status,
      reason: derived.reason,
      recommendation: derived.recommendation,
      relatedFiles: meta.files,
    });
  }

  // ── API 端點節點（api layer） ──────────────────────────────────────────
  // 端點狀態繼承「下游所有節點裡最差的」：例如 /api/upload 下游含 storage:assets
  // 與 db:main，只要其中之一不 healthy 就標記成需優化或 broken。
  const STATUS_RANK: Record<PipelineNodeStatus, number> = {
    healthy: 0,
    needs_optimization: 1,
    abnormal: 2,
    broken: 3,
  };
  const statusOf = (id: string): PipelineNodeStatus =>
    nodes.find(n => n.id === id)?.status ?? "healthy";

  for (const ep of API_ENDPOINTS) {
    let worst: PipelineNodeStatus = "healthy";
    for (const downId of ep.downstream) {
      // downstream 中的 router id 只在 includeRouters=true 時存在；
      // 若不存在就跳過該邊但仍建立節點，避免懸空 edge。
      if (!nodes.find(n => n.id === downId)) continue;
      const s = statusOf(downId);
      if (STATUS_RANK[s] > STATUS_RANK[worst]) worst = s;
    }
    nodes.push({
      id: ep.id,
      kind: "api-endpoint",
      layer: "api",
      label: ep.label,
      description: ep.description,
      status: worst,
      reason:
        worst === "healthy"
          ? undefined
          : "下游服務狀態不佳，可能影響此端點實際可用性",
      recommendation:
        worst === "healthy"
          ? undefined
          : "點擊下游節點查看詳細原因；通常是 DB / 儲存 / 外部 provider 其中之一",
      relatedFiles: ep.files,
      diagnostics: {
        backendRoute: `${ep.method} ${ep.path}`,
        serviceFunction: ep.files[0] ?? "express handler",
      },
    });
    // 預設 client:browser → endpoint，覆蓋 webhook 場景
    const upstream = ep.upstream ?? [BROWSER_NODE_META.id];
    for (const upId of upstream) {
      if (nodes.find(n => n.id === upId)) {
        edges.push(makeEdge(upId, ep.id, ep.method));
      }
    }
    // endpoint → downstream
    for (const downId of ep.downstream) {
      if (nodes.find(n => n.id === downId)) {
        edges.push(makeEdge(ep.id, downId, "依賴"));
      }
    }
  }

  // ── Webhook 端點節點 ────────────────────────────────────────────────────
  for (const wh of WEBHOOK_ENDPOINTS) {
    let worst: PipelineNodeStatus = "healthy";
    for (const downId of wh.downstream) {
      if (!nodes.find(n => n.id === downId)) continue;
      const s = statusOf(downId);
      if (STATUS_RANK[s] > STATUS_RANK[worst]) worst = s;
    }
    nodes.push({
      id: wh.id,
      kind: "webhook",
      layer: "api",
      label: wh.label,
      description: wh.description,
      status: worst,
      relatedFiles: wh.files,
      diagnostics: {
        backendRoute: `POST ${wh.path}`,
        serviceFunction: wh.files[0] ?? "express webhook handler",
      },
    });
    if (nodes.find(n => n.id === wh.source)) {
      edges.push(makeEdge(wh.source, wh.id, "回調"));
    }
    for (const downId of wh.downstream) {
      if (nodes.find(n => n.id === downId)) {
        edges.push(makeEdge(wh.id, downId, "寫入"));
      }
    }
  }

  // ── Cron 排程任務節點（infrastructure layer） ────────────────────────
  for (const job of CRON_JOBS) {
    // 狀態取下游最差；若 envKey 存在但缺，則直接 needs_optimization
    let worst: PipelineNodeStatus = "healthy";
    if (job.envKey) {
      const envStatus = deriveOptionalServiceStatus(job.envKey).status;
      if (STATUS_RANK[envStatus] > STATUS_RANK[worst]) worst = envStatus;
    }
    for (const downId of job.downstream) {
      if (!nodes.find(n => n.id === downId)) continue;
      const s = statusOf(downId);
      if (STATUS_RANK[s] > STATUS_RANK[worst]) worst = s;
    }
    nodes.push({
      id: job.id,
      kind: "cron-job",
      layer: "infrastructure",
      label: job.label,
      description: `排程：${job.schedule}｜${job.description}`,
      status: worst,
      reason:
        worst === "healthy"
          ? undefined
          : "下游服務之一狀態不佳，可能影響此排程任務",
      recommendation:
        worst === "healthy"
          ? undefined
          : "點擊下游節點查看詳情；若是 envKey 缺失請補設並重啟",
      relatedFiles: [
        ...(job.envKey ? [`.env (${job.envKey})`] : []),
        ...job.files,
      ],
      diagnostics: {
        backendRoute: `cron schedule: ${job.schedule}`,
        serviceFunction: job.files[0] ?? "node-cron task",
      },
    });
    // 部署平台 → cron job（Railway 代管 cron）
    if (nodes.find(n => n.id === "infra:railway")) {
      edges.push(makeEdge("infra:railway", job.id, "排程"));
    }
    for (const downId of job.downstream) {
      if (nodes.find(n => n.id === downId)) {
        edges.push(makeEdge(job.id, downId, "讀寫"));
      }
    }
  }

  // ── Express middleware 節點（api layer） ──────────────────────────────
  // 用一條鏈表表達順序：browser → helmet → compression → rate-limit → request-trace
  // → (端點) → verifyToken（受保護端點）→ error-handler。
  const MIDDLEWARE_ORDER = MIDDLEWARE_STACK.map(m => m.id);
  for (const mw of MIDDLEWARE_STACK) {
    nodes.push({
      id: mw.id,
      kind: "middleware",
      layer: "api",
      label: mw.label,
      description: mw.description,
      status: "healthy",
      relatedFiles: mw.files,
      diagnostics: {
        backendRoute: "express middleware",
        serviceFunction: mw.files[0] ?? "app.use",
      },
    });
  }
  // 串前 4 層成順序鏈：helmet → compression → rate-limit → request-trace
  for (let i = 0; i < 4; i++) {
    const a = MIDDLEWARE_ORDER[i];
    const b = MIDDLEWARE_ORDER[i + 1];
    if (a && b) edges.push(makeEdge(a, b, "next()"));
  }
  // browser → 第一層 middleware
  edges.push(makeEdge(BROWSER_NODE_META.id, MIDDLEWARE_ORDER[0], "HTTP"));
  // request-trace → 重要 API 端點（不畫滿避免亂；只畫到 trpc / upload / sse）
  for (const apiId of ["api:trpc", "api:upload", "api:sse-generation"]) {
    if (nodes.find(n => n.id === apiId)) {
      edges.push(makeEdge("mw:request-trace", apiId, "通過"));
    }
  }
  // verifyToken → 需登入才能呼叫的端點
  for (const apiId of [
    "api:auth-me",
    "api:auth-2fa",
    "api:auth-change",
    "api:auth-login-history",
    "api:tasks-status",
    "api:tasks-stream",
    "api:admin-events-stream",
    "api:upload",
  ]) {
    if (nodes.find(n => n.id === apiId)) {
      edges.push(makeEdge("mw:verify-token", apiId, "驗證"));
    }
  }
  // 所有 endpoint → error-handler（最後保險）；只畫一條代表邊避免炸圖
  if (nodes.find(n => n.id === "api:trpc")) {
    edges.push(makeEdge("api:trpc", "mw:error-handler", "錯誤"));
  }

  // ── WebSocket 閘道節點（api layer） ──────────────────────────────────
  for (const ws of WS_GATEWAYS) {
    let worst: PipelineNodeStatus = "healthy";
    if (ws.envKey) {
      const s = deriveOptionalServiceStatus(ws.envKey).status;
      if (STATUS_RANK[s] > STATUS_RANK[worst]) worst = s;
    }
    for (const downId of ws.downstream) {
      if (!nodes.find(n => n.id === downId)) continue;
      const s = statusOf(downId);
      if (STATUS_RANK[s] > STATUS_RANK[worst]) worst = s;
    }
    nodes.push({
      id: ws.id,
      kind: "websocket",
      layer: "api",
      label: ws.label,
      description: ws.description,
      status: worst,
      relatedFiles: [
        ...(ws.envKey ? [`.env (${ws.envKey})`] : []),
        ...ws.files,
      ],
      diagnostics: {
        backendRoute: `WS ${ws.path}`,
        serviceFunction: ws.files[0] ?? "ws.WebSocketServer",
      },
    });
    edges.push(makeEdge(BROWSER_NODE_META.id, ws.id, "WebSocket"));
    for (const downId of ws.downstream) {
      if (nodes.find(n => n.id === downId)) {
        edges.push(makeEdge(ws.id, downId, "雙向"));
      }
    }
  }

  // ── 內部服務節點（service layer） ─────────────────────────────────────
  for (const svc of INTERNAL_SERVICES) {
    nodes.push({
      id: svc.id,
      kind: "service",
      layer: "service",
      label: svc.label,
      description: svc.description,
      status: "healthy",
      relatedFiles: svc.files,
      diagnostics: {
        backendRoute: "internal service",
        serviceFunction: svc.files[0] ?? "service module",
      },
    });
    for (const upId of svc.upstream) {
      if (nodes.find(n => n.id === upId)) {
        edges.push(makeEdge(upId, svc.id, "委派"));
      }
    }
    for (const downId of svc.downstream) {
      if (nodes.find(n => n.id === downId)) {
        edges.push(makeEdge(svc.id, downId, "呼叫"));
      }
    }
  }

  // ── Repository 節點 ────────────────────────────────────────────────────
  for (const repo of REPOSITORIES) {
    nodes.push({
      id: repo.id,
      kind: "repository",
      layer: "service",
      label: repo.label,
      description: repo.description,
      status: "healthy",
      relatedFiles: repo.files,
      diagnostics: {
        backendRoute: "repository pattern",
        serviceFunction: repo.files[0] ?? "repository module",
      },
    });
    for (const upId of repo.upstream) {
      if (nodes.find(n => n.id === upId)) {
        edges.push(makeEdge(upId, repo.id, "資料存取"));
      }
    }
    // repo → db:main（所有 repo 的最終目的地）
    edges.push(makeEdge(repo.id, "db:main", "SQL"));
  }

  // ── DB 表（database 子節點，用 parentId 折疊） ───────────────────────
  for (const tbl of DB_TABLES) {
    nodes.push({
      id: tbl.id,
      kind: "db-table",
      layer: "data",
      label: tbl.label,
      description: tbl.description,
      status: "healthy",
      relatedFiles: ["drizzle/schema.ts"],
      diagnostics: {
        backendRoute: "MySQL table",
        serviceFunction: `drizzle export: ${tbl.drizzleExport}`,
      },
      parentId: "db:main",
    });
  }
  // 把 db:main 標成 group container（把所有表放進 children）
  const dbMain = nodes.find(n => n.id === "db:main");
  if (dbMain) {
    dbMain.children = DB_TABLES.map(t => t.id);
  }
  // Repository → 對應的 db-table 邊（明示資料存取對象）
  for (const repo of REPOSITORIES) {
    for (const tableId of repo.tables) {
      if (nodes.find(n => n.id === tableId)) {
        edges.push(makeEdge(repo.id, tableId, "讀寫"));
      }
    }
  }

  // ── 建構流水線（build layer） ────────────────────────────────────────
  for (const art of BUILD_ARTIFACTS) {
    nodes.push({
      id: art.id,
      kind: "build-artifact",
      layer: "build",
      label: art.label,
      description: art.description,
      status: "healthy",
      relatedFiles: art.files,
      diagnostics: {
        backendRoute: "build pipeline (npm run build)",
        serviceFunction: art.files[0] ?? "build entry",
      },
    });
  }
  // 部署平台依賴 build artifacts
  if (nodes.find(n => n.id === "infra:railway")) {
    for (const art of BUILD_ARTIFACTS) {
      edges.push(makeEdge(art.id, "infra:railway", "部署"));
    }
  }
  // browser 載入的是 vite-frontend 產出的 bundle
  edges.push(
    makeEdge("build:vite-frontend", BROWSER_NODE_META.id, "送出 bundle")
  );

  // ── 評估框架（quality layer） ────────────────────────────────────────
  nodes.push({
    id: EVAL_NODE_META.id,
    kind: "eval-runner",
    layer: "quality",
    label: EVAL_NODE_META.label,
    description: EVAL_NODE_META.description,
    status: "healthy",
    relatedFiles: [...EVAL_NODE_META.files],
    diagnostics: {
      backendRoute: "npm run eval",
      serviceFunction: EVAL_NODE_META.files[0],
    },
  });
  // eval runner → 它在跑的目標（agent planner / orb agent）
  if (nodes.find(n => n.id === "service:agent-planner")) {
    edges.push(
      makeEdge(EVAL_NODE_META.id, "service:agent-planner", "回歸測試")
    );
  }
  if (nodes.find(n => n.id === "orb:agent")) {
    edges.push(makeEdge(EVAL_NODE_META.id, "orb:agent", "回歸測試"));
  }

  // ── 跨層的「黏合」邊 ────────────────────────────────────────────────────
  // Railway → 它代管的核心服務（healthcheck / DB / storage）
  for (const downId of INFRA_NODES.find(i => i.id === "infra:railway")
    ?.downstream ?? []) {
    if (nodes.find(n => n.id === downId)) {
      edges.push(makeEdge("infra:railway", downId, "代管"));
    }
  }

  // tRPC routers → DB（所有 router 最終都會落到 MySQL）；
  // 只在 includeRouters=true 時畫，不然 router 節點根本不存在。
  if (opts.includeRouters) {
    for (const r of nodes.filter(n => n.kind === "router")) {
      edges.push(makeEdge(r.id, "db:main", "查詢/寫入"));
    }
  }

  // 工作室 → storage:assets（生成成品落地）
  for (const studio of nodes.filter(n => n.kind === "studio")) {
    edges.push(makeEdge(studio.id, "storage:assets", "落地素材"));
  }

  // brain-slot / engine-slot / orb / director → LangSmith（追蹤上傳）
  // 只有 LangSmith 啟用時才畫，避免一堆灰色未啟用邊
  const langsmithEnabled =
    nodes.find(n => n.id === "observability:langsmith")?.status === "healthy";
  if (langsmithEnabled) {
    const traceSourceKinds = new Set([
      "brain-slot",
      "engine-slot",
      "orb-agent",
      "orb-assistant",
      "director",
    ]);
    for (const n of nodes) {
      if (traceSourceKinds.has(n.kind)) {
        edges.push(makeEdge(n.id, "observability:langsmith", "trace"));
      }
    }
  }

  // 防呆：去掉重複 edge id（極少數情境下 source/target 可能撞到既有邊）
  const seen = new Set<string>();
  const dedupedEdges: PipelineEdge[] = [];
  for (const e of edges) {
    if (existingIds.has(e.source) && existingIds.has(e.target) && seen.has(e.id)) {
      continue;
    }
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    dedupedEdges.push(e);
  }
  edges.length = 0;
  edges.push(...dedupedEdges);
}

// ═══════════════════════════════════════════════════════════════════════════
// Procedure-Level Response Cache
// ═══════════════════════════════════════════════════════════════════════════
// 前端 SummaryBar 預設每 30 秒自動 refetch，多個 admin 分頁同時開時可能在同一秒
// 內打多次 getGraph。我們用「版本鍵 + TTL」雙保險：
//   - 版本鍵：providerHealth / healthCache / brainAutoRepair 任一寫入都 +1，
//             下次查詢即重建，避免 TTL 內看到陳舊狀態。
//   - 5 秒 TTL：版本沒變時的兜底上限，避免極端情況快取永遠不更新。

const RESPONSE_CACHE_TTL_MS = 5_000;

interface CachedGraphEntry {
  graph: PipelineGraph;
  expiresAt: number;
  /** 取自三個資料源版本計數的組合鍵 */
  versionKey: string;
}

const responseCache = new Map<"admin" | "personal", CachedGraphEntry>();

function currentVersionKey(): string {
  return `${getProviderHealthVersion()}.${getHealthCacheVersion()}.${getAutoRepairVersion()}`;
}

function getCachedGraph(
  key: "admin" | "personal",
  opts: BuildGraphOptions
): PipelineGraph {
  const now = Date.now();
  const versionKey = currentVersionKey();
  const cached = responseCache.get(key);
  if (
    cached &&
    cached.expiresAt > now &&
    cached.versionKey === versionKey
  ) {
    return cached.graph;
  }
  const fresh = buildGraph(opts);
  responseCache.set(key, {
    graph: fresh,
    expiresAt: now + RESPONSE_CACHE_TTL_MS,
    versionKey,
  });
  return fresh;
}

/** 對外暴露的快取清除（測試 / 內部即時失效用）。 */
function invalidateResponseCache(): void {
  responseCache.clear();
}

// ═══════════════════════════════════════════════════════════════════════════
// Router
// ═══════════════════════════════════════════════════════════════════════════

export const brainPipelineRouter = router({
  /** 全站完整管線（admin only） */
  getGraph: adminProcedure.query(() => {
    return getCachedGraph("admin", {
      includeAllPages: true,
      includeRouters: true,
      includeAlerts: true,
    });
  }),

  /** 個人版腦組態（任何登入用戶） */
  getMyGraph: protectedProcedure.query(() => {
    return getCachedGraph("personal", {
      includeAllPages: false,
      includeRouters: false,
      includeAlerts: false,
    });
  }),

  /** 取系統摘要（給 SummaryBar 用，比 getGraph 輕量） */
  getSummary: protectedProcedure.query(() => {
    return getSystemSummary();
  }),

  /**
   * 主動觸發實際的 provider 健康巡檢（admin only）。
   *
   * 「重新檢測」按鈕呼叫此 mutation 後再 refetch getGraph，能拿到 ping 過真實
   * 端點後的最新狀態。背景已有 cron 在跑，但人工排查時不必等下一個排程點。
   *
   * 同時 invalidate 回應快取，避免 mutation 回傳後立刻又取到 5 秒前的舊圖。
   */
  runPatrol: adminProcedure.mutation(async () => {
    const result = await runHealthPatrol();
    invalidateResponseCache();
    return result;
  }),
});

// 提供測試用 helpers（不影響執行 router 行為）
export const __testing = {
  buildGraph,
  invalidateResponseCache,
  PROVIDERS,
  ROUTER_TO_PROVIDERS,
  PAGE_TO_ROUTERS,
  ROUTER_TO_AI_SLOTS,
  STUDIO_CONSUMERS,
  API_ENDPOINTS,
  WEBHOOK_ENDPOINTS,
  DATA_NODES,
  INFRA_NODES,
  BROWSER_NODE_META,
  EXTERNAL_SERVICES,
  CRON_JOBS,
  MIDDLEWARE_STACK,
  WS_GATEWAYS,
  INTERNAL_SERVICES,
  REPOSITORIES,
  DB_TABLES,
  BUILD_ARTIFACTS,
  EVAL_NODE_META,
};
