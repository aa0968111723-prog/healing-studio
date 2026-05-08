/**
 * shared/modelPromptTemplates.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * 「依模型特性自動改寫提示詞」的單一真實來源。
 *
 * 為什麼需要：
 *   每家圖/影/音/聲模型對提示詞的偏好差異很大：
 *     - FLUX 系列：自然語句、描述式
 *     - SD 3.5 / SDXL：tag-based + 強烈仰賴 negative_prompt
 *     - SeeDream：中文與東方審美 keyword 命中率高
 *     - Imagen 4：偏好 clean studio lighting / editorial 詞
 *     - Kling 影片：cinematic / camera move 描述
 *     - Suno 音樂：tags 列表 + 風格詞
 *     - ElevenLabs：穩定性 / clarity 參數
 *   過去執行器只把 user prompt 原樣丟下去，模型發揮不出特性，產出品質
 *   參差。本檔提供 `injectModelPrompt(rawPrompt, modelId)` 在 tool dispatch
 *   前統一改寫，讓「光球規劃 → 工具執行」這條路徑能自動套到對的提示風格。
 *
 * 設計原則：
 *   - 不改變 user 的核心意圖；只 prepend / append 模型偏好的引導詞。
 *   - 若 user 已自訂 `negativePrompt`，永遠不覆寫；只在 user 未提供時填入
 *     模型預設。
 *   - 沒有命中模板的模型：回原樣 prompt + null 負面提示，executor 維持
 *     原行為。
 *   - 支援的 modelId 比對是 prefix-aware（`fal-ai/flux/dev`、`fal-ai/flux/dev/image-to-image`、
 *     `fal-ai/flux-pro/v1.1` 都會命中同一條 flux 模板）。
 */

export type ModelPromptStyle =
  | "natural" // 自然語句（FLUX, Imagen, Veo）
  | "tags" // tag list（SD 1.5/3.5, SDXL）
  | "cinematic" // 影片 camera/lighting 詞
  | "music-tags" // Suno / ace-step / musicgen
  | "voice-style"; // ElevenLabs / Qwen TTS

export interface ModelPromptTemplate {
  /** modelId 比對前綴（startsWith）。空字串代表通用 fallback。 */
  modelIdPrefix: string;
  style: ModelPromptStyle;
  /** 模型偏好的引導前綴（例：「masterpiece, best quality」）。 */
  promptPrefix?: string;
  /** 引導後綴（例：「, cinematic lighting, 4k」）。 */
  promptSuffix?: string;
  /** 預設負面提示詞；只有 user 沒給 negativePrompt 時套用。 */
  defaultNegativePrompt?: string;
  /** 一句話簡介這個模板的用意。供 orb 顯示給使用者。 */
  rationale: string;
}

/**
 * 樣板表 — order 重要：愈具體的 prefix 放前面，避免 `fal-ai/flux-pro/v1.1`
 * 被通用 `fal-ai/flux` 攔截到錯的樣板。
 */
