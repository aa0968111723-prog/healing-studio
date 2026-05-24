/**
 * projectContextFormat — pure display helpers for the M1-A Active Project panel.
 *
 * 抽成獨立模組讓顯示邏輯（狀態標籤、素材型別、時間格式、待補區塊文案）可以
 * 不依賴 tRPC / DOM 直接做單元測試。
 */

export type ProjectStatus = "concept" | "production" | "review" | "complete";

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  concept: "概念中",
  production: "製作中",
  review: "審查中",
  complete: "完成",
};

const ASSET_TYPE_LABELS: Record<string, string> = {
  image: "圖片",
  video: "影片",
  audio: "音訊",
  voice: "配音",
  script: "腳本",
  zip_bundle: "製作包",
};

export function assetTypeLabel(assetType: string): string {
  return ASSET_TYPE_LABELS[assetType] ?? assetType;
}

const PENDING_SECTION_LABELS: Record<string, string> = {
  teamData: "團隊資料摘要",
  budget: "成本預算",
  projectScopedAssets: "依專案篩選的素材",
};

export function pendingSectionLabels(
  sections: readonly string[],
): Array<{ key: string; label: string }> {
  return sections.map(key => ({
    key,
    label: PENDING_SECTION_LABELS[key] ?? key,
  }));
}

/** 把 ISO 時間轉成本地可讀字串；無法解析時回傳原字串。 */
export function formatUpdatedAt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

/** 未選專案時的非阻塞提示文案（建立專案 / 稍後再說）。 */
export const NO_ACTIVE_PROJECT_HINT =
  "尚未選擇創作專案。你仍然可以直接開始創作，但建立專案後才能保存上下文、素材、影片任務與資料引用。";
