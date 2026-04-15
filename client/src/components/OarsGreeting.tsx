/**
 * OarsGreeting.tsx — 情境問候語元件
 *
 * 基於 OARS 動機式晤談心理學 + 當地時間的柔性引導：
 *   - Open-ended：開放式提問，不預設答案
 *   - Affirming：肯定使用者的存在與創意潛能
 *   - Reflective：反映當下情境（時間/場景）
 *   - Summarizing：簡潔收束，引導下一步
 *
 * 每場景 6+ 句主問候語 + 6+ 句副引導語，隨機輪替。
 * 打字機動畫逐字浮現，溫暖節奏。
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { SceneId } from "@/components/AmbientEnvironment";

// ─── OARS Greeting Database ─────────────────────────────────────────────────

interface GreetingSet {
  /** 主問候語（Open-ended + Reflective） */
  headlines: string[];
  /** 副引導語（Affirming + Summarizing） */
  subtexts: string[];
}

const SCENE_GREETINGS: Record<SceneId, GreetingSet> = {
  nightSky: {
    headlines: [
      "夜深了，靈感正悄悄甦醒。",
      "星空之下，什麼畫面在你腦海浮現？",
      "夜晚是最誠實的創作時刻。",
      "萬籟俱寂，你的想像力正在發光。",
      "深夜的靈感，往往最接近真實。",
      "在這片星空下，你想創造什麼？",
      "夜色溫柔，適合醞釀一個好故事。",
    ],
    subtexts: [
      "不急，讓想法自然浮現",
      "每一個深夜的念頭都值得被記錄",
      "你的創意不需要完美，只需要開始",
      "試試看，把此刻的感受化為作品",
      "星光會為你的靈感指路",
      "安靜的夜晚，最適合聆聽內心的聲音",
    ],
  },
  morning: {
    headlines: [
      "晨光真美，今天想捕捉什麼樣的靈感？",
      "新的一天，新的可能正在展開。",
      "早安，你的創意已經準備好了嗎？",
      "清晨的第一道光，像極了靈感的起點。",
      "今天的你，想用什麼方式表達自己？",
      "每個早晨都是一張空白畫布。",
      "陽光灑進來了，帶著它去創作吧。",
    ],
    subtexts: [
      "帶著好心情，從一個小想法開始",
      "今天的第一步，可以很輕很小",
      "晨間的靈感特別清澈，值得珍惜",
      "不需要宏大計畫，一個念頭就足夠",
      "讓陽光和你的想像力一起暖身",
      "早起的創作者，已經贏了一半",
    ],
  },
  cafe: {
    headlines: [
      "午後時光，來杯咖啡配一點靈感？",
      "陽光正好，適合醞釀一個好點子。",
      "下午的節奏剛剛好，不急不徐。",
      "這個時刻，你最想創造什麼？",
      "午後的光線最溫柔，像你的創意一樣。",
      "放鬆一下，讓靈感自己找上門。",
      "一杯咖啡的時間，足以誕生一個作品。",
    ],
    subtexts: [
      "隨意瀏覽，說不定會遇見驚喜",
      "午後適合慢慢探索，不趕時間",
      "你的直覺比你想的更準確",
      "試著用不同的角度看看世界",
      "靈感往往藏在放鬆的瞬間",
      "享受過程，結果會自然到來",
    ],
  },
  deepSea: {
    headlines: [
      "傍晚的寧靜，適合潛入創作的深海。",
      "暮色漸濃，你的想像力正在深處發光。",
      "黃昏時分，最適合沉浸式的創作。",
      "夕陽西下，帶著今天的感受去創造吧。",
      "深海般的寧靜中，靈感正在結晶。",
      "傍晚的光影變幻，像極了創意的流動。",
      "在這片深藍中，你想探索什麼？",
    ],
    subtexts: [
      "沉浸其中，讓創意自由流動",
      "傍晚的靈感帶著一天的沉澱",
      "不需要方向，跟著感覺走就好",
      "深呼吸，讓想法慢慢浮上來",
      "今天經歷的一切，都是創作的養分",
      "在深海中漫遊，每一步都是發現",
    ],
  },
};

