/**
 * shared/orb-studio-actions.ts — 創作工作室四模態深度操作目錄
 *
 * 目的：把光球助手在「創作工作室」頁面可以執行的深度操作整理成一份
 *      單一資料來源。OrbGuidePanel 的 Studio 模式、ProactiveOrbWidget
 *      的快速操作、未來的 ai.chat tool prompts 都從這裡取資料，避免
 *      文案、tabId、toolbox key 在多處重複定義。
 *
 * 設計原則：
 *   - 純資料 + 純函式，無 React / DOM，可直接被 vitest / 後端 import。
 *   - 只描述「光球可以代為 dispatch 的 AgentAction[]」，不直接執行；
 *     真正的執行交給 PageAgentContext.dispatchMany。
 *   - 與 Studio.tsx 的 useRegisterPageAgent capabilities 保持對齊，
 *     新增能力時兩邊一起改，避免光球宣稱會做但 handler 不接的情況。
 */

import type { AgentAction, AgentModality } from "./agent-actions";

// ─── Toolbox 工具箱分頁 ─────────────────────────────────────────────────────

export type StudioToolboxTab =
  | "vault"     // 一致性保險庫（角色 / 場景）
  | "assets"    // 數位資產
  | "models"    // 模型挑選（含 LoRA / FAL）
  | "history"   // 歷史紀錄
  | "controls"; // 進階參數控制

export interface StudioToolboxEntry {
  tab: StudioToolboxTab;
  label: string;
  emoji: string;
  description: string;
}

export const STUDIO_TOOLBOX_ENTRIES: StudioToolboxEntry[] = [
  {
    tab: "models",
    label: "模型挑選",
    emoji: "🧠",
    description: "切換 Fal 模型或套用 LoRA 微調模型",
  },
  {
    tab: "controls",
    label: "進階控制",
    emoji: "🎚",
    description: "溫度 / 種子 / LoRA 權重 / 生成模式",
  },
  {
    tab: "vault",
    label: "一致性保險庫",
    emoji: "🛡",
    description: "角色 / 場景一致性綁定",
  },
  {
    tab: "assets",
    label: "數位資產",
    emoji: "📦",
    description: "翻過去用過的素材，當參考或起手式",
  },
  {
    tab: "history",
    label: "歷史紀錄",
    emoji: "🕰",
    description: "看以前生成過的作品，重組或 fork",
  },
];

export function buildToolboxOpenAction(
  tab: StudioToolboxTab
): AgentAction {
  return {
    type: "openDialog",
    dialogId: "toolbox",
    params: { tab },
  };
}

// ─── 四模態深度操作 ────────────────────────────────────────────────────────

export interface StudioModalityDeepAction {
  /** 在 panel 上顯示的標題 */
  label: string;
  /** 補充說明 */
  description: string;
  /** emoji icon */
  emoji: string;
  /** 點擊後要 dispatch 的 AgentAction 列表（會用 dispatchMany 依序執行） */
  buildActions: () => AgentAction[];
}

export interface StudioModalityProfile {
  modality: AgentModality;
  label: string;
  emoji: string;
  /** 預設適用的 FAL category，給 /api/tools/models 端點用 */
  falToolsCategory: "image" | "video" | "audio";
  /** 切到此模態後可繼續做的深度操作 */
  deepActions: StudioModalityDeepAction[];
}

const switchTo = (modality: AgentModality): AgentAction => ({
  type: "setModality",
  modality,
});

export const STUDIO_MODALITY_PROFILES: StudioModalityProfile[] = [
  {
    modality: "image",
    label: "生成圖像",
    emoji: "🖼",
    falToolsCategory: "image",
    deepActions: [
      {
        label: "選圖像模型",
        description: "從 Fal 圖像模型中挑一個 — Flux / SDXL / Imagen…",
        emoji: "🧠",
        buildActions: () => [
          switchTo("image"),
          buildToolboxOpenAction("models"),
        ],
      },
      {
        label: "鎖定畫面比例",
        description: "讓我問你想要 1:1 / 9:16 / 16:9，再幫你套用",
        emoji: "📐",
        buildActions: () => [
          switchTo("image"),
          buildToolboxOpenAction("controls"),
        ],
      },
      {
        label: "綁定角色一致性",
        description: "從一致性保險庫挑一個角色，讓多張圖人物穩定",
        emoji: "🛡",
        buildActions: () => [
          switchTo("image"),
          buildToolboxOpenAction("vault"),
        ],
      },
    ],
  },
  {
    modality: "video",
    label: "生成影片",
    emoji: "🎬",
    falToolsCategory: "video",
    deepActions: [
      {
        label: "選影片模型",
        description: "Kling / Veo / Runway / Luma — 看任務挑速度或畫質",
        emoji: "🧠",
        buildActions: () => [
          switchTo("video"),
          buildToolboxOpenAction("models"),
        ],
      },
      {
        label: "設定鏡頭運動",
        description: "進階控制裡微調 pan / zoom / tilt",
        emoji: "🎥",
        buildActions: () => [
          switchTo("video"),
          buildToolboxOpenAction("controls"),
        ],
      },
      {
        label: "從歷史挑一張當首格",
        description: "翻歷史紀錄，找一張圖延伸成影片",
        emoji: "🕰",
        buildActions: () => [
          switchTo("video"),
          buildToolboxOpenAction("history"),
        ],
      },
    ],
  },
  {
    modality: "audio",
    label: "生成音樂",
    emoji: "🎵",
    falToolsCategory: "audio",
    deepActions: [
      {
        label: "選音樂模型",
        description: "Sonauto / Stable Audio / Suno — 看風格與長度挑",
        emoji: "🧠",
        buildActions: () => [
          switchTo("audio"),
          buildToolboxOpenAction("models"),
        ],
      },
      {
        label: "設定風格與情緒",
        description: "用進階控制把 musicStyle / energy / 時長一次調好",
        emoji: "🎚",
        buildActions: () => [
          switchTo("audio"),
          buildToolboxOpenAction("controls"),
        ],
      },
      {
        label: "從資產拉素材參考",
        description: "翻數位資產，找一段曾經喜歡的片段當參考",
        emoji: "📦",
        buildActions: () => [
          switchTo("audio"),
          buildToolboxOpenAction("assets"),
        ],
      },
    ],
  },
  {
    modality: "voice",
    label: "配音 / 語音",
    emoji: "🎤",
    falToolsCategory: "audio",
    deepActions: [
      {
        label: "選語音模型",
        description: "ElevenLabs / Qwen3 TTS / Dia — 看用途挑配音引擎",
        emoji: "🧠",
        buildActions: () => [
          switchTo("voice"),
          buildToolboxOpenAction("models"),
        ],
      },
      {
        label: "挑語音角色與情緒",
        description: "進階控制裡選角色、語速、情緒強度",
        emoji: "🎭",
        buildActions: () => [
          switchTo("voice"),
          buildToolboxOpenAction("controls"),
        ],
      },
      {
        label: "上傳參考音複製音色",
        description: "翻資產或上傳一段參考音，做 voice clone",
        emoji: "📦",
        buildActions: () => [
          switchTo("voice"),
          buildToolboxOpenAction("assets"),
        ],
      },
    ],
  },
];

export function getStudioModalityProfile(
  modality: AgentModality
): StudioModalityProfile | undefined {
  return STUDIO_MODALITY_PROFILES.find(p => p.modality === modality);
}

// ─── 跨頁協作：導演 AI / 全站光球 / API 深度連結 ────────────────────────

export interface StudioCollaborationLink {
  id: string;
  label: string;
  emoji: string;
  description: string;
  /**
   * 點擊後要送進「自由聊天」（GlobalOrbChatContext.sendMessage）的提示文字。
   * 後端 ai.chat router 會把它路由到對應的工具 / 導演 AI / 模型推薦。
   */
  chatPrompt: string;
}

export const STUDIO_COLLABORATION_LINKS: StudioCollaborationLink[] = [
  {
    id: "recommend-model",
    label: "幫我選模型",
    emoji: "🧭",
    description: "依目前提示詞與模態，從 Fal 模型庫挑一個最合的",
    chatPrompt:
      "依我目前在創作工作室的模態與提示詞，從 Fal 模型庫推薦一個最合適的模型，告訴我為什麼，並用 [ACTION:setModel:...] 幫我直接套用。",
  },
  {
    id: "director-handoff",
    label: "交給導演 AI",
    emoji: "🎬",
    description: "把目前提示詞送到導演 AI 寫成完整腳本與分鏡",
    chatPrompt:
      "把我現在的創作想法整理成一份導演 AI 可以接手的腳本與分鏡需求，然後帶我去 /director 繼續展開。",
  },
  {
    id: "api-deep-link",
    label: "API 深度連結",
    emoji: "🔗",
    description: "把目前參數打包成可分享的 /process spec 連結",
    chatPrompt:
      "把我目前的提示詞、模態、模型與所有參數，打包成一份 /process spec 連結並複製到剪貼簿，方便分享或留底。",
  },
  {
    id: "site-orb-collab",
    label: "全站光球協作",
    emoji: "🌐",
    description: "讓全站光球代理把這個任務丟到背景批次處理",
    chatPrompt:
      "把我目前的生成任務交給全站光球代理用背景排程跑，完成後在通知中心提醒我。",
  },
];

