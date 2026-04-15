/**
 * storage.ts — 統一儲存介面
 *
 * 優先順序（自動偵測，擇一使用）：
 *   1. Cloudflare R2 / AWS S3 相容     — S3_ENDPOINT + S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY + S3_BUCKET_NAME
 *   2. Google Cloud Storage (GCS)      — GCS_BUCKET_NAME + GOOGLE_APPLICATION_CREDENTIALS_JSON
 *   3. Manus 內建 Storage Proxy         — BUILT_IN_FORGE_API_URL + BUILT_IN_FORGE_API_KEY（向後相容）
 *
 * ─── Railway / Cloudflare R2 快速設定 ────────────────────────────────────
 *   S3_ENDPOINT            = https://<ACCOUNT_ID>.r2.cloudflarestorage.com
 *   S3_ACCESS_KEY_ID       = <R2_ACCESS_KEY_ID>
 *   S3_SECRET_ACCESS_KEY   = <R2_SECRET_ACCESS_KEY>
 *   S3_BUCKET_NAME         = <your-bucket-name>
 *   S3_PUBLIC_URL          = https://pub-xxxx.r2.dev  (R2 公開網域，選填)
 *   S3_REGION              = auto  (R2 固定填 auto，AWS 填 us-east-1 等)
 * ─────────────────────────────────────────────────────────────────────────
 */

import { ENV } from "./_core/env";
import { serverEnv } from "./_core/env.validated";

// ─── 型別定義 ─────────────────────────────────────────────────────────────

export interface StorageResult {
  key: string;
  url: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. S3 / Cloudflare R2 實作（AWS Signature v4 手動簽名，零外部依賴）
// ═══════════════════════════════════════════════════════════════════════════

/** HMAC-SHA256（Web Crypto API，Node.js 18+ 內建） */
async function hmacSha256(
  key: ArrayBuffer | Uint8Array,
  data: string
): Promise<Uint8Array> {
  const rawKey: ArrayBuffer =
    key instanceof Uint8Array
      ? (key.buffer.slice(
          key.byteOffset,
          key.byteOffset + key.byteLength
        ) as ArrayBuffer)
      : (key as ArrayBuffer);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(data)
  );
  return new Uint8Array(sig);
}

/** SHA-256 hex digest */
async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes: BufferSource =
    typeof data === "string"
      ? new TextEncoder().encode(data)
      : (data.buffer.slice(
          data.byteOffset,
          data.byteOffset + data.byteLength
        ) as ArrayBuffer);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Uint8Array → hex string */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * AWS Signature v4 PUT — 支援 Cloudflare R2、AWS S3、MinIO、Backblaze B2 等任何 S3 相容儲存。
 */
async function s3PutObject(params: {
  endpoint: string; // e.g. https://<id>.r2.cloudflarestorage.com
  bucket: string;
  region: string; // "auto" for R2, "us-east-1" for AWS
  accessKeyId: string;
  secretAccessKey: string;
  key: string; // object key (path inside bucket)
  body: Buffer | Uint8Array;
  contentType: string;
  publicUrl?: string; // optional custom public domain
}): Promise<StorageResult> {
  const {
    endpoint,
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    key,
    body,
    contentType,
    publicUrl,
  } = params;

  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
  const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, ""); // YYYYMMDDTHHmmssZ
  const service = "s3";

  // Normalise endpoint (strip trailing slash, ensure https)
  const baseEndpoint = endpoint.replace(/\/+$/, "");
  const uploadUrl = `${baseEndpoint}/${bucket}/${key}`;

  const bodyBuf = Buffer.from(body);
  const bodyHash = await sha256Hex(bodyBuf);

  const headers: Record<string, string> = {
    "content-type": contentType,
    host: new URL(baseEndpoint).host,
    "x-amz-content-sha256": bodyHash,
    "x-amz-date": amzDate,
  };

  // Canonical headers must be lowercase + sorted
  const sortedHeaders = Object.keys(headers).sort();
  const canonicalHeaders = sortedHeaders
    .map(k => `${k}:${headers[k]}\n`)
    .join("");
  const signedHeaders = sortedHeaders.join(";");

  const canonicalRequest = [
    "PUT",
    `/${bucket}/${key}`,
    "", // no query string
    canonicalHeaders,
    signedHeaders,
    bodyHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  // Derive signing key
  const kDate = await hmacSha256(
    new TextEncoder().encode("AWS4" + secretAccessKey),
    dateStamp
  );
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = toHex(await hmacSha256(kSigning, stringToSign));

  const authHeader = [
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      ...headers,
      Authorization: authHeader,
    },
    body: bodyBuf,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    throw new Error(`S3 upload failed (${response.status}): ${errText}`);
  }

  // Determine public URL
  let resultUrl: string;
  if (publicUrl) {
    resultUrl = `${publicUrl.replace(/\/+$/, "")}/${key}`;
  } else {
    // Fallback: path-style URL (always works, some providers need virtual-hosted style)
    resultUrl = `${baseEndpoint}/${bucket}/${key}`;
  }

  return { key, url: resultUrl };
}

