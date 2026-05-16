/*
 * shared/global-agent-registry.ts
 * ───────────────────────────────────────────────────────────────
 * True site-wide AI agent registry for the Orb / AI Director.
 *
 * This module stores every page's declared PageAgentSnapshot, so the Orb can
 * reason about the whole site instead of only the currently mounted page.
 */

import type { AgentAction, AgentActionType, PageAgentSnapshot } from "./agent-actions";
import { APP_PAGE_REGISTRY, type AppPageRegistryItem } from "./appRegistry";
import { GLOBAL_AGENT_CAPABILITY_REGISTRY } from "./global-agent-capabilities";

/**
 * 偵測 dynamic snapshot 與 static APP_PAGE_REGISTRY 漂移。一頁要嘛兩邊都
 * 有(snapshot 對得到 registry 的 pageId 與 pagePath)、要嘛 registry 沒
 * 宣告(代表那頁不在站內導覽範圍,例如外掛/實驗頁)。任何「同 pageId 但
 * 路徑對不上」「snapshot 宣告 pageAgent 卻在 registry 設 supportsPageAgent
 * = false」的情況都會回傳一個 reason string,呼叫端決定要 warn / throw /
 * telemetry。
 *
 * 純函式,沒有 side effect,允許 client/server/test 任一處呼叫。
 */
export type SnapshotDriftReason =
  | "pageId-not-in-registry"
  | "pagePath-mismatch"
  | "pageAgent-disabled-in-registry";

export interface SnapshotDriftFinding {
  reason: SnapshotDriftReason;
  pageId: string;
  snapshotPath: string;
  registryPath?: string;
}

export function detectSnapshotDrift(
  snapshot: PageAgentSnapshot
): SnapshotDriftFinding | null {
  const registryItem = APP_PAGE_REGISTRY.find(
    page => page.id === snapshot.pageId
  );
  if (!registryItem) {
    return {
      reason: "pageId-not-in-registry",
      pageId: snapshot.pageId,
      snapshotPath: snapshot.pagePath,
    };
  }
  if (registryItem.path !== snapshot.pagePath) {
    return {
      reason: "pagePath-mismatch",
      pageId: snapshot.pageId,
      snapshotPath: snapshot.pagePath,
      registryPath: registryItem.path,
    };
  }
  if (!registryItem.supportsPageAgent) {
    return {
      reason: "pageAgent-disabled-in-registry",
      pageId: snapshot.pageId,
      snapshotPath: snapshot.pagePath,
      registryPath: registryItem.path,
    };
  }
  return null;
}

function formatDriftMessage(finding: SnapshotDriftFinding): string {
  switch (finding.reason) {
    case "pageId-not-in-registry":
      return `[global-agent-registry] snapshot 註冊 pageId="${finding.pageId}" (path="${finding.snapshotPath}") 但 APP_PAGE_REGISTRY 沒有對應條目 — orb 的 static fallback 路由將找不到這頁。請在 shared/appRegistry.ts 補一筆 AppPageRegistryItem。`;
    case "pagePath-mismatch":
      return `[global-agent-registry] snapshot pageId="${finding.pageId}" 宣告 path="${finding.snapshotPath}",但 APP_PAGE_REGISTRY 同 id 的條目 path="${finding.registryPath}" — 兩邊對不上會讓 navigate 動作落到不同頁面。`;
    case "pageAgent-disabled-in-registry":
      return `[global-agent-registry] snapshot pageId="${finding.pageId}" 想啟用 page agent,但 APP_PAGE_REGISTRY 把 supportsPageAgent 設成 false — 站內導覽不會把這頁列為可派送目標。`;
  }
}

/**
 * Dev 模式回報 drift(用 console.warn,不 throw),production 沉默 — 寧可
 * 讓使用者繼續用、由觀測系統收尾,也不要因為一頁註冊不一致而炸整個 app。
 * 測試可呼叫 detectSnapshotDrift() 直接拿結果做嚴格斷言。
 */
