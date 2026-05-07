/**
 * OrbFeatureSpotlight.tsx — 旋轉提示卡，把全站光球代理新功能搬到使用者眼前。
 *
 * 動機：搜尋快捷詞、PDF 匯出、shareViaLink、記憶儀表板都做完了但完全隱形。
 * 使用者進站不會知道這些存在；除非看到它們，否則永遠不會用。
 *
 * 設計原則：
 *   - 不打擾：只在 orb 開啟一段時間後出現第一個尚未看過的提示
 *   - 一次一張：一次只展示一張卡，避免提示牆
 *   - 可永久關掉：使用者按「不再顯示」就停止整個系列
 *   - 可單張略過：「下一個」跳到下一張
 *   - localStorage 持久化，跨 session 記得已看過哪幾張
 *
 * 純 React 元件，無外部 hook 依賴；放在 OrbCardStack 內側即可堆疊。
 */

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Brain,
  Download,
  Keyboard,
  Search,
  Share2,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";

interface FeatureTip {
  id: string;
  title: string;
  body: string;
  icon: LucideIcon;
  /** Suggested phrase the user can paste into the orb chat. */
  example?: string;
  /** Tone color for the icon chip. */
  tone: string;
}

const TIPS: FeatureTip[] = [
  {
    id: "search-shortcut",
    title: "全站搜尋快捷",
    body: "想找之前的素材或筆記？對光球說「找我之前的森林圖」「翻一下我的筆記提到禪意」，光球會直接搜尋資產／筆記／生成歷史／教學。",
    icon: Search,
    example: "找我之前的森林圖",
    tone: "text-amber-600 bg-amber-100/70 border-amber-200",
  },
  {
    id: "memory-dashboard",
    title: "光球記得你",
    body: "選過幾次風格、平台、用途後，光球會自動記住你的偏好。打開光球面板的「✨ 創作能力」分頁，就能看到記憶儀表板，也可以隨時清掉。",
    icon: Brain,
    tone: "text-violet-700 bg-violet-100/70 border-violet-200",
  },
  {
    id: "pdf-export",
    title: "聊天記錄存成 PDF",
    body: "想保存今天和光球的對話？跟光球說「把今天的對話匯出成 PDF」就會打開列印視窗，選「另存為 PDF」即可。",
    icon: Download,
    example: "把今天的對話匯出成 PDF",
    tone: "text-cyan-700 bg-cyan-100/70 border-cyan-200",
  },
  {
    id: "share-workflow",
    title: "工作流分享連結",
    body: "做出一個喜歡的跨頁工作流？跟光球說「把剛剛的流程做成連結」就會把所有步驟打包成 /process?spec=… 連結並複製到剪貼簿，可以分享給朋友。",
    icon: Share2,
    example: "把剛剛的流程做成連結",
    tone: "text-emerald-700 bg-emerald-100/70 border-emerald-200",
  },
  {
    id: "cmd-k",
    title: "鍵盤快捷",
    body: "在任何頁面按 ⌘K（Mac）或 Ctrl+K（Win）即可立刻喚出光球，再按 Esc 關掉。不需要找右下角浮動按鈕。",
    icon: Keyboard,
    tone: "text-rose-700 bg-rose-100/70 border-rose-200",
  },
];

const STORAGE_KEY_DISMISSED = "orb-feature-spotlight-dismissed";
const STORAGE_KEY_DISABLED = "orb-feature-spotlight-disabled";
const FIRST_TIP_DELAY_MS = 12_000;

function loadDismissed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DISMISSED);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter(v => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

function saveDismissed(set: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_DISMISSED, JSON.stringify(Array.from(set)));
  } catch {
    // best-effort
  }
}

function loadDisabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY_DISABLED) === "1";
  } catch {
    return false;
  }
}

function setDisabledStorage(disabled: boolean) {
  if (typeof window === "undefined") return;
  try {
    if (disabled) localStorage.setItem(STORAGE_KEY_DISABLED, "1");
    else localStorage.removeItem(STORAGE_KEY_DISABLED);
  } catch {
    // best-effort
  }
}

