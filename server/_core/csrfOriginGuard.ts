/**
 * csrfOriginGuard.ts — AIDV-558
 *
 * 補上「非 tRPC 變更型 Express 路由」的 CSRF 缺口。
 *
 * 白話：AIDV-219 的 CSRF 防護（要 POST 帶 `x-trpc-source` 自訂 header）只掛在
 * `/api/trpc`。所有其它會「改狀態」的 Express 路由（如 `POST /api/oauth/logout`、
 * `POST /api/auth/2fa/setup`、`POST /api/auth/refresh`…）完全沒有等價防護。
 * 由於正式站的 session cookie 是 `SameSite=None; Secure`（跨站會自動夾帶）、
 * 且 server 解析 urlencoded body（跨站 `<form>` POST 屬 CORS simple request、不觸發
 * preflight），攻擊者放一張自動送出的表單就能借受害者的 cookie 觸發這些動作
 * （登出 CSRF 已實證）。
 *
 * 本中介層用「Origin/Referer allowlist」把這個缺口一次補上：對所有變更型、
 * 非 webhook、非 tRPC 的路由，若請求**攜帶 session cookie**（＝ CSRF 攻擊賴以
 * 冒充的環境憑證），就要求其 `Origin`（或退而求其次 `Referer`）落在信任來源內，
 * 否則回 403。
 *
 * 為什麼用「有帶 session cookie 才強制」這道閘：
 *   CSRF 的本質是「借用受害者瀏覽器自動夾帶的 cookie」。沒帶 cookie 的請求
 *   （例如用 Bearer token 的程式化客戶端、server-to-server 呼叫）根本無從被冒充，
 *   放行可大幅降低誤殺，又不放過任何真實 CSRF 路徑（攻擊請求一定帶著受害者 cookie）。
 *
 * 排除：
 *   - 安全方法（GET/HEAD/OPTIONS）— 不改狀態。
 *   - webhook 路由（fal/suno/replicate/stripe）— 各自驗簽（HMAC/Ed25519/token），
 *     呼叫端是外部服務、沒有 Origin，且不靠 cookie 認證。
 *   - `/api/trpc` — 已由既有 `x-trpc-source` guard（AIDV-219）防護，不重複攔。
 *
 * 旗標：沿用既有的全域 CSRF kill switch `CSRF_PROTECTION=0`（與 tRPC guard 同一顆），
 * 一鍵可秒關；production 預設 ON。`NODE_ENV=test` 時不套用（與 tRPC guard 一致，
 * 避免影響測試套件）。可用 `CSRF_TRUSTED_ORIGINS`（逗號分隔）追加信任來源。
 */
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { parse as parseCookie } from "cookie";
import { COOKIE_NAME } from "@shared/const";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * 不套用 Origin 檢查的路徑基底（以「路段邊界」比對，避免誤排除未來新路由）。
 * - webhook：各自驗簽、外部來源無 Origin、非 cookie 認證。
 * - /api/trpc：已有 x-trpc-source guard，避免雙重攔截破壞既有行為。
 *
 * 用 `path === base || path.startsWith(base + "/")` 比對（而非裸 startsWith），
 * 以免 `/api/webhooks-config`、`/api/trpcfoo` 之類同前綴路由被悄悄豁免。
 */
const EXCLUDED_PATH_BASES = [
  "/api/webhook", // fal / suno / replicate（單數）：/api/webhook/<x>
  "/api/webhooks", // stripe：/api/webhooks/stripe + webhooksRouter 掛載點
  "/api/trpc", // 既有 AIDV-219 CSRF guard 負責
];

/**
 * 把任意 origin/URL 字串正規化成 `protocol//host[:port]`（小寫、無路徑、無結尾斜線）。
 * 解析失敗（含字面 "null" origin）回 null＝不可信。
 */
