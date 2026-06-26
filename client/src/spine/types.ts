// ============================================================================
// spine/types.ts — 脊椎資料模型（一比一對映 healing-studio 的 Drizzle 表）
// ----------------------------------------------------------------------------
// 來源：AI-Director-模擬/client/src/spine/types.ts（模擬手寫型別）。
// 每個型別上方註明 ← 對映的 Drizzle 表 / tRPC namespace。
//
// 【P0 注意】此檔在 P0 為「型別接縫」用途，提供 adapter 介面與 shell 的共用型別。
// 它不引入任何執行期程式碼、不 import 任何 context，純 type-only，零 bundle 成本。
// 日後（P3 Supabase parity）可逐型別改成 `import type { ... } from "@shared/schema"`
// 直接引真實 Drizzle 推導型別，避免漂移；呼叫端不動。
// ============================================================================

export type ProviderId = "hf" | "gemini" | "fal" | "mock";
export type Persona = "calm" | "creative" | "technical";
export type SourceGrade = "precise" | "estimate" | "unconfirmed";
export type GateState = "ready" | "partial" | "blocked";
export type GenStatus = "idle" | "queued" | "generating" | "done" | "error" | "stale";
export type GenKind = "image" | "video" | "audio" | "keyframe";
export type ShellId = "video" | "social" | "learn" | "settings";
export type ThemeId = "navy" | "earth";

// ← consistency_vault（角色定版 / 鎖臉定裝 / 來源分級）
export interface Character {
  id: string;
  name: string;
  emoji: string;
  sourceGrade: SourceGrade;
  locked: boolean;
  locks: { face: boolean; hair: boolean; costume: boolean; accessory: boolean };
  loraStatus: "未訓練" | "排隊中" | "訓練中" | "已完成";
  /** 已連結的訓練 LoRA 模型 id（fine_tuned_models.id）；I-7 readiness 的權威訊號，可無。 */
  linkedModelId?: number | null;
  refImages: number;
}

// ← worldbuilding_frameworks.scenesJson
export interface Scene {
  id: string;
  name: string;
  kind: "exterior" | "interior" | "named-place";
  locked: boolean;
}

// ← world_storyboards（鏡號 S0X 為唯一主鍵）
export interface Shot {
  id: string;
  no: string; // S01..
  act: number;
  title: string;
  route: "text" | "ref"; // 純文字生圖 / 具名角色參考圖轉繪
  characterIds: string[];
  sceneId: string | null;
  seed: number; // 固定 seed → 跨鏡一致
  approval: "pending" | "approved";
  stale: boolean;
  gen: { status: GenStatus; provider?: ProviderId; model?: string; costUsd?: number; variant: number; assetUrl?: string };
  prompt?: string;
}

// ← project_notes_calendar
export interface Note { id: string; ts: string; text: string; shotNo?: string }

// ← digital_asset_library (+ project_asset_links〔M2 待建〕)
export interface AssetRow {
  id: string;
  kind: GenKind;
  shotNo?: string;
  provider: ProviderId;
  modelId: string;
  sourceStudio: string;
  costUsd: number;
  seed?: number;
  ts: string;
}

// ← prompt_library / block_combos / custom_blocks
export interface PromptBlock { id: string; label: string; text: string; kind: "combo" | "custom"; uses: number }

// ← context_packets（壓縮上下文，代理真正讀的精華）
export interface ContextPacket {
  summaryMarkdown: string;
  sourceRefs: { ref: string; kind: string; fresh: boolean }[];
  tokenEstimate: number;
  ttlSec: number;
  permissions: string;
}

// ← creative_projects（唯一創作主幹）+ 隨身脈絡包
export interface CreativeProject {
  id: string;
  name: string;
  emoji: string;
  type: "影片" | "社群" | "混合";
  logline: string;
  styleBible: string;
  stageIndex: number; // 0..4 世界觀→腳本→分鏡→生成→成片
  characters: Character[];
  scenes: Scene[];
  shots: Shot[];
  notes: Note[];
  assets: AssetRow[];
  promptBlocks: PromptBlock[];
  packet: ContextPacket;
  /** I-2（AIDV-80）：選定世界的預設 style profile 精簡前綴；生成時旗標開才 prepend。可無。 */
  worldStyle?: string;
  /** I-3（AIDV-81）：連結的世界觀 framework id（creative_projects.worldFrameworkId）；自動分鏡骨架的 worldId。可無。 */
  worldFrameworkId?: number | null;
  /** AIDV-246：創作者指定的封面幀 Shot id；社群媒體上傳封面。可無（預設取首幀）。 */
  coverShotId?: string | null;
  updatedAt: number;
}

/** 列表用精簡投影（DataStore.listProjects 回傳；對映 creativeProject.list 的列） */
export interface CreativeProjectSummary {
  id: string;
  name: string;
  emoji?: string;
  type?: CreativeProject["type"];
  updatedAt?: number;
}

// ← aiModels / fine_tuned_models（五腦指派）
export interface ModelEntry {
  id: string;
  name: string;
  vendor: string;
  kind: "llm" | "image" | "video" | "audio" | "embed" | "search";
  brainRole?: string; // 決策腦 / 研究腦 / 長上下文腦 / 感知腦 / 生成腦
  status: "可用" | "待接" | "訓練中";
  note?: string;
}

// ← news_articles / sense
export interface NewsItem { id: string; title: string; source: string; ts: string; tag: string; url: string }

// 研究代理結果（orbProxy.unifiedSearch / Sonar+Brave）
export interface ResearchSource { title: string; url: string; snip: string }
export interface ResearchResult { query: string; answer: string; sources: ResearchSource[]; tokens: number; costUsd: number; model: string }

// ← api_usage_logs / ai_usage_events
export interface UsageEvent { id: string; ts: string; kind: string; provider: ProviderId | "—"; model: string; costUsd: number; tokens: number; shell: ShellId | "脊椎" }

// ← background_jobs
export interface BackgroundJob { id: string; kind: string; status: "queued" | "running" | "done" | "failed"; provider?: ProviderId; projectId?: string; ts: string; label: string }

// ← orchestration_runs（commander 決策紀錄）
export interface OrchestrationStep { tool: string; cost: number; note: string }
export interface OrchestrationRun { id: string; intent: string; steps: OrchestrationStep[]; totalCost: number; citations: string[]; ts: string }

// 社群版型（社群系統②；showcase.templates 待建 → 過渡可重用 block_combos）
export interface Template { id: string; name: string; ratio: "1:1" | "9:16" | "16:9" | "4:5"; palette: [string, string]; kind: string }
