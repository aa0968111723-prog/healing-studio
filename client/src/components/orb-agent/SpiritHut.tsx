/**
 * SpiritHut — 精靈小屋
 * ────────────────────────────────────────────────────────────────────
 * 每位精靈名片簿的展開檢視：當使用者點任一精靈，下方撐開一塊小屋，
 * 講清楚這位精靈的具體技能、能怎麼幫你、可以這樣叫我。
 *
 * 設計重點：
 *   - 不離開 /agent 頁，跟名片簿無縫銜接（AnimatePresence height 撐開）。
 *   - Classic / minimalist 兩種視覺 variant；前者保留漸層暈染，
 *     後者只在 hero 圓盤保留漸層、其餘走純淨單色排版。
 *   - 互動入口收斂成兩種：
 *       1. 點 sampleAsk chip → onPrefill(spirit, text)
 *          （把 @暱稱+範例語句灌到輸入欄，等使用者再修改或送出）
 *       2. 點「邀請出門」CTA → onInvite(spirit)
 *          （等同既有 handleCallSpirit：prefill prompt + 鎖定 + greeting toast）
 *   - 資料來源 100% 從 spiritsVisual.ts；本元件不向外打 API。
 */

import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, ChevronUp, Wand2 } from "lucide-react";
import {
  type SpiritVisual,
  getSpiritProfile,
  getSpiritSampleAsks,
} from "@/lib/spiritsVisual";

export type SpiritHutVariant = "classic" | "minimalist";

interface SpiritHutProps {
  spirit: SpiritVisual;
  /** classic = 既有設計語彙；minimalist = 留白多、單色、細線。 */
  variant: SpiritHutVariant;
  isOpen: boolean;
  /** 收合小屋（再點一次同一張名片時觸發）。 */
  onClose: () => void;
  /** 「邀請出門」CTA — 走既有 handleCallSpirit 流程。 */
  onInvite: (spirit: SpiritVisual) => void;
  /** sampleAsk chip 點擊 — 把該句灌進聊天輸入欄並鎖定精靈，但不送出。 */
  onPrefill: (spirit: SpiritVisual, text: string) => void;
}

