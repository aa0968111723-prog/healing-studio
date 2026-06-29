/**
 * securityHeaders — 集中管理 HTTP 安全回應標頭設定
 * （AIDV-249 / AIDV-251 / AIDV-313 建立，AIDV-312 補強並消除測試漂移）
 *
 * 白話：這個檔案是「網站安全帽」的唯一設定來源。瀏覽器靠這些回應標頭來
 * 擋掉點擊劫持（clickjacking）、HTTP 降級中間人攻擊（MITM）、跨站讀取
 * 等攻擊。以前 production（index.ts）與單元測試各自寫了一份 helmet 設定，
 * 兩邊會悄悄不一致（測試斷言 Referrer-Policy=strict-origin-when-cross-origin，
 * 但 production 其實吐 helmet 預設的 no-referrer）。現在兩邊都 import 這份
 * 同一設定，測到的就是線上真正跑的，永遠不會再漂移。
 *
 * AIDV-312 補強重點：
 *   - HSTS 明確指定 max-age=31536000（1 年）＋ includeSubDomains ＋ preload，
 *     取代 helmet 8 預設的 180 天且無 preload（達 securityheaders.com A 等級）。
 *     註：includeSubDomains 在原本 helmet 預設下就已生效，本次只是延長期限並
 *     加上 preload 旗標；preload 旗標本身在未手動提交 hstspreload.org 前不會
 *     產生不可逆效果，因此屬零破壞性變更。
 *   - Referrer-Policy 明確設為 strict-origin-when-cross-origin（OWASP 建議值，
 *     跨站時只送來源網域、不洩漏內部路徑如 /video/project/abc123）。
 */
import helmet, { type HelmetOptions } from "helmet";
import type { Express, RequestHandler } from "express";

/**
 * Permissions-Policy 標頭值 — 關閉 healing-studio 不使用的瀏覽器功能，
 * 即使頁面被嵌入也無法存取相機/麥克風/定位/付款/USB。
 * Helmet 8.x 不會自動設定此標頭，需手動加。
 */
export const PERMISSIONS_POLICY =
  "camera=(), microphone=(), geolocation=(), payment=(), usb=()";

/**
 * production helmet 設定（index.ts 與單元測試共用的唯一來源）。
 *
 * CSP 備註（AIDV-251）：
 *   - 'unsafe-inline' 為 Vite dev HMR ＋ SPA shell 內嵌樣式所需
 *   - connect-src 'https:' 涵蓋所有經伺服器代理的 API 呼叫（fal/supabase 等）
 *   - frame-ancestors 'none' 對支援 CSP 的瀏覽器等同 X-Frame-Options: DENY
 *   - 可用 CSP_ENFORCEMENT=0 環境變數停用（當某 CDN/widget 需要新 directive 時）
 */
export const helmetOptions: HelmetOptions = {
  contentSecurityPolicy:
    process.env.CSP_ENFORCEMENT === "0"
      ? false
      : {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "blob:", "https:"],
            mediaSrc: ["'self'", "blob:", "https:"],
            connectSrc: ["'self'", "https:", "wss:"],
            fontSrc: ["'self'", "data:"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            frameSrc: ["'none'"],
            workerSrc: ["'self'", "blob:"],
            frameAncestors: ["'none'"],
          },
        },
  crossOriginEmbedderPolicy: false, // Allow cross-origin media assets
  frameguard: { action: "deny" }, // X-Frame-Options: DENY
  // AIDV-312: 明確 HSTS（1 年 + includeSubDomains + preload），取代 helmet 預設 180 天
  strictTransportSecurity: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  // AIDV-312: 明確 Referrer-Policy（helmet 預設為 no-referrer）
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
};

/**
 * Permissions-Policy middleware — helmet 之後套用，補上 helmet 不設的標頭。
 */
export const permissionsPolicyMiddleware: RequestHandler = (_req, res, next) => {
  res.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
  next();
};

/**
 * 一次套用所有安全標頭中介層到 Express app（index.ts 與測試共用）。
 * 注意：index.ts 仍直接呼叫 helmet(helmetOptions) 以保留管線靜態掃描的
 * `helmet(` 訊號（brainPipeline MIDDLEWARE_STACK 測試），故此函式主要供
 * 測試與未來重用；兩條路徑都吃同一份 helmetOptions，行為一致。
 */
export function applySecurityHeaders(app: Express): void {
  app.use(helmet(helmetOptions));
  app.use(permissionsPolicyMiddleware);
}
