export interface AudioModelProfile {
  modelId: string;
  label: string;
  provider: "suno" | "elevenlabs" | "fal" | "gemini";
  strengths: string[];
  avoidWhen: string[];
  promptKeywords: string[];
  category?: "music-generation" | "sound-effects" | "ambient";
}

/**
 * 全站光球代理可共用的「音樂/音效模型資料庫（SSOT）」。
 *
 * 目標：
 * 1) 讓 Orb 能依提示詞內容，先做規則式音樂模型分流。
 * 2) 讓 planner / agent 在回答「用哪個音樂模型」時可引用統一資料來源。
 */
export const AUDIO_MODEL_REGISTRY: readonly AudioModelProfile[] = [
  {
    modelId: "suno-v4",
    label: "Suno V4",
    provider: "suno",
    category: "music-generation",
    strengths: ["完整歌曲創作", "人聲演唱", "高品質音樂", "多種風格"],
    avoidWhen: ["純音效", "極短片段", "即時生成"],
    promptKeywords: [
      "song",
      "music",
      "歌曲",
      "音樂",
      "lyrics",
      "歌詞",
      "vocal",
      "singing",
      "演唱",
      "complete track",
      "full song",
    ],
  },
  {
    modelId: "suno-v3.5",
    label: "Suno V3.5",
    provider: "suno",
    category: "music-generation",
    strengths: ["穩定版本", "平衡品質與速度", "通用音樂生成"],
    avoidWhen: ["需要最新功能", "極高品質要求"],
    promptKeywords: [
      "song",
      "music",
      "歌曲",
      "音樂",
      "standard",
      "balanced",
      "通用",
    ],
  },
  {
    modelId: "elevenlabs/music",
    label: "ElevenLabs Music",
    provider: "elevenlabs",
    category: "music-generation",
    strengths: ["AI 音樂生成", "快速創作", "情緒音樂"],
    avoidWhen: ["需要人聲演唱", "複雜編曲"],
    promptKeywords: [
      "music",
      "instrumental",
      "background music",
      "背景音樂",
      "配樂",
      "純音樂",
      "mood music",
      "氛圍音樂",
    ],
  },
  {
    modelId: "elevenlabs/sound-effects",
    label: "ElevenLabs 音效",
    provider: "elevenlabs",
    category: "sound-effects",
    strengths: ["音效生成", "快速製作", "多樣化音效"],
    avoidWhen: ["完整音樂", "長時間音頻"],
    promptKeywords: [
      "sound effect",
      "sfx",
      "音效",
      "sound",
      "noise",
      "短音效",
      "特效音",
      "環境音",
    ],
  },
  {
    modelId: "fal/stable-audio",
    label: "Stable Audio",
    provider: "fal",
    category: "music-generation",
    strengths: ["高品質音頻", "音樂與音效", "可控性強"],
    avoidWhen: ["需要歌詞", "人聲演唱"],
    promptKeywords: [
      "audio",
      "music",
      "sound",
      "音頻",
      "音樂",
      "stable",
      "high quality",
      "高品質",
    ],
  },
  {
    modelId: "fal/musicgen",
    label: "MusicGen (Meta)",
    provider: "fal",
    category: "music-generation",
    strengths: ["Meta 開源", "多樣風格", "通用音樂"],
    avoidWhen: ["商業級品質", "人聲需求"],
    promptKeywords: [
      "music",
      "音樂",
      "meta",
      "musicgen",
      "open source",
      "開源",
      "general music",
    ],
  },
  {
    modelId: "fal/ace-step",
    label: "ACE-Step",
    provider: "fal",
    category: "music-generation",
    strengths: ["創新音樂", "實驗性", "獨特風格"],
    avoidWhen: ["傳統音樂", "標準編曲"],
    promptKeywords: [
      "experimental",
      "creative",
      "innovative",
      "實驗",
      "創新",
      "獨特",
      "前衛",
    ],
  },
  {
    modelId: "fal/audioldm2",
    label: "AudioLDM 2",
    provider: "fal",
    category: "music-generation",
    strengths: ["音頻生成", "多用途", "快速"],
    avoidWhen: ["極高品質音樂"],
    promptKeywords: [
      "audio",
      "sound",
      "音頻",
      "fast",
      "quick",
      "快速",
      "general",
      "通用",
    ],
  },
  {
    modelId: "gemini/lyria-2",
    label: "Lyria 2 (Gemini)",
    provider: "gemini",
    category: "music-generation",
    strengths: ["Google 音樂 AI", "高品質", "多風格支援"],
    avoidWhen: ["需要完整歌詞創作"],
    promptKeywords: [
      "music",
      "lyria",
      "google",
      "gemini",
      "音樂",
      "high quality",
      "高品質",
    ],
  },
  {
    modelId: "gemini/musicfx",
    label: "MusicFX (Gemini)",
    provider: "gemini",
    category: "music-generation",
    strengths: ["Google 音樂工具", "快速生成", "實驗性"],
    avoidWhen: ["專業音樂製作"],
    promptKeywords: [
      "music",
      "musicfx",
      "google",
      "gemini",
      "音樂",
      "experimental",
      "實驗",
    ],
  },
];

export interface AudioModelMatch {
  modelId: string;
  score: number;
  matchedKeywords: string[];
  rationale: string;
}

export function rankAudioModelsByPrompt(prompt: string): AudioModelMatch[] {
  const normalized = prompt.toLowerCase();
  const matches = AUDIO_MODEL_REGISTRY.map(model => {
    const matchedKeywords = model.promptKeywords.filter(keyword =>
      normalized.includes(keyword.toLowerCase())
    );
    const score = matchedKeywords.length;
    return {
      modelId: model.modelId,
      score,
      matchedKeywords,
      rationale:
        score > 0
          ? `命中關鍵詞: ${matchedKeywords.join(", ")}`
          : "無直接關鍵詞命中，保留為備選",
    };
  });

  return matches.sort((a, b) => b.score - a.score);
}

export function pickBestAudioModel(prompt: string): AudioModelMatch {
  const [best] = rankAudioModelsByPrompt(prompt);
  if (best && best.score > 0) return best;

  return {
    modelId: "suno-v4",
    score: 0,
    matchedKeywords: [],
    rationale: "未命中任何關鍵詞，回退到全能預設模型 Suno V4",
  };
}
