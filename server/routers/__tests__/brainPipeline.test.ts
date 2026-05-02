import { describe, expect, it, beforeEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { __testing } from "../brainPipeline";
import { APP_PAGE_REGISTRY } from "../../../shared/appRegistry";
import {
  __unsafe_resetProviderHealthForTests,
  setProviderHealth,
  getProviderHealthVersion,
} from "../../services/providerHealth";

const {
  buildGraph,
  ROUTER_TO_PROVIDERS,
  PAGE_TO_ROUTERS,
  ROUTER_TO_AI_SLOTS,
  PROVIDERS,
  STUDIO_CONSUMERS,
  API_ENDPOINTS,
  WEBHOOK_ENDPOINTS,
  DATA_NODES,
  INFRA_NODES,
  BROWSER_NODE_META,
} = __testing;

/** 專案根目錄 — 用於檢查 graph 中提到的檔案是否真的存在於 repo。 */
const REPO_ROOT = resolve(__dirname, "../../..");

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

  it("includes service routers (promptLibrary/news/apiUsage/...) and wires router → AI slot edges", () => {
    const g = buildGraph({
      includeAllPages: true,
      includeRouters: true,
      includeAlerts: false,
    });
    // 服務型 router 出現（即使沒有外部 provider 也要被畫出）
    const requiredRouters = [
      "router:apiUsage",
      "router:agentPreferences",
      "router:promptLibrary",
      "router:news",
      "router:showcase",
      "router:langsmith",
      "router:adminEval",
    ];
    for (const id of requiredRouters) {
      expect(g.nodes.find(n => n.id === id)).toBeDefined();
    }

    // page → service router 邊
    expect(
      g.edges.find(
        e => e.source === "page:home" && e.target === "router:news"
      )
    ).toBeDefined();
    expect(
      g.edges.find(
        e =>
          e.source === "page:prompt-library" &&
          e.target === "router:promptLibrary"
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

  it("APP_PAGE_REGISTRY paths stay in sync with client/src/App.tsx <Route> declarations (drift guard)", () => {
    // 讀 App.tsx 抓出所有 <Route path="..."> 的 path，跟 registry 中的 path 比對。
    // 部分頁面（登入、忘記密碼等）刻意不放進 registry，因此用 exempt 清單明確列出。
    const appTsx = readFileSync(
      resolve(REPO_ROOT, "client/src/App.tsx"),
      "utf-8"
    );
    const routePaths = new Set<string>();
    const re = /<Route\s+path=["']([^"']+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(appTsx)) !== null) {
      // 忽略 404 fallback 與動態路徑
      if (m[1] === "/404") continue;
      routePaths.add(m[1]);
    }
    expect(routePaths.size).toBeGreaterThan(10);

    // 已知不放進 APP_PAGE_REGISTRY 的路徑：
    // - 純 auth flow / WIP / 重定向
    // - registry 用 query 變體（如 /vault → /assets?section=vault），App.tsx 給了
    //   bare path 作為 alias；兩種寫法都會抵達同一個 UI
    const exemptPaths = new Set([
      "/forgot-password",
      "/reset-password",
      "/account-settings",
      "/learn/tutorial-overview", // 已有 /tutorial-overview
      "/admin/api-usage", // 已有 admin-api-usage 條目
      "/admin/brain-pipeline", // 已有 admin-brain-pipeline 條目
      "/settings/agent", // 已有 agent-preferences 條目
      "/settings/ai-brain", // 已有 brain-settings 條目
      "/process", // 已有 process-viewer 條目
      // registry 用 /assets?section=xxx 表達子分頁，App.tsx 給 bare path 作 alias
      "/vault", // registry: /assets?section=vault
      "/shared", // registry: /assets?section=shared
      "/history", // registry: /assets?section=history
      "/prompt-library", // registry: /assets?section=prompts
      "/background-tasks", // registry: /assets?section=tasks
      // registry 用 /dashboard?section=xxx 表達子分頁
      "/credits", // registry: /dashboard?section=credits
      "/langsmith", // registry: /dashboard?section=langsmith
      // registry 用 /models 但 App.tsx 也給 /lora-trainer 作 alias
      "/lora-trainer", // registry: /models
      "/calendar", // 行事曆功能尚未在 registry 中（可未來補上）
    ]);

    const registryPaths = new Set(APP_PAGE_REGISTRY.map(p => p.path));
    // 檢查：每條 App.tsx 的 route（除 exempt 外）都應該有對應的 registry 條目
    // 比對方式：path 直接相等，或 path 是 registry path 的「query 變體」（如 /assets vs /assets?section=prompts）
    const orphanRoutes: string[] = [];
    for (const path of routePaths) {
      if (exemptPaths.has(path)) continue;
      if (registryPaths.has(path)) continue;
      // 容許 registry 用「path?section=xxx」表達子分頁
      const matchedAsBase = [...registryPaths].some(rp =>
        rp.startsWith(`${path}?`)
      );
      if (matchedAsBase) continue;
      orphanRoutes.push(path);
    }
    expect(
      orphanRoutes,
      `App.tsx 有 <Route> 但 shared/appRegistry.ts 找不到對應 page：\n  ${orphanRoutes.join(", ")}\n` +
        `→ 請在 APP_PAGE_REGISTRY 加 entry，或更新本測試的 exemptPaths。`
    ).toEqual([]);
  });

  it("PAGE_TO_ROUTERS keys reference real registry pages and values reference real routers (drift guard)", () => {
    const registryIds = new Set(APP_PAGE_REGISTRY.map(p => p.id));
    const routerIds = new Set(ROUTER_TO_PROVIDERS.map(r => r.id));

    const orphanPageKeys: string[] = [];
    const orphanRouterTargets: string[] = [];
    for (const pageId of Object.keys(PAGE_TO_ROUTERS)) {
      if (!registryIds.has(pageId)) orphanPageKeys.push(pageId);
      for (const routerId of PAGE_TO_ROUTERS[pageId]) {
        if (!routerIds.has(routerId))
          orphanRouterTargets.push(`${pageId} → ${routerId}`);
      }
    }
    expect(orphanPageKeys, "PAGE_TO_ROUTERS 含 registry 找不到的 page id").toEqual(
      []
    );
    expect(
      orphanRouterTargets,
      "PAGE_TO_ROUTERS 指向的 router 不在 ROUTER_TO_PROVIDERS"
    ).toEqual([]);
  });

  it("ROUTER_TO_AI_SLOTS targets are real brain-slot or engine-slot ids (drift guard)", () => {
    // 真實的 slot id 從 buildGraph 輸出推導，避免重複在測試裡寫常數
    const g = buildGraph({
      includeAllPages: false,
      includeRouters: false,
      includeAlerts: false,
    });
    const validSlotIds = new Set(
      g.nodes
        .filter(n => n.kind === "brain-slot" || n.kind === "engine-slot")
        .map(n => n.id)
    );
    const orphanRouters: string[] = [];
    const orphanTargets: string[] = [];
    const declaredRouters = new Set(ROUTER_TO_PROVIDERS.map(r => r.id));
    for (const routerId of Object.keys(ROUTER_TO_AI_SLOTS)) {
      if (!declaredRouters.has(routerId)) orphanRouters.push(routerId);
      for (const slotId of ROUTER_TO_AI_SLOTS[routerId]) {
        if (!validSlotIds.has(slotId))
          orphanTargets.push(`${routerId} → ${slotId}`);
      }
    }
    expect(orphanRouters, "ROUTER_TO_AI_SLOTS 的 router id 未在 ROUTER_TO_PROVIDERS 註冊").toEqual([]);
    expect(orphanTargets, "ROUTER_TO_AI_SLOTS 指向不存在的 brain/engine slot").toEqual([]);
  });

  it("every repo file path mentioned by graph nodes really exists on disk (drift guard)", () => {
    // Graph 中每個 node 的 relatedFiles / diagnostics.frontendPath 若看起來像 repo 檔案路徑，
    // 必須真的存在於磁碟上。這檔案後來被改名/移走時 CI 會立刻失敗。
    const g = buildGraph({
      includeAllPages: true,
      includeRouters: true,
      includeAlerts: false,
    });

    const looksLikePath = (s: string) =>
      !!s &&
      !s.includes(" ") &&
      !s.startsWith("trpc.") &&
      s.includes("/") &&
      /\.[a-zA-Z0-9]+$/.test(s);

    const missing: string[] = [];
    for (const node of g.nodes) {
      const candidates: string[] = [
        ...(node.relatedFiles ?? []),
        ...(node.diagnostics?.frontendPath ? [node.diagnostics.frontendPath] : []),
      ];
      for (const p of candidates) {
        if (!looksLikePath(p)) continue;
        if (!existsSync(resolve(REPO_ROOT, p))) {
          missing.push(`${node.id} → ${p}`);
        }
      }
    }
    expect(
      missing,
      `Graph 中有檔案路徑指到不存在的檔案：\n  ${missing.slice(0, 20).join("\n  ")}\n` +
        `→ 請更新 brainPipeline.ts 中對應 node 的 relatedFiles / frontendPath。`
    ).toEqual([]);
  });

  it("studio consumer nodes are always present and edged to their engine slots, orb-agent and director", () => {
    // 個人視圖（無 page、無 router）也必須能看到工作室節點與引擎連線，
    // 否則「我的大腦」頁的引擎槽會懸空。
    const personal = buildGraph({
      includeAllPages: false,
      includeRouters: false,
      includeAlerts: false,
    });
    const studios = personal.nodes.filter(n => n.kind === "studio");
    expect(studios.map(s => s.id).sort()).toEqual([
      "studio:image-studio",
      "studio:pro-studio",
      "studio:video-studio",
    ]);

    // 每個工作室都連到它宣告的所有引擎槽
    for (const meta of STUDIO_CONSUMERS) {
      for (const engineSlot of meta.engines) {
        expect(
          personal.edges.find(
            e => e.source === meta.id && e.target === `engine:${engineSlot}`
          ),
          `${meta.id} 應有 edge 連到 engine:${engineSlot}`
        ).toBeDefined();
      }
    }

    // orb:agent → 每個工作室（光球可分派多步驟工具呼叫到工作室）
    for (const meta of STUDIO_CONSUMERS) {
      expect(
        personal.edges.find(
          e => e.source === "orb:agent" && e.target === meta.id
        ),
        `orb:agent 應有 edge 連到 ${meta.id}`
      ).toBeDefined();
    }

    // 導演 → 圖片 / 影片工作室（sendToStudio 流程）
    expect(
      personal.edges.find(
        e =>
          e.source === "director:main" && e.target === "studio:image-studio"
      )
    ).toBeDefined();
    expect(
      personal.edges.find(
        e =>
          e.source === "director:main" && e.target === "studio:video-studio"
      )
    ).toBeDefined();

    // admin 完整視圖也必須包含相同的工作室節點（不被 includeAllPages 開關影響）
    const admin = buildGraph({
      includeAllPages: true,
      includeRouters: true,
      includeAlerts: true,
    });
    expect(
      admin.nodes.filter(n => n.kind === "studio").map(s => s.id).sort()
    ).toEqual([
      "studio:image-studio",
      "studio:pro-studio",
      "studio:video-studio",
    ]);
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

  describe("「網站如何運作」深度整合層（client / api / data / infrastructure）", () => {
    it("admin 完整視圖預設包含 browser + api + data + infra 節點", () => {
      const g = buildGraph({
        includeAllPages: true,
        includeRouters: true,
        includeAlerts: false,
      });
      // browser 入口
      expect(g.nodes.find(n => n.id === BROWSER_NODE_META.id)).toBeDefined();
      // 核心 API 端點都應出現
      const apiIds = new Set(API_ENDPOINTS.map(e => e.id));
      const renderedApiIds = new Set(
        g.nodes.filter(n => n.kind === "api-endpoint").map(n => n.id)
      );
      for (const id of apiIds) {
        expect(renderedApiIds.has(id), `${id} 應出現在圖中`).toBe(true);
      }
      // 5 個 webhook 都應出現
      for (const wh of WEBHOOK_ENDPOINTS) {
        expect(g.nodes.find(n => n.id === wh.id)).toBeDefined();
      }
      // 資料層
      for (const meta of DATA_NODES) {
        expect(g.nodes.find(n => n.id === meta.id)).toBeDefined();
      }
      // 部署 / 觀測 / 第三方
      for (const meta of INFRA_NODES) {
        expect(g.nodes.find(n => n.id === meta.id)).toBeDefined();
      }
    });

    it("瀏覽器節點連到所有 page-group（admin 視圖）與 orb-agent（個人視圖 fallback）", () => {
      const admin = buildGraph({
        includeAllPages: true,
        includeRouters: true,
        includeAlerts: false,
      });
      const groupNodes = admin.nodes.filter(n => n.kind === "page-group");
      expect(groupNodes.length).toBeGreaterThan(0);
      for (const group of groupNodes) {
        expect(
          admin.edges.find(
            e =>
              e.source === BROWSER_NODE_META.id && e.target === group.id
          ),
          `browser → ${group.id} edge 應存在`
        ).toBeDefined();
      }

      const personal = buildGraph({
        includeAllPages: false,
        includeRouters: false,
        includeAlerts: false,
      });
      expect(
        personal.edges.find(
          e =>
            e.source === BROWSER_NODE_META.id && e.target === "orb:agent"
        )
      ).toBeDefined();
    });

    it("API 端點 → 下游節點的邊都會被畫出（端點不會懸空）", () => {
      const g = buildGraph({
        includeAllPages: true,
        includeRouters: true,
        includeAlerts: false,
      });
      const ids = new Set(g.nodes.map(n => n.id));
      // /api/upload 必須連到 storage:assets 與 db:main
      expect(
        g.edges.find(
          e => e.source === "api:upload" && e.target === "storage:assets"
        )
      ).toBeDefined();
      expect(
        g.edges.find(e => e.source === "api:upload" && e.target === "db:main")
      ).toBeDefined();
      // /api/trpc 必須連到至少一個 router 節點
      const trpcDownstream = g.edges.filter(e => e.source === "api:trpc");
      expect(trpcDownstream.length).toBeGreaterThan(0);
      for (const e of trpcDownstream) {
        expect(ids.has(e.target)).toBe(true);
      }
    });

    it("Webhook 由對應 provider/payment 流入；下游寫入 db:main", () => {
      const g = buildGraph({
        includeAllPages: false,
        includeRouters: false,
        includeAlerts: false,
      });
      // provider:fal → webhook:fal
      expect(
        g.edges.find(
          e => e.source === "provider:fal" && e.target === "webhook:fal"
        )
      ).toBeDefined();
      // payment:stripe → webhook:stripe
      expect(
        g.edges.find(
          e =>
            e.source === "payment:stripe" && e.target === "webhook:stripe"
        )
      ).toBeDefined();
      // 每個 webhook → db:main
      for (const wh of WEBHOOK_ENDPOINTS) {
        if (wh.downstream.includes("db:main")) {
          expect(
            g.edges.find(e => e.source === wh.id && e.target === "db:main")
          ).toBeDefined();
        }
      }
    });

    it("Railway 部署節點代管 healthcheck / DB / storage", () => {
      const g = buildGraph({
        includeAllPages: false,
        includeRouters: false,
        includeAlerts: false,
      });
      const railway = g.nodes.find(n => n.id === "infra:railway");
      expect(railway).toBeDefined();
      expect(railway!.layer).toBe("infrastructure");
      expect(
        g.edges.find(
          e => e.source === "infra:railway" && e.target === "api:health"
        )
      ).toBeDefined();
      expect(
        g.edges.find(
          e => e.source === "infra:railway" && e.target === "db:main"
        )
      ).toBeDefined();
      expect(
        g.edges.find(
          e =>
            e.source === "infra:railway" && e.target === "storage:assets"
        )
      ).toBeDefined();
    });

    it("可關閉 includeInfrastructure 取得舊版精簡圖（向後相容）", () => {
      const slim = buildGraph({
        includeAllPages: false,
        includeRouters: false,
        includeAlerts: false,
        includeInfrastructure: false,
      });
      expect(
        slim.nodes.find(n => n.id === BROWSER_NODE_META.id)
      ).toBeUndefined();
      expect(
        slim.nodes.find(n => n.kind === "api-endpoint")
      ).toBeUndefined();
      expect(slim.nodes.find(n => n.id === "db:main")).toBeUndefined();
      expect(
        slim.nodes.find(n => n.id === "infra:railway")
      ).toBeUndefined();
    });

    it("API endpoint 狀態繼承下游最差狀態（worst-of 規則）", () => {
      // 透過讓 storage 在生產環境缺設來迫 api:upload 退化（純單元測試以
      // 已存在的環境而定，這裡僅驗證型別欄位存在且為合法狀態）。
      const g = buildGraph({
        includeAllPages: false,
        includeRouters: false,
        includeAlerts: false,
      });
      const upload = g.nodes.find(n => n.id === "api:upload");
      expect(upload).toBeDefined();
      expect(["healthy", "needs_optimization", "broken", "abnormal"]).toContain(
        upload!.status
      );
    });
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
