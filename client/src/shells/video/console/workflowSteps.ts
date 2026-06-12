// ============================================================================
// shells/video/console/workflowSteps.ts — Wave 0 導演台「可設定工作流」步驟常數
// ----------------------------------------------------------------------------
// 來源：原型 app.js DEFAULT_WF / STEP_LIB（設計系統 §14.2 WorkflowBuilder）。
// 六步＝**預設範本**，非寫死流程：使用者可在 WorkflowBuilder（2-17 工作流設定）
//   新增／刪除／重排／啟用停用。必經步驟（intent·asset·gate·done）不可刪/停。
//
// 【後端待補】步驟自訂持久化＝ user_workflows / workflow_steps（候選 workflowEngine.*
//   / planExecutor.*）。Wave 0 先用 console 本地狀態頂住（見 DirectorConsoleProvider）。
//
// 每個步驟對映導演台中欄「創作畫布」的一個 canvas 模式（canvasMode），讓頂部創作流程列
// 成為串起子系統的主軸（一體成形：點階段 → 切畫布，不整頁離場）。
// ============================================================================
import type { CanvasMode } from "../DirectorConsoleProvider";

/** 工作流步驟（對齊設計系統 §14.2 WorkflowStep）。 */
export interface WorkflowStep {
  id: string;
  name: string;
  /** 必經步驟：不可刪除、不可停用。 */
  required: boolean;
  /** 是否啟用（停用＝不出現在創作流程列）。 */
  enabled: boolean;
  /** 點此步驟時切到的中欄畫布模式（未指定＝chat 導演對話）。 */
  canvasMode?: CanvasMode;
  /** 可選的待後端註記（顯示「待後端」徽章）。 */
  pending?: boolean;
}

/** /video 預設工作流範本（六步）。 */
export const DEFAULT_WORKFLOW: WorkflowStep[] = [
  { id: "intent", name: "腳本意圖", required: true, enabled: true, canvasMode: "script" },
  { id: "entry", name: "非線性入口", required: false, enabled: true, canvasMode: "chat" },
  { id: "asset", name: "多模態素材", required: true, enabled: true, canvasMode: "asset" },
  { id: "rough", name: "打包初剪", required: false, enabled: true, canvasMode: "shot", pending: true },
  { id: "gate", name: "確認修改", required: true, enabled: true, canvasMode: "shot" },
  { id: "done", name: "完成專案", required: true, enabled: true, canvasMode: "chat" },
];

/** 可加入的步驟庫（設計系統 §14.2）。 */
export const STEP_LIBRARY: { id: string; name: string; canvasMode?: CanvasMode; pending?: boolean }[] = [
  { id: "world", name: "世界觀設定", canvasMode: "chat" },
  { id: "lora", name: "角色 LoRA 訓練", canvasMode: "chat", pending: true },
  { id: "voice", name: "配音/環境音", canvasMode: "voice" },
  { id: "music", name: "配樂", canvasMode: "music" },
  { id: "publish", name: "發佈/精選", canvasMode: "chat", pending: true },
  { id: "review", name: "同儕審閱", canvasMode: "chat", pending: true },
];

/** 深複製一份預設範本（避免共用參照被就地修改）。 */
export function freshDefaultWorkflow(): WorkflowStep[] {
  return DEFAULT_WORKFLOW.map((s) => ({ ...s }));
}
