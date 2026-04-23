import type { AIAdapter, AdapterProxyRequest } from "../types";

export class GeminiAdapter implements AIAdapter {
  readonly provider = "gemini";
  private readonly baseUrl = "https://generativelanguage.googleapis.com";

  async proxy(req: AdapterProxyRequest): Promise<Response> {
    const apiKey = process.env.GEMINI_API_KEY || "";
    if (!apiKey) throw new Error("GEMINI_API_KEY missing");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), req.timeoutMs ?? 120_000);
    try {
      return await fetch(`${this.baseUrl}/${req.pathWithQuery.replace(/^\/+/, "")}`, {
        method: req.method,
        headers: {
          ...req.headers,
          "x-goog-api-key": apiKey,
        },
        body: req.body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
