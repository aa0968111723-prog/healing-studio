export interface VoiceModelProfile {
  modelId: string;
  label: string;
  provider: "elevenlabs" | "fal" | "gemini";
  strengths: string[];
  avoidWhen: string[];
  promptKeywords: string[];
  category?: "tts-premium" | "tts-fast" | "tts-multilingual";
}

/**
 * 全站光球代理可共用的「語音合成模型資料庫（SSOT）」。
 *
 * 目標：
 * 1) 讓 Orb 能依提示詞內容，先做規則式語音模型分流。
 * 2) 讓 planner / agent 在回答「用哪個語音模型」時可引用統一資料來源。
 */
export const VOICE_MODEL_REGISTRY: readonly VoiceModelProfile[] = [
  {
    modelId: "elevenlabs/eleven-v3",
    label: "ElevenLabs V3",
    provider: "elevenlabs",
    category: "tts-premium",
    strengths: ["最高品質", "自然語音", "情感表達", "多語言支援"],
    avoidWhen: ["需要極速生成", "簡單朗讀"],
    promptKeywords: [
      "high quality",
      "premium",
      "natural",
      "emotion",
      "expressive",
      "高品質",
      "自然",
      "情感",
      "表現力",
      "專業",
    ],
  },
  {
    modelId: "elevenlabs/multilingual-v2",
    label: "ElevenLabs Multilingual V2",
    provider: "elevenlabs",
    category: "tts-multilingual",
    strengths: ["多語言", "跨語言", "國際化", "高品質"],
    avoidWhen: ["單一語言", "需要最新版本"],
    promptKeywords: [
      "multilingual",
      "multi-language",
      "international",
      "多語言",
      "跨語言",
      "國際",
      "translation",
      "翻譯",
    ],
  },
  {
    modelId: "elevenlabs/turbo-v2.5",
    label: "ElevenLabs Turbo V2.5",
    provider: "elevenlabs",
    category: "tts-fast",
    strengths: ["快速生成", "即時語音", "低延遲", "效率優先"],
    avoidWhen: ["需要最高品質", "情感豐富度"],
    promptKeywords: [
      "fast",
      "quick",
      "turbo",
      "speed",
      "realtime",
      "快速",
      "即時",
      "低延遲",
      "效率",
    ],
  },
  {
    modelId: "elevenlabs/flash-v2.5",
    label: "ElevenLabs Flash V2.5",
    provider: "elevenlabs",
    category: "tts-fast",
    strengths: ["極速生成", "最低延遲", "批次處理"],
    avoidWhen: ["高品質要求", "複雜情感"],
    promptKeywords: [
      "flash",
      "fastest",
      "instant",
      "batch",
      "極速",
      "最快",
      "批次",
      "大量",
    ],
  },
  {
    modelId: "fal/playai-tts",
    label: "PlayAI TTS",
    provider: "fal",
    category: "tts-premium",
    strengths: ["自然語音", "高品質", "清晰度高"],
    avoidWhen: ["多語言需求"],
    promptKeywords: [
      "playai",
      "natural",
      "clear",
      "quality",
      "自然",
      "清晰",
      "品質",
    ],
  },
  {
    modelId: "fal/kokoro",
    label: "Kokoro TTS",
    provider: "fal",
    category: "tts-fast",
    strengths: ["快速", "輕量", "效率高"],
    avoidWhen: ["專業配音", "複雜情感"],
    promptKeywords: [
      "kokoro",
      "fast",
      "lightweight",
      "efficient",
      "快速",
      "輕量",
      "效率",
    ],
  },
  {
    modelId: "fal/orpheus-tts",
    label: "Orpheus TTS",
    provider: "fal",
    category: "tts-premium",
    strengths: ["標準 TTS", "穩定", "通用"],
    avoidWhen: ["特殊需求"],
    promptKeywords: [
      "orpheus",
      "standard",
      "general",
      "stable",
      "標準",
      "通用",
      "穩定",
    ],
  },
  {
    modelId: "fal/dia-tts",
    label: "Dia TTS",
    provider: "fal",
    category: "tts-premium",
    strengths: ["對話式", "自然交談", "互動感"],
    avoidWhen: ["單向朗讀"],
    promptKeywords: [
      "dia",
      "dialogue",
      "conversation",
      "interactive",
      "對話",
      "交談",
      "互動",
      "聊天",
    ],
  },
  {
    modelId: "gemini/tts-flash",
    label: "Gemini TTS Flash",
    provider: "gemini",
    category: "tts-fast",
    strengths: ["Google 快速 TTS", "低延遲", "整合性好"],
    avoidWhen: ["最高品質需求"],
    promptKeywords: [
      "gemini",
      "google",
      "flash",
      "fast",
      "quick",
      "快速",
      "即時",
    ],
  },
  {
    modelId: "gemini/tts-pro",
    label: "Gemini TTS Pro",
    provider: "gemini",
    category: "tts-premium",
    strengths: ["Google 高品質 TTS", "自然語音", "多語言"],
    avoidWhen: ["需要極速"],
    promptKeywords: [
      "gemini",
      "google",
      "pro",
      "premium",
      "quality",
      "professional",
      "高品質",
      "專業",
    ],
  },
];

export interface VoiceModelMatch {
  modelId: string;
  score: number;
  matchedKeywords: string[];
  rationale: string;
}

export function rankVoiceModelsByPrompt(prompt: string): VoiceModelMatch[] {
  const normalized = prompt.toLowerCase();
  const matches = VOICE_MODEL_REGISTRY.map(model => {
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

export function pickBestVoiceModel(prompt: string): VoiceModelMatch {
  const [best] = rankVoiceModelsByPrompt(prompt);
  if (best && best.score > 0) return best;

  return {
    modelId: "elevenlabs/eleven-v3",
    score: 0,
    matchedKeywords: [],
    rationale: "未命中任何關鍵詞，回退到全能預設模型 ElevenLabs V3",
  };
}
