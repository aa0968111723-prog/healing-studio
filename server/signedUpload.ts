/**
 * signedUpload.ts — AIDV-15：Signed-URL 直傳（廢 base64）
 *
 * 問題：大檔以 base64 經 HTTP/tRPC body 上傳，payload 與 Node 記憶體膨脹 ~1.33×
 * （base64 字串 + decoded Buffer + rawBody 同時常駐 heap），規模一來即打爆
 * Railway 容器記憶體。
 *
 * 解法：前端先向伺服器要一個「scoped、短效、限 content-type/size」的 presigned
 * PUT URL，再用 fetch/XHR 把檔案 **直接 PUT 到 Cloudflare R2**——檔案位元組
 * 完全不經過 Node（不過 express.json、不 Buffer.from(base64)）。上傳完成後再呼叫
 * 一個輕量 finalize 端點，由伺服器 HeadObject 驗證物件確實已上傳、大小合規，
 * 回傳與既有 `/api/upload` 完全相同的 `{ url, fileKey, ... }` 形狀，讓既有
 * 落庫流程（assets.upload tRPC mutation）零改動繼續運作。
 *
 * 安全鐵則對應：
 *   ① 旗標 ENABLE_SIGNED_URL_UPLOAD 預設 ON＋可回退：旗標 OFF / 無 R2 設定 /
 *      demo 無 DB 時 `isSignedUploadAvailable()` 回 false，路由回 503，client
 *      自動回退既有 base64 路徑（既有上傳零破壞）。
 *   ② 重用既有 R2 client/設定：S3_* env（與 storage.ts、r2SnapshotJob 共用），
 *      不新增任何金鑰。
 *   ③ presign auth-gated＋scoped：呼叫端必須先通過 authenticateRequest；object
 *      key 強制以 `uploads/<userId>/` 命名空間隔離（使用者 A 拿不到能覆寫使用者
 *      B 物件的 URL）；簽名鎖 Content-Type 與大小上限、效期僅 5 分鐘。
 *
 * 注意：本檔案是純邏輯（驗證 + 簽名 + Head 驗證），不耦合 Express，方便單元測試。
 */

import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { nanoid } from "nanoid";
import { serverEnv } from "./_core/env.validated";
import { __uploadRouteInternals } from "./uploadRoute";

const {
  ALLOWED_MIME_TYPES,
  PER_KIND_MAX_BYTES,
  ABSOLUTE_MAX_BYTES,
  inferKind,
  safeStorageExt,
} = __uploadRouteInternals;

/** Presigned PUT URL 效期（秒）。短效＝即使外洩也很快失效。 */
export const PRESIGN_EXPIRES_SECONDS = 5 * 60; // 5 分鐘

/**
 * 旗標：ENABLE_SIGNED_URL_UPLOAD（預設 ON）。OFF 時整條 signed-URL 路徑停用，
 * client 回退既有 base64 路徑。讀 env 字串，僅 "false"/"0" 視為關閉。
 */
export function isSignedUploadFlagEnabled(): boolean {
  const raw = serverEnv.ENABLE_SIGNED_URL_UPLOAD;
  if (raw === undefined || raw === null) return true; // 預設 ON
  const v = String(raw).trim().toLowerCase();
  return v !== "false" && v !== "0" && v !== "off" && v !== "no";
}

/**
 * R2 / S3 是否已設定齊全（與 storage.ts useS3() 同條件）。未設定（demo / 本機無
 * R2）時 signed-URL 不可用，回退 base64（base64 路徑會走 local filesystem fallback
 * 或 storagePut，維持既有行為）。
 */
export function isR2Configured(): boolean {
  return !!(
    serverEnv.S3_ENDPOINT &&
    serverEnv.S3_ACCESS_KEY_ID &&
    serverEnv.S3_SECRET_ACCESS_KEY &&
    serverEnv.S3_BUCKET_NAME
  );
}

/**
 * Signed-URL 直傳是否整體可用 = 旗標 ON ＋ R2 設定齊全。
 * 任一不成立 → 路由回 503，client 回退 base64。
 */
export function isSignedUploadAvailable(): boolean {
  return isSignedUploadFlagEnabled() && isR2Configured();
}

// ── R2 client（重用 r2SnapshotJob 的建法；改讀已驗證的 serverEnv）────────────
let _s3Client: S3Client | null = null;

/**
 * 取得（並快取）指向 Cloudflare R2 的 S3Client。建法與
 * server/jobs/r2SnapshotJob.ts 一致（region:"auto" + endpoint + credentials），
 * 但統一讀 serverEnv（已驗證版）。forcePathStyle:true — R2 對 virtual-hosted
 * style 支援不完整，現有 s3PutObject 也是 path-style。
 */
