/**
 * Google Drive integration for the asset-library feature.
 *
 * Responsibilities:
 *   - Build the incremental OAuth URL (Drive readonly scope) that piggybacks
 *     on the existing `/api/oauth/callback` redirect URI already approved in
 *     Google Cloud Console.
 *   - Exchange the code for tokens, refresh access tokens on demand, and
 *     persist them in `user_google_oauth_tokens` keyed by (userId, "drive").
 *   - Wrap the small subset of Drive API calls we actually need: list a
 *     folder's children with thumbnails, resolve a folder by id.
 *
 * This file deliberately does NOT touch the login OAuth flow — that one is
 * scoped to openid/email/profile and lives in `_core/oauth.ts`.
 */

import { ENV } from "../_core/env";
import { resolveRedirectUri } from "../_core/googleAuth";
import { logger } from "../_core/logger";
import * as db from "../db";
import type { Request } from "express";

export const DRIVE_TOKEN_PURPOSE = "drive";
export const DRIVE_SCOPE =
  "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.metadata.readonly";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";

// Refresh slightly before the token actually expires so concurrent calls
// don't race the deadline.
const TOKEN_REFRESH_LEEWAY_MS = 60_000;

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  iconLink?: string;
  thumbnailLink?: string;
  webViewLink?: string;
  webContentLink?: string;
  modifiedTime?: string;
  size?: string;
  parents?: string[];
  isFolder: boolean;
}

export interface ListDriveFolderResult {
  files: DriveFile[];
  nextPageToken?: string;
  folder?: { id: string; name: string };
}

// ─── OAuth URL builder ────────────────────────────────────────────────────

export function buildDriveAuthUrl(state: string, req?: Request): string {
  const clientId = ENV.googleClientId;
  if (!clientId) {
    throw new Error("GOOGLE_CLIENT_ID 未設定");
  }
  const redirectUri = resolveRedirectUri(req);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: DRIVE_SCOPE,
    state,
    access_type: "offline",
    // Force consent so Google re-issues a refresh_token; without this,
    // re-auth often returns only an access_token, leaving the user unable
    // to keep the connection alive.
    prompt: "consent",
    include_granted_scopes: "true",
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

// ─── Code → Token exchange ────────────────────────────────────────────────

export async function exchangeDriveCode(
  code: string,
  req?: Request
): Promise<GoogleTokenResponse> {
  const clientId = ENV.googleClientId;
  const clientSecret = ENV.googleClientSecret;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID 或 GOOGLE_CLIENT_SECRET 未設定");
  }
  const redirectUri = resolveRedirectUri(req);

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    logger.error("[Drive] Token exchange failed", {
      status: response.status,
      error: errorText,
    });
    throw new Error(
      `Drive token exchange failed: ${response.status} — ${errorText}`
    );
  }
  return response.json() as Promise<GoogleTokenResponse>;
}

// ─── Persist tokens ───────────────────────────────────────────────────────

export async function saveDriveTokens(userId: number, tokens: GoogleTokenResponse) {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  await db.upsertGoogleOauthToken({
    userId,
    purpose: DRIVE_TOKEN_PURPOSE,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    scope: tokens.scope,
    tokenType: tokens.token_type ?? "Bearer",
    expiresAt,
  });
}

// ─── Refresh ──────────────────────────────────────────────────────────────

async function refreshDriveToken(refreshToken: string): Promise<GoogleTokenResponse> {
  const clientId = ENV.googleClientId;
  const clientSecret = ENV.googleClientSecret;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID 或 GOOGLE_CLIENT_SECRET 未設定");
  }
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Drive refresh failed: ${response.status} — ${errorText}`);
  }
  // refresh_token rotation is opt-in for Google web clients, so the
  // response may omit it; saveDriveTokens will keep the existing one.
  return response.json() as Promise<GoogleTokenResponse>;
}

/**
 * Returns a usable access token, refreshing on disk if it's about to
 * expire. Returns null when the user has never connected Drive.
 */
export async function getValidDriveAccessToken(userId: number): Promise<string | null> {
  const stored = await db.getGoogleOauthToken(userId, DRIVE_TOKEN_PURPOSE);
  if (!stored) return null;

  const now = Date.now();
  const expiresAtMs = stored.expiresAt ? new Date(stored.expiresAt).getTime() : 0;
  const stillFresh = expiresAtMs > now + TOKEN_REFRESH_LEEWAY_MS;
  if (stillFresh) return stored.accessToken;

  if (!stored.refreshToken) {
    // Token expired and we have no way to refresh — caller needs to
    // re-trigger the OAuth flow.
    return null;
  }

  try {
    const refreshed = await refreshDriveToken(stored.refreshToken);
    await db.upsertGoogleOauthToken({
      userId,
      purpose: DRIVE_TOKEN_PURPOSE,
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token ?? stored.refreshToken,
      scope: refreshed.scope || stored.scope,
      tokenType: refreshed.token_type ?? "Bearer",
      expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
    });
    return refreshed.access_token;
  } catch (err) {
    logger.warn("[Drive] Failed to refresh access token", { userId, err });
    return null;
  }
}

// ─── Drive API wrappers ──────────────────────────────────────────────────

interface DriveApiFile {
  id: string;
  name: string;
  mimeType: string;
  iconLink?: string;
  thumbnailLink?: string;
  webViewLink?: string;
  webContentLink?: string;
  modifiedTime?: string;
  size?: string;
  parents?: string[];
}

function adaptDriveFile(raw: DriveApiFile): DriveFile {
  return {
    id: raw.id,
    name: raw.name,
    mimeType: raw.mimeType,
    iconLink: raw.iconLink,
    thumbnailLink: raw.thumbnailLink,
    webViewLink: raw.webViewLink,
    webContentLink: raw.webContentLink,
    modifiedTime: raw.modifiedTime,
    size: raw.size,
    parents: raw.parents,
    isFolder: raw.mimeType === "application/vnd.google-apps.folder",
  };
}

async function driveFetch(
  accessToken: string,
  path: string,
  searchParams?: Record<string, string>
): Promise<unknown> {
  const url = new URL(`${DRIVE_API_BASE}${path}`);
  if (searchParams) {
    for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v);
  }
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive API ${res.status}: ${text}`);
  }
  return res.json();
}

