/**
 * personal-settings-context.test.ts
 *
 * Verifies the encode/decode helpers that bridge our local
 * PersonalSettings shape to the server `system_settings` row. These are
 * the bits with non-trivial logic: the React hook layer is a thin shell on
 * top of trpc.useQuery / useMutation, which is exercised by integration
 * tests; here we cover the data plane.
 *
 * Background: before this rewrite, PersonalSettingsContext only used
 * localStorage, so user preferences never persisted to the database and
 * couldn't follow the user across devices. The encode/decode helpers are
 * the seam where that "real persistence" actually happens.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERSONAL_SETTINGS,
  decodeServerSettings,
  encodeServerPayload,
  mergePersonalSettings,
  parseStoredSettings,
  type PersonalSettings,
} from "../../../client/src/contexts/PersonalSettingsContext";

describe("parseStoredSettings", () => {
  it("returns defaults for null/garbage input", () => {
    expect(parseStoredSettings(null)).toEqual(DEFAULT_PERSONAL_SETTINGS);
    expect(parseStoredSettings("not json")).toEqual(DEFAULT_PERSONAL_SETTINGS);
  });

  it("preserves valid fields and falls back for invalid ones", () => {
    const raw = JSON.stringify({
      displayName: "Aria",
      timezone: "Asia/Taipei",
      compactMode: true,
      viewMode: "weird-value",
      soundEnabled: "yes", // wrong type
    });
    const parsed = parseStoredSettings(raw);
    expect(parsed.displayName).toBe("Aria");
    expect(parsed.timezone).toBe("Asia/Taipei");
    expect(parsed.compactMode).toBe(true);
    // Invalid viewMode falls back to default
    expect(parsed.viewMode).toBe(DEFAULT_PERSONAL_SETTINGS.viewMode);
    // Wrong-typed soundEnabled falls back to default
    expect(parsed.soundEnabled).toBe(DEFAULT_PERSONAL_SETTINGS.soundEnabled);
  });
});

describe("mergePersonalSettings", () => {
  it("returns base unchanged when patch is null/undefined", () => {
    expect(mergePersonalSettings(DEFAULT_PERSONAL_SETTINGS, null)).toBe(
      DEFAULT_PERSONAL_SETTINGS
    );
    expect(mergePersonalSettings(DEFAULT_PERSONAL_SETTINGS, undefined)).toBe(
      DEFAULT_PERSONAL_SETTINGS
    );
  });

  it("only overrides provided fields", () => {
    const base: PersonalSettings = {
      ...DEFAULT_PERSONAL_SETTINGS,
      displayName: "Old",
      compactMode: false,
    };
    const merged = mergePersonalSettings(base, {
      displayName: "New",
    });
    expect(merged.displayName).toBe("New");
    expect(merged.compactMode).toBe(false);
  });

  it("rejects empty timezone (would otherwise leave display in a broken state)", () => {
    const merged = mergePersonalSettings(
      { ...DEFAULT_PERSONAL_SETTINGS, timezone: "Asia/Taipei" },
      { timezone: "   " }
    );
    expect(merged.timezone).toBe("Asia/Taipei");
  });
});

describe("decodeServerSettings", () => {
  it("returns null for missing input", () => {
    expect(decodeServerSettings(undefined)).toBeNull();
  });

  it("pulls personal block out of extraSettings + uses row-level timezone", () => {
    const decoded = decodeServerSettings({
      timezone: "Asia/Taipei",
      extraSettings: {
        // sibling key from another feature — we should not accidentally
        // surface it as a personal setting
        otherFeature: { foo: 1 },
        personal: {
          displayName: "Aria",
          bio: "writes lullabies",
          orbCuteMode: true,
        },
      },
    });
    expect(decoded).toEqual({
      displayName: "Aria",
      bio: "writes lullabies",
      orbCuteMode: true,
      timezone: "Asia/Taipei",
    });
  });

  it("falls back to extraSettings.personal.timezone if column is missing", () => {
    const decoded = decodeServerSettings({
      timezone: null,
      extraSettings: {
        personal: { timezone: "Europe/Berlin" },
      },
    });
    expect(decoded?.timezone).toBe("Europe/Berlin");
  });
});

describe("encodeServerPayload", () => {
  it("packs all personal fields into extraSettings.personal", () => {
    const payload = encodeServerPayload(
      {
        ...DEFAULT_PERSONAL_SETTINGS,
        displayName: "Aria",
        timezone: "Asia/Taipei",
        compactMode: true,
      },
      null
    );
    expect(payload.timezone).toBe("Asia/Taipei");
    expect(payload.extraSettings).toMatchObject({
      personal: {
        displayName: "Aria",
        compactMode: true,
      },
    });
  });

  it("preserves sibling keys in extraSettings (so we don't clobber other features)", () => {
    const payload = encodeServerPayload(DEFAULT_PERSONAL_SETTINGS, {
      otherFeature: { foo: 1 },
    });
    expect(payload.extraSettings.otherFeature).toEqual({ foo: 1 });
    expect(payload.extraSettings.personal).toBeDefined();
  });

  it("decode(encode(s)) round-trips", () => {
    const original: PersonalSettings = {
      ...DEFAULT_PERSONAL_SETTINGS,
      displayName: "Aria",
      bio: "writes lullabies",
      timezone: "Asia/Taipei",
      compactMode: true,
      confirmBeforeGenerate: true,
      soundEnabled: false,
      desktopNotif: true,
      viewMode: "desktop",
      orbCuteMode: true,
      orbRandomFly: true,
    };
    const encoded = encodeServerPayload(original, null);
    const decoded = decodeServerSettings(encoded);
    // Apply the decoded patch back over defaults; should equal the original
    const merged = mergePersonalSettings(DEFAULT_PERSONAL_SETTINGS, decoded);
    expect(merged).toEqual(original);
  });
});
