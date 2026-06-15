/* AI Director · 共用模式「可設定工作流」WorkflowBuilder（跨 shell：/video + /social）
   ──────────────────────────────────────────────────────────────────────────
   工作流「步驟」可由使用者新增／刪除／重排／啟用停用。/video 六步、/social 九步皆為
   「預設範本」，非寫死流程。頂部一條龍流程列（StageBar）反映「啟用步驟」集，與非線性
   入口（可跳階）相容。
   ⚠ 真實持久化：步驟自訂屬資料模型，**待補（歸後端）**——建議表 user_workflows /
     workflow_steps（per 專案 / per 範本）＋ procedure workflow.{getTemplates,
     createTemplate,saveForProject,resetToDefault}；repo 現有 workflowEngine.* /
     planExecutor.* 為接點候選。以 _GitNexus程式碼真實對照表.md 核對（任務 #12）。 */
import * as React from "react";
import { Button, Pill } from "./primitives";
import { cn } from "./tokens";

export interface WorkflowStep { id: string; name: string; required: boolean; enabled: boolean; }
export interface Workflow { id: string; name: string; scope: "project" | "template"; steps: WorkflowStep[]; }

/** /video 預設工作流範本（六步；必經：意圖·素材·確認·完成） */
export const VIDEO_DEFAULT: WorkflowStep[] = [
  { id: "intent", name: "腳本意圖", required: true,  enabled: true },
  { id: "entry",  name: "非線性入口", required: false, enabled: true },
  { id: "asset",  name: "多模態素材", required: true,  enabled: true },
  { id: "rough",  name: "打包初剪", required: false, enabled: true },
  { id: "gate",   name: "確認修改", required: true,  enabled: true },
  { id: "done",   name: "完成專案", required: true,  enabled: true },
];

/** 步驟庫（可加入；各 shell 可擴充自己的步驟） */
export const STEP_LIBRARY: { id: string; name: string }[] = [
  { id: "world",   name: "世界觀設定" },
  { id: "lora",    name: "角色 LoRA 訓練" },
  { id: "voice",   name: "配音／配樂" },
  { id: "publish", name: "發佈／精選" },
  { id: "review",  name: "同儕審閱" },
];

export const activeSteps = (wf: WorkflowStep[]) => wf.filter(s => s.enabled);

/** 一條龍流程列：反映「啟用步驟」集（與 StageBar 同源） */
export function FlowBar({ steps, current, onJump }: { steps: WorkflowStep[]; current: number; onJump?: (i: number) => void }) {
  const act = activeSteps(steps);
  return (
    <div className="flex items-center gap-[6px] p-[13px_15px] overflow-x-auto" role="tablist" aria-label="工作流階段">
      {act.map((s, i) => (
        <React.Fragment key={s.id}>
          <button onClick={() => onJump?.(i)} role="tab" aria-selected={i === current}
            className={cn("flex items-center gap-[7px] px-3 py-[7px] rounded-[10px] border text-[12px] whitespace-nowrap transition-all",
              i < current ? "text-[var(--ok)] border-[rgba(92,138,85,.3)] bg-[var(--ok-tint)]"
              : i === current ? "text-[var(--clay-deep)] border-[var(--clay-soft)] bg-[linear-gradient(120deg,var(--clay-tint-2),var(--gold-tint))]"
              : "text-[var(--muted)] border-[var(--line)] bg-[var(--surface-2)]")}>
            <span className="font-mono text-[9px] w-[17px] h-[17px] rounded-full grid place-items-center bg-[var(--wash)] border border-[var(--line)]">{i < current ? "✓" : i + 1}</span>
            {s.name}{!s.required && <span className="font-mono text-[9px] text-[var(--muted-2)]">可選</span>}
          </button>
          {i < act.length - 1 && <span className="w-4 h-px bg-[var(--line-strong)]" />}
        </React.Fragment>
      ))}
    </div>
  );
}

