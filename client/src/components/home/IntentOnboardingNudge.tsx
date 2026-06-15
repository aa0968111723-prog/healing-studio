// ============================================================================
// components/home/IntentOnboardingNudge.tsx — I-9 意圖個人化引導（AIDV-87 · Phase 1）
// ----------------------------------------------------------------------------
// 【定位】把既有「Sense 意圖引擎」（useSenseEngine → useIntentInference，後端
//   sense.inferIntent LIVE，原本只餵 LLM 上下文與隱藏的低語卡）的推論結果，第一次
//   拿來做「引導路由」：依使用者當下意圖類型，在首頁給一張「下一步該去哪」的引導卡
//   （選擇困難→導演企劃台、找靈感/探索→六大系統、目標導向→創作中樞、明顯美學→單模型
//   遊樂場），降低從首頁到開工的決策成本。
//
// 【Phase 1 邊界】純前端、唯讀消費既有 intentResult；不改 Sense 引擎、不改生成。
//   個人化可關閉：按「不用了」寫 localStorage 旗標 → 本機關閉（＝「可在設定關閉個人化」
//   的最小落地）。信心度 < 0.4 或已關閉 → 不顯示（不打擾）。
//
// 【旗標】掛載端（Home）以 HOME_FEATURE_FLAGS.showIntentOnboarding 守門，預設 OFF＝
//   不渲染＝線上零變化；本元件本身不持有旗標，純呈現。
//
// 路由皆對映 shared/appRegistry 已註冊路徑（check:navigation 安全）；導航用 wouter
//   useLocation（與 Home/OrbCreationStage 同慣例），不碰 window.location。
// ============================================================================
import { useState } from "react";
import { useLocation } from "wouter";
import { Compass, Sparkles, Target, Palette, Clapperboard, X, type LucideIcon } from "lucide-react";
import type { IntentResult } from "@/hooks/useIntentInference";

const DISMISS_KEY = "sense_onboarding_dismissed";

interface Guide {
  route: string;
  cta: string;
  framing: string;
  icon: LucideIcon;
}

/** intentType → 引導目的地（皆對映 appRegistry 真實路由）。未知類型 → 不顯示（防呆）。 */
const INTENT_GUIDE: Record<string, Guide> = {
  choice_paralysis: {
    route: "/director",
    cta: "用導演企劃台一步步來",
    framing: "不用一次面對所有選擇，跟著分鏡企劃流程一步步走就好。",
    icon: Clapperboard,
  },
  goal_oriented: {
    route: "/create",
    cta: "直接開始創作",
    framing: "你目標明確，從創作中樞一條龍把作品做出來。",
    icon: Target,
  },
  aesthetic_preference: {
    route: "/playground",
    cta: "挑模型開始生成",
    framing: "你已有明確風格偏好，到單模型遊樂場直接選型試生成。",
    icon: Palette,
  },
  inspiration_seeking: {
    route: "/studio",
    cta: "逛六大系統找靈感",
    framing: "先到六大創作系統看看，靈感常常是逛出來的。",
    icon: Sparkles,
  },
  exploration_mode: {
    route: "/studio",
    cta: "自由探索六大系統",
    framing: "慢慢逛，找到感興趣的方向再開工。",
    icon: Compass,
  },
  passive_browsing: {
    route: "/create",
    cta: "準備好就從這裡開始",
    framing: "想動手的時候，創作中樞隨時在這裡等你。",
    icon: Target,
  },
};

function isDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function IntentOnboardingNudge({ intentResult }: { intentResult: IntentResult | null }) {
  const [, navigate] = useLocation();
  const [dismissed, setDismissed] = useState<boolean>(isDismissed);

  if (dismissed) return null;
  if (!intentResult || intentResult.confidence < 0.4) return null;
  const guide = INTENT_GUIDE[intentResult.intentType];
  if (!guide) return null;

  const Icon = guide.icon;
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* 私密模式 / localStorage 不可用 → 仍以本地狀態關閉本次 */
    }
    setDismissed(true);
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <div className="relative rounded-2xl border bg-card/60 px-5 py-4 backdrop-blur-md">
        <button
          type="button"
          onClick={dismiss}
          aria-label="關閉個人化引導"
          className="absolute right-3 top-3 rounded-full p-1 text-muted-foreground/60 transition-colors hover:text-foreground"
        >
          <X className="size-4" />
        </button>
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-0.5 text-xs font-medium text-muted-foreground">
              {intentResult.intentLabel || "為你推薦"}
            </div>
            <p className="text-sm leading-relaxed text-foreground">{guide.framing}</p>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => navigate(guide.route)}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground transition-healing hover:opacity-90"
              >
                {guide.cta}
              </button>
              <button
                type="button"
                onClick={dismiss}
                className="text-[11px] text-muted-foreground/70 transition-colors hover:text-muted-foreground"
              >
                不用了，我自己逛
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default IntentOnboardingNudge;
