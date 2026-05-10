/**
 * OAuth state encoding shared by login + incremental scope flows.
 *
 * Historically the `state` query param was just a base64-encoded redirect
 * path. We need to also carry a "purpose" tag so a single redirect URI
 * (`/api/oauth/callback`) can distinguish login flows from incremental
 * scope grants (e.g. Drive). To stay backward-compatible with
 * already-issued login URLs, decode tries JSON first and falls back to
 * the legacy plain-redirect format.
 */

export type OAuthPurpose = "login" | "drive";

export interface OAuthState {
  redirect: string;
  purpose: OAuthPurpose;
  /** Bound to the user's session for incremental flows. */
  userOpenId?: string;
}

const PURPOSES: ReadonlySet<OAuthPurpose> = new Set(["login", "drive"]);

export function encodeOAuthState(state: OAuthState): string {
  const payload = JSON.stringify({
    r: state.redirect,
    p: state.purpose,
    ...(state.userOpenId ? { u: state.userOpenId } : {}),
  });
  return Buffer.from(payload, "utf-8").toString("base64url");
}

export function decodeOAuthState(raw: string | undefined | null): OAuthState {
  if (!raw) return { redirect: "/", purpose: "login" };

  // New JSON format (base64url-encoded).
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf-8");
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed === "object" && typeof parsed.r === "string") {
      const purpose: OAuthPurpose = PURPOSES.has(parsed.p) ? parsed.p : "login";
      return {
        redirect: parsed.r,
        purpose,
        userOpenId: typeof parsed.u === "string" ? parsed.u : undefined,
      };
    }
  } catch {
    // fall through to legacy
  }

  // Legacy: state is just the redirect path, base64-encoded.
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf-8");
    return { redirect: decoded || "/", purpose: "login" };
  } catch {
    return { redirect: "/", purpose: "login" };
  }
}
