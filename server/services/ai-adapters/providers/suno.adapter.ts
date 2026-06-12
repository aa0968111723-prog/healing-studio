import type { AIAdapter, AdapterProxyRequest } from "../types";
import {
  resolveProviderBaseUrl,
  providerGatewayHeaders,
} from "../../../_core/providerFacade";

export class SunoAdapter implements AIAdapter {
  readonly provider = "suno";

  async proxy(req: AdapterProxyRequest): Promise<Response> {
    const apiKey = process.env.SUNO_API_KEY || "";
    if (!apiKey) throw new Error("SUNO_API_KEY missing");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), req.timeoutMs ?? 120_000);
    try {
      const baseUrl = resolveProviderBaseUrl("suno");
      return await fetch(`${baseUrl}/${req.pathWithQuery.replace(/^\/+/, "")}`, {
        method: req.method,
        headers: {
          ...req.headers,
          ...providerGatewayHeaders("suno"),
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
