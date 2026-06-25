/**
 * connectionService — M4/M5 外部資料來源連接管理
 * ────────────────────────────────────────────────────────────────────────────
 * 建立 / 列出 / 健檢 / 啟停外部來源連接（cloud Drive、notes Notion）。
 *
 * 安全：
 *   - credential（如 Notion token）以 secretCrypto 後端加密存 encryptedCredentialRef，
 *     **絕不**回前端 / 寫 log。所有對外視圖走 toConnectionView（不含 credential）。
 *   - Drive 走既有 OAuth（userGoogleOauthTokens），不另存憑證。
 *   - 一律以 authenticated userId 比對連接擁有權。
 */

import * as db from "../../db";
import { encryptSecret, decryptSecret } from "../../_core/secretCrypto";
import { getValidDriveAccessToken } from "../../services/googleDrive";
import {
  ContextPacketAccessError,
  type DataConnectionView,
  type ConnectionKind,
} from "./contracts";
import type { DataSourceConnection } from "../../../drizzle/schema";

async function assertTeamMembership(teamId: number, userId: number): Promise<void> {
  const team = await db.getTeam(teamId);
  if (!team) throw new ContextPacketAccessError("not_found", "找不到指定團隊");
  const membership = await db.getTeamMembership(teamId, userId);
  if (!membership && team.ownerId !== userId) {
    throw new ContextPacketAccessError("forbidden", "你不是此團隊的成員，無法建立歸屬於該團隊的連接");
  }
}

async function assertProjectOwnership(projectId: number, userId: number): Promise<void> {
  const project = await db.getCreativeProject(projectId);
  if (!project) throw new ContextPacketAccessError("not_found", "找不到指定專案");
  if (project.userId !== userId) {
    throw new ContextPacketAccessError("forbidden", "你不是此專案的擁有者，無法建立歸屬於該專案的連接");
  }
}

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** 對外視圖：**絕不**含 encryptedCredentialRef。 */
function toConnectionView(row: DataSourceConnection): DataConnectionView {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    teamId: row.teamId ?? null,
    projectId: row.projectId ?? null,
    kind: row.kind,
    provider: row.provider,
    authType: row.authType,
    status: row.status,
    config: (row.configJson as Record<string, unknown> | null) ?? null,
    lastHealthCheckAt: toIso(row.lastHealthCheckAt),
    createdAt: toIso(row.createdAt) ?? new Date(0).toISOString(),
    updatedAt: toIso(row.updatedAt) ?? new Date(0).toISOString(),
  };
}

async function loadOwnedConnection(
  userId: number,
  id: number
): Promise<DataSourceConnection> {
  const row = await db.getDataSourceConnection(id);
  if (!row) throw new ContextPacketAccessError("not_found", "找不到資料來源連接");
  if (row.ownerUserId !== userId) {
    throw new ContextPacketAccessError("forbidden", "無權存取此連接");
  }
  return row;
}

export interface CreateConnectionInput {
  kind: ConnectionKind;
  provider: string;
  teamId?: number | null;
  projectId?: number | null;
  /** api_key 類（如 Notion）必填；oauth 類（如 Drive）省略。 */
  credential?: string | null;
  config?: Record<string, unknown> | null;
}

export async function createConnection(
  userId: number,
  input: CreateConnectionInput
): Promise<DataConnectionView> {
  // AIDV-185: 驗 teamId/projectId 歸屬，防止把連接硬塞進不屬於自己的 team/project。
  if (input.teamId != null) {
    await assertTeamMembership(input.teamId, userId);
  }
  if (input.projectId != null) {
    await assertProjectOwnership(input.projectId, userId);
  }

  const authType: DataSourceConnection["authType"] =
    input.provider === "google_drive" ? "oauth" : "api_key";

  let encryptedCredentialRef: string | null = null;
  if (authType === "api_key") {
    const cred = input.credential?.trim();
    if (!cred) {
      throw new ContextPacketAccessError(
        "forbidden",
        "此來源需要 API 憑證（token）"
      );
    }
    encryptedCredentialRef = encryptSecret(cred);
  }

  const id = await db.createDataSourceConnection({
    ownerUserId: userId,
    teamId: input.teamId ?? null,
    projectId: input.projectId ?? null,
    kind: input.kind,
    provider: input.provider,
    authType,
    encryptedCredentialRef,
    configJson: input.config ?? null,
    status: "pending",
  });

  const row = await db.getDataSourceConnection(id);
  if (!row) {
    throw new ContextPacketAccessError("not_found", "建立後讀取連接失敗");
  }
  return toConnectionView(row);
}

export async function listConnections(
  userId: number,
  projectId?: number | null
): Promise<DataConnectionView[]> {
  const rows = await db.listDataSourceConnectionsForUser(userId, projectId);
  return rows.map(toConnectionView);
}

export async function setConnectionStatus(
  userId: number,
  id: number,
  status: DataSourceConnection["status"]
): Promise<DataConnectionView> {
  await loadOwnedConnection(userId, id);
  await db.updateDataSourceConnection(id, { status });
  const row = await db.getDataSourceConnection(id);
  return toConnectionView(row!);
}

// AIDV-185: 刪除連接（含 encryptedCredentialRef）——解決加密憑證永久殘留缺口。
export async function deleteConnection(
  userId: number,
  id: number
): Promise<void> {
  await loadOwnedConnection(userId, id);
  await db.deleteDataSourceConnection(id);
}

/** 健檢：依 provider 打一個輕量 read API，更新 status + lastHealthCheckAt。 */
export async function testConnection(
  userId: number,
  id: number
): Promise<DataConnectionView> {
  const conn = await loadOwnedConnection(userId, id);
  const ok = await runHealthCheck(userId, conn);
  await db.updateDataSourceConnection(id, {
    status: ok ? "active" : "error",
    lastHealthCheckAt: new Date(),
  });
  const row = await db.getDataSourceConnection(id);
  return toConnectionView(row!);
}

async function runHealthCheck(
  userId: number,
  conn: DataSourceConnection
): Promise<boolean> {
  if (conn.provider === "google_drive") {
    const token = await getValidDriveAccessToken(userId);
    return token != null;
  }
  if (conn.provider === "notion") {
    if (!conn.encryptedCredentialRef) return false;
    let token: string;
    try {
      token = decryptSecret(conn.encryptedCredentialRef);
    } catch {
      return false;
    }
    try {
      const res = await fetch(`${NOTION_API}/users/me`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": NOTION_VERSION,
        },
      });
      return res.ok;
    } catch {
      return false;
    }
  }
  return false;
}
