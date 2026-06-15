/* AI Director · 分鏡卡 ShotCard（全狀態機）— React 19 + Tailwind
   status：idle/queued → generating → done → (stale) / error
   動作由 gate × status 驅動；frameStyle 由 seed+variant 決定（一致性 demo）。
   真實接點：生成走 generate.estimateCost → submitStudioJob → jobStatus → recordGenResult；
            核准走 vault.update（payload 表 approval）。鏡號 S0X 為唯一主鍵。 */
import * as React from "react";
import { Button, Pill } from "./primitives";
import type { GateState, GenStatus, ProviderId } from "./tokens";

/** 由 seed+variant 產生穩定漸層（同 seed → 同畫面，示意一致性） */
export function frameStyle(seed = 0, variant = 0): React.CSSProperties {
  const h1 = (seed * 47 + variant * 97) % 360, h2 = (h1 + 38) % 360, h3 = (h2 + 46) % 360;
  return { background: `radial-gradient(120% 120% at 30% 20%, hsl(${h1} 52% 72%), hsl(${h2} 46% 58%) 55%, hsl(${h3} 40% 46%))` };
}

export interface ShotVM {
  id: string; no: string; title: string; route: "text" | "ref";
  seed: number; approved: boolean; stale: boolean;
  status: GenStatus; provider?: ProviderId; variant?: number;
}

export function ShotCard({
  shot, gate, blockedCharName, onGenerate, onApprove, onRegen, onRetry,
}: {
  shot: ShotVM; gate: GateState; blockedCharName?: string;
  onGenerate?: () => void; onApprove?: () => void; onRegen?: () => void; onRetry?: () => void;
}) {
  const { status } = shot;
  return (
    <article className={[
      "rounded-[14px] border bg-[var(--surface)] overflow-hidden shadow-[var(--shadow-xs)] transition-all duration-200",
      "hover:-translate-y-[2px] hover:shadow-[var(--shadow-sm)] hover:border-[var(--clay-soft)]",
      shot.stale ? "border-[var(--gold-soft)]" : status === "error" ? "border-[rgba(199,73,58,.4)]" : "border-[var(--line)]",
    ].join(" ")}>
      {/* thumb */}
      <div className="relative grid place-items-center overflow-hidden aspect-[16/10] bg-[linear-gradient(150deg,#efe6d6,#e4d6c0)]">
        {status === "done" && (
          <>
            <div className={"absolute inset-0 " + (shot.stale ? "grayscale-[.4] brightness-95 sepia-[.1]" : "")} style={frameStyle(shot.seed, shot.variant)} />
            <span className="absolute left-[7px] bottom-[7px] font-mono text-[8.5px] text-white bg-[rgba(43,38,32,.6)] px-[6px] py-[2px] rounded-[6px] backdrop-blur-[2px]">
              seed {shot.seed} · {shot.provider}
            </span>
            {shot.stale && (
              <div className="absolute inset-0 grid place-items-center bg-[rgba(253,251,247,.78)] backdrop-blur-[2px]"><Pill kind="warn">過期待重生</Pill></div>
            )}
          </>
        )}
        {status === "generating" && (
          <>
            <div className="absolute left-0 right-0 h-[40%] bg-[linear-gradient(180deg,transparent,rgba(194,97,63,.32),transparent)] animate-[scan_1.3s_ease-in-out_infinite]" />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[rgba(253,251,247,.78)] backdrop-blur-[2px]">
              <div className="w-[34px] h-[34px] rounded-full border-[3px] border-[var(--line)] border-t-[var(--clay)] animate-spin" />
              <span className="text-[11px] text-[var(--muted)]">生成中…</span>
            </div>
          </>
        )}
        {status === "error" && (
          <div className="absolute inset-0 grid place-items-center bg-[linear-gradient(150deg,#f0d8d2,#e6c3bb)]"><Pill kind="bad">生成失敗</Pill></div>
        )}
        {(status === "idle" || status === "queued") && (
          <div className="text-[var(--muted)] text-[11px] text-center p-[10px] font-medium">
            {shot.route === "text" ? "🌄 空景 · 文字生成" : "🔒 角色 · 參考圖轉繪"}<br />
            <span className="font-mono text-[10px] text-[var(--muted-2)]">seed {shot.seed}</span>
          </div>
        )}
      </div>
      {/* meta */}
      <div className="px-[10px] py-[9px]">
        <div className="flex items-center gap-[6px] text-[12px] font-semibold">
          <span className="font-mono text-[9.5px] text-[var(--clay-deep)] bg-[var(--clay-tint)] px-[6px] py-[1px] rounded-[6px]">{shot.no}</span>
          {shot.title}
        </div>
        <div className="mt-[6px] flex items-center gap-[5px] flex-wrap">
          <Pill kind={gate === "ready" ? "ok" : gate === "partial" ? "warn" : "bad"}>
            {gate === "ready" ? "可量產" : gate === "partial" ? "部分待補" : "全待補"}
          </Pill>
          {shot.approved && <Pill kind="info">已核准</Pill>}
          {/* 動作：gate × status */}
          {(status === "idle" || status === "queued") && gate === "ready" && <Button size="xs" variant="primary" onClick={onGenerate}>生成</Button>}
          {(status === "idle" || status === "queued") && gate !== "ready" && <span className="font-mono text-[10px] text-[var(--muted)] px-2 py-[2px] border border-[var(--line)] rounded-[8px]">待補：{blockedCharName ?? "角色"}</span>}
          {status === "done" && !shot.stale && <Button size="xs" onClick={onRegen}>同 seed 重生</Button>}
          {status === "done" && !shot.stale && !shot.approved && <Button size="xs" variant="gold" onClick={onApprove}>核准</Button>}
          {status === "done" && shot.stale && <Button size="xs" variant="gold" onClick={onRegen}>重生（已過期）</Button>}
          {status === "error" && <Button size="xs" onClick={onRetry}>重試</Button>}
        </div>
      </div>
    </article>
  );
}