export function getStudioCollaborationLink(
  id: string
): StudioCollaborationLink | undefined {
  return STUDIO_COLLABORATION_LINKS.find(l => l.id === id);
}

// ─── 圖片創作室 / 文字生圖（Image Studio T2I）深度操作 ───────────────────
//
// ImageStudio.tsx 的 useRegisterPageAgent 已經宣告了 setTab / setModel /
// fillPrompt / applyPreset / setParam / submit 等能力；這裡只是把光球面板
// 點擊時要 dispatch 的 AgentAction[] 包成資料。新增 T2I 模型 / 氛圍 / 提示詞
// 模板時直接改這裡，OrbGuidePanel 與 vitest 都會自動跟上。

export interface ImageStudioModelOption {
  id: string;
  label: string;
  emoji: string;
  description: string;
}

/** 與 ImageStudio.tsx 的 MODELS array 中 category="t2i" 的四個模型對齊 */
export const IMAGE_STUDIO_T2I_MODELS: ImageStudioModelOption[] = [
  {
    id: "nanoBanana2",
    label: "Nano Banana 2",
    emoji: "🍌",
    description: "快速生成 / 14 圖參考 / 推薦起手",
  },
  {
    id: "nanoBananaPro",
    label: "Nano Banana Pro",
    emoji: "💎",
    description: "最高品質 / 商業授權 / 適合定稿",
  },
  {
    id: "seedreamV4",
    label: "SeeDream v4",
    emoji: "🀄",
    description: "中文提示詞最強 / 東方美學",
  },
  {
    id: "imagen4",
    label: "Imagen 4",
    emoji: "📸",
    description: "Google • 寫實感最強 / 人像風景",
  },
];

export function buildImageStudioSetModelActions(
  modelId: string
): AgentAction[] {
  // setTab=t2i 確保切到文字生圖分頁，再切模型；ImageStudio 也會自動把 tab 對齊
  // 模型 category，這裡仍顯式宣告以避免使用者目前在 edit/sd 等分頁時誤套。
  return [
    { type: "setTab", tabId: "t2i" },
    { type: "setModel", modelId },
  ];
}

export interface ImageStudioVibeOption {
  id: string;
  label: string;
  emoji: string;
}

/** 與 ImageStudio.tsx 的 VIBE_CARDS 對齊；orb 點一下就 applyPreset */
export const IMAGE_STUDIO_VIBE_CARDS: ImageStudioVibeOption[] = [
  { id: "cinematic", label: "電影感", emoji: "🎬" },
  { id: "dreamy", label: "夢幻", emoji: "✨" },
  { id: "minimal", label: "極簡", emoji: "⬜" },
  { id: "dark", label: "暗黑", emoji: "🖤" },
  { id: "anime", label: "動漫風", emoji: "🌸" },
  { id: "photo", label: "寫實攝影", emoji: "📷" },
  { id: "watercolor", label: "水彩畫", emoji: "🎨" },
  { id: "vintage", label: "復古", emoji: "📸" },
];

export function buildImageStudioApplyVibeActions(
  vibeId: string
): AgentAction[] {
  return [
    { type: "setTab", tabId: "t2i" },
    { type: "applyPreset", presetId: vibeId },
  ];
}

export interface ImageStudioPromptTemplate {
  id: string;
  label: string;
  emoji: string;
  text: string;
}

/** 提示詞模板：與 ImageStudio.tsx 的 PROMPT_TEMPLATES 對齊 */
export const IMAGE_STUDIO_PROMPT_TEMPLATES: ImageStudioPromptTemplate[] = [
  {
    id: "landscape-golden-hour",
    label: "自然風光",
    emoji: "🌅",
    text:
      "A breathtaking landscape at golden hour, dramatic sky with warm orange and pink clouds, mountain peaks reflecting in a still lake",
  },
  {
    id: "portrait-natural",
    label: "人物肖像",
    emoji: "👤",
    text:
      "Professional portrait photography, natural light, soft bokeh background, sharp focus on face, editorial style",
  },
  {
    id: "cyberpunk-night",
    label: "城市夜景",
    emoji: "🏙️",
    text:
      "Cyberpunk cityscape at night, neon lights reflecting on wet streets, futuristic architecture, cinematic atmosphere",
  },
  {
    id: "abstract-art",
    label: "抽象藝術",
    emoji: "🎨",
    text:
      "Abstract digital art, vibrant color palette, geometric shapes, flowing lines, modern aesthetic, high contrast",
  },
  {
    id: "japanese-spring",
    label: "日系清新",
    emoji: "🌸",
    text:
      "Japanese spring scene, cherry blossoms, soft natural light, pastel colors, tranquil atmosphere, film photography style",
  },
  {
    id: "fantasy-epic",
    label: "奇幻場景",
    emoji: "🔮",
    text:
      "Epic fantasy landscape, magical floating islands, ancient ruins, ethereal glowing lights, detailed illustration",
  },
];

export function buildImageStudioFillPromptActions(
  text: string,
  append = false
): AgentAction[] {
  return [
    { type: "setTab", tabId: "t2i" },
    { type: "fillPrompt", text, append },
  ];
}

export interface ImageStudioAspectOption {
  id: string;
  label: string;
}

/** 文字生圖支援的畫面比例（對齊 ImageStudio.tsx 的 t2i 比例選單） */
export const IMAGE_STUDIO_T2I_ASPECT_RATIOS: ImageStudioAspectOption[] = [
  { id: "1:1", label: "1:1" },
  { id: "16:9", label: "16:9" },
  { id: "9:16", label: "9:16" },
  { id: "4:3", label: "4:3" },
  { id: "3:4", label: "3:4" },
  { id: "3:2", label: "3:2" },
  { id: "2:3", label: "2:3" },
  { id: "auto", label: "自動" },
];

export function buildImageStudioSetAspectRatioActions(
  ratio: string
): AgentAction[] {
  return [
    { type: "setTab", tabId: "t2i" },
    { type: "setParam", key: "aspectRatio", value: ratio },
  ];
}

/**
 * 跨分頁 / 跨頁協作快捷：把使用者目前的 T2I 想法接力到其他能力。
 * label / chatPrompt 會由 OrbGuidePanel 顯示與送進 GlobalOrbChat。
 */
export const IMAGE_STUDIO_T2I_COLLABORATION_LINKS: StudioCollaborationLink[] = [
  {
    id: "t2i-prompt-coach",
    label: "幫我寫提示詞",
    emoji: "✍️",
    description: "依我目前的想法擴寫成完整 T2I 提示詞，並用 fillPrompt 套用",
    chatPrompt:
      "我在圖片創作室文字生圖。請依我現在的提示詞與當前模型，擴寫成完整的英文 prompt（主體 + 環境 + 光線 + 風格 + 品質），並用 [ACTION:fillPrompt:...] 直接幫我覆寫。",
  },
  {
    id: "t2i-recommend-model",
    label: "幫我選 T2I 模型",
    emoji: "🧭",
    description: "依提示詞特性推薦 nanoBanana2 / Pro / SeeDream v4 / Imagen4",
    chatPrompt:
      "我在文字生圖。請依我目前提示詞推薦 4 個 T2I 模型中最合的一個（nanoBanana2 / nanoBananaPro / seedreamV4 / imagen4），說明原因，並用 [ACTION:setModel:...] 幫我直接套用。",
  },
  {
    id: "t2i-handoff-edit",
    label: "送去圖片編輯",
    emoji: "✂️",
    description: "拿生出來的圖到 edit 分頁做局部修改",
    chatPrompt:
      "把目前文字生圖的成品作為輸入，帶我去 edit 分頁，並建議一個適合的編輯模型與遮罩策略。",
  },
  {
    id: "t2i-director-storyboard",
    label: "交給導演 AI 變分鏡",
    emoji: "🎬",
    description: "把這張圖延伸成故事 / 分鏡腳本",
    chatPrompt:
      "把我目前文字生圖的提示詞延伸成一份 6 鏡分鏡腳本，導演 AI 接手後可以直接用。完成後帶我去 /director。",
  },
];

