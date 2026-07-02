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

  // ═══════════════════════════════════════════════════════════════
  // 🖼️ 文字生圖 — 進階風格擴充
  // ═══════════════════════════════════════════════════════════════
  {
    id: "img-anime-key-visual",
    modality: "image",
    title: "動畫 Key Visual 主視覺",
    summary: "可作為動畫海報、宣傳主視覺的高完成度插畫。",
    prompt:
      "anime key visual illustration, two main characters back-to-back in dramatic pose, dynamic wind blowing hair, soft cherry blossom petals falling, vivid sunset gradient sky, cinematic anamorphic framing, detailed line art, cel-shaded with subtle airbrushed gradients, by Makoto Shinkai meets Yoshitaka Amano, 8K poster quality",
    negativePrompt: "extra limbs, distorted hands, blurry, watermark, low detail",
    modelHint: "fal-ai/flux-pro / fal-ai/imagen4",
    difficulty: "intermediate",
    tags: ["動畫", "Key Visual", "海報", "插畫"],
    language: "en",
  },
  {
    id: "img-photorealistic-portrait",
    modality: "image",
    title: "極致寫實人像（皮膚紋理）",
    summary: "強調毛孔、絨毛、皮下層次的寫實人像。",
    prompt:
      "hyper-photorealistic close-up portrait, 50-year-old fisherman face, weathered skin with fine pores, individual eyelashes and stubble visible, catchlight in iris, natural overcast diffused light, shallow depth of field f/1.8 on 105mm macro lens, Phase One IQ4 sensor look, no retouching, documentary photography style",
    negativePrompt: "plastic skin, oversmooth, airbrush, makeup, perfect teeth, beauty filter",
    modelHint: "fal-ai/flux-pro / fal-ai/imagen4",
    difficulty: "advanced",
    tags: ["寫實", "人像", "紀實", "微距"],
    language: "en",
  },
  {
    id: "img-fantasy-landscape",
    modality: "image",
    title: "奇幻地景：浮空之島",
    summary: "Matte painting 級的奇幻浮空島嶼景觀。",
    prompt:
      "epic fantasy matte painting, multiple floating islands connected by ancient stone bridges, cascading waterfalls falling into mist, ruins of a forgotten civilization, distant dragon silhouette, golden volumetric god rays piercing storm clouds, painterly brushstrokes, by Greg Rutkowski and Andreas Rocha, ArtStation trending, 16:9 cinematic",
    negativePrompt: "photograph, modern buildings, signs, low resolution",
    modelHint: "fal-ai/flux-pro",
    difficulty: "advanced",
    tags: ["奇幻", "Matte Painting", "場景", "浮島"],
    language: "en",
  },
  {
    id: "img-scifi-spaceship",
    modality: "image",
    title: "科幻太空船內部",
    summary: "硬科幻太空船艦橋，含 HUD 與全息投影。",
    prompt:
      "hard sci-fi spaceship bridge interior, brushed titanium panels, holographic tactical display floating in mid-air, glowing cyan UI accents, captain seat front center, deep space visible through panoramic forward viewport, volumetric atmosphere, subsurface lighting, by Syd Mead aesthetic, octane render, 8K",
    negativePrompt: "fantasy, magic, cartoonish, low poly",
    modelHint: "fal-ai/flux-pro",
    difficulty: "intermediate",
    tags: ["科幻", "太空船", "HUD", "Syd Mead"],
    language: "en",
  },
  {
    id: "img-food-photography",
    modality: "image",
    title: "美食攝影：日式拉麵",
    summary: "可上 Instagram / 菜單的高質感美食攝影。",
    prompt:
      "overhead 90-degree food photography of authentic Japanese tonkotsu ramen, rich creamy broth with floating fat droplets, half soft-boiled ajitsuke tamago showing molten yolk, charred chashu pork, fresh green onion and bamboo shoots, steam rising naturally, wooden table, soft window light from left, 105mm macro, warm color grade, magazine quality",
    negativePrompt: "plastic food, fake steam, oversaturated, AI artifacts",
    modelHint: "fal-ai/flux-pro / fal-ai/imagen4",
    difficulty: "beginner",
    tags: ["美食", "拉麵", "俯拍", "餐飲"],
    language: "en",
  },
  {
    id: "img-fashion-editorial",
    modality: "image",
    title: "高級時尚編輯照",
    summary: "Vogue 風格的高級時尚編輯照。",
    prompt:
      "high fashion editorial photo, model in avant-garde architectural couture dress, stark concrete brutalist background, single hard sidelight casting dramatic shadow, model in confident statuesque pose, color graded teal and cream, shot on Hasselblad medium format, Vogue Italia aesthetic, 8K",
    negativePrompt: "casual clothing, smiling, soft lighting, mall background",
    modelHint: "fal-ai/flux-pro",
    difficulty: "intermediate",
    tags: ["時尚", "編輯", "Vogue", "Couture"],
    language: "en",
  },
  {
    id: "img-minimalist-abstract",
    modality: "image",
    title: "極簡抽象構圖",
    summary: "適合品牌視覺、印刷海報的極簡抽象。",
    prompt:
      "minimalist abstract composition, three overlapping organic shapes in muted dusty pink, sage green, and warm cream, soft paper texture background, no characters, no text, Bauhaus inspired, balanced negative space, suitable for premium brand poster, vector-clean edges",
    modelHint: "fal-ai/flux-pro",
    difficulty: "beginner",
    tags: ["極簡", "抽象", "品牌", "Bauhaus"],
    language: "en",
  },
  {
    id: "img-isometric-icon",
    modality: "image",
    title: "等距 3D 圖示",
    summary: "App 圖示、簡報用的等距 3D 風格小場景。",
    prompt:
      "clean isometric 3D illustration of a tiny cozy reading nook, miniature bookshelf, warm lamp glow, plant in pot, slippers on rug, soft pastel palette, rounded corners, baked global illumination, no text, transparent or solid pastel background, 1:1 square crop",
    modelHint: "fal-ai/flux-pro",
    difficulty: "beginner",
    tags: ["等距", "Isometric", "圖示", "簡報"],
    language: "en",
  },
  {
    id: "img-pixel-art-game",
    modality: "image",
    title: "像素藝術遊戲場景",
    summary: "16-bit 像素風格的橫向卷軸遊戲場景。",
    prompt:
      "16-bit pixel art side-scrolling platformer scene, enchanted mossy forest at dusk, glowing fireflies, parallax-layered background trees, crisp single-pixel outlines, limited 32-color palette, retro Super Nintendo aesthetic, no anti-aliasing, no characters in foreground",
    modelHint: "fal-ai/flux-pro",
    difficulty: "intermediate",
    tags: ["像素", "Pixel Art", "遊戲", "16-bit"],
    language: "en",
  },
  {
    id: "img-blueprint-technical",
    modality: "image",
    title: "技術藍圖風格",
    summary: "白線藍底的工程藍圖風格圖。",
    prompt:
      "technical blueprint illustration of a vintage motorcycle, white precise line drawings on dark blue paper background, dimension callouts, exploded view of engine block on the right side, drafting style with serif annotations, slight paper grain and ink bleed, 16:9 landscape",
    modelHint: "fal-ai/flux-pro",
    difficulty: "intermediate",
    tags: ["藍圖", "技術", "工程圖"],
    language: "en",
  },
  {
    id: "img-double-exposure",
    modality: "image",
    title: "雙重曝光攝影",
    summary: "人像與自然景觀融合的雙重曝光效果。",
    prompt:
      "artistic double exposure photography, silhouette of a woman's profile filled with a misty pine forest at dawn, cream paper background outside silhouette, soft graphic edges, monochrome muted earth tones, fine art print quality, suitable for album cover",
    modelHint: "fal-ai/flux-pro",
    difficulty: "intermediate",
    tags: ["雙重曝光", "藝術", "黑白"],
    language: "en",
  },
  {
    id: "img-low-poly-art",
    modality: "image",
    title: "低多邊形藝術",
    summary: "Low-poly 幾何拼接風格的動物 / 風景。",
    prompt:
      "low-poly geometric art, majestic stag standing on a hill at sunrise, faceted triangular surfaces, gradient warm orange to cool purple, flat shading, clean vector edges, no texture, minimalist composition, suitable for tech startup brand visual",
    modelHint: "fal-ai/flux-pro",
    difficulty: "beginner",
    tags: ["Low-poly", "幾何", "向量"],
    language: "en",
  },
  {
    id: "img-vintage-poster",
    modality: "image",
    title: "復古旅遊海報",
    summary: "1950 年代風格的復古旅遊宣傳海報。",
    prompt:
      "1950s vintage travel poster of Kyoto in autumn, stylized red maple trees and Kinkaku-ji temple silhouette, limited screen-printed color palette of crimson, mustard, teal, off-white, retro serif title space at top, slight paper aging texture, 2:3 portrait poster ratio",
    modelHint: "fal-ai/flux-pro",
    difficulty: "intermediate",
    tags: ["復古", "海報", "旅遊", "絹印"],
    language: "en",
  },
  {
    id: "img-claymation-style",
    modality: "image",
    title: "黏土動畫風格人物",
    summary: "Aardman 工作室風的黏土公仔角色。",
    prompt:
      "claymation character portrait, friendly chubby chef holding wooden spoon, visible fingerprint marks on clay surface, slightly asymmetric handmade quality, warm soft studio lighting, shallow depth of field, by Aardman Studios aesthetic (Wallace and Gromit), 4K stop-motion still",
    modelHint: "fal-ai/flux-pro",
    difficulty: "intermediate",
    tags: ["黏土", "Claymation", "Aardman", "角色"],
    language: "en",
  },
  {
    id: "img-watercolor-botanical",
    modality: "image",
    title: "植物學水彩圖鑑",
    summary: "古典植物圖鑑風格的水彩植物。",
    prompt:
      "classical botanical watercolor illustration of a single white camellia flower with leaves, soft graded wash on aged ivory paper, fine ink line work, scientific labeling style with serif latin name space, evenly diffused lighting, by Pierre-Joseph Redouté aesthetic",
    modelHint: "fal-ai/flux-pro",
    difficulty: "intermediate",
    tags: ["植物", "水彩", "圖鑑", "古典"],
    language: "en",
  },
  {
    id: "img-noir-detective",
    modality: "image",
    title: "黑色電影偵探",
    summary: "1940 年代 Film Noir 風格偵探場景。",
    prompt:
      "1940s film noir black and white photograph, hardboiled detective in fedora and trench coat, cigarette smoke curling, harsh venetian blind shadow striping his face, dim office at night, deep contrast, grainy film stock, dutch tilt camera angle, by Otto Preminger style",
    modelHint: "fal-ai/flux-pro",
    difficulty: "intermediate",
    tags: ["黑色電影", "Noir", "偵探", "黑白"],
    language: "en",
  },
  {
    id: "img-vaporwave-aesthetic",
    modality: "image",
    title: "蒸氣波美學",
    summary: "霓虹粉紫的 80 年代 Vaporwave 美學。",
    prompt:
      "vaporwave aesthetic composition, marble Greek bust statue, pink and cyan neon palm tree silhouettes, gridded laser horizon, retro 80s VHS scanlines overlay, glitch artifacts, dreamy sunset gradient sky, no text, 1:1 album cover format",
    modelHint: "fal-ai/flux-pro",
    difficulty: "beginner",
    tags: ["蒸氣波", "Vaporwave", "80s", "霓虹"],
    language: "en",
  },
  {
    id: "img-architectural-interior",
    modality: "image",
    title: "建築內景渲染",
    summary: "高端室內設計提案用的內景渲染。",
    prompt:
      "luxury residential living room interior, floor-to-ceiling windows overlooking misty mountains, warm white oak floors, low-profile boucle sofa in cream, statement marble fireplace, soft afternoon light, art books on coffee table, photoreal Unreal Engine 5 lumen render, 8K, by Norm Architects aesthetic",
    modelHint: "fal-ai/flux-pro / fal-ai/imagen4",
    difficulty: "intermediate",
    tags: ["建築", "室內", "渲染", "設計"],
    language: "en",
  },
  {
    id: "img-chinese-ink-zh",
    modality: "image",
    title: "水墨山水（中國風）",
    summary: "傳統水墨山水畫，留白與筆觸俱足。",
    prompt:
      "中國傳統水墨山水畫，遠山雲霧繚繞，近處有古松與小亭，扁舟漁翁，留白構圖，墨色濃淡分明，宣紙質感，題款空間於右上，無多餘色彩，宋代山水神韻。",
    modelHint: "fal-ai/flux-pro / fal-ai/seedream-v4",
    difficulty: "intermediate",
    tags: ["水墨", "山水", "中國風", "傳統"],
    language: "zh",
  },
  {
    id: "img-comic-book-style",
    modality: "image",
    title: "美式漫畫分鏡",
    summary: "Marvel 風格的美式漫畫單格。",
    prompt:
      "American comic book panel, dynamic action shot of superhero leaping toward camera, dramatic foreshortening, bold black ink outlines, halftone dot shading, vibrant primary palette of red and blue, motion lines, empty speech bubble space top-left, by Jim Lee style",
    modelHint: "fal-ai/flux-pro",
    difficulty: "intermediate",
    tags: ["漫畫", "美式", "Marvel", "分鏡"],
    language: "en",
  },
  {
    id: "img-tarot-card",
    modality: "image",
    title: "塔羅牌風格插畫",
    summary: "古典塔羅牌風格的單張卡牌設計。",
    prompt:
      "classical tarot card illustration in Rider-Waite-Smith style, allegorical figure holding a glowing lantern, ornate gold border frame, roman numeral 'IX' at top, hand-lettered card name space at bottom, muted aged-paper palette, symbolic background elements, 2:3 portrait card ratio",
    modelHint: "fal-ai/flux-pro",
    difficulty: "intermediate",
    tags: ["塔羅", "插畫", "古典", "象徵"],
    language: "en",
  },

  // ═══════════════════════════════════════════════════════════════
  // 🎨 圖片編輯 — 進階技法
  // ═══════════════════════════════════════════════════════════════
  {
    id: "edit-outpaint-expand",
    modality: "image-edit",
    title: "Outpaint 擴展畫面",
    summary: "向外延伸原圖，補出周圍環境。",
    prompt:
      "Extend this image outward in all directions by 50%. Continue the existing forest scene naturally — more trees of the same species, consistent lighting direction (warm afternoon from upper left), matching depth of field falloff. Do not introduce new subjects or change the existing composition.",
    modelHint: "fal-ai/flux-kontext / fal-ai/gpt-image-1.5",
    difficulty: "intermediate",
    tags: ["Outpaint", "擴展", "延伸"],
    language: "en",
  },
  {
    id: "edit-face-swap",
    modality: "image-edit",
    title: "換臉（保留表情）",
    summary: "把 A 圖人物換成 B 圖角色，保留姿勢與表情。",
    prompt:
      "Replace the person's face with the reference character provided in the second image. Preserve the original pose, body shape, clothing, lighting direction, expression intensity, and camera angle exactly. Only swap the facial identity while keeping skin tone naturally consistent with the body.",
    modelHint: "fal-ai/flux-kontext",
    difficulty: "advanced",
    tags: ["換臉", "Face Swap", "Reference"],
    language: "en",
  },
  {
    id: "edit-time-of-day",
    modality: "image-edit",
    title: "改變時段（晝變夜）",
    summary: "保留構圖與主體，改變光線時段。",
    prompt:
      "Convert this daytime scene into a moonlit night scene. Same composition and subjects. Cool blue moonlight from upper right, warm amber light from windows turned on, stars visible in sky, atmospheric haze, deep shadows. Realistic, not over-saturated.",
    modelHint: "fal-ai/flux-kontext / fal-ai/seedream-v5-edit",
    difficulty: "intermediate",
    tags: ["時段", "晝夜", "光線"],
    language: "en",
  },
  {
    id: "edit-season-change",
    modality: "image-edit",
    title: "季節轉換（夏轉秋）",
    summary: "保留構圖，把夏季綠葉換成秋季紅黃葉。",
    prompt:
      "Transform this summer scene into autumn. Replace green foliage with warm autumn colors — orange, red, deep gold. Add a few fallen leaves on the ground. Slightly warmer and softer afternoon light. Keep subject, composition, and structures unchanged.",
    modelHint: "fal-ai/flux-kontext",
    difficulty: "beginner",
    tags: ["季節", "秋天", "編輯"],
    language: "en",
  },
  {
    id: "edit-clothing-change-zh",
    modality: "image-edit",
    title: "替換服裝（保留身份）",
    summary: "保留臉與身材，替換衣著為指定服裝。",
    prompt:
      "保留人物臉部、體型、姿勢與背景，只把現有服裝替換為「奶油白色高領針織毛衣 + 駝色長大衣 + 米色羊毛圍巾」，光線方向與材質反射需與場景一致，皺褶與陰影自然。",
    modelHint: "fal-ai/flux-kontext / fal-ai/seedream-v5-edit",
    difficulty: "intermediate",
    tags: ["服裝", "Outfit", "替換"],
    language: "zh",
  },
  {
    id: "edit-color-grade",
    modality: "image-edit",
    title: "電影級調色",
    summary: "套用指定電影調色 LUT 風格。",
    prompt:
      "Apply a cinematic 'Blade Runner 2049' color grade — teal and orange split tone, lifted shadows toward cyan, warm highlights toward amber, slight haze and bloom on bright areas, film-emulation grain. Do not change composition or content. Preserve faces' natural skin tones.",
    modelHint: "fal-ai/flux-kontext",
    difficulty: "intermediate",
    tags: ["調色", "Color Grade", "LUT", "電影"],
    language: "en",
  },
  {
    id: "edit-restore-old-photo",
    modality: "image-edit",
    title: "老照片修復",
    summary: "修復老照片：去刮痕、補缺失、自然著色。",
    prompt:
      "Restore this damaged vintage photograph: remove scratches, dust, water stains, and creases; reconstruct missing areas based on context; sharpen faded details without over-sharpening; add natural, period-accurate color (if originally black-and-white); preserve original facial features and proportions exactly.",
    modelHint: "fal-ai/flux-kontext",
    difficulty: "intermediate",
    tags: ["修復", "老照片", "上色"],
    language: "en",
  },
  {
    id: "edit-magazine-cover",
    modality: "image-edit",
    title: "封面合成（保留人物）",
    summary: "把人物放到雜誌封面排版裡。",
    prompt:
      "Place this person on a glossy fashion magazine cover. Add bold sans-serif magazine title 'AURA' across the top in white, three smaller serif coverlines on the side, barcode lower left. Magazine paper texture, slight subsurface glow on highlights. Keep person's face and pose untouched.",
    modelHint: "fal-ai/flux-kontext / fal-ai/gpt-image-1.5",
    difficulty: "intermediate",
    tags: ["封面", "雜誌", "排版"],
    language: "en",
  },

  // ═══════════════════════════════════════════════════════════════
  // 🎬 影片生成 — 進階場景
  // ═══════════════════════════════════════════════════════════════
  {
    id: "vid-vlog-handheld",
    modality: "video",
    title: "Vlog 手持感跟拍",
    summary: "自然手持晃動感的 Vlog 風格跟拍。",
    prompt:
      "Handheld vlog style following shot, natural shaky cam, subject walks through a Tokyo backstreet at evening, neon reflections on wet ground, ambient passers-by motion in background, shallow depth of field, 24fps cinematic but raw, 5 seconds.",
    modelHint: "fal-ai/kling-2.1 / fal-ai/wan-2.1-720p",
    difficulty: "intermediate",
    tags: ["Vlog", "手持", "跟拍"],
    language: "en",
  },
  {
    id: "vid-commercial-30s",
    modality: "video",
    title: "30 秒廣告片：三幕結構",
    summary: "標準 30 秒商業廣告的三幕結構描述。",
    prompt:
      "30-second commercial structure: Act 1 (0–8s) problem/setup — character looking tired with cold coffee, muted gloomy palette. Act 2 (8–22s) solution reveal — discovers new product, color saturation lifts, warm lighting. Act 3 (22–30s) transformation — energetic confident close-up, product logo composite at end. Cinematic 24fps, brand-safe palette.",
    modelHint: "fal-ai/kling-2.1 / fal-ai/wan-2.1-720p / fal-ai/veo-3",
    difficulty: "advanced",
    tags: ["廣告", "三幕", "30秒"],
    language: "en",
  },
  {
    id: "vid-anime-action-zh",
    modality: "video",
    title: "動畫戰鬥場景",
    summary: "高動態的動畫戰鬥分鏡。",
    prompt:
      "動畫風戰鬥場景，少女揮刀劈開飛來的能量光彈，刀身殘影帶速度線，碎片向鏡頭飛濺，背景城市建築物模糊，鏡頭微微震動並輕微推進，2.5D 動畫感，24fps，5 秒。",
    modelHint: "fal-ai/kling-2.1 / fal-ai/wan-2.1",
    difficulty: "advanced",
    tags: ["動畫", "戰鬥", "動態"],
    language: "zh",
  },
  {
    id: "vid-slow-motion",
    modality: "video",
    title: "極慢動作特寫",
    summary: "高速攝影風格的極慢動作特寫。",
    prompt:
      "Phantom-style ultra slow motion, single drop of water falling into still surface, crown splash freezing mid-air, refracted backlight rim, pure black background, macro lens, 1000fps look, 4 seconds.",
    modelHint: "fal-ai/kling-2.1 / fal-ai/wan-2.1-720p",
    difficulty: "intermediate",
    tags: ["慢動作", "高速攝影", "特寫"],
    language: "en",
  },
  {
    id: "vid-aerial-drone",
    modality: "video",
    title: "空拍鏡頭：海岸線",
    summary: "穩定空拍機鏡頭飛越海岸線。",
    prompt:
      "Aerial drone shot flying over rugged coastline, slow forward motion at 30m altitude, waves crashing on rocks below, morning golden hour light, slight banking turn revealing distant lighthouse, 4K stabilized, 6 seconds.",
    modelHint: "fal-ai/kling-2.1 / fal-ai/veo-3",
    difficulty: "intermediate",
    tags: ["空拍", "Drone", "海岸"],
    language: "en",
  },
  {
    id: "vid-character-talking",
    modality: "video",
    title: "說話頭像對白動態",
    summary: "從靜態頭像生成自然口型動態。",
    prompt:
      "The character speaks naturally with realistic lip sync to the provided audio, subtle eye blinks every 3–4 seconds, slight head micro-movements, eyebrows respond to vocal emphasis, eyes have natural saccade movement, maintain identity perfectly, no body motion needed, 24fps, 8 seconds.",
    modelHint: "fal-ai/echomimic / fal-ai/stable-avatar / fal-ai/longcat-avatar",
    difficulty: "intermediate",
    tags: ["說話頭像", "Avatar", "口型同步"],
    language: "en",
  },
  {
    id: "vid-text-reveal",
    modality: "video",
    title: "標題文字浮現",
    summary: "電影感的標題文字浮現動態。",
    prompt:
      "Cinematic title reveal animation: black screen for 0.5s, then white minimal title text 'AURA' fades in slowly from blur to sharp focus over 1.5s with subtle anamorphic light streak passing through letters, hold for 1s, then text gently fades down. Total 4 seconds, 24fps.",
    modelHint: "fal-ai/kling-2.1 / fal-ai/wan-2.1",
    difficulty: "intermediate",
    tags: ["標題", "Logo", "片頭"],
    language: "en",
  },
  {
    id: "vid-nature-loop",
    modality: "video",
    title: "自然循環：火焰",
    summary: "可無縫循環的火焰特寫動態。",
    prompt:
      "Seamless loopable close-up of a single candle flame flickering naturally against pure black background, soft warm orange glow, subtle wisp of smoke, 4 seconds loop, 24fps, no cuts.",
    modelHint: "fal-ai/wan-2.1 / fal-ai/kling-2.1",
    difficulty: "beginner",
    tags: ["循環", "火焰", "Loop"],
    language: "en",
  },
  {
    id: "vid-time-lapse",
    modality: "video",
    title: "縮時攝影：日落",
    summary: "雲層快速流動的縮時日落。",
    prompt:
      "Time-lapse of sunset over a mountain range, clouds streaking rapidly across sky, sun arc descending, colors shifting from gold to pink to deep purple, foreground mountains stable, slight stars appearing toward end, 8 seconds compressed into single continuous timelapse, 24fps output.",
    modelHint: "fal-ai/wan-2.1-720p / fal-ai/veo-3",
    difficulty: "intermediate",
    tags: ["縮時", "日落", "Time-lapse"],
    language: "en",
  },
  {
    id: "vid-transition-whip",
    modality: "video",
    title: "Whip Pan 鏡頭轉場",
    summary: "用快速搖鏡完成兩鏡之間的轉場。",
    prompt:
      "Fast whip pan transition shot, camera swings rapidly from left to right with heavy motion blur in the middle, starts on scene A (sunlit beach) and ends on scene B (neon nightclub), 1 second total, 24fps, designed to splice between two clips.",
    modelHint: "fal-ai/kling-2.1 / fal-ai/wan-2.1",
    difficulty: "intermediate",
    tags: ["轉場", "Whip Pan", "剪輯"],
    language: "en",
  },

  // ═══════════════════════════════════════════════════════════════
  // 🎵 音樂音效 — 風格擴充
  // ═══════════════════════════════════════════════════════════════
  {
    id: "audio-orchestral-fantasy",
    modality: "audio",
    title: "奇幻交響配樂",
    summary: "魔戒風格的奇幻冒險交響樂。",
    prompt:
      "epic orchestral fantasy score, sweeping strings, heroic French horn theme, soft Celtic flute and harp accents, choir vocal pads in distance, 110 BPM in D major, full symphonic mix, evocative of journey and adventure, 60 seconds, Howard Shore Lord of the Rings inspired",
    modelHint: "fal-ai/sonauto / suno",
    difficulty: "advanced",
    tags: ["交響", "奇幻", "電影"],
    language: "en",
  },
  {
    id: "audio-edm-drop",
    modality: "audio",
    title: "EDM 進行與 Drop",
    summary: "標準 EDM 主歌 + Build + Drop 結構。",
    prompt:
      "energetic EDM track, structure: 8-bar intro pad, 16-bar verse with sidechained pluck, 8-bar build with riser and snare roll, 16-bar drop with massive supersaw lead and four-on-floor kick at 128 BPM in F minor, breakdown 16 bars, second drop 16 bars, 90 seconds total, festival-ready mix",
    modelHint: "fal-ai/sonauto / suno",
    difficulty: "advanced",
    tags: ["EDM", "Drop", "電子"],
    language: "en",
  },
  {
    id: "audio-meditation",
    modality: "audio",
    title: "冥想引導背景音",
    summary: "瑜伽 / 冥想用的純淨環境音。",
    prompt:
      "peaceful meditation ambient soundscape, soft Tibetan singing bowl resonance, gentle wind chimes in distance, faint flowing water, very slow evolving pad in C major, no rhythm, no melody, breath-friendly continuous texture, 120 seconds, loopable",
    modelHint: "fal-ai/sonauto / suno",
    difficulty: "beginner",
    tags: ["冥想", "Ambient", "瑜伽"],
    language: "en",
  },
  {
    id: "audio-jazz-cafe",
    modality: "audio",
    title: "爵士咖啡店背景音",
    summary: "咖啡店常見的輕鬆爵士。",
    prompt:
      "smooth bossa nova jazz, brushed drums, walking upright bass, mellow tenor saxophone melody, warm Rhodes electric piano comping, 90 BPM in B-flat major, evocative of a cozy Parisian café in autumn, 60 seconds, gentle dynamics",
    modelHint: "fal-ai/sonauto / suno",
    difficulty: "beginner",
    tags: ["爵士", "Bossa Nova", "咖啡店"],
    language: "en",
  },
  {
    id: "audio-horror-tension",
    modality: "audio",
    title: "恐怖張力背景",
    summary: "恐怖片 / 遊戲用的低頻張力音。",
    prompt:
      "creeping horror tension drone, deep sub-bass rumble, dissonant detuned strings, occasional metallic scrapes and distant whispers, slow heartbeat-like pulse at 50 BPM, no melody, escalating tension throughout, 30 seconds, perfect for jumpscare setup",
    modelHint: "fal-ai/sonauto / suno",
    difficulty: "advanced",
    tags: ["恐怖", "張力", "氛圍"],
    language: "en",
  },
  {
    id: "audio-sfx-ui",
    modality: "audio",
    title: "UI 互動音效集",
    summary: "App / 遊戲 UI 用的點擊 / 通知 / 錯誤音效。",
    prompt:
      "Clean modern UI sound effects pack, 4 sounds: 1) soft 'click' button confirmation 0.1s, 2) cheerful 'success' notification 0.5s with rising pitch, 3) neutral 'tap' 0.08s, 4) gentle 'error' descending 0.4s. All in same sonic family, soft synthesized, no abrasiveness.",
    modelHint: "fal-ai/elevenlabs-sfx",
    difficulty: "intermediate",
    tags: ["UI", "音效", "App"],
    language: "en",
  },
  {
    id: "audio-sfx-nature",
    modality: "audio",
    title: "自然音效：森林清晨",
    summary: "30 秒清晨森林環境音。",
    prompt:
      "Realistic forest dawn ambience, multiple bird species chirping naturally, distant woodpecker, soft breeze through leaves, occasional cricket fade-out, no artificial loops, 30 seconds, immersive stereo, dawn chorus character",
    modelHint: "fal-ai/elevenlabs-sfx",
    difficulty: "beginner",
    tags: ["環境音", "自然", "森林"],
    language: "en",
  },

  // ═══════════════════════════════════════════════════════════════
  // 🗣️ 語音 — 情境擴充
  // ═══════════════════════════════════════════════════════════════
  {
    id: "voice-news-anchor",
    modality: "voice",
    title: "新聞主播語氣",
    summary: "正式新聞播報的中文語氣。",
    prompt:
      "各位觀眾朋友晚安，這裡是晚間新聞。今晚的頭條，我們將為您深度解析人工智慧產業的最新發展，以及它對日常生活帶來的影響。請繼續鎖定我們的節目。",
    modelHint: "elevenlabs / fal-ai/qwen-tts",
    difficulty: "beginner",
    tags: ["新聞", "主播", "中文"],
    language: "zh",
    example: {
      inputs: { stability: "0.85", similarity_boost: "0.7", style: "0.2" },
    },
  },
  {
    id: "voice-asmr-soft",
    modality: "voice",
    title: "ASMR 輕聲耳語",
    summary: "ASMR 風格的舒緩輕聲。",
    prompt:
      "今晚...讓我們慢慢放鬆，深呼吸，把今天的疲憊...都呼出去。你不需要做什麼...只要靜靜地聽我的聲音。讓自己沉入一片溫柔的安靜裡。",
    modelHint: "elevenlabs (whisper voice)",
    difficulty: "intermediate",
    tags: ["ASMR", "耳語", "睡眠"],
    language: "zh",
    example: {
      inputs: { stability: "0.45", similarity_boost: "0.75", style: "0.6" },
    },
  },
  {
    id: "voice-podcast-cohost",
    modality: "voice",
    title: "Podcast 對談語氣",
    summary: "輕鬆自然的 Podcast 共同主持人語氣。",
    prompt:
      "嘿大家好，又到了我們週四的閒聊時間。今天我和老王要來聊聊一個超有趣的話題——你有沒有想過，AI 真的能取代你的工作嗎？或者它其實只是幫你打雜的助理？來，老王你先說。",
    modelHint: "elevenlabs / fal-ai/qwen-tts",
    difficulty: "beginner",
    tags: ["Podcast", "對談", "輕鬆"],
    language: "zh",
  },
  {
    id: "voice-character-villain",
    modality: "voice",
    title: "反派角色台詞",
    summary: "陰沉、慢、低聲的反派角色台詞。",
    prompt:
      "<speak>所以...<break time=\"0.4s\"/>你終於來了。<break time=\"0.6s\"/>我等這一刻...已經很久了。<break time=\"0.3s\"/>但你以為，<break time=\"0.4s\"/>你真的能阻止我嗎？</speak>",
    modelHint: "elevenlabs (deep male, SSML)",
    difficulty: "advanced",
    tags: ["反派", "角色", "SSML"],
    language: "zh",
  },
  {
    id: "voice-child-cheerful",
    modality: "voice",
    title: "兒童開朗對白",
    summary: "活潑可愛的兒童語氣。",
    prompt:
      "哇！這個好好玩喔！我從來沒看過這麼厲害的東西耶！媽媽你看你看，這隻小狗會自己跳！我們可以也養一隻嗎？拜託拜託拜託！",
    modelHint: "elevenlabs (child voice)",
    difficulty: "intermediate",
    tags: ["兒童", "活潑", "角色"],
    language: "zh",
  },
  {
    id: "voice-en-tutorial",
    modality: "voice",
    title: "英文教學旁白",
    summary: "清晰、慢速、適合學習的英文旁白。",
    prompt:
      "Welcome back to today's lesson. In this video, we'll explore three simple techniques that will dramatically improve your AI-generated images. Take your time, pause whenever you need, and remember — practice is the key to mastery.",
    modelHint: "elevenlabs (clear English voice)",
    difficulty: "beginner",
    tags: ["英文", "教學", "Tutorial"],
    language: "en",
    example: {
      inputs: { stability: "0.7", similarity_boost: "0.7", style: "0.25" },
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // 🤖 代理人呼叫 — 進階場景
  // ═══════════════════════════════════════════════════════════════
  {
    id: "agent-debug-prompt",
    modality: "agent",
    title: "請光球幫忙除錯提示詞",
    summary: "光球分析現有提示詞為何效果不佳。",
    prompt:
      "我的提示詞「a beautiful woman」生出來都很模糊、表情怪。請幫我診斷哪裡有問題，列出 3 個具體缺陷，並改寫成一個高品質版本。",
    difficulty: "intermediate",
    tags: ["光球", "除錯", "提示詞優化"],
    language: "zh",
  },
  {
    id: "agent-batch-generate",
    modality: "agent",
    title: "讓光球批量生圖（風格變體）",
    summary: "用相同主題但不同風格生成 4 張變體。",
    prompt:
      "幫我用「日式神社入口」這個主題，分別生成 4 種風格：1) 寫實攝影、2) 水彩插畫、3) 動畫風、4) 浮世繪。每張圖用相同構圖（鳥居正面對稱）。",
    difficulty: "intermediate",
    tags: ["批量", "變體", "風格"],
    language: "zh",
  },
  {
    id: "agent-explain-result",
    modality: "agent",
    title: "讓光球解釋生成結果",
    summary: "請光球分析剛生成的圖為何符合或不符合預期。",
    prompt:
      "看看我剛剛生成的這張圖，跟我原本要的「電影感人像」有什麼差距？模型用對了嗎？提示詞哪裡可以加強？",
    difficulty: "intermediate",
    tags: ["光球", "結果分析", "回饋"],
    language: "zh",
  },
  {
    id: "agent-model-recommendation",
    modality: "agent",
    title: "請光球推薦模型",
    summary: "依照需求推薦最適合的生成模型。",
    prompt:
      "我要生一段 5 秒、需要保持原角色一致的動畫風影片，預算想低一點。請推薦最適合的影片模型，並說明為何選它而不選其他。",
    difficulty: "intermediate",
    tags: ["光球", "模型推薦", "選型"],
    language: "zh",
  },
  {
    id: "agent-search-learn-zh",
    modality: "agent",
    title: "請光球搜尋學習文件",
    summary: "讓光球從學習中心找相關教學。",
    prompt: "我想學 LoRA 角色一致性訓練，幫我找學習中心相關的文章與測驗。",
    difficulty: "beginner",
    tags: ["光球", "學習中心", "搜尋"],
    language: "zh",
    example: {
      expectedOutput:
        "[ACTION:navigate:/learn?search=LoRA%20角色一致性]",
    },
  },
  {
    id: "agent-cost-budget",
    modality: "agent",
    title: "請光球估算成本",
    summary: "估算一次完整創作的點數消耗。",
    prompt:
      "我想做：3 張圖（高品質）+ 1 段 5 秒影片 + 30 秒背景音樂 + 60 秒中文旁白。請估算各項點數，告訴我總共會扣多少，以及有沒有省點數的替代方案。",
    difficulty: "intermediate",
    tags: ["成本", "點數", "估算"],
    language: "zh",
  },
  {
    id: "agent-multi-step-plan",
    modality: "agent",
    title: "請光球規劃多步驟任務",
    summary: "一個任務拆成數步，逐步執行並回報。",
    prompt:
      "幫我規劃並執行：1) 從我的資料庫找出最近一份品牌簡報，2) 摘要視覺風格指南，3) 依風格生成 3 張封面候選圖，4) 把結果存到 /assets 並標 team_shared。",
    difficulty: "advanced",
    tags: ["多步驟", "規劃", "Agentic"],
    language: "zh",
  },
  {
    id: "agent-translate-prompt",
    modality: "agent",
    title: "光球翻譯並優化中文提示詞",
    summary: "把口語中文意圖翻譯成高品質英文提示詞。",
    prompt:
      "把我這句『我想要一張很有氣質、看起來像在咖啡店看書的女生的照片，光線要柔和』翻成最適合 fal-ai/flux-pro 的英文提示詞，並補上必要的攝影 / 光線 / 鏡頭描述。",
    difficulty: "intermediate",
    tags: ["翻譯", "中翻英", "提示詞優化"],
    language: "zh",
  },
  {
    id: "agent-vault-inject",
    modality: "agent",
    title: "從保險庫注入角色",
    summary: "讓光球把保險庫中的角色注入到當下生成。",
    prompt:
      "從我的一致性保險庫挑出『艾莉絲』這個角色，把她注入接下來的圖片生成，背景設為東京夜景。",
    difficulty: "advanced",
    tags: ["保險庫", "Vault", "角色注入"],
    language: "zh",
  },

  // ═══════════════════════════════════════════════════════════════
  // ⚙️ 系統提示詞 — 更多代理人人格
  // ═══════════════════════════════════════════════════════════════
  {
    id: "system-director-ai",
    modality: "system",
    title: "導演 AI 人格（創意總監）",
    summary: "/director 頁面使用的創意導演 system prompt。",
    prompt: `You are Director AI, a senior creative director for a multimodal generative studio.

Mission: Convert vague user intent into a complete, production-ready creative plan.

For every user brief, output JSON with this structure:
{
  "project_title": string,
  "creative_concept": "<one-sentence north star>",
  "tone": ["<emotional adjective>", ...],
  "scenes": [
    {
      "shot_number": int,
      "duration_seconds": number,
      "visual_prompt": "<English image/video prompt, optimized for fal-ai>",
      "voiceover_zh": "<Traditional Chinese VO script>",
      "music_brief": "<one-line music direction>",
      "recommended_model": "<fal-ai/... id>",
      "estimated_credits": int
    }
  ],
  "total_estimated_credits": int
}

Rules:
- Default to 6 scenes unless user specifies otherwise.
- Visual prompts must be production-quality (subject, style, lighting, camera, quality).
- Recommend cost-appropriate models (don't over-spec).
- Output ONLY valid JSON.`,
    modelHint: "Gemini 2.5 Pro",
    difficulty: "advanced",
    tags: ["導演 AI", "System Prompt", "JSON"],
    language: "en",
  },
  {
    id: "system-vibe-coach",
    modality: "system",
    title: "靈感教練人格（VibeCoach）",
    summary: "幫使用者從零開始發想創作主題的教練。",
    prompt: `你是 VibeCoach，Healing Studio 的創作靈感教練。

當使用者說「不知道做什麼」時，你的任務：
1. 問 3 個聚焦問題（情緒？對象？場合？），每個給 3 個快速選項
2. 收到回答後，產出 5 個具體創作點子，每個點子含：
   - 一句話主題
   - 適合模態（圖/影/音/語音）
   - 預估難度與時間
3. 用繁體中文、口語、溫暖、不批判
4. 不要長篇大論，每輪不超過 80 字`,
    modelHint: "Gemini 2.5 Flash",
    difficulty: "intermediate",
    tags: ["教練", "Coach", "靈感"],
    language: "zh",
  },
  {
    id: "system-rag-summarizer",
    modality: "system",
    title: "RAG 文件摘要官",
    summary: "把上傳到資料庫的長文件做結構化摘要。",
    prompt: `You are the RAG Summarizer for Healing Studio's teaching archive.

Given a document's full text (PDF / docx / transcript), produce:
{
  "title": "<inferred or extracted>",
  "abstract": "<3-sentence overview, Traditional Chinese>",
  "key_topics": ["<topic 1>", "<topic 2>", ...],  // max 8
  "actionable_takeaways": ["<takeaway 1>", ...],  // max 5
  "suggested_queries": ["<question users might ask>"],  // max 5
  "language": "zh" | "en" | "mixed"
}

Be faithful to the source. Do not invent facts. If the document is purely visual (image transcript), note it.
Output ONLY valid JSON.`,
    modelHint: "Gemini 2.5 Pro",
    difficulty: "advanced",
    tags: ["RAG", "摘要", "結構化"],
    language: "en",
  },
  {
    id: "system-prompt-critic",
    modality: "system",
    title: "提示詞評審官",
    summary: "對使用者提交的提示詞做品質評分與建議。",
    prompt: `You are a strict but encouraging prompt critic for image / video generation.

For each user prompt, return JSON:
{
  "score": 0-100,
  "missing": ["<missing element>", ...],  // e.g. lighting, camera, style
  "redundant": ["<redundant word>", ...],
  "improved": "<one improved version of the prompt>"
}

Scoring rubric:
- Subject clarity (25)
- Style / mood (20)
- Lighting / color (20)
- Camera / composition (15)
- Quality / technical descriptors (20)

Output ONLY valid JSON.`,
    modelHint: "Gemini 2.5 Flash",
    difficulty: "advanced",
    tags: ["評審", "評分", "Critic"],
    language: "en",
  },
  {
    id: "system-character-bio",
    modality: "system",
    title: "角色設定產生器",
    summary: "根據簡述產出完整角色設定卡。",
    prompt: `你是角色設定產生器。

輸入：角色簡述（如「一個冷酷的女駭客」）

輸出（繁體中文 JSON）：
{
  "name": "<取一個有風格的名字>",
  "age": int,
  "occupation": "<職業>",
  "personality": ["<三個性格特徵>"],
  "appearance": {
    "hair": "<顏色 + 髮型>",
    "eyes": "<顏色>",
    "outfit": "<服裝風格>",
    "distinguishing_features": ["<特徵>"]
  },
  "backstory": "<3 句話背景故事>",
  "visual_prompt_en": "<可直接用於 fal-ai/flux 的英文提示詞>",
  "lora_trigger_suggestion": "<3-5 字的 LoRA 觸發詞>"
}

僅輸出 JSON，無其他內容。`,
    modelHint: "Gemini 2.5 Pro",
    difficulty: "intermediate",
    tags: ["角色", "設定", "JSON"],
    language: "zh",
  },

  // ═══════════════════════════════════════════════════════════════
  // 🔁 工作流程 — 更多場景
  // ═══════════════════════════════════════════════════════════════
  {
    id: "workflow-brand-kit",
    modality: "workflow",
    title: "品牌素材包工作流",
    summary: "用一份品牌風格指南產出完整素材包。",
    prompt: `品牌素材包工作流（5 步驟）：

1️⃣ 上傳品牌風格指南到 /teaching-archive（個人資料庫），AI 自動抽取色票、字型描述、調性關鍵字。
2️⃣ 在 /director 用「品牌素材包」prompt，導演 AI 依風格指南規劃 8 件產出（Logo 應用圖、社群貼文模板 ×3、廣告 banner ×2、開箱影片、品牌音 jingle）。
3️⃣ 分送到 /image-studio、/video-studio、/pro-studio 批次生成。
4️⃣ 把所有產出存到 /assets，標 team_shared 與品牌標籤。
5️⃣ 用「提示詞庫存到我的詞庫」功能保留可重用的品牌提示詞。`,
    difficulty: "advanced",
    tags: ["品牌", "素材包", "團隊"],
    language: "zh",
  },
  {
    id: "workflow-podcast-pipeline",
    modality: "workflow",
    title: "Podcast 製作流水線",
    summary: "從腳本到完成 Podcast 集數的端到端流程。",
    prompt: `Podcast 一集製作流水線（7 步驟）：

1️⃣ 在 /notes 寫腳本（type=script），包含開場、3 個段落、結尾。
2️⃣ /director 把腳本拆成段落並補旁白語氣指示。
3️⃣ /pro-studio 用 ElevenLabs / Qwen TTS 把每段轉成語音檔。
4️⃣ /pro-studio 用 Sonauto 產 1 段 15s 開場、3 段過場、1 段結尾共 5 個音樂片段。
5️⃣ /image-studio 產一張 Podcast 封面（套用「Podcast 完整素材」prompt）。
6️⃣ 把語音 + 音樂 + 封面存到 /assets，外部 DAW（Audacity / Reaper）剪輯合成。
7️⃣ 完成的 mp3 + 封面回傳 /assets，標 team_shared。`,
    difficulty: "advanced",
    tags: ["Podcast", "流水線", "端到端"],
    language: "zh",
  },
  {
    id: "workflow-storyboard-i2v",
    modality: "workflow",
    title: "靜態分鏡轉動態影片",
    summary: "從手繪 / AI 分鏡圖一鍵轉成動態片段。",
    prompt: `靜態分鏡 → 動態 I2V 工作流：

1️⃣ 用 /image-studio 生成或上傳 6 張分鏡圖（每張對應一個鏡頭）。
2️⃣ 在每張圖的「送到影片工作室」按鈕，自動帶入到 /video-studio。
3️⃣ 為每張圖寫一段「動作描述」I2V 提示詞（鏡頭運動、主體動作）。
4️⃣ 批次用 Kling 2.1 I2V 生成 6 個 4 秒片段。
5️⃣ 全部存到 /assets，再用剪輯工具串接。

建議：分鏡圖之間用 Vault 保險庫的相同角色 / 場景 reference 確保連貫性。`,
    difficulty: "advanced",
    tags: ["分鏡", "I2V", "影片"],
    language: "zh",
  },
  {
    id: "workflow-rag-knowledge-bot",
    modality: "workflow",
    title: "建立個人知識機器人",
    summary: "用個人資料庫 + RAG 讓 AI 用你的資料回答。",
    prompt: `個人知識機器人工作流（4 步驟）：

1️⃣ 在 /teaching-archive 批次上傳專業領域文件（PDF / docx / 講座錄音）。
2️⃣ 等待 Phase 2 RAG ingestion 完成（PDF 抽文、音訊轉字、切片、嵌入到 Pinecone）。
3️⃣ 在光球設定中啟用「引用我的資料庫」。
4️⃣ 之後任何問題，光球會自動從你的資料庫檢索前 3 段最相關片段，注入 system prompt，再回答。

實用情境：自己的學術筆記 / 課程講義 / 客戶 brief 變成隨叫隨用的私人顧問。`,
    difficulty: "advanced",
    tags: ["RAG", "知識庫", "Pinecone"],
    language: "zh",
    references: [
      { label: "個人資料庫", href: "/teaching-archive" },
      { label: "Pinecone RAG", href: "/learn?docId=api-pinecone-rag" },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // 🌐 跨模態組合 — 更多模板
  // ═══════════════════════════════════════════════════════════════
  {
    id: "multimodal-music-mv",
    modality: "multimodal",
    title: "音樂 MV（音 + 影 + 字幕）",
    summary: "一首歌的 MV 三件套規劃。",
    prompt: `MV 三件套規劃：

主題：失戀後在城市夜晚漫步

A. 音樂（音訊）：
"melancholic indie pop ballad, slow 75 BPM, acoustic guitar arpeggio, soft piano, ambient pad, female vocal lead with reverb, 90 seconds, key of A minor"

B. 影片（圖生影 × 8 鏡）：
8 個鏡頭，每鏡 5 秒，主角在不同夜景城市場景中行走，鏡頭多用慢推、慢拉、淺景深，I2V 由 Kling 2.1 處理。

C. 字幕（語音 TTS 唱詞或外掛字幕）：
中英對照字幕，跟著節拍進出，置底中央。`,
    difficulty: "advanced",
    tags: ["MV", "音樂", "跨模態"],
    language: "mixed",
  },
  {
    id: "multimodal-product-launch",
    modality: "multimodal",
    title: "新品發表完整素材包",
    summary: "產品發表會所需的全套素材一次規劃。",
    prompt: `新品發表素材包：

1. 產品定裝照 ×5（圖片，白底 + 4 種使用情境）
2. 30 秒廣告片（影片，用「30 秒廣告片：三幕結構」模板）
3. 開場 jingle 5 秒 + 配樂 60 秒（音訊）
4. 中英雙語旁白（語音 ×2）
5. 社群圖卡 ×6（圖片，方形與 9:16 各 3 張）
6. 360° 環繞影片（影片，6 秒，白底）

全部存入 /assets，命名格式：[product-code]-[asset-type]-[locale]。`,
    difficulty: "advanced",
    tags: ["產品發表", "素材包", "行銷"],
    language: "zh",
  },
  {
    id: "multimodal-tutorial-video",
    modality: "multimodal",
    title: "教學影片完整素材",
    summary: "知識型教學影片的全套規劃。",
    prompt: `教學影片素材：

A. 開場圖（圖片）：標題卡，標題 + 講者名 + Logo 留白。
B. 主視覺動畫（影片，3s）：「Logo 浮現」prompt。
C. 內容圖示（圖片 ×5）：等距 3D 圖示風格的概念說明圖。
D. 旁白稿（語音）：英文清晰教學版，每段 30-60s。
E. 背景音樂（音訊）：Lo-fi 讀書背景音樂，整支 5 分鐘混音。
F. 結尾畫面（圖片 + 影片）：訂閱 CTA + 下集預告卡片。`,
    difficulty: "intermediate",
    tags: ["教學", "知識型", "YouTube"],
    language: "zh",
  },

  // ═══════════════════════════════════════════════════════════════
  // 🎯 提示詞片段（Modifier Library）— 可組裝的常用片段
  // ═══════════════════════════════════════════════════════════════
  {
    id: "modifier-camera-lens",
    modality: "image",
    title: "📐 鏡頭 / 焦段片段庫",
    summary: "可插入到任何圖片提示詞末段的鏡頭描述。",
    prompt: `常用鏡頭片段（直接附加到 prompt 末尾，逗號分隔）：

人像 / 特寫：
- 85mm prime lens, f/1.4, shallow depth of field
- 105mm macro, extreme close-up
- 50mm standard, natural perspective

風景 / 廣角：
- 24mm wide angle, sweeping vista
- 16mm ultra-wide, exaggerated perspective
- panoramic 65mm crop

電影感：
- anamorphic lens flare, 2.39:1 aspect ratio
- shot on ARRI Alexa, cinematic 24fps look
- film grain, Kodak Portra 400 emulation

俯瞰 / 仰望：
- top-down 90 degree overhead shot
- low angle hero shot, looking up
- Dutch tilt, dramatic angle`,
    difficulty: "intermediate",
    tags: ["片段", "鏡頭", "焦段"],
    language: "en",
  },
  {
    id: "modifier-lighting",
    modality: "image",
    title: "💡 光線片段庫",
    summary: "套用到任何場景的光線描述片段。",
    prompt: `常用光線片段：

時段：
- golden hour backlight, warm rim light
- blue hour twilight, soft cool ambience
- harsh noon sunlight, strong directional shadow
- moonlit night, cool silver tones

棚拍：
- soft box diffused key light, large softbox at 45 degrees
- rembrandt lighting, single hard light, triangular cheek light
- butterfly lighting, beauty dish overhead
- ring light, even fashion glow

氛圍：
- volumetric god rays through atmospheric haze
- neon under-lighting, magenta and cyan from below
- candlelit warm flicker, intimate close glow
- backlit silhouette against bright window

色溫：
- 3200K tungsten warm
- 5600K daylight neutral
- 7000K overcast cool blue`,
    difficulty: "intermediate",
    tags: ["片段", "光線", "Lighting"],
    language: "en",
  },
  {
    id: "modifier-quality-tags",
    modality: "image",
    title: "✨ 品質標籤片段庫",
    summary: "提升整體品質的尾段標籤。",
    prompt: `常用品質標籤（建議放在 prompt 最末段）：

通用：
- 8K, ultra-detailed, masterpiece quality
- sharp focus, intricate details, professional
- award-winning photography, trending on ArtStation

攝影：
- shot on Hasselblad medium format
- color-graded in DaVinci Resolve
- ISO 100, perfect exposure, no noise

插畫：
- official artwork, key visual quality
- by Greg Rutkowski and Beksinski (for fantasy)
- by Makoto Shinkai and Studio Ghibli (for anime)

3D 渲染：
- Octane render, physically based rendering
- Unreal Engine 5 Lumen, ray traced global illumination
- subsurface scattering on skin, accurate IOR materials`,
    difficulty: "beginner",
    tags: ["片段", "品質", "Quality Tags"],
    language: "en",
  },
  {
    id: "modifier-negative-universal",
    modality: "image",
    title: "🚫 通用負面提示詞庫",
    summary: "常用於排除瑕疵的負面提示詞片段。",
    prompt: `通用負面提示詞（適合多數寫實 / 動畫場景）：

人物瑕疵：
- deformed hands, extra fingers, missing fingers, fused fingers
- malformed face, asymmetric eyes, crossed eyes
- extra limbs, missing limbs, disconnected anatomy
- bad proportions, distorted body

畫質瑕疵：
- blurry, low quality, low resolution, pixelated
- jpeg artifacts, compression noise, banding
- watermark, signature, text, logo
- frame, border, multiple panels

AI 常見問題：
- plastic skin, oversmooth, doll-like
- oversaturated, washed out colors
- ai artifact, generative noise, hallucinated detail
- duplicate, twin subjects (when only one wanted)

風格干擾：
- cartoon (when realism wanted) / realistic (when cartoon wanted)
- monochrome (when color wanted) / color (when B&W wanted)`,
    difficulty: "beginner",
    tags: ["負面", "Negative", "片段"],
    language: "en",
  },
  // ═══════════════════════════════════════════════════════════════
  // 🎯 新手情境上手：提示前後對照（AIDV-813）
  // ═══════════════════════════════════════════════════════════════

  // ─ 情境 A：電商賣家 × 圖 ─
  {
    id: "onboard-ec-whitebg",
    modality: "image",
    title: "【前後對照】電商白底主圖",
    summary: "加上光線與品質描述後，白底圖從模糊不一到電商專業級。",
    prompt: `弱提示：商品圖

→ 強提示：
professional product photography of [your product], pure white seamless background, soft top diffused light with gentle fill from left, no harsh shadows, centered composition, ultra-sharp focus on product, 8K commercial catalog quality

▷ 為什麼更好：「白背景」不等於「無縫白底＋柔光」，加入光線設定讓模型輸出電商標準，而不是隨意生個亮色背景。`,
    modelHint: "fal-ai/flux-pro",
    difficulty: "beginner",
    tags: ["電商", "白底", "新手", "前後對照"],
    language: "mixed",
    references: [
      { label: "電商賣家×圖 上手路徑", href: "/learn?docId=scenario-ecommerce-image" },
    ],
  },
  {
    id: "onboard-ec-context",
    modality: "image",
    title: "【前後對照】商品情境圖",
    summary: "從「咖啡背景」到有光線、質感、景深的情境攝影，品牌感立刻提升。",
    prompt: `弱提示：咖啡杯放在咖啡廳背景

→ 強提示：
ceramic coffee mug sitting on aged oak café table, morning window light streaming from left, steam rising naturally, soft bokeh of warm-toned café interior behind, shallow depth of field, commercial lifestyle photography style, 8K

▷ 為什麼更好：「咖啡廳背景」沒說光線方向和材質，模型容易產出光影不一致的情境圖；加入光線來源後品牌感一致。`,
    modelHint: "fal-ai/flux-pro / fal-ai/imagen4",
    difficulty: "beginner",
    tags: ["電商", "情境圖", "商品攝影", "前後對照"],
    language: "mixed",
    references: [
      { label: "電商商品行銷素材包", href: "/learn?docId=workflow-product-marketing" },
    ],
  },
  {
    id: "onboard-ec-banner",
    modality: "image-edit",
    title: "【前後對照】促銷橫幅留白設計",
    summary: "指定留白位置和比例，橫幅才能讓設計師疊上標題文字實際使用。",
    prompt: `弱提示：幫我做一個促銷圖

→ 強提示：
Keep the product (商品去背圖) intact on the right 40% of canvas. Left 60% is a warm coral-to-cream gradient background with clear empty space at top-left for promotional headline text. Add a subtle badge shape at bottom-left for discount callout. No AI-generated text. Commercial web banner, 16:9 ratio.

▷ 為什麼更好：「促銷圖」讓模型自由排版，無法疊字；明確說「留空給標題」和比例後，設計師才能直接使用。`,
    modelHint: "fal-ai/flux-kontext / fal-ai/gpt-image-1.5",
    difficulty: "beginner",
    tags: ["電商", "橫幅", "Banner", "前後對照"],
    language: "mixed",
  },
  {
    id: "onboard-ec-vault",
    modality: "workflow",
    title: "【新手流程】電商多圖一致性：Vault 保險庫",
    summary: "把商品定版圖存入 Vault 再生圖，解決「多張圖商品長得不一樣」的問題。",
    prompt: `商品一致性工作流（3 步驟）：

1️⃣ 先用白底提示詞生成一張最滿意的商品「定版圖」。
2️⃣ 在圖片下方點「存入保險庫」，type 選 product，加品牌標籤（如 my-coffee-mug）。
3️⃣ 之後每次生圖，點「從保險庫引用」選你的商品圖，模型會以它為參考保持外觀一致。

▷ 卡關點：跳過步驟 2 直接重寫提示詞，每次生出的商品細節會略有不同；一致性保險庫是解法。`,
    difficulty: "beginner",
    tags: ["電商", "Vault", "一致性", "工作流"],
    language: "zh",
    references: [
      { label: "一致性保險庫", href: "/vault" },
      { label: "電商賣家×圖 上手路徑", href: "/learn?docId=scenario-ecommerce-image" },
    ],
  },

  // ─ 情境 B：自媒體創作者 × 影 ─
  {
    id: "onboard-vid-i2v-action",
    modality: "video",
    title: "【前後對照】圖生影動作描述",
    summary: "動作描述越具體，I2V 動態越可控；模糊描述讓模型隨機亂動。",
    prompt: `弱提示：讓這張圖動起來

→ 強提示：
The camera slowly pushes in (dolly forward) toward the subject at a steady pace over 4 seconds. Subject remains stationary. Maintain the existing lighting and color palette. No cuts, smooth motion, 24fps cinematic.

▷ 為什麼更好：「讓它動起來」讓模型自由發揮，常出現不自然抖動；明確鏡頭運動類型（推鏡）讓結果穩定可控。`,
    modelHint: "fal-ai/kling-2.1-i2v / fal-ai/wan-2.1-i2v",
    difficulty: "beginner",
    tags: ["I2V", "圖生影", "動作描述", "前後對照"],
    language: "mixed",
    references: [
      { label: "自媒體×影 上手路徑", href: "/learn?docId=scenario-creator-video" },
    ],
  },
  {
    id: "onboard-vid-480p-first",
    modality: "video",
    title: "【新手技巧】先跑 480p 省點數省時間",
    summary: "先低解析度確認動態方向，滿意再升 720p，省下 3–5 倍成本。",
    prompt: `影片生成省成本策略：

❌ 常見新手錯誤：直接選 720p 或 1080p，等很久且點數花多。

✅ 正確流程：
1. 先選 480p、5 秒，生成速度快 2–3 倍，點數省約 60%。
2. 確認動態方向、構圖、鏡頭運動都對了。
3. 滿意後，同一組提示詞重新選 720p 跑正式版。

▷ 提示：480p 和 720p 用同樣提示詞輸出動態幾乎一致，只差解析度。先試再升，最省時省錢。`,
    difficulty: "beginner",
    tags: ["影片", "省點數", "480p", "新手技巧"],
    language: "zh",
    references: [
      { label: "自媒體×影 上手路徑", href: "/learn?docId=scenario-creator-video" },
    ],
  },
  {
    id: "onboard-vid-model-picker",
    modality: "workflow",
    title: "【決策小抄】影片模型怎麼選",
    summary: "3 個問題在 30 秒內選對影片模型，不再糾結。",
    prompt: `影片模型選型小抄：

Q1. 是中文場景或動畫風格嗎？
→ 是：優先選 Kling v2.1（中文場景最佳）
→ 否：看 Q2

Q2. 需要真實物理感（水、火、布料）嗎？
→ 是：Veo 3 或 Wan 2.1 720p
→ 否：看 Q3

Q3. 預算優先還是品質優先？
→ 預算優先：Wan 2.1 480p（最快最省）
→ 品質優先：Kling v2.1 或 Pixverse 4.5

▷ 默認推薦：自媒體短影音 → Kling v2.1，先 480p 試，滿意再升 720p。`,
    difficulty: "beginner",
    tags: ["影片", "模型選型", "決策", "Kling"],
    language: "zh",
    references: [
      { label: "自媒體×影 上手路徑", href: "/learn?docId=scenario-creator-video" },
    ],
  },
  {
    id: "onboard-vid-director-short",
    modality: "agent",
    title: "【前後對照】請導演 AI 規劃短影音",
    summary: "給導演 AI 足夠的調性與目標，才能得到可執行的分鏡規劃而不是空洞建議。",
    prompt: `弱提示：幫我做一支影片

→ 強提示：
我要做一支 15 秒自媒體短影音，主題是「台北咖啡店早晨」，風格溫暖文青，目標是 IG Reels，觀眾是 25–35 歲白領。請規劃 3 個分鏡，每鏡寫：視覺提示詞、推薦模型、建議秒數。

▷ 為什麼更好：「幫我做一支影片」讓 AI 亂猜主題和風格；給出平台（IG Reels）、調性（溫暖文青）、受眾，導演 AI 才能輸出可執行的分鏡。`,
    difficulty: "beginner",
    tags: ["導演AI", "短影音", "IG Reels", "前後對照"],
    language: "zh",
    references: [
      { label: "自媒體×影 上手路徑", href: "/learn?docId=scenario-creator-video" },
      { label: "導演 AI 完整指南", href: "/learn?docId=deep-director" },
    ],
  },

  // ─ 情境 C：教育者 × 音/語音 ─
  {
    id: "onboard-voice-lecture-zh",
    modality: "voice",
    title: "【前後對照】課程旁白語氣",
    summary: "加入節奏停頓和引導句，TTS 旁白從機械念稿變有溫度的課程聲音。",
    prompt: `弱提示：人工智慧是一種讓電腦模仿人類智慧的技術。

→ 強提示：
歡迎來到這堂課。<break time="0.5s"/> 今天，我們要一起認識人工智慧——它不是遙遠的科幻，<break time="0.3s"/> 而是你手機裡每天都在使用的技術。<break time="0.4s"/> 讓我們從最簡單的問題開始：AI 到底怎麼「學習」？

▷ 為什麼更好：加入自然停頓（SSML break）和引導句，讓聽者有時間跟上，語氣從說明書變成有溫度的老師。`,
    modelHint: "fal-ai/qwen-tts",
    difficulty: "beginner",
    tags: ["TTS", "課程", "旁白", "前後對照"],
    language: "zh",
    references: [
      { label: "教育者×音 上手路徑", href: "/learn?docId=scenario-educator-voice" },
    ],
  },
  {
    id: "onboard-voice-qwen-guide",
    modality: "voice",
    title: "【決策對照表】中文配音引擎怎麼挑",
    summary: "Qwen TTS vs ElevenLabs vs Dia TTS 三引擎快速比較，中文首選 Qwen。",
    prompt: `中文配音引擎選型對照：

| 情境            | 推薦引擎        | 原因                              |
|-----------------|-----------------|-----------------------------------|
| 中文課程旁白    | Qwen TTS        | 中文聲調最自然、支援 SSML 停頓   |
| 英文或多語系    | ElevenLabs      | 英文情緒表現最佳                 |
| 角色扮演/對白   | Dia TTS         | 雙人對話、情緒轉換               |
| 聲音克隆固定音色| Qwen Clone      | 中文音色克隆穩定性最佳           |

▷ 新手默認：中文課程/旁白一律選 Qwen TTS，無需額外設定，自然度最接近真人。`,
    difficulty: "beginner",
    tags: ["TTS", "引擎選型", "Qwen", "中文"],
    language: "zh",
    references: [
      { label: "教育者×音 上手路徑", href: "/learn?docId=scenario-educator-voice" },
    ],
  },
  {
    id: "onboard-voice-bgm-pure",
    modality: "audio",
    title: "【前後對照】課程純背景音樂",
    summary: "指定 no vocals 和 designed for voiceover，背景音才不會搶旁白的戲。",
    prompt: `弱提示：給我一段輕鬆音樂

→ 強提示：
calm educational background music, no vocals, no lyrics, soft acoustic guitar and light piano, gentle flowing melody at 72 BPM, warm and focused mood, designed to sit under voiceover, subtle dynamics, loopable 60 seconds

▷ 為什麼更好：「輕鬆音樂」可能生出帶人聲的流行歌；加 "no vocals" 和 "designed to sit under voiceover" 才能得到不搶旁白的背景音。`,
    modelHint: "fal-ai/sonauto",
    difficulty: "beginner",
    tags: ["背景音樂", "純音樂", "課程", "前後對照"],
    language: "mixed",
    references: [
      { label: "教育者×音 上手路徑", href: "/learn?docId=scenario-educator-voice" },
    ],
  },
  {
    id: "onboard-voice-clone-easy",
    modality: "voice",
    title: "【新手流程】聲音克隆其實很簡單",
    summary: "3 步用自己的聲音做固定音色旁白，30 秒手機錄音就夠，不需錄音棚。",
    prompt: `聲音克隆 3 步流程：

1️⃣ 準備 30–60 秒的乾淨錄音：用手機在安靜環境自然說話，不需要錄音棚設備。

2️⃣ 上傳到 ProStudio → 語音合成 → 「聲音克隆」→ 上傳訓練音頻，等待約 2–5 分鐘完成訓練。

3️⃣ 之後任何 TTS 旁白都可以選「我的音色」，整個課程系列保持同一個聲音。

▷ 卡關點：以為需要很多錄音或專業設備，其實 30 秒手機錄音就夠；固定音色讓整個課程聽起來更一致專業。`,
    difficulty: "beginner",
    tags: ["聲音克隆", "Voice Clone", "課程", "新手流程"],
    language: "zh",
    references: [
      { label: "聲音克隆訓練稿", href: "/learn?docId=voice-clone-script" },
      { label: "教育者×音 上手路徑", href: "/learn?docId=scenario-educator-voice" },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // 🎯 核心人格上手：提示前後對照（AIDV-966）
  // ═══════════════════════════════════════════════════════════════

  // ─ 情境 D：接案者 × 圖影（交付一致性）─
  {
    id: "onboard-fl-charsheet",
    modality: "image",
    title: "【前後對照】接案角色定版三視圖",
    summary: "從「畫一個吉祥物」到三視圖＋固定色票的定版圖，之後改稿和 LoRA 訓練都有基準。",
    prompt: `弱提示：畫一個貓咪吉祥物

→ 強提示：
character reference sheet of a cheerful orange tabby cat mascot, front view + side view + back view on one sheet, consistent facial features and proportions across all views, fixed flat color palette (orange #F5A623, cream, charcoal), neutral light gray background, clean vector illustration style, no text

▷ 為什麼更好：「畫一個吉祥物」每次生出來都不同隻；三視圖＋固定色票的定版圖，是之後客戶改稿與 LoRA 訓練的唯一基準。`,
    modelHint: "fal-ai/flux-pro / fal-ai/nano-banana",
    difficulty: "beginner",
    tags: ["接案者", "角色定版", "三視圖", "前後對照"],
    language: "mixed",
    references: [
      { label: "接案者×圖影 上手路徑", href: "/learn?sub=hub&docId=scenario-freelancer-delivery" },
      { label: "LoRA 訓練室", href: "/lora-trainer" },
    ],
  },
  {
    id: "onboard-fl-revision-lock",
    modality: "image-edit",
    title: "【前後對照】客戶改稿不跑風格",
    summary: "明說「角色完全不動、只換背景」＋引用保險庫定版圖，改稿才不會越改越歪。",
    prompt: `弱提示：把背景換成藍色

→ 強提示：
Keep the character (保險庫定版圖) completely unchanged — same face, hair, outfit, accessories and pose. Only replace the background with a soft gradient of brand blue (#2D6CDF to #EAF2FF). Maintain the original lighting direction and overall color grading.

▷ 為什麼更好：只說「換背景」時模型常順手把角色也重畫；明確說「角色完全不動」＋引用定版圖，客戶要的一點點才真的只改一點點。`,
    modelHint: "fal-ai/flux-kontext / fal-ai/gpt-image-1.5",
    difficulty: "beginner",
    tags: ["接案者", "改稿", "一致性", "前後對照"],
    language: "mixed",
    references: [
      { label: "一致性保險庫", href: "/vault" },
      { label: "接案者×圖影 上手路徑", href: "/learn?sub=hub&docId=scenario-freelancer-delivery" },
    ],
  },
  {
    id: "onboard-fl-3drafts",
    modality: "image",
    title: "【前後對照】多稿比稿只換構圖",
    summary: "鎖住角色與色板、只讓構圖變，客戶挑的是構圖，而不是三個不同的角色。",
    prompt: `弱提示：多生幾張給客戶選

→ 強提示：
using the same locked character reference for all drafts — draft A: centered symmetrical composition; draft B: rule-of-thirds with subject on right, negative space on left for text; draft C: dynamic diagonal composition from a low angle. Identical character, palette and lighting across all three drafts.

▷ 為什麼更好：「多生幾張」會連角色一起變，比稿變成比角色；鎖角色只換構圖，A/B/C 三稿才是同一個提案的三種排法。`,
    modelHint: "fal-ai/flux-pro",
    difficulty: "beginner",
    tags: ["接案者", "比稿", "構圖", "前後對照"],
    language: "mixed",
    references: [
      { label: "接案者×圖影 上手路徑", href: "/learn?sub=hub&docId=scenario-freelancer-delivery" },
      { label: "圖片創作室", href: "/image-studio" },
    ],
  },
  {
    id: "onboard-fl-deliver-motion",
    modality: "video",
    title: "【前後對照】交付動態展示稿",
    summary: "指明鏡頭運動＋「五官不得變形」＋引用定版圖，動態交付稿才過得了客戶那關。",
    prompt: `弱提示：把成品做成影片

→ 強提示：
The locked mascot character stays fully consistent with the reference image. Camera slowly orbits 30 degrees around the character over 4 seconds, soft studio lighting unchanged, clean background, smooth 24fps, no cuts, no morphing of facial features.

▷ 為什麼更好：「做成影片」常讓角色在動態中變形走樣；寫死鏡頭運動與「五官不得變形」，動態稿和定版圖才是同一個角色。`,
    modelHint: "fal-ai/kling-2.1-i2v",
    difficulty: "beginner",
    tags: ["接案者", "I2V", "交付", "前後對照"],
    language: "mixed",
    references: [
      { label: "接案者×圖影 上手路徑", href: "/learn?sub=hub&docId=scenario-freelancer-delivery" },
      { label: "影片創作室", href: "/video-studio" },
    ],
  },

  // ─ 情境 E：內容編輯 × 圖文（批量與版本）─
  {
    id: "onboard-ed-tone-rewrite",
    modality: "agent",
    title: "【前後對照】定調性再潤稿",
    summary: "把調性寫成明確規則（聲音、讀者、句長、禁用詞），十篇稿子出來是同一個聲音。",
    prompt: `弱提示：幫我潤稿

→ 強提示：
請依以下調性改寫：品牌聲音＝專業但親切的科技編輯；目標讀者＝30–45 歲產品經理；句長 ≤ 25 字；用「你」不用「您」；禁用詞：賦能、抓手、閉環。改寫後附一句話說明你動了哪裡。

▷ 為什麼更好：「潤稿」沒有標準，AI 只能猜你要什麼；把調性寫成規則後，整個專題的每一篇都是同一把尺量出來的。`,
    difficulty: "beginner",
    tags: ["內容編輯", "調性", "潤稿", "前後對照"],
    language: "zh",
    references: [
      { label: "內容編輯×圖文 上手路徑", href: "/learn?sub=hub&docId=scenario-editor-batch" },
      { label: "提示詞庫", href: "/prompt-library" },
    ],
  },
  {
    id: "onboard-ed-one-to-three",
    modality: "agent",
    title: "【前後對照】一稿改三平台",
    summary: "一次要三版＋鎖同一核心賣點，批量產出還互相對齊，不必逐平台重寫。",
    prompt: `弱提示：改成 IG 版

→ 強提示：
把這段文案一次改寫成三個版本：IG 貼文（150 字內、口語、3 個 hashtag、首句要停住滑動）；FB 貼文（300 字內、可講故事、結尾提問）；電子報導言（120 字、資訊密度高、連到全文）。三版共用同一個核心賣點，調性依前述品牌聲音。

▷ 為什麼更好：逐平台各叫一次 AI，賣點和調性會慢慢漂移；一次要三版並鎖住同一個賣點，三個平台講的才是同一件事。`,
    difficulty: "beginner",
    tags: ["內容編輯", "多平台", "批量", "前後對照"],
    language: "zh",
    references: [
      { label: "內容編輯×圖文 上手路徑", href: "/learn?sub=hub&docId=scenario-editor-batch" },
      { label: "創作工作室", href: "/studio" },
    ],
  },
  {
    id: "onboard-ed-series-style",
    modality: "image",
    title: "【前後對照】系列插圖統一風格",
    summary: "風格段固定、只換 subject 那一句，整個專題的插圖像同一雙手畫的。",
    prompt: `弱提示：幫這篇文章配一張圖

→ 強提示：
editorial illustration series (3 of 8), flat vector style, brand palette only (#1B5E5A deep teal, #F2B441 amber, #FAF6EF cream), consistent 2px line weight, same soft top-left lighting, 4:3 ratio with 10% margin grid — subject of this piece: remote team standup meeting

▷ 為什麼更好：逐張自由發揮，八張像八個插畫家畫的；把風格段固定成模板、每張只換「subject」，系列才有系列感。`,
    modelHint: "fal-ai/flux-pro / fal-ai/imagen4",
    difficulty: "beginner",
    tags: ["內容編輯", "系列插圖", "統一風格", "前後對照"],
    language: "mixed",
    references: [
      { label: "內容編輯×圖文 上手路徑", href: "/learn?sub=hub&docId=scenario-editor-batch" },
      { label: "批次分鏡", href: "/animation" },
    ],
  },
  {
    id: "onboard-ed-ab-review",
    modality: "agent",
    title: "【前後對照】版本比對有依據",
    summary: "給準則和量表，A/B 比對結果才能直接寫進編輯會議紀錄，不是客套話。",
    prompt: `弱提示：這兩版哪個好？

→ 強提示：
請用表格比對 A/B 兩版標題：欄位＝點開動機（1–5）、資訊清楚度（1–5）、品牌調性符合度（1–5）、風險（誇大／歧義）。每格附一句理由，最後給出建議版本與一句修改方向。

▷ 為什麼更好：「哪個好」得到的是客套話；給了準則和量表，比對結果有依據、可留痕，版本才收斂而不是越比越多。`,
    difficulty: "beginner",
    tags: ["內容編輯", "版本比對", "A/B", "前後對照"],
    language: "zh",
    references: [
      { label: "內容編輯×圖文 上手路徑", href: "/learn?sub=hub&docId=scenario-editor-batch" },
      { label: "生成歷史", href: "/history" },
    ],
  },

  // ─ 情境 F：品牌方 × 圖影（品牌一致）─
  {
    id: "onboard-br-vibe-preset",
    modality: "image",
    title: "【前後對照】品牌 preset 寫進提示",
    summary: "把色票、質感、留白比例寫成規範句，這段就是你的品牌 preset，每次生成直接帶上。",
    prompt: `弱提示：做有品牌感的圖

→ 強提示：
brand visual in house style: primary color #0E3A5D navy with #E8C547 gold accents, matte paper texture, generous white space (at least 30%), soft diffused daylight, geometric sans-serif mood, minimal composition, no gradients outside brand palette, no stock-photo look

▷ 為什麼更好：「品牌感」三個字模型無從得知你的品牌；把色票、質感、留白寫成規範句並存成 vibe card，每張圖都從同一套規範出發。`,
    modelHint: "fal-ai/flux-pro",
    difficulty: "beginner",
    tags: ["品牌方", "品牌preset", "vibe cards", "前後對照"],
    language: "mixed",
    references: [
      { label: "品牌方×圖影 上手路徑", href: "/learn?sub=hub&docId=scenario-brand-consistency" },
      { label: "vibe card 精靈", href: "/studio" },
    ],
  },
  {
    id: "onboard-br-keyvisual",
    modality: "image",
    title: "【前後對照】主視覺留好 logo 位",
    summary: "指明留白位置與可裁切性，主視覺生成稿才能直接交給設計師疊字。",
    prompt: `弱提示：做一張活動主視覺

→ 強提示：
campaign key visual for a summer product launch, brand palette (#0E3A5D navy, #E8C547 gold, white), hero product on bottom-right third, clean negative space at top-left reserved for logo and slogan overlay, 16:9 ratio, composition still balanced when cropped to 1:1, no AI-generated text

▷ 為什麼更好：沒留 logo 位的主視覺進不了設計流程；指明留白位置＋裁切相容性，生成稿才是可以直接用的素材而不是參考圖。`,
    modelHint: "fal-ai/flux-pro / fal-ai/imagen4",
    difficulty: "beginner",
    tags: ["品牌方", "主視覺", "留白", "前後對照"],
    language: "mixed",
    references: [
      { label: "品牌方×圖影 上手路徑", href: "/learn?sub=hub&docId=scenario-brand-consistency" },
      { label: "圖片創作室", href: "/image-studio" },
    ],
  },
  {
    id: "onboard-br-derivative-set",
    modality: "image-edit",
    title: "【前後對照】衍生成套不走鐘",
    summary: "說清楚「同一張主視覺重排版、不得加新元素」，整套衍生才是同一個品牌臉。",
    prompt: `弱提示：幫我多做幾個尺寸

→ 強提示：
Derive from the approved key visual (引用保險庫定稿錨點): keep brand palette, lighting and product rendering identical. Re-compose for 9:16 story (product in lower half, logo space on top), 1:1 feed (centered), and 728x90 banner (product right, headline space left). Do not introduce new elements or colors.

▷ 為什麼更好：「多做幾個尺寸」常被模型當成重新創作；寫死「重排版、不加新元素」，衍生素材才張張合品牌規範。`,
    modelHint: "fal-ai/flux-kontext / fal-ai/gpt-image-1.5",
    difficulty: "beginner",
    tags: ["品牌方", "衍生成套", "錨點衍生", "前後對照"],
    language: "mixed",
    references: [
      { label: "一致性保險庫（場景錨點）", href: "/vault" },
      { label: "品牌方×圖影 上手路徑", href: "/learn?sub=hub&docId=scenario-brand-consistency" },
    ],
  },
  {
    id: "onboard-br-motion-rules",
    modality: "video",
    title: "【前後對照】品牌動態守規範",
    summary: "把節奏、調色、結尾 logo 位寫死，品牌動態稿一次過審。",
    prompt: `弱提示：把主視覺做成品牌影片

→ 強提示：
Animate the approved key visual: slow 5-second push-in with gentle parallax between product and background, color grading locked to brand palette (#0E3A5D / #E8C547), calm pacing with no flashy transitions, end frame holds for 1 second with clear logo space at top-left, 24fps.

▷ 為什麼更好：不設動態規範，模型會加彩色轉場毀掉品牌調性；節奏、調色、結尾 logo 位都寫死，審核才有依據、一次通過。`,
    modelHint: "fal-ai/kling-2.1-i2v / fal-ai/veo-3",
    difficulty: "beginner",
    tags: ["品牌方", "品牌影片", "審核", "前後對照"],
    language: "mixed",
    references: [
      { label: "品牌方×圖影 上手路徑", href: "/learn?sub=hub&docId=scenario-brand-consistency" },
      { label: "確認門（導演模式）", href: "/director" },
    ],
  },

  {
    id: "modifier-composition",
    modality: "image",
    title: "📐 構圖片段庫",
    summary: "經典構圖法則的提示詞片段。",
    prompt: `常用構圖片段：

幾何構圖：
- rule of thirds composition, subject on right vertical third
- golden ratio composition, spiral leading to subject
- centered symmetrical composition, formal balance
- triangular composition, three focal points

景深：
- shallow depth of field, subject sharp, background blurred bokeh
- deep depth of field, everything in focus
- foreground silhouette frame, midground subject, background atmosphere

視角：
- bird's eye view (overhead)
- worm's eye view (low looking up)
- eye level (natural perspective)
- over-the-shoulder POV

引導線：
- strong leading lines drawing eye to subject
- vanishing point at center, infinite perspective
- diagonal energy lines, dynamic motion

留白：
- generous negative space on the left for text overlay
- minimal composition, subject occupying 30% of frame
- empty top third for title placement`,
    difficulty: "intermediate",
    tags: ["構圖", "片段", "Composition"],
    language: "en",
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
