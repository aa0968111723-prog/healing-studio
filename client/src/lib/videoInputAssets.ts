/**
 * videoInputAssets.ts — 前端多模態素材上傳（AIDV-270）
 *
 * 沿用既有 presign 直傳（uploadFileToS3 → R2，大檔不過 body），把上傳結果
 * 包成 /video 契約要求的 `VideoInputAsset`（{type, url, role}）。
 *
 * 型別/大小/角色驗證全部委派 shared/video-input-assets（單一真實來源）——
 * 前端與後端契約層用同一套規則，突變即兩端連動、不會漂移。
 */

import { uploadFileToS3 } from "./upload";
import {
  MAX_INPUT_ASSET_BYTES,
  MAX_INPUT_ASSETS,
  ROLE_TO_TYPE,
  VIDEO_INPUT_ASSET_ROLES,
  defaultRoleForType,
  inferAssetTypeFromMime,
  validateAssetFile,
  type VideoInputAsset,
  type VideoInputAssetRole,
} from "@shared/video-input-assets";

export {
  MAX_INPUT_ASSET_BYTES,
  MAX_INPUT_ASSETS,
  VIDEO_INPUT_ASSET_ROLES,
  type VideoInputAsset,
  type VideoInputAssetRole,
};

/** 上傳前的檔案檢查結果轉成可讀中文訊息（供 toast/表單顯示）。null = 通過。 */
export function inputAssetRejectionMessage(file: File): string | null {
  const result = validateAssetFile({ mime: file.type, sizeBytes: file.size });
  if (result.ok) return null;
  if (result.reason === "too_large") {
    const mb = Math.round(MAX_INPUT_ASSET_BYTES / (1024 * 1024));
    return `檔案超過 ${mb}MB 上限`;
  }
  return "不支援的檔案類型（僅接受 PNG／JPG／MP3／WAV）";
}

/**
 * 若指定 role 與檔案模態不一致，回退到該模態的預設 role；未指定則用預設。
 * 例如把 MP3 指定成 style_reference 會被校正為 background_music。
 */
function resolveRoleForFile(
  file: File,
  requestedRole?: VideoInputAssetRole,
): VideoInputAssetRole | null {
  const type = inferAssetTypeFromMime(file.type);
  if (!type) return null;
  if (requestedRole && ROLE_TO_TYPE[requestedRole] === type) return requestedRole;
  return defaultRoleForType(type);
}

/**
 * 上傳單一素材並回傳契約物件。驗證失敗直接 throw（呼叫端以 toast 呈現訊息）。
 *
 * @param requestedRole 使用者選定的用途；與檔案模態不符時自動校正為合理預設。
 */
export async function uploadVideoInputAsset(
  file: File,
  requestedRole?: VideoInputAssetRole,
): Promise<VideoInputAsset> {
  const rejection = inputAssetRejectionMessage(file);
  if (rejection) throw new Error(rejection);

  const role = resolveRoleForFile(file, requestedRole);
  const type = inferAssetTypeFromMime(file.type);
  if (!role || !type) throw new Error("不支援的檔案類型（僅接受 PNG／JPG／MP3／WAV）");

  const { url } = await uploadFileToS3(file);
  return { type, url, role };
}
