// ============================================================================
// adapters/mocks.ts — 五接縫的 mock 實作（零金鑰；給模擬/離線開發/測試用）
// ----------------------------------------------------------------------------
// 介面與 *.trpc.ts 完全相同，故切換 mock↔trpc「UI 一行不改」（只改 adapters/index.ts
// 的 env 旗標）。P0 預設全部走 trpc（見 index.ts）；mock 僅供 DATA_STORE=mock 等情境。
// 行為刻意簡單：canned 資料 + 模擬延遲 + 內建回退鏈，無任何真實網路/金鑰。
// ============================================================================
import type {
  AdapterDeps, Adapters,
  DataStoreAdapter, GenerationAdapter, CommanderAdapter, ContextPacketAdapter, StorageAdapter,
  PromptVaultAdapter, PromptVaultItem, PromptVaultPage, PromptLinkedAsset, PromptLinkedPrompt,
  GenRequest, GenResult, GenEvent, DirectorReplyInput, DirectorReply, CommanderPlan, ScriptBreakdown,
  RecordedAsset,
} from "./types";
import type {
  CreativeProject, CreativeProjectSummary, ModelEntry, NewsItem, Template,
  ContextPacket as ContextPacketData, ResearchResult, OrchestrationRun, ProviderId, GenKind,
} from "@/spine/types";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 9)}`;
const nowISO = () => new Date().toISOString();

const PROVIDER_COST: Record<ProviderId, number> = { hf: 0.012, gemini: 0.02, fal: 0.03, mock: 0 };

export function makeDataStoreMock(_deps: AdapterDeps): DataStoreAdapter {
  return {
    async listProjects(): Promise<CreativeProjectSummary[]> {
      await delay(120);
      return [{ id: "p_demo", name: "示範專案", emoji: "🎬", type: "影片", updatedAt: Date.now() }];
    },
    async getProject(): Promise<CreativeProject | null> { await delay(120); return null; },
    async getProjectSummary(): Promise<unknown | null> { await delay(80); return null; },
    async listModels(): Promise<ModelEntry[]> {
      await delay(80);
      return [{ id: "m_claude", name: "Claude", vendor: "Anthropic", kind: "llm", brainRole: "決策腦", status: "可用" }];
    },
    async listNews(): Promise<NewsItem[]> {
      await delay(80);
      return [{ id: uid("n"), title: "示範情報", source: "mock", ts: nowISO(), tag: "demo", url: "#" }];
    },
    async listTemplates(): Promise<Template[]> {
      await delay(80);
      return [{ id: uid("tpl"), name: "方形貼文", ratio: "1:1", palette: ["#1b2a4a", "#c8a96a"], kind: "social" }];
    },
  };
}

export function makeGenerationMock(deps: AdapterDeps): GenerationAdapter {
  return {
    async estimateCost(req: GenRequest) { await delay(60); return { costUsd: PROVIDER_COST[req.provider ?? deps.getProvider()] }; },
    async generate(req: GenRequest, onEvent: (e: GenEvent) => void = () => {}): Promise<GenResult> {
      const provider = req.provider ?? deps.getProvider();
      onEvent({ type: "attempt", provider, step: 0 });
      await delay(300);
      const res: GenResult = {
        ok: true, provider, seedUsed: req.seed, model: `mock-${req.kind}`,
        costUsd: PROVIDER_COST[provider], latencyMs: 300, jobId: uid("job"),
      };
      onEvent({ type: "success", provider, res, fellBack: false });
      return res;
    },
  };
}

export function makeCommanderMock(_deps: AdapterDeps): CommanderAdapter {
  return {
    async directorReply(input: DirectorReplyInput): Promise<DirectorReply> {
      await delay(200);
      return { role: "ai", persona: input.persona, text: `（mock 導演回覆）${input.message}`, agent: "director-mock" };
    },
    async createIntent(input): Promise<CommanderPlan> {
      await delay(200);
      return { runId: uid("run"), goal: input.intent, steps: [
        { tool: "contextPacket.compileProject", cost: 0, note: "Deterministic→Cache→RAG" },
        { tool: "generation.dispatch", cost: 0.03, note: "mock" },
      ], totalCost: 0.03 };
    },
    async getRun(): Promise<OrchestrationRun | null> { await delay(80); return null; },
    async listRuns(): Promise<OrchestrationRun[]> { await delay(80); return []; },
    async breakdownScript(): Promise<ScriptBreakdown> {
      await delay(250);
      return { acts: [{ title: "第一幕", shots: [{ title: "開場", route: "text", characters: [], scene: "空景" }] }], characters: [], scenes: ["空景"] };
    },
  };
}

export function makeContextPacketMock(_deps: AdapterDeps): ContextPacketAdapter {
  const packet = (): ContextPacketData => ({ summaryMarkdown: "（mock context packet）", sourceRefs: [], tokenEstimate: 1200, ttlSec: 600, permissions: "擁有者可讀寫" });
  return {
    async compile(): Promise<ContextPacketData> { await delay(120); return packet(); },
    async getLatest(): Promise<ContextPacketData | null> { await delay(60); return packet(); },
    async research(query: string): Promise<ResearchResult> {
      await delay(250);
      return { query, answer: `（mock 研究結果）${query}`, sources: [], tokens: 800, costUsd: 0.004, model: "mock-sonar" };
    },
  };
}

export function makeStorageMock(_deps: AdapterDeps): StorageAdapter {
  return {
    async recordGenResult(input): Promise<RecordedAsset> {
      await delay(60);
      return { id: uid("a"), kind: input.kind as GenKind, provider: input.provider, modelId: input.model, costUsd: input.costUsd, assetUrl: input.assetUrl };
    },
    async exportToAssets(): Promise<{ ok: boolean }> { await delay(60); return { ok: true }; },
  };
}

// ─── 6) PromptVault mock（W1-3 新增；離線種子，與 promptVault.trpc.ts 同介面）────

export function makePromptVaultMock(_deps: AdapterDeps): PromptVaultAdapter {
  const store: PromptVaultItem[] = [
    { id: 1, title: "禪修晨霧開場", content: "morning mist over a zen garden, soft golden light", category: "video", tags: ["禪修"], isFavorite: true, useCount: 7, modelHint: "kling-v2.1", updatedAt: Date.now() - 86400000 },
    { id: 2, title: "角色定裝特寫", content: "portrait of a tibetan monk, weathered face, warm light", category: "image", tags: ["角色"], isFavorite: false, useCount: 3, updatedAt: Date.now() - 3600000 },
  ];
  let nextId = 100;
  return {
    async listPrompts(input): Promise<PromptVaultPage> {
      await delay(100);
      let items = [...store];
      if (input?.category) items = items.filter(i => i.category === input.category);
      if (input?.favoritesOnly) items = items.filter(i => i.isFavorite);
      if (input?.search) items = items.filter(i => i.title.includes(input.search!));
      const pageSize = input?.pageSize ?? 20;
      return { items, total: items.length, page: input?.page ?? 1, pageSize, totalPages: Math.ceil(items.length / pageSize) };
    },
    async getPrompt(id): Promise<PromptVaultItem | null> {
      await delay(60);
      return store.find(i => i.id === id) ?? null;
    },
    async createPrompt(input): Promise<{ id: number }> {
      await delay(80);
      const id = nextId++;
      store.push({ id, title: input.title, content: input.content, category: input.category ?? "general", tags: input.tags ?? [], isFavorite: false, useCount: 0, modelHint: input.modelHint, updatedAt: Date.now() });
      return { id };
    },
    async incrementUseCount(id): Promise<void> {
      await delay(40);
      const it = store.find(i => i.id === id);
      if (it) it.useCount += 1;
    },
    async listLinkedAssets(promptId): Promise<PromptLinkedAsset[]> {
      await delay(80);
      if (promptId !== 1) return [];
      return [{ relation: "derived", linkedAt: Date.now() - 7200000, asset: { id: 11, title: "晨霧 take-1", assetType: "video" } }];
    },
    async listLinkedPrompts(assetId): Promise<PromptLinkedPrompt[]> {
      await delay(80);
      if (assetId !== 11) return [];
      return [{ relation: "derived", linkedAt: Date.now() - 7200000, prompt: { id: 1, title: "禪修晨霧開場", content: "morning mist over a zen garden, soft golden light", category: "video" } }];
    },
  };
}

/** 一次組出全 mock registry（供 index.ts 在 *_STORE=mock 時使用）。 */
export function makeMockAdapters(deps: AdapterDeps): Adapters {
  return {
    dataStore: makeDataStoreMock(deps),
    generation: makeGenerationMock(deps),
    commander: makeCommanderMock(deps),
    contextPacket: makeContextPacketMock(deps),
    storage: makeStorageMock(deps),
    promptVault: makePromptVaultMock(deps),
    meta: { dataStore: "mock", generation: "mock", commander: "mock", contextPacket: "mock", storage: "mock", promptVault: "mock" },
  };
}
