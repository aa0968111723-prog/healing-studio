/**
 * AIDV-580 — OAuth `state` encoding contract, incl. the anti-CSRF login nonce.
 *
 * The login CSRF fix carries a high-entropy `nonce` inside the structured
 * `state`. These tests lock that the nonce survives an encode→decode round
 * trip, is omitted when absent, and that legacy (pre-nonce) states still
 * decode — so already-issued auth URLs / Drive flows never regress.
 */
import { describe, expect, it } from "vitest";
import { encodeOAuthState, decodeOAuthState } from "./oauthState";

describe("oauthState — nonce round trip (AIDV-580)", () => {
  it("login state carries the nonce through encode→decode", () => {
    const nonce = "Zm9vYmFy_dGVzdC1ub25jZQ";
    const encoded = encodeOAuthState({
      redirect: "/dashboard",
      purpose: "login",
      nonce,
    });
    const decoded = decodeOAuthState(encoded);
    expect(decoded.redirect).toBe("/dashboard");
    expect(decoded.purpose).toBe("login");
    expect(decoded.nonce).toBe(nonce);
  });

  it("omits the nonce key entirely when not provided (no empty-string leak)", () => {
    const encoded = encodeOAuthState({ redirect: "/", purpose: "login" });
    const json = Buffer.from(encoded, "base64url").toString("utf-8");
    expect(json).not.toContain('"n"');
    expect(decodeOAuthState(encoded).nonce).toBeUndefined();
  });

  it("a state without a nonce decodes to nonce=undefined (backward compat)", () => {
    // Mirrors a Drive state (carries userOpenId, never a login nonce).
    const encoded = encodeOAuthState({
      redirect: "/assets",
      purpose: "drive",
      userOpenId: "open-123",
    });
    const decoded = decodeOAuthState(encoded);
    expect(decoded.purpose).toBe("drive");
    expect(decoded.userOpenId).toBe("open-123");
    expect(decoded.nonce).toBeUndefined();
  });

  it("legacy plain base64(redirect) state still decodes (no nonce)", () => {
    const legacy = Buffer.from("/welcome", "utf-8").toString("base64");
    const decoded = decodeOAuthState(legacy);
    expect(decoded.redirect).toBe("/welcome");
    expect(decoded.purpose).toBe("login");
    expect(decoded.nonce).toBeUndefined();
  });

  it("a non-string nonce field is ignored (defensive decode)", () => {
    const tampered = Buffer.from(
      JSON.stringify({ r: "/", p: "login", n: 12345 }),
      "utf-8",
    ).toString("base64url");
    expect(decodeOAuthState(tampered).nonce).toBeUndefined();
  });
});
