// ============================================================================
// adapters/research.ts — Research 接縫（第 6 條；Perplexity / Sonar + Brave）
// ----------------------------------------------------------------------------
// 【為什麼是獨立接縫】P0 已把 grounding/研究塞在 ContextPacket 接縫的 research()
//   （CONTEXT_PACKET_MODE 同時治理 RAG/grounding）。但 P6 的 /learn 研究面板是一個
//   面向使用者的「研究代理」功能，需要自己的 loading / 引用 / 降級（Sonar→Brave-only→
//   無 grounding 橫幅）UI 狀態，且依開發計畫 §P6「未到位前用 mock/Fallback、到位只換
//   一行」。故抽成一條**獨立、mock-default** 的接縫，與 P0 五接縫並列、互不影響。
//
// 【mock-default（與 P0 五接縫相反）】P0 五接縫預設 trpc（保留既有後端＝零行為改變）。
//   研究接縫**預設 mock**：開發計畫 §3.4 明定 Perplexity 直連已淘汰、Sonar 需金鑰，未
//   到位前一律走罐頭引用；故預設 mock 才是「零金鑰即可 demo」的正確預設。要接真實：
//   設 VITE_RESEARCH_PROVIDER=trpc → 走 orbProxy.unifiedSearch（後端服務已存在）。
//
//   VITE_RESEARCH_PROVIDER = mock | trpc      （預設 mock）
//
// 真實接點（GitNexus 校正，main HEAD 2888a36）：
//   run(query) → orbProxy.unifiedSearch（情報清單走 news.list；sense 僅 inferIntent）🔧
//
// 介面與 mock/trpc 兩版完全相同 → 切換「UI 一行不改」。本檔零副作用：被 import 時只
// 定義工廠函式，建立 client 不連線（沿用 P0 lazy trpcClient）。
// ============================================================================
import type { ResearchResult, ResearchSource } from "@/spine/types";

/** 研究進度事件（給研究面板顯示分段狀態 / 降級橫幅）。 */
export type ResearchEvent =
  | { type: "start"; query: string }
  | { type: "grounding"; provider: "sonar" | "brave" | "mock" }
  | { type: "degraded"; reason: string; mode: "brave-only" | "no-grounding" }
  | { type: "done"; sources: number }
  | { type: "error"; http?: number; msg: string };

export interface ResearchAdapter {
  /** 提交研究問題；回傳彙整答案 + 引用來源 + 用量。onEvent 可選（驅動 UI 分段狀態）。 */
  run(query: string, onEvent?: (e: ResearchEvent) => void): Promise<ResearchResult>;
}

/** 研究接縫專屬錯誤（保留 http 供面板顯示「上游 503 / 重試」）。 */
export class ResearchError extends Error {
  constructor(message: string, readonly meta: { http?: number; provider?: string; cause?: unknown }) {
    super(message);
    this.name = "ResearchError";
  }
}

/** demo 用的注入依賴：故障旗標（來自 SpineProvider.faults.research）。 */
export interface ResearchDeps {
  /** 回傳是否注入「研究上游故障」（/settings 故障注入面板）；預設永遠 false。 */
  getFault?: () => boolean;
}

// ── mock 實作（零金鑰；預設）──────────────────────────────────────────────────
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const CANNED_SOURCES: ResearchSource[] = [
  { title: "跨鏡角色一致性：seed 鎖定 + 參考圖轉繪（i2i）", url: "https://example.com/consistency", snip: "固定 seed 讓同一角色跨鏡保持五官/服裝；具名角色走參考圖 i2i，而非純文字生圖。" },
  { title: "LoRA 角色定版與鎖臉/定裝流程", url: "https://example.com/lora-lock", snip: "以 8–20 張定版圖訓練角色 LoRA，鎖臉/髮/裝/配件四鎖，來源分級 precise。" },
  { title: "Context Packet：長文件只進 RAG，不直送影像模型", url: "https://example.com/context-packet", snip: "成本階梯鐵則：Deterministic→Cache→RAG→便宜 LLM→Sonar→高級 LLM→媒體生成。" },
];

