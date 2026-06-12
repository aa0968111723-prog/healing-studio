import type { AIAdapter, AdapterProxyRequest } from "../types";
import {
  resolveProviderBaseUrl,
  providerGatewayHeaders,
} from "../../../_core/providerFacade";

export class GeminiAdapter implements AIAdapter {
  readonly provider = "gemini";

  async proxy(req: AdapterProxyRequest): Promise<Response> {
    const apiKey = process.env.GEMINI_API_KEY || "";
    if (!apiKey) throw new Error("GEMINI_API_KEY missing");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), req.timeoutMs ?? 120_000);
    try {
      const baseUrl = resolveProviderBaseUrl("gemini");
      return await fetch(`${baseUrl}/${req.pathWithQuery.replace(/^\/+/, "")}`, {
        method: req.method,
        headers: {
          ...req.headers,
          ...providerGatewayHeaders("gemini"),
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
