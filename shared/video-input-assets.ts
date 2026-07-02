/**
 * video-input-assets.ts — /video 多模態輸入素材契約（AIDV-270）
 *
 * 單一真實來源：影片專案的 `input_assets` 陣列型別、Zod 驗證、模態一致性規則，
 * 以及「影像素材 → Fal.ai image-to-video 的 image_url」選取邏輯。
 *
 * 同時被以下三處引用，確保契約一致（不重複定義、突變即全部連動）：
 *   - drizzle/schema.ts        — video_projects.input_assets JSON 欄位型別（type-only import）
 *   - server/routers/videoProject.ts、server/routes/videoRoute.ts — 建立/更新時驗證與持久化
 *   - client/src/lib/videoInputAssets.ts — 前端上傳素材前的型別/大小/角色驗證
 *
 * 範圍（放行令 triage 結論）：本契約涵蓋 image（走 fal image_url，i2v 已支援）與
 * audio（背景音樂，僅登記 URL）。audio 的 FFmpeg 混音為第二階段 follow-up，本檔不做——
 * 僅把 audio 素材登記進契約，混音步驟另卡處理。
 */

import { z } from "zod";

/** 素材模態：影像或音訊。 */
export const VIDEO_INPUT_ASSET_TYPES = ["image", "audio"] as const;
export type VideoInputAssetType = (typeof VIDEO_INPUT_ASSET_TYPES)[number];

/** 素材用途角色。與驗收條件對齊：style_reference / product_shot（影像）、background_music（音訊）。 */
export const VIDEO_INPUT_ASSET_ROLES = [
  "style_reference",
  "product_shot",
  "background_music",
] as const;
export type VideoInputAssetRole = (typeof VIDEO_INPUT_ASSET_ROLES)[number];

/**
 * 角色 → 允許的模態。角色與模態必須一致（例如 background_music 只能是 audio），
 * 避免把音檔誤標成視覺風格參考、或把圖片送進音軌。
 */
export const ROLE_TO_TYPE: Record<VideoInputAssetRole, VideoInputAssetType> = {
  style_reference: "image",
  product_shot: "image",
  background_music: "audio",
};

/** 單一請求可攜帶的素材數量上限（防呆 + 防止過大 payload）。 */
export const MAX_INPUT_ASSETS = 8;

/** 單一素材檔案大小上限：50MB（驗收條件）。 */
export const MAX_INPUT_ASSET_BYTES = 50 * 1024 * 1024;

/** 允許的影像 MIME（PNG / JPG）。 */
export const ALLOWED_IMAGE_MIME_TYPES = ["image/png", "image/jpeg"] as const;

/** 允許的音訊 MIME（MP3 / WAV，含常見別名）。 */
export const ALLOWED_AUDIO_MIME_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
] as const;

/**
 * 單一輸入素材的 Zod schema。
 *
 * superRefine 強制「角色 ↔ 模態」一致（ROLE_TO_TYPE），這是模態安全的核心防線：
 * 前端若送 `{type:"audio", role:"style_reference"}` 會被擋在契約層，而非流到下游 fal 派發。
 */
export const videoInputAssetSchema = z
  .object({
    type: z.enum(VIDEO_INPUT_ASSET_TYPES),
    url: z.string().url().max(2048),
    role: z.enum(VIDEO_INPUT_ASSET_ROLES),
  })
  .superRefine((val, ctx) => {
    const expectedType = ROLE_TO_TYPE[val.role];
    if (expectedType !== val.type) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `角色 "${val.role}" 需搭配模態 "${expectedType}"（收到 "${val.type}"）`,
        path: ["type"],
      });
    }
  });

/** 輸入素材陣列的 Zod schema（含數量上限）。 */
export const videoInputAssetsSchema = z
  .array(videoInputAssetSchema)
  .max(MAX_INPUT_ASSETS, `素材數量上限為 ${MAX_INPUT_ASSETS} 個`);

/** 契約型別（drizzle JSON 欄位與各端共用此型別）。 */
export type VideoInputAsset = z.infer<typeof videoInputAssetSchema>;

/**
 * 從素材陣列選出要餵給 Fal.ai image-to-video 的 `image_url`。
 *
 * 規則（可預期、穩定）：
 *   - 只考慮 type === "image" 的素材。
 *   - 優先 role === "style_reference"（品牌視覺/情緒板優先於單張產品圖）。
 *   - 其次 role === "product_shot"。
 *   - 皆無則取陣列中第一張影像。
 *   - 沒有任何影像 → null（呼叫端維持既有純文字 → 生成路徑，不注入 image_url）。
 *
 * 純函式、與 fal 派發解耦：i2v 端只需拿此 URL 當 image_url，其餘行為不變（加性）。
 */
export function selectFalImageUrl(
  assets: readonly VideoInputAsset[] | null | undefined,
): string | null {
  if (!assets || assets.length === 0) return null;
  const images = assets.filter(a => a.type === "image");
  if (images.length === 0) return null;
  const byRole = (role: VideoInputAssetRole) => images.find(a => a.role === role);
  return (
    byRole("style_reference")?.url ??
    byRole("product_shot")?.url ??
    images[0].url
  );
}

/** 是否為允許的影像 MIME。 */
export function isAllowedImageMime(mime: string): boolean {
  return (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(mime.toLowerCase());
}

/** 是否為允許的音訊 MIME。 */
export function isAllowedAudioMime(mime: string): boolean {
  return (ALLOWED_AUDIO_MIME_TYPES as readonly string[]).includes(mime.toLowerCase());
}

/**
 * 由 MIME 推斷素材模態；不在允許清單內回 null（呼叫端據此拒絕上傳）。
 * 純函式，前端上傳前與後端契約層皆可共用。
 */
export function inferAssetTypeFromMime(mime: string): VideoInputAssetType | null {
  if (isAllowedImageMime(mime)) return "image";
  if (isAllowedAudioMime(mime)) return "audio";
  return null;
}

/** 該模態的預設角色（前端上傳時的合理預設，使用者仍可改）。 */
export function defaultRoleForType(type: VideoInputAssetType): VideoInputAssetRole {
  return type === "image" ? "style_reference" : "background_music";
}

export interface AssetFileValidationInput {
  mime: string;
  sizeBytes: number;
}

export type AssetFileValidationResult =
  | { ok: true; type: VideoInputAssetType }
  | { ok: false; reason: "unsupported_type" | "too_large" };

/**
 * 上傳前的檔案驗證：型別在白名單內且 ≤ 50MB。
 * 純函式，前端拖放時即時擋掉不合法檔案，避免無謂上傳。
 */
export function validateAssetFile(
  input: AssetFileValidationInput,
): AssetFileValidationResult {
  const type = inferAssetTypeFromMime(input.mime);
  if (!type) return { ok: false, reason: "unsupported_type" };
  if (input.sizeBytes > MAX_INPUT_ASSET_BYTES) return { ok: false, reason: "too_large" };
  return { ok: true, type };
}
