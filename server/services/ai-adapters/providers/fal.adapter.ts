import type { AIAdapter, AdapterProxyRequest } from "../types";

export class FalAdapter implements AIAdapter {
  readonly provider = "fal_ai";
  private readonly baseUrl = "https://fal.run";

  async proxy(req: AdapterProxyRequest): Promise<Response> {
    const apiKey = process.env.FAL_API_KEY || "";
    if (!apiKey) throw new Error("FAL_API_KEY missing");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), req.timeoutMs ?? 120_000);
    try {
      return await fetch(`${this.baseUrl}/${req.pathWithQuery.replace(/^\/+/, "")}`, {
        method: req.method,
        headers: {
          ...req.headers,
          Authorization: `Key ${apiKey}`,
        },
        body: req.body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
