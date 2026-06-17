/* AI Director · 團隊協作視覺 — 頂層組裝（U-13 / AIDV-116）
 * ----------------------------------------------------------------------------
 * /learn/teams 團隊協作系統視覺：左＝團隊清單卡，右＝選取團隊的成員列＋共享範圍
 * ＋分工看板。四態齊備（Loading/Empty/Error/Skeleton + Ready）。純前端唯讀消費
 * props（mock 離線可驗），零後端可回滾（旗標見 teamsFlags.ts）。
 *  · 色彩／圓角走 .aidv-kit token、不寫死 hex；元件須用在 <AidvKit> 內。
 *  · a11y：區段 aria-label、看板欄位語意正確、焦點環、觸控 ≥44px。
 *  · 真實 RBAC／後端＝AIDV-121，不在本卡。
 * rev. U-13 · 2026-06-17 */
import * as React from "react";
import { Users } from "lucide-react";
import { cn } from "../design-kit/tokens";
import { AidvKit } from "../design-kit/AidvKit";
import { Eyebrow } from "../design-kit/primitives";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Skeleton,
  SkeletonLines,
} from "../design-kit/states";
import { MemberList, ShareScopeBadge } from "./TeamAtoms";
import { TeamCard } from "./TeamCard";
import { DivisionBoard } from "./DivisionBoard";
import { MOCK_TEAMS, type Team } from "./teamsTypes";

export type TeamsBoardStatus = "loading" | "empty" | "error" | "ready";

export type TeamsBoardProps = {
  /** 團隊資料（純前端唯讀；預設離線 mock）。 */
  teams?: Team[];
  /** 視圖狀態（四態出口；預設 ready）。 */
  status?: TeamsBoardStatus;
  /** 初始選取的團隊 id（預設第一筆）。 */
  initialTeamId?: string;
  /** 錯誤態重試回呼（走查／受控用）。 */
  onRetry?: () => void;
  /** 包不包 AidvKit scope（預設包；若外層已是 .aidv-kit 可設 false）。 */
  withKit?: boolean;
  className?: string;
};

function Frame({
  withKit,
  className,
  children,
}: {
  withKit: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const inner = (
    <section aria-label="團隊協作" className={cn("flex flex-col gap-4", className)}>
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-[var(--clay)]" aria-hidden />
          <Eyebrow>TEAMS · 團隊協作</Eyebrow>
        </div>
        <span className="font-mono text-[10px] text-[var(--muted-2)]">唯讀 · 視覺</span>
      </header>
      {children}
    </section>
  );
  return withKit ? <AidvKit>{inner}</AidvKit> : inner;
}

/** 載入態骨架（左清單 + 右看板佔位）。 */
function LoadingSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]" aria-hidden>
      <div className="flex flex-col gap-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-[18px]">
            <Skeleton w="60%" h={16} />
            <div className="mt-3">
              <SkeletonLines lines={2} />
            </div>
          </div>
        ))}
      </div>
      <div className="rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-[18px]">
        <Skeleton w="40%" h={16} />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} h={120} rounded={14} />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * TeamsBoard — 團隊協作系統視覺（頂層）。
 * 一句話範圍：在 /learn/teams 唯讀呈現團隊清單卡、成員列（頭像＋角色）、共享範圍
 * 指示與分工看板（欄＝狀態、卡＝任務），四態齊備、純前端消費 props，可第三人驗收。
 */
export function TeamsBoard({
  teams = MOCK_TEAMS,
  status = "ready",
  initialTeamId,
  onRetry,
  withKit = true,
  className,
}: TeamsBoardProps) {
  const [selectedId, setSelectedId] = React.useState<string | undefined>(
    initialTeamId ?? teams[0]?.id,
  );

  // teams 變動時，確保選取仍有效。
  React.useEffect(() => {
    if (!teams.some((t) => t.id === selectedId)) {
      setSelectedId(teams[0]?.id);
    }
  }, [teams, selectedId]);

  const selected = teams.find((t) => t.id === selectedId);

  let content: React.ReactNode;
  if (status === "loading") {
    content = (
      <>
        <LoadingState label="載入團隊中…" />
        <LoadingSkeleton />
      </>
    );
  } else if (status === "error") {
    content = (
      <ErrorState
        title="無法載入團隊"
        message="團隊協作資料暫時讀取失敗（純視覺示意，重試為走查用）。"
        onRetry={onRetry}
      />
    );
  } else if (status === "empty" || teams.length === 0) {
    content = (
      <EmptyState
        icon={<Users className="size-5" aria-hidden />}
        title="還沒有團隊"
        hint="建立第一個團隊，邀請成員、分派角色並開始分工協作。"
      />
    );
  } else {
    content = (
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* 左：團隊清單卡 */}
        <nav aria-label="團隊清單" className="flex flex-col gap-3">
          {teams.map((t) => (
            <TeamCard
              key={t.id}
              team={t}
              selected={t.id === selectedId}
              onSelect={setSelectedId}
            />
          ))}
        </nav>

        {/* 右：選取團隊詳情 */}
        {selected ? (
          <div className="flex flex-col gap-4">
            <div className="rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-[18px] shadow-[var(--shadow-card)]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[16px] font-semibold text-[var(--text)]">{selected.name}</h3>
                <ShareScopeBadge scope={selected.scope} />
              </div>
              <div className="mt-3">
                <MemberList members={selected.members} />
              </div>
            </div>

            <section aria-label="分工看板" className="rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-[18px] shadow-[var(--shadow-card)]">
              <h4 className="mb-3 text-[13px] font-semibold text-[var(--text-soft)]">分工看板</h4>
              <DivisionBoard tasks={selected.tasks} members={selected.members} />
            </section>
          </div>
        ) : (
          <EmptyState title="選擇一個團隊" hint="從左側選取團隊以檢視成員與分工看板。" />
        )}
      </div>
    );
  }

  return (
    <Frame withKit={withKit} className={className}>
      {content}
    </Frame>
  );
}

export default TeamsBoard;
