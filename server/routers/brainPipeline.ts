/**
 * Brain Pipeline Visualization Router
 * ────────────────────────────────────────────────────────────────────────────
 * 聚合既有的健康狀態、錯誤追蹤、頁面註冊表、Provider 健康偵測，組合成一張
 * 「AI 大腦組態管線圖」，提供給前端 React Flow 可視化呈現。
 *
 * 兩個 procedures：
 *   - getGraph      → admin only：全站完整管線
 *   - getMyGraph    → 任何登入用戶：個人腦組態（5 推理 + 4 引擎 + 我能用的 provider）
 *
 * 不重新偵測，只彙整既有資料源（不會額外打外部 API）。
 */

import { router, adminProcedure, protectedProcedure } from "../_core/trpc";
import { serverEnv } from "../_core/env.validated";
import { getEngineStatus } from "../_core/llmRouter";
import { getProviderHealth } from "../services/providerHealth";
import {
  getHealthSnapshot,
  DEFAULT_REASONING_BRAINS,
  DEFAULT_GENERATION_ENGINES,
  type ReasoningBrainSlot,
  type GenerationEngineSlot,
} from "../middleware/brainContext";
import {
  getAlerts,
  getErrorTraces,
  getSystemSummary,
} from "../services/brainAutoRepair";
import { APP_PAGE_REGISTRY } from "../../shared/appRegistry";
import type {
  PipelineGraph,
  PipelineNode,
  PipelineEdge,
  PipelineNodeStatus,
} from "../../shared/brain-pipeline";
import { STATUS_LABEL, STATUS_DESCRIPTION } from "../../shared/brain-pipeline";

// ═══════════════════════════════════════════════════════════════════════════
// Static Catalogs
// ═══════════════════════════════════════════════════════════════════════════

/** 推理腦槽顯示用標籤（中文白話） */
const REASONING_SLOT_META: Record<
  ReasoningBrainSlot,
  { label: string; description: string }
> = {
  director: {
    label: "導演 AI",
    description: "統籌創作流程、分鏡、敘事結構",
  },
  analyst: {
    label: "新聞過濾",
    description: "數據分析、趨勢洞察、新聞摘要",
  },
  storyteller: {
    label: "編譯器",
    description: "創意寫作、敘事生成、文案產出",
  },
  technician: {
    label: "技術員",
    description: "程式碼、結構化資料、工具呼叫",
  },
  curator: {
    label: "策展人",
    description: "風格挑選、素材整理、主題分類",
  },
};

/** 生成引擎顯示用標籤 */
const GENERATION_SLOT_META: Record<
  GenerationEngineSlot,
  { label: string; description: string; provider: string }
> = {
  imageEngine: {
    label: "圖像引擎",
    description: "靜態圖像生成（Flux / SDXL / Imagen 等）",
    provider: "fal",
  },
  videoEngine: {
    label: "影片引擎",
    description: "動態影片生成（Kling / Veo / WAN 等）",
    provider: "fal",
  },
  audioEngine: {
    label: "音樂引擎",
    description: "音樂與環境音生成（ACE-Step / StableAudio 等）",
    provider: "fal",
  },
  voiceEngine: {
    label: "語音引擎",
    description: "語音合成與聲音克隆（ElevenLabs / Qwen / Dia）",
    provider: "elevenlabs",
  },
};

interface ProviderMeta {
  id: string;
  label: string;
  description: string;
  apiKeyEnv: string;
  /** API key 是否有設定（true=已設） */
  hasKey: () => boolean;
}