export const MODEL_PROMPT_TEMPLATES: readonly ModelPromptTemplate[] = [
  // ── 文字生圖 ──────────────────────────────────────────────────────────
  {
    modelIdPrefix: "fal-ai/flux-pro",
    style: "natural",
    promptSuffix: ", cinematic lighting, sharp focus, ultra-detailed",
    rationale: "FLUX Pro 偏好自然語句 + 攝影感詞彙，補上 cinematic / sharp focus 提升品質",
  },
  {
    modelIdPrefix: "fal-ai/flux/schnell",
    style: "natural",
    rationale: "FLUX Schnell 速度優先，避免過度修飾以維持低延遲",
  },
  {
    modelIdPrefix: "fal-ai/flux/dev",
    style: "natural",
    promptSuffix: ", high quality, detailed",
    rationale: "FLUX Dev 通用基礎，輕度補強描述",
  },
  {
    modelIdPrefix: "fal-ai/stable-diffusion-v35",
    style: "tags",
    promptPrefix: "masterpiece, best quality, ",
    defaultNegativePrompt:
      "lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, cropped, worst quality, low quality, jpeg artifacts, watermark, username, blurry",
    rationale: "SD 3.5 仰賴 quality tags + 強負面提示降低劣化",
  },
  {
    modelIdPrefix: "fal-ai/bytedance/seedream",
    style: "natural",
    promptSuffix: ", oriental aesthetic, elegant composition",
    rationale: "SeeDream 對東方審美與插畫詞敏感，強化海報/插畫導向",
  },
  {
    modelIdPrefix: "fal-ai/imagen4",
    style: "natural",
    promptSuffix: ", clean studio lighting, editorial photography",
    rationale: "Imagen 4 在乾淨打光與 editorial 詞表現最好",
  },
  {
    modelIdPrefix: "fal-ai/nano-banana",
    style: "natural",
    rationale: "Nano-banana 系列直接用使用者描述效果最好，不額外加詞",
  },
  // ── 影片生成 ───────────────────────────────────────────────────────────
  {
    modelIdPrefix: "fal-ai/kling-video",
    style: "cinematic",
    promptSuffix: ", smooth camera movement, cinematic shot",
    rationale: "Kling 對運鏡與 cinematic 描述敏感",
  },
  {
    modelIdPrefix: "fal-ai/wan-t2v",
    style: "cinematic",
    rationale: "WAN 通用 t2v，使用者原文已足夠",
  },
  {
    modelIdPrefix: "fal-ai/veo",
    style: "cinematic",
    promptSuffix: ", high-fidelity cinematic motion",
    rationale: "Veo 系列對 cinematic motion 描述加分",
  },
  // ── 音樂 / 音效 ────────────────────────────────────────────────────────
  {
    modelIdPrefix: "suno",
    style: "music-tags",
    rationale: "Suno 由 prompt + 風格 tags 組成，executor 額外維護 tags 欄位",
  },
  {
    modelIdPrefix: "fal-ai/ace-step",
    style: "music-tags",
    rationale: "AceStep 接受 tags + 描述",
  },
  {
    modelIdPrefix: "fal-ai/musicgen",
    style: "music-tags",
    rationale: "MusicGen 偏 tag list",
  },
  // ── 語音 TTS ───────────────────────────────────────────────────────────
  {
    modelIdPrefix: "fal-ai/elevenlabs/tts",
    style: "voice-style",
    rationale: "ElevenLabs TTS 直接讀文本，不需要改寫",
  },
  {
    modelIdPrefix: "fal-ai/qwen-3-tts",
    style: "voice-style",
    rationale: "Qwen TTS 同樣直接讀文本",
  },
];

export interface ModelPromptInjection {
  /** 改寫後的 prompt（若無命中樣板則與輸入相同）。 */
  prompt: string;
  /** 模型預設負面提示詞；若 user 已給就不會出現在這裡。 */
  defaultNegativePrompt?: string;
  /** 命中的模板（null 表示通用模型）。 */
  template: ModelPromptTemplate | null;
  /** 給 orb 對使用者解釋為何這樣改寫。 */
  rationale: string;
}

function findTemplate(modelId: string): ModelPromptTemplate | null {
  // longest prefix wins — sort by descending length once at module load
  for (const tpl of TEMPLATES_BY_LENGTH) {
    if (modelId.startsWith(tpl.modelIdPrefix)) return tpl;
  }
  return null;
}

const TEMPLATES_BY_LENGTH = [...MODEL_PROMPT_TEMPLATES].sort(
  (a, b) => b.modelIdPrefix.length - a.modelIdPrefix.length
);

/**
 * Inject the model-specific prompt template around the user's raw prompt.
 *
 * Returns an object whose `prompt` should be sent to the model, and
 * `defaultNegativePrompt` should populate the `negative_prompt` field iff
 * the user did NOT supply one of their own.
 */
export function injectModelPrompt(
  rawPrompt: string,
  modelId: string,
  options?: { userNegativePrompt?: string }
): ModelPromptInjection {
  const trimmed = (rawPrompt ?? "").trim();
  if (!trimmed) {
    return {
      prompt: rawPrompt,
      template: null,
      rationale: "Empty prompt; nothing to inject.",
    };
  }
  const tpl = findTemplate(modelId);
  if (!tpl) {
    return {
      prompt: rawPrompt,
      template: null,
      rationale: `No template registered for ${modelId}; passing prompt through unchanged.`,
    };
  }
  const prefix = tpl.promptPrefix ?? "";
  const suffix = tpl.promptSuffix ?? "";
  const next = `${prefix}${trimmed}${suffix}`;
  const userNeg = (options?.userNegativePrompt ?? "").trim();
  return {
    prompt: next,
    defaultNegativePrompt: userNeg ? undefined : tpl.defaultNegativePrompt,
    template: tpl,
    rationale: tpl.rationale,
  };
}

/**
 * Lightweight summary of all templates — for the agent planner system
 * prompt so the LLM knows roughly what each modelId expects upstream.
 */
export function summarizeModelPromptTemplates(): string {
  return JSON.stringify({
    note: "模型提示詞風格表（agentToolExecutor 在 dispatch 前自動套用）",
    items: MODEL_PROMPT_TEMPLATES.map(tpl => ({
      modelIdPrefix: tpl.modelIdPrefix,
      style: tpl.style,
      hint: tpl.rationale,
      hasNegativeDefault: Boolean(tpl.defaultNegativePrompt),
    })),
  });
}
