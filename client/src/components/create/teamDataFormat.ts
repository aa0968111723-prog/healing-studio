/**
 * teamDataFormat — pure display helpers for M4 團隊資料 / 資料來源 UI.
 *
 * 抽成獨立模組讓顯示邏輯（存取層級、來源類型、命中方式、連接狀態、供應商）可以
 * 不依賴 tRPC / DOM 直接做單元測試。
 */

const ACCESS_LEVEL_LABELS: Record<string, string> = {
  none: "不開放",
  summary_only: "僅摘要",
  chunk_access: "片段",
  full_reference: "完整引用",
};

export function accessLevelLabel(level: string): string {
  return ACCESS_LEVEL_LABELS[level] ?? level;
}

const DATA_SOURCE_KIND_LABELS: Record<string, string> = {
  team_data: "團隊資料",
  cloud: "雲端",
  notes: "筆記",
  mcp: "MCP",
  external_api: "外部 API",
};

export function dataSourceKindLabel(kind: string): string {
  return DATA_SOURCE_KIND_LABELS[kind] ?? kind;
}

const MATCHED_BY_LABELS: Record<string, string> = {
  vector: "語意",
  fts: "關鍵字",
};

export function matchedByLabel(matchedBy: string | null | undefined): string {
  if (!matchedBy) return "";
  return MATCHED_BY_LABELS[matchedBy] ?? matchedBy;
}

const CONNECTION_STATUS_LABELS: Record<string, string> = {
  pending: "待驗證",
  active: "啟用中",
  disabled: "已停用",
  error: "連線異常",
};

export function connectionStatusLabel(status: string): string {
  return CONNECTION_STATUS_LABELS[status] ?? status;
}

const PROVIDER_LABELS: Record<string, string> = {
  google_drive: "Google Drive",
  notion: "Notion",
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}
