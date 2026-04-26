/**
 * kling.adapter.ts — Kling AI 直連 Adapter
 *
 * 直接呼叫快手 Kling 官方 API（https://api.klingai.com），
 * 不經由 fal.ai 代理，使 Provider Health Check 與 Failover 對 Kling 生效。
 *
 * 認證方式：HMAC-SHA256 HS256 JWT
 *   - Header : { alg: "HS256", typ: "JWT" }
 *   - Payload: { iss: KLING_ACCESS_KEY_ID, exp: now+1800, nbf: now-5 }
 *   - Secret : KLING_ACCESS_KEY_SECRET
 *
 * 環境變數：
 *   KLING_ACCESS_KEY_ID      — Kling 控制台 Access Key ID
 *   KLING_ACCESS_KEY_SECRET  — Kling 控制台 Access Key Secret
 */

import { createHmac } from "crypto";
import type { AIAdapter, AdapterProxyRequest } from "../types";

// ─── JWT HS256 helper（不依賴外部 JWT 函式庫）─────────────────────────────────

function base64url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64url");
}

function buildKlingJwt(accessKeyId: string, accessKeySecret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iss: accessKeyId, exp: now + 1800, nbf: now - 5 })
  );
  const signingInput = `${header}.${payload}`;
  const sig = createHmac("sha256", accessKeySecret)
    .update(signingInput)
    .digest();
  return `${signingInput}.${base64url(sig)}`;
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

export class KlingAdapter implements AIAdapter {
  readonly provider = "kling";
  private readonly baseUrl = "https://api.klingai.com";

  async proxy(req: AdapterProxyRequest): Promise<Response> {
    const accessKeyId = process.env.KLING_ACCESS_KEY_ID ?? "";
    const accessKeySecret = process.env.KLING_ACCESS_KEY_SECRET ?? "";
    if (!accessKeyId || !accessKeySecret) {
      throw new Error(
        "KLING_ACCESS_KEY_ID 或 KLING_ACCESS_KEY_SECRET 未設定"
      );
    }

    const jwt = buildKlingJwt(accessKeyId, accessKeySecret);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      // Kling 影片生成耗時長，預設 5 分鐘
      req.timeoutMs ?? 300_000
    );
    try {
      return await fetch(
        `${this.baseUrl}/${req.pathWithQuery.replace(/^\/+/, "")}`,
        {
          method: req.method,
          headers: {
            ...req.headers,
            Authorization: `Bearer ${jwt}`,
            "Content-Type": "application/json",
          },
          body: req.body,
          signal: controller.signal,
        }
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
