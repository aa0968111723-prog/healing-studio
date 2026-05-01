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
