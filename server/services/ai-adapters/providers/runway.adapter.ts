/**
 * runway.adapter.ts — Runway Gen-3/Gen-4 直連 Adapter
 *
 * 直接呼叫 Runway 官方 API（https://api.dev.runwayml.com/v1），
 * 不經由 fal.ai 代理，使 Provider Health Check 與 Failover 對 Runway 生效。
 *
 * 認證方式：Bearer token
 *   Authorization: Bearer <RUNWAY_API_SECRET>
 *   X-Runway-Version: 2024-11-06
 *
 * 環境變數：
 *   RUNWAY_API_SECRET — Runway 控制台 API Secret
 *
 * 主要端點（路徑由呼叫端傳入）：
 *   POST /image_to_video   — Gen-3 Alpha Turbo / Gen-4 圖生影
 *   GET  /tasks/{id}       — 輪詢任務狀態
 *   POST /text_to_image    — 圖片生成
 */

import type { AIAdapter, AdapterProxyRequest } from "../types";

export class RunwayAdapter implements AIAdapter {
  readonly provider = "runway";
  private readonly baseUrl = "https://api.dev.runwayml.com/v1";

  async proxy(req: AdapterProxyRequest): Promise<Response> {
    const apiSecret = process.env.RUNWAY_API_SECRET ?? "";
    if (!apiSecret) {
      throw new Error("RUNWAY_API_SECRET 未設定");
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      // Runway 影片生成耗時長，預設 5 分鐘
      req.timeoutMs ?? 300_000
    );
    try {
      return await fetch(
        `${this.baseUrl}/${req.pathWithQuery.replace(/^\/+/, "")}`,
        {
          method: req.method,
          headers: {
            ...req.headers,
            Authorization: `Bearer ${apiSecret}`,
            "X-Runway-Version": "2024-11-06",
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
