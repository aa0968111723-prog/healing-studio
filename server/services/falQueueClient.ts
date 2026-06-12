/**
 * Shared low-level fal.ai queue helpers used by imageStudio / videoStudio /
 * proStudio routers. The studios used to inline-duplicate falQueueStatus and
 * falQueueResult, which let a real bug live in three places: when fal accepts
 * a submit at e.g. `fal-ai/imagen4/preview` but routes the queue tracking to
 * `fal-ai/imagen4/...`, the constructed status URL 405s and the user's
 * generation appears to fail forever even though it actually completed.
 *
 * `falQueueFetchWithPrefixFallback` first tries the canonical URL and, on
 * 404/405, retries by progressively stripping each `/segment` of modelId
 * until either a 2xx response or only `fal-ai/<provider>` is left. This
 * recovers all known fal routing quirks (single-segment suffixes like
 * `/preview` and multi-segment ones like `/v2.1/standard/text-to-video`)
 * without making us thread fal's status_url through the entire job-storage
 * layer.
 */

// 統一供應商門面的單一來源（fal 無 CF Gateway slug，永遠直連）。
import { FAL_QUEUE_BASE } from "../_core/providerFacade";

export async function falQueueFetchWithPrefixFallback(
  modelId: string,
  requestId: string,
  suffix: "" | "/status" | "/cancel",
  apiKey: string
): Promise<Response> {
  // Cap retries at 4 so we don't hammer fal forever on a real outage.
  const headers = { Authorization: `Key ${apiKey}` };
  let candidate = modelId;
  let firstResponse: Response | null = null;
  for (let i = 0; i < 4; i += 1) {
    const url = `${FAL_QUEUE_BASE}/${candidate}/requests/${requestId}${suffix}`;
    const res = await fetch(url, { headers });
    if (firstResponse === null) firstResponse = res;
    if (res.ok) return res;
    if (res.status !== 404 && res.status !== 405) return res;
    // Strip the last `/segment`. Stop once we'd descend below
    // `fal-ai/<provider>` (e.g. `fal-ai/kling-video`).
    const lastSlash = candidate.lastIndexOf("/");
    if (lastSlash <= "fal-ai/".length) break;
    candidate = candidate.slice(0, lastSlash);
  }
  // Exhausted candidates — return the original failed response so callers
  // observe the 404/405 they would have seen without the fallback.
  return firstResponse!;
}

