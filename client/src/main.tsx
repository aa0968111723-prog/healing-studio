import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from "@shared/const";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { AIStateProvider } from "@/contexts/AIStateContext";
import { emitAuthExpiredDebounced } from "@/components/AuthExpiredModal";
import { clientEnv } from "@/lib/env.validated";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 30 秒內不重複請求，減少不必要的 API 呼叫
      staleTime: 30_000,
      // 視窗切換時不自動 refetch（Studio 等重型頁面需要穩定狀態）
      refetchOnWindowFocus: false,
      // 網路恢復時自動 refetch（保留此行為，確保離線後數據更新）
      refetchOnReconnect: true,
      // 失敗時最多重試 1 次（避免過多無效請求）
      retry: 1,
      retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 10_000),
    },
    mutations: {
      // mutation 失敗不自動重試
      retry: 0,
    },
  },
});

// ─── Unified Auth Interceptor ──────────────────────────────────────────────
// Instead of hard-redirecting to login page (which loses user's work-in-progress),
// we emit a debounced event that triggers a friendly AuthExpiredModal.
// The modal preserves the current page state and lets the user choose when to login.

const handleUnauthorizedError = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized =
    error.message === UNAUTHED_ERR_MSG ||
    error.data?.code === "UNAUTHORIZED" ||
    error.data?.httpStatus === 401;

  if (!isUnauthorized) return;

  // Emit debounced event → AuthExpiredModal picks it up
  emitAuthExpiredDebounced();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    handleUnauthorizedError(error);
    // Only log non-auth errors to console to reduce noise
    if (
      !(error instanceof TRPCClientError) ||
      error.message !== UNAUTHED_ERR_MSG
    ) {
      console.error("[API Query Error]", error);
    }
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    handleUnauthorizedError(error);
    if (
      !(error instanceof TRPCClientError) ||
      error.message !== UNAUTHED_ERR_MSG
    ) {
      console.error("[API Mutation Error]", error);
    }
  }
});


const injectUmamiAnalytics = () => {
  if (typeof document === "undefined") return;

  const endpoint = clientEnv.VITE_ANALYTICS_ENDPOINT.trim();
  const websiteId = clientEnv.VITE_ANALYTICS_WEBSITE_ID.trim();

  if (!endpoint || !websiteId) return;

  if (document.querySelector("script[data-umami-loaded='true']")) return;

  const script = document.createElement("script");
  script.defer = true;
  script.src = `${endpoint.replace(/\/$/, "")}/umami`;
  script.setAttribute("data-website-id", websiteId);
  script.setAttribute("data-umami-loaded", "true");
  document.head.appendChild(script);
};

injectUmamiAnalytics();

function resolveClientFetchUrl(input: RequestInfo | URL): string {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

  const resolved = raw.startsWith("http://") || raw.startsWith("https://")
    ? raw
    : new URL(raw, window.location.origin).toString();

  if (!/^https?:\/\//i.test(resolved)) {
    throw new Error(`[fetch] Invalid URL (missing protocol): ${resolved}`);
  }
  return resolved;
}

function installClientFetchGuard(): void {
  const globalKey = "__HEALING_STUDIO_FETCH_GUARD_INSTALLED__";
  if ((window as any)[globalKey]) return;
  (window as any)[globalKey] = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const finalUrl = resolveClientFetchUrl(input);
    console.log("[fetch] Request URL:", finalUrl);

    if (input instanceof Request) {
      const normalizedRequest =
        input.url === finalUrl ? input : new Request(finalUrl, input);
      return originalFetch(normalizedRequest, init);
    }

    return originalFetch(finalUrl, init);
  }) as typeof fetch;
}

installClientFetchGuard();

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <AIStateProvider>
        <App />
      </AIStateProvider>
    </QueryClientProvider>
  </trpc.Provider>
);
