// ============================================================================
// adapters/contextPacket.trpc.ts — ContextPacketAdapter（真實 tRPC 版，預設）
// ----------------------------------------------------------------------------
// 🔧 GitNexus 校正（§D.2，main HEAD 2888a36）：
//   compile  → contextPacket.compileProject（原 contextPacket.compile 不存在）  🔧
//   getLatest→ contextPacket.getLatest                                          🔧
//   research → orbProxy.unifiedSearch（原 sense.research 不存在；sense 僅 inferIntent）🔧
//
// research 放在本接縫，因 CONTEXT_PACKET_MODE 同時治理 RAG/grounding 來源
//（mock → rag-pinecone → rag-pgvector）。降級鏈（Sonar→Brave-only→無 grounding 橫幅）
//  於 P6 接 Sonar 時補上。
//
// tRPC 邊界以 `client as any` 寬鬆化；介面強型別。
// ============================================================================
import type { AdapterDeps, ContextPacketAdapter } from "./types";
import { AdapterError } from "./types";
import type { ContextPacket as ContextPacketData, ResearchResult, ResearchSource } from "@/spine/types";
import { getTrpcClient } from "./trpcClient";

function toPacket(r: any): ContextPacketData {
  return {
    summaryMarkdown: String(r?.summaryMarkdown ?? r?.summary ?? ""),
    sourceRefs: (r?.sourceRefs ?? []).map((s: any) => ({
      ref: String(s.ref ?? s.id ?? ""), kind: String(s.kind ?? ""), fresh: Boolean(s.fresh ?? true),
    })),
    tokenEstimate: Number(r?.tokenEstimate ?? r?.tokens ?? 0),
    ttlSec: Number(r?.ttlSec ?? 0),
    permissions: String(r?.permissions ?? "擁有者可讀寫"),
  };
}

export function makeContextPacketTrpc(_deps: AdapterDeps): ContextPacketAdapter {
  const client = getTrpcClient() as unknown as any;

  async function compile(projectId: number): Promise<ContextPacketData> {
    try {
      // 🔧 contextPacket.compileProject — 重壓專案 Context Packet（Deterministic→Cache→RAG）
      const r = await client.contextPacket.compileProject.mutate({ projectId });
      return toPacket(r);
    } catch (err) {
      throw new AdapterError("compile failed", { seam: "contextPacket", procedure: "contextPacket.compileProject", cause: err });
    }
  }

  async function getLatest(projectId: number): Promise<ContextPacketData | null> {
    try {
      const r = await client.contextPacket.getLatest.query({ projectId });
      return r ? toPacket(r) : null;
    } catch (err) {
      throw new AdapterError("getLatest failed", { seam: "contextPacket", procedure: "contextPacket.getLatest", cause: err });
    }
  }

  async function research(
    query: string,
    onEvent: (e: { type: string; [k: string]: unknown }) => void = () => {},
  ): Promise<ResearchResult> {
    try {
      onEvent({ type: "start", query });
      // 🔧 orbProxy.unifiedSearch — 研究/grounding 統一入口（Sonar+Brave；後端服務已存在）
      const r = await client.orbProxy.unifiedSearch.mutate({ query });
      const sources: ResearchSource[] = (r?.sources ?? r?.citations ?? []).map((s: any) => ({
        title: String(s.title ?? s.name ?? ""), url: String(s.url ?? ""), snip: String(s.snippet ?? s.snip ?? ""),
      }));
      onEvent({ type: "done", sources: sources.length });
      return {
        query,
        answer: String(r?.answer ?? r?.text ?? ""),
        sources,
        tokens: Number(r?.tokens ?? 0),
        costUsd: Number(r?.costUsd ?? 0),
        model: String(r?.model ?? "sonar"),
      };
    } catch (err) {
      throw new AdapterError("research failed", { seam: "contextPacket", procedure: "orbProxy.unifiedSearch", cause: err });
    }
  }

  return { compile, getLatest, research };
}
