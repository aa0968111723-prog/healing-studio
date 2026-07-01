// ============================================================================
// social/socialErrors.ts — AIDV-957：/social 文案生成錯誤，面向使用者訊息 vs 除錯線索分離
// ----------------------------------------------------------------------------
// 問題：commander.directorReply 失敗時，toast 直接把內部環境變數字樣（COMMANDER_ADAPTER
//   等）丟給一般創作者，看不懂又像產品壞了，且屬輕微內部設定外洩。
// 修法：使用者只看白話可行動文案；任何除錯線索只寫進 console，不進 UI。
// ============================================================================

/** 面向創作者的白話錯誤文案（不含任何內部環境變數/設定字樣）。 */
export const SOCIAL_COPY_GENERATION_ERROR_MESSAGE =
  "文案生成暫時失敗，請稍後再試；若持續失敗，請聯繫支援。";

/**
 * 記錄文案生成失敗的除錯線索到 console（開發者可見，使用者看不到）。
 * @param error 原始錯誤（可能包含內部設定資訊，僅供 console）
 */
export function logSocialCopyGenerationError(error: unknown): void {
  // eslint-disable-next-line no-console
  console.error("[social] AI 出文案失敗：", error);
}