type EditorState = "ready" | "loading" | "error";
export function WorkflowBuilder({
  steps, library = STEP_LIBRARY, state = "ready",
  onReorder, onToggle, onRemove, onAdd, onReset, onSaveTemplate, onApply, onClose,
}: {
  steps: WorkflowStep[]; library?: { id: string; name: string }[]; state?: EditorState;
  onReorder?: (from: number, to: number) => void;
  onToggle?: (i: number) => void; onRemove?: (i: number) => void; onAdd?: (id: string) => void;
  onReset?: () => void; onSaveTemplate?: () => void; onApply?: () => void; onClose?: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[11vh] bg-[rgba(58,42,26,.28)] backdrop-blur-[6px]" role="dialog" aria-modal="true" aria-label="工作流設定">
      <div className="w-[min(640px,94vw)] max-h-[84vh] flex flex-col rounded-[18px] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-cmdk)]">
        <div className="flex items-center gap-[10px] px-[15px] py-[13px] border-b border-[var(--line)]">
          <b className="flex-1 font-serif">工作流設定 · 步驟可新增／刪除／重排／啟用停用</b>
          <button className="text-[var(--muted)]" onClick={onClose} aria-label="關閉">✕</button>
        </div>

        <div className="p-[18px] overflow-auto">
          {state === "loading" && <div className="py-12 grid place-items-center"><div className="w-[42px] h-[42px] rounded-full border-[3px] border-[var(--line)] border-t-[var(--clay)] animate-spin" /></div>}
          {state === "error" && <div className="py-10 text-center"><div className="font-serif text-[16px] mb-2">範本載入失敗</div><Button onClick={onReset}>重試</Button></div>}
          {state === "ready" && (<>
            <div className="font-mono text-[10px] tracking-[.26em] uppercase text-[var(--clay)]">目前步驟（拖拉重排；必經步驟不可刪）</div>
            <div className="flex flex-col gap-2 mt-2">
              {steps.map((s, i) => (
                <div key={s.id} className="flex items-center gap-2 px-3 py-[10px] border border-[var(--line)] rounded-[14px] bg-[var(--surface-2)]" draggable
                  onDragStart={e => e.dataTransfer.setData("i", String(i))}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => onReorder?.(Number(e.dataTransfer.getData("i")), i)}>
                  <span className="text-[var(--muted-2)] cursor-grab tracking-[-2px]">⋮⋮</span>
                  <span className="text-[13px] font-semibold">{s.name}</span>
                  {s.required ? <Pill kind="mute">必經</Pill> : <Pill>可選</Pill>}
                  <div className="flex-1" />
                  <Button size="xs" onClick={() => onReorder?.(i, i - 1)} disabled={i === 0}>↑</Button>
                  <Button size="xs" onClick={() => onReorder?.(i, i + 1)} disabled={i === steps.length - 1}>↓</Button>
                  <Button size="xs" variant="ghost" onClick={() => onToggle?.(i)}>{s.enabled ? "啟用" : "停用"}</Button>
                  <Button size="xs" variant="danger" onClick={() => onRemove?.(i)} disabled={s.required} title={s.required ? "必經步驟不可刪" : ""}>移除</Button>
                </div>
              ))}
            </div>
            <div className="font-mono text-[10px] tracking-[.26em] uppercase text-[var(--clay)] mt-[14px]">從步驟庫加入</div>
            <div className="flex gap-[6px] flex-wrap mt-[6px]">
              {library.map(x => { const has = steps.some(s => s.id === x.id);
                return <Button key={x.id} size="xs" onClick={() => onAdd?.(x.id)} disabled={has}>＋ {x.name}</Button>; })}
            </div>
            <p className="font-mono text-[9.5px] text-[var(--muted-2)] mt-3 leading-[1.7]">
              真實資料：工作流／步驟集屬資料模型，<b>待補（歸後端）</b> — 建議 user_workflows / workflow_steps（per 專案 / per 範本）；現以前端狀態示意。
            </p>
          </>)}
        </div>

        <div className="flex gap-2 flex-wrap p-[13px] border-t border-[var(--line)]">
          <Button variant="ghost" onClick={onReset}>重設回預設範本</Button>
          <div className="flex-1" />
          <Button onClick={onSaveTemplate}>存成自訂範本</Button>
          <Button variant="primary" onClick={onApply}>套用</Button>
        </div>
      </div>
    </div>
  );
}