// ─── Typewriter Hook ────────────────────────────────────────────────────────

function useTypewriter(
  text: string,
  speed: number = 60,
  startDelay: number = 300
) {
  const [displayed, setDisplayed] = useState("");
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    setDisplayed("");
    setIsComplete(false);

    const delayTimer = setTimeout(() => {
      let idx = 0;
      const interval = setInterval(() => {
        idx++;
        setDisplayed(text.slice(0, idx));
        if (idx >= text.length) {
          clearInterval(interval);
          setIsComplete(true);
        }
      }, speed);

      return () => clearInterval(interval);
    }, startDelay);

    return () => clearTimeout(delayTimer);
  }, [text, speed, startDelay]);

  return { displayed, isComplete };
}

// ─── Stable Random Picker ───────────────────────────────────────────────────

function useStableRandom<T>(items: T[], seed?: string): T {
  return useMemo(() => {
    // Use a simple hash of the seed (or current minute) for stability
    const s =
      seed ||
      `${new Date().getHours()}-${Math.floor(new Date().getMinutes() / 10)}`;
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
    }
    const index = Math.abs(hash) % items.length;
    return items[index];
  }, [items, seed]);
}

// ─── Component ──────────────────────────────────────────────────────────────

interface OarsGreetingProps {
  sceneId: SceneId;
  className?: string;
  /** Scene-adaptive text color classes */
  textPrimary?: string;
  textMuted?: string;
}

export default function OarsGreeting({
  sceneId,
  className = "",
  textPrimary = "text-white",
  textMuted = "text-white/60",
}: OarsGreetingProps) {
  const greetings = SCENE_GREETINGS[sceneId];

  // Pick a headline and subtext that stays stable for ~10 minutes
  const headline = useStableRandom(greetings.headlines);
  const subtext = useStableRandom(greetings.subtexts, `sub-${sceneId}`);

  // Typewriter animation for the headline
  const { displayed: typedHeadline, isComplete } = useTypewriter(
    headline,
    55,
    500
  );

  // Cursor blink
  const [showCursor, setShowCursor] = useState(true);
  useEffect(() => {
    if (isComplete) {
      // Blink a few times then hide
      let count = 0;
      const interval = setInterval(() => {
        setShowCursor(prev => !prev);
        count++;
        if (count >= 6) {
          clearInterval(interval);
          setShowCursor(false);
        }
      }, 400);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [isComplete]);

  return (
    <div className={`text-center ${className}`}>
      {/* Main Headline — Typewriter */}
      <h1 className={`hs-h1 transition-colors duration-1000 ${textPrimary}`}>
        <span>{typedHeadline}</span>
        <span
          className={`inline-block w-[2px] h-[1em] ml-1 align-middle transition-opacity duration-200 ${
            showCursor || !isComplete ? "opacity-100" : "opacity-0"
          }`}
          style={{
            background: "currentColor",
            verticalAlign: "baseline",
          }}
        />
      </h1>

      {/* Subtext — Fade in after typewriter completes */}
      <AnimatePresence>
        {isComplete && (
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className={`mt-4 sm:mt-5 hs-p max-w-xl mx-auto !mb-0 transition-colors duration-1000 ${textMuted}`}
          >
            {subtext}
          </motion.p>
        )}
      </AnimatePresence>

      {/* Platform descriptor — subtle, always visible */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.5 }}
        transition={{ duration: 1.2, delay: 2 }}
        className={`mt-2 sm:mt-3 hs-small !mb-0 tracking-widest uppercase transition-colors duration-1000 ${textMuted}`}
        style={{ opacity: 0.4 }}
      >
        Healing Studio · AI 多模態創作平台
      </motion.p>
    </div>
  );
}