function useS3(): boolean {
  return !!(
    serverEnv.S3_ENDPOINT &&
    serverEnv.S3_ACCESS_KEY_ID &&
    serverEnv.S3_SECRET_ACCESS_KEY &&
    serverEnv.S3_BUCKET_NAME
  );
}

async function s3Upload(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType: string
): Promise<StorageResult> {
  const endpoint = serverEnv.S3_ENDPOINT!;
  const bucket = serverEnv.S3_BUCKET_NAME!;
  const region = serverEnv.S3_REGION || "auto";
  const accessKeyId = serverEnv.S3_ACCESS_KEY_ID!;
  const secretAccessKey = serverEnv.S3_SECRET_ACCESS_KEY!;
  const publicUrl =
    serverEnv.S3_PUBLIC_URL || serverEnv.S3_PUBLIC_DOMAIN || undefined;

  const key = relKey.replace(/^\/+/, "");
  const body =
    typeof data === "string" ? Buffer.from(data, "utf-8") : Buffer.from(data);

  return s3PutObject({
    endpoint,
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    key,
    body,
    contentType,
    publicUrl,
  });
}

function s3GetUrl(relKey: string): StorageResult {
  const key = relKey.replace(/^\/+/, "");
  const publicUrl = serverEnv.S3_PUBLIC_URL || serverEnv.S3_PUBLIC_DOMAIN;
  const endpoint = serverEnv.S3_ENDPOINT!.replace(/\/+$/, "");
  const bucket = serverEnv.S3_BUCKET_NAME!;
  const url = publicUrl
    ? `${publicUrl.replace(/\/+$/, "")}/${key}`
    : `${endpoint}/${bucket}/${key}`;
  return { key, url };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Google Cloud Storage 實作
// ═══════════════════════════════════════════════════════════════════════════

async function gcsUpload(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType: string
): Promise<StorageResult> {
  const bucketName = serverEnv.GCS_BUCKET_NAME;
  const credJson = serverEnv.GOOGLE_APPLICATION_CREDENTIALS_JSON;

  if (!bucketName) throw new Error("GCS_BUCKET_NAME 未設定");
  if (!credJson) throw new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON 未設定");

  const credentials = JSON.parse(credJson) as {
    client_email: string;
    private_key: string;
  };

  const accessToken = await getGcsAccessToken(credentials);
  const key = relKey.replace(/^\/+/, "");
  const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${bucketName}/o?uploadType=media&name=${encodeURIComponent(key)}`;
  const body =
    typeof data === "string" ? Buffer.from(data, "utf-8") : Buffer.from(data);

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": contentType,
      "Content-Length": String(body.length),
    },
    body,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`GCS upload failed: ${response.status} — ${err}`);
  }

  const publicUrl = `https://storage.googleapis.com/${bucketName}/${key}`;
  return { key, url: publicUrl };
}

async function gcsGetUrl(relKey: string): Promise<StorageResult> {
  const bucketName = serverEnv.GCS_BUCKET_NAME;
  if (!bucketName) throw new Error("GCS_BUCKET_NAME 未設定");
  const key = relKey.replace(/^\/+/, "");
  return { key, url: `https://storage.googleapis.com/${bucketName}/${key}` };
}

// ─── GCS Token Cache ────────────────────────────────────────────────────
let gcsTokenCache: { token: string; expiresAt: number } | null = null;

async function getGcsAccessToken(credentials: {
  client_email: string;
  private_key: string;
}): Promise<string> {
  // Return cached token if still valid (refresh 5 min before expiry)
  if (gcsTokenCache && gcsTokenCache.expiresAt > Date.now()) {
    return gcsTokenCache.token;
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/devstorage.read_write",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const { SignJWT } = await import("jose");
  const privateKey = await importPrivateKey(credentials.private_key);
  const jwt = await new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256" })
    .sign(privateKey);

  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!tokenResp.ok) {
    throw new Error(`GCS token exchange failed: ${tokenResp.status}`);
  }
  const { access_token } = (await tokenResp.json()) as { access_token: string };

  // Cache token for 55 minutes (token valid for 60 min)
  gcsTokenCache = {
    token: access_token,
    expiresAt: Date.now() + 55 * 60 * 1000,
  };
  return access_token;
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const { importPKCS8 } = await import("jose");
  return importPKCS8(pem, "RS256");
}

function useGCS(): boolean {
  return !!(
    serverEnv.GCS_BUCKET_NAME && serverEnv.GOOGLE_APPLICATION_CREDENTIALS_JSON
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Manus Storage Proxy（向後相容，遷移完成後可移除）
// ═══════════════════════════════════════════════════════════════════════════

type StorageConfig = { baseUrl: string; apiKey: string };

function getManusStorageConfig(): StorageConfig {
  const baseUrl = ENV.forgeApiUrl;
  const apiKey = ENV.forgeApiKey;
  if (!baseUrl || !apiKey) {
    throw new Error(
      "Storage 未設定：請在 Railway 設定 S3_ENDPOINT / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY / S3_BUCKET_NAME"
    );
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

function buildManusAuthHeaders(apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey}` };
}

async function manusUpload(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType: string
): Promise<StorageResult> {
  const { baseUrl, apiKey } = getManusStorageConfig();
  const key = relKey.replace(/^\/+/, "");
  const uploadUrl = new URL("v1/storage/upload", `${baseUrl}/`);
  uploadUrl.searchParams.set("path", key);

  const blob =
    typeof data === "string"
      ? new Blob([data], { type: contentType })
      : new Blob([Buffer.from(data)], { type: contentType });
  const form = new FormData();
  form.append("file", blob, key.split("/").pop() ?? key);

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: buildManusAuthHeaders(apiKey),
    body: form,
  });

  if (!response.ok) {
    const msg = await response.text().catch(() => response.statusText);
    throw new Error(`Storage upload failed (${response.status}): ${msg}`);
  }

  const url = (await response.json()).url;
  return { key, url };
}

async function manusGetUrl(relKey: string): Promise<StorageResult> {
  const { baseUrl, apiKey } = getManusStorageConfig();
  const key = relKey.replace(/^\/+/, "");
  const downloadApiUrl = new URL("v1/storage/downloadUrl", `${baseUrl}/`);
  downloadApiUrl.searchParams.set("path", key);
  const response = await fetch(downloadApiUrl, {
    method: "GET",
    headers: buildManusAuthHeaders(apiKey),
  });
  return { key, url: (await response.json()).url };
}

// ═══════════════════════════════════════════════════════════════════════════
// 公開介面 — 自動選擇後端
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 偵測目前可用的 storage 後端（用於 health check 或 debug log）
 */
export function detectStorageBackend(): "s3" | "gcs" | "manus" | "none" {
  if (useS3()) return "s3";
  if (useGCS()) return "gcs";
  if (ENV.forgeApiUrl && ENV.forgeApiKey) return "manus";
  return "none";
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<StorageResult> {
  if (useS3()) return s3Upload(relKey, data, contentType);
  if (useGCS()) return gcsUpload(relKey, data, contentType);
  return manusUpload(relKey, data, contentType);
}

export async function storageGet(relKey: string): Promise<StorageResult> {
  if (useS3()) return s3GetUrl(relKey);
  if (useGCS()) return gcsGetUrl(relKey);
  return manusGetUrl(relKey);
}
