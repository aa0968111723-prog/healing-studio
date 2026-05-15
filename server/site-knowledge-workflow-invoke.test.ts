/**
 * site-knowledge-workflow-invoke.test.ts
 *
 * Covers the `invokeWorkflowById` / `listInvocableWorkflows` bridge that
 * turns a static workflow template into a planner-friendly seed:
 *   - Returns null for unknown template IDs (no fake seeds).
 *   - Known IDs yield ordered step seeds preserving template metadata.
 *   - The catalog listing is non-empty and reports a step count per entry.
 */

import { describe, expect, it } from "vitest";
import {
  invokeWorkflowById,
  listInvocableWorkflows,
} from "../server/services/siteKnowledge";

describe("invokeWorkflowById", () => {
  it("returns null for an unknown template id", () => {
    expect(invokeWorkflowById("does-not-exist")).toBeNull();
  });

  it("projects a known template into ordered step seeds", () => {
    const seed = invokeWorkflowById("social-media-post");
    expect(seed).not.toBeNull();
    if (!seed) return;
    expect(seed.templateId).toBe("social-media-post");
    expect(seed.steps.length).toBeGreaterThanOrEqual(2);
    // First step seeds should preserve the spirit assignment from the template.
    expect(seed.steps[0].spirit).toBe("community-manager");
    // Dependency arrays must be present (possibly empty) for every step.
    for (const step of seed.steps) {
      expect(Array.isArray(step.dependsOn)).toBe(true);
      expect(Array.isArray(step.suggestedTools)).toBe(true);
      expect(typeof step.optional).toBe("boolean");
    }
    expect(seed.intent).toContain(seed.templateName);
  });

  it("preserves optional flag from the template", () => {
    const seed = invokeWorkflowById("video-creation-full");
    expect(seed).not.toBeNull();
    if (!seed) return;
    // The video-creation-full template marks `review` (and `add-voiceover`)
    // optional — make sure that propagates.
    const optionalStep = seed.steps.find(s => s.optional === true);
    expect(optionalStep).toBeDefined();
  });
});

describe("listInvocableWorkflows", () => {
  it("lists every catalog template with a step count", () => {
    const catalog = listInvocableWorkflows();
    expect(catalog.length).toBeGreaterThan(0);
    for (const entry of catalog) {
      expect(entry.templateId).toBeTruthy();
      expect(entry.name).toBeTruthy();
      expect(entry.stepCount).toBeGreaterThan(0);
    }
  });
});