function reportSnapshotDrift(snapshot: PageAgentSnapshot): void {
  // process.env 在 client bundle 會由 Vite 注入 NODE_ENV,server 直接讀
  // node 的 env。兩邊都不是 production 才真的印,避免 prod 噪音。
  const env =
    typeof process !== "undefined" && process.env
      ? process.env.NODE_ENV
      : undefined;
  if (env === "production") return;
  const finding = detectSnapshotDrift(snapshot);
  if (!finding) return;
  if (typeof console !== "undefined" && typeof console.warn === "function") {
    console.warn(formatDriftMessage(finding));
  }
}

export interface GlobalAgentPlanStep {
  path?: string;
  targetPageId?: string;
  action: AgentAction;
  label?: string;
}

export interface GlobalAgentPlan {
  reason: string;
  steps: GlobalAgentPlanStep[];
}

export interface GlobalAgentRouteCandidate {
  snapshot: PageAgentSnapshot;
  score: number;
  reasons: string[];
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function actionPayloadText(action: AgentAction): string {
  switch (action.type) {
    case "fillPrompt":
      return action.text;
    case "setModel":
      return action.modelId;
    case "setTab":
      return action.tabId;
    case "setMode":
      return action.modeId;
    case "setModality":
      return action.modality;
    case "setParam":
      return `${action.key} ${JSON.stringify(action.value)}`;
    case "applyPreset":
      return action.presetId;
    case "navigate":
      return action.path;
    case "focusElement":
      return `${action.elementId} ${action.message ?? ""}`;
    case "openDialog":
      return `${action.dialogId} ${JSON.stringify(action.params ?? {})}`;
    case "search":
      return action.query;
    case "toggleSetting":
      return `${action.key} ${String(action.value ?? "")}`;
    case "runWorkflow":
      return `${action.name} ${action.steps.map(step => `${step.path ?? ""} ${step.actionType} ${step.payload} ${step.label}`).join(" ")}`;
    case "submit":
    case "reset":
      return action.type;
    default:
      return "";
  }
}

function pageSearchText(snapshot: PageAgentSnapshot): string {
  return [
    snapshot.pageId,
    snapshot.pageLabel,
    snapshot.pagePath,
    snapshot.capabilities.map(cap => [
      cap.action,
      cap.label,
      cap.hint,
      cap.currentId,
      cap.options?.map(option => `${option.id} ${option.label} ${option.description ?? ""}`).join(" ") ?? "",
    ].join(" ")).join(" "),
  ].join(" ").toLowerCase();
}

export class GlobalAgentRegistry {
  private pages = new Map<string, PageAgentSnapshot>();

  register(snapshot: PageAgentSnapshot): void {
    reportSnapshotDrift(snapshot);
    this.pages.set(snapshot.pageId, snapshot);
  }

  unregister(pageId: string): void {
    this.pages.delete(pageId);
  }

  clear(): void {
    this.pages.clear();
  }

  list(): PageAgentSnapshot[] {
    return Array.from(this.pages.values());
  }

  get(pageId: string): PageAgentSnapshot | undefined {
    return this.pages.get(pageId);
  }

  findByPath(path: string): PageAgentSnapshot | undefined {
    return this.list().find(snapshot => snapshot.pagePath === path);
  }

  findSupportingPages(actionType: AgentActionType | string): PageAgentSnapshot[] {
    return this.list().filter(snapshot =>
      snapshot.capabilities.some(capability => capability.action === actionType)
    );
  }

