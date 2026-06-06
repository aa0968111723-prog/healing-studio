// ============================================================================
// adapters/index.ts — 五接縫的單一組裝點（composition root）
// ----------------------------------------------------------------------------
// 【P0 預設：全部走真實 tRPC】因為「P0 保留既有後端」——既有頁面本來就打這些 tRPC
// procedure，adapter 預設 trpc = 呼叫同一批後端 = 零行為改變。mock 僅供模擬/離線。
//
// 每條接縫可獨立用 env 旗標覆寫成 mock（整合指南 §5.2）。預設值皆為 "trpc"：
//   VITE_DATA_STORE          = trpc | mock     （預設 trpc）
//   VITE_GENERATION_PROVIDER = trpc | mock     （預設 trpc；真實底層 provider 切換在 generation 內）
//   VITE_COMMANDER_ADAPTER   = trpc | mock     （預設 trpc；fallback/sonar/subq 為 P6 細分）
//   VITE_CONTEXT_PACKET_MODE = trpc | mock     （預設 trpc）
//   VITE_STORAGE_PROVIDER    = trpc | mock     （預設 trpc）
//
// 【P0 零風險】composition root 只在被呼叫（createAdapters()）時組裝；P0 沒有 UI 路徑
// 會呼叫任何 adapter 方法（shell 只把既有頁面 re-home）。故即使預設 trpc，也不會在 P0
// 產生任何新的網路請求 — adapters 是給 P1+ shell 接線用的休眠基礎設施。
// ============================================================================
import type { Adapters, AdapterDeps } from "./types";
import { makeDataStoreTrpc } from "./dataStore.trpc";
import { makeGenerationTrpc } from "./generation.trpc";
import { makeCommanderTrpc } from "./commander.trpc";
import { makeContextPacketTrpc } from "./contextPacket.trpc";
import { makeStorageTrpc } from "./storage.trpc";
import {
  makeDataStoreMock, makeGenerationMock, makeCommanderMock, makeContextPacketMock, makeStorageMock,
} from "./mocks";

export type { Adapters, AdapterDeps } from "./types";

function mode(key: string): "trpc" | "mock" {
  try {
    const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
    const v = env?.[key];
    if (typeof v === "string" && v.trim().toLowerCase() === "mock") return "mock";
  } catch { /* import.meta 不可用 → 預設 trpc */ }
  return "trpc";
}

export function createAdapters(deps: AdapterDeps): Adapters {
  const m = {
    dataStore: mode("VITE_DATA_STORE"),
    generation: mode("VITE_GENERATION_PROVIDER"),
    commander: mode("VITE_COMMANDER_ADAPTER"),
    contextPacket: mode("VITE_CONTEXT_PACKET_MODE"),
    storage: mode("VITE_STORAGE_PROVIDER"),
  } as const;

  return {
    dataStore: m.dataStore === "mock" ? makeDataStoreMock(deps) : makeDataStoreTrpc(deps),
    generation: m.generation === "mock" ? makeGenerationMock(deps) : makeGenerationTrpc(deps),
    commander: m.commander === "mock" ? makeCommanderMock(deps) : makeCommanderTrpc(deps),
    contextPacket: m.contextPacket === "mock" ? makeContextPacketMock(deps) : makeContextPacketTrpc(deps),
    storage: m.storage === "mock" ? makeStorageMock(deps) : makeStorageTrpc(deps),
    meta: { ...m },
  };
}
