/**
 * validateSafeUrl — AIDV-201 SSRF 防護
 *
 * AIDV-270：isSafeExternalUrl 純函式搬到 shared/safe-url.ts（前後端共用，
 * /video 輸入素材契約的 url refine 也用同一套規則）；此檔改為 re-export，
 * 對外簽名（isSafeExternalUrl / safeExternalUrl / safeExternalUrlOptional）零變化。
 */
import { z } from "zod";
import { isSafeExternalUrl } from "../../shared/safe-url";

export { isSafeExternalUrl };

/** Zod schema：必填安全外部 URL（https + 非私有）。 */
export const safeExternalUrl = z
  .string()
  .url()
  .refine(isSafeExternalUrl, { message: "URL 必須使用 https 且不可指向內部網路或私有 IP" });

/** Zod schema：選填版本。 */
export const safeExternalUrlOptional = safeExternalUrl.optional();
