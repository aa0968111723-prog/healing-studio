/**
 * orbChatHelpers.ts — 光球聊天輔助工具
 * ────────────────────────────────────────────────────────────────────────────
 * 提供聊天訊息顯示相關的輔助函數：
 *   - 根據頁面路徑獲取頁面標籤
 *   - 格式化相對時間戳
 *   - 格式化訊息顯示
 */

import { getPageByPath } from "@/config/appRegistry";

/**
 * 根據頁面路徑獲取頁面標籤
 * @param path 頁面路徑，例如 "/studio" 或 "/image-studio"
 * @returns 頁面標籤，例如 "創作工作室" 或 "圖像工作室"
 */
export function getPageLabelByPath(path: string | undefined): string | null {
  if (!path) return null;
  const page = getPageByPath(path);
  return page?.label ?? null;
}

/**
 * 將時間戳轉換為相對時間顯示
 * @param timestamp 毫秒時間戳
 * @returns 相對時間字串，例如 "2 分鐘前"、"1 小時前"
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) {
    return "剛剛";
  } else if (minutes < 60) {
    return `${minutes} 分鐘前`;
  } else if (hours < 24) {
    return `${hours} 小時前`;
  } else if (days < 7) {
    return `${days} 天前`;
  } else {
    // 超過 7 天顯示日期
    const date = new Date(timestamp);
    return date.toLocaleDateString("zh-TW", {
      month: "short",
      day: "numeric",
    });
  }
}

/**
 * 格式化完整的訊息元數據顯示
 * @param pagePath 頁面路徑
 * @param timestamp 時間戳
 * @returns 格式化的元數據字串，例如 "[創作工作室] 2 分鐘前"
 */
export function formatMessageMetadata(
  pagePath: string | undefined,
  timestamp: number
): string {
  const parts: string[] = [];

  const pageLabel = getPageLabelByPath(pagePath);
  if (pageLabel) {
    parts.push(`[${pageLabel}]`);
  }

  const relativeTime = formatRelativeTime(timestamp);
  parts.push(relativeTime);

  return parts.join(" ");
}

/**
 * 獲取頁面標籤的表情符號
 * @param path 頁面路徑
 * @returns 表情符號，例如 "🎨"、"🎬"、"🎵"
 */
export function getPageEmoji(path: string | undefined): string {
  if (!path) return "💬";

  // 根據頁面路徑返回對應的表情符號
  if (path.includes("/studio")) return "🎨";
  if (path.includes("/image")) return "🖼️";
  if (path.includes("/video")) return "🎬";
  if (path.includes("/audio") || path.includes("/pro-studio")) return "🎵";
  if (path.includes("/voice")) return "🎤";
  if (path.includes("/director")) return "🎭";
  if (path.includes("/lora") || path.includes("/train")) return "🔧";
  if (path.includes("/history")) return "📚";
  if (path.includes("/notes")) return "📝";
  if (path.includes("/calendar")) return "📅";
  if (path.includes("/settings")) return "⚙️";
  if (path.includes("/learn")) return "📖";
  if (path.includes("/agent")) return "✨";

  return "💬";
}
