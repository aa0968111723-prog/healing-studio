import { afterEach, describe, expect, it } from "vitest";
import {
  ensureAgentPreferencesSchema,
  isUnknownColumnError,
  __resetAgentPreferencesSchemaCacheForTests,
} from "../agentPreferencesSchemaEnsure";

describe("isUnknownColumnError", () => {
  it("matches MySQL ER_BAD_FIELD_ERROR by code", () => {
    expect(isUnknownColumnError({ code: "ER_BAD_FIELD_ERROR" })).toBe(true);
  });

  it("matches by errno 1054", () => {
    expect(isUnknownColumnError({ errno: 1054 })).toBe(true);
  });

  it("matches by SQLSTATE 42S22", () => {
    expect(isUnknownColumnError({ sqlState: "42S22" })).toBe(true);
  });

  it("matches by message text from wrapped driver errors", () => {
    expect(
      isUnknownColumnError(new Error("Unknown column 'mutedSpirits' in 'field list'")),
    ).toBe(true);
  });

  it("does NOT match unrelated errors", () => {
    expect(isUnknownColumnError(new Error("connection lost"))).toBe(false);
    expect(isUnknownColumnError({ code: "ER_DUP_FIELDNAME" })).toBe(false);
    expect(isUnknownColumnError(null)).toBe(false);
    expect(isUnknownColumnError(undefined)).toBe(false);
  });
});

describe("ensureAgentPreferencesSchema cache", () => {
  afterEach(() => {
    __resetAgentPreferencesSchemaCacheForTests();
  });

  it("caches the in-flight promise so concurrent callers share one run", async () => {
    let executeCount = 0;
    const fakeDb = {
      execute: async () => {
        executeCount += 1;
        // First call (SELECT EXISTS) — pretend every column already exists
        // so we never reach an ALTER. The UPDATE no-op queries each return.
        return [{ existsFlag: 1 }];
      },
    } as unknown as Parameters<typeof ensureAgentPreferencesSchema>[0];

    const [a, b, c] = await Promise.all([
      ensureAgentPreferencesSchema(fakeDb),
      ensureAgentPreferencesSchema(fakeDb),
      ensureAgentPreferencesSchema(fakeDb),
    ]);
    expect(a).toBeUndefined();
    expect(b).toBeUndefined();
    expect(c).toBeUndefined();
    // 9 existence checks + 4 UPDATE backfills = 13 expected. Three concurrent
    // callers must share that, not multiply it by 3.
    expect(executeCount).toBe(13);
  });

  it("resets cache on failure so the next call retries", async () => {
    let calls = 0;
    const fakeDb = {
      execute: async () => {
        calls += 1;
        throw new Error("synthetic failure");
      },
    } as unknown as Parameters<typeof ensureAgentPreferencesSchema>[0];

    await expect(ensureAgentPreferencesSchema(fakeDb)).rejects.toThrow(
      "synthetic failure",
    );
    const callsAfterFirst = calls;
    await expect(ensureAgentPreferencesSchema(fakeDb)).rejects.toThrow(
      "synthetic failure",
    );
    // Second call must have actually run (cache reset), not just resolved
    // the cached rejection.
    expect(calls).toBeGreaterThan(callsAfterFirst);
  });
});
