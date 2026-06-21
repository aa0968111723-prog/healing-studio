// ============================================================================
// adapters/types.ts — 五條接縫介面（mock ↔ 真實 tRPC 的唯一接縫）
// ----------------------------------------------------------------------------
// 上層 shell / SpineProvider 只依賴這些介面；換 backend = 換實作，不動 UI。
// 五條接縫對齊整合指南 §5.2 的五個 env 旗標：
//
//   介面              env 旗標              真實主接點（GitNexus 校正，main HEAD 2888a36）
//   ───────────────  ───────────────────  ───────────────────────────────────────────────
//   DataStore        DATA_STORE           creativeProject.* / aiModels.list / news.list / showcase.*
//   Generation       GENERATION_PROVIDER  generate.*（estimateCost→submitStudioJob→recordGenResult）
//   Commander        COMMANDER_ADAPTER    commander.createIntent / director.* (chat, breakdown 過渡)
//   ContextPacket    CONTEXT_PACKET_MODE  contextPacket.compileProject / orbProxy.unifiedSearch
//   Storage          STORAGE_PROVIDER     generate.recordGenResult / vault.exportToAssets
//
// 每個方法上方註明對應 procedure；🔧 = GitNexus 對真實 call graph 校正過的命名。
// ============================================================================
import type {
  ProviderId, Persona, GenKind,
  CreativeProject, CreativeProjectSummary, ContextPacket as ContextPacketData,
  ModelEntry, NewsItem, Template, ResearchResult, OrchestrationStep, OrchestrationRun,
} from "@/spine/types";

// ─── 共用：依賴注入 + 錯誤型別 ────────────────────────────────────────────────

/** adapter 共用相依：provider 選擇 + 故障注入（給 demo / 測試用）。 */
export interface AdapterDeps {
  getProvider: () => ProviderId;
  getFaults: () => Record<string, boolean>;
}

/** 統一的 adapter 錯誤：保留 provider / procedure / http 以利 toast 與回退判斷。 */
export class AdapterError extends Error {
  constructor(
    message: string,
    readonly meta: { seam: string; procedure?: string; provider?: ProviderId; http?: number; cause?: unknown },
  ) {
    super(message);
    this.name = "AdapterError";
  }
}

/** 接點尚未落地（GitNexus 確認缺口，如 video session 狀態機 = M3）。 */
export class AdapterPendingError extends AdapterError {
  constructor(message: string, meta: { seam: string; procedure?: string; milestone: string }) {
    super(message, { seam: meta.seam, procedure: meta.procedure });
    this.name = "AdapterPendingError";
  }
}

/**
 * 成本同意守門中止（AIDV-160）：免費/使用者選定的免費引擎不可用，且守門不允許無聲
 * 跨界到付費 provider 扣點 → 中止、不生成、不扣點。caller 可 `instanceof` 偵測以顯示
 * 「請改選其他引擎或稍後再試」而非「全部 provider 皆失敗」。
 */
export class AdapterCostBlockedError extends AdapterError {
  constructor(message: string, meta: { seam: string; provider?: ProviderId; procedure?: string }) {
    super(message, { seam: meta.seam, provider: meta.provider, procedure: meta.procedure });
    this.name = "AdapterCostBlockedError";
  }
}

// ─── 1) DataStore（DATA_STORE）── creativeProject / aiModels / news / showcase ──

export interface DataStoreAdapter {
  /** 🔧 creativeProject.list — 全部創作專案（精簡投影）。 */
  listProjects(): Promise<CreativeProjectSummary[]>;
  /** 🔧 creativeProject.get — 取單一專案完整資料（隨身脈絡由多 procedure 聚合）。 */
  getProject(projectId: number): Promise<CreativeProject | null>;
  /** 🔧 creativeProject.getContextSummary — /create 用的專案上下文摘要。 */
  getProjectSummary(projectId: number): Promise<unknown | null>;
  /** ✅ aiModels.list — 模型清單（含五腦指派狀態）。 */
  listModels(): Promise<ModelEntry[]>;
  /** 🔧 news.list — 情報清單（GitNexus：sense 僅 inferIntent，無 feed）。 */
  listNews(): Promise<NewsItem[]>;
  /** ◑ showcase.templates（待建）→ 過渡重用 block_combos；不存在時回 []。 */
  listTemplates(): Promise<Template[]>;
}

// ─── 2) Generation（GENERATION_PROVIDER）── generate.*（非同步 job 模型）─────────

