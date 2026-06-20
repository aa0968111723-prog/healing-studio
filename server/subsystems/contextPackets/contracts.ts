/**
 * contextPackets / contracts — M4 團隊內部資料接入創作上下文
 * ────────────────────────────────────────────────────────────────────────────
 * 把 project + 團隊資料 + 外部來源（雲端 / 筆記 / 未來 MCP）摘成可重用、有 TTL 的
 * 小上下文包。合約刻意 **source-agnostic**：`ContextSourceRef` 用 `kind` 區分來源，
 * 外部連接器日後只要產出相同形狀的 ref 即可進同一條 pipeline，不需改 schema。
 *
 * 安全不變量：`kind !== "team_data"` 的來源內容一律視為 **untrusted** —— 不執行、
 * 進 summaryMarkdown 前需 escape/sanitize、日後餵模型時須 prompt-injection fence。
 *
 * 落實狀態（AIDV-69）：
 *  ✅ sanitize：已於 contextPacketService 的**資料層**（sanitizeUntrustedRefs，adapter
 *     收集後一次到位）對 untrusted（kind !== "team_data"）ref 的 title / snippet 套
 *     sanitizeContextPacketField（ragInjectionGuard.neutralizeInjectionMarkers）。持久化的
 *     sourceRefsJson 與衍生的 summaryMarkdown **共用同一份已中和 refs** → UI chips
 *     （ref.title / ref.snippet）、summaryMarkdown、未來讀 sourceRefs 的消費端皆繼承中和，
 *     無未中和旁系副本。旗標 ENABLE_RAG_INJECTION_GUARD gate、預設 OFF＝位元相同；
 *     team_data 受信任不過 guard。
 *  ⏳ fence：summaryMarkdown / sourceRefs 目前**只進 UI**（TeamDataSourcesPanel /
 *     teamDataSummary），不進任何 LLM prompt → 依鐵則**不在此編譯端加 fence**（會污染
 *     UI 顯示）。未來若新增「進 LLM prompt」的真實路徑，才於該注入點改呼叫
 *     guardRetrievedContext（含 BEGIN/END 邊界 fence）。
 */

/** 資料來源類型。第一版實作 team_data / cloud / notes；mcp / external_api 預留。 */
export const DATA_SOURCE_KINDS = [
  "team_data",
  "cloud",
  "notes",
  "mcp",
  "external_api",
] as const;
export type DataSourceKind = (typeof DATA_SOURCE_KINDS)[number];

/** 可外部連接的來源類型（不含 team_data，後者是內部資料）。 */
export const CONNECTION_KINDS = [
  "cloud",
  "notes",
  "mcp",
  "external_api",
] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];

/** 存取層級：none 完全排除；summary_only 只給摘要；chunk 給命中片段；full 可進完整引用。 */
export const ACCESS_LEVELS = [
  "none",
  "summary_only",
  "chunk_access",
  "full_reference",
] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

/** 對齊 orchestration_runs 的 mode（commander/contracts ORCHESTRATION_MODES）。 */
export const COMPILE_MODES = [
  "create",
  "director",
  "video",
  "assets",
  "database",
] as const;
export type CompileMode = (typeof COMPILE_MODES)[number];

/** 單一資料來源的引用（存進 context_packets.sourceRefsJson）。source-agnostic。 */
export interface ContextSourceRef {
  kind: DataSourceKind;
  /** team_data 為 stringified materialId；外部來源為其 opaque id。 */
  refId: string;
  title: string;
  accessLevel: AccessLevel;
  /** accessLevel >= summary_only 時的摘要片段。 */
  snippet?: string;
  /** 外部來源：產生此 ref 的連接 id；team_data 為 null。 */
  connectionId?: number | null;
  /** 檢索相關度（team_data 來自 TeachingSearchHit.score）。 */
  score?: number;
  /** 命中方式（vector / fts）；外部來源可省略。 */
  matchedBy?: "vector" | "fts";
}

export interface CompileProjectContextPacketInput {
  userId: number;
  projectId: number;
  mode: CompileMode;
  /** 聚焦檢索的關鍵字；省略時用 project 標題 / 描述。 */
  query?: string;
  /** 略過快取、強制重算。 */
  forceRefresh?: boolean;
}

export interface ContextPacketView {
  id: number;
  projectId: number;
  teamId: number | null;
  scope: "project" | "team" | "user";
  summaryMarkdown: string;
  sourceRefs: ContextSourceRef[];
  tokenEstimate: number;
  createdByModel: string | null;
  /** ISO 8601；null = 無 TTL。 */
  expiresAt: string | null;
  createdAt: string;
  /** true = 由快取回傳，未重算。 */
  reused: boolean;
}

/**
 * Source adapter 介面 —— 讓 source-agnostic 變真。每個來源（team_data / cloud /
 * notes / mcp）實作 `collect`，回傳已套用各自 ACL 的 ContextSourceRef[]。
 * service 只負責合併、套 mode 過濾、組摘要、寫 packet。
 */
export interface ContextAdapterInput {
  userId: number;
  projectId: number;
  query: string;
  limit: number;
  mode: CompileMode;
}

export interface DataSourceAdapter {
  readonly kind: DataSourceKind;
  collect(input: ContextAdapterInput): Promise<ContextSourceRef[]>;
}

/** 一條資料來源存取規則的前端視圖。 */
export interface ProjectAccessRuleView {
  id: number;
  teamId: number;
  projectId: number | null;
  materialId: number | null;
  connectionId: number | null;
  accessLevel: AccessLevel;
  allowedModes: string[] | null;
  createdBy: number;
  updatedAt: string;
}

/** 外部資料來源連接的前端視圖（**絕不含 credential**）。 */
export interface DataConnectionView {
  id: number;
  ownerUserId: number;
  teamId: number | null;
  projectId: number | null;
  kind: DataSourceKind;
  provider: string;
  authType: "oauth" | "api_key" | "none";
  status: "pending" | "active" | "disabled" | "error";
  /** 非敏感設定（folder ids、database ids…）；不含 token。 */
  config: Record<string, unknown> | null;
  lastHealthCheckAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** contextPacketService 在權限不足 / 找不到資源時丟出。 */
export class ContextPacketAccessError extends Error {
  constructor(
    public readonly reason: "not_found" | "forbidden",
    message?: string
  ) {
    super(message ?? reason);
    this.name = "ContextPacketAccessError";
  }
}
