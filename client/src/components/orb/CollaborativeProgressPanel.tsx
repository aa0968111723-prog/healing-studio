/**
 * CollaborativeProgressPanel.tsx — 多代理討論進度視覺化 panel。
 *
 * 在討論進行中取代舊的「精靈討論進行中…」單行指示器，提供：
 *   1. 精靈頭像排列 — 所有可能參與的精靈以小圓角 pill 顯示
 *      ‣ 最近發言者高亮 + 脈衝環動畫
 *      ‣ 已發言精靈全亮度；尚未發言者半透明
 *   2. 回合進度條 — 第 X / Y 棒，隨 turn 更新
 *   3. 打字指示器 — 第一棒說完後顯示「下一位精靈思考中…」
 *   4. 停止按鈕
 *
 * 資料來源：GlobalOrbChatContext 的 collaborativeDiscussionMeta
 * （currentRound / speakersSoFar / latestSpeaker 三個 optional 欄位
 *  由 discussion_turn handler 即時更新）
 */

import { useMemo } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SPIRITS,
  getSpiritVisual,
  type SpiritFamily,
} from "@/lib/spiritsVisual";
import type {
  CollaborativeDiscussionMeta,
  CollaborativeDiscussionFamily,
} from "@/contexts/GlobalOrbChatContext";

interface CollaborativeProgressPanelProps {
  meta: CollaborativeDiscussionMeta;
  onCancel: () => void;
  isCancelling?: boolean;
}

/** 依 meta.allowedFamilies + meta.allowedRoles 篩選精靈（兩者皆空 = 全部）*/
function getEffectiveRoster(meta: CollaborativeDiscussionMeta) {
  const byFamily =
    meta.allowedFamilies.length > 0
      ? SPIRITS.filter(s =>
          meta.allowedFamilies.includes(s.family as CollaborativeDiscussionFamily)
        )
      : SPIRITS;
  return meta.allowedRoles.length > 0
    ? byFamily.filter(s => meta.allowedRoles.includes(s.id))
    : byFamily;
}

const MAX_VISIBLE = 8;