export interface ImageStudioT2IProfile {
  pageId: "image-studio";
  pagePath: "/image-studio";
  models: ImageStudioModelOption[];
  vibes: ImageStudioVibeOption[];
  templates: ImageStudioPromptTemplate[];
  aspectRatios: ImageStudioAspectOption[];
  collaborations: StudioCollaborationLink[];
}

export const IMAGE_STUDIO_T2I_PROFILE: ImageStudioT2IProfile = {
  pageId: "image-studio",
  pagePath: "/image-studio",
  models: IMAGE_STUDIO_T2I_MODELS,
  vibes: IMAGE_STUDIO_VIBE_CARDS,
  templates: IMAGE_STUDIO_PROMPT_TEMPLATES,
  aspectRatios: IMAGE_STUDIO_T2I_ASPECT_RATIOS,
  collaborations: IMAGE_STUDIO_T2I_COLLABORATION_LINKS,
};

// ─── 圖片創作室 / 圖片編輯（Image Studio Edit）深度操作 ─────────────────
//
// 與 ImageStudio.tsx 的 MODELS array 中 category="edit" 的九個模型對齊。
// 不同模型支援的能力（多圖參考 / 強度 / 負向 / 遮罩 / 引導 / 輸出尺寸）會
// 在面板上顯示為徽章，方便使用者依需求挑模型，避免送出後才發現不支援。

export type ImageStudioEditCapability =
  | "multiRef"
  | "strength"
  | "neg"
  | "mask"
  | "guidance"
  | "size";

export interface ImageStudioEditModelOption {
  id: string;
  label: string;
  emoji: string;
  description: string;
  capabilities: ImageStudioEditCapability[];
  fast?: boolean;
}

export const IMAGE_STUDIO_EDIT_MODELS: ImageStudioEditModelOption[] = [
  {
    id: "nanoBananaProEdit",
    label: "Nano Banana Pro Edit",
    emoji: "💎",
    description: "Gemini 3 Pro 語意式編輯，14 圖融合，定稿首選",
    capabilities: ["multiRef"],
  },
  {
    id: "nanoBananaEdit",
    label: "Nano Banana Edit",
    emoji: "🍌",
    description: "Gemini 2.0 Flash，速度最快，多圖融合",
    capabilities: ["multiRef"],
    fast: true,
  },
  {
    id: "nanoBanana2Edit",
    label: "Nano Banana 2 Edit",
    emoji: "🍌",
    description: "Gemini 3.1 Flash，0.5K-4K 多圖融合",
    capabilities: ["multiRef"],
    fast: true,
  },
  {
    id: "seedreamV45Edit",
    label: "SeeDream v4.5 Edit",
    emoji: "🀄",
    description: "ByteDance 高品質語意編輯，可調強度與負向詞",
    capabilities: ["strength", "neg"],
  },
  {
    id: "seedreamV5LiteEdit",
    label: "SeeDream v5 Lite",
    emoji: "🀄",
    description: "BD v5 Lite，輕量快速編輯，可調強度",
    capabilities: ["strength", "neg"],
    fast: true,
  },
  {
    id: "grokEdit",
    label: "Grok Imagine Edit",
    emoji: "🪄",
    description: "xAI Grok 原生多模態，語意精確",
    capabilities: [],
  },
  {
    id: "gptImage15Edit",
    label: "GPT Image 1.5 Edit",
    emoji: "🎯",
    description: "OpenAI，遮罩編輯首選，頂尖語意",
    capabilities: ["mask", "size"],
  },
  {
    id: "fluxKontext",
    label: "FLUX Kontext Pro",
    emoji: "🧪",
    description: "BFL，精準局部修改，可調引導強度",
    capabilities: ["guidance"],
  },
  {
    id: "flux2ProEdit",
    label: "FLUX 2 Pro Edit",
    emoji: "🔬",
    description: "BFL Flux2 Pro，高真實感、多圖融合",
    capabilities: ["multiRef"],
  },
];

export const IMAGE_STUDIO_EDIT_CAPABILITY_LABELS: Record<
  ImageStudioEditCapability,
  string
> = {
  multiRef: "多圖融合",
  strength: "改動強度",
  neg: "負向詞",
  mask: "遮罩",
  guidance: "引導值",
  size: "輸出尺寸",
};

export function buildImageStudioEditSetModelActions(
  modelId: string
): AgentAction[] {
  return [
    { type: "setTab", tabId: "edit" },
    { type: "setModel", modelId },
  ];
}

/** 圖片編輯常見任務模板：點擊後填到主提示詞 */
export interface ImageStudioEditTemplate {
  id: string;
  label: string;
  emoji: string;
  text: string;
  /** 建議搭配的模型（顯示在卡片上，不強制） */
  suggestedModelId?: string;
}

export const IMAGE_STUDIO_EDIT_TEMPLATES: ImageStudioEditTemplate[] = [
  {
    id: "edit-remove-bg",
    label: "去背景",
    emoji: "🪄",
    text:
      "Remove the background completely, keep only the main subject with clean cutout edges, transparent background.",
    suggestedModelId: "gptImage15Edit",
  },
  {
    id: "edit-replace-bg",
    label: "換背景",
    emoji: "🌅",
    text:
      "Replace the background with a soft blurred natural scene while preserving the subject's lighting and edges.",
    suggestedModelId: "nanoBananaProEdit",
  },
  {
    id: "edit-add-text",
    label: "加文字",
    emoji: "🔤",
    text:
      "Add the text \"[YOUR TEXT]\" to the top-right corner with a clean modern sans-serif typeface, white with subtle shadow.",
    suggestedModelId: "nanoBananaProEdit",
  },
  {
    id: "edit-remove-element",
    label: "移除元素",
    emoji: "🧹",
    text:
      "Remove the [object/person] from the image and seamlessly fill in the background as if it was never there.",
    suggestedModelId: "fluxKontext",
  },
  {
    id: "edit-touchup",
    label: "修飾美化",
    emoji: "✨",
    text:
      "Professional retouching: even out the lighting, enhance the details, smooth the skin naturally, keep the original style.",
    suggestedModelId: "seedreamV45Edit",
  },
  {
    id: "edit-style-transfer",
    label: "風格轉換",
    emoji: "🎨",
    text:
      "Transform the image into watercolor painting style while keeping the subject and composition intact.",
    suggestedModelId: "seedreamV45Edit",
  },
  {
    id: "edit-outpaint",
    label: "擴圖延伸",
    emoji: "🖼",
    text:
      "Extend the canvas outward, intelligently filling the new area to match the existing scene and lighting.",
    suggestedModelId: "fluxKontext",
  },
  {
    id: "edit-merge-refs",
    label: "多圖融合",
    emoji: "🧬",
    text:
      "Combine the reference images into one coherent scene: subject from image 1, environment from image 2, lighting from image 3.",
    suggestedModelId: "nanoBananaProEdit",
  },
];

export function buildImageStudioEditFillPromptActions(
  text: string,
  append = false
): AgentAction[] {
  return [
    { type: "setTab", tabId: "edit" },
    { type: "fillPrompt", text, append },
  ];
}

/** 改動強度快選（給支援 strength 的模型用） */
export const IMAGE_STUDIO_EDIT_STRENGTH_PRESETS: Array<{
  id: string;
  label: string;
  description: string;
  value: number;
}> = [
  { id: "subtle", label: "微調 0.3", description: "幾乎保留原圖", value: 0.3 },
  { id: "moderate", label: "中改 0.5", description: "平衡保留與改動", value: 0.5 },
  { id: "strong", label: "重改 0.7", description: "明顯重繪", value: 0.7 },
  { id: "extreme", label: "重塑 0.9", description: "大幅改變原圖", value: 0.9 },
];

export function buildImageStudioEditSetStrengthActions(
  value: number
): AgentAction[] {
  return [
    { type: "setTab", tabId: "edit" },
    { type: "setParam", key: "strength", value },
  ];
}

/** 輸出尺寸快選（給支援 size 的模型，例如 GPT Image 1.5 Edit） */
export const IMAGE_STUDIO_EDIT_OUTPUT_SIZES: Array<{
  id: string;
  label: string;
}> = [
  { id: "auto", label: "自動" },
  { id: "1024x1024", label: "1024² 正方形" },
  { id: "1536x1024", label: "1536×1024 橫式" },
  { id: "1024x1536", label: "1024×1536 直式" },
];

