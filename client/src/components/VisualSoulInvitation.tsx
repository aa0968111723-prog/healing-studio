/**
 * VisualSoulInvitation.tsx — 光球行動與邀約系統
 *
 * 右下角浮動光球（VisualSoul），整合意圖推論狀態：
 *   - 平時安靜待命，微微呼吸光暈
 *   - 當 Sense Engine 偵測到使用者猶豫（choice_paralysis / clickAbort / inspiration_seeking）
 *     或被動瀏覽（passive_browsing）時，光球緩緩浮起並展開 OARS 風格提示氣泡
 *   - 提示氣泡引用使用者實際感興趣的卡片名稱，個性化引導
 *   - 點擊「一起去試試」按鈕，攜帶推薦參數無縫導航至 /studio
 *
 * OARS 合規：
 *   O (Open-ended): 提問而非命令，「要不要讓我幫你……？」
 *   A (Affirming): 肯定使用者的品味，「你很喜歡這張圖的光影」
 *   R (Reflective): 反映觀察到的行為，「我注意到你在這裡停留了一會兒」
 *   S (Summarizing): 簡潔收束，提供明確下一步
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { ArrowRight, X, Sparkles } from "lucide-react";
import VisualSoul from "./VisualSoul";
import type { Personality } from "./VisualSoul";
import type { SceneId } from "./AmbientEnvironment";
import type { IntentResult } from "@/hooks/useIntentInference";

// ─── Scene-Adaptive Bubble Styles ──────────────────────────────────────────

interface BubbleStyle {
  bg: string;
  border: string;
  text: string;
  textMuted: string;
  btnBg: string;
  btnText: string;
  glowColor: string;
}

const SCENE_BUBBLE_STYLES: Record<SceneId, BubbleStyle> = {
  nightSky: {
    bg: "rgba(15,18,50,0.88)",
    border: "rgba(100,120,220,0.25)",
    text: "text-slate-100",
    textMuted: "text-slate-400",
    btnBg: "bg-indigo-500/90 hover:bg-indigo-400/90",
    btnText: "text-white",
    glowColor: "rgba(100,140,255,0.3)",
  },
  morning: {
    bg: "rgba(255,248,240,0.92)",
    border: "rgba(220,180,140,0.3)",
    text: "text-amber-950",
    textMuted: "text-amber-700/70",
    btnBg: "bg-amber-600/90 hover:bg-amber-500/90",
    btnText: "text-white",
    glowColor: "rgba(255,180,80,0.3)",
  },
  cafe: {
    bg: "rgba(250,245,235,0.92)",
    border: "rgba(200,180,150,0.3)",
    text: "text-stone-900",
    textMuted: "text-stone-500",
    btnBg: "bg-stone-700/90 hover:bg-stone-600/90",
    btnText: "text-white",
    glowColor: "rgba(180,150,100,0.3)",
  },
  deepSea: {
    bg: "rgba(8,30,55,0.88)",
    border: "rgba(60,150,200,0.25)",
    text: "text-cyan-50",
    textMuted: "text-cyan-300/70",
    btnBg: "bg-cyan-600/90 hover:bg-cyan-500/90",
    btnText: "text-white",
    glowColor: "rgba(60,180,220,0.3)",
  },
};

// ─── OARS Invitation Templates ─────────────────────────────────────────────

interface InvitationTemplate {
  /** 主句：Open-ended + Reflective */
  message: (cardTitle?: string, modality?: string) => string;
  /** 行動按鈕文字 */
  cta: string;
}

/**
 * 依據意圖類型產生 OARS 風格邀約語句。
 * 每種意圖有多組模板，隨機選取避免重複感。
 */
