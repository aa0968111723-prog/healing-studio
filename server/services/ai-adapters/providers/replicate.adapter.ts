/**
 * replicate.adapter.ts — Replicate 直連 Adapter
 *
 * 直接呼叫 Replicate API（https://api.replicate.com/v1），
 * 統一 replicateClient.ts 的底層 HTTP 層到 adapter 架構，
 * 使 Provider Health Check 對 Replicate 生效。
 *
 * 認證方式：Bearer token
 *   Authorization: Bearer <REPLICATE_API_TOKEN>
 *
 * 環境變數：
 *   REPLICATE_API_TOKEN — Replicate 帳號 API Token
 *
 * 主要端點（路徑由呼叫端傳入）：
 *   POST /models/{owner}/{name}/predictions   — 建立預測任務
 *   POST /deployments/{owner}/{name}/predictions
 *   GET  /predictions/{id}                    — 輪詢狀態
 *   POST /predictions                         — 直接呼叫最新版本
 */

import type { AIAdapter, AdapterProxyRequest } from "../types";

export class ReplicateAdapter implements AIAdapter {
  readonly provider = "replicate";
  private readonly baseUrl = "https://api.replicate.com/v1";

  async proxy(req: AdapterProxyRequest): Promise<Response> {
    const apiToken = process.env.REPLICATE_API_TOKEN ?? "";
    if (!apiToken) {
      throw new Error("REPLICATE_API_TOKEN 未設定");
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      req.timeoutMs ?? 120_000
    );
    try {
      return await fetch(
        `${this.baseUrl}/${req.pathWithQuery.replace(/^\/+/, "")}`,
        {
          method: req.method,
          headers: {
            ...req.headers,
            Authorization: `Bearer ${apiToken}`,
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
