/**
 * agentScopeGuard.ts — AIDV-326 代理角色授權範圍
 *
 * Defines per-role action scopes so that a script/asset/voice agent cannot
 * invoke destructive operations (publish, delete) that only the orchestrator
 * or director roles should be allowed to perform.
 *
 * Usage (call at the start of any agent action handler):
 *   assertAgentScope("voice-specialist", "delete:project"); // throws AgentScopeViolation
 *   checkAgentScope("chief-orchestrator", "delete:project"); // true
 *
 * Design gate: pure in-memory, no DB/network, zero new backend dependencies.
 */

import type { AgentRole } from "../../shared/orb-agent-roles";

// ─── Scope action vocabulary ────────────────────────────────────────────────

export type AgentScopeAction =
  | "read:project"
  | "write:project"
  | "write:script"
  | "write:voice"
  | "write:image"
  | "write:video"
  | "write:music"
  | "write:asset"
  | "write:training"
  | "publish:project"
  | "delete:project"
  | "read:settings"
  | "write:settings"
  | "read:notes"
  | "write:notes";

// ─── Per-role scope map ─────────────────────────────────────────────────────
// Principle of least privilege: each role receives only what its primary task
// requires. Destructive actions (delete:project, publish:project) are
// restricted to the orchestrator and director because they affect shared state
// that other agents may be actively operating on.

const ROLE_SCOPES: Record<AgentRole, ReadonlyArray<AgentScopeAction>> = {
  // ── Orchestration / planning ──
  "chief-orchestrator": [
    "read:project",
    "write:project",
    "write:script",
    "write:voice",
    "write:image",
    "write:video",
    "write:music",
    "write:asset",
    "write:training",
    "publish:project",
    "delete:project",
    "read:settings",
    "write:settings",
    "read:notes",
    "write:notes",
  ],
  director: [
    "read:project",
    "write:project",
    "write:script",
    "publish:project",
    "delete:project",
    "read:notes",
    "write:notes",
  ],
  "plan-executor": [
    "read:project",
    "write:project",
    "write:script",
    "read:notes",
    "write:notes",
  ],
  composer: ["read:project", "write:script", "read:notes", "write:notes"],

  // ── Media specialists (write only their own output type) ──
  "image-specialist": ["read:project", "write:image", "write:asset"],
  "video-specialist": ["read:project", "write:video", "write:asset"],
  "music-specialist": ["read:project", "write:music", "write:asset"],
  "voice-specialist": ["read:project", "write:voice", "write:asset"],
  "training-specialist": ["read:project", "write:training", "write:asset"],

  // ── Knowledge / utility roles ──
  researcher: ["read:project", "read:notes"],
  critic: ["read:project", "read:notes"],
  navigator: ["read:project"],
  companion: ["read:project", "read:notes"],
  "learning-specialist": ["read:project", "read:notes"],
  "inspiration-specialist": ["read:project", "read:notes"],
  "anatomy-specialist": ["read:project", "read:notes"],

  // ── Proactive watchdog roles (read-only by design) ──
  accountant: ["read:project", "read:settings"],
  "quality-coach": ["read:project", "read:notes"],
  inspector: ["read:project", "read:settings"],
  "legal-advisor": ["read:project"],
  "security-guard": ["read:project", "read:settings"],
  "community-manager": ["read:project", "read:notes"],
  "onboarding-coach": ["read:project", "read:notes"],
  "notes-curator": ["read:notes", "write:notes"],
  "settings-detail": ["read:settings", "write:settings"],
};

// ─── Public API ─────────────────────────────────────────────────────────────

export class AgentScopeViolation extends Error {
  readonly agentRole: AgentRole;
  readonly action: AgentScopeAction;

  constructor(role: AgentRole, action: AgentScopeAction) {
    super(
      `Agent scope violation: role "${role}" is not permitted to perform "${action}"`
    );
    this.name = "AgentScopeViolation";
    this.agentRole = role;
    this.action = action;
  }
}

/**
 * Returns true if `role` is allowed to perform `action`.
 * Returns false for any unknown role (fail-closed).
 */
export function checkAgentScope(
  role: AgentRole,
  action: AgentScopeAction
): boolean {
  const scopes = ROLE_SCOPES[role];
  if (!scopes) return false; // unknown role → deny
  return (scopes as ReadonlyArray<string>).includes(action);
}

/**
 * Throws `AgentScopeViolation` if `role` may not perform `action`.
 * Call this at the start of any agent action handler to enforce scope.
 */
export function assertAgentScope(
  role: AgentRole,
  action: AgentScopeAction
): void {
  if (!checkAgentScope(role, action)) {
    throw new AgentScopeViolation(role, action);
  }
}

/** Convenience: get the full scope list for a role (useful for audit logs). */
export function getAgentScopes(
  role: AgentRole
): ReadonlyArray<AgentScopeAction> {
  return ROLE_SCOPES[role] ?? [];
}