export interface GenRequest {
  kind: GenKind;
  prompt?: string;
  seed: number;
  provider?: ProviderId;
  shotNo?: string;
  projectId?: number;
  /** 底層逐模型 procedure 名（如 seedreamV4 / klingImageToVideo）；未指定走伺服器預設。 */
  model?: string;
}
export interface GenResult {
  ok: true;
  provider: ProviderId;
  seedUsed: number;
  model: string;
  costUsd: number;
  latencyMs: number;
  assetUrl?: string;
  jobId?: string;
}
export interface GenError { provider: ProviderId; code: string; http: number; msg: string }
export type GenEvent =
  | { type: "estimate"; costUsd: number }
  | { type: "attempt"; provider: ProviderId; step: number }
  | { type: "queued"; jobId: string; provider: ProviderId }
  | { type: "poll"; jobId: string; status: string }
  | { type: "fail"; provider: ProviderId; error: GenError }
  | { type: "fallback"; provider: ProviderId; next: ProviderId; crossesToPaid?: boolean }
  /**
   * 成本同意守門（AIDV-160）：免費/使用者選定的免費引擎不可用、且無同層（免費）替代時，
   * 守門「不跨界到付費 provider 扣點」而中止。UI 據此顯示明確錯誤、不生成、不扣點。
   */
  | { type: "cost-blocked"; provider: ProviderId; reason: string }
  | { type: "success"; provider: ProviderId; res: GenResult; fellBack: boolean };

export interface GenerationAdapter {
  /** 🔧 generate.estimateCost — 先估成本（director.estimateSegmentCost 為段落級替代）。 */
  estimateCost(req: GenRequest): Promise<{ costUsd: number }>;
  /**
   * 🔧 統一非同步 job：generate.submitStudioJob → 輪詢 generate.jobStatus →
   *    generate.recordGenResult 回寫。內建 hf→gemini→fal→mock 回退鏈。
   *    （影像/keyframe = 真實可用；video = M3 session 狀態機待建，丟 AdapterPendingError；
   *     audio = proStudio.textToMusic / elevenLabsTTS。）
   */
  generate(req: GenRequest, onEvent?: (e: GenEvent) => void): Promise<GenResult>;
}

// ─── 3) Commander（COMMANDER_ADAPTER）── commander.createIntent / director.* ────

export interface DirectorReplyInput { persona: Persona; message: string; projectId?: number | null }
export interface DirectorReply { role: "ai"; persona: Persona; text: string; agent: string }

export interface CommanderPlan { runId?: string; goal: string; steps: OrchestrationStep[]; totalCost: number }

export interface ScriptShot { title: string; route: "text" | "ref"; characters: string[]; scene: string }
export interface ScriptBreakdown { acts: { title: string; shots: ScriptShot[] }[]; characters: string[]; scenes: string[] }

export interface CommanderAdapter {
  /** ✅ director.chat — AI 導演回覆（CO-STAR 雙引擎 × RAG × 三人格）。 */
  directorReply(input: DirectorReplyInput): Promise<DirectorReply>;
  /** 🔧 commander.createIntent —（原 commander.plan 不存在）先計畫、按開始才動；已內建 ACL。 */
  createIntent(input: { intent: string; projectId?: number | null }): Promise<CommanderPlan>;
  /** 🔧 commander.getRun — 查單次編排結果。 */
  getRun(runId: string): Promise<OrchestrationRun | null>;
  /** 🔧 commander.listRunsByProject — 列某專案的編排紀錄。 */
  listRuns(projectId: number): Promise<OrchestrationRun[]>;
  /**
   * 🔧 breakdownScript — director.breakdown 待建（M3）。過渡：director.analyzeScriptOverview +
   *    director.generateVideoScript 組出結構（原列 generateVideoScriptFromBrief 不存在）。
   */
  breakdownScript(script: string, projectId?: number | null): Promise<ScriptBreakdown>;
}

// ─── 4) ContextPacket（CONTEXT_PACKET_MODE）── contextPacket.compileProject ─────

export interface ContextPacketAdapter {
  /** 🔧 contextPacket.compileProject —（原 compile 不存在）重壓專案 Context Packet。 */
  compile(projectId: number): Promise<ContextPacketData>;
  /** 🔧 contextPacket.getLatest — 取最近一次已編譯的 packet。 */
  getLatest(projectId: number): Promise<ContextPacketData | null>;
  /**
   * 🔧 research — grounding/研究：orbProxy.unifiedSearch（原 sense.research 不存在）。
   *    放在 ContextPacket 接縫，因 CONTEXT_PACKET_MODE 同時治理 RAG/grounding 來源。
   */
  research(query: string, onEvent?: (e: { type: string; [k: string]: unknown }) => void): Promise<ResearchResult>;
}

