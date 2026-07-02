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
  MAX_INPUT_ASSET_BYTES_BY_TYPE,
  MAX_INPUT_ASSETS,
  ROLE_TO_TYPE,
  VIDEO_INPUT_ASSET_ROLES,
  defaultRoleForType,
  inferAssetTypeFromMime,
  validateAssetFile,
  type VideoInputAsset,
  type VideoInputAssetRole,
  type VideoInputAssetType,
} from "@shared/video-input-assets";

export {
  MAX_INPUT_ASSET_BYTES_BY_TYPE,
  MAX_INPUT_ASSETS,
  ROLE_TO_TYPE,
  VIDEO_INPUT_ASSET_ROLES,
  type VideoInputAsset,
  type VideoInputAssetRole,
  type VideoInputAssetType,
};

/** 角色的中文顯示名（上傳區塊 Select 與錯誤訊息共用）。 */
export const ROLE_LABELS: Record<VideoInputAssetRole, string> = {
  style_reference: "視覺風格參考",
  product_shot: "產品照",
  background_music: "背景音樂",
};

/** 上傳前的檔案檢查結果轉成可讀中文訊息（供 toast/表單顯示）。null = 通過。 */
export function inputAssetRejectionMessage(file: File): string | null {
  const result = validateAssetFile({
    mime: file.type,
    sizeBytes: file.size,
    fileName: file.name,
  });
  if (result.ok) return null;
  if (result.reason === "too_large") {
    // 走到 too_large 代表型別已可辨識，依模態顯示對應上限（image 10MB / audio 20MB）。
    const type = inferAssetTypeFromMime(file.type, file.name) ?? "audio";
    const mb = Math.round(MAX_INPUT_ASSET_BYTES_BY_TYPE[type] / (1024 * 1024));
    return `檔案超過 ${mb}MB 上限`;
  }
  if (result.reason === "empty_file") return "檔案是空的";
  return "不支援的檔案類型（僅接受 PNG／JPG／MP3／WAV）";
}

/**
 * 解析檔案應使用的角色。明確指定的 role 與檔案模態不符時直接 throw
 * （靜默校正會讓使用者以為選擇生效了——例如把 MP3 指成視覺風格參考，
 * 實際卻被改成背景音樂）；未指定 requestedRole 才用該模態的預設角色。
 */
function resolveRoleForFile(
  file: File,
  requestedRole?: VideoInputAssetRole,
): VideoInputAssetRole | null {
  const type = inferAssetTypeFromMime(file.type, file.name);
  if (!type) return null;
  if (requestedRole) {
    const expectedType = ROLE_TO_TYPE[requestedRole];
    if (expectedType !== type) {
      throw new Error(
        `${ROLE_LABELS[requestedRole]}需為${expectedType === "image" ? "影像" : "音訊"}檔`,
      );
    }
    return requestedRole;
  }
  return defaultRoleForType(type);
}

/**
 * 上傳單一素材並回傳契約物件。驗證失敗直接 throw（呼叫端以 toast 呈現訊息）。
 *
 * @param requestedRole 使用者選定的用途；與檔案模態不符時 throw（不再靜默校正）。
 */
export async function uploadVideoInputAsset(
  file: File,
  requestedRole?: VideoInputAssetRole,
): Promise<VideoInputAsset> {
  const rejection = inputAssetRejectionMessage(file);
  if (rejection) throw new Error(rejection);

  const role = resolveRoleForFile(file, requestedRole);
  const type = inferAssetTypeFromMime(file.type, file.name);
  if (!role || !type) throw new Error("不支援的檔案類型（僅接受 PNG／JPG／MP3／WAV）");

  const { url } = await uploadFileToS3(file);
  return { type, url, role };
}