const INVITATION_TEMPLATES: Record<string, InvitationTemplate[]> = {
  // 選擇困難 — 幫助簡化決策
  choice_paralysis: [
    {
      message: (title) =>
        title
          ? `我注意到你在好幾張作品之間猶豫，其中「${title}」似乎特別吸引你的目光。要不要讓我幫你把參數調好，我們直接去創作室試試看？`
          : `看起來你正在尋找最對味的靈感。不如讓我幫你挑一個起點，我們一起去試試看？`,
      cta: "好，一起去試試",
    },
    {
      message: (title) =>
        title
          ? `「${title}」的光影和構圖很有意思，對吧？有時候最好的方式就是直接動手。我可以幫你準備好一切，你只需要按下開始。`
          : `選擇太多反而讓人停下腳步，這很正常。讓我幫你從一個簡單的起點開始？`,
      cta: "幫我準備好",
    },
    {
      message: (title) =>
        title
          ? `你在「${title}」這裡停留了好一會兒，我猜你心裡已經有想法了。要不要我幫你把這個想法變成現實？`
          : `有時候靈感就在猶豫的那一刻。讓我幫你跨出第一步？`,
      cta: "帶我去創作",
    },
  ],

  // 靈感枯竭 — 提供方向
  inspiration_seeking: [
    {
      message: (title, modality) =>
        modality && modality !== "unknown"
          ? `看起來你對${modality === "image" ? "圖像" : modality === "video" ? "影片" : modality === "music" ? "音樂" : "語音"}創作特別感興趣。我可以幫你設定一個有趣的起點，讓靈感自然流動。`
          : `靈感有時候需要一點引子。讓我根據你剛才瀏覽的內容，幫你準備一個創作起點？`,
      cta: "給我一個起點",
    },
    {
      message: (title) =>
        title
          ? `「${title}」的風格很特別，你似乎被它吸引了。想不想用類似的風格，創造屬於你自己的版本？`
          : `每個人都有獨特的審美直覺。讓我根據你的瀏覽軌跡，推薦一個適合你的創作方向？`,
      cta: "推薦給我",
    },
  ],

  // 被動瀏覽 — 溫柔喚醒
  passive_browsing: [
    {
      message: () =>
        `看起來你正在悠閒地瀏覽，這也是一種靈感的醞釀方式。如果你準備好了，隨時可以進入創作室，我會在那裡等你。`,
      cta: "我準備好了",
    },
    {
      message: (title) =>
        title
          ? `「${title}」似乎引起了你的注意。有時候，最好的創作就是從一個讓你心動的作品開始。想試試看嗎？`
          : `慢慢來，沒有壓力。當你找到感興趣的東西時，我可以幫你快速開始。`,
      cta: "去看看",
    },
  ],

  // 美學偏好明確 — 強化方向
  aesthetic_preference: [
    {
      message: (title, _mod) =>
        title
          ? `我注意到你很喜歡「${title}」這類風格的作品。要不要讓我幫你把參數調好，我們直接去創作室試試看？`
          : `你的審美品味很獨特，我已經捕捉到你偏好的風格了。讓我幫你設定好參數，直接開始創作？`,
      cta: "調好參數，開始！",
    },
    {
      message: (title) =>
        title
          ? `「${title}」的色調和氛圍確實很迷人。我可以幫你用類似的美學設定，創造一個全新的作品。`
          : `你對特定的視覺風格有很好的直覺。讓我把這個偏好帶進創作室，為你量身打造一個起點。`,
      cta: "量身打造",
    },
  ],

  // 探索模式 — 不打擾，輕聲提示
  exploration_mode: [
    {
      message: () =>
        `你正在快速探索各種可能性，這是很棒的開始。當你找到心動的作品時，點擊它就能直接進入創作室。`,
      cta: "我知道了",
    },
  ],

  // 目標導向 — 快速通道
  goal_oriented: [
    {
      message: (title) =>
        title
          ? `看起來你已經知道自己想要什麼了。「${title}」是個很好的參考，要不要直接進入創作室？`
          : `你的目標很明確，讓我幫你快速進入創作室，省去多餘的步驟。`,
      cta: "直接開始",
    },
  ],
};

// ─── Trigger Logic ─────────────────────────────────────────────────────────

/** 判定是否應該觸發光球邀約 */
function shouldTriggerInvitation(intent: IntentResult | null): boolean {
  if (!intent) return false;
  if (intent.confidence < 0.4) return false;

  // 高觸發優先級：猶豫 / 靈感枯竭 / 被動瀏覽
  const highTriggerTypes = [
    "choice_paralysis",
    "inspiration_seeking",
    "passive_browsing",
  ];

  // 中觸發優先級：美學偏好明確
  const mediumTriggerTypes = ["aesthetic_preference"];

  if (highTriggerTypes.includes(intent.intentType)) return true;
  if (mediumTriggerTypes.includes(intent.intentType) && intent.confidence > 0.5) return true;

  // 低觸發：探索模式 / 目標導向（只在高信心時觸發）
  if (intent.confidence > 0.7) return true;

  return false;
}

