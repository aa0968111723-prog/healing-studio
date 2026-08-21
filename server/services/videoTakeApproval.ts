/**
 * videoTakeApproval.ts — AIDV-16 草稿 take 核准的伺服器端可強制守門
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 問題：精修（Veo 3.1，90pts/5s）的 422 守門若只看「客戶端自報的
 * approvedTake.status」，任何直連 tRPC 的呼叫端傳 status:"approved" 即可
 * 繞過守門直送旗艦模型 —— 驗收 #2「未核准 take 不得精修」在 server 端
 * 不可強制。
 *
 * 解法（無 DB 依賴的最小可強制核心，與 webhookTokens.ts 同模式）：
 * 用伺服器持有的密鑰簽發兩段式 HMAC capability token，形成不可偽造的
 * 「草稿 → 核准 → 精修」鏈：
 *
 *   1. seedanceTextToVideo（草稿層）由 server 產生 takeId 並簽發
 *      draftToken = HMAC(vtake:draft:<takeId>:<userId>)。
 *      → 證明「這個 take 確實由本伺服器為此使用者生成過草稿」。
 *   2. approveDraftTake（核准動作）驗 draftToken 後簽發帶時效的
 *      approvalToken = <exp>.HMAC(vtake:approved:<takeId>:<userId>:<exp>)。
 *      → 證明「此使用者對這個 take 明確做過核准動作」。
 *   3. veo31RefineSegment（精修層）驗 approvalToken（takeId＋userId＋未過期）
 *      才放行；缺失、偽造、過期、跨使用者 一律 422，且拒絕先於任何 dispatch。
 *
 * 偽造任一 token 需要伺服器密鑰；跨使用者重放因 userId 入簽而失效。
 * 真正的 take 持久化（video_takes 表＋shot 畫布 UI）仍為 follow-up —
 * 本模組只把「核准狀態不可由客戶端自報」這件事變成 server 可強制。
 *
 * 密鑰：優先 JWT_SECRET（與 webhookTokens 相同來源）；未設定時退回
 * 每程序隨機密鑰（dev / 測試仍能完整走通鏈路，且同樣不可偽造，
 * 只是重啟後舊 token 失效 —— 對守門而言是安全側失效）。
 */

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { serverEnv } from "../_core/env.validated";

/** 核准 token 的有效期（毫秒）。核准後須在此時限內送精修，逾期需重新核准。 */
export const TAKE_APPROVAL_TOKEN_TTL_MS = 60 * 60 * 1000; // 60 分鐘

/** 精修守門：approvalToken 缺失 / 無效 / 過期 / 非本人時的 422 訊息。 */
export const REFINE_APPROVAL_TOKEN_INVALID_MESSAGE =
  "核准憑證缺失或無效（可能已過期、被竄改或非本人核發）。" +
  "請先呼叫 approveDraftTake 取得有效核准憑證後再送精修。";

/** 核准動作：draftToken 無效時的 422 訊息。 */
export const APPROVE_DRAFT_TOKEN_INVALID_MESSAGE =
  "草稿憑證無效：此 takeId 並非本伺服器為你生成的草稿 take，無法核准。";

let processFallbackSecret: string | null = null;

function getSecret(): string {
  const secret = serverEnv.JWT_SECRET;
  if (secret && secret.length >= 8) return secret;
  if (!processFallbackSecret) {
    processFallbackSecret = randomBytes(32).toString("hex");
  }
  return processFallbackSecret;
}

function hmacHex(message: string): string {
  return createHmac("sha256", getSecret()).update(message).digest("hex");
}

/** 定時安全比較兩個 hex 字串（長度不同直接 false，不 throw）。 */
function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * 草稿生成時由 server 鑄造 take 身分：takeId＋綁定 userId 的 draftToken。
 * 呼叫端（seedanceTextToVideo）把兩者一起回傳給前端。
 */
export function mintDraftTake(userId: number): {
  takeId: string;
  draftToken: string;
} {
  const takeId = `take_${randomUUID()}`;
  return {
    takeId,
    draftToken: hmacHex(`vtake:draft:${takeId}:${userId}`),
  };
}

/** 驗證 draftToken 是否確為本伺服器為（takeId, userId）簽發。 */
export function verifyDraftTakeToken(
  takeId: string,
  userId: number,
  draftToken: string | null | undefined
): boolean {
  if (!takeId || !draftToken) return false;
  return safeEqualHex(hmacHex(`vtake:draft:${takeId}:${userId}`), draftToken);
}

/**
 * 核准動作簽發帶時效的 approvalToken（格式：`<expiresAtMs>.<hmac>`）。
 * 只應在 verifyDraftTakeToken 通過後呼叫。
 */
export function issueTakeApprovalToken(
  takeId: string,
  userId: number,
  now: number = Date.now()
): { approvalToken: string; expiresAt: number } {
  const expiresAt = now + TAKE_APPROVAL_TOKEN_TTL_MS;
  const sig = hmacHex(`vtake:approved:${takeId}:${userId}:${expiresAt}`);
  return { approvalToken: `${expiresAt}.${sig}`, expiresAt };
}

// ─── 精修送單冪等鍵（60s 防連點雙扣）──────────────────────────────────────────

/** 同一（userId, takeId）在此窗內重複送精修一律拒絕（防連點雙扣）。 */
export const REFINE_IDEMPOTENCY_WINDOW_MS = 60 * 1000;

export const REFINE_DUPLICATE_SUBMIT_MESSAGE =
  "此 take 在 60 秒內已送出過精修請求，請稍候再試（防止連點重複扣點）。";

const recentRefineSubmits = new Map<string, number>();

function pruneRecentRefineSubmits(now: number): void {
  if (recentRefineSubmits.size < 256) return;
  for (const [key, at] of recentRefineSubmits) {
    if (now - at >= REFINE_IDEMPOTENCY_WINDOW_MS) recentRefineSubmits.delete(key);
  }
}

/** 是否為冪等窗內的重複精修送單。 */
export function isRecentRefineSubmit(
  userId: number,
  takeId: string,
  now: number = Date.now()
): boolean {
  const at = recentRefineSubmits.get(`${userId}:${takeId}`);
  return at !== undefined && now - at < REFINE_IDEMPOTENCY_WINDOW_MS;
}

/** 成功送單後登記冪等鍵（送單失敗不登記，讓使用者可立即重試）。 */
export function markRefineSubmit(
  userId: number,
  takeId: string,
  now: number = Date.now()
): void {
  pruneRecentRefineSubmits(now);
  recentRefineSubmits.set(`${userId}:${takeId}`, now);
}

/**
 * 精修守門核心：驗 approvalToken 綁定（takeId, userId）且未過期。
 * 純驗證、不 throw；router 端據此決定是否拋 422。
 */
export function verifyTakeApprovalToken(
  takeId: string,
  userId: number,
  approvalToken: string | null | undefined,
  now: number = Date.now()
): boolean {
  if (!takeId || !approvalToken) return false;
  const dot = approvalToken.indexOf(".");
  if (dot <= 0) return false;
  const expStr = approvalToken.slice(0, dot);
  const sig = approvalToken.slice(dot + 1);
  if (!/^\d{1,16}$/.test(expStr) || sig.length === 0) return false;
  const expiresAt = Number(expStr);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
  return safeEqualHex(
    hmacHex(`vtake:approved:${takeId}:${userId}:${expiresAt}`),
    sig
  );
}