  rankPagesForAction(action: AgentAction): GlobalAgentRouteCandidate[] {
    const payload = normalizeText(actionPayloadText(action));
    const payloadTokens = payload.split(/[\s,，。:：/|]+/).filter(token => token.length >= 2);

    return this.list()
      .map(snapshot => {
        let score = 0;
        const reasons: string[] = [];
        const matchingCapabilities = snapshot.capabilities.filter(cap => cap.action === action.type);
        if (matchingCapabilities.length > 0) {
          score += 50;
          reasons.push(`supports:${action.type}`);
        }

        const haystack = pageSearchText(snapshot);
        for (const token of payloadTokens.slice(0, 12)) {
          if (haystack.includes(token)) {
            score += 5;
            reasons.push(`match:${token}`);
          }
        }

        if (action.type === "setModality" && haystack.includes(action.modality)) {
          score += 20;
          reasons.push(`modality:${action.modality}`);
        }

        if (action.type === "navigate" && snapshot.pagePath === action.path) {
          score += 100;
          reasons.push("exact-path");
        }

        return { snapshot, score, reasons };
      })
      .filter(candidate => candidate.score > 0)
      .sort((a, b) => b.score - a.score);
  }

  plan(action: AgentAction, currentPage?: PageAgentSnapshot | null): GlobalAgentPlan | null {
    if (action.type === "navigate") {
      return {
        reason: `Navigate directly to ${action.path}`,
        steps: [{ path: action.path, action, label: "navigate" }],
      };
    }

    if (currentPage?.capabilities.some(cap => cap.action === action.type)) {
      return {
        reason: `Use current page ${currentPage.pageLabel}`,
        steps: [{ targetPageId: currentPage.pageId, action, label: currentPage.pageLabel }],
      };
    }

    const [best] = this.rankPagesForAction(action);
    if (!best) return null;

    return {
      reason: `Route to ${best.snapshot.pageLabel} (${best.reasons.join(", ")})`,
      steps: [
        {
          path: best.snapshot.pagePath,
          targetPageId: best.snapshot.pageId,
          action,
          label: best.snapshot.pageLabel,
        },
      ],
    };
  }

