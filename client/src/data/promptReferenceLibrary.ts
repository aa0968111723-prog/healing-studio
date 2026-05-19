/**
 * promptReferenceLibrary.ts — 學習中心提示詞參考庫
 *
 * 多模態、代理人呼叫、系統提示詞的深度收錄，提供使用者學習與一鍵複製。
 * 與 promptLibrary（個人提示詞庫，可儲存／編輯）不同，本庫為靜態參考資料。
 */

export type PromptModality =
  | "image"
  | "image-edit"
  | "video"
  | "audio"
  | "voice"
  | "3d"
  | "agent"
  | "system"
  | "workflow"
  | "multimodal";

export type PromptDifficulty = "beginner" | "intermediate" | "advanced";

export interface PromptReference {
  id: string;
  modality: PromptModality;
  title: string;
  summary: string;
  prompt: string;
  negativePrompt?: string;
  modelHint?: string;
  difficulty: PromptDifficulty;
  tags: string[];
  language: "zh" | "en" | "mixed";
  example?: {
    inputs?: Record<string, string>;
    expectedOutput?: string;
  };
  references?: Array<{ label: string; href: string }>;
}

export const PROMPT_MODALITY_META: Record<
  PromptModality,
  { label: string; emoji: string; color: string; bg: string; border: string }
> = {
  image: {
    label: "文字生圖",
    emoji: "🖼️",
    color: "text-rose-700 dark:text-rose-300",
    bg: "bg-rose-50 dark:bg-rose-950/40",
    border: "border-rose-200 dark:border-rose-900/60",
  },
  "image-edit": {
    label: "圖片編輯",
    emoji: "🎨",
    color: "text-amber-700 dark:text-amber-300",
    bg: "bg-amber-50 dark:bg-amber-950/40",
    border: "border-amber-200 dark:border-amber-900/60",
  },
  video: {
    label: "影片生成",
    emoji: "🎬",
    color: "text-indigo-700 dark:text-indigo-300",
    bg: "bg-indigo-50 dark:bg-indigo-950/40",
    border: "border-indigo-200 dark:border-indigo-900/60",
  },
  audio: {
    label: "音樂音效",
    emoji: "🎵",
    color: "text-emerald-700 dark:text-emerald-300",
    bg: "bg-emerald-50 dark:bg-emerald-950/40",
    border: "border-emerald-200 dark:border-emerald-900/60",
  },
  voice: {
    label: "語音合成",
    emoji: "🗣️",
    color: "text-cyan-700 dark:text-cyan-300",
    bg: "bg-cyan-50 dark:bg-cyan-950/40",
    border: "border-cyan-200 dark:border-cyan-900/60",
  },
  "3d": {
    label: "3D 建模",
    emoji: "📦",
    color: "text-violet-700 dark:text-violet-300",
    bg: "bg-violet-50 dark:bg-violet-950/40",
    border: "border-violet-200 dark:border-violet-900/60",
  },
  agent: {
    label: "代理人呼叫",
    emoji: "🤖",
    color: "text-blue-700 dark:text-blue-300",
    bg: "bg-blue-50 dark:bg-blue-950/40",
    border: "border-blue-200 dark:border-blue-900/60",
  },
  system: {
    label: "系統提示詞",
    emoji: "⚙️",
    color: "text-slate-700 dark:text-slate-300",
    bg: "bg-slate-100 dark:bg-slate-900/60",
    border: "border-slate-300 dark:border-slate-800",
  },
  workflow: {
    label: "工作流程",
    emoji: "🔁",
    color: "text-orange-700 dark:text-orange-300",
    bg: "bg-orange-50 dark:bg-orange-950/40",
    border: "border-orange-200 dark:border-orange-900/60",
  },
  multimodal: {
    label: "跨模態組合",
    emoji: "🌐",
    color: "text-fuchsia-700 dark:text-fuchsia-300",
    bg: "bg-fuchsia-50 dark:bg-fuchsia-950/40",
    border: "border-fuchsia-200 dark:border-fuchsia-900/60",
  },
};

