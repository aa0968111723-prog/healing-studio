/**
 * auditLog.ts — 全站操作稽核軌跡服務（AIDV-123 基礎版）
 * ──────────────────────────────────────────────────────────────────────────
 *
 * 統一稽核事件入口。把「關鍵寫入」操作（登入、建立/修改/刪除 專案・資產・
 * 提示詞・教材、共享/撤銷、生成、連接器授權、成本操作）記進 append-only 的
 * `global_audit_log` 表，供 admin 唯讀查詢／過濾／匯出。
 *
 * ── 已做（本 PR 基礎版）─────────────────────────────────────────────────
 *   • schema + migration（0076_global_audit_log，information_schema 守門、
 *     已登記 _journal.json idx 80）。
 *   • recordAuditEvent()：純函式、best-effort、fire-and-forget、絕不 throw、
 *     無 DB / demo 安全 skip。
 *   • extractRequestSource()：從 tRPC ctx.req 取 IP / User-Agent（沿用
 *     modelConsents.ts 既有 x-forwarded-for → req.ip 慣例）。
 *   • queryAuditEvents() / countAuditEvents()：admin 唯讀查詢（依 actor /
 *     action / targetType / 時間過濾 + 分頁），給 router 與匯出用。
 *   • 代表性接線 6 處（見各 router 的 recordAuditEvent 呼叫）；其中 assets
 *     toggleVisibility/delete 的 NOT_FOUND/越權路徑也記 result='failure'，
 *     讓越權探測留痕。其餘寫入點的失敗留痕為後續卡範圍（見下「待拍板 2」）。
 *
 * ── 設計決策 ───────────────────────────────────────────────────────────
 *   • Append-only / 不可竄改：本服務只提供 INSERT 與 SELECT，沒有任何
 *     update/delete 函式；admin router 也只暴露唯讀端點，一般使用者沒有
 *     任何寫/改稽核的端點 → 天然不可竄改。
 *   • action 用 varchar（非 enum）：接新寫入點是純加法，不需改 migration。
 *   • Best-effort 鐵則：所有寫入一律 fire-and-forget（setImmediate）+ 內部
 *     try/catch 吞錯，呼叫端永遠拿到 void、不會因稽核失敗而中斷主操作。
 *
 * ── 待 Bruce 拍板（基礎版刻意不做、留給後續卡）────────────────────────
 *   1. 保留天數（retention）：login_history 已有 cleanupOldHistory(90d) 樣板，
 *      稽核軌跡要保留幾天？（合規 vs 儲存成本）目前不自動清理。
 *   2. 要不要「全站接線」：本 PR 只接 6 個代表性寫入點；是否把全部寫入
 *      procedure（生成完成、連接器授權、成本操作、所有 CRUD…）都接上？
 *   3. 竄改防護程度：目前靠「無寫/改端點 + DB 權限」；是否要再加 hash-chain /
 *      WORM / 獨立稽核 DB / 寫入即簽章？
 *   4. IP 來源欄位：x-forwarded-for 在反向代理後可被偽造；是否改用平台
 *      可信 header（如 CF-Connecting-IP）或限定 trust proxy hops？
 */

import type { Request } from "express";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { getDb } from "../../db";
import { globalAuditLog, type InsertGlobalAuditLog } from "../../../drizzle/schema";

/** 稽核事件輸入（呼叫端提供；actor 通常來自 ctx.user）。 */
export interface AuditEventInput {
  /** 操作者 user id；系統/匿名操作可省略 */
  actorUserId?: number | null;
  /** 操作者角色快照 */
  actorRole?: string | null;
  /** <domain>.<verb>，如 "project.create" / "asset.share" / "auth.login" */
  action: string;
  /** 目標物型別，如 "project" / "asset" / "prompt" / "material" */
  targetType?: string | null;
  /** 目標物 id（會轉成字串儲存） */
  targetId?: string | number | null;
  /** 結果，預設 success */
  result?: "success" | "failure";
  /** 來源 IP */
  ipAddress?: string | null;
  /** 來源裝置 / UA */
  userAgent?: string | null;
  /** 附加 context */
  metadata?: Record<string, unknown> | null;
}

/**
 * 從 tRPC ctx.req 取來源 IP / User-Agent（best-effort，皆可為 undefined）。
 * 沿用 server/routers/modelConsents.ts 既有 x-forwarded-for → req.ip 慣例。
 */
export function extractRequestSource(req?: Pick<Request, "headers" | "ip">): {
  ipAddress?: string;
  userAgent?: string;
} {
  if (!req) return {};
  try {
    const xff = req.headers?.["x-forwarded-for"];
    const ipAddress = Array.isArray(xff)
      ? xff[0]
      : typeof xff === "string"
        ? xff.split(",")[0]?.trim()
        : req.ip;
    const ua = req.headers?.["user-agent"];
    const userAgent = Array.isArray(ua) ? ua[0] : ua;
    return {
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
    };
  } catch {
    return {};
  }
}