  /**
   * Resolve a route using the static capability registry — the union of every
   * page that *could* support an action when mounted. Used as a fallback when
   * `plan()` returns null because the live registry only knows about the
   * currently-mounted page (the orb's host page on `/agent`). Without this
   * fallback, single actions like fillPrompt / setModality / submit emitted
   * by the planner from `/agent` surface as "no route found" instead of
   * navigating to the right studio.
   *
   * Ranking heuristic:
   *   - candidates must support the action type per GLOBAL_AGENT_CAPABILITY_REGISTRY
   *   - boost when payload tokens (split by whitespace/punct) appear in the
   *     page's haystack OR when an alias/label appears in the payload (covers
   *     Chinese without segmentation)
   *   - extra boost for setModality whose modality keyword matches an alias
   *   - tiebreak by agentEntryPriority (lower = more important)
   */
  resolveStaticFallback(action: AgentAction): GlobalAgentPlan | null {
    if (action.type === "navigate") {
      return {
        reason: `Navigate directly to ${action.path}`,
        steps: [{ path: action.path, action, label: "navigate" }],
      };
    }

    // Prefer pages that explicitly declare this action in their
    // `supportedActions` audit (the source of truth for what each page's
    // useRegisterPageAgent handler actually implements). Falling back to
    // the generic capability registry would let setModality route to
    // /image-studio etc., which has no setModality case and silently
    // fails. Only when no page declares the action do we widen to the
    // capability registry to preserve coverage for actions whose audit
    // hasn't been filled in.
    const declared = APP_PAGE_REGISTRY.filter(
      page => page.supportsPageAgent && page.supportedActions.includes(action.type)
    );
    const supporting = declared.length > 0
      ? declared.map(page => ({
          pageId: page.id,
          pagePath: page.path,
          actionType: action.type,
          enabled: true,
        }))
      : GLOBAL_AGENT_CAPABILITY_REGISTRY.filter(
          cap => cap.enabled && cap.actionType === action.type
        );
    if (supporting.length === 0) return null;

    const payload = normalizeText(actionPayloadText(action));
    const payloadTokens = payload
      .split(/[\s,，。:：/|]+/)
      .filter(token => token.length >= 2);

    type Scored = {
      page: AppPageRegistryItem;
      score: number;
      reasons: string[];
    };
    const scored: Scored[] = [];
    const seen = new Set<string>();

    for (const capability of supporting) {
      if (seen.has(capability.pageId)) continue;
      seen.add(capability.pageId);

      const page = APP_PAGE_REGISTRY.find(p => p.id === capability.pageId);
      if (!page) continue;

      // /studio's narrow handler semantics: the unified studio page
      // exposes applyPreset / setModel cases, so its supportedActions
      // includes them — but the handler only accepts:
      //   - applyPreset id starting with "creative:" (creative-mode levels)
      //   - setModel modelId that's a positive integer (LoRA fine-tune ID)
      // Anything else (e.g. applyPreset:vibe-cinematic, setModel:imagen)
      // is rejected with "unknown presetId" / "setModel 需要正整數". The
      // static fallback can't validate payload shape per page in general,
      // but for /studio we know enough to skip when the payload won't
      // fit. Without this gate, /studio's lower priority number (2) wins
      // the tiebreak over /image-studio (3) for vibe-style presets and
      // string model IDs, dispatch fails silently, and the orb's
      // multi-step plan stalls one step in.
      if (page.id === "studio") {
        if (action.type === "applyPreset" && !action.presetId.startsWith("creative:")) {
          continue;
        }
        if (action.type === "setModel" && !/^\d+$/.test(action.modelId)) {
          continue;
        }
      }

      const haystack = pageRegistryHaystack(page);
      let score = 1; // baseline: action-type match always beats no candidate
      const reasons: string[] = [`supports:${action.type}`];

      for (const token of payloadTokens.slice(0, 12)) {
        if (haystack.includes(token)) {
          score += 5;
          reasons.push(`token:${token}`);
        }
      }

      // Reverse direction: catch Chinese payloads where the whole sentence is
      // one token but a 2+ char alias/label is a substring (e.g. "幫我做一張
      // 圖片" contains alias "圖片").
      const aliases = [
        page.label,
        page.id,
        ...page.aliases,
      ].map(s => s.toLowerCase()).filter(s => s.length >= 2);
      for (const alias of aliases) {
        if (payload.includes(alias)) {
          score += 6;
          reasons.push(`alias:${alias}`);
        }
      }

      if (action.type === "setModality") {
        const modality = action.modality.toLowerCase();
        if (haystack.includes(modality)) {
          score += 30;
          reasons.push(`modality:${modality}`);
        }
      }

      // Lower agentEntryPriority = more important. Apply a small bonus
      // (max +1) so it only breaks ties between equally-good text matches.
      const priorityBonus = Math.max(0, Math.min(100, 100 - page.agentEntryPriority)) / 100;
      score += priorityBonus;

      scored.push({ page, score, reasons });
    }

    if (scored.length === 0) return null;
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];

    return {
      reason: `Static fallback to ${best.page.label} (${best.reasons.join(", ")})`,
      steps: [
        {
          path: best.page.path,
          targetPageId: best.page.id,
          action,
          label: best.page.label,
        },
      ],
    };
  }

  /**
   * `plan()` first; if no live page matches, fall back to the static
   * capability registry so a single action emitted from `/agent` (where only
   * the orb host page is registered) still finds a destination.
   */
  planWithFallback(
    action: AgentAction,
    currentPage?: PageAgentSnapshot | null
  ): GlobalAgentPlan | null {
    const live = this.plan(action, currentPage);
    if (live) return live;
    return this.resolveStaticFallback(action);
  }
}

function pageRegistryHaystack(page: AppPageRegistryItem): string {
  return [
    page.id,
    page.label,
    page.path,
    page.description,
    page.aliases.join(" "),
    page.orbHints.join(" "),
    page.quickActions
      .map(qa => `${qa.id} ${qa.label} ${qa.description ?? ""} ${qa.prompt ?? ""}`)
      .join(" "),
  ]
    .join(" ")
    .toLowerCase();
}

export const globalAgentRegistry = new GlobalAgentRegistry();