export function buildImageStudioEditSetOutputSizeActions(
  size: string
): AgentAction[] {
  return [
    { type: "setTab", tabId: "edit" },
    { type: "setParam", key: "outputSize", value: size },
  ];
}

export const IMAGE_STUDIO_EDIT_COLLABORATION_LINKS: StudioCollaborationLink[] = [
  {
    id: "edit-prompt-coach",
    label: "幫我寫編輯指令",
    emoji: "✍️",
    description: "把模糊想法擴寫成精準的英文編輯指令並 fillPrompt",
    chatPrompt:
      "我在圖片編輯頁。請依我目前的提示詞與參考圖，擴寫成精準的英文編輯指令（明確指出要改什麼、要保留什麼），並用 [ACTION:fillPrompt:...] 直接幫我覆寫。",
  },
  {
    id: "edit-recommend-model",
    label: "幫我選 Edit 模型",
    emoji: "🧭",
    description: "依任務性質推薦最合適的 9 個編輯模型之一",
    chatPrompt:
      "我在圖片編輯頁。請依我的編輯需求（多圖融合 / 局部遮罩 / 風格轉換 / 重繪強度），從 9 個 edit 模型中推薦一個最合的，說明原因，並用 [ACTION:setModel:...] 幫我直接套用。",
  },
  {
    id: "edit-from-t2i",
    label: "回 t2i 重生圖",
    emoji: "🔁",
    description: "覺得原圖不夠好？回 t2i 重新生一張再來編輯",
    chatPrompt:
      "把我目前在編輯的圖當作不夠好，帶我回 t2i 分頁，依我的編輯指令反推出更精準的生成提示詞並 fillPrompt。",
  },
  {
    id: "edit-director-flow",
    label: "交給導演 AI 規劃流程",
    emoji: "🎬",
    description: "把多步編輯（去背→換背→加文字…）交給導演 AI 排好順序",
    chatPrompt:
      "我有一連串編輯需求（例如：先去背、再換背景、再加文字）。請把我的需求拆成 3-5 步可執行的 edit 工作流（每步指定模型 + 提示詞），完成後帶我去 /director 繼續展開。",
  },
];

export interface ImageStudioEditProfile {
  pageId: "image-studio";
  pagePath: "/image-studio";
  activeTab: "edit";
  models: ImageStudioEditModelOption[];
  templates: ImageStudioEditTemplate[];
  strengthPresets: typeof IMAGE_STUDIO_EDIT_STRENGTH_PRESETS;
  outputSizes: typeof IMAGE_STUDIO_EDIT_OUTPUT_SIZES;
  collaborations: StudioCollaborationLink[];
}

export const IMAGE_STUDIO_EDIT_PROFILE: ImageStudioEditProfile = {
  pageId: "image-studio",
  pagePath: "/image-studio",
  activeTab: "edit",
  models: IMAGE_STUDIO_EDIT_MODELS,
  templates: IMAGE_STUDIO_EDIT_TEMPLATES,
  strengthPresets: IMAGE_STUDIO_EDIT_STRENGTH_PRESETS,
  outputSizes: IMAGE_STUDIO_EDIT_OUTPUT_SIZES,
  collaborations: IMAGE_STUDIO_EDIT_COLLABORATION_LINKS,
};

// ─── 圖片創作室 / 影像放大（Image Studio Upscale） ───────────────────────

export interface ImageStudioUpscaleModeOption {
  id: "factor" | "target";
  label: string;
  description: string;
}

export const IMAGE_STUDIO_UPSCALE_MODES: ImageStudioUpscaleModeOption[] = [
  { id: "factor", label: "倍率放大", description: "依 ×2 / ×4 等倍數放大" },
  { id: "target", label: "目標解析度", description: "指定到目標長寬" },
];

export const IMAGE_STUDIO_UPSCALE_FACTORS: Array<{
  id: string;
  label: string;
  value: number;
}> = [
  { id: "x2", label: "×2", value: 2 },
  { id: "x4", label: "×4", value: 4 },
];

export interface ImageStudioUpscaleModelOption {
  id: string;
  label: string;
  emoji: string;
  description: string;
}

export const IMAGE_STUDIO_UPSCALE_MODELS: ImageStudioUpscaleModelOption[] = [
  {
    id: "seedVRUpscale",
    label: "SeedVR Upscale",
    emoji: "🔍",
    description: "ByteDance SeedVR，720p → 2160p，畫質保留好",
  },
];

export function buildImageStudioUpscaleSetModelActions(
  modelId: string
): AgentAction[] {
  return [
    { type: "setTab", tabId: "upscale" },
    { type: "setModel", modelId },
  ];
}

export function buildImageStudioUpscaleSetModeActions(
  mode: "factor" | "target"
): AgentAction[] {
  return [
    { type: "setTab", tabId: "upscale" },
    { type: "setParam", key: "upscaleMode", value: mode },
  ];
}

export function buildImageStudioUpscaleSetFactorActions(
  factor: number
): AgentAction[] {
  return [
    { type: "setTab", tabId: "upscale" },
    { type: "setParam", key: "upscaleMode", value: "factor" },
    { type: "setParam", key: "upscaleFactor", value: factor },
  ];
}

export const IMAGE_STUDIO_UPSCALE_COLLABORATION_LINKS: StudioCollaborationLink[] = [
  {
    id: "upscale-recommend-factor",
    label: "幫我選放大倍率",
    emoji: "🧭",
    description: "依原圖解析度與用途推薦 ×2 或 ×4",
    chatPrompt:
      "我在影像放大頁。請依我目前上傳圖片的解析度與用途，推薦 ×2 或 ×4 比較合適，並用 [ACTION:setParam:upscaleFactor=...] 幫我直接套用。",
  },
  {
    id: "upscale-after-t2i",
    label: "從 t2i 接過來放大",
    emoji: "🔁",
    description: "把剛才生成的圖直接帶到放大頁",
    chatPrompt:
      "把我剛才在 t2i 分頁生成的最後一張圖當作要放大的素材，自動帶我到 upscale 分頁並設好倍率。",
  },
  {
    id: "upscale-after-edit",
    label: "從 edit 接過來放大",
    emoji: "✂️",
    description: "把剛剛編輯完的成品直接帶到放大頁",
    chatPrompt:
      "把我剛才在 edit 分頁編輯完成的圖直接帶到 upscale 分頁，建議一個合適的倍率並準備送出。",
  },
  {
    id: "upscale-batch-flow",
    label: "交給導演 AI 批次放大",
    emoji: "🎬",
    description: "把多張圖整成批次放大流程",
    chatPrompt:
      "我有多張圖要放大。請把我目前資產庫裡最近 N 張圖整成一個批次放大工作流，導演 AI 接手後可以排程跑。",
  },
];

export interface ImageStudioUpscaleProfile {
  pageId: "image-studio";
  pagePath: "/image-studio";
  activeTab: "upscale";
  models: ImageStudioUpscaleModelOption[];
  modes: ImageStudioUpscaleModeOption[];
  factors: typeof IMAGE_STUDIO_UPSCALE_FACTORS;
  collaborations: StudioCollaborationLink[];
}

export const IMAGE_STUDIO_UPSCALE_PROFILE: ImageStudioUpscaleProfile = {
  pageId: "image-studio",
  pagePath: "/image-studio",
  activeTab: "upscale",
  models: IMAGE_STUDIO_UPSCALE_MODELS,
  modes: IMAGE_STUDIO_UPSCALE_MODES,
  factors: IMAGE_STUDIO_UPSCALE_FACTORS,
  collaborations: IMAGE_STUDIO_UPSCALE_COLLABORATION_LINKS,
};

// ─── 圖片創作室 / 骨骼姿勢（Image Studio Pose） ─────────────────────────

export interface ImageStudioPoseModeOption {
  id: string;
  label: string;
  emoji: string;
  /**
   * ImageStudio.tsx 的 setParam drawMode 目前只在 allow-list 接受 4 個基本姿勢
   * （full-pose / body-pose / face-pose / hand-pose）。Mask 變體（face-hand-mask /
   * face-mask / hand-mask）使用者可以在 UI 上點，但光球用 setParam 過去會被退回。
   * 修復：把 allow-list 同步擴成 7 個（已在 ImageStudio.tsx 修正）。
   */
  acceptedBySetParam: boolean;
}