/**
 * 實際寫入（內部）。任何錯誤都吞掉並 log，不向外拋。
 * 無 DB（無 DATABASE_URL / demo / 連線失敗）→ 安全 skip。
 */
async function writeAuditEvent(event: AuditEventInput): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return; // 無 DB / demo：安全 skip，不影響任何主操作

    const row: InsertGlobalAuditLog = {
      actorUserId: event.actorUserId ?? null,
      actorRole: event.actorRole ?? null,
      action: event.action,
      targetType: event.targetType ?? null,
      targetId:
        event.targetId === null || event.targetId === undefined
          ? null
          : String(event.targetId),
      result: event.result ?? "success",
      ipAddress: event.ipAddress ?? null,
      userAgent: event.userAgent ?? null,
      metadata: event.metadata ?? null,
    };

    await db.insert(globalAuditLog).values(row);
  } catch (err) {
    // Best-effort：稽核寫入失敗絕不阻斷／影響原操作。
    console.warn(
      `[auditLog] recordAuditEvent failed action=${event.action} target=${event.targetType}:${event.targetId}:`,
      err
    );
  }
}

/**
 * 記錄一筆稽核事件。**Best-effort、fire-and-forget**：
 *   • 立即 return（void），不阻塞呼叫端關鍵路徑；
 *   • 用 setImmediate 推遲到下一個 tick 才真正寫 DB；
 *   • 內部吞所有錯誤（含無 DB），呼叫端永遠不會因稽核而失敗。
 *
 * 用法（接在原操作成功之後，不要 await）：
 * ```ts
 * recordAuditEvent({
 *   actorUserId: ctx.user.id,
 *   actorRole: ctx.user.role,
 *   action: "project.create",
 *   targetType: "project",
 *   targetId: id,
 *   ...extractRequestSource(ctx.req),
 * });
 * ```
 */
export function recordAuditEvent(event: AuditEventInput): void {
  // setImmediate：完全脫離原操作的呼叫鏈，連同步 throw 的可能性都隔離。
  setImmediate(() => {
    void writeAuditEvent(event);
  });
}

// ─── Admin 唯讀查詢 ─────────────────────────────────────────────────────────

export interface AuditQueryFilter {
  actorUserId?: number;
  action?: string;
  targetType?: string;
  /** 目標物 id（字串儲存；數字會轉成字串比對）。配合 gal_target_createdAt_idx。 */
  targetId?: string | number;
  /** ISO date（YYYY-MM-DD）起 */
  startDate?: string;
  /** ISO date（YYYY-MM-DD）迄（含當日） */
  endDate?: string;
  limit?: number;
  offset?: number;
}

function buildConditions(filter: AuditQueryFilter) {
  const conditions = [];
  if (filter.actorUserId !== undefined)
    conditions.push(eq(globalAuditLog.actorUserId, filter.actorUserId));
  if (filter.action) conditions.push(eq(globalAuditLog.action, filter.action));
  if (filter.targetType)
    conditions.push(eq(globalAuditLog.targetType, filter.targetType));
  if (filter.targetId !== undefined && filter.targetId !== null)
    // targetId 以 varchar 儲存，數字一律轉字串比對（對齊 writeAuditEvent 的 String()）。
    conditions.push(eq(globalAuditLog.targetId, String(filter.targetId)));
  if (filter.startDate)
    conditions.push(gte(globalAuditLog.createdAt, new Date(filter.startDate)));
  if (filter.endDate) {
    const end = new Date(filter.endDate);
    end.setDate(end.getDate() + 1); // 含 endDate 當日
    conditions.push(lte(globalAuditLog.createdAt, end));
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}

/**
 * 查詢稽核事件（admin 唯讀）。無 DB → 回空陣列（不 throw）。
 */
export async function queryAuditEvents(filter: AuditQueryFilter = {}) {
  const db = await getDb();
  if (!db) return [];
  const where = buildConditions(filter);
  return db
    .select()
    .from(globalAuditLog)
    .where(where)
    .orderBy(desc(globalAuditLog.createdAt))
    .limit(filter.limit ?? 50)
    .offset(filter.offset ?? 0);
}

/**
 * 計數（給分頁 total）。無 DB → 回 0。
 */
export async function countAuditEvents(
  filter: AuditQueryFilter = {}
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const where = buildConditions(filter);
  const [row] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(globalAuditLog)
    .where(where);
  return Number(row?.total ?? 0);
}
