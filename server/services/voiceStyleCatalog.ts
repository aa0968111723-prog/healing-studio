/**
 * voiceStyleCatalog.ts — /video 旁白語音風格目錄（AIDV-254）
 * ----------------------------------------------------------------------------
 * 單一來源：把「既有」語音清單整理成前端可直接消費的目錄，供
 * proStudio.voiceStyles query 曝露給 /video 座艙的配音畫布（VoiceAmbientCanvas）。
 *
 * 資料來源（全部錨定 repo 既有清單，不新造 voice id）：
 *   - ElevenLabs：ELEVENLABS_BUILTIN_VOICES（server/services/elevenLabsExtended.ts）
 *     — 真實 ElevenLabs voice_id，可直接傳給 proStudio.elevenLabsTTS 的 voice_id。
 *   - Qwen TTS：ProStudio 頁面既有 qwenVoicePresets（Vivian/Dylan/Chelsie/Ethan）
 *     ＋ 聲聲 voice-specialist catalog 既有 Qwen 聲線（Cherry/Serena）
 *     — voice 名稱即 fal-ai/qwen-3-tts 的 voice 欄位值，可直接傳給
 *       proStudio.qwenTTS 的 voice。
 *
 * 加性承諾：此目錄純唯讀，不含任何計費/扣點邏輯；前端「系統預設」選項不傳
 * voice 參數 → 請求體與加此功能前位元相同（Qwen 後端預設 Vivian、ElevenLabs
 * 走上游預設聲線），預設行為零改變。
 */
import { ELEVENLABS_BUILTIN_VOICES } from "./elevenLabsExtended";

/** 單一語音風格選項（跨引擎統一形狀，前端選擇器直接渲染）。 */
export interface VoiceStyleOption {
  /** 傳給 TTS procedure 的值：ElevenLabs = voice_id；Qwen = voice 名稱 */
  id: string;
  /** 顯示名稱 */
  name: string;
  gender: "male" | "female";
  /** 一句話風格描述（給創作者判斷聲音氣質） */
  description: string;
  /** 主要語言／口音提示 */
  language: string;
}

/** 語音風格目錄（依 /video 配音畫布的兩個 TTS 引擎分組）。 */
export interface VoiceStyleCatalog {
  /** proStudio.elevenLabsTTS 可用聲線（voice_id） */
  elevenlabs: VoiceStyleOption[];
  /** proStudio.qwenTTS 可用聲線（voice 預訓練名稱） */
  qwen: VoiceStyleOption[];
}

/**
 * Qwen TTS（fal-ai/qwen-3-tts）內建聲線。
 * 名稱錨定 repo 既有兩個出貨中的清單：
 *   - client/src/pages/ProStudio.tsx qwenVoicePresets：Chelsie / Ethan / Vivian / Dylan
 *   - server/services/spiritTools/voiceSpecialistTools.ts VOICE_CATALOG：Cherry / Serena
 * 後端 qwenTTS 未帶 voice 時的預設值為 "Vivian"（proStudio.ts DEF-04）。
 */
export const QWEN_BUILTIN_VOICES: VoiceStyleOption[] = [
  { id: "Vivian", name: "Vivian", gender: "female", description: "中文女聲・自然溫暖，敘事／引導皆宜（後端預設）", language: "中文" },
  { id: "Dylan", name: "Dylan", gender: "male", description: "中文男聲・沉穩大氣", language: "中文" },
  { id: "Cherry", name: "Cherry", gender: "female", description: "中文女聲・明亮活潑，廣告／短影片", language: "中文" },
  { id: "Serena", name: "Serena", gender: "female", description: "中文女聲・柔和耳語，冥想／ASMR", language: "中文" },
  { id: "Chelsie", name: "Chelsie", gender: "female", description: "英文女聲・活潑清亮", language: "英文" },
  { id: "Ethan", name: "Ethan", gender: "male", description: "英文男聲・播報質感", language: "英文" },
];

/**
 * 組裝完整語音風格目錄。
 * ElevenLabs 部分逐一映射 ELEVENLABS_BUILTIN_VOICES（id/name/gender/description
 * 皆取自該常數，本模組不自造 voice_id）；口音映射為語言提示。
 */
export function getVoiceStyleCatalog(): VoiceStyleCatalog {
  const elevenlabs: VoiceStyleOption[] = ELEVENLABS_BUILTIN_VOICES.map((v) => ({
    id: v.voiceId,
    name: v.name,
    gender: v.gender as "male" | "female",
    description: v.description,
    language: v.accent === "British" ? "英文（英式）" : "英文（美式）",
  }));
  return { elevenlabs, qwen: QWEN_BUILTIN_VOICES };
}
