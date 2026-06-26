import { systemRouter } from "./_core/systemRouter";
import {
  publicProcedure,
  protectedProcedure,
  adminProcedure,
  leaderOrAdminProcedure,
  brainProcedure,
  router,
} from "./_core/trpc";
import { isDemoMode } from "./_core/googleAuth";
import { z } from "zod";
import * as db from "./db";
import {
  invokeLLM,
  extractMessageText,
  extractMessageJson,
  LLMPermanentError,
  type Message,
} from "./_core/llm";
import { serverEnv } from "./_core/env.validated";
import { isFlagEnabled } from "./_core/flags";
import {
  ensureFalApiKeyConfigured,
  ensureGeminiApiKeyConfigured,
  isGeminiEngine,
} from "./_core/apiGuards";
import { featureFlags } from "./_core/featureFlags";
import { tryConsumeChatToken } from "./_core/rateLimiter";
import { signWebhookToken } from "./_core/webhookTokens";
import { resolveSafetyFallback } from "./services/security/contentModeration";
// imageGeneration.ts no longer used directly — all 4 modalities go through falDispatcher
import { storagePut } from "./storage";
import { TRPCError } from "@trpc/server";
import { generationBus } from "./generationEvents";
import { newsRouter } from "./routers/news";
import { aiModelsRouter } from "./routers/aiModels";
import { showcaseRouter } from "./routers/showcase";
import { senseRouter } from "./routers/sense";
import { brainRouter } from "./routers/brain";
import { brainPipelineRouter } from "./routers/brainPipeline";
import { proStudioRouter } from "./routers/proStudio";
import { imageStudioRouter } from "./routers/imageStudio";
import { videoStudioRouter } from "./routers/videoStudio";
import { videoProjectRouter } from "./routers/videoProject";
import { learnHubRouter } from "./routers/learnHub";
import { loraTrainerRouter } from "./routers/loraTrainer";
import { modelConsentsRouter } from "./routers/modelConsents";
import { directorRouter } from "./routers/director";
import { worldbuildingRouter } from "./routers/worldbuilding";
import { worldbuildingGenerationRouter } from "./services/worldbuildingGeneration";
import { worldStoryboardRouter } from "./routers/worldStoryboard";
import { creativeProjectRouter } from "./routers/creativeProject";
import { accountRouter } from "./routers/account";
import { commanderRouter } from "./subsystems/commander/commanderRouter";
import {
  contextPacketRouter,
  teamDataRouter,
  dataConnectionsRouter,
} from "./subsystems/contextPackets/contextPacketRouter";
import { teamTrainingRouter } from "./subsystems/trainingTrack/trainingTrackRouter";
import { realEarthRouter } from "./routers/realEarth";
import { teachingArchiveRouter } from "./routers/teachingArchive";
import { teamsRouter } from "./routers/teams";
import { rbacRouter } from "./routers/rbac";
import { spiritRouter } from "./routers/spiritRouter";
import { langsmithRouter } from "./routers/langsmith";
import { promptLibraryRouter } from "./routers/promptLibrary";
import { promptCollectionRouter } from "./routers/promptCollection";
import { externalServicesRouter } from "./routers/externalServices";
import { apiUsageRouter } from "./routers/apiUsage";
import { auditLogRouter } from "./routers/auditLog";
import { workflowRouter } from "./routers/workflow";
import { orbSchedulerRouter } from "./routers/orbSchedulerRouter";
import { agentPreferencesRouter } from "./routers/agentPreferencesRouter";
import { agentModelPicksRouter } from "./routers/agentModelPicksRouter";
import { orbCapabilitiesRouter } from "./routers/orbCapabilitiesRouter";
import { orbProxyRouter } from "./routers/orbProxyRouter";
import { orbConversationsRouter } from "./routers/orbConversationsRouter";
import { adminRouter } from "./routers/adminRouter";
import { agentCollaborationRouter } from "./routers/agentCollaborationRouter";
import { agentCapabilityRouter } from "./routers/agentCapabilityRouter";
import { modelWishesRouter } from "./routers/modelWishesRouter";
import { orchestrationRunsRouter } from "./routers/orchestrationRunsRouter";
import { orbTracesRouter } from "./routers/orbTraces";
import { authRouter } from "./routers/auth";
import { creditsRouter } from "./routers/credits";
import { accountantRouter } from "./routers/accountant";
import { musicSpecialistRouter } from "./routers/musicSpecialist";
import { evaluateRouter } from "./routers/evaluate";
import { directorPreferencesRouter } from "./routers/directorPreferences";
import { notesRouter } from "./routers/notes";
import { scheduleRouter } from "./routers/schedule";
import { driveRouter } from "./routers/drive";
import { feedbackRouter } from "./routers/feedback";
import { vaultRouter } from "./routers/vault";
import { historyRouter } from "./routers/history";
import { studioRouter } from "./routers/studio";
import { plansRouter } from "./routers/plans";
import { customBlocksRouter } from "./routers/customBlocks";
import { blockCombosRouter } from "./routers/blockCombos";
import { adminRouter as adminFullRouter } from "./routers/admin";
import { profileRouter } from "./routers/profile";
import { settingsRouter } from "./routers/settings";
import { dashboardRouter } from "./routers/dashboard";
import { orbMemoryRouter } from "./routers/orbMemory";
import { orbGuideRouter } from "./routers/orbGuide";
import { assetsRouter } from "./routers/assets";
import { modelsRouter } from "./routers/models";
import { getOrchestrator } from "./services/modelClients";
// voiceCompiler, audioCompiler, videoCompiler are no longer used — all modalities route through falDispatcher
import { buildMemoryContext, upsertMemory } from "./services/ragMemory";
import {
  guardCreativeMemoryContext,
  guardOrbMemorySummary,
} from "./services/security/ragInjectionGuard";
import { buildOrbSystemPrompt, type OrbPromptExtras } from "./services/siteKnowledge";
import { parseOrbReply } from "./services/orbReplyParser";
import { executeGenerateImage, executeOrbTask } from "./services/orbTaskExecutor";
import { sanitizeOrbMessages } from "../shared/orb-prompt-defense";
import { moderateOrbContent } from "../shared/orb-content-moderation";
import { executeOrbToolCalls } from "./services/agentToolExecutor";
import { getOrbToolRegistry } from "./config/orbToolRegistry";
import { orbTaskRepository } from "./repositories/orbTaskRepository";
import { executeCurrentStepTools, runOrbTaskToCompletion } from "./services/orbTaskOrchestrator";
import { loadAgentPreferencesForUser } from "./services/agentPreferenceService";
import { orbToolCallLogStore } from "./services/orbToolCallLogStore";
import {
  runSchemaFirstAgentPlanner,
  runSchemaFirstAgentPlannerWithCritique,
  type AgentPlannerInput,
} from "./services/agentPlanner";
import { runOrbTaskWithContinuationLoop } from "./services/orbTaskChainRunner";
import { runOrbTaskWithOptionalMultiAgent, isMultiAgentRoutingEnabled } from "./services/multiAgentIntegration";
import { getOrbTaskPlannerContext } from "./services/orbTaskPlannerContextStore";
import { setOrbTaskPlannerContext } from "./services/orbTaskPlannerContextStore";
import { appendOrbTaskPageState } from "./services/orbTaskPageStateStore";
import { orbTaskTracer } from "./services/orbTaskTracer";
import { createReplanCallback, type ReplanCallbackContext } from "./services/orbTaskReplanIntegration";
import {
  getRecentSpecialistTools,
  getSpecialistMemoryHints,
  recordToolAuditAsSpecialistInteraction,
} from "./services/specializedAgentMemoryStore";
import { getAggregatedPicksForPrompt } from "./services/agentModelPicks";
import { getOrbMemorySummary, upsertOrbMemory } from "./services/orbUserMemory";
import {
  approveOrbAgentTask,
  cancelOrbAgentTask,
  completeOrbAgentStep,
  createOrbAgentTaskFromPlanner,
  failOrbAgentStep,
  getOrbAgentTask,
  getOrbAgentTaskEvents,
  listRecentOrbAgentTasks,
  retryOrbAgentTask,
} from "./services/orbTaskStateMachine";
import {
  getRecentOrbTaskMemory,
  summarizeRecentOrbTaskMemoryForPlanner,
} from "./services/orbTaskMemory";
import {
  buildOrbMemorySummaryForPlanner,
  clearOrbMemoryForUser,
  deleteOrbMemory,
  getRecentOrbMemories,
  recordOrbMemory,
  searchOrbMemoriesWithRag,
  summarizeOrbMemoriesForPlanner,
} from "./services/orbMemory";
import {
  approveCodeTask,
  attachCodeTaskPr,
  cancelCodeTask,
  createOrbCodeTask,
  getCodeTask,
  getCodeTaskTelemetry,
  listRecentCodeTasks,
  markCodeTaskFailed,
  markCodeTaskMerged,
  markCodeTaskReviewRequired,
  markCodeTaskRunning,
} from "./services/orbCodeTask";
import {
  buildClaudeCodeTaskPrompt,
  buildCodexTaskPrompt,
} from "../shared/orb-code-task";
import {
  aggregatePreferenceProfile,
  extractOrbPreferencesFromConversation,
  summarizeSiteKnowledgeForPlanner,
  summarizeRecentMemoryForPlanner,
} from "../shared/orb-memory";
import {
  OrbStartTaskInputSchema,
  OrbApproveTaskInputSchema,
  OrbApproveStepInputSchema,
  OrbStepReportInputSchema,
} from "../shared/orb-agent-contract";
import {
  mergeFeedbackHistories,
  type AgentFeedbackEvent,
  type PageAgentSnapshot,
} from "../shared/agent-actions";
import { extractJsonObjectFromText } from "../shared/agent-plan-adapter";
import { OrbChatRouterMessageSchema } from "../shared/orb-chat-multimodal";
import {
  buildOrbReasoningChain,
  type OrbReasoningChain,
} from "../shared/orb-reasoning";
import {
  estimatePoints,
  getModelPricing,
  checkModelAvailability,
  MODEL_PRICING_CATALOG,
} from "./services/modelPricing";
import {
  dispatchImageGeneration,
  dispatchVideoGeneration,
  dispatchAudioGeneration,
  dispatchTTS,
  resolveFalEnginesFromRow,
  DEFAULT_FAL_ENGINES,
  estimateGenerationPoints,
  dispatchFalQueueTask,
} from "./services/falDispatcher";
import { getGeminiMediaClient } from "./services/geminiMedia";
import {
  localizeResultUrls,
  persistExternalMediaUrl,
} from "./services/internalMedia";
import { eq } from "drizzle-orm";
import { userAiBrain, promptLibrary } from "../drizzle/schema";
import { getDb, getSiteWideModelUsageSnapshot } from "./db";
import { normalizeEngineModelId } from "../shared/engineModelIds";
import { applyCameraMotionToPrompt } from "../shared/cameraMotionPrompt";
import { selectProvider, type ProviderRouteIntent } from "./services/providerRouter";
import {
  selectRoleForIntent,
  getPreferredProviderForRole,
  composeRoleChain,
  getPrimaryNicknameForRole,
  pickDefaultPathForRole,
  type AgentRole,
} from "../shared/orb-agent-roles";
import {
  getProviderHealth,
  markProviderFailure,
  markProviderRecovered,
} from "./services/providerHealth";
import { estimateOrbTaskCost } from "./services/orbCostGuard";
import { checkAndConsumeQuota, getOrbQuotaSnapshot } from "./services/orbQuota";
import {
  buildOrbIdempotencyKey,
  checkAndLock,
  findDuplicateTask,
  getResult,
  releaseRequestLock,
  rememberTaskKey,
  storeResult,
} from "./services/orbIdempotency";
import {
  clearOrbChatProgress,
  emitOrbChatProgress,
  readOrbChatProgress,
} from "./services/orbChatProgress";
import { validateAttachmentGuards } from "./services/orbAttachmentGuard";
import {
  countPdfAttachments,
  extractPdfAttachmentsToText,
} from "./services/orbAttachmentExtraction";
import {
  runOrbWebResearch,
  runOrbDeepSearch,
  classifyOrbResearchIntent,
} from "./services/orbWebResearch";
import { analyzeOrbPromptForContextLookup } from "./services/orbContextLookup";
import { buildCreativeModelHintsBlock } from "./services/orbCreativeModelHints";
import {
  deriveOrbArcState,
  serializeArcStateForPrompt,
} from "../shared/orb-arc-state";
import { inferModalityFromText } from "../shared/orb-clarification-options";
import {
  doPostGenComplete,
  runPostGenForJob,
  refundJobIfBilled,
  unifiedAssetPrefix,
} from "./services/postGenActions";