export const IMAGE_STUDIO_POSE_MODES: ImageStudioPoseModeOption[] = [
  { id: "full-pose", label: "完整姿勢", emoji: "🧍", acceptedBySetParam: true },
  { id: "body-pose", label: "身體", emoji: "💪", acceptedBySetParam: true },
  { id: "face-pose", label: "臉部", emoji: "😊", acceptedBySetParam: true },
  { id: "hand-pose", label: "手部", emoji: "✋", acceptedBySetParam: true },
  { id: "face-hand-mask", label: "臉+手遮罩", emoji: "🎭", acceptedBySetParam: true },
  { id: "face-mask", label: "臉遮罩", emoji: "😷", acceptedBySetParam: true },
  { id: "hand-mask", label: "手遮罩", emoji: "🤚", acceptedBySetParam: true },
];

export interface ImageStudioPoseModelOption {
  id: string;
  label: string;
  emoji: string;
  description: string;
}

export const IMAGE_STUDIO_POSE_MODELS: ImageStudioPoseModelOption[] = [
  {
    id: "dwPose",
    label: "DWPose 骨骼偵測",
    emoji: "🦴",
    description: "Mediapipe DWPose，全身/臉部/手部 7 種偵測模式",
  },
];

export function buildImageStudioPoseSetModelActions(
  modelId: string
): AgentAction[] {
  return [
    { type: "setTab", tabId: "pose" },
    { type: "setModel", modelId },
  ];
}

export function buildImageStudioPoseSetDrawModeActions(
  mode: string
): AgentAction[] {
  return [
    { type: "setTab", tabId: "pose" },
    { type: "setParam", key: "drawMode", value: mode },
  ];
}

export const IMAGE_STUDIO_POSE_COLLABORATION_LINKS: StudioCollaborationLink[] = [
  {
    id: "pose-recommend-mode",
    label: "幫我選偵測模式",
    emoji: "🧭",
    description: "依用途（人物動作 / 表情 / 手勢）推薦最合的偵測模式",
    chatPrompt:
      "我在骨骼姿勢頁。請依我的用途（人物動作參考 / 表情捕捉 / 手部姿勢…）推薦 7 個 drawMode 中最合的一個，說明原因，並用 [ACTION:setParam:drawMode=...] 直接幫我套用。",
  },
  {
    id: "pose-feed-controlnet",
    label: "送骨骼圖到 SD ControlNet",
    emoji: "🧬",
    description: "把產生的骨骼圖當 ControlNet 條件，回 SD 分頁生圖",
    chatPrompt:
      "把我這次抓到的骨骼圖當作 ControlNet 條件，帶我到 sd 分頁，自動幫我設定 controlnet 並推薦一個合適的 SD 模型。",
  },
  {
    id: "pose-feed-t2i-edit",
    label: "把姿勢套到 t2i / edit",
    emoji: "🎯",
    description: "把骨骼姿勢當參考，回 t2i 或 edit 生新角色",
    chatPrompt:
      "把這次的骨骼姿勢圖當作姿勢參考，帶我回 t2i 或 edit 分頁，建議用哪個模型可以最穩定地套用該姿勢。",
  },
  {
    id: "pose-director-flow",
    label: "交給導演 AI 規劃多角色姿勢",
    emoji: "🎬",
    description: "把姿勢應用到一段分鏡的多個角色上",
    chatPrompt:
      "我有一段分鏡需要不同角色擺出不同姿勢。請依目前的骨骼姿勢圖規劃一個 3-5 步的姿勢套用流程，每步指定模型 + 動作 + 提示詞，完成後帶我去 /director。",
  },
];

export interface ImageStudioPoseProfile {
  pageId: "image-studio";
  pagePath: "/image-studio";
  activeTab: "pose";
  models: ImageStudioPoseModelOption[];
  modes: ImageStudioPoseModeOption[];
  collaborations: StudioCollaborationLink[];
}

export const IMAGE_STUDIO_POSE_PROFILE: ImageStudioPoseProfile = {
  pageId: "image-studio",
  pagePath: "/image-studio",
  activeTab: "pose",
  models: IMAGE_STUDIO_POSE_MODELS,
  modes: IMAGE_STUDIO_POSE_MODES,
  collaborations: IMAGE_STUDIO_POSE_COLLABORATION_LINKS,
};

// ─── 圖片創作室 / Stable Diffusion ─────────────────────────────────────

export type ImageStudioSDCapability =
  | "neg"
  | "guidance"
  | "lora"
  | "controlnet";

export interface ImageStudioSDModelOption {
  id: string;
  label: string;
  emoji: string;
  description: string;
  capabilities: ImageStudioSDCapability[];
  fast?: boolean;
}

export const IMAGE_STUDIO_SD_MODELS: ImageStudioSDModelOption[] = [
  {
    id: "stableDiffusion35",
    label: "SD 3.5 Large",
    emoji: "🎯",
    description: "Stability AI 旗艦，支援 ControlNet / LoRA，畫質最高",
    capabilities: ["neg", "guidance", "lora", "controlnet"],
  },
  {
    id: "fastSdxl",
    label: "Fast SDXL",
    emoji: "⚡",
    description: "SDXL 快速生圖，支援 LoRA 與多種尺寸",
    capabilities: ["neg", "lora"],
    fast: true,
  },
  {
    id: "sdLora",
    label: "SD + LoRA",
    emoji: "🧬",
    description: "Stable Diffusion + 任意 HuggingFace LoRA URL",
    capabilities: ["neg", "lora"],
  },
];

export const IMAGE_STUDIO_SD_CAPABILITY_LABELS: Record<
  ImageStudioSDCapability,
  string
> = {
  neg: "負向詞",
  guidance: "引導值",
  lora: "LoRA",
  controlnet: "ControlNet",
};

/** 與 ImageStudio.tsx 的 IMAGE_SIZES 對齊（fal SD 系列接受的字串） */
export const IMAGE_STUDIO_SD_IMAGE_SIZES: Array<{ id: string; label: string }> = [
  { id: "square_hd", label: "正方 HD" },
  { id: "square", label: "正方" },
  { id: "portrait_4_3", label: "直 4:3" },
  { id: "portrait_16_9", label: "直 16:9" },
  { id: "landscape_4_3", label: "橫 4:3" },
  { id: "landscape_16_9", label: "橫 16:9" },
];

/** SD 提示詞模板：包含主提示詞與負向詞兩個槽位 */
export interface ImageStudioSDPromptTemplate {
  id: string;
  label: string;
  emoji: string;
  prompt: string;
  negPrompt?: string;
}

export const IMAGE_STUDIO_SD_PROMPT_TEMPLATES: ImageStudioSDPromptTemplate[] = [
  {
    id: "sd-portrait-realistic",
    label: "寫實人像",
    emoji: "📸",
    prompt:
      "professional portrait photography, natural lighting, soft skin tones, sharp focus on eyes, shallow depth of field, 85mm lens, high detail",
    negPrompt: "blurry, deformed, low quality, watermark, extra fingers, bad anatomy",
  },
  {
    id: "sd-anime-character",
    label: "動漫角色",
    emoji: "🌸",
    prompt:
      "anime character illustration, detailed clean lineart, vibrant cel shading, expressive eyes, dynamic pose, studio lighting",
    negPrompt: "low quality, blurry, deformed hands, extra limbs, bad proportions, sketchy",
  },
  {
    id: "sd-concept-art",
    label: "概念美術",
    emoji: "🏰",
    prompt:
      "epic concept art, painterly style, dramatic atmospheric lighting, intricate details, fantasy environment, high contrast",
    negPrompt: "blurry, low quality, watermark, text, deformed, ugly",
  },
  {
    id: "sd-product-shot",
    label: "產品攝影",
    emoji: "📦",
    prompt:
      "studio product photography, clean white background, soft diffused lighting, sharp focus, professional commercial style, ultra detailed",
    negPrompt: "blurry, low quality, watermark, busy background, color cast",
  },
  {
    id: "sd-architecture",
    label: "建築環境",
    emoji: "🏛",
    prompt:
      "architectural visualization, golden hour lighting, ultra-detailed materials, photorealistic, wide-angle, 8k",
    negPrompt: "blurry, low quality, distorted geometry, watermark, sketchy",
  },
];

export function buildImageStudioSDSetModelActions(modelId: string): AgentAction[] {
  return [
    { type: "setTab", tabId: "sd" },
    { type: "setModel", modelId },
  ];
}

export function buildImageStudioSDFillPromptActions(
  text: string,
  append = false
): AgentAction[] {
  return [
    { type: "setTab", tabId: "sd" },
    { type: "fillPrompt", text, append },
  ];
}

export function buildImageStudioSDFillNegPromptActions(
  text: string,
  append = false
): AgentAction[] {
  return [
    { type: "setTab", tabId: "sd" },
    { type: "fillPrompt", text, append, slot: "negativePrompt" },
  ];
}

