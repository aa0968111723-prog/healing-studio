/**
 * orb-page-agent-registration.test.ts
 *
 * Contract tests for the page-agent registration layer:
 *
 * 1. Every entry in APP_PAGE_REGISTRY has required string fields.
 * 2. Pages with supportsPageAgent=true appear in GLOBAL_AGENT_CAPABILITY_REGISTRY.
 * 3. The tutorial-overview page is correctly registered (added in this fix cycle).
 * 4. GLOBAL_AGENT_CAPABILITY_REGISTRY has no duplicate capability IDs.
 * 5. All destructive capability action types expose a non-empty label.
 * 6. All core user-facing pages have supportsPageAgent=true.
 */

import { describe, expect, it } from "vitest";
import { APP_PAGE_REGISTRY } from "../shared/appRegistry";
import {
  GLOBAL_AGENT_CAPABILITY_REGISTRY,
  validateCapabilityRegistry,
} from "../shared/global-agent-capabilities";

// Destructive actions that must always have a non-empty label.
const DESTRUCTIVE_ACTION_TYPES = new Set(["submit", "reset", "applyPreset"]);

// Core pages that must have supportsPageAgent=true.
const REQUIRED_AGENT_PAGES: Array<{ id: string; path: string }> = [
  { id: "home", path: "/" },
  { id: "studio", path: "/studio" },
  { id: "director", path: "/director" },
  { id: "image-studio", path: "/image-studio" },
  { id: "video-studio", path: "/video-studio" },
  { id: "pro-studio", path: "/pro-studio" },
  { id: "tutorial-overview", path: "/tutorial" },
];

// ── APP_PAGE_REGISTRY ────────────────────────────────────────────────────────

describe("APP_PAGE_REGISTRY shape", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(APP_PAGE_REGISTRY)).toBe(true);
    expect(APP_PAGE_REGISTRY.length).toBeGreaterThan(0);
  });

  it("every entry has required string fields: id, label, path", () => {
    for (const entry of APP_PAGE_REGISTRY) {
      expect(typeof entry.id, `id missing in entry with label="${entry.label}"`).toBe("string");
      expect(entry.id.length, `empty id in entry with label="${entry.label}"`).toBeGreaterThan(0);
      expect(typeof entry.label, `label missing for id="${entry.id}"`).toBe("string");
      expect(entry.label.length, `empty label for id="${entry.id}"`).toBeGreaterThan(0);
      expect(typeof entry.path, `path missing for id="${entry.id}"`).toBe("string");
      expect(entry.path, `path must start with / for id="${entry.id}"`).toMatch(/^\//);
    }
  });

  it("every entry has a boolean supportsPageAgent field", () => {
    for (const entry of APP_PAGE_REGISTRY) {
      expect(typeof entry.supportsPageAgent, `supportsPageAgent must be boolean for id="${entry.id}"`).toBe("boolean");
    }
  });

  it("tutorial-overview is registered with correct path", () => {
    const found = APP_PAGE_REGISTRY.find(e => e.id === "tutorial-overview");
    expect(found, "tutorial-overview must be in APP_PAGE_REGISTRY").toBeDefined();
    expect(found?.path).toBe("/tutorial");
    expect(found?.supportsPageAgent).toBe(true);
  });

  it("each id is unique across the registry", () => {
    const ids = APP_PAGE_REGISTRY.map(e => e.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

// ── Required core pages ──────────────────────────────────────────────────────

describe("Core pages have supportsPageAgent=true", () => {
  for (const { id, path } of REQUIRED_AGENT_PAGES) {
    it(`${id} (${path}) has supportsPageAgent=true`, () => {
      const entry = APP_PAGE_REGISTRY.find(e => e.id === id);
      expect(entry, `${id} not found in APP_PAGE_REGISTRY`).toBeDefined();
      expect(entry?.supportsPageAgent, `${id} must have supportsPageAgent=true`).toBe(true);
    });
  }
});

// ── GLOBAL_AGENT_CAPABILITY_REGISTRY ────────────────────────────────────────

describe("GLOBAL_AGENT_CAPABILITY_REGISTRY", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(GLOBAL_AGENT_CAPABILITY_REGISTRY)).toBe(true);
    expect(GLOBAL_AGENT_CAPABILITY_REGISTRY.length).toBeGreaterThan(0);
  });

  it("has no duplicate capability IDs", () => {
    const { ok, duplicates } = validateCapabilityRegistry(GLOBAL_AGENT_CAPABILITY_REGISTRY);
    expect(duplicates, `Duplicate capability IDs found: ${duplicates.join(", ")}`).toHaveLength(0);
    expect(ok).toBe(true);
  });

  it("every entry has non-empty id, pageId, pagePath, actionType, label", () => {
    for (const cap of GLOBAL_AGENT_CAPABILITY_REGISTRY) {
      expect(cap.id.length, `empty id for cap "${cap.actionType}"`).toBeGreaterThan(0);
      expect(cap.pageId.length, `empty pageId for cap "${cap.id}"`).toBeGreaterThan(0);
      expect(cap.pagePath, `pagePath must start with / for cap "${cap.id}"`).toMatch(/^\//);
      expect(cap.actionType.length, `empty actionType for cap "${cap.id}"`).toBeGreaterThan(0);
      expect(cap.label.length, `empty label for cap "${cap.id}"`).toBeGreaterThan(0);
    }
  });

  it("destructive action types have requiresApproval=true", () => {
    for (const cap of GLOBAL_AGENT_CAPABILITY_REGISTRY) {
      if (DESTRUCTIVE_ACTION_TYPES.has(cap.actionType)) {
        expect(
          cap.requiresApproval,
          `${cap.id} (${cap.actionType}) must have requiresApproval=true`
        ).toBe(true);
      }
    }
  });

  it("includes capability entries for tutorial-overview", () => {
    const tutorialCaps = GLOBAL_AGENT_CAPABILITY_REGISTRY.filter(c => c.pageId === "tutorial-overview");
    expect(tutorialCaps.length, "tutorial-overview should have at least one capability").toBeGreaterThan(0);
  });

  it("every agent-supporting page has at least one capability entry", () => {
    const agentPages = APP_PAGE_REGISTRY.filter(p => p.supportsPageAgent);
    const capPageIds = new Set(GLOBAL_AGENT_CAPABILITY_REGISTRY.map(c => c.pageId));
    for (const page of agentPages) {
      expect(
        capPageIds.has(page.id),
        `${page.id} has supportsPageAgent=true but no entry in GLOBAL_AGENT_CAPABILITY_REGISTRY`
      ).toBe(true);
    }
  });
});
