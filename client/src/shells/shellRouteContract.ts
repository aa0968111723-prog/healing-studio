// ============================================================================
// shells/shellRouteContract.ts — ShellRoutes 兩態合約的「純資料」真相源（零 React 樹）
// ----------------------------------------------------------------------------
// 只依賴 shellRouteTable 的資料常數（LEGACY_REDIRECTS）＋ ShellId 型別，
// **不 import 任何 shell 元件**（VideoShell/SocialShell/LearnShell/SettingsShell）。
//
// 為什麼獨立成檔：ShellRoutes.tsx 直接 import 四個 shell 元件（→ VideoCockpitFrame→
// DashboardLayout 等巨大依賴圖）。route-parity 測試只需驗「旗標兩態下注入幾條 Route」這個
// **純整數合約**，不需要那棵 React 樹。把合約抽到本檔，測試靜態 import 它即可恆定毫秒級驗證，
// 不必 vi.resetModules()＋動態冷重載整圖（先前在全套件併發負載下會冷編譯 timeout＝flaky gate）。
//
// 真相源耦合：ShellRoutes.tsx 的 shellRoutes() 以本檔的 SHELL_ID_COUNT／expectedShellRouteCount
// 為注入條數依據（見該檔），故「測本檔＝測 shellRoutes() 的兩態合約」，不會漂移。
// ============================================================================
import type { ShellId } from "@/spine/types";
import { LEGACY_REDIRECTS } from "@/shells/shellRouteTable";

/** 四個 shell 的 id（與 ShellRoutes.tsx 的 SHELL_COMPONENTS keys 一致）。 */
export const SHELL_IDS: readonly ShellId[] = ["video", "social", "learn", "settings"] as const;

/** 每個 shell 掛載 2 條 Route：裸前綴 `/id` + 萬用子路徑 `/id/:rest*`。 */
export const MOUNTS_PER_SHELL = 2;

/** shell 掛載點總數 = 4 殼 × 2 條。 */
export const SHELL_MOUNT_COUNT = SHELL_IDS.length * MOUNTS_PER_SHELL;

/**
 * shellRoutes() 在「給定旗標兩態」下應注入的 Route 條數（純函式、無副作用、不碰 React 樹）。
 *   - OFF → 0（防禦性短路 / 回滾退路：路由集合與舊線上完全一致）。
 *   - ON  → LEGACY_REDIRECTS.length（每條舊→新相容導向）+ 4 殼 × 2 掛載。
 */
export function expectedShellRouteCount(enabled: boolean): number {
  if (!enabled) return 0;
  return LEGACY_REDIRECTS.length + SHELL_MOUNT_COUNT;
}
