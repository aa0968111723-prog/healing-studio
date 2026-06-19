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
import { ENABLE_VOICE_MUSIC_WORKFLOW } from "@/config/videoFlags";

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
  { id: "rough", name: "打包初剪", required: false, enabled: true, canvasMode: "rough-cut" },
  { id: "gate", name: "確認修改", required: true, enabled: true, canvasMode: "shot" },
  { id: "done", name: "完成專案", required: true, enabled: true, canvasMode: "chat" },
];

/**
 * AIDV-12 配音/配樂兩步（已實裝，接真實 proStudio.*）。旗標 ON 時插進預設工作流。
 * 屬「初剪階段」之後、「確認修改」之前的創作順序（初剪 → 配音/配樂 → 確認）。
 * required:false（非必經，可在 WorkflowBuilder 刪/停）、enabled:true（出現在創作流程列）。
 */
const VOICE_STEP: WorkflowStep = { id: "voice", name: "配音/環境音", required: false, enabled: true, canvasMode: "voice" };
const MUSIC_STEP: WorkflowStep = { id: "music", name: "配樂", required: false, enabled: true, canvasMode: "music" };

/**
 * 可加入的步驟庫（設計系統 §14.2）。
 * 旗標 ON 時 voice/music 已進 DEFAULT_WORKFLOW（見 freshDefaultWorkflow），故不重覆列入步驟庫，
 * 避免 WorkflowBuilder 的「加入」按鈕對已在流程中的步驟永遠灰掉。旗標 OFF 時仍可從步驟庫手動加入。
 */
export const STEP_LIBRARY: { id: string; name: string; canvasMode?: CanvasMode; pending?: boolean }[] = [
  { id: "world", name: "世界觀設定", canvasMode: "chat" },
  { id: "lora", name: "角色 LoRA 訓練", canvasMode: "chat", pending: true },
  ...(ENABLE_VOICE_MUSIC_WORKFLOW
    ? []
    : [
        { id: "voice", name: "配音/環境音", canvasMode: "voice" as CanvasMode },
        { id: "music", name: "配樂", canvasMode: "music" as CanvasMode },
      ]),
  { id: "publish", name: "發佈/精選", canvasMode: "chat", pending: true },
  { id: "review", name: "同儕審閱", canvasMode: "chat", pending: true },
];

/**
 * 深複製一份預設範本（避免共用參照被就地修改）。
 * 旗標 ENABLE_VOICE_MUSIC_WORKFLOW（預設 OFF）OFF 時 → 與既有六步位元相同（零行為改變）。
 * ON 時 → 在「打包初剪（rough）」之後插入 配音/環境音、配樂 兩步（接 VoiceAmbientCanvas / MusicCanvas）。
 */
export function freshDefaultWorkflow(): WorkflowStep[] {
  const base = DEFAULT_WORKFLOW.map((s) => ({ ...s }));
  if (!ENABLE_VOICE_MUSIC_WORKFLOW) return base;
  const at = base.findIndex((s) => s.id === "rough");
  const insertAt = at >= 0 ? at + 1 : base.length;
  base.splice(insertAt, 0, { ...VOICE_STEP }, { ...MUSIC_STEP });
  return base;
}