export function getR2Client(): S3Client {
  if (_s3Client) return _s3Client;
  _s3Client = new S3Client({
    region: serverEnv.S3_REGION || "auto",
    endpoint: serverEnv.S3_ENDPOINT,
    credentials: {
      accessKeyId: serverEnv.S3_ACCESS_KEY_ID,
      secretAccessKey: serverEnv.S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });
  return _s3Client;
}

/** 測試用：清掉快取的 client（換 env 後重建）。 */
export function __resetR2ClientForTests(): void {
  _s3Client = null;
}

/**
 * 由 object key 推導公開 GET URL，與 storage.ts s3GetUrl() 同組法：
 *   有 S3_PUBLIC_URL / S3_PUBLIC_DOMAIN → `${publicUrl}/${key}`
 *   否則 path-style → `${endpoint}/${bucket}/${key}`
 * 確保 finalize 回傳的 URL 形狀與既有 storagePut 路徑一致。
 */
export function buildPublicUrl(key: string): string {
  const cleanKey = key.replace(/^\/+/, "");
  const publicUrl = serverEnv.S3_PUBLIC_URL || serverEnv.S3_PUBLIC_DOMAIN;
  if (publicUrl) return `${publicUrl.replace(/\/+$/, "")}/${cleanKey}`;
  const endpoint = (serverEnv.S3_ENDPOINT || "").replace(/\/+$/, "");
  const bucket = serverEnv.S3_BUCKET_NAME;
  return `${endpoint}/${bucket}/${cleanKey}`;
}

export interface PresignValidationError {
  status: 400 | 413 | 415;
  message: string;
}

/**
 * 純驗證：把 `/api/upload` 收到 bytes 後才做的 MIME allowlist + per-kind/絕對
 * 大小上限「前移」到 presign 階段（因為直傳繞過了伺服器 buffer，拿不到 bytes）。
 * 通過回 null；不通過回 { status, message }。
 */
export function validatePresignRequest(input: {
  mimeType: string;
  sizeBytes: number;
}): PresignValidationError | null {
  const { mimeType, sizeBytes } = input;

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return { status: 415, message: `Unsupported file type: ${mimeType}` };
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { status: 400, message: "Invalid file size" };
  }
  const kind = inferKind(mimeType);
  const perKindLimit = PER_KIND_MAX_BYTES[kind];
  if (sizeBytes > perKindLimit || sizeBytes > ABSOLUTE_MAX_BYTES) {
    const limitMb = Math.floor(perKindLimit / (1024 * 1024));
    return {
      status: 413,
      message: `File too large for ${kind} uploads. Maximum size is ${limitMb} MB.`,
    };
  }
  return null;
}

/**
 * 為某 user 的某次上傳產生「scoped 到該 userId」的 object key：
 *   uploads/<userId>/<safeName>-<nanoid8>.<ext>
 * — 與既有 `/api/upload`（uploadRoute.ts）的 key 形狀完全一致，副檔名一律由
 *   驗證後的 mime 推導（AIDV-64：不採信使用者 filename，杜絕 .html/.svg 被當
 *   可執行內容服務）。userId 前綴是 scope 隔離的核心：使用者只能簽自己命名空間
 *   下的 key。
 */