export function buildImageStudioSDApplyPromptTemplateActions(
  template: ImageStudioSDPromptTemplate
): AgentAction[] {
  const actions: AgentAction[] = [
    { type: "setTab", tabId: "sd" },
    { type: "fillPrompt", text: template.prompt, append: false },
  ];
  if (template.negPrompt) {
    actions.push({
      type: "fillPrompt",
      text: template.negPrompt,
      append: false,
      slot: "negativePrompt",
    });
  }
  return actions;
}

export function buildImageStudioSDSetImageSizeActions(
  size: string
): AgentAction[] {
  return [
    { type: "setTab", tabId: "sd" },
    { type: "setParam", key: "sdImageSize", value: size },
  ];
}

export function buildImageStudioSDSetGuidanceActions(
  value: number
): AgentAction[] {
  return [
    { type: "setTab", tabId: "sd" },
    { type: "setParam", key: "sdGuidance", value },
  ];
}

export function buildImageStudioSDSetInferStepsActions(
  value: number
): AgentAction[] {
  return [
    { type: "setTab", tabId: "sd" },
    { type: "setParam", key: "sdInferSteps", value },
  ];
}

export function buildImageStudioSDSetLoraActions(
  loraPath: string,
  scale = 1
): AgentAction[] {
  return [
    { type: "setTab", tabId: "sd" },
    { type: "setParam", key: "loraPath", value: loraPath },
    { type: "setParam", key: "loraScale", value: scale },
  ];
}

export const IMAGE_STUDIO_SD_GUIDANCE_PRESETS: Array<{
  id: string;
  label: string;
  value: number;
  description: string;
}> = [
  { id: "low", label: "低 3", value: 3, description: "更自由、創造性高" },
  { id: "balanced", label: "平衡 7.5", value: 7.5, description: "預設" },
  { id: "strict", label: "嚴格 12", value: 12, description: "嚴格貼合提示詞" },
];

export const IMAGE_STUDIO_SD_INFER_STEPS_PRESETS: Array<{
  id: string;
  label: string;
  value: number;
  description: string;
}> = [
  { id: "fast", label: "快 20", value: 20, description: "草稿" },
  { id: "default", label: "標準 30", value: 30, description: "預設" },
  { id: "quality", label: "高品質 40", value: 40, description: "細節更精緻" },
];

export const IMAGE_STUDIO_SD_COLLABORATION_LINKS: StudioCollaborationLink[] = [
  {
    id: "sd-prompt-coach",
    label: "幫我寫 SD 提示詞",
    emoji: "✍️",
    description: "把想法擴寫成 SD 風格的主提示詞 + 負向詞",
    chatPrompt:
      "我在 SD 分頁。請依我目前的想法擴寫成 Stable Diffusion 風格的主提示詞與負向提示詞，分別用 [ACTION:fillPrompt:...] 與 [ACTION:fillPrompt:slot=negativePrompt:...] 直接幫我覆寫。",
  },
  {
    id: "sd-find-lora",
    label: "幫我找 LoRA",
    emoji: "🧬",
    description: "依風格需求推薦一個 HuggingFace LoRA URL",
    chatPrompt:
      "我想要某種風格但找不到合適的 LoRA。請依我的描述推薦一個 HuggingFace LoRA URL，並用 [ACTION:setParam:loraPath=...] 幫我套上。",
  },
  {
    id: "sd-recommend-model",
    label: "幫我選 SD 模型",
    emoji: "🧭",
    description: "依需求挑 SD 3.5 / Fast SDXL / SD+LoRA",
    chatPrompt:
      "我在 SD 分頁。請依需求（高品質 / 速度 / LoRA / ControlNet）幫我從 3 個 SD 模型中選一個，說明原因，並用 [ACTION:setModel:...] 直接套用。",
  },
  {
    id: "sd-controlnet-from-pose",
    label: "用骨骼圖當 ControlNet",
    emoji: "🦴",
    description: "把上一張骨骼圖當 ControlNet 條件",
    chatPrompt:
      "把我上一次在骨骼姿勢頁產出的圖當 ControlNet 條件，自動幫我設定 controlnetImageUrl 與 controlnetScale 並建議模型。",
  },
];

export interface ImageStudioSDProfile {
  pageId: "image-studio";
  pagePath: "/image-studio";
  activeTab: "sd";
  models: ImageStudioSDModelOption[];
  imageSizes: typeof IMAGE_STUDIO_SD_IMAGE_SIZES;
  templates: ImageStudioSDPromptTemplate[];
  guidancePresets: typeof IMAGE_STUDIO_SD_GUIDANCE_PRESETS;
  inferStepsPresets: typeof IMAGE_STUDIO_SD_INFER_STEPS_PRESETS;
  collaborations: StudioCollaborationLink[];
}

export const IMAGE_STUDIO_SD_PROFILE: ImageStudioSDProfile = {
  pageId: "image-studio",
  pagePath: "/image-studio",
  activeTab: "sd",
  models: IMAGE_STUDIO_SD_MODELS,
  imageSizes: IMAGE_STUDIO_SD_IMAGE_SIZES,
  templates: IMAGE_STUDIO_SD_PROMPT_TEMPLATES,
  guidancePresets: IMAGE_STUDIO_SD_GUIDANCE_PRESETS,
  inferStepsPresets: IMAGE_STUDIO_SD_INFER_STEPS_PRESETS,
  collaborations: IMAGE_STUDIO_SD_COLLABORATION_LINKS,
};

// ─── 影片專業工作室 / 文生影（Video Studio T2V）深度操作 ─────────────────
//
// 與 VideoStudio.tsx 的 VIDEO_MODELS array 中 tab="t2v" 的 6 個模型對齊。
// 不同模型支援的能力（負向詞 / CFG / 解析度 / 幀數 / 提詞優化器 / 生成音訊）
// 在面板上顯示為徽章；使用者點哪個模型，下面的參數晶片才會露出對應選項。

export type VideoStudioT2VCapability =
  | "neg"          // 支援負向提示詞
  | "cfg"          // 支援 cfg scale（Kling）
  | "resolution"   // 支援解析度切換
  | "numFrames"    // 支援自訂幀數（Wan）
  | "promptOptimizer" // 提詞優化開關（MiniMax）
  | "generateAudio";  // 生成音訊（Veo3）

export interface VideoStudioModelOption {
  id: string;
  label: string;
  emoji: string;
  description: string;
  capabilities: VideoStudioT2VCapability[];
  fast?: boolean;
}

export const VIDEO_STUDIO_T2V_MODELS: VideoStudioModelOption[] = [
  {
    id: "kling-t2v",
    label: "Kling 2.1 文生影",
    emoji: "🎬",
    description: "高品質、5/10s、支援負向詞與 CFG，電影感敘事首選",
    capabilities: ["neg", "cfg"],
  },
  {
    id: "wan-t2v",
    label: "Wan 2.1 文生影",
    emoji: "⚡",
    description: "480p / 720p、可調 frames，便宜快速試節奏",
    capabilities: ["neg", "resolution", "numFrames"],
    fast: true,
  },
  {
    id: "minimax-t2v",
    label: "MiniMax Hailuo 文生影",
    emoji: "🪄",
    description: "支援提詞優化（不確定怎麼下 prompt 時開）",
    capabilities: ["promptOptimizer"],
    fast: true,
  },
  {
    id: "veo3-t2v",
    label: "Veo 3 文生影",
    emoji: "🌐",
    description: "Google Veo、可加音訊、16:9 / 9:16，高擬真",
    capabilities: ["generateAudio"],
  },
  {
    id: "ltx-t2v",
    label: "LTX 13B 文生影",
    emoji: "🧰",
    description: "開源、支援負向詞，重視可重現工作流時挑這個",
    capabilities: ["neg"],
  },
  {
    id: "sora-t2v",
    label: "Sora 文生影",
    emoji: "🎥",
    description: "OpenAI Sora、480p/720p/1080p、複雜敘事鏡頭",
    capabilities: ["resolution"],
  },
];

export const VIDEO_STUDIO_T2V_CAPABILITY_LABELS: Record<
  VideoStudioT2VCapability,
  string
> = {
  neg: "負向詞",
  cfg: "CFG",
  resolution: "解析度",
  numFrames: "幀數",
  promptOptimizer: "提詞優化",
  generateAudio: "生成音訊",
};

/** Kling / Sora 共用的時長字串（agent bus 接收 "5" / "10" 字串） */
export const VIDEO_STUDIO_T2V_DURATIONS: Array<{
  id: string;
  label: string;
  value: string;
}> = [
  { id: "d5", label: "5 秒", value: "5" },
  { id: "d10", label: "10 秒", value: "10" },
];

