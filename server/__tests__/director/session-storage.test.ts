import { describe, it, expect } from "vitest";
import {
  decodeDirectorSessionData,
  decodeDirectorSessionDataOrNull,
  encodeDirectorSessionData,
  isDirectorSessionNote,
} from "../../routers/director";

/**
 * Type-guard regression tests for director session storage.
 *
 * Director sessions are persisted in `project_notes_calendar` as
 * `noteType="script"` rows tagged `"director-session"`. The session
 * endpoints (`loadSession`, `deleteSession`) must refuse to operate on
 * notes that don't satisfy *both* conditions — otherwise a user could
 * pass an unrelated script-note id (e.g. an imported long-form script)
 * and the endpoint would happily return or delete it.
 */
describe("isDirectorSessionNote", () => {
  it("accepts a script note tagged director-session", () => {
    expect(
      isDirectorSessionNote({
        noteType: "script",
        tags: ["director-session", "creative"],
      })
    ).toBe(true);
  });

  it("rejects a script note missing the director-session tag", () => {
    expect(
      isDirectorSessionNote({
        noteType: "script",
        tags: ["imported-script"],
      })
    ).toBe(false);
  });

  it("rejects a note that isn't of type script", () => {
    expect(
      isDirectorSessionNote({
        noteType: "note",
        tags: ["director-session"],
      })
    ).toBe(false);
  });

  it("rejects notes with null/missing tags", () => {
    expect(
      isDirectorSessionNote({ noteType: "script", tags: null })
    ).toBe(false);
    expect(isDirectorSessionNote({ noteType: "script" })).toBe(false);
  });

  it("rejects notes with tags that isn't an array", () => {
    expect(
      isDirectorSessionNote({
        noteType: "script",
        tags: "director-session" as unknown as string[],
      })
    ).toBe(false);
  });
});


describe("director session data codec", () => {
  it("round-trips UTF-8 JSON through gzip codec", () => {
    const payload = JSON.stringify({
      title: "導演測試",
      messages: [
        { role: "user", content: "請幫我優化儲存" },
        { role: "assistant", content: "已完成壓縮處理" },
      ],
    });

    const encoded = encodeDirectorSessionData(payload);
    expect(encoded.startsWith("gz:")).toBe(true);
    expect(decodeDirectorSessionData(encoded)).toBe(payload);
  });

  it("keeps legacy plain-text payloads unchanged", () => {
    const legacy = '{"legacy":true}';
    expect(decodeDirectorSessionData(legacy)).toBe(legacy);
  });

  it("fails open for malformed compressed payloads", () => {
    const malformed = "gz:not-valid-base64!!";
    expect(decodeDirectorSessionData(malformed)).toBe(malformed);
  });
});

describe("decodeDirectorSessionDataOrNull", () => {
  it("returns null for null, undefined, and blank content", () => {
    expect(decodeDirectorSessionDataOrNull(null)).toBeNull();
    expect(decodeDirectorSessionDataOrNull(undefined)).toBeNull();
    expect(decodeDirectorSessionDataOrNull("   ")).toBeNull();
  });

  it("decodes non-empty content", () => {
    const payload = '{"messages":[]}';
    expect(decodeDirectorSessionDataOrNull(payload)).toBe(payload);
  });
});