export const PROMPT_REFERENCE_LIBRARY: PromptReference[] = [
  // ═══════════════════════════════════════════════════════════════
  // 🖼️ 文字生圖（Text-to-Image）
  // ═══════════════════════════════════════════════════════════════
  {
    id: "img-cinematic-portrait",
    modality: "image",
    title: "電影感人像（黃金時刻）",
    summary: "好萊塢級電影感人像，搭配淺景深與黃金時刻光線。",
    prompt:
      "cinematic portrait of a young woman, golden hour backlight, shallow depth of field f/1.4, 85mm prime lens, soft rim light, film grain, Kodak Portra 400 color palette, intricate skin detail, atmospheric haze, looking slightly off camera, 8K detail, professional fashion editorial",
    negativePrompt:
      "blurry, low quality, plastic skin, oversaturated, deformed hands, extra fingers, watermark, text",
    modelHint: "fal-ai/flux-pro / fal-ai/imagen4 / fal-ai/nano-banana",
    difficulty: "beginner",
    tags: ["人像", "電影感", "黃金時刻", "淺景深"],
    language: "en",
  },
  {
    id: "img-cyberpunk-cityscape",
    modality: "image",
    title: "賽博龐克城市夜景",
    summary: "霓虹密布、煙雨綿綿的東京式賽博龐克城市鳥瞰。",
    prompt:
      "ultra-detailed cyberpunk Tokyo cityscape at midnight rain, dense neon signage in Japanese kanji, wet asphalt reflections, holographic billboards, layered skyway traffic, volumetric fog, cinematic anamorphic lens flare, color graded teal & magenta, octane render quality, 8K",
    negativePrompt: "daylight, low detail, blurry, washed out, watermark",
    modelHint: "fal-ai/flux-pro / fal-ai/seedream-v4",
    difficulty: "intermediate",
    tags: ["賽博龐克", "城市", "霓虹", "夜景"],
    language: "en",
  },
  {
    id: "img-watercolor-illustration",
    modality: "image",
    title: "水彩童話插畫",
    summary: "柔和水彩童書風格，適合繪本與兒童內容。",
    prompt:
      "soft watercolor children's book illustration, a fox and a rabbit sharing tea in a forest clearing, pastel palette, loose ink outlines, paper texture visible, whimsical storybook composition, by Beatrix Potter and Quentin Blake style",
    modelHint: "fal-ai/flux-pro / fal-ai/imagen4",
    difficulty: "beginner",
    tags: ["水彩", "插畫", "童話", "繪本"],
    language: "en",
  },
  {
    id: "img-ukiyo-e-modern",
    modality: "image",
    title: "現代浮世繪",
    summary: "古典浮世繪線條融合現代主題（如咖啡店、滑板）。",
    prompt:
      "modern ukiyo-e woodblock print, a young skater grinding a rail in front of a Tokyo cafe, flat color planes, bold black outlines, hand-pressed paper texture, signed with red seal, by Hokusai meets Yoji Shinkawa",
    modelHint: "fal-ai/flux-pro",
    difficulty: "intermediate",
    tags: ["浮世繪", "日式", "插畫", "風格混搭"],
    language: "en",
  },
  {
    id: "img-product-shot",
    modality: "image",
    title: "電商商品白底圖",
    summary: "標準電商上架的乾淨白底商品攝影。",
    prompt:
      "professional product photography of a matte black ceramic coffee mug, pure white seamless background, soft top diffused light with one subtle side fill, gentle drop shadow beneath, centered composition, ultra-sharp focus, 8K commercial catalog quality",
    negativePrompt: "harsh shadow, gradient background, props, hands, busy scene",
    modelHint: "fal-ai/flux-pro",
    difficulty: "beginner",
    tags: ["電商", "商品", "白底", "攝影"],
    language: "en",
  },
  {
    id: "img-architectural-render",
    modality: "image",
    title: "建築外觀渲染",
    summary: "極簡風建築外觀，黃昏自然光，適合提案配圖。",
    prompt:
      "minimalist concrete and timber residential house exterior, large floor-to-ceiling glass, twilight blue hour lighting, warm interior lights spilling out, surrounded by pine forest, photo-real architectural render, Unreal Engine 5 lumen, 8K",
    modelHint: "fal-ai/flux-pro / fal-ai/imagen4",
    difficulty: "intermediate",
    tags: ["建築", "外觀", "渲染", "簡約"],
    language: "en",
  },
  {
    id: "img-character-sheet-zh",
    modality: "image",
    title: "角色設定三視圖（中文）",
    summary: "正面 / 側面 / 背面三視圖，用於 LoRA 訓練前的設計稿。",
    prompt:
      "角色設定三視圖，同一名穿著深藍色連帽外套的少女，正面、側面、背面並排，純白背景，無陰影，等比例全身入鏡，動畫風格，線稿乾淨，色塊填色，可作為 LoRA 訓練參考圖。",
    negativePrompt: "多角色, 多背景, 模糊, 表情誇張, 浮水印",
    modelHint: "fal-ai/flux-pro / fal-ai/nano-banana",
    difficulty: "intermediate",
    tags: ["角色設定", "三視圖", "LoRA", "設計稿"],
    language: "zh",
    references: [
      { label: "LoRA 訓練教學", href: "/learn?docId=deep-lora-trainer" },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // 🎨 圖片編輯（Image Editing）
  // ═══════════════════════════════════════════════════════════════
  {
    id: "edit-bg-replace",
    modality: "image-edit",
    title: "背景替換（保留主體）",
    summary: "保留人物完整不動，僅替換背景為指定場景。",
    prompt:
      "Keep the subject (person) completely unchanged. Replace the background only with a sunset beach scene, warm orange and pink sky, soft sea waves, distant silhouette of palm trees. Match lighting on subject to the new background's warm tones.",
    modelHint: "fal-ai/flux-kontext / fal-ai/gpt-image-1.5",
    difficulty: "beginner",
    tags: ["背景替換", "保留主體", "編輯"],
    language: "en",
  },
  {
    id: "edit-style-transfer",
    modality: "image-edit",
    title: "風格轉換（保留構圖）",
    summary: "保留原構圖，將寫實照片轉為動畫風格。",
    prompt:
      "Convert this realistic photo into a Studio Ghibli anime style illustration. Keep composition, character pose, and scene layout identical. Translate textures into hand-painted watercolor strokes, soft pastel palette, characteristic large eyes and gentle highlights.",
    modelHint: "fal-ai/flux-kontext / fal-ai/seedream-v5-edit",
    difficulty: "intermediate",
    tags: ["風格轉換", "動畫", "吉卜力"],
    language: "en",
  },
  {
    id: "edit-add-element",
    modality: "image-edit",
    title: "新增畫面元素",
    summary: "在指定位置加入新元素，匹配光線與透視。",
    prompt:
      "Add a small calico cat sitting on the windowsill on the right side of the image. The cat should match the warm afternoon lighting of the scene, cast a soft shadow consistent with the existing light direction, and feel naturally part of the original composition.",
    modelHint: "fal-ai/flux-kontext / fal-ai/grok-edit",
    difficulty: "beginner",
    tags: ["新增元素", "光線匹配", "編輯"],
    language: "en",
  },
  {
    id: "edit-remove-object",
    modality: "image-edit",
    title: "移除雜物（背景重建）",
    summary: "乾淨移除指定物件並補回合理背景。",
    prompt:
      "Remove the parked car in the foreground completely. Reconstruct the underlying pavement, road markings, and any building edges that should appear behind it. Result should look as if the car was never there.",
    modelHint: "fal-ai/flux-kontext",
    difficulty: "beginner",
    tags: ["移除物件", "修補", "Inpaint"],
    language: "en",
  },
  {
    id: "edit-upscale-prompt",
    modality: "image-edit",
    title: "畫質提升 4× 提示",
    summary: "搭配 SeedVR / Topaz 的提示，強調細節保留。",
    prompt:
      "Upscale this image to 4× resolution. Preserve every facial detail, hair strand, and fabric texture. Avoid over-sharpening or creating hallucinated features. Maintain original color palette and film grain character.",
    modelHint: "fal-ai/seedvr-upscale",
    difficulty: "intermediate",
    tags: ["超解析", "Upscale", "畫質"],
    language: "en",
  },

  // ═══════════════════════════════════════════════════════════════
  // 🎬 影片生成（Text/Image-to-Video）
  // ═══════════════════════════════════════════════════════════════
  {
    id: "vid-cinematic-establish",
    modality: "video",
    title: "電影開場鏡頭（建立鏡頭）",
    summary: "穩定推軌的城市開場鏡頭，搭配黃昏光。",
    prompt:
      "Slow cinematic dolly-in over a quiet European cobblestone street at sunset, warm golden hour rim light, soft volumetric haze, anamorphic lens flares, gentle camera shake, color graded teal & orange, 24fps film look, 5 seconds, no text overlays.",
    modelHint: "fal-ai/kling-2.1 / fal-ai/veo-3 / fal-ai/wan-2.1-720p",
    difficulty: "intermediate",
    tags: ["建立鏡頭", "電影感", "推軌"],
    language: "en",
  },
  {
    id: "vid-i2v-character-walk",
    modality: "video",
    title: "圖生影：人物自然行走",
    summary: "從靜態人物角色圖延伸出自然行走動態，保持身份一致。",
    prompt:
      "The character walks forward at a steady natural pace, slight head turn looking around, hair and coat move with realistic physics, camera follows in a smooth tracking shot from slightly low angle, depth of field maintained, 24fps, 4 seconds.",
    modelHint: "fal-ai/kling-2.1-i2v / fal-ai/wan-2.1-i2v / fal-ai/runway-gen4",
    difficulty: "intermediate",
    tags: ["圖生影", "I2V", "角色動畫"],
    language: "en",
  },
  {
    id: "vid-product-360",
    modality: "video",
    title: "商品 360° 環繞展示",
    summary: "電商商品的環繞展示，純白背景。",
    prompt:
      "Smooth 360 degree orbit around the product, fixed eye-level camera height, pure white seamless background, soft top key light with subtle shadow, no zoom, slow constant rotation, 24fps, 6 seconds.",
    modelHint: "fal-ai/kling-2.1 / fal-ai/pixverse-4.5",
    difficulty: "beginner",
    tags: ["商品", "360", "電商"],
    language: "en",
  },
  {
    id: "vid-camera-control",
    modality: "video",
    title: "CamMaster 鏡頭運動控制",
    summary: "明確指定鏡頭運動類型（推、拉、搖、移、升降）。",
    prompt:
      "Start static, then push-in (dolly-in) toward the subject for 2 seconds, hold for 1 second, then pull-back (dolly-out) to reveal the full environment for 2 seconds. Maintain horizon level. 24fps cinematic.",
    modelHint: "fal-ai/cammaster / fal-ai/kling-2.1",
    difficulty: "advanced",
    tags: ["鏡頭運動", "CamMaster", "電影語言"],
    language: "en",
  },
  {
    id: "vid-anime-loop-zh",
    modality: "video",
    title: "動畫風無縫循環",
    summary: "可循環播放的動畫場景，適合直播 / 背景動畫。",
    prompt:
      "動畫風格，貓咪在窗邊打呼嚕，胸口隨呼吸輕微起伏，窗外櫻花飄落形成自然循環，溫暖午後陽光，柔和色調，3 秒可無縫循環，24fps。",
    modelHint: "fal-ai/wan-2.1 / fal-ai/kling-2.1",
    difficulty: "intermediate",
    tags: ["動畫", "循環", "Loop"],
    language: "zh",
  },

  // ═══════════════════════════════════════════════════════════════
  // 🎵 音樂 / 音效
  // ═══════════════════════════════════════════════════════════════
  {
    id: "audio-lofi-beats",
    modality: "audio",
    title: "Lo-fi 讀書背景音樂",
    summary: "適合專注、讀書、寫作背景的 Lo-fi 節奏。",
    prompt:
      "lo-fi hip hop instrumental, mellow jazz piano chords, soft vinyl crackle, slow boom bap drums at 72 BPM, warm analog tape saturation, melancholic but cozy mood, 60 seconds loop friendly",
    modelHint: "fal-ai/sonauto / suno",
    difficulty: "beginner",
    tags: ["Lo-fi", "讀書", "背景", "BGM"],
    language: "en",
  },
  {
    id: "audio-cinematic-trailer",
    modality: "audio",
    title: "電影預告音樂",
    summary: "三段式建構的電影預告張力音樂。",
    prompt:
      "epic cinematic trailer music, 3-act build: 1) quiet piano motif 0-15s, 2) tense string ostinato + drum rolls 15-45s, 3) full orchestra hit + braams climax 45-60s, 60 seconds total, in C minor, 90 BPM, Hans Zimmer style",
    modelHint: "fal-ai/sonauto / suno",
    difficulty: "advanced",
    tags: ["電影", "預告", "交響", "張力"],
    language: "en",
  },
  {
    id: "audio-sfx-rain",
    modality: "audio",
    title: "雨聲音效（精確時長）",
    summary: "12 秒雨打窗戶音效，可循環。",
    prompt:
      "Realistic gentle rain hitting a glass window, soft and continuous, no thunder, indoor perspective, loopable, 12 seconds",
    modelHint: "fal-ai/elevenlabs-sfx",
    difficulty: "beginner",
    tags: ["音效", "雨聲", "ASMR"],
    language: "en",
  },
  {
    id: "audio-podcast-intro",
    modality: "audio",
    title: "Podcast 開場音樂",
    summary: "15 秒開場片頭，溫暖友善。",
    prompt:
      "Friendly podcast intro music, warm acoustic guitar fingerpicking, soft glockenspiel sparkles, light shaker percussion, 90 BPM, key of G major, builds slightly then resolves, 15 seconds, broadcast-ready mix",
    modelHint: "fal-ai/sonauto / suno",
    difficulty: "beginner",
    tags: ["Podcast", "片頭", "開場"],
    language: "en",
  },

  // ═══════════════════════════════════════════════════════════════
  // 🗣️ 語音合成（TTS）
  // ═══════════════════════════════════════════════════════════════
  {
    id: "voice-narrator-zh",
    modality: "voice",
    title: "中文紀錄片旁白",
    summary: "沉穩有磁性的紀錄片旁白語氣。",
    prompt:
      "深夜的城市，霓虹燈在雨幕中閃爍，這裡是無數故事開始的地方。我們將跟隨一位平凡的計程車司機，看見這座城市的另一面。",
    modelHint: "elevenlabs / fal-ai/qwen-tts",
    difficulty: "beginner",
    tags: ["旁白", "中文", "紀錄片"],
    language: "zh",
    example: {
      inputs: {
        voice: "Adam (Deep Male) / Bella (Warm Female)",
        stability: "0.65",
        similarity_boost: "0.75",
        style: "0.35",
      },
    },
  },
  {
    id: "voice-character-emotion",
    modality: "voice",
    title: "角色情緒對白（含 SSML 暫停）",
    summary: "帶情緒標記的對白，使用 break 控制節奏。",
    prompt:
      "<speak>你...你怎麼會在這裡？<break time=\"0.6s\"/> 我以為...你已經走了。<break time=\"0.4s\"/> 為什麼回來？</speak>",
    modelHint: "elevenlabs (SSML support)",
    difficulty: "intermediate",
    tags: ["SSML", "情緒", "對白"],
    language: "zh",
  },
  {
    id: "voice-clone-script",
    modality: "voice",
    title: "聲音克隆訓練稿",
    summary: "用於 Qwen Clone / Dia TTS 的標準訓練稿（涵蓋音素）。",
    prompt:
      "今天天氣真好，適合到公園散步。我喜歡聽鳥兒的歌聲，看著松鼠在樹枝間跳躍。生活的美好，往往就藏在這些平凡的片刻裡。如果你也想感受這份寧靜，不妨放下手機，走出戶外。",
    modelHint: "fal-ai/qwen-clone / fal-ai/dia-tts",
    difficulty: "intermediate",
    tags: ["聲音克隆", "訓練稿", "Voice Clone"],
    language: "zh",
  },
  {
    id: "voice-talking-avatar",
    modality: "voice",
    title: "說話頭像對白",
    summary: "EchoMimic / Stable Avatar 用的清楚朗讀稿。",
    prompt:
      "嗨大家好，歡迎來到我的頻道。今天要跟大家分享一個有趣的 AI 工具，它能幫你在三分鐘內把想法變成完整的影片。讓我們一起來看看怎麼用吧。",
    modelHint: "fal-ai/echomimic / fal-ai/stable-avatar",
    difficulty: "beginner",
    tags: ["頭像", "Avatar", "口型"],
    language: "zh",
  },

  // ═══════════════════════════════════════════════════════════════
  // 📦 3D 建模
  // ═══════════════════════════════════════════════════════════════
  {
    id: "3d-character-base",
    modality: "3d",
    title: "Trellis 2 角色 Base 模型",
    summary: "用於 3D 角色建模的單張參考圖描述。",
    prompt:
      "A-pose full-body character reference for 3D modeling, neutral pose with arms slightly out, clean light grey background, even diffuse lighting, no harsh shadows, anime stylized proportions, single character centered, no props.",
    modelHint: "fal-ai/trellis-2 / fal-ai/sam-3d / fal-ai/hunyuan3d-v3",
    difficulty: "intermediate",
    tags: ["3D", "Trellis", "角色", "A-pose"],
    language: "en",
  },
  {
    id: "3d-prop-clean",
    modality: "3d",
    title: "3D 道具乾淨參考圖",
    summary: "適合 Trellis / SAM 3D 的單一道具參考圖。",
    prompt:
      "Single isolated object photo of a vintage leather camera bag, 3/4 perspective view, soft uniform studio lighting, pure neutral grey background, no people, no other props, sharp focus, suitable for 3D mesh generation.",
    modelHint: "fal-ai/trellis-2 / fal-ai/sam-3d",
    difficulty: "beginner",
    tags: ["3D", "道具", "建模"],
    language: "en",
  },

  // ═══════════════════════════════════════════════════════════════
  // 🤖 代理人呼叫（Agent / 光球）
  // ═══════════════════════════════════════════════════════════════
  {
    id: "agent-orb-help-zh",
    modality: "agent",
    title: "向光球詢問當前頁面功能",
    summary: "在任何頁面對光球說，會自動帶入 pageContext。",
    prompt: "光球，這個頁面有哪些功能？該怎麼開始用？請給我三個具體步驟。",
    difficulty: "beginner",
    tags: ["光球", "Orb", "新手"],
    language: "zh",
    references: [
      { label: "光球完整使用指南", href: "/learn?docId=deep-cross-modal" },
    ],
  },
  {
    id: "agent-navigate-action",
    modality: "agent",
    title: "讓光球跳轉頁面（ACTION）",
    summary: "光球可發出 [ACTION:navigate:...] 指令直接導航。",
    prompt:
      "請帶我到影片工作室，並把模型設成 Kling 2.1，預設長度 5 秒。",
    difficulty: "intermediate",
    tags: ["光球", "ACTION", "navigate"],
    language: "zh",
    example: {
      expectedOutput:
        "[ACTION:navigate:/video-studio?model=fal-ai/kling-2.1&duration=5]",
    },
  },
  {
    id: "agent-set-param",
    modality: "agent",
    title: "光球設定參數（setParam）",
    summary: "讓光球在當前頁面切換分類 / 難度 / 模型。",
    prompt: "把學習中心的分類切到「生成技術」，難度切到「進階」。",
    difficulty: "intermediate",
    tags: ["光球", "setParam", "頁面控制"],
    language: "zh",
    example: {
      expectedOutput:
        "setParam key='category' value='technique'\nsetParam key='difficulty' value='intermediate'",
    },
  },
  {
    id: "agent-director-plan",
    modality: "agent",
    title: "請導演 AI 規劃完整創作",
    summary: "對導演 AI（/director）說明主題，得到分鏡腳本。",
    prompt:
      "我想做一支 30 秒的咖啡品牌短片，調性溫暖、城市晨光、文青客群。請幫我規劃 6 個分鏡：每鏡寫出視覺提示詞、語音腳本、建議模型、預估時長與預估成本。",
    difficulty: "intermediate",
    tags: ["導演 AI", "Director", "分鏡", "規劃"],
    language: "zh",
    references: [
      { label: "導演 AI 完整指南", href: "/learn?docId=deep-director" },
    ],
  },
  {
    id: "agent-rag-recall",
    modality: "agent",
    title: "讓 AI 回想我的偏好（RAG）",
    summary: "觸發 Pinecone RAG 檢索歷史創作偏好。",
    prompt:
      "根據我過去的生成偏好，幫我寫一個新的人像提示詞，要繼承我常用的色調和構圖風格。",
    difficulty: "advanced",
    tags: ["RAG", "Pinecone", "記憶"],
    language: "zh",
    references: [
      { label: "Pinecone RAG 系統", href: "/learn?docId=api-pinecone-rag" },
    ],
  },
  {
    id: "agent-cross-modal-handoff",
    modality: "agent",
    title: "跨工作室交接（Composer Handoff）",
    summary: "讓光球把當前圖片送到影片工作室生成 I2V。",
    prompt:
      "把我剛剛在圖片創作室生成的最後一張圖，送到影片工作室，用 Kling 2.1 I2V，4 秒，鏡頭緩緩推近。",
    difficulty: "advanced",
    tags: ["跨工作室", "Handoff", "I2V"],
    language: "zh",
  },

  // ═══════════════════════════════════════════════════════════════
  // ⚙️ 系統提示詞（System Prompts）
  // ═══════════════════════════════════════════════════════════════
  {
    id: "system-prompt-compiler",
    modality: "system",
    title: "Elite Prompt Compiler（提詞編譯器）",
    summary: "把中文意圖 + 積木組合，翻譯成高品質英文 SDXL 提示詞。",
    prompt: `You are Elite Prompt Compiler, a senior creative director that converts Chinese intent + selected building blocks into one high-quality English image/video prompt.

Rules:
1. Always output ONE single line of comma-separated tokens in English.
2. Order: subject → style → lighting → color → composition → lens → quality.
3. Preserve all user-specified building blocks verbatim where applicable.
4. Avoid empty filler words (e.g., "very", "beautiful").
5. If user intent is ambiguous, default to cinematic photoreal.
6. Output ONLY the prompt — no explanations, no quotes, no markdown.`,
    modelHint: "Gemini 2.5 Pro / Flash",
    difficulty: "advanced",
    tags: ["System Prompt", "編譯器", "Compiler"],
    language: "en",
  },
  {
    id: "system-news-filter",
    modality: "system",
    title: "AI 新聞過濾官",
    summary: "從 RSS 抓回的新聞中挑選與本平台高度相關的條目。",
    prompt: `You are the AI News Filter for a multimodal creative platform (fal.ai + Gemini stack).

Task: Given a list of news headlines, return JSON array of items relevant to:
- image / video / audio / voice generative models
- new fal.ai endpoints
- Anthropic / Google / OpenAI model releases
- prompt engineering techniques

For each kept item, output:
{ "title": string, "relevance": 0-1, "tag": "model|technique|news|tool", "why": "<one-line reason>" }

Discard celebrity gossip, finance, politics, generic tech that doesn't relate to creative AI.
Output ONLY valid JSON array.`,
    modelHint: "Gemini 2.5 Flash",
    difficulty: "advanced",
    tags: ["System Prompt", "新聞", "過濾"],
    language: "en",
  },
  {
    id: "system-zen-copilot",
    modality: "system",
    title: "ZenCoPilot（提詞建議官）",
    summary: "為使用者當前的提詞提供 3 個改進建議。",
    prompt: `You are ZenCoPilot, a kind and concise prompt-engineering coach.

Given the user's current draft prompt and chosen modality, output exactly 3 actionable improvement suggestions in Traditional Chinese, each ≤ 30 characters, focused on:
1. Missing visual / structural detail
2. Lighting / color / mood specificity
3. Quality / camera / lens technical descriptors

Format:
1. <suggestion>
2. <suggestion>
3. <suggestion>

No preface, no closing remarks.`,
    modelHint: "Gemini 2.5 Flash",
    difficulty: "intermediate",
    tags: ["ZenCoPilot", "提詞輔導", "建議"],
    language: "mixed",
  },
  {
    id: "system-orb-personality",
    modality: "system",
    title: "光球人格（友善導覽員）",
    summary: "光球在全站作為導覽員的基本人格。",
    prompt: `你是 Healing Studio 的光球夥伴，平台的友善導覽員與創作搭檔。

人格設定：
- 語氣：溫暖、簡潔、實用，繁體中文
- 篇幅：預設 1–3 句話，使用者要求才展開
- 行動：能直接呼叫頁面 ACTION（navigate / setParam / setTab / search）
- 邊界：不討論帳號計費以外的金錢、不假裝是真人

回覆原則：
1. 先回答問題重點，再給一個下一步建議
2. 如能直接用 ACTION 達成，就附上 [ACTION:...] 標籤
3. 若需要使用者選擇，最多列 3 個選項
4. 不確定時直接說「我不確定」而非編造`,
    modelHint: "Gemini 2.5 Flash",
    difficulty: "intermediate",
    tags: ["光球", "人格", "Persona"],
    language: "zh",
  },

  // ═══════════════════════════════════════════════════════════════
  // 🔁 工作流程提示詞
  // ═══════════════════════════════════════════════════════════════
  {
    id: "workflow-character-consistency",
    modality: "workflow",
    title: "角色一致性工作流",
    summary: "LoRA + 一致性保險庫 + I2V 的完整流程提示詞。",
    prompt: `角色一致性工作流（4 步驟）：

1️⃣ 在角色鍛造所訓練 LoRA：上傳 8–15 張角色圖（含正面、側面、不同表情），等訓練完成。
2️⃣ 用 LoRA 生成定裝照：在創作工作室提詞中加入觸發詞，生成 3–5 張角色定裝。
3️⃣ 加入一致性保險庫：把最滿意的角色圖存入 /vault（type=character），加上標籤。
4️⃣ 影片工作室引用：用 I2V（Kling 2.1 I2V）讓角色動起來，鏡頭運動由 CamMaster 控。

提示詞範例（步驟 2）：
"<trigger_token>, full-body portrait, neutral A-pose, plain white background, anime style, soft studio lighting, character sheet reference"`,
    difficulty: "advanced",
    tags: ["工作流", "LoRA", "一致性", "保險庫"],
    language: "mixed",
    references: [
      { label: "LoRA 訓練", href: "/learn?docId=deep-lora-trainer" },
      { label: "一致性保險庫", href: "/vault" },
    ],
  },
  {
    id: "workflow-script-to-video",
    modality: "workflow",
    title: "腳本 → 影片完整流程",
    summary: "從導演 AI 規劃到最終合成的端到端流程。",
    prompt: `腳本 → 影片完整流程（6 步驟）：

1️⃣ 導演 AI 規劃：去 /director 描述主題，產出 6–8 個分鏡。
2️⃣ 視覺提示詞優化：把每個 visualPrompt 用 ZenCoPilot 優化。
3️⃣ 圖片創作室定鏡：每個分鏡先生圖確認構圖。
4️⃣ 圖生影：每張定鏡圖送到影片工作室，用 Kling 2.1 I2V 生 4–6 秒片段。
5️⃣ 音樂 / 旁白：在 /pro-studio 生背景音樂（Sonauto）+ TTS 旁白（ElevenLabs）。
6️⃣ 後製合成：所有素材存到資產庫 /assets，可用外部剪輯軟體合成。`,
    difficulty: "advanced",
    tags: ["工作流", "影片", "端到端", "Pipeline"],
    language: "zh",
  },
  {
    id: "workflow-product-marketing",
    modality: "workflow",
    title: "電商商品行銷素材包",
    summary: "一次產生白底圖 + 情境圖 + 360 影片 + 廣告音樂。",
    prompt: `商品行銷素材包（4 件套）：

1. 白底商品圖（圖片創作室）：套用「電商商品白底圖」提示詞。
2. 情境圖（圖片創作室）：把商品放在使用情境，「商品 + 使用場景」融合提示詞。
3. 360° 環繞影片（影片工作室）：圖生影 + 「商品 360° 環繞展示」提示詞。
4. 15 秒廣告音樂（/pro-studio）：「Podcast 開場音樂」風格的歡快版本。

完成後一鍵存入 /assets 並標記 team_shared 讓行銷團隊取用。`,
    difficulty: "intermediate",
    tags: ["電商", "行銷", "素材包"],
    language: "zh",
  },

  // ═══════════════════════════════════════════════════════════════
  // 🌐 跨模態組合
  // ═══════════════════════════════════════════════════════════════
  {
    id: "multimodal-podcast-cover",
    modality: "multimodal",
    title: "Podcast 完整素材（圖 + 音 + 旁白）",
    summary: "一個主題同時產出封面、片頭音樂、開場旁白。",
    prompt: `主題：「深夜對話：關於失眠的療癒哲學」

A. 封面圖（圖片）：
"moody night cityscape from a bedroom window, single warm lamp glow, melancholic but cozy mood, soft film grain, podcast cover composition with empty top space for title text"

B. 片頭音樂（音訊）：
"slow ambient lo-fi with soft piano and vinyl crackle, melancholic but warm, 15 seconds intro, loopable, 65 BPM"

C. 開場旁白（語音）：
"歡迎收聽深夜對話。今晚，我們不急著入睡，先聊聊那些睡不著的夜晚，給了我們什麼。"`,
    difficulty: "intermediate",
    tags: ["跨模態", "Podcast", "整合"],
    language: "mixed",
  },
  {
    id: "multimodal-storybook",
    modality: "multimodal",
    title: "繪本（圖 + 旁白 + 背景音）",
    summary: "童書頁面的圖、旁白、背景音同步產生。",
    prompt: `繪本主題：「小狐狸的第一個雪天」

每頁三件套：
1. 插畫（圖片）：水彩童書風格，描述當下場景
2. 旁白（語音）：溫柔朗讀，速度放慢，給 4–8 歲聆聽
3. 背景音（音訊）：環境音 5 秒 loop（雪地腳步聲、火爐劈啪聲）

可用 /director 把 8 頁一次規劃完，再分送到 /image-studio、/pro-studio。`,
    difficulty: "advanced",
    tags: ["跨模態", "繪本", "兒童"],
    language: "zh",
  },
];

export const PROMPT_REFERENCE_MODALITIES: PromptModality[] = [
  "image",
  "image-edit",
  "video",
  "audio",
  "voice",
  "3d",
  "agent",
  "system",
  "workflow",
  "multimodal",
];

/** 依模態回傳預設可儲存到個人提示詞庫的 category。 */
export function promptCategoryForLibrary(
  modality: PromptModality
): "general" | "image" | "video" | "audio" | "voice" | "story" | "system" {
  switch (modality) {
    case "image":
    case "image-edit":
    case "3d":
      return "image";
    case "video":
      return "video";
    case "audio":
      return "audio";
    case "voice":
      return "voice";
    case "system":
    case "agent":
      return "system";
    case "workflow":
    case "multimodal":
      return "story";
    default:
      return "general";
  }
}
