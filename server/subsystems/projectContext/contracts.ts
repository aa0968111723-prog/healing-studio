/**
 * projectContext / contracts — M1-A Active Project Context
 * ────────────────────────────────────────────────────────────────────────────
 * CreativeProject 是全站創作主幹。這份合約定義 `/create` 與其他創作頁面共用的
 * 「專案上下文摘要」(ProjectContextSummary) 形狀。第一版只彙整目前資料庫真的
 * 拿得到的資料：專案核心欄位、連結的世界觀框架、使用者最近素材。團隊資料、
 * 未完成任務、成本預算等欄位先保留結構（多為 optional / 空陣列），由後續
 * M1-B / M2 / M4 milestone 逐步補上，避免在 UI 上做出尚未存在的承諾。
 */

/** 最近素材（M1-A 先以使用者最近素材為近似，M2-A 之後改為 project-scoped）。 */
export interface ProjectContextAsset {
  id: number;
  title: string;
  assetType: string;
  thumbnailUrl?: string;
  createdAt: string;
}

/** 未完成任務（M1-B createIntent / orchestration_runs 之後才會有真實資料）。 */
export interface ProjectContextOpenTask {
  id: string;
  title: string;
  status: string;
}

export interface ProjectContextBudget {
  maxCostUsd?: number;
  usedCostUsd?: number;
}

/**
 * `/create` 顯示的專案上下文摘要。欄位對齊「完整開發細節與實作規格」4.1。
 */
export interface ProjectContextSummary {
  projectId: number;
  title: string;
  status: "concept" | "production" | "review" | "complete";
  description?: string;
  /** 世界觀摘要（來自連結的 worldbuilding framework）。 */
  worldview?: string;
  /** 風格設定摘要（style profiles / global negative prompt 的精簡描述）。 */
  styleBible?: string;
  /** 團隊資料摘要 — M4 Context Packets 之後填入。 */
  teamDataSummary?: string;
  recentAssets: ProjectContextAsset[];
  /**
   * recentAssets 的範圍。M1-A 沒有 project_asset_links，先回 "user"
   * （使用者最近素材）；M2-A 之後改為 "project"。讓 UI 能誠實標示。
   */
  recentAssetsScope: "user" | "project";
  openTasks: ProjectContextOpenTask[];
  budget?: ProjectContextBudget;
  /** 專案上下文最後更新時間（ISO 8601）。 */
  updatedAt: string;
  /**
   * 尚未接上的區塊清單，讓前端可顯示「即將推出 / 後續 milestone」提示，
   * 而不是顯示空白或假資料。
   */
  pendingSections: Array<"teamData" | "openTasks" | "budget" | "projectScopedAssets">;
}

/** projectContextService 在權限不足或找不到專案時丟出的錯誤。 */
export class ProjectContextAccessError extends Error {
  constructor(
    public readonly reason: "not_found" | "forbidden",
    message?: string,
  ) {
    super(message ?? reason);
    this.name = "ProjectContextAccessError";
  }
}