const PROVIDERS: ProviderMeta[] = [
  {
    id: "gemini",
    label: "Google Gemini",
    description: "主要 LLM 引擎（推理與多模態）",
    apiKeyEnv: "GEMINI_API_KEY",
    hasKey: () => Boolean(serverEnv.GEMINI_API_KEY),
  },
  {
    id: "vertex",
    label: "Google Vertex AI",
    description: "企業級 LLM 與多模態（Gemini / Llama / Imagen）",
    apiKeyEnv: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
    hasKey: () => Boolean(serverEnv.GOOGLE_APPLICATION_CREDENTIALS_JSON),
  },
  {
    id: "fal",
    label: "Fal.ai",
    description: "圖像／影片／音樂／語音生成模型聚合",
    apiKeyEnv: "FAL_API_KEY",
    hasKey: () => Boolean(serverEnv.FAL_API_KEY),
  },
  {
    id: "elevenlabs",
    label: "ElevenLabs",
    description: "高品質語音合成與聲音克隆",
    apiKeyEnv: "ELEVENLABS_API_KEY",
    hasKey: () => Boolean(serverEnv.ELEVENLABS_API_KEY),
  },
  {
    id: "suno",
    label: "Suno",
    description: "音樂生成（備援）",
    apiKeyEnv: "SUNO_API_KEY",
    hasKey: () => Boolean(serverEnv.SUNO_API_KEY),
  },
  {
    id: "replicate",
    label: "Replicate",
    description: "LoRA 訓練與第三方模型推理",
    apiKeyEnv: "REPLICATE_API_TOKEN",
    hasKey: () => Boolean(serverEnv.REPLICATE_API_TOKEN),
  },
];

