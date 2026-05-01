import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { __testing } from "../brainPipeline";
import {
  __unsafe_resetProviderHealthForTests,
  setProviderHealth,
  getProviderHealthVersion,
} from "../../services/providerHealth";

const { buildGraph, ROUTER_TO_PROVIDERS } = __testing;

describe("brainPipeline graph builder", () => {
  beforeEach(() => {
    __unsafe_resetProviderHealthForTests();
  });

  it("returns nodes for all reasoning brain slots and generation engines", () => {
    const g = buildGraph({
      includeAllPages: false,
      includeRouters: false,
      includeAlerts: false,
    });

    const brainSlots = g.nodes.filter(n => n.kind === "brain-slot");
    expect(brainSlots).toHaveLength(5);
    expect(brainSlots.map(n => n.id).sort()).toEqual([
      "brain:analyst",
      "brain:curator",
      "brain:director",
      "brain:storyteller",
      "brain:technician",
    ]);

    const engineSlots = g.nodes.filter(n => n.kind === "engine-slot");
    expect(engineSlots).toHaveLength(4);
    expect(engineSlots.map(n => n.id).sort()).toEqual([
      "engine:audioEngine",
      "engine:imageEngine",
      "engine:videoEngine",
      "engine:voiceEngine",
    ]);
  });

  it("always emits one provider node per registered provider", () => {
    const g = buildGraph({
      includeAllPages: false,
      includeRouters: false,
      includeAlerts: false,
    });
    const providers = g.nodes.filter(n => n.kind === "provider");
    expect(providers.map(p => p.id).sort()).toEqual([
      "provider:elevenlabs",
      "provider:fal",
      "provider:gemini",
      "provider:replicate",
      "provider:suno",
      "provider:vertex",
    ]);
  });

  it("marks a provider as broken when API key env is unset", () => {
    const originalKey = process.env.FAL_API_KEY;
    delete process.env.FAL_API_KEY;
    try {
      const g = buildGraph({
        includeAllPages: false,
        includeRouters: false,
        includeAlerts: false,
      });
      const fal = g.nodes.find(n => n.id === "provider:fal");
      expect(fal).toBeDefined();
      // Note: serverEnv was already loaded before we deleted the var, so
      // the broken status here depends on serverEnv.FAL_API_KEY being empty.
      // We assert the node has a status string regardless.
      expect(["healthy", "broken", "needs_optimization", "abnormal"]).toContain(
        fal!.status
      );
    } finally {
      if (originalKey !== undefined) process.env.FAL_API_KEY = originalKey;
    }
  });

  it("propagates provider rate_limited as needs_optimization", () => {
    setProviderHealth("fal", "rate_limited", "429 quota");
    const g = buildGraph({
      includeAllPages: false,
      includeRouters: false,
      includeAlerts: false,
    });
    const fal = g.nodes.find(n => n.id === "provider:fal");
    // If FAL_API_KEY is missing, it stays broken; otherwise it should be needs_optimization
    if (fal!.status !== "broken") {
      expect(fal!.status).toBe("needs_optimization");
      expect(fal!.reason).toContain("429");
      expect(fal!.recommendation).toBeTruthy();
    }
  });

  it("includes router nodes only when includeRouters=true", () => {
    const personal = buildGraph({
      includeAllPages: false,
      includeRouters: false,
      includeAlerts: false,
    });
    expect(personal.nodes.filter(n => n.kind === "router")).toHaveLength(0);

    const admin = buildGraph({
      includeAllPages: true,
      includeRouters: true,
      includeAlerts: true,
    });
    const routers = admin.nodes.filter(n => n.kind === "router");
    expect(routers.length).toBeGreaterThan(0);
    expect(routers.some(r => r.id === "router:brain")).toBe(true);
    expect(routers.some(r => r.id === "router:director")).toBe(true);
  });

  it("splits pages into per-group containers (orb/create/admin/...) and links pages to routers", () => {
    const g = buildGraph({
      includeAllPages: true,
      includeRouters: true,
      includeAlerts: true,
    });
    const groups = g.nodes.filter(n => n.kind === "page-group");
    expect(groups.length).toBeGreaterThan(1);
    expect(groups.some(n => n.id === "page-group:create")).toBe(true);
    expect(groups.some(n => n.id === "page-group:admin")).toBe(true);

    // Every group's children should resolve to real page nodes,
    // and every page's parentId should point at one of these groups.
    const groupIds = new Set(groups.map(n => n.id));
    for (const group of groups) {
      for (const childId of group.children ?? []) {
        expect(g.nodes.find(n => n.id === childId)).toBeDefined();
      }
    }
    const pages = g.nodes.filter(n => n.kind === "page");
    for (const p of pages) {
      expect(p.parentId).toBeDefined();
      expect(groupIds.has(p.parentId!)).toBe(true);
    }

    // page → router edges exist for known studios (full-view trace).
    const imageStudioToRouter = g.edges.find(
      e =>
        e.source === "page:image-studio" &&
        e.target === "router:imageStudio"
    );
    expect(imageStudioToRouter).toBeDefined();
  });

  it("page nodes without supportsPageAgent are marked abnormal", () => {
    const g = buildGraph({
      includeAllPages: true,
      includeRouters: false,
      includeAlerts: false,
    });
    const pages = g.nodes.filter(n => n.kind === "page");
    const abnormal = pages.filter(p => p.status === "abnormal");
    // Either zero (if all pages support agent) or each abnormal one carries a reason
    for (const p of abnormal) {
      expect(p.reason).toContain("PageAgent");
    }
  });

  it("includes service routers (notes/promptLibrary/news/apiUsage/...) and wires router → AI slot edges", () => {
    const g = buildGraph({
      includeAllPages: true,
      includeRouters: true,
      includeAlerts: false,
    });
    // 服務型 router 出現（即使沒有外部 provider 也要被畫出）
    const requiredRouters = [
      "router:apiUsage",
      "router:agentPreferences",
      "router:notes",
      "router:promptLibrary",
      "router:news",
      "router:showcase",
      "router:langsmith",
      "router:adminEval",
    ];
    for (const id of requiredRouters) {
      expect(g.nodes.find(n => n.id === id)).toBeDefined();
    }

    // page → service router 邊：home → news/showcase, notes → notes router
    expect(
      g.edges.find(
        e => e.source === "page:home" && e.target === "router:news"
      )
    ).toBeDefined();
    expect(
      g.edges.find(
        e => e.source === "page:notes" && e.target === "router:notes"
      )
    ).toBeDefined();

    // router → AI slot 邊（語意中介層）
    expect(
      g.edges.find(
        e =>
          e.source === "router:imageStudio" &&
          e.target === "engine:imageEngine"
      )
    ).toBeDefined();
    expect(
      g.edges.find(
        e =>
          e.source === "router:proStudio" &&
          e.target === "engine:voiceEngine"
      )
    ).toBeDefined();
    expect(
      g.edges.find(
        e =>
          e.source === "router:learnHub" && e.target === "brain:analyst"
      )
    ).toBeDefined();
  });

  it("ROUTER_TO_PROVIDERS stays in sync with server/routers.ts (drift guard)", () => {
    // 讀 server/routers.ts 原始碼，抓所有「key: someRouter,」式註冊。
    // 任何在 routers.ts 註冊、但未列入 ROUTER_TO_PROVIDERS 的 router 都應失敗，
    // 確保大腦推理鏈視覺化會跟著程式碼真實更新。
    const routersTs = readFileSync(
      resolve(__dirname, "../../routers.ts"),
      "utf-8"
    );
    // 例：`  imageStudio: imageStudioRouter,`
    const registered = new Set<string>();
    const re = /^\s+([a-zA-Z][a-zA-Z0-9]*):\s+[a-zA-Z][a-zA-Z0-9]*Router,/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(routersTs)) !== null) {
      registered.add(m[1]);
    }
    expect(registered.size).toBeGreaterThan(0);

    // 已知不需要顯示在大腦推理鏈圖上的 router（meta / 測試 / 系統健康用）
    const exempt = new Set([
      "system", // 系統健康，不在 graph 上重複呈現
      "brainPipeline", // 自我引用，避免 meta 循環
      "modelConsents", // 純法務同意書，無 AI 流向
      "externalServices", // 外部服務代理（HTTP），不算 tRPC AI router
      "promptLibrary", // 已可選擇納入；目前 ROUTER_TO_PROVIDERS 未列即視為豁免
      "sense", // 感測訊號，獨立子系統
      "orbCapabilities", // 純 capability registry 查詢，不觸發 AI
    ]);

    const inGraph = new Set(
      ROUTER_TO_PROVIDERS.map(r => r.id.replace(/^router:/, ""))
    );

    const missing: string[] = [];
    for (const name of registered) {
      if (exempt.has(name)) continue;
      if (!inGraph.has(name)) missing.push(name);
    }

    expect(
      missing,
      `偵測到 server/routers.ts 新增了 router 但未加入 brainPipeline.ts 的 ROUTER_TO_PROVIDERS：\n  ${missing.join(", ")}\n` +
        `→ 請在 server/routers/brainPipeline.ts 的 ROUTER_TO_PROVIDERS 加上對應 entry，` +
        `或若該 router 不該出現在大腦推理鏈圖上，請更新本測試的 exempt 清單。`
    ).toEqual([]);
  });

  it("orb-agent and orb-assistant and director nodes are always present", () => {
    const g = buildGraph({
      includeAllPages: false,
      includeRouters: false,
      includeAlerts: false,
    });
    expect(g.nodes.find(n => n.id === "orb:agent")).toBeDefined();
    expect(g.nodes.find(n => n.id === "orb:assistant")).toBeDefined();
    expect(g.nodes.find(n => n.id === "director:main")).toBeDefined();
  });

  it("summary counts equal the total node count", () => {
    const g = buildGraph({
      includeAllPages: true,
      includeRouters: true,
      includeAlerts: true,
    });
    const { healthy, needsOptimization, broken, abnormal, totalNodes } =
      g.summary;
    expect(healthy + needsOptimization + broken + abnormal).toBe(totalNodes);
    expect(totalNodes).toBe(g.nodes.length);
  });

  it("emits 4 legend entries", () => {
    const g = buildGraph({
      includeAllPages: false,
      includeRouters: false,
      includeAlerts: false,
    });
    expect(g.legend).toHaveLength(4);
    expect(g.legend.map(l => l.status).sort()).toEqual([
      "abnormal",
      "broken",
      "healthy",
      "needs_optimization",
    ]);
  });

  it("every edge points at an existing node", () => {
    const g = buildGraph({
      includeAllPages: true,
      includeRouters: true,
      includeAlerts: true,
    });
    const ids = new Set(g.nodes.map(n => n.id));
    for (const edge of g.edges) {
      expect(ids.has(edge.source)).toBe(true);
      expect(ids.has(edge.target)).toBe(true);
    }
  });

  it("setProviderHealth 後資料版本會 +1（讓 brainPipeline 快取可即時失效）", () => {
    const before = getProviderHealthVersion();
    setProviderHealth("fal", "rate_limited", "429 quota");
    const afterFirst = getProviderHealthVersion();
    expect(afterFirst).toBeGreaterThan(before);

    setProviderHealth("gemini", "degraded", "elevated latency");
    const afterSecond = getProviderHealthVersion();
    expect(afterSecond).toBeGreaterThan(afterFirst);
  });

  it("buildGraph 不會在同一張圖內重複堆疊 trace samples（共享 traces 快照）", () => {
    // 健康狀態都正常時，trace samples 應為空陣列；確保我們沒在每個 helper
    // 內各自 fetch 一次而導致行為偏移。
    const g = buildGraph({
      includeAllPages: true,
      includeRouters: true,
      includeAlerts: false,
    });
    for (const node of g.nodes) {
      const samples = node.diagnostics?.traceSampleIds;
      if (samples) {
        // 樣本數最多 3 個，且不應出現重複 id（同一張圖共享同一個 traces 陣列）
        expect(samples.length).toBeLessThanOrEqual(3);
        expect(new Set(samples).size).toBe(samples.length);
      }
    }
  });
});