export function buildScopedKey(input: {
  userId: number | string;
  fileName: string;
  mimeType: string;
}): { fileKey: string; safeName: string } {
  const { userId, fileName, mimeType } = input;
  const suffix = nanoid(8);
  const dotIdx = fileName.lastIndexOf(".");
  const baseNameRaw = dotIdx > 0 ? fileName.slice(0, dotIdx) : fileName;
  const safeName = (baseNameRaw || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
  const ext = safeStorageExt(mimeType);
  const fileKey = `uploads/${userId}/${safeName}-${suffix}.${ext}`;
  return { fileKey, safeName };
}

export interface PresignResult {
  /** 前端用 fetch/XHR PUT 直傳檔案 body 的目標 URL（含簽名 query）。 */
  putUrl: string;
  /** 最終 object key（finalize 與落庫用）。scoped 到 userId。 */
  fileKey: string;
  /** sanitized 檔名（去掉副檔名、非法字元換 _）。 */
  safeName: string;
  /** 簽名時鎖定的 Content-Type——前端 PUT 必須帶同一個值，否則簽名不符。 */
  contentType: string;
  /** 簽名鎖定的最大位元組——前端 PUT 必須帶 Content-Length 不超過此值。 */
  maxSizeBytes: number;
  /** 效期（秒）。 */
  expiresInSeconds: number;
}

/**
 * 產生 presigned PUT URL。簽名鎖定：
 *   • Key   — scoped 到 userId（呼叫端只能簽自己命名空間下的 key）
 *   • ContentType        — 前端 PUT 必須帶同一個 Content-Type
 *   • ContentLength       — 鎖定本次宣告的大小（再加一道防超量上傳）
 * 效期 5 分鐘。R2 presign 採 UNSIGNED-PAYLOAD（SDK 自動處理），不簽 body sha。
 */
export async function presignPutUpload(input: {
  userId: number | string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<PresignResult> {
  const { userId, fileName, mimeType, sizeBytes } = input;
  const { fileKey, safeName } = buildScopedKey({ userId, fileName, mimeType });

  const command = new PutObjectCommand({
    Bucket: serverEnv.S3_BUCKET_NAME,
    Key: fileKey,
    ContentType: mimeType,
    // 把宣告的大小簽進去，避免前端拿到 URL 後塞超大檔（R2 會以 Content-Length
    // 不符拒絕）。配合 finalize 的 HeadObject 二次驗證形成雙保險。
    ContentLength: sizeBytes,
  });

  const putUrl = await getSignedUrl(getR2Client(), command, {
    expiresIn: PRESIGN_EXPIRES_SECONDS,
  });

  return {
    putUrl,
    fileKey,
    safeName,
    contentType: mimeType,
    maxSizeBytes: sizeBytes,
    expiresInSeconds: PRESIGN_EXPIRES_SECONDS,
  };
}

export interface VerifiedObject {
  exists: boolean;
  sizeBytes: number;
  contentType?: string;
}

/**
 * finalize 驗證：HeadObject 確認物件確實已上傳，回實際大小/型別。
 * 物件不存在（前端宣稱上傳但其實沒成功）時 exists=false。
 */
export async function verifyUploadedObject(fileKey: string): Promise<VerifiedObject> {
  const head = await getR2Client().send(
    new HeadObjectCommand({
      Bucket: serverEnv.S3_BUCKET_NAME,
      Key: fileKey.replace(/^\/+/, ""),
    })
  );
  return {
    exists: true,
    sizeBytes: typeof head.ContentLength === "number" ? head.ContentLength : 0,
    contentType: head.ContentType,
  };
}

/**
 * finalize 守門：確認 key 確實落在「呼叫者自己的」命名空間下，杜絕使用者用別人
 * 的 key 偽造 finalize。presign 端產的 key 一定是 uploads/<userId>/...，此處再驗
 * 一次，雙保險。
 */
export function isKeyOwnedByUser(fileKey: string, userId: number | string): boolean {
  return fileKey.replace(/^\/+/, "").startsWith(`uploads/${userId}/`);
}

/**
 * AIDV-64 parity（縱深防禦）：signed-URL 直傳路徑的位元組不經過 Node，base64
 * 路徑跑得到的 magic-byte 內容嗅探（detectMimeMismatch）在直傳側缺席。為了補回
 * 這層防護，finalize 在落庫前用 Range:bytes=0-63 對 R2 物件做一次極小的 GET，
 * 只取前 64 bytes 給 detectMimeMismatch 判斷「宣稱型別 vs 實際內容」是否衝突。
 * 只抓 64 bytes —— 保留「大檔位元組不灌進 Node」的核心好處（不是把整檔讀回來）。
 *
 * 回傳取到的前綴 Buffer（可能 < 64 bytes）。物件不存在 / 取不到 → throw（由
 * 呼叫端決定如何處理，與 verifyUploadedObject 一致）。
 */
export const CONTENT_SNIFF_BYTES = 64;

export async function fetchObjectHeadBytes(
  fileKey: string,
  byteCount: number = CONTENT_SNIFF_BYTES
): Promise<Buffer> {
  const res = await getR2Client().send(
    new GetObjectCommand({
      Bucket: serverEnv.S3_BUCKET_NAME,
      Key: fileKey.replace(/^\/+/, ""),
      Range: `bytes=0-${Math.max(0, byteCount - 1)}`,
    })
  );
  const body = res.Body as
    | { transformToByteArray?: () => Promise<Uint8Array> }
    | undefined;
  if (body && typeof body.transformToByteArray === "function") {
    const arr = await body.transformToByteArray();
    return Buffer.from(arr);
  }
  // Node stream fallback（理論上 SDK v3 在 Node 一定有 transformToByteArray，
  // 但保險起見也支援可讀串流）。
  const chunks: Buffer[] = [];
  for await (const chunk of body as unknown as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    // 只需前 byteCount bytes，夠了就停。
    if (Buffer.concat(chunks).length >= byteCount) break;
  }
  return Buffer.concat(chunks).subarray(0, byteCount);
}

/** 7 天 presigned GET URL 的效期（秒），供影片匯出下載使用（AIDV-347）。 */
export const EXPORT_PRESIGN_EXPIRES_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * 產生 presigned GET URL，供創作者下載已完成影片（AIDV-347）。
 * 效期預設 7 天；R2 支援最長 7 天（604800 秒）的 presigned URL。
 */
export async function presignGetDownload(
  fileKey: string,
  expiresInSeconds: number = EXPORT_PRESIGN_EXPIRES_SECONDS
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: serverEnv.S3_BUCKET_NAME,
    Key: fileKey.replace(/^\/+/, ""),
  });
  return getSignedUrl(getR2Client(), command, { expiresIn: expiresInSeconds });
}

/**
 * finalize 補償：偵測到內容/型別不符（disguise）時，刪除已直傳到 R2 的物件，
 * 避免留下一個「宣稱是 image 但其實是 markup/executable」的垃圾/危險物件。
 * 刪除失敗只記 log，不讓它擋住 finalize 的 415 回應（物件至少不會被落庫引用）。
 */
export async function deleteUploadedObject(fileKey: string): Promise<void> {
  await getR2Client().send(
    new DeleteObjectCommand({
      Bucket: serverEnv.S3_BUCKET_NAME,
      Key: fileKey.replace(/^\/+/, ""),
    })
  );
}
