import type { AIAdapter, AdapterProxyRequest } from "../types";
import {
  resolveProviderBaseUrl,
  providerGatewayHeaders,
} from "../../../_core/providerFacade";

export class ElevenLabsAdapter implements AIAdapter {
  readonly provider = "elevenlabs";

  async proxy(req: AdapterProxyRequest): Promise<Response> {
    const apiKey = process.env.ELEVENLABS_API_KEY || "";
    if (!apiKey) throw new Error("ELEVENLABS_API_KEY missing");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), req.timeoutMs ?? 120_000);
    try {
      const baseUrl = resolveProviderBaseUrl("elevenlabs");
      return await fetch(`${baseUrl}/${req.pathWithQuery.replace(/^\/+/, "")}`, {
        method: req.method,
        headers: {
          ...req.headers,
          ...providerGatewayHeaders("elevenlabs"),
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
