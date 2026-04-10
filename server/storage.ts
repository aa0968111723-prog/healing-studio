/**
 * storage.ts — 統一儲存介面
 *
 * 優先順序：
 *   1. Google Cloud Storage (GCS_BUCKET_NAME 已設定時)
 *   2. Manus 內建 Storage Proxy（向後相容，遷移完成後可移除）
 *
 * 所有上傳的媒體檔案（圖片/影片/音檔）都透過此模組統一管理。
 */

import { ENV } from './_core/env';
import { serverEnv } from './_core/env.validated';

// ─── 型別定義 ─────────────────────────────────────────────────────────────

export interface StorageResult {
  key: string;
  url: string;
}

// ─── Google Cloud Storage 實作 ────────────────────────────────────────────

async function gcsUpload(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType: string
): Promise<StorageResult> {
  const bucketName = serverEnv.GCS_BUCKET_NAME;
  const credJson = serverEnv.GOOGLE_APPLICATION_CREDENTIALS_JSON;

  if (!bucketName) throw new Error("GCS_BUCKET_NAME 未設定");
  if (!credJson) throw new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON 未設定");

  // 解析服務帳號憑證
  const credentials = JSON.parse(credJson) as {
    client_email: string;
    private_key: string;
  };

  // 取得 GCS Access Token（使用 JWT 自簽）
  const accessToken = await getGcsAccessToken(credentials);
  const key = relKey.replace(/^\/+/, "");

  // 上傳物件
  const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${bucketName}/o?uploadType=media&name=${encodeURIComponent(key)}`;

  const body = typeof data === "string"
    ? Buffer.from(data, "utf-8")
    : Buffer.from(data);

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

  // 公開 URL（需要 bucket 設為 public read）
  const publicUrl = `https://storage.googleapis.com/${bucketName}/${key}`;
  return { key, url: publicUrl };
}

async function gcsGetUrl(relKey: string): Promise<StorageResult> {
  const bucketName = serverEnv.GCS_BUCKET_NAME;
  if (!bucketName) throw new Error("GCS_BUCKET_NAME 未設定");
  const key = relKey.replace(/^\/+/, "");
  return {
    key,
    url: `https://storage.googleapis.com/${bucketName}/${key}`,
  };
}

// ─── GCS JWT 自簽 Access Token ─────────────────────────────────────────────

async function getGcsAccessToken(credentials: {
  client_email: string;
  private_key: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/devstorage.read_write",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  // 使用 jose 簽署 JWT
  const { SignJWT } = await import("jose");
  const privateKey = await importPrivateKey(credentials.private_key);

  const jwt = await new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256" })
    .sign(privateKey);

  // 用 JWT 換取 access token
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
  return access_token;
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const { importPKCS8 } = await import("jose");
  return importPKCS8(pem, "RS256");
}

// ─── Manus Storage Proxy（向後相容）──────────────────────────────────────

type StorageConfig = { baseUrl: string; apiKey: string };

function getManusStorageConfig(): StorageConfig {
  const baseUrl = ENV.forgeApiUrl;
  const apiKey = ENV.forgeApiKey;
  if (!baseUrl || !apiKey) {
    throw new Error("Storage 未設定：請設定 GCS_BUCKET_NAME 或 BUILT_IN_FORGE_API_URL");
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

  const blob = typeof data === "string"
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

// ─── 統一公開介面（自動選擇後端）─────────────────────────────────────────

function useGCS(): boolean {
  return !!(serverEnv.GCS_BUCKET_NAME && serverEnv.GOOGLE_APPLICATION_CREDENTIALS_JSON);
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<StorageResult> {
  if (useGCS()) {
    return gcsUpload(relKey, data, contentType);
  }
  return manusUpload(relKey, data, contentType);
}

export async function storageGet(relKey: string): Promise<StorageResult> {
  if (useGCS()) {
    return gcsGetUrl(relKey);
  }
  return manusGetUrl(relKey);
}