export default function SpiritHut({
  spirit,
  variant,
  isOpen,
  onClose,
  onInvite,
  onPrefill,
}: SpiritHutProps) {
  const profile = getSpiritProfile(spirit.id);
  const sampleAsks = getSpiritSampleAsks(spirit);
  const minimal = variant === "minimalist";

  const shellCls = minimal
    ? "rounded-3xl border border-border/30 bg-card/95 backdrop-blur-sm"
    : `rounded-2xl border border-border/60 bg-gradient-to-br from-card via-card to-card/90 shadow-md`;

  return (
    <AnimatePresence initial={false}>
      {isOpen && (
        <motion.div
          key={`hut-${spirit.id}`}
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="col-span-2 sm:col-span-3 overflow-hidden"
          data-testid={`spirit-hut-${spirit.id}`}
        >
          <div className={`${shellCls} relative ${minimal ? "p-5 sm:p-6" : "p-4 sm:p-5"}`}>
            {/* 軟暈染裝飾：只在 classic variant；minimalist 保持乾淨 */}
            {!minimal && (
              <>
                <div
                  aria-hidden
                  className={`absolute -top-12 -right-10 w-40 h-40 rounded-full bg-gradient-to-br ${spirit.gradient} opacity-15 blur-3xl`}
                />
                <div
                  aria-hidden
                  className={`absolute -bottom-12 -left-10 w-32 h-32 rounded-full bg-gradient-to-br ${spirit.gradient} opacity-10 blur-3xl`}
                />
              </>
            )}

            {/* ── Hero：圓盤 + 暱稱 + 全名 + vibe ─────────────────────── */}
            <header className="relative flex items-start gap-3 sm:gap-4">
              <motion.div
                initial={{ scale: 0.85, rotate: -6 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className={`shrink-0 rounded-2xl bg-gradient-to-br ${spirit.gradient} flex items-center justify-center text-white shadow-lg ${
                  minimal ? "w-14 h-14 text-2xl" : "w-16 h-16 text-3xl"
                }`}
                aria-hidden
              >
                <span>{spirit.emoji}</span>
              </motion.div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <h3
                    className={`font-semibold ${
                      minimal ? "text-base text-foreground" : "text-lg text-foreground"
                    }`}
                  >
                    {spirit.nickname}
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    · {spirit.label}
                  </span>
                </div>
                <p
                  className={`mt-1 leading-snug ${
                    minimal
                      ? "text-sm text-muted-foreground"
                      : "text-sm text-foreground/80"
                  }`}
                >
                  {spirit.vibe}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="收合小屋"
                className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              >
                <ChevronUp className="w-4 h-4" />
              </button>
            </header>

            {/* ── 三段：技能 / 怎麼幫你 / 範例語句 ────────────────── */}
            <div
              className={`relative mt-4 grid gap-3 ${
                minimal ? "sm:grid-cols-2" : "sm:grid-cols-2"
              }`}
            >
              {/* 看家本事 */}
              <section
                className={
                  minimal
                    ? "space-y-1.5"
                    : "rounded-xl bg-card/60 border border-border/40 p-3 space-y-1.5"
                }
              >
                <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground/80 inline-flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  我的看家本事
                </p>
                <ul className="space-y-1">
                  {(profile?.skills ?? [spirit.vibe]).map(skill => (
                    <li
                      key={skill}
                      className="text-[12.5px] text-foreground/90 leading-relaxed flex gap-1.5"
                    >
                      <span aria-hidden className="text-muted-foreground/60">
                        ·
                      </span>
                      <span>{skill}</span>
                    </li>
                  ))}
                </ul>
              </section>

              {/* 怎麼幫你 */}
              {profile?.helpsYou && profile.helpsYou.length > 0 && (
                <section
                  className={
                    minimal
                      ? "space-y-1.5"
                      : "rounded-xl bg-card/60 border border-border/40 p-3 space-y-1.5"
                  }
                >
                  <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground/80">
                    🤝 我能怎麼幫你
                  </p>
                  <ul className="space-y-1">
                    {profile.helpsYou.map(line => (
                      <li
                        key={line}
                        className="text-[12.5px] text-foreground/90 leading-relaxed flex gap-1.5"
                      >
                        <span
                          aria-hidden
                          className="mt-1.5 inline-block w-1 h-1 rounded-full bg-emerald-500/80 shrink-0"
                        />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>

            {/* 範例語句 chip 列 — 點一下灌進聊天輸入欄 */}
            {sampleAsks.length > 0 && (
              <section className="relative mt-4 space-y-2">
                <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground/80">
                  💬 你可以這樣叫我
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {sampleAsks.map(ask => (
                    <button
                      key={ask}
                      type="button"
                      onClick={() => onPrefill(spirit, ask)}
                      className={
                        minimal
                          ? "text-[11.5px] px-2.5 py-1 rounded-full border border-border/60 text-foreground/85 hover:border-foreground/40 hover:bg-muted/40 transition-colors"
                          : `text-[11.5px] px-2.5 py-1 rounded-full border border-border/60 bg-card/70 text-foreground/85 hover:bg-gradient-to-r hover:${spirit.gradient} hover:text-white hover:border-transparent transition-colors`
                      }
                    >
                      {ask}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* CTA：邀請出門 → 既有 handleCallSpirit */}
            <div className="relative mt-5 flex items-center justify-between gap-2">
              <p className="text-[11px] text-muted-foreground">
                {minimal
                  ? "點上面的範例語句先試試看，或直接邀請出門 →"
                  : "點範例試試，或直接邀請出門 →"}
              </p>
              <button
                type="button"
                onClick={() => onInvite(spirit)}
                className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full text-white shadow-md bg-gradient-to-r ${spirit.gradient} hover:opacity-90 transition-opacity`}
              >
                <Wand2 className="w-3.5 h-3.5" />
                邀請 {spirit.nickname} 出門
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