export function makeResearchMock(deps: ResearchDeps = {}): ResearchAdapter {
  return {
    async run(query: string, onEvent: (e: ResearchEvent) => void = () => {}): Promise<ResearchResult> {
      onEvent({ type: "start", query });
      await delay(180);
      // 故障注入：模擬 Sonar 上游 503（給 /settings 故障面板 demo「錯誤 / 重試」）。
      if (deps.getFault?.()) {
        onEvent({ type: "error", http: 503, msg: "Sonar 上游暫時無回應（HTTP 503）" });
        throw new ResearchError("research upstream 503 (mock fault)", { http: 503, provider: "mock-sonar" });
      }
      onEvent({ type: "grounding", provider: "mock" });
      await delay(420);
      onEvent({ type: "done", sources: CANNED_SOURCES.length });
      return {
        query,
        answer:
          `（mock 研究彙整）針對「${query}」：先用固定 seed 與具名角色參考圖（i2i）鎖住跨鏡一致性，` +
          `再以角色 LoRA 定版與四鎖（臉/髮/裝/配件）強化；長腳本只進 RAG / Context Packet，` +
          `永遠先估成本再確認生成。以上為罐頭範例，接 VITE_RESEARCH_PROVIDER=trpc 後改走 Sonar+Brave 真實查證。`,
        sources: CANNED_SOURCES,
        tokens: 820,
        costUsd: 0.004,
        model: "mock-sonar",
      };
    },
  };
}

// ── 真實 tRPC 實作（orbProxy.unifiedSearch；後端服務已存在）─────────────────────
export function makeResearchTrpc(deps: ResearchDeps = {}): ResearchAdapter {
  return {
    async run(query: string, onEvent: (e: ResearchEvent) => void = () => {}): Promise<ResearchResult> {
      onEvent({ type: "start", query });
      try {
        // lazy import P0 的 vanilla client（adapter 在元件外命令式呼叫）。
        const { getTrpcClient } = await import("./trpcClient");
        const client = getTrpcClient() as unknown as any;
        onEvent({ type: "grounding", provider: "sonar" });
        // 🔧 orbProxy.unifiedSearch — 研究/grounding 統一入口（Sonar + Brave）。
        const r = await client.orbProxy.unifiedSearch.mutate({ query });
        const sources: ResearchSource[] = (r?.sources ?? r?.citations ?? []).map((s: any) => ({
          title: String(s.title ?? s.name ?? ""),
          url: String(s.url ?? ""),
          snip: String(s.snippet ?? s.snip ?? ""),
        }));
        // 降級偵測：後端回報無 grounding / 僅 Brave 時，發降級事件給面板掛橫幅。
        if (r?.degraded || sources.length === 0) {
          onEvent({ type: "degraded", reason: String(r?.degradedReason ?? "無即時查證來源"), mode: sources.length === 0 ? "no-grounding" : "brave-only" });
        }
        onEvent({ type: "done", sources: sources.length });
        return {
          query,
          answer: String(r?.answer ?? r?.text ?? ""),
          sources,
          tokens: Number(r?.tokens ?? 0),
          costUsd: Number(r?.costUsd ?? 0),
          model: String(r?.model ?? "sonar"),
        };
      } catch (err: any) {
        const http = err?.data?.httpStatus ?? err?.shape?.data?.httpStatus;
        onEvent({ type: "error", http, msg: String(err?.message ?? "research failed") });
        throw new ResearchError("research failed", { http, provider: "orbProxy.unifiedSearch", cause: err });
      }
    },
  };
}

// ── composition root（預設 mock）──────────────────────────────────────────────
function researchMode(): "mock" | "trpc" {
  try {
    const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
    const v = env?.["VITE_RESEARCH_PROVIDER"];
    if (typeof v === "string" && v.trim().toLowerCase() === "trpc") return "trpc";
  } catch { /* import.meta 不可用 → 預設 mock */ }
  return "mock";
}

/** 依 VITE_RESEARCH_PROVIDER 建立研究 adapter（預設 mock）。 */
export function createResearchAdapter(deps: ResearchDeps = {}): { adapter: ResearchAdapter; mode: "mock" | "trpc" } {
  const mode = researchMode();
  return { adapter: mode === "trpc" ? makeResearchTrpc(deps) : makeResearchMock(deps), mode };
}