export function CollaborativeProgressPanel({
  meta,
  onCancel,
  isCancelling = false,
}: CollaborativeProgressPanelProps) {
  const reduceMotion = useReducedMotion() ?? false;

  const effectiveRoster = useMemo(
    () => getEffectiveRoster(meta),
    [meta.allowedFamilies, meta.allowedRoles],
  );

  // Backward-compatible defaults for optional runtime fields
  const speakersSoFar = meta.speakersSoFar ?? [];
  const latestSpeaker = meta.latestSpeaker ?? null;
  const displayRound =
    typeof meta.currentRound === "number"
      ? meta.currentRound + 1
      : speakersSoFar.length > 0
        ? speakersSoFar.length
        : 0;

  const progressPct =
    meta.maxRounds > 0
      ? Math.min((displayRound / meta.maxRounds) * 100, 100)
      : 0;

  const showTypingDots = latestSpeaker !== null;
  const latestSpiritVisual = getSpiritVisual(latestSpeaker ?? undefined);

  const visibleRoster = effectiveRoster.slice(0, MAX_VISIBLE);
  const hiddenCount = effectiveRoster.length - MAX_VISIBLE;

  return (
    <div
      className="rounded-xl border border-emerald-200/70 bg-emerald-50/60 dark:border-emerald-800/50 dark:bg-emerald-950/40 px-3 py-3 text-xs space-y-2"
      data-testid="orb-collab-discussion-progress"
      role="status"
      aria-live="polite"
      aria-label={`精靈討論進行中，第 ${displayRound} / ${meta.maxRounds} 棒`}
    >
      {/* ── 回合進度條 ─────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5">
            <motion.div
              className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0"
              animate={
                reduceMotion
                  ? {}
                  : { scale: [1, 1.4, 1], opacity: [1, 0.5, 1] }
              }
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            />
            <span className="font-medium text-emerald-800 dark:text-emerald-200">
              精靈討論中
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="tabular-nums text-emerald-700/80 dark:text-emerald-300/80">
              {displayRound > 0 ? displayRound : "…"}/{meta.maxRounds} 棒
            </span>
            <button
              type="button"
              onClick={onCancel}
              disabled={isCancelling}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-emerald-300/70 hover:bg-emerald-100 dark:border-emerald-700/50 dark:hover:bg-emerald-900/40 text-emerald-700 dark:text-emerald-200 transition-colors disabled:opacity-50"
              data-testid="orb-collab-discussion-cancel"
              aria-label="停止討論"
            >
              <X className="w-3 h-3" />
              {isCancelling ? "停止中…" : "停止"}
            </button>
          </div>
        </div>
        <div className="h-1.5 w-full rounded-full bg-emerald-100 dark:bg-emerald-900/50 overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-400"
            animate={{ width: `${progressPct}%` }}
            transition={
              reduceMotion ? { duration: 0 } : { duration: 0.5, ease: "easeOut" }
            }
          />
        </div>
        {latestSpiritVisual && (
          <div className="mt-1 text-[11px] text-emerald-600/80 dark:text-emerald-400/80">
            {latestSpiritVisual.emoji} {latestSpiritVisual.nickname} 剛說完
          </div>
        )}
      </div>

      {/* ── 精靈頭像排列 ───────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1.5">
        <AnimatePresence initial={false}>
          {visibleRoster.map(spirit => {
            const hasSpoken = speakersSoFar.includes(spirit.id);
            const isActive = spirit.id === latestSpeaker;
            return (
              <motion.div
                key={spirit.id}
                layout={!reduceMotion}
                initial={reduceMotion ? false : { opacity: 0, scale: 0.8 }}
                animate={{ opacity: hasSpoken || isActive ? 1 : 0.35, scale: 1 }}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 300, damping: 22 }
                }
                className="relative"
              >
                {/* 發言者脈衝環 */}
                {isActive && !reduceMotion && (
                  <motion.span
                    className="absolute inset-0 rounded-full ring-2 ring-emerald-400 pointer-events-none"
                    animate={{ scale: [1, 1.2, 1], opacity: [0.8, 0, 0.8] }}
                    transition={{
                      duration: 1.5,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }}
                    aria-hidden="true"
                  />
                )}
                <div
                  className={cn(
                    "relative flex items-center gap-1 rounded-full px-2 py-0.5 border transition-colors leading-none",
                    isActive
                      ? "border-emerald-400/70 bg-emerald-100 dark:bg-emerald-900/50 dark:border-emerald-500/60"
                      : hasSpoken
                        ? "border-emerald-200/60 bg-emerald-50/80 dark:border-emerald-800/50 dark:bg-emerald-950/30"
                        : "border-transparent bg-white/40 dark:bg-white/5",
                  )}
                >
                  <span className="text-[13px] leading-none">{spirit.emoji}</span>
                  <span
                    className={cn(
                      "text-[11px] font-medium",
                      isActive
                        ? "text-emerald-800 dark:text-emerald-100"
                        : "text-slate-500 dark:text-slate-400",
                    )}
                  >
                    {spirit.nickname}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
        {hiddenCount > 0 && (
          <span className="self-center text-[10px] text-slate-400 dark:text-slate-500">
            +{hiddenCount}
          </span>
        )}
      </div>

      {/* ── 打字指示器（第一棒說完後才出現） ─────────────────────── */}
      <AnimatePresence>
        {showTypingDots && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.2 }}
            className="flex items-center gap-1.5 text-[11px] text-emerald-600/70 dark:text-emerald-400/70"
          >
            <span>下一位精靈思考中</span>
            {reduceMotion ? (
              <span aria-hidden="true">…</span>
            ) : (
              <span className="flex gap-0.5 items-end" aria-hidden="true">
                {[0, 1, 2].map(i => (
                  <motion.span
                    key={i}
                    className="inline-block w-1 h-1 rounded-full bg-emerald-500/70"
                    animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
                    transition={{
                      duration: 0.9,
                      repeat: Infinity,
                      delay: i * 0.2,
                      ease: "easeInOut",
                    }}
                  />
                ))}
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
