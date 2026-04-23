import type { AIAdapter, AdapterProxyRequest } from "../types";

export class ElevenLabsAdapter implements AIAdapter {
  readonly provider = "elevenlabs";
  private readonly baseUrl = "https://api.elevenlabs.io";

  async proxy(req: AdapterProxyRequest): Promise<Response> {
    const apiKey = process.env.ELEVENLABS_API_KEY || "";
    if (!apiKey) throw new Error("ELEVENLABS_API_KEY missing");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), req.timeoutMs ?? 120_000);
    try {
      return await fetch(`${this.baseUrl}/${req.pathWithQuery.replace(/^\/+/, "")}`, {
        method: req.method,
        headers: {
          ...req.headers,
          "xi-api-key": apiKey,
        },
        body: req.body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
