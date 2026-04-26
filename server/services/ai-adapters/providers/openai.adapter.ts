/**
 * openai.adapter.ts — OpenAI 直連 Adapter
 *
 * 直接呼叫 OpenAI API（https://api.openai.com/v1），
 * 覆蓋 GPT 系列、Whisper ASR、DALL-E 圖片生成等端點，
 * 使 Provider Health Check 對 OpenAI 生效。
 *
 * 認證方式：Bearer token + 可選 Organization ID
 *   Authorization: Bearer <OPENAI_API_KEY>
 *   OpenAI-Organization: <OPENAI_ORG_ID>  （若設定則注入）
 *
 * 環境變數：
 *   OPENAI_API_KEY  — OpenAI 帳號 API Key（必要）
 *   OPENAI_ORG_ID   — OpenAI Organization ID（可選）
 *
 * 主要端點（路徑由呼叫端傳入）：
 *   POST /chat/completions         — GPT-4o / GPT-4 Turbo
 *   POST /audio/transcriptions     — Whisper ASR
 *   POST /audio/speech             — TTS
 *   POST /images/generations       — DALL-E 3
 *   POST /images/edits             — DALL-E 圖片編輯
 */

import type { AIAdapter, AdapterProxyRequest } from "../types";

export class OpenAIAdapter implements AIAdapter {
  readonly provider = "openai";
  private readonly baseUrl = "https://api.openai.com/v1";

  async proxy(req: AdapterProxyRequest): Promise<Response> {
    const apiKey = process.env.OPENAI_API_KEY ?? "";
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY 未設定");
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      req.timeoutMs ?? 120_000
    );

    const headers: Record<string, string> = {
      ...req.headers,
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    const orgId = process.env.OPENAI_ORG_ID;
    if (orgId) headers["OpenAI-Organization"] = orgId;

    try {
      return await fetch(
        `${this.baseUrl}/${req.pathWithQuery.replace(/^\/+/, "")}`,
        {
          method: req.method,
          headers,
          body: req.body,
          signal: controller.signal,
        }
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
