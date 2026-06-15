/* AI Director · 確認門 GateCard（唯一品管脊椎）— React 19 + Tailwind
   鐵則：角色未定版不進分鏡 · 關鍵影格未核准不跑 i2v · 媒體生成前先估成本。
   gate 計算規則沿用模擬 util.ts 的 computeGate/countGate（事實基準）。
   真實接點：approval / 鎖臉 / 角色升級皆走 vault.update（payload 表達），
            估成本走 director.estimateSegmentCost（已 GitNexus 校驗）。 */
import * as React from "react";
import { Button, Pill } from "./primitives";
import type { GateState, SourceGrade } from "./tokens";
import { GRADE_LABEL } from "./tokens";

export interface CharacterLite {
  id: string; name: string; sourceGrade: SourceGrade; locked: boolean;
  characterRefResolvable?: boolean;
}
export interface ShotLite {
  id: string; route: "text" | "ref"; characterIds: string[];
}

/** 單顆鏡頭的閘門狀態（與 util.ts 一致） */
export function computeGate(shot: ShotLite, chars: CharacterLite[]): GateState {
  if (shot.route === "text" || shot.characterIds.length === 0) return "ready";
  const refs = shot.characterIds.map(id => chars.find(c => c.id === id)).filter(Boolean) as CharacterLite[];
  if (refs.length === 0) return "ready";
  const ok = refs.filter(c => c.sourceGrade === "precise" && c.locked).length;
  if (ok === refs.length) return "ready";
  if (ok === 0) return "blocked";
  return "partial";
}
export function countGate(shots: ShotLite[], chars: CharacterLite[]) {
  const r = { ready: 0, partial: 0, blocked: 0, total: shots.length };
  for (const s of shots) r[computeGate(s, chars)]++;
  return r;
}

export function GateCard({
  shots, characters, onUploadReference,
}: {
  shots: ShotLite[]; characters: CharacterLite[];
  onUploadReference?: (charId: string) => void;
}) {
  const g = React.useMemo(() => countGate(shots, characters), [shots, characters]);
  const blocker = characters.find(c => !(c.sourceGrade === "precise" && c.locked));
  const Big = ({ k, n, label }: { k: "ok" | "warn" | "bad"; n: number; label: string }) => {
    const col = k === "ok" ? "text-[var(--ok)]" : k === "warn" ? "text-[var(--gold-deep)]" : "text-[var(--bad)]";
    return (
      <div className={`flex-1 min-w-[80px] text-center p-3 rounded-[14px] border ${k === "ok" ? "border-[rgba(92,138,85,.26)] bg-[var(--ok-tint)]" : "border-[var(--line)] bg-[var(--surface)]"}`}>
        <b className={`block font-serif text-[26px] leading-[1.05] font-semibold ${col}`}>{n}</b>
        <span className="text-[10.5px] text-[var(--text-mute)]">{label}</span>
      </div>
    );
  };
  return (
    <section className="m-[15px] rounded-[14px] border border-[var(--gold-soft)] bg-[linear-gradient(160deg,var(--gold-tint),var(--surface-3))] overflow-hidden"
      role="status" aria-label="確認門">
      <header className="flex items-center gap-2 px-[15px] py-[11px] text-[12.5px] font-semibold text-[var(--gold-deep)] border-b border-[rgba(200,146,47,.22)]">
        🔒 確認門 · GATE
      </header>
      <div className="p-[15px]">
        <div className="flex gap-[9px] flex-wrap mt-[5px]">
          <Big k="ok" n={g.ready} label="可量產" />
          <Big k="warn" n={g.partial} label="部分待補" />
          <Big k="bad" n={g.blocked} label="全待補" />
        </div>
        {blocker ? (
          <div className="flex items-center gap-[9px] text-[12.5px] py-[7px] mt-1">
            <Pill kind="warn">{GRADE_LABEL[blocker.sourceGrade]}</Pill>
            <span className="flex-1">「{blocker.name}」未定版 — 先補精準參考再進量產</span>
            <Button size="xs" variant="gold" onClick={() => onUploadReference?.(blocker.id)}>上傳參考照</Button>
          </div>
        ) : (
          <div className="flex items-center gap-[9px] text-[12.5px] py-[7px] mt-1 text-[var(--ok)]">✅ 所有角色已定版 · 可進量產</div>
        )}
        <p className="mt-[11px] pt-[11px] border-t border-dashed border-[var(--line-strong)] font-mono text-[9.5px] leading-[1.7] text-[var(--muted-2)] tracking-[.02em]">
          角色未定版不進分鏡 · 關鍵影格未核准不跑 i2v · 媒體生成前先估成本
        </p>
      </div>
    </section>
  );
}
