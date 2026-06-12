import type { AIAdapter, AdapterProxyRequest } from "../types";
import {
  resolveProviderBaseUrl,
  providerGatewayHeaders,
} from "../../../_core/providerFacade";

export class FalAdapter implements AIAdapter {
  readonly provider = "fal_ai";

  async proxy(req: AdapterProxyRequest): Promise<Response> {
    const apiKey = process.env.FAL_API_KEY || "";
    if (!apiKey) throw new Error("FAL_API_KEY missing");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), req.timeoutMs ?? 120_000);
    try {
      const baseUrl = resolveProviderBaseUrl("fal_ai");
      return await fetch(`${baseUrl}/${req.pathWithQuery.replace(/^\/+/, "")}`, {
        method: req.method,
        headers: {
          ...req.headers,
          ...providerGatewayHeaders("fal_ai"),
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