export function normalizeOrigin(value: string | undefined | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") return null;
  try {
    const url = new URL(trimmed);
    if (!url.protocol || !url.host) return null;
    return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}`;
  } catch {
    return null;
  }
}

function isLocalhostOrigin(normalized: string): boolean {
  try {
    const host = new URL(normalized).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  } catch {
    return false;
  }
}

/** 讀 `CSRF_TRUSTED_ORIGINS`（逗號分隔）→ 正規化後的 origin 陣列。 */
function readTrustedOriginsFromEnv(): string[] {
  const raw = process.env.CSRF_TRUSTED_ORIGINS;
  if (!raw) return [];
  return raw
    .split(",")
    .map(s => normalizeOrigin(s))
    .filter((s): s is string => Boolean(s));
}

/**
 * 由請求本身推導「自我來源」`protocol//host`。
 * 仰賴上游反向代理（Railway）把 `Host` 釘成真實對外網域、且 `trust proxy=1` 讓
 * `req.protocol` 反映 `X-Forwarded-Proto`。這不構成 CSRF 繞過：跨站攻擊請求由受害者
 * 瀏覽器發出，攻擊者無法同時偽造受害者送出的 `Host` 與相符的 `Origin`。
 */
function selfOrigin(req: Request): string | null {
  const host = req.headers["host"];
  if (!host || typeof host !== "string") return null;
  const proto = (req.protocol || "https").toLowerCase();
  return normalizeOrigin(`${proto}://${host}`);
}

export interface OriginAllowedDeps {
  trustedOrigins: string[];
  isProduction: boolean;
}

/**
 * 判斷候選 origin 是否可信：自我來源（同源）∪ env 信任清單 ∪（非 prod 時）localhost。
 */
export function isOriginAllowed(
  candidate: string | undefined | null,
  req: Request,
  deps: OriginAllowedDeps
): boolean {
  const normalized = normalizeOrigin(candidate);
  if (!normalized) return false;

  const self = selfOrigin(req);
  if (self && normalized === self) return true;

  for (const trusted of deps.trustedOrigins) {
    if (normalized === trusted) return true;
  }

  if (!deps.isProduction && isLocalhostOrigin(normalized)) return true;

  return false;
}

/** 請求是否攜帶 session cookie（＝可被 CSRF 冒充的環境憑證）。 */
function hasSessionCookie(req: Request): boolean {
  const header = req.headers["cookie"];
  if (!header || typeof header !== "string") return false;
  try {
    const cookies = parseCookie(header);
    return Boolean(cookies[COOKIE_NAME]);
  } catch {
    // 解析失敗時保守視為「有 cookie」，讓 Origin 檢查照常把關。
    return header.includes(`${COOKIE_NAME}=`);
  }
}

function isExcludedPath(path: string): boolean {
  return EXCLUDED_PATH_BASES.some(base => path === base || path.startsWith(`${base}/`));
}

function reject(res: Response, reason: string): void {
  res.status(403).json({ error: `CSRF 防護：${reason}` });
}

export interface CsrfOriginGuardOptions {
  /** 額外信任來源（正規化前的 origin 字串）；預設讀 env `CSRF_TRUSTED_ORIGINS`。 */
  trustedOrigins?: string[];
}

/**
 * 建立 CSRF Origin/Referer allowlist 中介層。
 *
 * 旗標與環境一律於「每次請求」即時讀取，方便測試逐案覆寫 env，
 * 也讓 `CSRF_PROTECTION=0` kill switch 可即時生效。
 */
export function createCsrfOriginGuard(options: CsrfOriginGuardOptions = {}): RequestHandler {
  return function csrfOriginGuard(req: Request, res: Response, next: NextFunction): void {
    const method = (req.method || "GET").toUpperCase();
    if (SAFE_METHODS.has(method)) {
      next();
      return;
    }
    // 全域 kill switch（與 tRPC guard 同旗標）＋ 測試環境不套用
    if (process.env.CSRF_PROTECTION === "0" || process.env.NODE_ENV === "test") {
      next();
      return;
    }

    const path = req.path || req.url || "";
    if (isExcludedPath(path)) {
      next();
      return;
    }

    // 只在請求攜帶 session cookie 時強制（無 cookie＝無從被 CSRF 冒充）。
    if (!hasSessionCookie(req)) {
      next();
      return;
    }

    const deps: OriginAllowedDeps = {
      trustedOrigins:
        options.trustedOrigins?.map(o => normalizeOrigin(o)).filter((s): s is string => Boolean(s)) ??
        readTrustedOriginsFromEnv(),
      isProduction: process.env.NODE_ENV === "production",
    };

    const origin = req.headers["origin"];
    const referer = req.headers["referer"]; // 線上 header 一律是 "Referer"（單 r）
    const candidate =
      (typeof origin === "string" && origin) || (typeof referer === "string" && referer) || null;

    if (!candidate) {
      reject(res, "變更型請求缺少 Origin/Referer");
      return;
    }
    if (!isOriginAllowed(candidate, req, deps)) {
      reject(res, "Origin 不在信任清單");
      return;
    }

    next();
  };
}
