/*
 * shared/global-agent-registry.ts
 * ───────────────────────────────────────────────────────────────
 * True site-wide AI agent registry for the Orb / AI Director.
 *
 * This module stores every page's declared PageAgentSnapshot, so the Orb can
 * reason about the whole site instead of only the currently mounted page.
 */

import type { AgentAction, AgentActionType, PageAgentSnapshot } from "./agent-actions";

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
}

export const globalAgentRegistry = new GlobalAgentRegistry();