import { generateRouter } from "./routers/generate";
import { aiRouter } from "./routers/ai";

// ─── Router Definition ───────────────────────────────────────────────────────

export const appRouter = router({
  system: systemRouter,

  // ─── Homepage Public APIs (Read-only, LOD Pagination) ──────────────────
  news: newsRouter,
  aiModels: aiModelsRouter,
  showcase: showcaseRouter,
  sense: senseRouter,
  brain: brainRouter,
  brainPipeline: brainPipelineRouter,
  proStudio: proStudioRouter,
  imageStudio: imageStudioRouter,
  videoStudio: videoStudioRouter,
  videoProject: videoProjectRouter,
  learnHub: learnHubRouter,
  loraTrainer: loraTrainerRouter,
  modelConsents: modelConsentsRouter,
  promptLibrary: promptLibraryRouter,
  promptCollection: promptCollectionRouter,
  externalServices: externalServicesRouter,
  apiUsage: apiUsageRouter,
  auditLog: auditLogRouter,
  workflow: workflowRouter,
  orbScheduler: orbSchedulerRouter,
  agentPreferences: agentPreferencesRouter,
  agentModelPicks: agentModelPicksRouter,
  orbCapabilities: orbCapabilitiesRouter,
  orbProxy: orbProxyRouter,
  orbConversations: orbConversationsRouter,
  agentCollaboration: agentCollaborationRouter,
  agentCapability: agentCapabilityRouter,
  modelWishes: modelWishesRouter,
  orchestrationRuns: orchestrationRunsRouter,
  adminEval: adminRouter,

  // ─── Orb Agent Observability ─────────────────────────────────────────────
  orbTraces: orbTracesRouter,

  auth: authRouter,

  // ─── Credits / Points Info ───────────────────────────────────────────────
  credits: creditsRouter,

  // ─── 財財 (accountant) ──────────────────────────────────────────────────
  accountant: accountantRouter,

  // ─── 音音 (music-specialist) ────────────────────────────────────────────
  musicSpecialist: musicSpecialistRouter,

  // ─── Generation ──────────────────────────────────────────────────────────

  generate: generateRouter,

  // ─── Prompt Evaluation (LLM-as-a-Judge) ──────────────────────────────────

  evaluate: evaluateRouter,

  // ─── Director AI ─────────────────────────────────────────────────────────

  director: directorRouter,

  // ─── Worldbuilding Framework（導演 AI 自訂世界觀架構器） ─────────────────
  // 多角色（主角/配角/反派）+ 多場景（環境、植被、物件）+ 連結 LoRA 訓練中心
  // v2 動畫擴充：三視圖、表情、穿衣、口氣、語音、腳本定位、風格 profile、配樂主題
  worldbuilding: worldbuildingRouter,

  // ─── Worldbuilding Generation（AI 生成服務） ──────────────────────────────
  // AI-powered generation of characters, scenes, and storyboards
  worldbuildingGeneration: worldbuildingGenerationRouter,

  // ─── World Storyboard（動畫分鏡時間軸） ──────────────────────────────────
  // 「幾分幾秒」級的分鏡：角色 beats、圖楨、音軌（music/voice/sfx）、
  //   管線編排（t2i → refine → i2v → music → voice → final compose）
  worldStoryboard: worldStoryboardRouter,

  // ─── Creative Projects（創作專案整合層） ──────────────────────────────────
  // 把 Director session + Worldbuilding framework + World Storyboard 三者
  // 綁定成一個有意義的創作單位，供全站光球與各 Studio 頁面共享世界觀上下文。
  creativeProject: creativeProjectRouter,

  // ─── Account（H9 個資出口：刪帳號/資料匯出）─────────────────────────────────
  // deleteAccount = 軟刪除 + PII 清除（可逆 90 天）。
  // exportData = GDPR 可攜性資料匯出 JSON。
  account: accountRouter,

  // ─── Commander（任務總指揮入口） ──────────────────────────────────────────
  // M1-B：記錄使用者創作意圖（createIntent → pending orchestration run）。
  // 第一版只寫 DB，不接 Perplexity / SubQ / MCP / 外部模型。
  commander: commanderRouter,

  // ─── Context Packets（M4 團隊內部資料接入創作上下文） ─────────────────────
  // 把 project + 團隊資料（之後 cloud / notes / mcp）摘成可重用、有 TTL 的上下文包。
  contextPacket: contextPacketRouter,

  // ─── Team Data（M4 資料來源存取規則） ────────────────────────────────────
  // 控制哪個 team / project 可用哪些內部 / 外部資料來源，及 accessLevel 與可用 mode。
  teamData: teamDataRouter,

  // ─── Data Connections（M4/M5 外部資料來源連接） ──────────────────────────
  // 使用者連接自己的雲端 Drive / 筆記 Notion；credential 後端加密，read-only。
  dataConnections: dataConnectionsRouter,

  // ─── Team Training（M 訓練 track） ────────────────────────────────────────
  // 用團隊 archive 圖片（access rule full_reference 為訓練來源）訓練 team_shared LoRA。
  teamTraining: teamTrainingRouter,

  // ─── Real Earth Information System（真實地球資訊系統） ─────────────────────
  // 提供真實歷史、文化、人文、環境資料查驗，特別深化台灣相關資訊，
  // 方便使用者研究與撰寫腳本。可被世界觀系統引用、AI 代理查詢。
  realEarth: realEarthRouter,

  // ─── 資料庫（training-data 素材池） ──────────────────────────────────────
  // 上傳純文字 / PDF / 文件 / 圖片 / 影片 / 語音 / 簡報，依分類、來源、主題分類。
  // Phase 1 只做儲存與檢索；Phase 2 會把 textContent 切片做 RAG。
  teachingArchive: teachingArchiveRouter,

  // ─── Teams（Phase 2：多人協作、團隊池）────────────────────────────────────
  // 資料庫的 team_shared 視野需要這層 membership；teams 與 teachingArchive
  // 拆開以便其他功能（共筆、共享 prompts 等）日後復用。
  teams: teamsRouter,

  // ─── RBAC（AIDV-121：資料層權限邊界 — 共享/撤銷/移轉）────────────────────
  // 顯式共享 SSOT（resource_shares）的生命週期 mutation。寫入純加法、不受
  // ENABLE_DATA_RBAC 旗標 gate；enforcement（旗標 ON 時 canAccess 過濾讀取）
  // 在各讀取 procedure 內。
  rbac: rbacRouter,

  // ─── Spirit invocation ───────────────────────────────────────────────────
  // 15 位精靈直接呼叫 fal.ai 模型；圖圖只能打圖、影影只能打影 …
  // 入口在 server/services/spiritDispatcher.ts。
  spirit: spiritRouter,

  // ─── Assets ──────────────────────────────────────────────────────────────

  assets: assetsRouter,

  // ─── Fine-Tuned Models ────────────────────────────────────────────────────

  models: modelsRouter,

  // ─── Director Preferences ────────────────────────────────────────────────

  directorPreferences: directorPreferencesRouter,

  // ─── Project Notes ────────────────────────────────────────────────────────

  notes: notesRouter,

  // ─── Schedule (ICS feed) ──────────────────────────────────────────────────

  schedule: scheduleRouter,

  // ─── Google Drive Asset Library ───────────────────────────────────────────

  drive: driveRouter,

  // ─── Feedback ─────────────────────────────────────────────────────────────

  feedback: feedbackRouter,

  // ─── Consistency Vault ──────────────────────────────────────────────────────

  vault: vaultRouter,

  // ─── Generation History ───────────────────────────────────────────────────

  history: historyRouter,

  // ─── 創作工作室持久化（RecipeLibraryPanel / VersionHistoryPanel）─────────

  studio: studioRouter,

  // ─── AI 全站光球代理（含上下文 + AI 代理人行為） ──────────────────────────────

  ai: aiRouter,

  orbGuide: orbGuideRouter,

  // ─── Subscription Plans ───────────────────────────────────────────────────

  plans: plansRouter,
  // ─── Custom Blocks ─────────────────────────────────────────────────────────

  customBlocks: customBlocksRouter,

  // ─── Block Combos ──────────────────────────────────────────────────────────

  blockCombos: blockCombosRouter,

  // ─── Admin Dashboard ────────────────────────────────────────────────────────

  admin: adminFullRouter,

  // ─── User Profile & Settings ───────────────────────────────────────────────

  profile: profileRouter,

  // ─── System Settings ──────────────────────────────────────────────────────

  settings: settingsRouter,

  // ─── User Dashboard ───────────────────────────────────────────────────────

  dashboard: dashboardRouter,

  // ─── LangSmith 深度整合（AI 監控儀表板）─────────────────────────────────────
  langsmith: langsmithRouter,
});

export type AppRouter = typeof appRouter;
