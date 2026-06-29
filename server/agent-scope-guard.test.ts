/**
 * agent-scope-guard.test.ts — AIDV-326 代理角色授權範圍測試
 *
 * Tests three authorization branches:
 *   1. Specialist agents (script/asset/voice) CANNOT publish or delete projects
 *   2. Orchestrator/Director CAN publish and delete projects
 *   3. Unknown/unregistered action combinations are denied (fail-closed)
 */

import { describe, it, expect } from "vitest";
import {
  checkAgentScope,
  assertAgentScope,
  getAgentScopes,
  AgentScopeViolation,
} from "./_core/agentScopeGuard";

// ─── Branch 1: Specialist agents cannot publish/delete ────────────────────
describe("specialist agents — publish/delete denied", () => {
  const specialists = [
    "voice-specialist",
    "image-specialist",
    "video-specialist",
    "music-specialist",
    "training-specialist",
  ] as const;

  for (const role of specialists) {
    it(`${role}: cannot publish:project`, () => {
      expect(checkAgentScope(role, "publish:project")).toBe(false);
    });

    it(`${role}: cannot delete:project`, () => {
      expect(checkAgentScope(role, "delete:project")).toBe(false);
    });
  }

  it("voice-specialist CAN write:voice", () => {
    expect(checkAgentScope("voice-specialist", "write:voice")).toBe(true);
  });

  it("image-specialist CAN write:image", () => {
    expect(checkAgentScope("image-specialist", "write:image")).toBe(true);
  });

  it("composer CAN write:script but NOT publish:project", () => {
    expect(checkAgentScope("composer", "write:script")).toBe(true);
    expect(checkAgentScope("composer", "publish:project")).toBe(false);
  });
});

// ─── Branch 2: Orchestrator/Director have destructive scope ──────────────
describe("orchestrator and director — full destructive scope", () => {
  it("chief-orchestrator CAN publish:project", () => {
    expect(checkAgentScope("chief-orchestrator", "publish:project")).toBe(true);
  });

  it("chief-orchestrator CAN delete:project", () => {
    expect(checkAgentScope("chief-orchestrator", "delete:project")).toBe(true);
  });

  it("director CAN publish:project", () => {
    expect(checkAgentScope("director", "publish:project")).toBe(true);
  });

  it("director CAN delete:project", () => {
    expect(checkAgentScope("director", "delete:project")).toBe(true);
  });

  it("plan-executor CANNOT delete:project", () => {
    expect(checkAgentScope("plan-executor", "delete:project")).toBe(false);
  });
});

// ─── Branch 3: assertAgentScope throws on violation ──────────────────────
describe("assertAgentScope — throws AgentScopeViolation on denial", () => {
  it("throws when voice-specialist tries to delete:project", () => {
    expect(() =>
      assertAgentScope("voice-specialist", "delete:project")
    ).toThrow(AgentScopeViolation);
  });

  it("thrown error carries role and action", () => {
    try {
      assertAgentScope("researcher", "write:project");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AgentScopeViolation);
      const e = err as AgentScopeViolation;
      expect(e.agentRole).toBe("researcher");
      expect(e.action).toBe("write:project");
    }
  });

  it("does NOT throw when chief-orchestrator deletes:project", () => {
    expect(() =>
      assertAgentScope("chief-orchestrator", "delete:project")
    ).not.toThrow();
  });
});

// ─── Watchdog roles — read-only access ───────────────────────────────────
describe("watchdog/proactive roles — read-only", () => {
  const readOnlyRoles = [
    "accountant",
    "inspector",
    "legal-advisor",
    "security-guard",
  ] as const;

  for (const role of readOnlyRoles) {
    it(`${role}: cannot write:project`, () => {
      expect(checkAgentScope(role, "write:project")).toBe(false);
    });
  }
});

// ─── getAgentScopes utility ───────────────────────────────────────────────
describe("getAgentScopes", () => {
  it("returns non-empty scopes for chief-orchestrator", () => {
    const scopes = getAgentScopes("chief-orchestrator");
    expect(scopes.length).toBeGreaterThan(5);
    expect(scopes).toContain("delete:project");
  });

  it("returns read:project for researcher", () => {
    expect(getAgentScopes("researcher")).toContain("read:project");
    expect(getAgentScopes("researcher")).not.toContain("write:project");
  });
});