// ─── 5) Storage（STORAGE_PROVIDER）── generate.recordGenResult / vault.exportToAssets ──

export interface RecordedAsset {
  id: string;
  kind: GenKind;
  provider: ProviderId;
  modelId: string;
  costUsd: number;
  assetUrl?: string;
}
export interface StorageAdapter {
  /** 🔧 generate.recordGenResult — 生成結果回寫 digital_asset_library（回退鏈每跳落點）。 */
  recordGenResult(input: {
    projectId?: number; shotNo?: string; kind: GenKind; provider: ProviderId;
    model: string; costUsd: number; seed?: number; assetUrl?: string;
  }): Promise<RecordedAsset>;
  /** 🔧 vault.exportToAssets — 把 consistency_vault 角色定版匯出到資產庫。 */
  exportToAssets(input: { projectId: number; vaultId: string }): Promise<{ ok: boolean }>;
}

// ─── 6) PromptVault（PROMPT_VAULT）── promptLibrary.* ＋ prompt_assets 雙向查詢 ──
// Wave 1（W1-3）新增的第六條接縫：提示詞庫 CRUD＋使用計數＋（G9 junction 已落地）
// 素材↔提示詞雙向反查。Flow TV（W1-4）與血統檢視（W3-F）的資料面。

export interface PromptVaultItem {
  id: number;
  title: string;
  content: string;
  /** 伺服器 enum：general/image/video/audio/voice/story/system。 */
  category: string;
  tags: string[];
  isFavorite: boolean;
  useCount: number;
  modelHint?: string;
  /** epoch ms；列表排序用。 */
  updatedAt?: number;
}
export interface PromptVaultPage {
  items: PromptVaultItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
/** 🔧 promptLibrary.linkedAssets 的單列（junction 0075）。 */
export interface PromptLinkedAsset {
  relation: string; // derived | variant | rewrite | extended
  linkedAt?: number;
  asset: { id: number; title: string; assetType: string; fileUrl?: string; thumbnailUrl?: string; modelId?: string };
}
/** 🔧 assets.linkedPrompts 的單列。 */
export interface PromptLinkedPrompt {
  relation: string;
  linkedAt?: number;
  prompt: { id: number; title: string; content: string; category: string; modelHint?: string };
}

export interface PromptVaultAdapter {
  /** ✅ promptLibrary.list — 分頁列出我的提示詞（category/search/favoritesOnly 篩選）。 */
  listPrompts(input?: {
    category?: string; search?: string; favoritesOnly?: boolean; page?: number; pageSize?: number;
  }): Promise<PromptVaultPage>;
  /** ✅ promptLibrary.getById — 取單一提示詞（非本人 NOT_FOUND → 回 null）。 */
  getPrompt(id: number): Promise<PromptVaultItem | null>;
  /** ✅ promptLibrary.create — 新增提示詞（title 必填；缺 title 曾靜默失敗，已校正）。 */
  createPrompt(input: {
    title: string; content: string; category?: string; tags?: string[]; modelHint?: string;
  }): Promise<{ id: number }>;
  /** ✅ promptLibrary.incrementUseCount — 應用提示詞時 +1。 */
  incrementUseCount(id: number): Promise<void>;
  /** 🔧 promptLibrary.linkedAssets — 此 prompt 衍生哪些資產（junction 0075，PR #864）。 */
  listLinkedAssets(promptId: number): Promise<PromptLinkedAsset[]>;
  /** 🔧 assets.linkedPrompts — 此資產用過哪些 prompt。 */
  listLinkedPrompts(assetId: number): Promise<PromptLinkedPrompt[]>;
}

// ─── Registry：六接縫 + meta ─────────────────────────────────────────────────

export interface Adapters {
  dataStore: DataStoreAdapter;
  generation: GenerationAdapter;
  commander: CommanderAdapter;
  contextPacket: ContextPacketAdapter;
  storage: StorageAdapter;
  promptVault: PromptVaultAdapter;
  meta: {
    dataStore: string; generation: string; commander: string;
    contextPacket: string; storage: string; promptVault: string;
  };
}
