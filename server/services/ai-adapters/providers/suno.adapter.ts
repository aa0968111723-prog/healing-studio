import type { AIAdapter, AdapterProxyRequest } from "../types";

export class SunoAdapter implements AIAdapter {
  readonly provider = "suno";
  private readonly baseUrl = "https://api.sunoapi.org";

  async proxy(req: AdapterProxyRequest): Promise<Response> {
    const apiKey = process.env.SUNO_API_KEY || "";
    if (!apiKey) throw new Error("SUNO_API_KEY missing");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), req.timeoutMs ?? 120_000);
    try {
      return await fetch(`${this.baseUrl}/${req.pathWithQuery.replace(/^\/+/, "")}`, {
        method: req.method,
        headers: {
          ...req.headers,
          Authorization: `Bearer ${apiKey}`,
        },
        body: req.body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
