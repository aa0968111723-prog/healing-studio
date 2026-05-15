/**
 * Unit tests for the upgraded 細細 (settings-detail) agent tools.
 *
 * Covers the pure / sync functions plus the autonomous capabilities. The
 * DB-touching surfaces (getPreferences / updatePreference / bulkUpdate /
 * applyPreset / resetPreference / previewDiff / detectInconsistencies /
 * recommendOptimizations) are tested against mocked db + logger modules so
 * the suite stays hermetic and fast.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Hermetic mocks ─────────────────────────────────────────────────────────

vi.mock("../../../server/_core/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

interface FakeRow extends Record<string, unknown> {
  userId: number;
}
const fakeState: { rows: Map<number, FakeRow> } = { rows: new Map() };

vi.mock("../../../server/db", () => {
  // Drizzle's fluent query builder is faked just enough to satisfy the
  // production codepaths used by settingsDetailTools.
  const makeDb = () => ({
    select: (cols?: Record<string, unknown>) => ({
      from: (_table: unknown) => ({
        where: (_pred: unknown) => ({
          limit: async (_n: number) => {
            const row = fakeState.rows.get(currentUserId);
            if (!row) return [];
            if (cols) {
              // partial projection (used by ensurePreferencesRow)
              const projected: Record<string, unknown> = {};
              for (const key of Object.keys(cols)) projected[key] = row[key];
              return [projected];
            }
            return [row];
          },
        }),
      }),
    }),
    insert: (_table: unknown) => ({
      values: async (vals: Record<string, unknown>) => {
        fakeState.rows.set(vals.userId as number, { ...vals } as FakeRow);
      },
    }),
    update: (_table: unknown) => ({
      set: (vals: Record<string, unknown>) => ({
        where: async (_pred: unknown) => {
          const row = fakeState.rows.get(currentUserId);
          if (!row) return;
          fakeState.rows.set(currentUserId, { ...row, ...vals });
        },
      }),
    }),
  });

  return {
    getDb: async () => makeDb(),
  };
});

// userId in scope of the current call — the fake .where matcher uses it.
let currentUserId = 1;

import {
  getPreferences,
  updatePreference,
  explainSetting,
  getAllSettings,
  validatePreference,
  bulkUpdatePreferences,
  previewPreferenceDiff,
  applyPreset,
  listPresets,
  resetPreference,
  searchSettings,
  detectInconsistencies,
  recommendOptimizations,
} from "../../../server/services/spiritTools/settingsDetailTools";
import { DEFAULT_AGENT_PREFERENCES } from "../../../shared/agent-preferences";

beforeEach(() => {
  currentUserId = 1;
  fakeState.rows = new Map();
  // Seed with the canonical defaults so getPreferences returns a clean
  // baseline.
  fakeState.rows.set(1, {
    userId: 1,
    ...(DEFAULT_AGENT_PREFERENCES as Record<string, unknown>),
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("explainSetting / getAllSettings (schema visibility)", () => {
  it("covers all the canonical agent_preferences keys (>= 20)", () => {
    const { settings } = getAllSettings();
    expect(settings.length).toBeGreaterThanOrEqual(20);
    // sanity — a couple of well-known keys must be present
    const keys = settings.map(s => s.key);
    expect(keys).toContain("confirmationPolicy");
    expect(keys).toContain("autoApproveTools");
    expect(keys).toContain("blockedTools");
    expect(keys).toContain("stayOnPageMode");
    expect(keys).toContain("perceptionStrictness");
    expect(keys).toContain("orbProactiveSuggestions");
  });

  it("every getAllSettings key has a matching explanation", () => {
    const { settings } = getAllSettings();
    for (const s of settings) {
      const e = explainSetting(s.key);
      expect(e.found).toBe(true);
      expect(e.explanation?.title).toBe(s.title);
      expect(Array.isArray(e.explanation?.sideEffects)).toBe(true);
    }
  });

  it("unknown key returns found:false", () => {
    expect(explainSetting("nonexistentSetting").found).toBe(false);
  });
});

describe("validatePreference", () => {
  it("accepts a valid enum value", () => {
    expect(validatePreference("confirmationPolicy", "confirm_all").valid).toBe(true);
  });
  it("rejects an invalid enum value with a suggestion", () => {
    const r = validatePreference("confirmationPolicy", "never");
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/必須是/);
  });
  it("rejects wrong-typed boolean", () => {
    expect(validatePreference("notifyOnError", "yes").valid).toBe(false);
  });
  it("accepts null for boolean-nullable orbAgentEnabled", () => {
    expect(validatePreference("orbAgentEnabled", null).valid).toBe(true);
    expect(validatePreference("orbAgentEnabled", true).valid).toBe(true);
  });
  it("rejects number outside bounds", () => {
    expect(validatePreference("maxAutoStepsPerTask", 0).valid).toBe(false);
    expect(validatePreference("maxAutoStepsPerTask", 100).valid).toBe(false);
    expect(validatePreference("maxAutoStepsPerTask", 5).valid).toBe(true);
  });
  it("validates allowedRiskLevels enum-bounded array", () => {
    expect(validatePreference("allowedRiskLevels", ["low", "medium"]).valid).toBe(true);
    expect(validatePreference("allowedRiskLevels", ["low", "nuclear"]).valid).toBe(false);
  });
  it("rejects autoApproveTools that is not an array", () => {
    expect(validatePreference("autoApproveTools", "studio.*").valid).toBe(false);
    expect(validatePreference("autoApproveTools", ["research.deepSearch"]).valid).toBe(true);
  });
  it("rejects unknown key", () => {
    expect(validatePreference("notAKey", true).valid).toBe(false);
  });
});

describe("getPreferences", () => {
  it("returns every schema key from the seeded row", async () => {
    const r = await getPreferences(1);
    expect(r.success).toBe(true);
    expect(r.preferences.confirmationPolicy).toBe(
      DEFAULT_AGENT_PREFERENCES.confirmationPolicy,
    );
    expect(r.preferences.notifyOnError).toBe(true);
    expect(Array.isArray(r.preferences.autoApproveTools)).toBe(true);
    expect("hasUserRecord" in r.preferences).toBe(true);
  });
});

describe("updatePreference", () => {
  it("rejects unknown key without touching the db", async () => {
    const r = await updatePreference({ userId: 1, key: "totallyMadeUp", value: 1 });
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/不支援/);
  });
  it("rejects invalid value via validator", async () => {
    const r = await updatePreference({ userId: 1, key: "maxAutoStepsPerTask", value: 99 });
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/不能大於/);
  });
  it("persists a valid update", async () => {
    const r = await updatePreference({ userId: 1, key: "maxAutoStepsPerTask", value: 8 });
    expect(r.success).toBe(true);
    const after = await getPreferences(1);
    expect(after.preferences.maxAutoStepsPerTask).toBe(8);
  });
});

describe("bulkUpdatePreferences (all-or-nothing)", () => {
  it("writes nothing when any item fails validation", async () => {
    const before = await getPreferences(1);
    const r = await bulkUpdatePreferences({
      userId: 1,
      items: [
        { key: "maxAutoStepsPerTask", value: 7 }, // valid
        { key: "confirmationPolicy", value: "never" }, // invalid
      ],
    });
    expect(r.success).toBe(false);
    expect(r.applied).toEqual([]);
    expect(r.failed).toHaveLength(1);
    const after = await getPreferences(1);
    // valid item should NOT have been applied either (atomic semantics)
    expect(after.preferences.maxAutoStepsPerTask).toBe(
      before.preferences.maxAutoStepsPerTask,
    );
  });

  it("applies all when every item is valid", async () => {
    const r = await bulkUpdatePreferences({
      userId: 1,
      items: [
        { key: "maxAutoStepsPerTask", value: 9 },
        { key: "criticEnabled", value: true },
      ],
    });
    expect(r.success).toBe(true);
    expect(r.applied.sort()).toEqual(["criticEnabled", "maxAutoStepsPerTask"]);
    const after = await getPreferences(1);
    expect(after.preferences.maxAutoStepsPerTask).toBe(9);
    expect(after.preferences.criticEnabled).toBe(true);
  });

  it("rejects empty items list", async () => {
    const r = await bulkUpdatePreferences({ userId: 1, items: [] });
    expect(r.success).toBe(false);
  });
});

describe("previewPreferenceDiff", () => {
  it("returns before/after without persisting", async () => {
    const before = await getPreferences(1);
    const r = await previewPreferenceDiff({
      userId: 1,
      items: [{ key: "criticEnabled", value: true }],
    });
    expect(r.diff).toHaveLength(1);
    expect(r.diff[0]).toMatchObject({
      key: "criticEnabled",
      before: false,
      after: true,
      changed: true,
    });
    const after = await getPreferences(1);
    expect(after.preferences.criticEnabled).toBe(before.preferences.criticEnabled);
  });

  it("flags invalid items separately from the diff", async () => {
    const r = await previewPreferenceDiff({
      userId: 1,
      items: [
        { key: "criticEnabled", value: true },
        { key: "confirmationPolicy", value: "garbage" },
      ],
    });
    expect(r.diff).toHaveLength(1);
    expect(r.invalid).toHaveLength(1);
    expect(r.invalid[0].key).toBe("confirmationPolicy");
  });
});

describe("applyPreset / listPresets", () => {
  it("lists all 5 built-in presets", () => {
    const { presets } = listPresets();
    expect(presets.map(p => p.id).sort()).toEqual([
      "autopilot",
      "balanced",
      "cautious",
      "focused",
      "quiet",
    ]);
  });

  it("applying autopilot sets confirmationPolicy=always_approve and stayOnPageMode=true", async () => {
    const r = await applyPreset({ userId: 1, presetId: "autopilot" });
    expect(r.success).toBe(true);
    const after = await getPreferences(1);
    expect(after.preferences.confirmationPolicy).toBe("always_approve");
    expect(after.preferences.stayOnPageMode).toBe(true);
    expect(after.preferences.maxAutoStepsPerTask).toBe(15);
  });

  it("applying cautious raises critic & lowers steps", async () => {
    const r = await applyPreset({ userId: 1, presetId: "cautious" });
    expect(r.success).toBe(true);
    const after = await getPreferences(1);
    expect(after.preferences.confirmationPolicy).toBe("confirm_all");
    expect(after.preferences.criticEnabled).toBe(true);
    expect(after.preferences.maxAutoStepsPerTask).toBe(3);
  });

  it("rejects unknown preset id without touching state", async () => {
    const before = await getPreferences(1);
    const r = await applyPreset({ userId: 1, presetId: "doesNotExist" });
    expect(r.success).toBe(false);
    const after = await getPreferences(1);
    expect(after.preferences.confirmationPolicy).toBe(
      before.preferences.confirmationPolicy,
    );
  });
});

describe("resetPreference", () => {
  it("resets a key back to its schema default", async () => {
    await updatePreference({ userId: 1, key: "maxAutoStepsPerTask", value: 12 });
    const r = await resetPreference({ userId: 1, key: "maxAutoStepsPerTask" });
    expect(r.success).toBe(true);
    expect(r.resetTo).toBe(DEFAULT_AGENT_PREFERENCES.maxAutoStepsPerTask);
    const after = await getPreferences(1);
    expect(after.preferences.maxAutoStepsPerTask).toBe(
      DEFAULT_AGENT_PREFERENCES.maxAutoStepsPerTask,
    );
  });

  it("rejects unknown key", async () => {
    const r = await resetPreference({ userId: 1, key: "noSuchKey" });
    expect(r.success).toBe(false);
  });
});

describe("searchSettings (natural language)", () => {
  it("finds confirmationPolicy from '確認' query", () => {
    const r = searchSettings("確認");
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.matches.map(m => m.key)).toContain("confirmationPolicy");
  });
  it("finds voice settings from 'TTS' query", () => {
    const r = searchSettings("TTS");
    expect(r.matches.map(m => m.key)).toContain("voiceEnabled");
  });
  it("finds settings from English 'shortcut'", () => {
    const r = searchSettings("shortcut");
    expect(r.matches.map(m => m.key)).toContain("orbShortcutEnabled");
  });
  it("empty query returns no matches", () => {
    expect(searchSettings("").matches).toEqual([]);
    expect(searchSettings("   ").matches).toEqual([]);
  });
});

describe("detectInconsistencies", () => {
  it("flags overlapping autoApproveTools and blockedTools", async () => {
    await bulkUpdatePreferences({
      userId: 1,
      items: [
        { key: "autoApproveTools", value: ["studio.generateImage", "research.deepSearch"] },
        { key: "blockedTools", value: ["studio.generateImage"] },
      ],
    });
    const r = await detectInconsistencies(1);
    expect(r.success).toBe(true);
    const issue = r.inconsistencies.find(i =>
      i.keys.includes("autoApproveTools") && i.keys.includes("blockedTools"),
    );
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("error");
    expect(issue?.fixSuggestion).toBeDefined();
  });

  it("flags always_approve + notifyOnError=false as error", async () => {
    await bulkUpdatePreferences({
      userId: 1,
      items: [
        { key: "confirmationPolicy", value: "always_approve" },
        { key: "notifyOnError", value: false },
      ],
    });
    const r = await detectInconsistencies(1);
    const issue = r.inconsistencies.find(i => i.keys.includes("notifyOnError"));
    expect(issue?.severity).toBe("error");
  });

  it("flags always_approve + allowedRiskLevels includes high", async () => {
    await bulkUpdatePreferences({
      userId: 1,
      items: [
        { key: "confirmationPolicy", value: "always_approve" },
        { key: "allowedRiskLevels", value: ["low", "medium", "high"] },
      ],
    });
    const r = await detectInconsistencies(1);
    const issue = r.inconsistencies.find(i =>
      i.keys.includes("allowedRiskLevels"),
    );
    expect(issue?.severity).toBe("error");
  });

  it("flags muted spirit also in favorites as warning", async () => {
    await bulkUpdatePreferences({
      userId: 1,
      items: [
        { key: "mutedSpirits", value: ["accountant"] },
        { key: "favoriteSpirits", value: ["accountant", "inspector"] },
      ],
    });
    const r = await detectInconsistencies(1);
    const issue = r.inconsistencies.find(i => i.keys.includes("mutedSpirits"));
    expect(issue?.severity).toBe("warning");
  });

  it("returns no issues on a clean default state", async () => {
    const r = await detectInconsistencies(1);
    expect(r.inconsistencies).toHaveLength(0);
  });
});

describe("recommendOptimizations", () => {
  it("recommends enabling notifyOnError when it's off", async () => {
    await updatePreference({ userId: 1, key: "notifyOnError", value: false });
    const r = await recommendOptimizations(1);
    const rec = r.recommendations.find(x => x.id === "enable-error-notification");
    expect(rec).toBeDefined();
    expect(rec?.changes[0]).toEqual({ key: "notifyOnError", value: true });
  });

  it("recommends raising auto steps when always_approve + steps < 5", async () => {
    await bulkUpdatePreferences({
      userId: 1,
      items: [
        { key: "confirmationPolicy", value: "always_approve" },
        { key: "maxAutoStepsPerTask", value: 3 },
      ],
    });
    const r = await recommendOptimizations(1);
    expect(r.recommendations.find(x => x.id === "raise-auto-steps")).toBeDefined();
  });

  it("seeds auto-approve list when empty and policy is confirm_high_risk", async () => {
    const r = await recommendOptimizations(1);
    const seed = r.recommendations.find(x => x.id === "seed-auto-approve");
    expect(seed).toBeDefined();
    expect(seed?.changes[0].value).toEqual([
      "research.deepSearch",
      "inspiration.fetch",
    ]);
  });

  it("does not recommend seeding auto-approve once user already has tools in autoApprove list", async () => {
    await bulkUpdatePreferences({
      userId: 1,
      items: [
        { key: "autoApproveTools", value: ["research.deepSearch", "inspiration.fetch"] },
      ],
    });
    const r = await recommendOptimizations(1);
    expect(r.recommendations.find(x => x.id === "seed-auto-approve")).toBeUndefined();
  });
});
