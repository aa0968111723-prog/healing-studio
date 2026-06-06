// ============================================================================
// adapters/trpcClient.ts — 給 adapter 用的 vanilla tRPC client（命令式呼叫）
// ----------------------------------------------------------------------------
// repo 既有的 `@/lib/trpc` 是 createTRPCReact<AppRouter>()（React Query hooks），
// 只能在元件內用。adapter 是純函式、需在元件外命令式呼叫 procedure，故另建一個
// vanilla client（createTRPCClient<AppRouter>），慣例對齊 main.tsx：
//   - superjson transformer
//   - splitLink：heavy procedure（isHeavyProcedurePath）走 httpLink（不批次、長 timeout），
//     其餘走 httpBatchLink（30s）
//   - credentials: "include"（cookie 認證，與 main.tsx 一致）
//
// 【P0 零風險保證】本 client 以 lazy singleton 建立，且 P0 沒有任何 UI 路徑會呼叫
// adapter（shell 只是把既有頁面 re-home，不經 adapter）。因此本檔在 P0 為「休眠基礎
// 設施」：被 import 時只是定義函式，建立 client 不發任何網路請求；真正被呼叫是 P1+。
// ============================================================================
import { createTRPCClient, httpBatchLink, httpLink, splitLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../../../server/routers";
import { isHeavyProcedurePath } from "@/lib/trpc";

const TRPC_URL = "/api/trpc";

/** 與 main.tsx 一致：所有請求帶 cookie（伺服器以 cookie 認證）。 */
const fetchWithCredentials: typeof fetch = (input, init) =>
  globalThis.fetch(input as RequestInfo | URL, { ...(init ?? {}), credentials: "include" });

let _client: ReturnType<typeof createTRPCClient<AppRouter>> | null = null;

/** Lazy singleton：第一次被呼叫時才建立 client（import 時不建立、不連線）。 */
export function getTrpcClient(): ReturnType<typeof createTRPCClient<AppRouter>> {
  if (_client) return _client;
  _client = createTRPCClient<AppRouter>({
    links: [
      splitLink({
        condition: (op) => isHeavyProcedurePath(op.path),
        // Heavy（ai./generate./director./models. …）：獨立請求、不批次。
        true: httpLink({ url: TRPC_URL, transformer: superjson, fetch: fetchWithCredentials }),
        // Light（auth/profile/page data）：批次。
        false: httpBatchLink({ url: TRPC_URL, transformer: superjson, fetch: fetchWithCredentials }),
      }),
    ],
  });
  return _client;
}

/** 型別別名，供各 *.trpc.ts 使用。 */
export type TrpcClient = ReturnType<typeof createTRPCClient<AppRouter>>;