/** 從推論結果中提取使用者最感興趣的卡片名稱 */
function extractFavoriteCard(intent: IntentResult): string | undefined {
  // psychologicalInsight 中可能包含引號包裹的卡片名
  const match = intent.psychologicalInsight.match(/「(.+?)」/);
  if (match) return match[1];

  // actionDetail 中也可能有
  const match2 = intent.actionDetail.match(/「(.+?)」/);
  if (match2) return match2[1];

  return undefined;
}

// ─── Component ─────────────────────────────────────────────────────────────

interface VisualSoulInvitationProps {
  sceneId: SceneId;
  personality?: Personality;
  intentResult: IntentResult | null;
  isInferring?: boolean;
  className?: string;
}

export default function VisualSoulInvitation({
  sceneId,
  personality = "creative",
  intentResult,
  isInferring = false,
  className = "",
}: VisualSoulInvitationProps) {
  const [, navigate] = useLocation();
  const bubbleStyle = SCENE_BUBBLE_STYLES[sceneId];

  // ── State ──
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [hasBeenShown, setHasBeenShown] = useState(false);
  const expandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissCountRef = useRef(0);

  // ── Invitation content ──
  const invitation = useMemo(() => {
    if (!intentResult) return null;

    const templates = INVITATION_TEMPLATES[intentResult.intentType];
    if (!templates || templates.length === 0) return null;

    // 穩定隨機選取模板
    const hash = intentResult.inferredAt % templates.length;
    const template = templates[hash];

    const cardTitle = extractFavoriteCard(intentResult);
    const message = template.message(cardTitle, intentResult.preferredModality);

    return {
      message,
      cta: template.cta,
      cardTitle,
    };
  }, [intentResult]);

  // ── Trigger: 偵測到猶豫時延遲浮起 ──
  useEffect(() => {
    if (!intentResult || isDismissed || hasBeenShown) return;
    if (dismissCountRef.current >= 2) return; // 最多觸發 2 次

    const shouldTrigger = shouldTriggerInvitation(intentResult);
    if (!shouldTrigger) return;

    // 延遲 2.5 秒後浮起（避免突兀）
    expandTimerRef.current = setTimeout(() => {
      setIsExpanded(true);
      setHasBeenShown(true);
    }, 2500);

    return () => {
      if (expandTimerRef.current) {
        clearTimeout(expandTimerRef.current);
      }
    };
  }, [intentResult, isDismissed, hasBeenShown]);

  // ── Dismiss handler ──
  const handleDismiss = useCallback(() => {
    setIsExpanded(false);
    setIsDismissed(true);
    dismissCountRef.current += 1;

    // 30 秒後允許再次觸發（如果有新的推論結果）
    setTimeout(() => {
      setIsDismissed(false);
      setHasBeenShown(false);
    }, 30_000);
  }, []);

  // ── Navigate to studio ──
  const handleAccept = useCallback(() => {
    // 攜帶推薦參數到 Studio
    if (intentResult) {
      const cardTitle = extractFavoriteCard(intentResult);
      const transferData: Record<string, unknown> = {
        source: "soul_invitation",
        intentType: intentResult.intentType,
        preferredModality: intentResult.preferredModality,
        detectedAesthetics: intentResult.detectedAesthetics,
        suggestedAction: intentResult.suggestedAction,
        actionDetail: intentResult.actionDetail,
        cardTitle: cardTitle || null,
        confidence: intentResult.confidence,
      };
      try {
        sessionStorage.setItem("soul_invitation_payload", JSON.stringify(transferData));
      } catch {
        // silent
      }
    }

    setIsExpanded(false);
    navigate("/studio");
  }, [intentResult, navigate]);

  // ── Click orb to toggle ──
  const handleOrbClick = useCallback(() => {
    if (isExpanded) {
      handleDismiss();
    } else if (invitation) {
      setIsExpanded(true);
    }
  }, [isExpanded, invitation, handleDismiss]);

  return (
    <div className={`fixed bottom-6 right-6 z-[60] ${className}`}>
      <AnimatePresence mode="wait">
        {/* ── Expanded: Bubble + Orb ── */}
        {isExpanded && invitation && (
          <motion.div
            key="bubble"
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{
              duration: 0.5,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="flex flex-col items-end gap-3"
          >
            {/* Bubble Card */}
            <motion.div
              className="relative max-w-[340px] rounded-2xl p-5 backdrop-blur-xl shadow-2xl"
              style={{
                background: bubbleStyle.bg,
                border: `1px solid ${bubbleStyle.border}`,
                boxShadow: `0 8px 32px ${bubbleStyle.glowColor}, 0 0 0 1px ${bubbleStyle.border}`,
              }}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            >
              {/* Close button */}
              <button
                onClick={handleDismiss}
                className={`absolute top-3 right-3 p-1 rounded-full transition-colors duration-200 hover:bg-white/10 ${bubbleStyle.textMuted}`}
                aria-label="關閉"
              >
                <X className="w-3.5 h-3.5" />
              </button>

              {/* Sparkle icon + intent label */}
              <div className="flex items-center gap-2 mb-3">
                <motion.div
                  animate={{ rotate: [0, 15, -15, 0] }}
                  transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                >
                  <Sparkles className={`w-4 h-4 ${bubbleStyle.textMuted}`} />
                </motion.div>
                {intentResult && (
                  <span className={`text-[10px] tracking-wide uppercase ${bubbleStyle.textMuted}`}>
                    {intentResult.intentLabel}
                  </span>
                )}
              </div>

              {/* OARS Message */}
              <p className={`text-sm leading-relaxed pr-4 ${bubbleStyle.text}`}>
                {invitation.message}
              </p>

              {/* Detected aesthetics tags */}
              {intentResult && intentResult.detectedAesthetics.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {intentResult.detectedAesthetics.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className={`text-[10px] px-2 py-0.5 rounded-full ${bubbleStyle.textMuted}`}
                      style={{ background: `${bubbleStyle.border}` }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* CTA Button */}
              <motion.button
                onClick={handleAccept}
                className={`mt-4 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${bubbleStyle.btnBg} ${bubbleStyle.btnText}`}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {invitation.cta}
                <ArrowRight className="w-3.5 h-3.5" />
              </motion.button>

              {/* Tail pointer (speech bubble tail) */}
              <div
                className="absolute -bottom-2 right-8 w-4 h-4 rotate-45"
                style={{
                  background: bubbleStyle.bg,
                  borderRight: `1px solid ${bubbleStyle.border}`,
                  borderBottom: `1px solid ${bubbleStyle.border}`,
                }}
              />
            </motion.div>

            {/* Orb (active state) */}
            <motion.button
              onClick={handleOrbClick}
              className="relative cursor-pointer"
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.95 }}
              aria-label="AI 光球助手"
            >
              {/* Pulse ring */}
              <motion.div
                className="absolute inset-0 rounded-full"
                animate={{
                  scale: [1, 1.5, 1],
                  opacity: [0.4, 0, 0.4],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: "easeOut",
                }}
                style={{
                  background: `radial-gradient(circle, ${bubbleStyle.glowColor}, transparent 70%)`,
                }}
              />
              <VisualSoul
                size="lg"
                personality={personality}
                state={isInferring ? "thinking" : "idle"}
                className="!w-14 !h-14"
              />
            </motion.button>
          </motion.div>
        )}

        {/* ── Collapsed: Just the Orb ── */}
        {!isExpanded && (
          <motion.button
            key="orb-only"
            onClick={handleOrbClick}
            className="relative cursor-pointer group"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            aria-label="AI 光球助手"
          >
            {/* Ambient glow */}
            <motion.div
              className="absolute -inset-3 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500"
              style={{
                background: `radial-gradient(circle, ${bubbleStyle.glowColor}, transparent 70%)`,
              }}
            />

            {/* Subtle notification dot when invitation is ready */}
            {invitation && !isDismissed && !hasBeenShown && (
              <motion.div
                className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full z-10"
                style={{
                  background: sceneId === "morning" || sceneId === "cafe"
                    ? "rgb(239,68,68)"
                    : "rgb(96,165,250)",
                }}
                animate={{
                  scale: [1, 1.3, 1],
                  opacity: [1, 0.7, 1],
                }}
                transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
              />
            )}

            <VisualSoul
              size="lg"
              personality={personality}
              state={isInferring ? "thinking" : "idle"}
              className="!w-12 !h-12"
            />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
