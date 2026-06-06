// ============================================================================
// config/shells.ts — 四個 shell 的中繼資料（SHELL_META）
// ----------------------------------------------------------------------------
// 對映 shared/appRegistry.ts 的 group → shell 收編（整合指南 §4.2）：
//   create + train + orb(創作)  → video
//   learn                       → learn
//   settings + admin            → settings
//   project + assets            → 脊椎（跨 shell，不歸單一 shell；維持頂層路由）
//   （新，無既有頁）             → social
//
// flag：null = 永遠顯示；否則對映 featureFlags 的開關（OFF 時 shell 顯示「已關閉」佔位）。
// ============================================================================
import type { ShellId } from "@/spine/types";
import { SHELL_SOCIAL, SHELL_LEARN } from "./featureFlags";

export interface ShellMeta {
  id: ShellId;
  path: string;
  zh: string;
  en: string;
  emoji: string;
  /** 顯示開關（true = 顯示 shell 內容；false = 顯示「已由管理員關閉」佔位）。 */
  enabled: boolean;
}

export const SHELL_META: ShellMeta[] = [
  { id: "video", path: "/video", zh: "影片製作", en: "VIDEO", emoji: "🎬", enabled: true },
  { id: "social", path: "/social", zh: "社群圖文", en: "SOCIAL", emoji: "🖼", enabled: SHELL_SOCIAL },
  { id: "learn", path: "/learn", zh: "學習文件", en: "LEARN", emoji: "📚", enabled: SHELL_LEARN },
  { id: "settings", path: "/settings", zh: "設定", en: "SETTINGS", emoji: "⚙", enabled: true },
];

export const SHELL_BY_ID: Record<ShellId, ShellMeta> = Object.fromEntries(
  SHELL_META.map((s) => [s.id, s]),
) as Record<ShellId, ShellMeta>;
