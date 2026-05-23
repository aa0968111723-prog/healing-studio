/**
 * commander / contracts — M1-B createIntent Skeleton
 * ────────────────────────────────────────────────────────────────────────────
 * 任務總指揮（commander）的入口合約。第一版只負責「記錄使用者創作意圖」：把
 * 一次 intent 寫成一筆 orchestration run（status=pending），不呼叫任何昂貴模型、
 * 不接 Perplexity / SubQ / MCP。plan / context packet / tool / citation / cost
 * 等欄位先保留結構，由後續 M5（commander adapter）與 M6（cost ledger）填入。
 */

export const ORCHESTRATION_MODES = [
  "create",
  "director",
  "video",
  "assets",
  "database",
] as const;

export type OrchestrationMode = (typeof ORCHESTRATION_MODES)[number];

export type OrchestrationStatus =
  | "pending"
  | "planned"
  | "waiting_confirmation"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type CommanderKind =
  | "fallback"
  | "perplexity"
  | "subq"
  | "orb"
  | "codex"
  | "claude";

export interface CreateIntentInput {
  userId: number;
  /** 可省略 / null：未選專案時仍可建立 run（標記為無 project context）。 */
  projectId?: number | null;
  teamId?: number | null;
  mode: OrchestrationMode;
  intent: string;
}

/** 回傳給前端的精簡 run 視圖。 */
export interface CommanderRunView {
  id: number;
  userId: number;
  projectId: number | null;
  teamId: number | null;
  mode: OrchestrationMode;
  intent: string;
  status: OrchestrationStatus;
  commander: CommanderKind | null;
  /** 預估成本（USD）；第一版為 null（尚未估算）。 */
  estimatedCostUsd: number | null;
  actualCostUsd: number | null;
  errorMessage: string | null;
  /** projectId 不為 null 時為 true；false 代表此 run 無 project context。 */
  hasProjectContext: boolean;
  createdAt: string;
  updatedAt: string;
}

/** commanderService 在權限不足或找不到資源時丟出的錯誤。 */
export class CommanderAccessError extends Error {
  constructor(
    public readonly reason: "not_found" | "forbidden",
    message?: string,
  ) {
    super(message ?? reason);
    this.name = "CommanderAccessError";
  }
}
