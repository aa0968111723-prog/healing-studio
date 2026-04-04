import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { AIStateProvider } from "@/contexts/AIStateContext";
import { emitAuthExpiredDebounced } from "@/components/AuthExpiredModal";
import "./index.css";

const queryClient = new QueryClient();

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
