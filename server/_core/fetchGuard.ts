type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

let isFetchGuardInstalled = false;

function hasHttpProtocol(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function ensureAbsoluteUrl(url: string): string {
  if (hasHttpProtocol(url)) return url;
  if (url.startsWith("/")) {
    console.error(`[fetch] Invalid URL (relative path on server): ${url}`);
    throw new TypeError(
      `[fetch] Invalid URL: "${url}". Server-side fetch requires http:// or https://`
    );
  }

  const inferredProtocol =
    url.startsWith("localhost") || url.startsWith("127.0.0.1")
      ? "http://"
      : "https://";
  const normalized = `${inferredProtocol}${url.replace(/^\/+/, "")}`;
  console.warn(
    `[fetch] URL missing protocol, auto-normalized to: ${normalized}`
  );
  return normalized;
}

function resolveFetchUrl(input: FetchInput): string {
  if (typeof input === "string") return ensureAbsoluteUrl(input);
  if (input instanceof URL) return ensureAbsoluteUrl(input.toString());
  return ensureAbsoluteUrl(input.url);
}

export function installFetchGuard(): void {
  if (isFetchGuardInstalled) return;
  isFetchGuardInstalled = true;

  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = (async (input: FetchInput, init?: FetchInit) => {
    const finalUrl = resolveFetchUrl(input);
    console.log(`[fetch] Request URL: ${finalUrl}`);

    if (input instanceof Request) {
      const normalizedRequest =
        input.url === finalUrl ? input : new Request(finalUrl, input);
      return originalFetch(normalizedRequest, init);
    }

    return originalFetch(finalUrl, init);
  }) as typeof fetch;
}
