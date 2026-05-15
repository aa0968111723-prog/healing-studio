/**
 * Director template library, quick-action catalog, and shared utilities
 * (timeout wrapper, fence-tolerant JSON extractor wrapper).
 *
 * Extracted from server/routers/director.ts so the router file can stay
 * focused on tRPC procedure wiring.
 */

import {
  extractMessageJson as extractMessageJsonRaw,
} from "../../_core/llm";
import { extractJsonObjectFromText } from "../../../shared/agent-plan-adapter";
import type { DirectorTemplate, QuickAction } from "../../../shared/types";

// ─── Timeout Utility ────────────────────────────────────────────────────────

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = "API"
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(`${label} 回應超時（${Math.round(ms / 1000)}秒），請稍後再試`)
      );
    }, ms);
    promise
      .then(val => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch(err => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

// 把 fence-tolerant 解析器注入共用 helper，避免每個 call site 重複處理 array-form content。
export const extractMessageJson = (
  content: Parameters<typeof extractMessageJsonRaw>[0]
): unknown => extractMessageJsonRaw(content, extractJsonObjectFromText);

// ─── Template Library ───────────────────────────────────────────────────────

export const DIRECTOR_TEMPLATES: DirectorTemplate[] = [
  {
    id: "short-film-emotion",
    label: "情感短片",
    description: "一部 60 秒的情感故事短片，聚焦於角色的內心世界",
    category: "short-film",
    prompt:
      "幫我構思一部 60 秒的情感短片。主題是關於離別與重逢，我想要溫暖但帶有一點憂傷的氛圍。目標觀眾是 20-35 歲的年輕人。",
    personality: "creative",
  },
  {
    id: "meditation-guide",
    label: "冥想引導",
    description: "10 分鐘的冥想引導音頻，搭配視覺化場景",
    category: "meditation",
    prompt:
      "設計一段 10 分鐘的冥想引導，主題是「森林中的寧靜」。需要語音引導腳本和背景音樂風格建議。",
    personality: "calm",
  },
  {
    id: "brand-promo",
    label: "品牌宣傳",
    description: "30 秒品牌宣傳影片，強調品牌核心價值",
    category: "brand",
    prompt:
      "製作一支 30 秒的品牌宣傳影片。品牌核心是「科技與人文的交匯」，目標是讓觀眾感受到溫度與創新並存。",
    personality: "calm",
  },
  {
    id: "music-video-dream",
    label: "夢境 MV",
    description: "充滿夢幻意象的音樂影片概念",
    category: "music-video",
    prompt:
      "構思一支夢境風格的音樂影片。曲風是 dream pop / shoegaze，我想要大量的光影效果、慢動作和超現實元素。",
    personality: "creative",
  },
  {
    id: "tutorial-creative",
    label: "創意教學",
    description: "step-by-step 創意教學影片腳本",
    category: "tutorial",
    prompt:
      "設計一支 3 分鐘的創意教學影片，教觀眾如何用 AI 工具從零開始創作一張概念藝術圖。需要清晰的步驟分解。",
    personality: "technical",
  },
  {
    id: "ad-product",
    label: "產品廣告",
    description: "15 秒產品廣告，注重視覺衝擊力",
    category: "ad",
    prompt:
      "製作一支 15 秒的產品廣告。產品是一款智能音箱。需要強烈的視覺節奏、產品特寫和生活場景切換。",
    personality: "technical",
  },
];

// ─── Quick Actions for Multi-Modal Discussion ───────────────────────────────

export const QUICK_ACTIONS: QuickAction[] = [
  // Visual
  {
    id: "enhance-visual",
    label: "Enhance Visual",
    labelZh: "強化視覺",
    icon: "image",
    promptTemplate:
      "請針對這段分鏡的視覺描述進行強化，增加更豐富的畫面細節、光影描述、色調與構圖建議。",
    category: "visual",
  },
  {
    id: "add-camera",
    label: "Camera Direction",
    labelZh: "鏡頭運動",
    icon: "video",
    promptTemplate:
      "請為這段分鏡添加具體的鏡頭運動建議（如推拉搖移跟、特寫、中景、遠景等），並說明每個鏡頭選擇的理由。",
    category: "visual",
  },
  {
    id: "color-palette",
    label: "Color Palette",
    labelZh: "色彩設計",
    icon: "palette",
    promptTemplate:
      "請為這段分鏡設計一個完整的色彩方案，包含主色調、輔助色、點綴色，並說明這些顏色如何服務敘事情緒。",
    category: "visual",
  },
  {
    id: "reference-style",
    label: "Style Reference",
    labelZh: "風格參考",
    icon: "sparkles",
    promptTemplate:
      "請為這段分鏡推薦視覺風格參考（電影、攝影師、藝術家或藝術流派），並說明如何在 AI 生成時運用這些風格。",
    category: "visual",
  },
  // Audio
  {
    id: "sound-design",
    label: "Sound Design",
    labelZh: "音效設計",
    icon: "volume",
    promptTemplate:
      "請為這段分鏡設計完整的音效層次，包括環境音、音效、配樂風格、音量變化，並建議適合的 AI 音樂模型。",
    category: "audio",
  },
  {
    id: "dialogue-polish",
    label: "Dialogue Polish",
    labelZh: "對白優化",
    icon: "mic",
    promptTemplate:
      "請優化這段分鏡的對白，使語調更自然、更符合角色性格，並標注語氣和情緒提示。",
    category: "audio",
  },
  {
    id: "voiceover",
    label: "Voiceover Script",
    labelZh: "旁白腳本",
    icon: "headphones",
    promptTemplate:
      "請為這段分鏡撰寫旁白腳本，包含語氣標註、節奏控制、停頓位置，適合 TTS 生成。",
    category: "audio",
  },
  // Narrative
  {
    id: "pacing",
    label: "Pacing",
    labelZh: "節奏調整",
    icon: "timer",
    promptTemplate:
      "請分析並調整這段分鏡的敘事節奏，建議哪些地方需要加速或放慢，如何營造張力和釋放。",
    category: "narrative",
  },
  {
    id: "emotion-arc",
    label: "Emotion Arc",
    labelZh: "情緒弧線",
    icon: "heart",
    promptTemplate:
      "請分析這段分鏡的情緒走向，建議如何強化情緒弧線，讓觀眾在關鍵時刻產生共鳴。",
    category: "narrative",
  },
  {
    id: "transition",
    label: "Transition",
    labelZh: "轉場設計",
    icon: "shuffle",
    promptTemplate:
      "請設計這段分鏡與前後段之間的轉場方式，可以是視覺轉場、聲音轉場或概念轉場。",
    category: "narrative",
  },
  // Technical
  {
    id: "gen-params",
    label: "Gen Parameters",
    labelZh: "生成參數",
    icon: "settings",
    promptTemplate:
      "請為這段分鏡建議具體的 AI 生成參數，包括推薦模型、解析度、步數、CFG 值、種子碼策略等。",
    category: "technical",
  },
  {
    id: "prompt-optimize",
    label: "Optimize Prompt",
    labelZh: "提示詞優化",
    icon: "wand",
    promptTemplate:
      "請將這段分鏡的描述轉化為最佳化的英文 AI 生成提示詞（Prompt），包含正向與負向提示詞。",
    category: "technical",
  },
  // Mood
  {
    id: "mood-shift",
    label: "Mood Shift",
    labelZh: "氛圍轉換",
    icon: "sun",
    promptTemplate:
      "請嘗試將這段分鏡的氛圍往不同方向調整，提供 2-3 種氛圍變體供選擇。",
    category: "mood",
  },
  {
    id: "intensity",
    label: "Intensity",
    labelZh: "強度調整",
    icon: "zap",
    promptTemplate:
      "請調整這段分鏡的戲劇張力強度，提供「低張力」、「中張力」、「高張力」三個版本。",
    category: "mood",
  },
  // Continuity (cross-segment awareness)
  {
    id: "continuity-check",
    label: "Continuity",
    labelZh: "連續性檢查",
    icon: "shuffle",
    promptTemplate:
      "請檢查這段分鏡與前後段落之間的連續性，包括角色動線、場景轉換邏輯、情緒連貫性、視覺風格一致性。指出任何斷裂或不銜接之處，並提供具體的修正建議。",
    category: "narrative",
  },
  {
    id: "character-arc",
    label: "Character Arc",
    labelZh: "角色弧線",
    icon: "heart",
    promptTemplate:
      "請分析這段分鏡中角色的情感變化與行為動機，確認是否符合整體角色弧線。如果存在角色行為不一致或動機薄弱的問題，請提供改善建議。",
    category: "narrative",
  },
  {
    id: "visual-continuity",
    label: "Visual Style",
    labelZh: "視覺風格統一",
    icon: "eye",
    promptTemplate:
      "請分析這段分鏡的視覺風格是否與整體作品保持一致，包括色調、光線、構圖語言、攝影風格。如果有偏離，建議如何調整以保持視覺統一性。",
    category: "visual",
  },
  {
    id: "prompt-enhance-en",
    label: "EN Prompt Pro",
    labelZh: "英文提示詞專業版",
    icon: "wand",
    promptTemplate:
      "請將這段分鏡的所有視覺描述轉化為專業級的英文 AI 生成提示詞。格式要求：\n1. 正向提示詞（含主體、風格、光線、構圖、品質標籤）\n2. 負向提示詞（排除不需要的元素）\n3. 推薦的模型和參數設定（如 CFG Scale、Steps、Sampler）\n4. 如果適合，建議 ControlNet 類型。",
    category: "technical",
  },
];
