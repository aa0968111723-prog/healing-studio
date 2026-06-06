// ============================================================================
// viewMode.ts — 共用 ViewMode 型別（拆 PersonalSettingsContext ⇄ useMobile 循環依賴）
// ----------------------------------------------------------------------------
// 【為什麼有這個檔】GitNexus 程式碼知識圖譜在 main HEAD 2888a36 偵測到一條 2-node
// 循環依賴：
//
//     useMobile.tsx ──(value import: usePersonalSettings)──▶ PersonalSettingsContext.tsx
//     PersonalSettingsContext.tsx ──(type import: ViewMode)──▶ useMobile.tsx
//
// PersonalSettingsContext 同時是「最被依賴的脊椎 provider（×4）」，抽 SpineProvider 時
// 這條環會被一起拉到脊椎層，可能造成初始化順序 / HMR 問題（GitNexus §B.3）。
//
// 【修法（GitNexus 建議：下沉到共用 util）】把 useMobile 對外輸出的 `ViewMode` 純型別
// 下沉到本檔（葉節點，零依賴）。於是：
//   - PersonalSettingsContext 改 import 自 "@/hooks/viewMode"（不再指向 useMobile）→ 斷環。
//   - useMobile.tsx 改成「re-export 本檔的 ViewMode」→ 既有 23 個 `@/hooks/useMobile` 消費端
//     一行都不用改。
//
// ViewMode 是純型別、編譯期抹除，搬移它「零執行期行為改變」。
// ============================================================================

/**
 * 檢視模式：
 *  - "auto"    依視窗寬度自動判斷（< 768px 視為 mobile）
 *  - "desktop" 強制桌面版（在手機上以縮放呈現桌面布局）
 *  - "mobile"  強制行動版
 */
export type ViewMode = "auto" | "desktop" | "mobile";
