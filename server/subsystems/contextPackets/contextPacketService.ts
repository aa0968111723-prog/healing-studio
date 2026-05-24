/**
 * contextPackets / contextPacketService — M4 團隊內部資料接入創作上下文
 * ────────────────────────────────────────────────────────────────────────────
 * 把 project + 啟用中的資料來源（第一版：team_data；之後 cloud / notes / mcp）
 * 摘成可重用、有 TTL 的 context packet。
 *
 * 安全：
 *   - 一律以 authenticated userId 比對 project 擁有權。
 *   - 內部素材逐筆過 loadMaterialForRead（adapter 內），再經 access rule。
 *   - 不呼叫任何昂貴模型：summary 先用 deterministic 拼接（見標記）。
 */

import { getCreativeProject } from "../../db";
import * as db from "../../db";
import { getTeamMembership } from "../../db";
import { teamDataAdapter } from "./adapters/teamDataAdapter";
import { createDriveAdapter, createNotionAdapter } from "./adapters/external";
import {
  ContextPacketAccessError,
  type CompileProjectContextPacketInput,
  type ContextPacketView,
  type ContextSourceRef,
  type DataSourceAdapter,
  type ProjectAccessRuleView,
  type AccessLevel,
  type CompileMode,
} from "./contracts";
import type {
  ContextPacket,
  ProjectDataAccessRule,
} from "../../../drizzle/schema";

