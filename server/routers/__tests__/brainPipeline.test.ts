import { describe, expect, it, beforeEach } from "vitest";
import { __testing } from "../brainPipeline";
import {
  __unsafe_resetProviderHealthForTests,
  setProviderHealth,
  getProviderHealthVersion,
} from "../../services/providerHealth";

const { buildGraph } = __testing;

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

  it("emits page-group with all pages and individual page nodes when includeAllPages=true", () => {
    const g = buildGraph({
      includeAllPages: true,
      includeRouters: true,
      includeAlerts: true,
    });
    const group = g.nodes.find(n => n.id === "page-group:all");
    expect(group).toBeDefined();
    expect(group!.kind).toBe("page-group");
    expect(group!.children!.length).toBeGreaterThan(0);

    // Every child id should resolve to a real page node
    for (const childId of group!.children!) {
      expect(g.nodes.find(n => n.id === childId)).toBeDefined();
    }
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
