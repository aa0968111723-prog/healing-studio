/**
 * Brain Pipeline Visualization — Shared Types
 *
 * 前後端共用的「AI 大腦組態管線」資料結構。後端 `brainPipeline.getGraph` /
 * `brainPipeline.getMyGraph` 回傳這些型別；前端 `AiBrainPipelinePage` 與
 * `MyBrainPage` 直接渲染為 React Flow 節點圖。
 */

export type PipelineNodeStatus =
  | "healthy"
  | "needs_optimization"
  | "broken"
  | "abnormal";

export type PipelineNodeKind =
  | "page"
  | "page-group"
  | "router"
  | "brain-slot"
  | "engine-slot"
  | "orb-agent"
  | "orb-assistant"
  | "director"
  | "studio"
  | "provider";

export type PipelineLayer =
  | "frontend"
  | "backend"
  | "ai-brain"
  | "external";

export interface PipelineNodeMetrics {
  /** 連續失敗次數（health cache 提供） */
  consecutiveFailures?: number;
  /** 最後一次錯誤訊息（已脫敏） */
  lastError?: string;
  /** 最近錯誤 trace 數量 */
  recentErrorCount?: number;
  /** 最後更新時間（unix ms） */
  updatedAt?: number;
}

export interface PipelineNodeDiagnostics {
  frontendPath?: string;
  backendRoute?: string;
  serviceFunction?: string;
  traceSampleIds?: string[];
}

export interface PipelineNode {
  /** 全域唯一 id，例如 "provider:fal", "page:home", "brain:director" */
  id: string;
  kind: PipelineNodeKind;
  layer: PipelineLayer;
  /** 顯示用標籤（中文白話） */
  label: string;
  /** 一句話說明此節點是做什麼的 */
  description?: string;
  /** 目前狀態 */
  status: PipelineNodeStatus;
  /** 白話原因（出現問題時） */
  reason?: string;
  /** 白話建議（如何修復／優化） */
  recommendation?: string;
  /** 相關檔案（可點擊跳轉） */
  relatedFiles?: string[];
  /** 數值指標 */
  metrics?: PipelineNodeMetrics;
  /** 節點級排查資訊（對應檔案/路由/服務/trace） */
  diagnostics?: PipelineNodeDiagnostics;
  /** 子項目（例如 page-group 內的頁面 id 清單） */
  children?: string[];
  /** 群組節點 id（被折疊到哪個 page-group 之下） */
  parentId?: string;
}

export interface PipelineEdge {
  id: string;
  source: string;
  target: string;
  /** edge 標籤，例如 "tRPC"、"HTTPS"、"fallback" */
  label?: string;
  /** edge 風格 — 由起點 status 決定顏色 */
  style?: "solid" | "dashed" | "dotted";
}

export interface PipelineSummary {
  healthy: number;
  needsOptimization: number;
  broken: number;
  abnormal: number;
  totalNodes: number;
  /** 整張圖最後一次組裝時間 */
  lastUpdatedAt: number;
}

export interface PipelineGraph {
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  summary: PipelineSummary;
  /** 圖例：UI 用 */
  legend: Array<{
    status: PipelineNodeStatus;
    label: string;
    description: string;
  }>;
}

/** UI 顯示用：狀態到顏色的對照（前後端皆可參考）。 */
export const STATUS_COLOR: Record<PipelineNodeStatus, string> = {
  healthy: "#22c55e", // green-500
  needs_optimization: "#eab308", // yellow-500
  broken: "#ef4444", // red-500
  abnormal: "#f97316", // orange-500
};

export const STATUS_LABEL: Record<PipelineNodeStatus, string> = {
  healthy: "正常通暢",
  needs_optimization: "需要優化",
  broken: "損壞需修復",
  abnormal: "功能異常",
};

export const STATUS_DESCRIPTION: Record<PipelineNodeStatus, string> = {
  healthy: "目前運作正常，沒有偵測到問題",
  needs_optimization: "可以運作但建議調整以提升穩定度或效能",
  broken: "完全無法運作，需要立刻修復",
  abnormal: "行為與預期不符，可能是設定錯誤或資料不一致",
};