/** packet TTL（毫秒）。30 分鐘內同 project 重用，避免重複長上下文成本。可調。 */
const PACKET_TTL_MS = 30 * 60_000;
const SOURCE_LIMIT = 8;

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function snippet(text: string | null | undefined, max = 160): string {
  if (!text) return "";
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** 確認 projectId 屬於該使用者；不存在 / 非擁有者 → 丟錯。 */
async function assertProjectOwnership(userId: number, projectId: number) {
  const project = await getCreativeProject(projectId);
  if (!project) {
    throw new ContextPacketAccessError("not_found", "找不到創作專案");
  }
  if (project.userId !== userId) {
    throw new ContextPacketAccessError("forbidden", "無權存取此創作專案");
  }
  return project;
}

/**
 * 某 project 啟用中的資料來源 adapters：team_data 永遠在，外加該使用者已連接且
 * status=active 的外部來源（cloud Drive / notes Notion）。mcp 留待後續里程碑。
 */
async function getEnabledAdaptersForProject(
  userId: number,
  projectId: number
): Promise<DataSourceAdapter[]> {
  const adapters: DataSourceAdapter[] = [teamDataAdapter];
  const connections = await db.listDataSourceConnectionsForUser(userId, projectId);
  // 連接層級存取規則：team-scoped 連接若有明確 none 規則 → 整源排除（admin 可關）。
  const blockedConnectionIds = new Set<number>();
  const teamRuleCache = new Map<number, Awaited<ReturnType<typeof db.listProjectDataAccessRules>>>();
  for (const conn of connections) {
    if (conn.status !== "active" || conn.teamId == null) continue;
    let rules = teamRuleCache.get(conn.teamId);
    if (!rules) {
      rules = await db.listProjectDataAccessRules(conn.teamId, projectId);
      teamRuleCache.set(conn.teamId, rules);
    }
    if (rules.some(r => r.connectionId === conn.id && r.accessLevel === "none")) {
      blockedConnectionIds.add(conn.id);
    }
  }
  for (const conn of connections) {
    if (conn.status !== "active") continue;
    if (blockedConnectionIds.has(conn.id)) continue;
    if (conn.kind === "cloud" && conn.provider === "google_drive") {
      adapters.push(createDriveAdapter(conn));
    } else if (conn.kind === "notes" && conn.provider === "notion") {
      adapters.push(createNotionAdapter(conn));
    }
  }
  return adapters;
}

function buildQuery(project: {
  title: string;
  description: string | null;
}): string {
  const desc = snippet(project.description, 120);
  return desc ? `${project.title} ${desc}` : project.title;
}

/** Deterministic 摘要拼接（不呼叫模型）。 */
function buildSummaryMarkdown(
  project: { title: string },
  refs: ContextSourceRef[]
): string {
  if (refs.length === 0) {
    return `# ${project.title} · 可用資料來源\n\n（目前沒有可用的內部資料來源。可在資料庫上傳團隊資料，或為此專案設定資料存取規則。）`;
  }
  const lines = refs.map(
    r => `- 「${r.title}」（${r.kind} · ${r.accessLevel}）：${r.snippet ?? ""}`
  );
  // TODO(training-track): 之後可在此把 deterministic 拼接換成 cheap-LLM（如
  // gemini-flash）摘要，並把 createdByModel 填上模型 id。
  return `# ${project.title} · 可用資料來源\n\n${lines.join("\n")}`;
}

function toView(row: ContextPacket, reused: boolean): ContextPacketView {
  return {
    id: row.id,
    projectId: row.projectId,
    teamId: row.teamId ?? null,
    scope: row.scope,
    summaryMarkdown: row.summaryMarkdown ?? "",
    sourceRefs: (row.sourceRefsJson as ContextSourceRef[] | null) ?? [],
    tokenEstimate: row.tokenEstimate ?? 0,
    createdByModel: row.createdByModel ?? null,
    expiresAt: toIso(row.expiresAt),
    createdAt: toIso(row.createdAt) ?? new Date(0).toISOString(),
    reused,
  };
}

/**
 * 取最新未過期的 packet；有就回（reused=true），否則回 null（由 caller 決定重算）。
 * **cache-only**，不會觸發 compile —— 給 getProjectContextSummary 這類熱路徑用。
 */
export async function reuseOrRefreshPacket(args: {
  userId: number;
  projectId: number;
  scope?: "project" | "team" | "user";
}): Promise<ContextPacketView | null> {
  const scope = args.scope ?? "project";
  const row = await db.getLatestContextPacketForProject(args.projectId, scope);
  if (!row) return null;
  if (row.userId !== args.userId) return null; // 防禦：creativeProjects 為單人擁有
  if (!row.expiresAt || new Date(row.expiresAt).getTime() <= Date.now()) {
    return null; // 過期
  }
  return toView(row, true);
}

/**
 * 編譯一個 project 的 context packet：跑啟用中的 adapters → 套 mode → 組摘要 →
 * 寫 packet。不呼叫昂貴模型。
 *
 * @throws ContextPacketAccessError 專案不存在 / 非擁有者。
 */
export async function compileProjectContextPacket(
  input: CompileProjectContextPacketInput
): Promise<ContextPacketView> {
  const project = await assertProjectOwnership(input.userId, input.projectId);

  if (!input.forceRefresh) {
    const cached = await reuseOrRefreshPacket({
      userId: input.userId,
      projectId: input.projectId,
      scope: "project",
    });
    if (cached) return cached;
  }

  const query = input.query?.trim() || buildQuery(project);

  // 合併所有 adapter 的來源（各自已套用自己的 ACL）。
  const refs: ContextSourceRef[] = [];
  const adapters = await getEnabledAdaptersForProject(
    input.userId,
    input.projectId
  );
  for (const adapter of adapters) {
    const got = await adapter.collect({
      userId: input.userId,
      projectId: input.projectId,
      query,
      limit: SOURCE_LIMIT,
      mode: input.mode,
    });
    refs.push(...got);
  }

  const summaryMarkdown = buildSummaryMarkdown(project, refs);
  const tokenEstimate = Math.ceil(summaryMarkdown.length / 4);
  const expiresAt = new Date(Date.now() + PACKET_TTL_MS);

  const id = await db.createContextPacket({
    projectId: input.projectId,
    teamId: null,
    userId: input.userId,
    scope: "project",
    sourceRefsJson: refs,
    summaryMarkdown,
    tokenEstimate,
    createdByModel: null,
    expiresAt,
  });

  const row = await db.getContextPacket(id);
  if (!row) {
    throw new ContextPacketAccessError("not_found", "建立後讀取 packet 失敗");
  }
  return toView(row, false);
}

/**
 * 取某 project 最新一筆 packet（即使已過期也回，供 UI 顯示「上次整理」）。
 * reused 反映是否仍在 TTL 內。不重算。
 */
export async function getLatestProjectPacket(
  userId: number,
  projectId: number
): Promise<ContextPacketView | null> {
  await assertProjectOwnership(userId, projectId);
  const row = await db.getLatestContextPacketForProject(projectId, "project");
  if (!row || row.userId !== userId) return null;
  const fresh = !!row.expiresAt && new Date(row.expiresAt).getTime() > Date.now();
  return toView(row, fresh);
}

// ─── Project Data Access Rules ──────────────────────────────────────────────

function ruleToView(row: ProjectDataAccessRule): ProjectAccessRuleView {
  return {
    id: row.id,
    teamId: row.teamId,
    projectId: row.projectId ?? null,
    materialId: row.materialId ?? null,
    connectionId: row.connectionId ?? null,
    accessLevel: row.accessLevel,
    allowedModes: (row.allowedModesJson as string[] | null) ?? null,
    createdBy: row.createdBy,
    updatedAt: toIso(row.updatedAt) ?? new Date(0).toISOString(),
  };
}

/** 讀規則：任一團隊成員可讀。 */
async function assertTeamMember(userId: number, teamId: number) {
  const membership = await getTeamMembership(teamId, userId);
  if (!membership) {
    throw new ContextPacketAccessError("forbidden", "你不是此團隊的成員");
  }
  return membership;
}

/** 寫規則：需 owner / admin。 */
async function assertTeamAdmin(userId: number, teamId: number) {
  const membership = await assertTeamMember(userId, teamId);
  if (membership.role !== "owner" && membership.role !== "admin") {
    throw new ContextPacketAccessError(
      "forbidden",
      "只有團隊 owner / admin 可設定資料存取規則"
    );
  }
  return membership;
}

export async function listProjectAccessRules(
  userId: number,
  args: { teamId: number; projectId: number | null }
): Promise<ProjectAccessRuleView[]> {
  await assertTeamMember(userId, args.teamId);
  const rows = await db.listProjectDataAccessRules(args.teamId, args.projectId);
  return rows.map(ruleToView);
}

export interface SetAccessRuleInput {
  materialId: number | null;
  accessLevel: AccessLevel;
  allowedModes?: CompileMode[] | null;
}

export async function setProjectAccessRules(
  userId: number,
  args: {
    teamId: number;
    projectId: number | null;
    rules: SetAccessRuleInput[];
  }
): Promise<ProjectAccessRuleView[]> {
  await assertTeamAdmin(userId, args.teamId);
  for (const rule of args.rules) {
    await db.upsertProjectDataAccessRule({
      teamId: args.teamId,
      projectId: args.projectId,
      materialId: rule.materialId,
      connectionId: null,
      collectionId: null,
      accessLevel: rule.accessLevel,
      allowedModesJson: rule.allowedModes ?? null,
      createdBy: userId,
    });
  }
  const rows = await db.listProjectDataAccessRules(args.teamId, args.projectId);
  return rows.map(ruleToView);
}