export const VIDEO_STUDIO_T2V_ASPECTS: Array<{
  id: string;
  label: string;
  value: string;
}> = [
  { id: "16-9", label: "16:9 寬螢幕", value: "16:9" },
  { id: "9-16", label: "9:16 直式", value: "9:16" },
  { id: "1-1", label: "1:1 正方", value: "1:1" },
];

export const VIDEO_STUDIO_T2V_RESOLUTIONS: Array<{
  id: string;
  label: string;
  value: string;
}> = [
  { id: "r480", label: "480p", value: "480p" },
  { id: "r720", label: "720p", value: "720p" },
  { id: "r1080", label: "1080p", value: "1080p" },
];

export interface VideoStudioPromptTemplate {
  id: string;
  label: string;
  emoji: string;
  prompt: string;
  negPrompt?: string;
  /** 建議搭配的模型 id（顯示在卡片上，不強制） */
  suggestedModelId?: string;
}

export const VIDEO_STUDIO_T2V_TEMPLATES: VideoStudioPromptTemplate[] = [
  {
    id: "t2v-cinematic-portrait",
    label: "電影感人像",
    emoji: "🎞",
    prompt:
      "A cinematic portrait shot of a young woman by a sunlit window, slow camera dolly-in, shallow depth of field, soft golden hour light, film grain.",
    negPrompt: "blurry, distorted face, jittery motion, low quality, watermark",
    suggestedModelId: "kling-t2v",
  },
  {
    id: "t2v-nature-landscape",
    label: "自然景觀",
    emoji: "🌄",
    prompt:
      "Sweeping aerial shot over a misty mountain range at sunrise, slow drone push-in, low clouds rolling between peaks, cinematic color grade.",
    negPrompt: "warped horizon, shaky camera, low quality",
    suggestedModelId: "veo3-t2v",
  },
  {
    id: "t2v-cyberpunk-city",
    label: "賽博城市",
    emoji: "🏙",
    prompt:
      "Cyberpunk city street at night, neon signs reflecting on wet pavement, slow tracking shot, light rain, atmospheric fog, anamorphic flares.",
    negPrompt: "static, low fps, jpeg artefacts",
    suggestedModelId: "sora-t2v",
  },
  {
    id: "t2v-anime-action",
    label: "動漫動作",
    emoji: "🌸",
    prompt:
      "Anime style action sequence, dynamic camera, energetic motion lines, vibrant cel shading, 24fps frame timing, expressive character pose.",
    suggestedModelId: "wan-t2v",
  },
  {
    id: "t2v-product-spin",
    label: "產品旋轉",
    emoji: "📦",
    prompt:
      "Studio product shot of a sleek wireless headphone slowly rotating on a clean white turntable, soft three-point lighting, sharp focus, commercial style.",
    negPrompt: "cluttered background, harsh shadows, low quality",
    suggestedModelId: "kling-t2v",
  },
  {
    id: "t2v-meditation-ambient",
    label: "冥想療癒",
    emoji: "🌿",
    prompt:
      "Slow gentle drift over a calm forest pond at dawn, soft mist, golden sun rays through trees, slow rhythmic motion, healing meditative mood.",
    suggestedModelId: "ltx-t2v",
  },
];

export function buildVideoStudioT2VSetModelActions(modelId: string): AgentAction[] {
  return [
    { type: "setTab", tabId: "t2v" },
    { type: "setModel", modelId },
  ];
}

export function buildVideoStudioT2VFillPromptActions(
  text: string,
  append = false
): AgentAction[] {
  return [
    { type: "setTab", tabId: "t2v" },
    { type: "fillPrompt", text, append },
  ];
}

export function buildVideoStudioT2VApplyTemplateActions(
  template: VideoStudioPromptTemplate
): AgentAction[] {
  const actions: AgentAction[] = [
    { type: "setTab", tabId: "t2v" },
  ];
  if (template.suggestedModelId) {
    actions.push({ type: "setModel", modelId: template.suggestedModelId });
  }
  actions.push({ type: "fillPrompt", text: template.prompt, append: false });
  if (template.negPrompt) {
    actions.push({
      type: "fillPrompt",
      text: template.negPrompt,
      append: false,
      slot: "negativePrompt",
    });
  }
  return actions;
}

export function buildVideoStudioT2VSetParamActions(
  key: string,
  value: unknown
): AgentAction[] {
  return [
    { type: "setTab", tabId: "t2v" },
    { type: "setParam", key, value },
  ];
}

export const VIDEO_STUDIO_T2V_COLLABORATION_LINKS: StudioCollaborationLink[] = [
  {
    id: "t2v-prompt-coach",
    label: "幫我寫影片提示詞",
    emoji: "✍️",
    description: "把想法擴寫成含鏡頭運動 / 光線 / 節奏的英文 prompt",
    chatPrompt:
      "我在影片專業工作室文生影分頁。請依我目前的提示詞與當前模型，擴寫成含鏡頭運動 / 光線 / 節奏 / 鏡頭語言的英文 video prompt（與必要的 negative prompt），並用 [ACTION:fillPrompt:...] 直接幫我覆寫。",
  },
  {
    id: "t2v-recommend-model",
    label: "幫我選 T2V 模型",
    emoji: "🧭",
    description: "依需求挑 Kling / Wan / MiniMax / Veo3 / LTX / Sora",
    chatPrompt:
      "我在 t2v 分頁。請依我目前的提示詞與需求（電影感 / 速度 / 含音訊 / 高擬真 / 開源），從 6 個 T2V 模型中推薦一個最合的，說明原因，並用 [ACTION:setModel:...] 幫我直接套用。",
  },
  {
    id: "t2v-handoff-i2v",
    label: "改用圖生影",
    emoji: "🖼",
    description: "覺得文生影不穩？改去 i2v 用一張圖當錨點生影片",
    chatPrompt:
      "把我目前的文生影 prompt 改成適合圖生影的版本，帶我去 i2v 分頁，並建議一個最合適的圖生影模型；如果歷史中有合適的圖，把它當錨點圖。",
  },
  {
    id: "t2v-director-storyboard",
    label: "交給導演 AI 拆分鏡",
    emoji: "🎬",
    description: "把單條 prompt 拆成 3-6 鏡的腳本與分鏡",
    chatPrompt:
      "把我目前的文生影 prompt 拆成 3-6 鏡的故事板，每鏡指定模型 / 時長 / 鏡頭運動 / 提示詞，完成後帶我去 /director。",
  },
];

export interface VideoStudioT2VProfile {
  pageId: "video-studio";
  pagePath: "/video-studio";
  activeTab: "t2v";
  models: VideoStudioModelOption[];
  templates: VideoStudioPromptTemplate[];
  durations: typeof VIDEO_STUDIO_T2V_DURATIONS;
  aspects: typeof VIDEO_STUDIO_T2V_ASPECTS;
  resolutions: typeof VIDEO_STUDIO_T2V_RESOLUTIONS;
  collaborations: StudioCollaborationLink[];
}

export const VIDEO_STUDIO_T2V_PROFILE: VideoStudioT2VProfile = {
  pageId: "video-studio",
  pagePath: "/video-studio",
  activeTab: "t2v",
  models: VIDEO_STUDIO_T2V_MODELS,
  templates: VIDEO_STUDIO_T2V_TEMPLATES,
  durations: VIDEO_STUDIO_T2V_DURATIONS,
  aspects: VIDEO_STUDIO_T2V_ASPECTS,
  resolutions: VIDEO_STUDIO_T2V_RESOLUTIONS,
  collaborations: VIDEO_STUDIO_T2V_COLLABORATION_LINKS,
};

// ─── 影片專業工作室 / 圖生影（Video Studio I2V）深度操作 ─────────────────

export type VideoStudioI2VCapability =
  | "tail"        // 支援尾幀（Kling）
  | "duration"    // 可選 5/10s 或 4/8s
  | "resolution"  // 解析度切換（Wan / PixVerse）
  | "aspect"      // 比例切換（Runway）
  | "promptOptimizer"; // MiniMax

export interface VideoStudioI2VModelOption {
  id: string;
  label: string;
  emoji: string;
  description: string;
  capabilities: VideoStudioI2VCapability[];
  fast?: boolean;
}