/** 後端路由 → 連結到的 provider id 清單 */
const ROUTER_TO_PROVIDERS: Array<{
  id: string;
  label: string;
  description: string;
  providers: string[];
  files: string[];
}> = [
  {
    id: "router:brain",
    label: "brain（大腦組態）",
    description: "管理用戶腦組態 CRUD、模型健康、錯誤追蹤",
    providers: ["gemini", "vertex"],
    files: ["server/routers/brain.ts"],
  },
  {
    id: "router:director",
    label: "director（導演 AI）",
    description: "CO-STAR 導演對話、劇本規劃、RAG 記憶",
    providers: ["gemini", "vertex"],
    files: ["server/routers/director.ts"],
  },
  {
    id: "router:imageStudio",
    label: "imageStudio（圖像工作室）",
    description: "靜態圖像生成 dispatch",
    providers: ["fal", "vertex"],
    files: ["server/routers/imageStudio.ts", "server/services/falDispatcher.ts"],
  },
  {
    id: "router:videoStudio",
    label: "videoStudio（影片工作室）",
    description: "影片生成 dispatch（Kling / Veo / WAN）",
    providers: ["fal", "vertex"],
    files: ["server/routers/videoStudio.ts", "server/services/falDispatcher.ts"],
  },
  {
    id: "router:proStudio",
    label: "proStudio（專業工作室）",
    description: "TTS、聲音克隆、音訊處理",
    providers: ["elevenlabs", "fal"],
    files: ["server/routers/proStudio.ts"],
  },
  {
    id: "router:loraTrainer",
    label: "loraTrainer（LoRA 訓練）",
    description: "自訂風格模型訓練",
    providers: ["replicate", "fal"],
    files: ["server/routers/loraTrainer.ts"],
  },
  {
    id: "router:learnHub",
    label: "learnHub（學習中心）",
    description: "教學內容與問答",
    providers: ["gemini"],
    files: ["server/routers/learnHub.ts"],
  },
  {
    id: "router:orbScheduler",
    label: "orbScheduler（光球排程）",
    description: "光球代理任務狀態機與多步驟排程",
    providers: ["gemini", "fal"],
    files: [
      "server/routers/orbSchedulerRouter.ts",
      "server/services/orbTaskOrchestrator.ts",
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

interface AggregatedHealth {
  /** 已脫敏的 reason，可能 undefined */
  reason?: string;
  recommendation?: string;
  metrics?: {
    consecutiveFailures?: number;
    lastError?: string;
    recentErrorCount?: number;
    updatedAt?: number;
  };
}

/** 由 ProviderHealth + API Key 狀態推導 provider 節點狀態。 */
function deriveProviderStatus(
  meta: ProviderMeta
): { status: PipelineNodeStatus } & AggregatedHealth {
  if (!meta.hasKey()) {
    return {
      status: "broken",
      reason: `${meta.apiKeyEnv} 未設定，無法呼叫此 provider`,
      recommendation: `請在環境變數中設定 ${meta.apiKeyEnv}，重新啟動服務`,
    };
  }
  const ph = getProviderHealth(meta.id);
  switch (ph.status) {
    case "healthy":
      return {
        status: "healthy",
        metrics: { updatedAt: ph.updatedAt },
      };
    case "missing_key":
      return {
        status: "broken",
        reason: ph.reason ?? `${meta.apiKeyEnv} 缺失`,
        recommendation: `請在環境變數中設定 ${meta.apiKeyEnv}`,
        metrics: { updatedAt: ph.updatedAt },
      };
    case "disabled":
      return {
        status: "abnormal",
        reason: ph.reason ?? "已被管理員停用",
        recommendation: "如需啟用，請至設定頁開啟",
        metrics: { updatedAt: ph.updatedAt },
      };
    case "rate_limited":
      return {
        status: "needs_optimization",
        reason: ph.reason ?? "已觸發外部 API 速率限制",
        recommendation:
          "降低呼叫頻率、加入指數退避重試，或升級至付費方案以提升限額",
        metrics: { updatedAt: ph.updatedAt },
      };
    case "timeout":
      return {
        status: "needs_optimization",
        reason: ph.reason ?? "外部 API 回應逾時",
        recommendation:
          "檢查網路狀況、提高 timeout 上限，或啟用 fallback 引擎",
        metrics: { updatedAt: ph.updatedAt },
      };
    case "degraded":
      return {
        status: "needs_optimization",
        reason: ph.reason ?? "外部 API 服務降級",
        recommendation: "建議啟用備援引擎、密切監控",
        metrics: { updatedAt: ph.updatedAt },
      };
    case "unknown_error":
    default:
      return {
        status: "broken",
        reason: ph.reason ?? "外部 API 出現未知錯誤",
        recommendation: "查看錯誤追蹤頁面取得詳細 stack trace 後修復",
        metrics: { updatedAt: ph.updatedAt },
      };
  }
}

/** 對單一模型 / 引擎查健康狀態，推導腦槽節點狀態。 */
function deriveBrainSlotStatus(modelOrEngine: string): {
  status: PipelineNodeStatus;
} & AggregatedHealth {
  const snapshot = getHealthSnapshot();
  const cached = snapshot[modelOrEngine];
  if (!cached) {
    return { status: "healthy" };
  }
  if (cached.healthy) {
    if (cached.consecutiveFailures > 0) {
      return {
        status: "needs_optimization",
        reason: `近期出現 ${cached.consecutiveFailures} 次失敗但已恢復`,
        recommendation: "建議檢查 fallback 鏈是否完整",
        metrics: {
          consecutiveFailures: cached.consecutiveFailures,
          lastError: cached.lastError,
          updatedAt: cached.checkedAt,
        },
      };
    }
    return {
      status: "healthy",
      metrics: { updatedAt: cached.checkedAt },
    };
  }
  return {
    status: "broken",
    reason:
      cached.lastError ??
      `連續失敗 ${cached.consecutiveFailures} 次，已被熔斷`,
    recommendation:
      "前往「大腦組態」改選備援模型，或排查 API key 與外部服務狀態",
    metrics: {
      consecutiveFailures: cached.consecutiveFailures,
      lastError: cached.lastError,
      updatedAt: cached.checkedAt,
    },
  };
}

/** 把錯誤 trace 計入到 router / provider 節點。 */
function buildErrorCountIndex(): {
  byEngine: Map<string, number>;
  byModality: Map<string, number>;
} {
  const traces = getErrorTraces(200);
  const byEngine = new Map<string, number>();
  const byModality = new Map<string, number>();
  for (const t of traces) {
    if (t.resolvedAt) continue;
    byEngine.set(t.engine, (byEngine.get(t.engine) ?? 0) + 1);
    byModality.set(t.modality, (byModality.get(t.modality) ?? 0) + 1);
  }
  return { byEngine, byModality };
}

function makeEdge(source: string, target: string, label?: string): PipelineEdge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    label,
    style: "solid",
  };
}

function summarize(nodes: PipelineNode[]): PipelineGraph["summary"] {
  let healthy = 0;
  let needsOpt = 0;
  let broken = 0;
  let abnormal = 0;
  for (const n of nodes) {
    if (n.status === "healthy") healthy++;
    else if (n.status === "needs_optimization") needsOpt++;
    else if (n.status === "broken") broken++;
    else abnormal++;
  }
  return {
    healthy,
    needsOptimization: needsOpt,
    broken,
    abnormal,
    totalNodes: nodes.length,
    lastUpdatedAt: Date.now(),
  };
}

function buildLegend(): PipelineGraph["legend"] {
  return (
    Object.keys(STATUS_LABEL) as Array<keyof typeof STATUS_LABEL>
  ).map(key => ({
    status: key,
    label: STATUS_LABEL[key],
    description: STATUS_DESCRIPTION[key],
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// Graph Builders
// ═══════════════════════════════════════════════════════════════════════════

interface BuildGraphOptions {
  /** true = 包含全部 30+ 頁面節點；false = 只給個人簡化版 */
  includeAllPages: boolean;
  /** true = 包含完整 router 拓撲；false = 個人版隱藏 */
  includeRouters: boolean;
  /** 個人版是否包含活躍錯誤摘要（會脫敏） */
  includeAlerts: boolean;
}

function buildGraph(opts: BuildGraphOptions): PipelineGraph {
  const nodes: PipelineNode[] = [];
  const edges: PipelineEdge[] = [];

  const errorIndex = buildErrorCountIndex();
  const engineStatus = getEngineStatus();

  // ── Layer 4: External Providers ──────────────────────────────────────────
  for (const meta of PROVIDERS) {
    const derived = deriveProviderStatus(meta);
    const recentErrorCount = errorIndex.byEngine.get(meta.id) ?? 0;
    nodes.push({
      id: `provider:${meta.id}`,
      kind: "provider",
      layer: "external",
      label: meta.label,
      description: meta.description,
      status: derived.status,
      reason: derived.reason,
      recommendation: derived.recommendation,
      relatedFiles: [`.env (${meta.apiKeyEnv})`],
      metrics: {
        ...derived.metrics,
        recentErrorCount: recentErrorCount || undefined,
      },
    });
  }

  // ── Layer 3a: Reasoning Brain Slots ──────────────────────────────────────
  for (const slot of Object.keys(DEFAULT_REASONING_BRAINS) as ReasoningBrainSlot[]) {
    const defaultModel = DEFAULT_REASONING_BRAINS[slot].model;
    const meta = REASONING_SLOT_META[slot];
    const derived = deriveBrainSlotStatus(defaultModel);
    nodes.push({
      id: `brain:${slot}`,
      kind: "brain-slot",
      layer: "ai-brain",
      label: `${meta.label}（${slot}）`,
      description: `${meta.description}｜目前模型：${defaultModel}`,
      status: derived.status,
      reason: derived.reason,
      recommendation: derived.recommendation,
      relatedFiles: [
        "server/middleware/brainContext.ts",
        "server/routers/brain.ts",
      ],
      metrics: derived.metrics,
    });

    // 推理腦槽 → Gemini / Vertex provider
    const targetProvider = defaultModel.startsWith("vertex/")
      ? "vertex"
      : defaultModel.startsWith("nvidia/")
        ? "vertex"
        : "gemini";
    edges.push(
      makeEdge(`brain:${slot}`, `provider:${targetProvider}`, "推理呼叫")
    );
  }

  // ── Layer 3b: Generation Engine Slots ────────────────────────────────────
  for (const slot of Object.keys(
    DEFAULT_GENERATION_ENGINES
  ) as GenerationEngineSlot[]) {
    const defaultEngine = DEFAULT_GENERATION_ENGINES[slot].engine;
    const meta = GENERATION_SLOT_META[slot];
    const derived = deriveBrainSlotStatus(defaultEngine);
    nodes.push({
      id: `engine:${slot}`,
      kind: "engine-slot",
      layer: "ai-brain",
      label: meta.label,
      description: `${meta.description}｜目前引擎：${defaultEngine}`,
      status: derived.status,
      reason: derived.reason,
      recommendation: derived.recommendation,
      relatedFiles: [
        "server/middleware/brainContext.ts",
        "server/services/falDispatcher.ts",
      ],
      metrics: derived.metrics,
    });

    // 生成引擎 → 對應 provider
    edges.push(
      makeEdge(`engine:${slot}`, `provider:${meta.provider}`, "生成呼叫")
    );
  }

  // ── Layer 3c: Orb Agent / Orb Assistant / Director AI ───────────────────
  // 光球代理（全站路由器）
  const orbAgentStatus: PipelineNodeStatus =
    engineStatus.available.length === 0 ? "broken" : "healthy";
  nodes.push({
    id: "orb:agent",
    kind: "orb-agent",
    layer: "ai-brain",
    label: "全站光球代理",
    description: "理解需求、路由到正確功能、串接多步驟工具呼叫",
    status: orbAgentStatus,
    reason:
      orbAgentStatus === "broken"
        ? "目前沒有任何可用的 LLM 引擎"
        : undefined,
    recommendation:
      orbAgentStatus === "broken"
        ? engineStatus.recommendation
        : undefined,
    relatedFiles: [
      "server/services/orbTaskOrchestrator.ts",
      "server/services/orbTaskStateMachine.ts",
      "shared/global-agent-registry.ts",
    ],
  });
  edges.push(makeEdge("orb:agent", "brain:director", "委派決策"));
  edges.push(makeEdge("orb:agent", "brain:technician", "工具呼叫"));

  // 光球助手（PageAgent）
  const totalSupporting = APP_PAGE_REGISTRY.filter(
    p => p.supportsPageAgent
  ).length;
  nodes.push({
    id: "orb:assistant",
    kind: "orb-assistant",
    layer: "ai-brain",
    label: "光球助手（PageAgent）",
    description: `每頁的智慧助手，目前有 ${totalSupporting} / ${APP_PAGE_REGISTRY.length} 頁啟用`,
    status: "healthy",
    relatedFiles: [
      "client/src/contexts/PageAgentContext.tsx",
      "shared/global-agent-capabilities.ts",
    ],
  });
  edges.push(makeEdge("orb:assistant", "orb:agent", "升級到全站代理"));

  // 導演 AI
  nodes.push({
    id: "director:main",
    kind: "director",
    layer: "ai-brain",
    label: "導演 AI",
    description: "CO-STAR 對話、劇本規劃、RAG 記憶",
    status: "healthy",
    relatedFiles: ["server/routers/director.ts", "client/src/pages/DirectorAI.tsx"],
  });
  edges.push(makeEdge("director:main", "brain:director", "推理"));
  edges.push(makeEdge("director:main", "brain:storyteller", "敘事"));

  // ── Layer 2: Backend Routers ─────────────────────────────────────────────
  if (opts.includeRouters) {
    for (const r of ROUTER_TO_PROVIDERS) {
      // 每個 router 的健康度：以下游 provider 健康度與錯誤數推導
      const recentErrors = r.providers
        .map(p => errorIndex.byEngine.get(p) ?? 0)
        .reduce((a, b) => a + b, 0);
      const downstreamBroken = r.providers.some(p => {
        const meta = PROVIDERS.find(x => x.id === p);
        if (!meta) return false;
        return deriveProviderStatus(meta).status === "broken";
      });
      const status: PipelineNodeStatus = downstreamBroken
        ? "broken"
        : recentErrors > 5
          ? "needs_optimization"
          : "healthy";
      nodes.push({
        id: r.id,
        kind: "router",
        layer: "backend",
        label: r.label,
        description: r.description,
        status,
        reason: downstreamBroken
          ? "下游 provider 之一無法使用"
          : recentErrors > 5
            ? `近期累積 ${recentErrors} 筆錯誤`
            : undefined,
        recommendation: downstreamBroken
          ? "先修復下游 provider 的 API key 或服務狀態"
          : recentErrors > 5
            ? "查看錯誤追蹤頁面找出最常見的失敗原因"
            : undefined,
        relatedFiles: r.files,
        metrics: { recentErrorCount: recentErrors || undefined },
      });
      for (const p of r.providers) {
        edges.push(makeEdge(r.id, `provider:${p}`, "外部呼叫"));
      }
    }

    // router → brain slot 連線（語意層）
    edges.push(makeEdge("router:director", "director:main"));
    edges.push(makeEdge("router:brain", "orb:agent"));
    edges.push(makeEdge("router:orbScheduler", "orb:agent"));
  }

  // ── Layer 1: Frontend Pages ──────────────────────────────────────────────
  if (opts.includeAllPages) {
    // 把所有頁面塞進一個群組節點，前端可選擇是否展開
    nodes.push({
      id: "page-group:all",
      kind: "page-group",
      layer: "frontend",
      label: `📱 前端頁面（${APP_PAGE_REGISTRY.length}）`,
      description: "全站頁面，點擊展開查看每頁的光球助手註冊狀態",
      status: "healthy",
      children: APP_PAGE_REGISTRY.map(p => `page:${p.id}`),
    });

    for (const page of APP_PAGE_REGISTRY) {
      const status: PipelineNodeStatus = page.supportsPageAgent
        ? "healthy"
        : "abnormal";
      nodes.push({
        id: `page:${page.id}`,
        kind: "page",
        layer: "frontend",
        label: page.label,
        description: `${page.path}｜${page.description}`,
        status,
        reason: page.supportsPageAgent
          ? undefined
          : "此頁尚未註冊光球助手 PageAgent",
        recommendation: page.supportsPageAgent
          ? undefined
          : "如需在此頁啟用助手，請於 shared/appRegistry.ts 把 supportsPageAgent 設為 true",
        relatedFiles: ["shared/appRegistry.ts"],
        parentId: "page-group:all",
      });
      // page → orb assistant
      edges.push(
        makeEdge(`page:${page.id}`, "orb:assistant", "PageAgent")
      );
    }
  }

  // ── 警報疊加：把 Active Alerts 反映到對應的 brain / engine 節點 ───────
  if (opts.includeAlerts) {
    const alerts = getAlerts(50);
    for (const alert of alerts) {
      if (alert.dismissedAt) continue;
      // 嘗試找到 alert 對應的節點（依 modelOrEngine 名稱比對）
      const targetId = nodes.find(
        n =>
          (n.kind === "brain-slot" || n.kind === "engine-slot") &&
          n.description?.includes(alert.engine ?? "")
      )?.id;
      if (!targetId) continue;
      const node = nodes.find(n => n.id === targetId)!;
      // 不 downgrade 已是 broken 的節點
      if (node.status === "healthy") {
        node.status = "needs_optimization";
        node.reason = alert.message;
        node.recommendation = "查看「警報中心」取得修復建議";
      }
    }
  }

  return {
    nodes,
    edges,
    summary: summarize(nodes),
    legend: buildLegend(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Router
// ═══════════════════════════════════════════════════════════════════════════

export const brainPipelineRouter = router({
  /** 全站完整管線（admin only） */
  getGraph: adminProcedure.query(() => {
    return buildGraph({
      includeAllPages: true,
      includeRouters: true,
      includeAlerts: true,
    });
  }),

  /** 個人版腦組態（任何登入用戶） */
  getMyGraph: protectedProcedure.query(() => {
    return buildGraph({
      includeAllPages: false,
      includeRouters: false,
      includeAlerts: false,
    });
  }),

  /** 取系統摘要（給 SummaryBar 用，比 getGraph 輕量） */
  getSummary: protectedProcedure.query(() => {
    return getSystemSummary();
  }),
});

// 提供測試用 helpers（不影響執行 router 行為）
export const __testing = {
  buildGraph,
  PROVIDERS,
  ROUTER_TO_PROVIDERS,
};
