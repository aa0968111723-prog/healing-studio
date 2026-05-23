/**
 * commanderFormat — pure display helpers for the M1-B intent composer.
 *
 * mode / status 標籤抽成獨立模組，方便不依賴 tRPC 做單元測試，且與後端
 * orchestration_runs 的 enum 對齊（server: subsystems/commander/contracts.ts）。
 */

export type OrchestrationMode =
  | "create"
  | "director"
  | "video"
  | "assets"
  | "database";

export const ORCHESTRATION_MODE_OPTIONS: Array<{
  value: OrchestrationMode;
  label: string;
  hint: string;
}> = [
  { value: "create", label: "創作", hint: "一般創作意圖" },
  { value: "director", label: "導演", hint: "腳本 / 分鏡 / 導演 AI" },
  { value: "video", label: "影片", hint: "影片生成與合成" },
  { value: "assets", label: "資產", hint: "素材匯入 / 整理 / 引用" },
  { value: "database", label: "資料庫", hint: "團隊資料查詢與引用" },
];

export function modeLabel(mode: string): string {
  return (
    ORCHESTRATION_MODE_OPTIONS.find(m => m.value === mode)?.label ?? mode
  );
}

const RUN_STATUS_LABELS: Record<string, string> = {
  pending: "已記錄（等待規劃）",
  planned: "已規劃",
  waiting_confirmation: "等待確認",
  running: "執行中",
  completed: "已完成",
  failed: "失敗",
  cancelled: "已取消",
};

export function runStatusLabel(status: string): string {
  return RUN_STATUS_LABELS[status] ?? status;
}

/** 第一階段尚未估算成本時的顯示文案。 */
export function costPreviewLabel(estimatedCostUsd: number | null): string {
  if (estimatedCostUsd == null) return "成本尚未估算";
  return `預估 $${estimatedCostUsd.toFixed(4)}`;
}
