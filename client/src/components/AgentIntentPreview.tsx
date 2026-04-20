/**
 * AgentIntentPreview.tsx — 光球代理人「執行前預覽」浮動卡片（Phase 1.5）
 * ────────────────────────────────────────────────────────────────────────────
 * 目的：在 LLM / 光球要執行任何破壞性動作（submit / reset / applyPreset /
 *       setModality…）之前，先用柔軟、邀請式的語氣告訴使用者「我打算這樣做」，
 *       並提供「好啊 ✓ / 先不要 ✕」兩個選項。
 *
 *       這張卡片監聽 `usePageAgent().pendingConfirmation`，當該欄位為 null
 *       時不渲染；有內容時以 AnimatePresence 淡入。
 *
 * 設計原則（以人為本，不製造焦慮）：
 *   - 語氣：永遠邀請，不要指令
 *   - 顏色：柔和綠 / 柔和紫，不用紅色警示
 *   - 位置：固定在右下角、光球正上方
 *   - 破壞性也只是問一句，不鎖住畫面
 */

import { AnimatePresence, motion } from "framer-motion";
import { Check, X, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePageAgent } from "@/contexts/PageAgentContext";
import { useIsMobile } from "@/hooks/useMobile";

export default function AgentIntentPreview() {
  const { pendingConfirmation, confirmPending, cancelPending } =
    usePageAgent();
  const isMobile = useIsMobile();

  return (
    <AnimatePresence>
      {pendingConfirmation && (
        <motion.div
          key={pendingConfirmation.id}
          initial={{ opacity: 0, y: 20, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 220, damping: 24 }}
          role="dialog"
          aria-label="光球意圖確認"
          className={
            isMobile
              ? "fixed z-[60] inset-x-4 bottom-20 max-w-none pointer-events-auto"
              : "fixed z-[60] right-6 bottom-28 max-w-[22rem] w-[min(22rem,calc(100vw-3rem))] pointer-events-auto"
          }
        >
          <div className="relative rounded-2xl border border-emerald-200/60 dark:border-emerald-400/30 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl shadow-2xl overflow-hidden">
            {/* 柔和光暈 */}
            <div
              className="absolute inset-0 pointer-events-none opacity-60"
              style={{
                background:
                  "radial-gradient(120% 80% at 50% 0%, rgba(167, 243, 208, 0.35) 0%, transparent 60%)",
              }}
            />
            <div className="relative p-4 space-y-3">
              <div className="flex items-start gap-2">
                <div className="shrink-0 mt-0.5 w-7 h-7 rounded-full bg-gradient-to-br from-emerald-300 to-sky-300 dark:from-emerald-400 dark:to-sky-400 flex items-center justify-center shadow-inner">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-emerald-700 dark:text-emerald-300 font-medium">
                    光球想跟你確認一下 🌿
                  </p>
                  {pendingConfirmation.intentSummary && (
                    <p className="mt-1 text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                      {pendingConfirmation.intentSummary}
                    </p>
                  )}
                  <p className="mt-1 text-sm text-slate-800 dark:text-slate-100 font-medium leading-relaxed">
                    {pendingConfirmation.summary}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => cancelPending()}
                  className="flex-1 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="w-4 h-4 mr-1" />
                  先不要
                </Button>
                <Button
                  size="sm"
                  onClick={() => void confirmPending()}
                  className="flex-1 bg-gradient-to-r from-emerald-400 to-sky-400 hover:from-emerald-500 hover:to-sky-500 text-white border-0 shadow-md"
                >
                  <Check className="w-4 h-4 mr-1" />
                  好啊
                </Button>
              </div>

              <p className="text-[10px] text-slate-500 dark:text-slate-400 text-center pt-1">
                你永遠可以反悔，沒有什麼是不能重來的 ✨
              </p>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