interface Props {
  /** When given, clicking the example phrase fires this callback instead of just inserting. */
  onTry?: (phrase: string) => void;
  /** Whether the orb chat is currently visible — only show tip when chat is open. */
  isChatOpen?: boolean;
}

export default function OrbFeatureSpotlight({ onTry, isChatOpen }: Props) {
  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissed);
  const [disabled, setDisabled] = useState<boolean>(loadDisabled);
  const [shown, setShown] = useState(false);

  // Show first tip only after a dwell delay so we don't crowd a brand-new
  // chat open. Reset the delay timer whenever the user dismisses one tip
  // so the next one appears with the same easing.
  useEffect(() => {
    if (disabled) return;
    if (!isChatOpen) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), FIRST_TIP_DELAY_MS);
    return () => clearTimeout(timer);
  }, [disabled, isChatOpen, dismissed.size]);

  const nextTip = useMemo<FeatureTip | null>(() => {
    if (disabled || !shown) return null;
    return TIPS.find(tip => !dismissed.has(tip.id)) ?? null;
  }, [dismissed, disabled, shown]);

  if (!nextTip) return null;

  const Icon = nextTip.icon;
  const total = TIPS.length;
  const seen = dismissed.size;

  const dismissOne = () => {
    const next = new Set(dismissed);
    next.add(nextTip.id);
    setDismissed(next);
    saveDismissed(next);
  };

  const dismissAll = () => {
    setDisabled(true);
    setDisabledStorage(true);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.96 }}
      transition={{ type: "spring", stiffness: 320, damping: 28 }}
      className="pointer-events-auto w-full md:w-[340px] max-w-[calc(100vw-2rem)] rounded-3xl border border-white/15 bg-gradient-to-br from-slate-950/95 via-slate-900/95 to-slate-950/95 p-4 text-white shadow-2xl backdrop-blur-xl"
      data-testid="orb-feature-spotlight"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-cyan-200/70">
          <Sparkles className="w-3 h-3" />
          光球小提示
          <span className="text-white/30">·</span>
          <span className="text-white/50 normal-case tracking-normal">
            {seen + 1} / {total}
          </span>
        </div>
        <button
          type="button"
          onClick={dismissOne}
          className="rounded-full bg-white/10 p-1 text-white/60 hover:bg-white/20 hover:text-white transition"
          aria-label="略過這張提示"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      <div className="flex items-start gap-3">
        <span
          className={`shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-xl border ${nextTip.tone}`}
        >
          <Icon className="w-4 h-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold mb-1">{nextTip.title}</div>
          <p className="text-xs leading-relaxed text-white/70">{nextTip.body}</p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={dismissAll}
          className="text-[10px] text-white/40 hover:text-white/70 transition"
        >
          不再顯示
        </button>
        <div className="flex items-center gap-1.5">
          {nextTip.example && onTry ? (
            <button
              type="button"
              onClick={() => {
                onTry(nextTip.example!);
                dismissOne();
              }}
              className="inline-flex items-center gap-1 rounded-full bg-cyan-300 px-3 py-1 text-[11px] font-semibold text-slate-900 hover:bg-cyan-200 transition"
              data-testid="orb-feature-spotlight-try"
            >
              試試看：{nextTip.example}
              <ArrowRight className="w-3 h-3" />
            </button>
          ) : (
            <button
              type="button"
              onClick={dismissOne}
              className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-white/80 hover:bg-white/20 transition"
            >
              下一個
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Test helpers ────────────────────────────────────────────────────────

export function __unsafe_resetSpotlightStateForTests() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY_DISMISSED);
    localStorage.removeItem(STORAGE_KEY_DISABLED);
  } catch {
    // best-effort
  }
}

export const __SPOTLIGHT_TIPS_FOR_TESTS = TIPS;
