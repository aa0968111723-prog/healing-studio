import {
  trpc,
  isHeavyProcedurePath,
  shouldRetryQuery,
  computeRetryDelay,
} from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from "@shared/const";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, httpLink, splitLink, TRPCClientError } from "@trpc/client";
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
      // 智慧重試：4xx 不重試（同樣 input 會同樣失敗，重試只是浪費），
      // 5xx / 網路錯誤最多 2 次。前一次只有 1 次的設定無法吸收 Railway
      // 冷啟動或瞬間斷線，剛好觸發「有時連不上」的體感。
      retry: shouldRetryQuery,
      // 指數退避 + ±25% jitter，避免並發重試在同一毫秒撞上後端。
      retryDelay: computeRetryDelay,
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

  const apiBaseUrl = clientEnv.VITE_API_BASE_URL.trim();
  const baseOrigin = apiBaseUrl || window.location.origin;
  const normalizedBase = baseOrigin.endsWith("/")
    ? baseOrigin
    : `${baseOrigin}/`;

  const resolved = raw.startsWith("http://") || raw.startsWith("https://")
    ? raw
    : new URL(raw, normalizedBase).toString();

  if (!/^https?:\/\//i.test(resolved)) {
    throw new Error(`[fetch] Invalid URL (missing protocol): ${resolved}`);
  }
  return resolved;
}

// ─── Fetch with timeout + caller signal forwarding ────────────────────────
// Without an explicit timeout, a hung backend (Railway cold start, network
// blip, slow LLM call) leaves the request waiting on the browser's default
// (~5 minutes). Combined with the previous `retry: 1` policy, that one slow
// request consumed the only retry attempt and surfaced as "API doesn't
// connect". We compose the timeout abort with React Query's caller signal
// so unmount cancellation still works — losing that would defeat the whole
// React Query lifecycle model.
//
// When OUR timeout fires (not the caller's), we surface a localized "請求
// 超時" message instead of the browser's generic `TypeError: Failed to
// fetch` — that string leaked into the導演 AI toast and looked like a
// random network failure when it was actually our own ceiling firing.
function fetchWithTimeout(timeoutMs: number) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const finalUrl = resolveClientFetchUrl(input);
    const controller = new AbortController();
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const callerSignal = init?.signal;
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort();
      else callerSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    try {
      return await globalThis.fetch(finalUrl, {
        ...(init ?? {}),
        credentials: "include",
        signal: controller.signal,
      });
    } catch (err) {
      if (timedOut) {
        throw new Error(
          `請求超時（${Math.round(timeoutMs / 1000)} 秒）— AI 思考時間較長，請稍後再試或縮短輸入內容。`
        );
      }
      throw err;
    } finally {
      clearTimeout(timeoutHandle);
    }
  };
}

// LLM / generation procedures get their own httpLink (no batching, longer
// timeout). Batch poisoning was the dominant cause of "API doesn't connect"
// — a single slow `ai.chat` queued in the same 10ms window as a snappy
// `auth.me` made the whole batch wait, then both fail together. With
// splitLink, each heavy call gets its own HTTP request and can take its
// time without affecting any other procedure.
const trpcClient = trpc.createClient({
  links: [
    splitLink({
      condition: op => isHeavyProcedurePath(op.path),
      // Heavy: own request, 180s ceiling.
      //
      // Why 180s (was 90s): the導演 AI `chat` mutation runs a sequential
      // dual-engine pipeline — Step 1 research (Perplexity Sonar 或 fallback
      // brainConfig, server-side `withTimeout(90s)`) then Step 2 CO-STAR
      // creation (`withTimeout(45s)`). Server worst-case ≈135s. Anything
      // less than that on the client guarantees the fetch aborts while the
      // server is still working, surfaces as `TypeError: Failed to fetch`,
      // and the user sees a generic browser error toast. 180s gives ~45s
      // of headroom over the server failsafe so the actual upstream error
      // (5xx, parse failure, etc.) gets through to the toast instead of
      // being masked by our own abort.
      //
      // Other heavy paths (ai.*, generate.*, evaluate.*, …) are single LLM
      // calls and finish in 10-60s — they still benefit from the extra
      // headroom on cold-start Railway boots and slower thinking models.
      true: httpLink({
        url: resolveClientFetchUrl("/api/trpc"),
        transformer: superjson,
        fetch: fetchWithTimeout(180_000),
        headers: { "x-trpc-source": "web" }, // AIDV-219: CSRF guard
      }),
      // Light: batched, 30s ceiling (auth, profile, page data — anything
      // beyond 30s on these is a backend problem worth surfacing).
      false: httpBatchLink({
        url: resolveClientFetchUrl("/api/trpc"),
        transformer: superjson,
        fetch: fetchWithTimeout(30_000),
        headers: { "x-trpc-source": "web" }, // AIDV-219: CSRF guard
      }),
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
