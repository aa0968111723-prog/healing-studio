/* AI Director · 團隊協作視覺 — 團隊清單卡（U-13 / AIDV-116）
 * ----------------------------------------------------------------------------
 * 團隊卡：名稱＋共享範圍指示＋成員頭像疊放＋一句話描述＋進度。可選「選取」回呼
 * （走查／受控用）。純前端唯讀消費 props，色彩走 .aidv-kit token、不寫死 hex。
 *  · a11y：可選取時整卡為 button 語意（aria-pressed），焦點環＋觸控 ≥44px。
 * rev. U-13 · 2026-06-17 */
import * as React from "react";
import { cn } from "../design-kit/tokens";
import { Card } from "../design-kit/primitives";
import { MeterBar } from "../design-kit/atoms";
import { Avatar, ShareScopeBadge } from "./TeamAtoms";
import { type Team } from "./teamsTypes";

/** 成員頭像疊放（最多顯示 max 個，其餘以 +N 表示）。 */
function AvatarStack({ team, max = 4 }: { team: Team; max?: number }) {
  const shown = team.members.slice(0, max);
  const rest = team.members.length - shown.length;
  return (
    <div className="flex items-center" aria-label={`${team.members.length} 位成員`}>
      <div className="flex -space-x-2">
        {shown.map((m) => (
          <span key={m.id} className="rounded-full ring-2 ring-[var(--surface)]">
            <Avatar name={m.name} avatarUrl={m.avatarUrl} size="sm" />
          </span>
        ))}
      </div>
      {rest > 0 && (
        <span className="ml-2 font-mono text-[11px] text-[var(--muted)]">+{rest}</span>
      )}
    </div>
  );
}

export type TeamCardProps = {
  team: Team;
  /** 選取回呼（提供時整卡可點，作 button 語意）。 */
  onSelect?: (id: string) => void;
  /** 當前是否選取（受控視覺）。 */
  selected?: boolean;
  className?: string;
};

/**
 * TeamCard — 團隊清單卡。
 * 一句話範圍：呈現單一團隊的名稱／共享範圍／成員頭像／完成度（純前端唯讀消費 props）。
 */
export function TeamCard({ team, onSelect, selected, className }: TeamCardProps) {
  const done = team.tasks.filter((t) => t.column === "done").length;
  const pct = team.tasks.length ? (done / team.tasks.length) * 100 : 0;

  const interactive = typeof onSelect === "function";

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold text-[var(--text)]">{team.name}</h3>
          {team.blurb && (
            <p className="mt-[2px] line-clamp-2 text-[12px] leading-relaxed text-[var(--muted)]">
              {team.blurb}
            </p>
          )}
        </div>
        <ShareScopeBadge scope={team.scope} />
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <AvatarStack team={team} />
        <span className="font-mono text-[11px] text-[var(--muted)]">
          {done}/{team.tasks.length} 完成
        </span>
      </div>

      <div className="mt-3">
        <MeterBar pct={pct} tone="brand" label={`${team.name} 完成度`} />
      </div>
    </>
  );

  if (interactive) {
    // 原生 <button> 取得鍵盤可操作性與焦點環，套上 Card 的視覺類別。
    return (
      <button
        type="button"
        aria-pressed={!!selected}
        onClick={() => onSelect!(team.id)}
        className={cn(
          "block w-full text-left cursor-pointer min-h-[44px] p-[18px] transition-all duration-200",
          "bg-[var(--surface)] border border-[var(--line)] rounded-[16px] shadow-[var(--shadow-card)]",
          "hover:-translate-y-[2px] hover:shadow-[var(--shadow-lift)] hover:border-[var(--line-strong)]",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--clay-ring)]",
          selected && "!border-[var(--clay)] shadow-[var(--ring-soft)]",
          className,
        )}
      >
        {body}
      </button>
    );
  }

  return (
    <Card pad className={className}>
      {body}
    </Card>
  );
}

export default TeamCard;
