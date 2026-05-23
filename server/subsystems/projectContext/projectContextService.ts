/**
 * projectContext / projectContextService — M1-A Active Project Context
 * ────────────────────────────────────────────────────────────────────────────
 * Wrapper service（不刪舊流程，只在現有 db helper 上加一層彙整）。把一個
 * CreativeProject 連同它連結的世界觀框架與使用者最近素材，整理成 `/create`
 * 可直接渲染的 ProjectContextSummary。
 *
 * 安全：
 *   - 一律以 authenticated userId 比對 project.userId / framework.userId。
 *   - 找不到或不屬於該使用者 → 丟 ProjectContextAccessError，由 router 轉成
 *     對應的 TRPCError。
 *   - 不呼叫任何外部 AI / 工具 API，不讀寫 credential。
 */

import {
  getCreativeProject,
  getWorldbuildingFramework,
  getDigitalAssetsByUser,
  getOrchestrationRunsByProject,
} from "../../db";
import {
  ProjectContextAccessError,
  type ProjectContextSummary,
  type ProjectContextAsset,
  type ProjectContextOpenTask,
} from "./contracts";

const RECENT_ASSET_LIMIT = 6;
/** 抓多少筆 run 進來篩；數量小、project-scoped，成本可忽略。 */
const OPEN_TASK_FETCH_LIMIT = 50;
/** 摘要最多顯示幾筆未完成任務，避免脈絡區被洗版。 */
const OPEN_TASK_LIMIT = 8;
/** 視為「已結束、不再列為待辦」的 run 狀態。failed 仍算待辦（需要決定是否重跑）。 */
const CLOSED_TASK_STATUSES = new Set(["completed", "cancelled"]);

function toIso(value: Date | string | null | undefined): string {
  if (!value) return new Date(0).toISOString();
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? new Date(0).toISOString()
    : parsed.toISOString();
}

function toNumberOrNull(
  value: string | number | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function snippet(text: string | null | undefined, max = 160): string | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/** 把世界觀框架壓成一句話的 worldview 摘要。 */
function buildWorldview(framework: {
  name: string;
  genre: string | null;
  era: string | null;
  description: string | null;
}): string {
  const tags = [framework.genre, framework.era].filter(
    (v): v is string => Boolean(v && v.trim()),
  );
  const head = tags.length > 0 ? `${framework.name}（${tags.join(" · ")}）` : framework.name;
  const desc = snippet(framework.description, 120);
  return desc ? `${head}：${desc}` : head;
}

/** 從 style profiles / 預設風格 / global negative prompt 推出 styleBible 摘要。 */
function buildStyleBible(framework: {
  styleProfilesJson: Array<Record<string, unknown>> | null;
  defaultStyleProfileId: string | null;
  globalNegativePrompt: string | null;
}): string | undefined {
  const parts: string[] = [];
  const profileCount = Array.isArray(framework.styleProfilesJson)
    ? framework.styleProfilesJson.length
    : 0;
  if (profileCount > 0) parts.push(`${profileCount} 個風格設定檔`);
  if (framework.defaultStyleProfileId) parts.push(`預設風格已設定`);
  if (framework.globalNegativePrompt && framework.globalNegativePrompt.trim()) {
    parts.push("已設定全域負向提示");
  }
  return parts.length > 0 ? parts.join("、") : undefined;
}

function mapAsset(row: {
  id: number;
  title: string;
  assetType: string;
  thumbnailUrl: string | null;
  createdAt: Date | string;
}): ProjectContextAsset {
  return {
    id: row.id,
    title: row.title,
    assetType: row.assetType,
    ...(row.thumbnailUrl ? { thumbnailUrl: row.thumbnailUrl } : {}),
    createdAt: toIso(row.createdAt),
  };
}

/**
 * 取得單一專案的上下文摘要。
 *
 * @throws ProjectContextAccessError 找不到專案或不屬於該使用者時。
 */
export async function getProjectContextSummary(
  userId: number,
  projectId: number,
): Promise<ProjectContextSummary> {
  const project = await getCreativeProject(projectId);
  if (!project) {
    throw new ProjectContextAccessError("not_found", "找不到創作專案");
  }
  if (project.userId !== userId) {
    throw new ProjectContextAccessError("forbidden", "無權存取此創作專案");
  }

  // 世界觀框架（只有屬於同一使用者才採用，否則忽略而非報錯）。
  let worldview: string | undefined;
  let styleBible: string | undefined;
  if (project.worldFrameworkId) {
    const framework = await getWorldbuildingFramework(project.worldFrameworkId);
    if (framework && framework.userId === userId) {
      worldview = buildWorldview(framework);
      styleBible = buildStyleBible(framework);
    }
  }

  // 最近素材：M1-A 尚無 project_asset_links，先用使用者最近素材近似。
  const assetRows = await getRecentUserAssets(userId);
  const recentAssets = assetRows.map(mapAsset);

  // 未完成任務：M1-B orchestration_runs 帶入（非 completed / cancelled）。
  const openTasks = await getOpenTasks(project.id);

  return {
    projectId: project.id,
    title: project.title,
    status: project.status,
    ...(snippet(project.description) ? { description: snippet(project.description) } : {}),
    ...(worldview ? { worldview } : {}),
    ...(styleBible ? { styleBible } : {}),
    recentAssets,
    recentAssetsScope: "user",
    openTasks,
    updatedAt: toIso(project.updatedAt),
    pendingSections: ["teamData", "budget", "projectScopedAssets"],
  };
}

/**
 * 取專案最近的 orchestration runs，篩掉已結束的，整理成未完成任務清單。
 * runs 已由 db 依 createdAt 由新到舊排序。
 */
async function getOpenTasks(
  projectId: number,
): Promise<ProjectContextOpenTask[]> {
  const rows = await getOrchestrationRunsByProject(
    projectId,
    OPEN_TASK_FETCH_LIMIT,
  );
  return rows
    .filter(row => !CLOSED_TASK_STATUSES.has(row.status))
    .slice(0, OPEN_TASK_LIMIT)
    .map(row => ({
      id: String(row.id),
      title: row.intent,
      status: row.status,
      mode: row.mode,
      estimatedCostUsd: toNumberOrNull(row.estimatedCostUsd),
      createdAt: toIso(row.createdAt),
    }));
}

/** 抽出來方便測試/重用：取使用者最近 N 筆素材。 */
async function getRecentUserAssets(userId: number) {
  const rows = await getDigitalAssetsByUser(userId, RECENT_ASSET_LIMIT);
  return rows.slice(0, RECENT_ASSET_LIMIT);
}