export async function getDriveFolder(
  accessToken: string,
  folderId: string
): Promise<{ id: string; name: string; mimeType: string }> {
  const raw = (await driveFetch(accessToken, `/files/${encodeURIComponent(folderId)}`, {
    fields: "id,name,mimeType",
    supportsAllDrives: "true",
  })) as { id: string; name: string; mimeType: string };
  return raw;
}

export async function listDriveFolder(
  accessToken: string,
  folderId: string,
  options: { pageToken?: string; pageSize?: number } = {}
): Promise<ListDriveFolderResult> {
  const pageSize = Math.min(Math.max(options.pageSize ?? 50, 1), 200);
  const params: Record<string, string> = {
    q: `'${folderId}' in parents and trashed = false`,
    pageSize: String(pageSize),
    orderBy: "folder,name",
    fields:
      "nextPageToken,files(id,name,mimeType,iconLink,thumbnailLink,webViewLink,webContentLink,modifiedTime,size,parents)",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  };
  if (options.pageToken) params.pageToken = options.pageToken;

  const raw = (await driveFetch(accessToken, "/files", params)) as {
    files: DriveApiFile[];
    nextPageToken?: string;
  };

  let folder: { id: string; name: string } | undefined;
  try {
    const meta = await getDriveFolder(accessToken, folderId);
    folder = { id: meta.id, name: meta.name };
  } catch (err) {
    logger.warn("[Drive] Could not fetch folder metadata", { folderId, err });
  }

  return {
    files: raw.files.map(adaptDriveFile),
    nextPageToken: raw.nextPageToken,
    folder,
  };
}

/**
 * Pulls a folder id out of the various URLs Google Drive surfaces in the UI:
 *   https://drive.google.com/drive/folders/<id>
 *   https://drive.google.com/drive/u/0/folders/<id>?usp=sharing
 *   https://drive.google.com/open?id=<id>
 * If the input doesn't look like a URL, returns it untouched (assumed to
 * already be a raw folder id).
 */
export function parseDriveFolderId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Raw id heuristic: 25+ url-safe chars, no slashes / spaces.
  if (!trimmed.includes("/") && !trimmed.includes(" ") && trimmed.length >= 16) {
    return trimmed;
  }
  try {
    const url = new URL(trimmed);
    const queryId = url.searchParams.get("id");
    if (queryId) return queryId;
    const m = url.pathname.match(/folders\/([^/?#]+)/);
    if (m) return m[1];
  } catch {
    // not a URL
  }
  return null;
}

/**
 * Best-effort plain-text content for a Drive file. Google Docs are exported as
 * text/plain; text/* files are downloaded via alt=media. Everything else
 * (images, binaries, PDFs…) returns null — only metadata is usable for those.
 * Returns at most `maxChars` characters. Never throws (returns null on error).
 */
export async function exportDriveFileText(
  accessToken: string,
  file: { id: string; mimeType: string },
  maxChars = 4000
): Promise<string | null> {
  let url: URL;
  if (file.mimeType === "application/vnd.google-apps.document") {
    url = new URL(`${DRIVE_API_BASE}/files/${encodeURIComponent(file.id)}/export`);
    url.searchParams.set("mimeType", "text/plain");
  } else if (file.mimeType.startsWith("text/")) {
    url = new URL(`${DRIVE_API_BASE}/files/${encodeURIComponent(file.id)}`);
    url.searchParams.set("alt", "media");
  } else {
    return null;
  }
  url.searchParams.set("supportsAllDrives", "true");
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.slice(0, maxChars);
  } catch (err) {
    logger.warn("[Drive] Could not export file text", { fileId: file.id, err });
    return null;
  }
}