export const VIDEO_STUDIO_I2V_MODELS: VideoStudioI2VModelOption[] = [
  {
    id: "kling-i2v",
    label: "Kling 2.1 圖生影",
    emoji: "🎬",
    description: "首尾幀、5/10s，角色一致性最強",
    capabilities: ["tail", "duration"],
  },
  {
    id: "wan-i2v",
    label: "Wan 2.1 圖生影",
    emoji: "⚡",
    description: "480p / 720p，便宜快速",
    capabilities: ["resolution"],
    fast: true,
  },
  {
    id: "runway-i2v",
    label: "Runway Gen4 圖生影",
    emoji: "🎯",
    description: "5/10s、可設 aspect ratio，商業視覺動效首選",
    capabilities: ["duration", "aspect"],
  },
  {
    id: "pixverse-i2v",
    label: "PixVerse 4.5 圖生影",
    emoji: "🌸",
    description: "4s / 8s、多品質檔次（360p–1080p）",
    capabilities: ["duration", "resolution"],
    fast: true,
  },
  {
    id: "minimax-i2v",
    label: "MiniMax 圖生影",
    emoji: "🪄",
    description: "支援提詞優化，描述會邊走邊改的任務首選",
    capabilities: ["promptOptimizer"],
  },
];

export const VIDEO_STUDIO_I2V_CAPABILITY_LABELS: Record<
  VideoStudioI2VCapability,
  string
> = {
  tail: "尾幀",
  duration: "時長",
  resolution: "解析度",
  aspect: "比例",
  promptOptimizer: "提詞優化",
};

/** 圖生影常見動作模板（強調動作、相機運動、表情變化） */
export const VIDEO_STUDIO_I2V_TEMPLATES: VideoStudioPromptTemplate[] = [
  {
    id: "i2v-subtle-motion",
    label: "微動",
    emoji: "🍃",
    prompt:
      "Subtle ambient motion: leaves swaying gently, hair drifting in breeze, eyes blinking slowly, the rest stays still and faithful to the image.",
    suggestedModelId: "kling-i2v",
  },
  {
    id: "i2v-camera-push-in",
    label: "推鏡",
    emoji: "🎥",
    prompt:
      "Slow cinematic camera push-in toward the subject in the image, while the subject stays mostly static, soft parallax in the background.",
    suggestedModelId: "runway-i2v",
  },
  {
    id: "i2v-character-action",
    label: "角色動作",
    emoji: "💪",
    prompt:
      "The character in the image performs the described action smoothly while keeping their face, outfit, and lighting consistent with the reference frame.",
    suggestedModelId: "kling-i2v",
  },
  {
    id: "i2v-environment-ambience",
    label: "環境氛圍",
    emoji: "🌫",
    prompt:
      "Add atmospheric motion to the scene: gentle mist drifting, particles floating, subtle light flicker, water rippling, while preserving the overall composition.",
    suggestedModelId: "wan-i2v",
  },
  {
    id: "i2v-dynamic-action",
    label: "動感大動作",
    emoji: "🔥",
    prompt:
      "Dynamic full-body motion with strong directional camera move, energetic action consistent with the subject in the reference image, vivid motion blur.",
    suggestedModelId: "pixverse-i2v",
  },
];

export const VIDEO_STUDIO_I2V_DURATIONS: Array<{
  id: string;
  label: string;
  value: string;
}> = [
  { id: "d4", label: "4 秒", value: "4" },
  { id: "d5", label: "5 秒", value: "5" },
  { id: "d8", label: "8 秒", value: "8" },
  { id: "d10", label: "10 秒", value: "10" },
];

export const VIDEO_STUDIO_I2V_RESOLUTIONS: Array<{
  id: string;
  label: string;
  value: string;
}> = [
  { id: "r360", label: "360p", value: "360p" },
  { id: "r540", label: "540p", value: "540p" },
  { id: "r480", label: "480p", value: "480p" },
  { id: "r720", label: "720p", value: "720p" },
  { id: "r1080", label: "1080p", value: "1080p" },
];

export const VIDEO_STUDIO_I2V_ASPECTS: Array<{
  id: string;
  label: string;
  value: string;
}> = [
  { id: "16-9", label: "16:9 寬螢幕", value: "16:9" },
  { id: "9-16", label: "9:16 直式", value: "9:16" },
  { id: "1-1", label: "1:1 正方", value: "1:1" },
];

export function buildVideoStudioI2VSetModelActions(modelId: string): AgentAction[] {
  return [
    { type: "setTab", tabId: "i2v" },
    { type: "setModel", modelId },
  ];
}

export function buildVideoStudioI2VFillPromptActions(
  text: string,
  append = false
): AgentAction[] {
  return [
    { type: "setTab", tabId: "i2v" },
    { type: "fillPrompt", text, append },
  ];
}

export function buildVideoStudioI2VApplyTemplateActions(
  template: VideoStudioPromptTemplate
): AgentAction[] {
  const actions: AgentAction[] = [
    { type: "setTab", tabId: "i2v" },
  ];
  if (template.suggestedModelId) {
    actions.push({ type: "setModel", modelId: template.suggestedModelId });
  }
  actions.push({ type: "fillPrompt", text: template.prompt, append: false });
  return actions;
}

export function buildVideoStudioI2VSetParamActions(
  key: string,
  value: unknown
): AgentAction[] {
  return [
    { type: "setTab", tabId: "i2v" },
    { type: "setParam", key, value },
  ];
}

export function buildVideoStudioI2VSetImageActions(
  imageUrl: string,
  tailImageUrl?: string
): AgentAction[] {
  const actions: AgentAction[] = [
    { type: "setTab", tabId: "i2v" },
    { type: "setParam", key: "imageUrl", value: imageUrl },
  ];
  if (tailImageUrl) {
    actions.push({ type: "setParam", key: "tailImageUrl", value: tailImageUrl });
  }
  return actions;
}

export const VIDEO_STUDIO_I2V_COLLABORATION_LINKS: StudioCollaborationLink[] = [
  {
    id: "i2v-prompt-coach",
    label: "幫我寫圖生影指令",
    emoji: "✍️",
    description: "依錨點圖擴寫適合圖生影的動作 / 鏡頭描述",
    chatPrompt:
      "我在影片專業工作室圖生影分頁。請依我已上傳的錨點圖與當前模型，擴寫成適合圖生影的英文 prompt（強調動作、鏡頭運動、保留主體一致），並用 [ACTION:fillPrompt:...] 直接幫我覆寫。",
  },
  {
    id: "i2v-recommend-model",
    label: "幫我選 I2V 模型",
    emoji: "🧭",
    description: "依錨點圖與動作需求推薦 5 個 I2V 模型之一",
    chatPrompt:
      "我在 i2v 分頁。請依錨點圖與我想要的動作（角色一致 / 廣告動效 / 微動 / 高解析 / 提詞優化），從 5 個 I2V 模型中推薦一個最合的並用 [ACTION:setModel:...] 套用。",
  },
  {
    id: "i2v-from-image-studio",
    label: "從圖片創作室拿一張",
    emoji: "🖼",
    description: "把上一張 image-studio 生成的圖當錨點圖",
    chatPrompt:
      "把我最近在 image-studio 生成的最後一張圖當作 i2v 的錨點圖（imageUrl），自動帶我到 i2v 分頁並建議一個合適的模型與動作 prompt。",
  },
  {
    id: "i2v-director-sequence",
    label: "交給導演 AI 排片段",
    emoji: "🎬",
    description: "把單張圖延伸成連續鏡頭片段",
    chatPrompt:
      "我有一張關鍵幀想做成連續鏡頭。請依我的錨點圖與想要的故事走向，規劃 3-5 段 i2v 片段（每段指定模型 / 時長 / 動作），完成後帶我去 /director。",
  },
];

export interface VideoStudioI2VProfile {
  pageId: "video-studio";
  pagePath: "/video-studio";
  activeTab: "i2v";
  models: VideoStudioI2VModelOption[];
  templates: VideoStudioPromptTemplate[];
  durations: typeof VIDEO_STUDIO_I2V_DURATIONS;
  resolutions: typeof VIDEO_STUDIO_I2V_RESOLUTIONS;
  aspects: typeof VIDEO_STUDIO_I2V_ASPECTS;
  collaborations: StudioCollaborationLink[];
}

export const VIDEO_STUDIO_I2V_PROFILE: VideoStudioI2VProfile = {
  pageId: "video-studio",
  pagePath: "/video-studio",
  activeTab: "i2v",
  models: VIDEO_STUDIO_I2V_MODELS,
  templates: VIDEO_STUDIO_I2V_TEMPLATES,
  durations: VIDEO_STUDIO_I2V_DURATIONS,
  resolutions: VIDEO_STUDIO_I2V_RESOLUTIONS,
  aspects: VIDEO_STUDIO_I2V_ASPECTS,
  collaborations: VIDEO_STUDIO_I2V_COLLABORATION_LINKS,
};
