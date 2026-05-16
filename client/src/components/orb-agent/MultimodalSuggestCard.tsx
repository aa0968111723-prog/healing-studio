/**
 * MultimodalSuggestCard — 使用者輸入跨多模態（影片＋音樂、圖＋配音…）
 * 但目前不是「多步驟代理」模式時，彈一張卡詢問要不要轉成多步驟，避免單
 * 步驟模式只解到第一個任務、另一半被忽略。
 *
 * 純展示元件：呼叫端負責偵測 + 開關。設計上和 StepByStepConfirmCard 同
 * 一視覺語彙（cyan / glass card），讓使用者看到不同 confirm 都是同一系
 * 列的詢問，不會誤判成錯誤訊息。
 */

import { Sparkles, X } from "lucide-react";

interface Props {
  /** 偵測到的模態中文標籤（例如 ["影片", "音樂", "配音"]）。 */
  modalityLabels: string[];
  /** 使用者按「轉多步驟」。呼叫端要 setActiveMode("multi-step") 並重送。 */
  onAccept: () => void;
  /** 使用者按「維持目前」。呼叫端用原本模式繼續送出。 */
  onDecline: () => void;
}

export function MultimodalSuggestCard({
  modalityLabels,
  onAccept,
  onDecline,
}: Props) {
  const labelText = modalityLabels.join("、");
  return (
    <div
      className="fixed bottom-24 right-5 z-[86] w-[380px] max-w-[calc(100vw-2rem)] rounded-3xl border border-cyan-200/20 bg-muted/95 p-4 text-white shadow-2xl backdrop-blur-xl"
      role="dialog"
      aria-label="光球：建議轉成多步驟代理"
      data-testid="multimodal-suggest-card"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-xl bg-cyan-300/15 text-cyan-200">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <span className="text-xs uppercase tracking-[0.2em] text-cyan-200/70">
            多模態任務
          </span>
        </div>
        <button
          type="button"
          onClick={onDecline}
          className="rounded-full p-1 text-white/50 hover:bg-card/10 hover:text-white"
          aria-label="關閉"
          data-testid="multimodal-suggest-close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <p className="mt-3 text-sm font-semibold leading-snug">
        看起來你想做的事跨了「{labelText}」
      </p>
      <p className="mt-1 text-xs leading-relaxed text-white/70">
        要不要交給「多步驟代理」一次跑完？光球會自動安排跨工具流程，逐步幫你
        產出每一段素材。
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onDecline}
          className="rounded-2xl bg-card/10 px-3 py-2 text-xs text-white/80 hover:bg-card/15"
          data-testid="multimodal-suggest-decline"
        >
          維持目前模式
        </button>
        <button
          type="button"
          onClick={onAccept}
          className="rounded-2xl bg-cyan-300 px-3 py-2 text-xs font-semibold text-foreground hover:bg-cyan-200"
          data-testid="multimodal-suggest-accept"
        >
          轉多步驟代理
        </button>
      </div>
    </div>
  );
}
