/* AI Director · 團隊協作視覺 — 分工看板（U-13 / AIDV-116）
 * ----------------------------------------------------------------------------
 * 看板：欄＝狀態（待辦／進行中／審查／完成），卡＝任務。純前端唯讀消費 props。
 *  · a11y：看板用 role="list"（欄群）、每欄 role="group" + aria-label、欄內任務用
 *    <ul>/<li> 承載語意；欄標題用 aria-labelledby 關聯。
 *  · 色彩／圓角走 .aidv-kit token，不寫死 hex。任務指派以 Avatar 呈現。
 * rev. U-13 · 2026-06-17 */
import * as React from "react";
import { cn } from "../design-kit/tokens";
import { Dot, ToneTag } from "../design-kit/atoms";
import { Avatar } from "./TeamAtoms";
import {
  BOARD_COLUMNS,
  type BoardColumnId,
  type BoardTask,
  type TeamMember,
} from "./teamsTypes";

function TaskCard({ task, assignee }: { task: BoardTask; assignee?: TeamMember }) {
  return (
    <li className="rounded-[12px] border border-[var(--line)] bg-[var(--surface)] p-3 shadow-[var(--shadow-xs)] transition-all duration-200 hover:-translate-y-px hover:shadow-[var(--shadow-sm)] hover:border-[var(--line-strong)]">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12.5px] font-medium leading-snug text-[var(--text)]">
          {task.title}
        </span>
        {assignee ? (
          <Avatar name={assignee.name} avatarUrl={assignee.avatarUrl} size="sm" />
        ) : (
          <span
            role="img"
            aria-label="未指派"
            className="inline-flex size-7 flex-none items-center justify-center rounded-full border border-dashed border-[var(--line-strong)] text-[10px] text-[var(--muted-2)]"
          >
            —
          </span>
        )}
      </div>
      {task.tag && (
        <div className="mt-2">
          <ToneTag tone="mute">{task.tag}</ToneTag>
        </div>
      )}
    </li>
  );
}

export type DivisionBoardProps = {
  tasks: BoardTask[];
  members: TeamMember[];
  className?: string;
};

/**
 * DivisionBoard — 分工看板。
 * 一句話範圍：以狀態為欄、任務為卡呈現團隊分工進度（純前端唯讀，看板欄位語意正確）。
 */
export function DivisionBoard({ tasks, members, className }: DivisionBoardProps) {
  const memberById = React.useMemo(
    () => new Map(members.map((m) => [m.id, m])),
    [members],
  );

  const byColumn = React.useMemo(() => {
    const map = new Map<BoardColumnId, BoardTask[]>();
    for (const col of BOARD_COLUMNS) map.set(col.id, []);
    for (const t of tasks) map.get(t.column)?.push(t);
    return map;
  }, [tasks]);

  return (
    <div
      role="list"
      aria-label="分工看板"
      className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-4", className)}
    >
      {BOARD_COLUMNS.map((col) => {
        const colTasks = byColumn.get(col.id) ?? [];
        const headingId = `board-col-${col.id}`;
        return (
          <section
            key={col.id}
            role="group"
            aria-labelledby={headingId}
            className="flex flex-col gap-2 rounded-[14px] border border-[var(--hair)] bg-[var(--wash)] p-3"
          >
            <header className="flex items-center justify-between gap-2">
              <h4 id={headingId} className="flex items-center gap-[6px] text-[12px] font-semibold text-[var(--text-soft)]">
                <Dot tone={col.tone} size="md" />
                {col.label}
              </h4>
              <span className="font-mono text-[11px] tabular-nums text-[var(--muted)]" aria-label={`${colTasks.length} 個任務`}>
                {colTasks.length}
              </span>
            </header>
            {colTasks.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {colTasks.map((t) => (
                  <TaskCard key={t.id} task={t} assignee={t.assigneeId ? memberById.get(t.assigneeId) : undefined} />
                ))}
              </ul>
            ) : (
              <p className="rounded-[10px] border border-dashed border-[var(--line)] px-3 py-4 text-center text-[11px] text-[var(--muted-2)]">
                此欄沒有任務
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}

export default DivisionBoard;
