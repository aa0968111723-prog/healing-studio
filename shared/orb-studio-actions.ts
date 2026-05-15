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
  /**
   * 可選：純客戶端的直接動作。當設定時，UI 應該直接 dispatch 這個動作而
   * 不是把 `chatPrompt` 送進 LLM — 適合「目前 studio 狀態 → process spec
   * 連結」這類純打包操作，不需要 LLM 規劃。`chatPrompt` 會被保留成
   * fallback（無 directAction 時走 LLM 路徑）以及在聊天裡顯示成使用者訊息。
   */
  directAction?: AgentAction;
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
    // 點下去當場讀 studio 的 PageAgentSnapshot.state 打包成連結並複製到剪
    // 貼簿；不繞 LLM，所以不會卡在「思考中…」也不會因為還沒跑過 workflow
    // 而失敗。LLM 在自由聊天裡也能 emit 同一個 action。
    directAction: { type: "shareViaLink", target: "studioState" },
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

// ─── 影片專業工作室 / 影生影（Video Studio V2V）深度操作 ─────────────────
//
// 與 VideoStudio.tsx 的 V2VModel 三個模型對齊。每個模型支援的能力不同：
//  - wan-v2v: 影片重風格化，可調 strength（0~1，越高越偏向新風格）
//  - kling-v2v: CFG 控制原片保留度 + 負向詞
//  - ltx-v2v: 走 image-to-video 路徑（吃 imageUrl），可調 frames / guidance

export type VideoStudioV2VCapability =
  | "strength"   // wan-v2v
  | "cfg"        // kling-v2v
  | "neg"        // kling-v2v / ltx-v2v
  | "imageInput" // ltx-v2v 收 imageUrl 而非 videoUrl
  | "frames"     // ltx-v2v
  | "guidance";  // ltx-v2v

export interface VideoStudioV2VModelOption {
  id: string;
  label: string;
  emoji: string;
  description: string;
  capabilities: VideoStudioV2VCapability[];
  fast?: boolean;
}

export const VIDEO_STUDIO_V2V_MODELS: VideoStudioV2VModelOption[] = [
  {
    id: "wan-v2v",
    label: "Wan 2.1 影生影",
    emoji: "⚡",
    description: "風格轉換、strength 0~1 可調，便宜快速試風格",
    capabilities: ["strength"],
    fast: true,
  },
  {
    id: "kling-v2v",
    label: "Kling 影生影",
    emoji: "🎬",
    description: "CFG 控制原片保留度，搭配負向詞做高可控風格化",
    capabilities: ["cfg", "neg"],
  },
  {
    id: "ltx-v2v",
    label: "LTX 影生影",
    emoji: "🧰",
    description: "開源 LTX，吃 imageUrl 起手，可調 frames 與 guidance",
    capabilities: ["neg", "imageInput", "frames", "guidance"],
  },
];

export const VIDEO_STUDIO_V2V_CAPABILITY_LABELS: Record<
  VideoStudioV2VCapability,
  string
> = {
  strength: "改動強度",
  cfg: "CFG",
  neg: "負向詞",
  imageInput: "圖起手",
  frames: "幀數",
  guidance: "引導值",
};

/** Wan v2v 強度預設 — 越高越偏向新風格 */
export const VIDEO_STUDIO_V2V_STRENGTH_PRESETS: Array<{
  id: string;
  label: string;
  value: number;
  description: string;
}> = [
  { id: "subtle", label: "保留 0.35", value: 0.35, description: "保留原片運鏡，僅疊薄薄一層風格" },
  { id: "balanced", label: "平衡 0.55", value: 0.55, description: "風格與原片各半（預設起手）" },
  { id: "strong", label: "重塑 0.75", value: 0.75, description: "明顯新風格，但仍認得原片構圖" },
  { id: "extreme", label: "重畫 0.9", value: 0.9, description: "幾乎重畫，僅保留動作走向" },
];

/** Kling v2v CFG 預設 — 越高越貼合 prompt（同時越偏離原片） */
export const VIDEO_STUDIO_V2V_CFG_PRESETS: Array<{
  id: string;
  label: string;
  value: number;
  description: string;
}> = [
  { id: "loose", label: "鬆 0.3", value: 0.3, description: "保留原片較多" },
  { id: "balanced", label: "平衡 0.5", value: 0.5, description: "預設" },
  { id: "tight", label: "緊 0.8", value: 0.8, description: "嚴格貼合 prompt" },
];

export const VIDEO_STUDIO_V2V_TEMPLATES: VideoStudioPromptTemplate[] = [
  {
    id: "v2v-anime-style",
    label: "動漫化",
    emoji: "🌸",
    prompt:
      "Re-style this video into clean anime illustration: cel shading, vibrant flat colors, expressive linework, while keeping the camera and subject motion intact.",
    suggestedModelId: "wan-v2v",
  },
  {
    id: "v2v-watercolor",
    label: "水彩化",
    emoji: "🎨",
    prompt:
      "Transform this clip into flowing watercolor painting style with soft edges, paper texture, gentle pastel palette, while preserving the original motion.",
    suggestedModelId: "wan-v2v",
  },
  {
    id: "v2v-cinematic",
    label: "電影化",
    emoji: "🎞",
    prompt:
      "Re-grade this video with a cinematic look: teal-orange palette, film grain, anamorphic flares, deep shadows, while keeping subject identity stable.",
    negPrompt: "blurry, jittery, oversaturated, low quality",
    suggestedModelId: "kling-v2v",
  },
  {
    id: "v2v-noir",
    label: "黑色電影",
    emoji: "🖤",
    prompt:
      "Convert into film noir black-and-white style, hard chiaroscuro lighting, high contrast, dramatic shadows, while preserving motion and timing.",
    negPrompt: "color, washed out, low contrast",
    suggestedModelId: "kling-v2v",
  },
  {
    id: "v2v-ghibli",
    label: "吉卜力風",
    emoji: "🍃",
    prompt:
      "Restyle into Studio Ghibli inspired hand-painted look: warm sunlight, soft brushwork, painterly skies, gentle atmosphere, while preserving the original camera and motion.",
    suggestedModelId: "ltx-v2v",
  },
];

export function buildVideoStudioV2VSetModelActions(modelId: string): AgentAction[] {
  return [
    { type: "setTab", tabId: "v2v" },
    { type: "setModel", modelId },
  ];
}

export function buildVideoStudioV2VApplyTemplateActions(
  template: VideoStudioPromptTemplate
): AgentAction[] {
  const actions: AgentAction[] = [{ type: "setTab", tabId: "v2v" }];
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

export function buildVideoStudioV2VSetParamActions(
  key: string,
  value: unknown
): AgentAction[] {
  return [
    { type: "setTab", tabId: "v2v" },
    { type: "setParam", key, value },
  ];
}

export const VIDEO_STUDIO_V2V_COLLABORATION_LINKS: StudioCollaborationLink[] = [
  {
    id: "v2v-prompt-coach",
    label: "幫我寫風格化指令",
    emoji: "✍️",
    description: "依原片內容擴寫成精準的英文 v2v 風格化指令",
    chatPrompt:
      "我在影生影分頁。請依我目前已上傳的影片與想要的風格，擴寫成精準的英文 v2v 提示詞（強調保留動作 / 變更風格），並用 [ACTION:fillPrompt:...] 直接幫我覆寫。",
  },
  {
    id: "v2v-recommend-model",
    label: "幫我選 V2V 模型",
    emoji: "🧭",
    description: "依需求挑 Wan / Kling / LTX",
    chatPrompt:
      "我在 v2v 分頁。請依需求（速度 / 高可控 / 開源），從 3 個 V2V 模型中推薦一個最合的，並用 [ACTION:setModel:...] 套用。",
  },
  {
    id: "v2v-after-i2v",
    label: "從 i2v 接過來重風格化",
    emoji: "🔁",
    description: "把剛才在 i2v 生成的成品直接帶到 v2v 風格化",
    chatPrompt:
      "把我剛才在 i2v 分頁生成的影片當作 v2v 的素材（videoUrl），自動帶我到 v2v 分頁並建議一個合適的模型與 strength。",
  },
  {
    id: "v2v-director-batch",
    label: "交給導演 AI 批次風格化",
    emoji: "🎬",
    description: "把多段影片整成批次風格化流程",
    chatPrompt:
      "我有多段影片要做相同風格化處理。請整理成一份批次工作流（每段指定模型 / strength / 提示詞），完成後帶我去 /director 繼續展開。",
  },
];

export interface VideoStudioV2VProfile {
  pageId: "video-studio";
  pagePath: "/video-studio";
  activeTab: "v2v";
  models: VideoStudioV2VModelOption[];
  templates: VideoStudioPromptTemplate[];
  strengthPresets: typeof VIDEO_STUDIO_V2V_STRENGTH_PRESETS;
  cfgPresets: typeof VIDEO_STUDIO_V2V_CFG_PRESETS;
  collaborations: StudioCollaborationLink[];
}

export const VIDEO_STUDIO_V2V_PROFILE: VideoStudioV2VProfile = {
  pageId: "video-studio",
  pagePath: "/video-studio",
  activeTab: "v2v",
  models: VIDEO_STUDIO_V2V_MODELS,
  templates: VIDEO_STUDIO_V2V_TEMPLATES,
  strengthPresets: VIDEO_STUDIO_V2V_STRENGTH_PRESETS,
  cfgPresets: VIDEO_STUDIO_V2V_CFG_PRESETS,
  collaborations: VIDEO_STUDIO_V2V_COLLABORATION_LINKS,
};

// ─── 影片專業工作室 / 畫質優化（Video Studio Enhance）深度操作 ───────────
//
// 三個工具：超解析（ByteDance ×2/×4）/ RIFE 補幀 / Topaz 增強。
// 不需要 prompt（agentBus 收到 fillPrompt 會 no-op），只吃 videoUrl + 各自參數。

export type VideoStudioEnhanceCapability =
  | "upscale"        // 倍率放大
  | "frameInterp"    // 補幀
  | "topazModel"     // Topaz 模型
  | "outputScale";   // Topaz 輸出比例

export interface VideoStudioEnhanceModelOption {
  id: string;
  label: string;
  emoji: string;
  description: string;
  capabilities: VideoStudioEnhanceCapability[];
}

export const VIDEO_STUDIO_ENHANCE_MODELS: VideoStudioEnhanceModelOption[] = [
  {
    id: "video-upscale",
    label: "ByteDance 影片超解析",
    emoji: "🔍",
    description: "業界頂尖 ×2 / ×4 影片超分辨率，720p → 2160p",
    capabilities: ["upscale"],
  },
  {
    id: "frame-interp",
    label: "RIFE 4.6 補幀",
    emoji: "🌊",
    description: "業界最佳補幀演算法，2× / 4× 幀率提升、24-120fps 可調",
    capabilities: ["frameInterp"],
  },
  {
    id: "topaz-enhance",
    label: "Topaz 畫質增強",
    emoji: "💎",
    description: "去噪、去模糊、專業級增強，5 種 Topaz 模型可選",
    capabilities: ["topazModel", "outputScale"],
  },
];

export const VIDEO_STUDIO_ENHANCE_CAPABILITY_LABELS: Record<
  VideoStudioEnhanceCapability,
  string
> = {
  upscale: "倍率放大",
  frameInterp: "補幀",
  topazModel: "Topaz 模型",
  outputScale: "輸出比例",
};

/** ByteDance 超解析倍率：與 VideoStudio.tsx 對齊（"2"/"4" 字串） */
export const VIDEO_STUDIO_ENHANCE_UPSCALE_FACTORS: Array<{
  id: string;
  label: string;
  value: string;
}> = [
  { id: "x2", label: "×2", value: "2" },
  { id: "x4", label: "×4", value: "4" },
];

/** RIFE 補幀倍率：字串 "2"/"4" */
export const VIDEO_STUDIO_ENHANCE_RIFE_MULTIPLIERS: Array<{
  id: string;
  label: string;
  value: string;
}> = [
  { id: "x2", label: "2× 補幀", value: "2" },
  { id: "x4", label: "4× 補幀", value: "4" },
];

/** RIFE 目標 fps（24~120 範圍內常見值） */
export const VIDEO_STUDIO_ENHANCE_RIFE_FPS: Array<{
  id: string;
  label: string;
  value: number;
}> = [
  { id: "fps24", label: "24 fps", value: 24 },
  { id: "fps30", label: "30 fps", value: 30 },
  { id: "fps60", label: "60 fps", value: 60 },
  { id: "fps120", label: "120 fps", value: 120 },
];

/** Topaz 5 種模型：與 VideoStudio.tsx allow-list 對齊 */
export const VIDEO_STUDIO_ENHANCE_TOPAZ_MODELS: Array<{
  id: string;
  label: string;
  description: string;
}> = [
  { id: "iris", label: "Iris", description: "通用，平衡細節與真實感" },
  { id: "artemis", label: "Artemis", description: "去噪去壓縮，老素材首選" },
  { id: "theia", label: "Theia", description: "細節恢復，硬邊銳利化" },
  { id: "gaia", label: "Gaia", description: "電腦動畫 / CG 素材" },
  { id: "nyx", label: "Nyx", description: "極低光降噪" },
];

/** Topaz 輸出比例（2x / 4x，與 ByteDance 不同的是 Topaz 走 number） */
export const VIDEO_STUDIO_ENHANCE_TOPAZ_SCALES: Array<{
  id: string;
  label: string;
  value: number;
}> = [
  { id: "x1", label: "原比例", value: 1 },
  { id: "x2", label: "×2", value: 2 },
  { id: "x4", label: "×4", value: 4 },
];

export function buildVideoStudioEnhanceSetModelActions(
  modelId: string
): AgentAction[] {
  return [
    { type: "setTab", tabId: "enhance" },
    { type: "setModel", modelId },
  ];
}

export function buildVideoStudioEnhanceSetParamActions(
  key: string,
  value: unknown
): AgentAction[] {
  return [
    { type: "setTab", tabId: "enhance" },
    { type: "setParam", key, value },
  ];
}

export const VIDEO_STUDIO_ENHANCE_COLLABORATION_LINKS: StudioCollaborationLink[] = [
  {
    id: "enhance-recommend-tool",
    label: "幫我選優化工具",
    emoji: "🧭",
    description: "依素材狀況推薦 超解析 / 補幀 / Topaz",
    chatPrompt:
      "我在畫質優化頁。請依我素材的狀況（解析度低 / fps 太低 / 噪點多），從 3 個工具中挑一個最合的，說明原因，並用 [ACTION:setModel:...] 直接套用。",
  },
  {
    id: "enhance-pipeline",
    label: "規劃多工具流程",
    emoji: "🧬",
    description: "把超解析 + 補幀 + Topaz 排成一條順序",
    chatPrompt:
      "我想對一段影片同時做超解析、補幀與 Topaz 增強。請排出推薦的執行順序與每步參數，完成後帶我去 /director 排成 workflow。",
  },
  {
    id: "enhance-from-history",
    label: "從歷史拉一段影片",
    emoji: "🕰",
    description: "把過去生成的影片帶過來做後製優化",
    chatPrompt:
      "把我最近在 video-studio 生成的最後一段影片拉過來做畫質優化，自動填好 videoUrl 並建議一個工具。",
  },
  {
    id: "enhance-director-batch",
    label: "交給導演 AI 批次優化",
    emoji: "🎬",
    description: "多段影片同規格優化的批次工作流",
    chatPrompt:
      "我有多段影片需要同樣規格的畫質優化。請整成一份批次工作流（每段一致的模型 / 倍率 / 模型參數），完成後帶我去 /director。",
  },
];

export interface VideoStudioEnhanceProfile {
  pageId: "video-studio";
  pagePath: "/video-studio";
  activeTab: "enhance";
  models: VideoStudioEnhanceModelOption[];
  upscaleFactors: typeof VIDEO_STUDIO_ENHANCE_UPSCALE_FACTORS;
  rifeMultipliers: typeof VIDEO_STUDIO_ENHANCE_RIFE_MULTIPLIERS;
  rifeFps: typeof VIDEO_STUDIO_ENHANCE_RIFE_FPS;
  topazModels: typeof VIDEO_STUDIO_ENHANCE_TOPAZ_MODELS;
  topazScales: typeof VIDEO_STUDIO_ENHANCE_TOPAZ_SCALES;
  collaborations: StudioCollaborationLink[];
}

export const VIDEO_STUDIO_ENHANCE_PROFILE: VideoStudioEnhanceProfile = {
  pageId: "video-studio",
  pagePath: "/video-studio",
  activeTab: "enhance",
  models: VIDEO_STUDIO_ENHANCE_MODELS,
  upscaleFactors: VIDEO_STUDIO_ENHANCE_UPSCALE_FACTORS,
  rifeMultipliers: VIDEO_STUDIO_ENHANCE_RIFE_MULTIPLIERS,
  rifeFps: VIDEO_STUDIO_ENHANCE_RIFE_FPS,
  topazModels: VIDEO_STUDIO_ENHANCE_TOPAZ_MODELS,
  topazScales: VIDEO_STUDIO_ENHANCE_TOPAZ_SCALES,
  collaborations: VIDEO_STUDIO_ENHANCE_COLLABORATION_LINKS,
};

// ─── 影片專業工作室 / 進階控制（Video Studio Control）深度操作 ───────────
//
// 4 個工具：CamMaster 鏡頭控制 / AnimateDiff 動作控制 / DepthCrafter 深度
// 感知 / Vidu Q1 角色一致性。每個吃的輸入不同，控制能力也不同。

export type VideoStudioControlCapability =
  | "cameraMotion"
  | "controlNet"
  | "guidance"
  | "neg"
  | "imageInput"
  | "videoInput"
  | "multiRef";

export interface VideoStudioControlModelOption {
  id: string;
  label: string;
  emoji: string;
  description: string;
  capabilities: VideoStudioControlCapability[];
}

export const VIDEO_STUDIO_CONTROL_MODELS: VideoStudioControlModelOption[] = [
  {
    id: "cam-master",
    label: "CamMaster 運鏡控制",
    emoji: "🎥",
    description: "從靜態圖出發，依鏡頭運動指令生成影片，導演式運鏡規劃",
    capabilities: ["cameraMotion", "imageInput"],
  },
  {
    id: "animate-diff",
    label: "AnimateDiff 動作控制",
    emoji: "💃",
    description: "用 ControlNet 條件（openpose / canny / depth）精準控制動作",
    capabilities: ["controlNet", "guidance", "neg", "videoInput"],
  },
  {
    id: "depth-crafter",
    label: "DepthCrafter 深度感知",
    emoji: "🌐",
    description: "從影片產生深度圖，做空間層次重建（無 prompt）",
    capabilities: ["videoInput"],
  },
  {
    id: "vidu-ref",
    label: "Vidu Q1 角色一致性",
    emoji: "🎯",
    description: "多參考圖角色一致性，連續鏡頭穩定主體外觀",
    capabilities: ["multiRef", "imageInput"],
  },
];

export const VIDEO_STUDIO_CONTROL_CAPABILITY_LABELS: Record<
  VideoStudioControlCapability,
  string
> = {
  cameraMotion: "鏡頭運動",
  controlNet: "ControlNet",
  guidance: "引導值",
  neg: "負向詞",
  imageInput: "圖起手",
  videoInput: "影片起手",
  multiRef: "多參考圖",
};

/** CamMaster 17 種鏡頭運動，與 VideoStudio.tsx CAMERA_MOTIONS 對齊 */
export const VIDEO_STUDIO_CONTROL_CAMERA_MOTIONS: Array<{
  id: string;
  label: string;
  emoji: string;
}> = [
  { id: "static", label: "靜態", emoji: "🟦" },
  { id: "push_in", label: "推鏡", emoji: "➡️" },
  { id: "pull_out", label: "拉鏡", emoji: "⬅️" },
  { id: "pan_left", label: "搖鏡左", emoji: "↖️" },
  { id: "pan_right", label: "搖鏡右", emoji: "↗️" },
  { id: "tilt_up", label: "仰鏡", emoji: "⬆️" },
  { id: "tilt_down", label: "俯鏡", emoji: "⬇️" },
  { id: "orbit_left", label: "環繞左", emoji: "🔄" },
  { id: "orbit_right", label: "環繞右", emoji: "🔃" },
  { id: "crane_up", label: "升鏡", emoji: "🆙" },
  { id: "crane_down", label: "降鏡", emoji: "🔽" },
  { id: "roll_clockwise", label: "荷蘭角順", emoji: "↩️" },
  { id: "roll_counterclockwise", label: "荷蘭角逆", emoji: "↪️" },
  { id: "move_left", label: "橫移左", emoji: "⏮" },
  { id: "move_right", label: "橫移右", emoji: "⏭" },
  { id: "move_up", label: "上移", emoji: "🔼" },
  { id: "move_down", label: "下移", emoji: "🔽" },
];

/** AnimateDiff ControlNet 條件 4 選 1 */
export const VIDEO_STUDIO_CONTROL_CONTROLNETS: Array<{
  id: string;
  label: string;
  description: string;
}> = [
  { id: "openpose", label: "OpenPose", description: "骨架控制動作（人物動作首選）" },
  { id: "canny", label: "Canny", description: "邊緣偵測控制構圖" },
  { id: "depth", label: "Depth", description: "深度圖控制空間層次" },
  { id: "none", label: "不啟用", description: "純 prompt 引導" },
];

export const VIDEO_STUDIO_CONTROL_TEMPLATES: VideoStudioPromptTemplate[] = [
  {
    id: "control-cinematic-pushin",
    label: "電影感推鏡",
    emoji: "🎞",
    prompt:
      "Slow cinematic dolly push-in toward the subject, shallow depth of field, soft golden light, atmospheric haze, while keeping subject identity stable.",
    suggestedModelId: "cam-master",
  },
  {
    id: "control-orbit-product",
    label: "產品環繞",
    emoji: "📦",
    prompt:
      "Smooth 360-degree orbit shot around the subject, even three-point lighting, clean studio background, sharp product details preserved.",
    suggestedModelId: "cam-master",
  },
  {
    id: "control-character-dance",
    label: "角色動作",
    emoji: "💃",
    prompt:
      "Character performs a smooth fluid action driven by the openpose skeleton, keeping costume / lighting / facial identity faithful to the reference.",
    negPrompt: "deformed limbs, jittery motion, identity drift",
    suggestedModelId: "animate-diff",
  },
  {
    id: "control-character-consistency",
    label: "角色連戲",
    emoji: "🎯",
    prompt:
      "Continuous shot of the same character across changing scenes, keeping hair, outfit, and facial features identical to the reference images.",
    suggestedModelId: "vidu-ref",
  },
];

export function buildVideoStudioControlSetModelActions(
  modelId: string
): AgentAction[] {
  return [
    { type: "setTab", tabId: "control" },
    { type: "setModel", modelId },
  ];
}

export function buildVideoStudioControlApplyTemplateActions(
  template: VideoStudioPromptTemplate
): AgentAction[] {
  const actions: AgentAction[] = [{ type: "setTab", tabId: "control" }];
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

export function buildVideoStudioControlSetCameraMotionActions(
  motion: string
): AgentAction[] {
  return [
    { type: "setTab", tabId: "control" },
    { type: "setModel", modelId: "cam-master" },
    { type: "setParam", key: "cameraMotion", value: motion },
  ];
}

export function buildVideoStudioControlSetControlNetActions(
  controlNet: string
): AgentAction[] {
  return [
    { type: "setTab", tabId: "control" },
    { type: "setModel", modelId: "animate-diff" },
    { type: "setParam", key: "controlNet", value: controlNet },
  ];
}

export function buildVideoStudioControlSetParamActions(
  key: string,
  value: unknown
): AgentAction[] {
  return [
    { type: "setTab", tabId: "control" },
    { type: "setParam", key, value },
  ];
}

export const VIDEO_STUDIO_CONTROL_COLLABORATION_LINKS: StudioCollaborationLink[] = [
  {
    id: "control-recommend-tool",
    label: "幫我選控制工具",
    emoji: "🧭",
    description: "依需求挑 CamMaster / AnimateDiff / DepthCrafter / Vidu",
    chatPrompt:
      "我在進階控制頁。請依我的需求（鏡頭運動 / 動作精準 / 深度感 / 角色一致性），從 4 個工具中推薦一個最合的，並用 [ACTION:setModel:...] 套用。",
  },
  {
    id: "control-from-pose",
    label: "用 ImageStudio 骨骼當條件",
    emoji: "🦴",
    description: "把先前在圖片創作室抓的骨骼圖當 AnimateDiff 條件",
    chatPrompt:
      "把我先前在 image-studio 骨骼姿勢頁產生的骨骼圖當作 AnimateDiff 的 ControlNet 條件，自動切到 control 分頁、選 animate-diff 並套上 controlNet=openpose。",
  },
  {
    id: "control-from-image-studio",
    label: "從 image-studio 拿圖當運鏡起點",
    emoji: "🖼",
    description: "把上一張 image-studio 生成的圖當 CamMaster / Vidu 起點",
    chatPrompt:
      "把我最近在 image-studio 生成的最後一張圖當作運鏡起點（imageUrl），自動帶我到 control 分頁、選 cam-master 並建議一個鏡頭運動。",
  },
  {
    id: "control-director-storyboard",
    label: "交給導演 AI 排運鏡腳本",
    emoji: "🎬",
    description: "把多鏡頭運鏡排成一份故事板",
    chatPrompt:
      "我有一個敘事需要規劃多顆運鏡。請依我目前的素材設計 4-6 鏡的故事板（每顆指定模型 / 鏡頭運動 / 提示詞），完成後帶我去 /director 展開。",
  },
];

export interface VideoStudioControlProfile {
  pageId: "video-studio";
  pagePath: "/video-studio";
  activeTab: "control";
  models: VideoStudioControlModelOption[];
  templates: VideoStudioPromptTemplate[];
  cameraMotions: typeof VIDEO_STUDIO_CONTROL_CAMERA_MOTIONS;
  controlNets: typeof VIDEO_STUDIO_CONTROL_CONTROLNETS;
  collaborations: StudioCollaborationLink[];
}

export const VIDEO_STUDIO_CONTROL_PROFILE: VideoStudioControlProfile = {
  pageId: "video-studio",
  pagePath: "/video-studio",
  activeTab: "control",
  models: VIDEO_STUDIO_CONTROL_MODELS,
  templates: VIDEO_STUDIO_CONTROL_TEMPLATES,
  cameraMotions: VIDEO_STUDIO_CONTROL_CAMERA_MOTIONS,
  controlNets: VIDEO_STUDIO_CONTROL_CONTROLNETS,
  collaborations: VIDEO_STUDIO_CONTROL_COLLABORATION_LINKS,
};

// ════════════════════════════════════════════════════════════════════════
// ─── 音樂配音創作室（Pro Studio）/ 7 大分頁深度操作 ────────────────────
// ════════════════════════════════════════════════════════════════════════
//
// /pro-studio 有 7 個分頁：music / sfx / tts / clone / process / asr / avatar。
// ProStudio.tsx 透過 ProStudioAgentBridge ref 與子分頁對接，PageAgent setModel
// 會自動切到該模型的 tab。光球面板的責任是產出對的 AgentAction[] 並串到
// 對應的 setTab → setModel → fillPrompt → setParam → submit 流程。

export interface ProStudioGenericModel {
  id: string;
  label: string;
  emoji: string;
  description: string;
  tags?: string[];
  fast?: boolean;
}

// ─── Music（音樂生成）─────────────────────────────────────────────────

export const PRO_STUDIO_MUSIC_MODELS: ProStudioGenericModel[] = [
  { id: "sonauto", label: "Sonauto", emoji: "🎵", description: "AI 作曲、支援歌詞，快速從文字到完整歌曲", tags: ["歌詞", "快"], fast: true },
  { id: "ace-step", label: "ACE-Step", emoji: "💎", description: "高品質音樂生成，適合最終成片用配樂", tags: ["高品質"] },
  { id: "stable-audio", label: "Stable Audio", emoji: "🎚", description: "Stability 音樂模型，可控參數穩定輸出", tags: ["穩定", "可控"] },
  { id: "musicgen", label: "MusicGen", emoji: "🧪", description: "Meta 音樂生成，研究與風格探索", tags: ["探索"] },
];

export interface ProStudioPromptTemplate {
  id: string;
  label: string;
  emoji: string;
  prompt: string;
  suggestedModelId?: string;
  /** 套用模板時順便設定的參數（例：duration / instrumental / voiceId…） */
  params?: Array<{ key: string; value: unknown }>;
}

export const PRO_STUDIO_MUSIC_TEMPLATES: ProStudioPromptTemplate[] = [
  {
    id: "music-meditation",
    label: "冥想引導",
    emoji: "🧘",
    prompt: "ambient meditation, soft pads, gentle nature sounds, peaceful, 60bpm",
    suggestedModelId: "stable-audio",
    params: [{ key: "duration", value: 60 }, { key: "instrumental", value: true }],
  },
  {
    id: "music-cafe",
    label: "咖啡廳輕音樂",
    emoji: "☕",
    prompt: "soft jazz, acoustic guitar, mellow piano, warm cafe ambience, 80bpm",
    suggestedModelId: "ace-step",
    params: [{ key: "duration", value: 90 }, { key: "instrumental", value: true }],
  },
  {
    id: "music-cinematic",
    label: "電影配樂",
    emoji: "🎬",
    prompt: "cinematic orchestral score, emotional strings, gentle piano, slow build, 70bpm",
    suggestedModelId: "ace-step",
    params: [{ key: "duration", value: 60 }, { key: "instrumental", value: true }],
  },
  {
    id: "music-healing",
    label: "療癒音樂",
    emoji: "🌿",
    prompt: "healing ambient, crystal bowls, gentle synths, slow flowing pads, 432Hz, calm",
    suggestedModelId: "stable-audio",
    params: [{ key: "duration", value: 120 }, { key: "instrumental", value: true }],
  },
  {
    id: "music-lofi",
    label: "Lo-Fi 學習",
    emoji: "📚",
    prompt: "lo-fi hip hop beats, vinyl crackle, mellow keys, chill study vibes, 75bpm",
    suggestedModelId: "ace-step",
    params: [{ key: "duration", value: 90 }, { key: "instrumental", value: true }],
  },
  {
    id: "music-pop-vocal",
    label: "流行歌（含歌詞）",
    emoji: "🎤",
    prompt:
      "Pop song with vocals, catchy chorus, modern production, uplifting mood. [Verse 1] / [Chorus] / [Bridge]",
    suggestedModelId: "sonauto",
    params: [{ key: "duration", value: 120 }, { key: "instrumental", value: false }],
  },
];

export const PRO_STUDIO_MUSIC_DURATIONS: Array<{ id: string; label: string; value: number }> = [
  { id: "d30", label: "30 秒", value: 30 },
  { id: "d60", label: "60 秒", value: 60 },
  { id: "d90", label: "90 秒", value: 90 },
  { id: "d120", label: "2 分鐘", value: 120 },
  { id: "d180", label: "3 分鐘", value: 180 },
];

export const PRO_STUDIO_MUSIC_COLLABORATION_LINKS: StudioCollaborationLink[] = [
  { id: "music-prompt-coach", label: "幫我寫音樂 prompt", emoji: "✍️", description: "依情境擴寫成完整音樂提示詞與歌詞結構", chatPrompt: "我在音樂生成頁。請依我的需求擴寫成完整的英文音樂 prompt（含節奏 BPM / 樂器 / 情緒 / 結構），並用 [ACTION:fillPrompt:...] 直接幫我覆寫。" },
  { id: "music-recommend-model", label: "幫我選音樂模型", emoji: "🧭", description: "依需求挑 Sonauto / ACE-Step / Stable Audio / MusicGen", chatPrompt: "我在音樂分頁。請依我目前的需求（含人聲 / 高品質 / 穩定可控 / 風格探索），從 4 個音樂模型中推薦一個並用 [ACTION:setModel:...] 套用。" },
  { id: "music-handoff-sfx", label: "切到音效層", emoji: "🌧", description: "需要環境音效時把任務交給 sfx", chatPrompt: "我想為這段音樂加環境氛圍音（雨聲 / 海浪 / 森林…），帶我去 sfx 分頁並建議一個音效 prompt 與時長。" },
  { id: "music-director-score", label: "交給導演 AI 配樂", emoji: "🎬", description: "依分鏡規劃多段配樂", chatPrompt: "我有一段分鏡需要配樂。請依分鏡情緒幫我規劃 3-5 段音樂（每段指定模型 / 時長 / prompt），完成後帶我去 /director。" },
];

export interface ProStudioMusicProfile {
  pageId: "pro-studio";
  pagePath: "/pro-studio";
  activeTab: "music";
  models: ProStudioGenericModel[];
  templates: ProStudioPromptTemplate[];
  durations: typeof PRO_STUDIO_MUSIC_DURATIONS;
  collaborations: StudioCollaborationLink[];
}

export const PRO_STUDIO_MUSIC_PROFILE: ProStudioMusicProfile = {
  pageId: "pro-studio",
  pagePath: "/pro-studio",
  activeTab: "music",
  models: PRO_STUDIO_MUSIC_MODELS,
  templates: PRO_STUDIO_MUSIC_TEMPLATES,
  durations: PRO_STUDIO_MUSIC_DURATIONS,
  collaborations: PRO_STUDIO_MUSIC_COLLABORATION_LINKS,
};

// ─── SFX（音效生成）───────────────────────────────────────────────────

export const PRO_STUDIO_SFX_MODELS: ProStudioGenericModel[] = [
  { id: "sfx", label: "Sound Effects", emoji: "🔊", description: "ElevenLabs 文字生音效，環境音 / Foley / 擬真聲" },
];

export const PRO_STUDIO_SFX_TEMPLATES: ProStudioPromptTemplate[] = [
  { id: "sfx-rain", label: "雨聲", emoji: "🌧", prompt: "gentle rain on leaves, distant thunder, calm forest atmosphere", suggestedModelId: "sfx", params: [{ key: "duration_seconds", value: 30 }] },
  { id: "sfx-forest", label: "森林環境", emoji: "🌲", prompt: "forest ambience, birds chirping, leaves rustling, distant stream", suggestedModelId: "sfx", params: [{ key: "duration_seconds", value: 30 }] },
  { id: "sfx-ocean", label: "海浪聲", emoji: "🌊", prompt: "ocean waves on a calm beach, distant seagulls, gentle wind", suggestedModelId: "sfx", params: [{ key: "duration_seconds", value: 30 }] },
  { id: "sfx-fire", label: "壁爐火聲", emoji: "🔥", prompt: "crackling fireplace, warm cozy atmosphere, gentle wood pops", suggestedModelId: "sfx", params: [{ key: "duration_seconds", value: 30 }] },
  { id: "sfx-footsteps", label: "腳步聲", emoji: "👣", prompt: "footsteps on wooden floor, slow walking pace, indoor reverb", suggestedModelId: "sfx", params: [{ key: "duration_seconds", value: 10 }] },
  { id: "sfx-door", label: "開關門", emoji: "🚪", prompt: "wooden door creaking open, then closing softly with latch click", suggestedModelId: "sfx", params: [{ key: "duration_seconds", value: 5 }] },
];

export const PRO_STUDIO_SFX_DURATIONS: Array<{ id: string; label: string; value: number }> = [
  { id: "d3", label: "3 秒", value: 3 },
  { id: "d5", label: "5 秒", value: 5 },
  { id: "d10", label: "10 秒", value: 10 },
  { id: "d22", label: "22 秒（最長）", value: 22 },
];

export const PRO_STUDIO_SFX_COLLABORATION_LINKS: StudioCollaborationLink[] = [
  { id: "sfx-prompt-coach", label: "幫我寫音效 prompt", emoji: "✍️", description: "擴寫含材質 / 距離 / 空間感的擬真 Foley 描述", chatPrompt: "我在音效分頁。請依我想要的場景，擴寫成含材質 / 距離 / 空間感的英文 SFX prompt，並用 [ACTION:fillPrompt:...] 直接幫我覆寫。" },
  { id: "sfx-from-music", label: "搭配剛才的音樂", emoji: "🎵", description: "為剛生成的音樂加環境音層", chatPrompt: "我剛在 music 分頁生了一段音樂。請依音樂情緒推薦一個合適的環境音效當底層，幫我設好 prompt 與時長。" },
  { id: "sfx-handoff-process", label: "送去合成", emoji: "🧬", description: "音樂 + 音效合在一起", chatPrompt: "把音樂與音效兩段送到 process 分頁的 merge 工具合成一條完整音軌，建議混音策略。" },
  { id: "sfx-director-foley", label: "交給導演 AI 排 Foley", emoji: "🎬", description: "依分鏡規劃 Foley 列表", chatPrompt: "我需要一份分鏡 Foley 清單。請依分鏡情境列出每顆鏡頭的音效 prompt 與時長，完成後帶我去 /director。" },
];

export interface ProStudioSFXProfile {
  pageId: "pro-studio";
  pagePath: "/pro-studio";
  activeTab: "sfx";
  models: ProStudioGenericModel[];
  templates: ProStudioPromptTemplate[];
  durations: typeof PRO_STUDIO_SFX_DURATIONS;
  collaborations: StudioCollaborationLink[];
}

export const PRO_STUDIO_SFX_PROFILE: ProStudioSFXProfile = {
  pageId: "pro-studio",
  pagePath: "/pro-studio",
  activeTab: "sfx",
  models: PRO_STUDIO_SFX_MODELS,
  templates: PRO_STUDIO_SFX_TEMPLATES,
  durations: PRO_STUDIO_SFX_DURATIONS,
  collaborations: PRO_STUDIO_SFX_COLLABORATION_LINKS,
};

// ─── TTS（語音合成）───────────────────────────────────────────────────

export const PRO_STUDIO_TTS_MODELS: ProStudioGenericModel[] = [
  { id: "eleven-tts", label: "ElevenLabs TTS", emoji: "🎤", description: "多語言 / 多情緒，商業配音首選", tags: ["情緒", "多語"] },
  { id: "qwen-tts", label: "Qwen TTS", emoji: "🀄", description: "中文友善，自然語氣最穩", tags: ["中文"], fast: true },
];

export const PRO_STUDIO_TTS_TEMPLATES: ProStudioPromptTemplate[] = [
  { id: "tts-narration", label: "旁白朗讀", emoji: "📖", prompt: "在那個遙遠的午後，陽光穿過窗簾的縫隙，溫柔地撫過她的臉龐。", suggestedModelId: "qwen-tts" },
  { id: "tts-meditation", label: "冥想引導", emoji: "🧘", prompt: "輕輕閉上眼睛，深深地吸一口氣……感受空氣進入身體，慢慢地、慢慢地呼出。", suggestedModelId: "eleven-tts", params: [{ key: "speed", value: 0.85 }, { key: "stability", value: 0.7 }] },
  { id: "tts-advert", label: "廣告口播", emoji: "📢", prompt: "全新升級，限時優惠！立即點擊下方連結，享受獨家折扣。", suggestedModelId: "eleven-tts", params: [{ key: "speed", value: 1.05 }] },
  { id: "tts-teaching", label: "教學講解", emoji: "🎓", prompt: "今天我們要學的是反射動詞。它的核心概念是動作回到主詞自己身上……", suggestedModelId: "qwen-tts" },
  { id: "tts-children", label: "童書朗讀", emoji: "🐰", prompt: "從前從前，在一個彩虹的盡頭，住著一隻會說話的小兔子。", suggestedModelId: "eleven-tts", params: [{ key: "speed", value: 0.95 }, { key: "stability", value: 0.6 }] },
];

export const PRO_STUDIO_TTS_SPEED_PRESETS: Array<{ id: string; label: string; value: number; description: string }> = [
  { id: "slow", label: "慢 0.85", value: 0.85, description: "冥想 / 兒童朗讀" },
  { id: "natural", label: "自然 1.0", value: 1.0, description: "預設" },
  { id: "fast", label: "快 1.15", value: 1.15, description: "廣告 / 新聞口播" },
];

export const PRO_STUDIO_TTS_STABILITY_PRESETS: Array<{ id: string; label: string; value: number; description: string }> = [
  { id: "expressive", label: "情緒 0.4", value: 0.4, description: "戲劇 / 角色配音" },
  { id: "balanced", label: "平衡 0.6", value: 0.6, description: "預設" },
  { id: "stable", label: "穩定 0.85", value: 0.85, description: "教學 / 旁白" },
];

export const PRO_STUDIO_TTS_COLLABORATION_LINKS: StudioCollaborationLink[] = [
  { id: "tts-prompt-coach", label: "幫我潤稿", emoji: "✍️", description: "把口語稿件潤成適合朗讀的版本", chatPrompt: "我在 TTS 分頁。請把我貼的稿件潤成適合朗讀的版本（標點 / 換氣 / 短句），並用 [ACTION:fillPrompt:...] 幫我覆寫。" },
  { id: "tts-recommend-engine", label: "幫我選 TTS 引擎", emoji: "🧭", description: "依語言與情緒挑 Eleven / Qwen", chatPrompt: "依我稿件的語言與情緒，幫我從 ElevenLabs / Qwen 兩個引擎中挑一個並用 [ACTION:setModel:...] 套用。" },
  { id: "tts-from-clone", label: "用克隆聲線朗讀", emoji: "🎭", description: "切到 clone 建 voice_id 後回 TTS", chatPrompt: "我想用自己的聲線朗讀。先帶我去 clone 分頁建一個 voice_id（推薦 ElevenLabs IVC），完成後回 TTS 分頁套上 voiceId。" },
  { id: "tts-handoff-avatar", label: "交給 Avatar 變影片", emoji: "🎥", description: "TTS 結果接到 Avatar 嘴型同步", chatPrompt: "把這段 TTS 結果送到 avatar 分頁做嘴型同步影片，建議一個合適的 Avatar 模型與圖片來源。" },
];

export interface ProStudioTTSProfile {
  pageId: "pro-studio";
  pagePath: "/pro-studio";
  activeTab: "tts";
  models: ProStudioGenericModel[];
  templates: ProStudioPromptTemplate[];
  speedPresets: typeof PRO_STUDIO_TTS_SPEED_PRESETS;
  stabilityPresets: typeof PRO_STUDIO_TTS_STABILITY_PRESETS;
  collaborations: StudioCollaborationLink[];
}

export const PRO_STUDIO_TTS_PROFILE: ProStudioTTSProfile = {
  pageId: "pro-studio",
  pagePath: "/pro-studio",
  activeTab: "tts",
  models: PRO_STUDIO_TTS_MODELS,
  templates: PRO_STUDIO_TTS_TEMPLATES,
  speedPresets: PRO_STUDIO_TTS_SPEED_PRESETS,
  stabilityPresets: PRO_STUDIO_TTS_STABILITY_PRESETS,
  collaborations: PRO_STUDIO_TTS_COLLABORATION_LINKS,
};

// ─── Clone（聲音克隆）─────────────────────────────────────────────────

export const PRO_STUDIO_CLONE_MODELS: ProStudioGenericModel[] = [
  { id: "qwen-clone", label: "Qwen 克隆並朗讀", emoji: "🎙", description: "上傳樣本 → 用樣本聲朗讀，中文友善", fast: true },
  { id: "dia-clone", label: "Dia TTS 聲音克隆", emoji: "📢", description: "Dia TTS voice clone，旁白播報穩定" },
  { id: "voice-design", label: "Qwen 聲音設計", emoji: "🎭", description: "從零自定義音色，虛擬角色設計首選" },
  { id: "eleven-ivc", label: "ElevenLabs IVC", emoji: "💎", description: "建 voice_id，可跨 ElevenLabs 全家族重用" },
  { id: "kling-voice", label: "Kling 建立聲音", emoji: "🎬", description: "Kling 聲音檔，後續 Kling 影片流程銜接" },
];

export const PRO_STUDIO_CLONE_TEMPLATES: ProStudioPromptTemplate[] = [
  { id: "clone-narration", label: "克隆旁白", emoji: "📖", prompt: "請以溫暖、療癒的語氣朗讀這段內容。", suggestedModelId: "qwen-clone", params: [{ key: "mode", value: "qwen" }] },
  { id: "clone-dialog", label: "多人對話", emoji: "💬", prompt: "[S1] 你今天感覺如何？ [S2] 我覺得心情輕鬆了不少。", suggestedModelId: "dia-clone", params: [{ key: "mode", value: "dia" }] },
  { id: "clone-ivc", label: "建 voice_id", emoji: "🆔", prompt: "請示範 30 秒以上的乾淨語音用作參考樣本。", suggestedModelId: "eleven-ivc", params: [{ key: "mode", value: "elevenlabs" }] },
  { id: "clone-design-warm", label: "設計：溫暖女聲", emoji: "🌸", prompt: "你好，我是你設計出的聲音。", suggestedModelId: "voice-design", params: [{ key: "mode", value: "design" }, { key: "voice_description", value: "warm, gentle female voice, calm pace, healing tone" }] },
  { id: "clone-design-narrator", label: "設計：專業旁白男聲", emoji: "🎙", prompt: "歡迎收聽今天的故事。", suggestedModelId: "voice-design", params: [{ key: "mode", value: "design" }, { key: "voice_description", value: "deep, professional male narrator voice, steady pace, authoritative" }] },
];

export const PRO_STUDIO_CLONE_COLLABORATION_LINKS: StudioCollaborationLink[] = [
  { id: "clone-recommend-mode", label: "幫我選克隆模式", emoji: "🧭", description: "依需求挑 5 個克隆工具", chatPrompt: "我想克隆聲音。請依我的需求（中文 / 多角色 / 跨工具復用 / 自訂音色 / Kling 流程），從 5 個克隆工具中挑一個並用 [ACTION:setModel:...] 套用。" },
  { id: "clone-prompt-coach", label: "幫我寫聲音設計描述", emoji: "✍️", description: "擴寫 voice_description 含年齡 / 情緒 / 語速", chatPrompt: "我在 voice-design 模式。請依我想要的角色，擴寫一段 voice_description（含年齡 / 性別 / 情緒 / 語速 / 音域），並用 [ACTION:setParam:voice_description=...] 幫我套上。" },
  { id: "clone-handoff-tts", label: "拿到 voice_id 後送去 TTS", emoji: "🎤", description: "用建好的聲線到 TTS 朗讀", chatPrompt: "我已經拿到 voice_id 了。帶我回 tts 分頁並把 voiceId 自動填好，再建議一段測試稿件。" },
  { id: "clone-handoff-avatar", label: "送去 Avatar 變影片", emoji: "🎥", description: "克隆聲線 + Avatar 嘴型同步", chatPrompt: "把克隆出的聲音送到 avatar 分頁做嘴型同步影片，建議一個合適的 Avatar 模型。" },
];

export interface ProStudioCloneProfile {
  pageId: "pro-studio";
  pagePath: "/pro-studio";
  activeTab: "clone";
  models: ProStudioGenericModel[];
  templates: ProStudioPromptTemplate[];
  collaborations: StudioCollaborationLink[];
}

export const PRO_STUDIO_CLONE_PROFILE: ProStudioCloneProfile = {
  pageId: "pro-studio",
  pagePath: "/pro-studio",
  activeTab: "clone",
  models: PRO_STUDIO_CLONE_MODELS,
  templates: PRO_STUDIO_CLONE_TEMPLATES,
  collaborations: PRO_STUDIO_CLONE_COLLABORATION_LINKS,
};

// ─── Process（音訊處理）──────────────────────────────────────────────

export const PRO_STUDIO_PROCESS_MODELS: ProStudioGenericModel[] = [
  { id: "demucs", label: "Demucs 分軌", emoji: "🧬", description: "人聲 / 樂器分離，Remix 與伴奏抽離首選" },
  { id: "iso", label: "Audio Isolation", emoji: "🧹", description: "去噪 / 單軌萃取，口語修復" },
  { id: "merge", label: "音訊合併", emoji: "🎚", description: "多軌混音，背景音樂 + 人聲整合" },
  { id: "voice-changer", label: "變聲器", emoji: "🎭", description: "Voice Changer，角色變聲與語氣轉換" },
];

export const PRO_STUDIO_PROCESS_DEMUCS_MODELS: Array<{ id: string; label: string }> = [
  { id: "htdemucs", label: "HT Demucs（推薦）" },
  { id: "htdemucs_ft", label: "HT Demucs FT（精修）" },
  { id: "mdx_extra", label: "MDX Extra" },
  { id: "mdx_extra_q", label: "MDX Extra Q" },
];

export const PRO_STUDIO_PROCESS_MERGE_STRATEGIES: Array<{ id: string; label: string; description: string }> = [
  { id: "concat", label: "首尾相接", description: "把多段串接成一條" },
  { id: "overlay", label: "疊加混音", description: "多軌同時播放並混音" },
  { id: "crossfade", label: "交叉淡入淡出", description: "段落切換更自然" },
];

export const PRO_STUDIO_PROCESS_COLLABORATION_LINKS: StudioCollaborationLink[] = [
  { id: "process-recommend-tool", label: "幫我選處理工具", emoji: "🧭", description: "依素材挑 demucs / iso / merge / voice-changer", chatPrompt: "我在音訊處理分頁。請依素材狀況推薦 demucs / isolation / merge / voice-changer 其中一個，說明原因，並用 [ACTION:setModel:...] 套用。" },
  { id: "process-pipeline", label: "規劃多步處理", emoji: "🧪", description: "去噪 + 分軌 + 合併排成順序", chatPrompt: "我有一段未處理素材想做完整 cleanup。請依推薦順序排出 isolation → demucs → merge 工作流，每步指定工具與參數，完成後帶我去 /director。" },
  { id: "process-from-asr", label: "從 ASR 抓人聲", emoji: "📝", description: "ASR 後送到 isolation 萃取人聲", chatPrompt: "我先做 ASR 抓出文字，再來把 isolation 套上去萃取乾淨人聲，自動填好 audioUrl。" },
  { id: "process-director-postprod", label: "交給導演 AI 後製", emoji: "🎬", description: "完整影片後製音訊流", chatPrompt: "我有一段影片需要完整後製音訊（去噪 / 分軌 / 加環境音 / 合成）。請排出工作流，完成後帶我去 /director。" },
];

export interface ProStudioProcessProfile {
  pageId: "pro-studio";
  pagePath: "/pro-studio";
  activeTab: "process";
  models: ProStudioGenericModel[];
  demucsModels: typeof PRO_STUDIO_PROCESS_DEMUCS_MODELS;
  mergeStrategies: typeof PRO_STUDIO_PROCESS_MERGE_STRATEGIES;
  collaborations: StudioCollaborationLink[];
}

export const PRO_STUDIO_PROCESS_PROFILE: ProStudioProcessProfile = {
  pageId: "pro-studio",
  pagePath: "/pro-studio",
  activeTab: "process",
  models: PRO_STUDIO_PROCESS_MODELS,
  demucsModels: PRO_STUDIO_PROCESS_DEMUCS_MODELS,
  mergeStrategies: PRO_STUDIO_PROCESS_MERGE_STRATEGIES,
  collaborations: PRO_STUDIO_PROCESS_COLLABORATION_LINKS,
};

// ─── ASR（語音識別）──────────────────────────────────────────────────

export const PRO_STUDIO_ASR_MODELS: ProStudioGenericModel[] = [
  { id: "asr", label: "Speech to Text", emoji: "📝", description: "多語言語音轉文字，逐字稿與字幕初稿" },
];

export const PRO_STUDIO_ASR_ACCELERATIONS: Array<{ id: string; label: string; description: string }> = [
  { id: "none", label: "標準", description: "原模型品質最佳" },
  { id: "regular", label: "Regular", description: "速度 / 品質平衡" },
  { id: "high", label: "High", description: "速度最快" },
];

export const PRO_STUDIO_ASR_COLLABORATION_LINKS: StudioCollaborationLink[] = [
  { id: "asr-from-asset", label: "從資產拉一段音訊", emoji: "📦", description: "把過去生成的音訊拉過來轉字幕", chatPrompt: "把我最近在 pro-studio 生成的音訊拉過來做 ASR，自動填好 audioUrl。" },
  { id: "asr-handoff-tts", label: "ASR → 重新潤稿 → TTS", emoji: "🔁", description: "ASR 出稿後送到 TTS 重唸", chatPrompt: "我想做轉錄 → 潤稿 → 重唸的流程。先把這段做 ASR，把結果潤過再帶我去 tts 分頁朗讀。" },
  { id: "asr-handoff-process", label: "送去清音", emoji: "🧹", description: "辨識前先做 isolation 提升準確率", chatPrompt: "我素材有背景噪音。先帶我去 process/isolation 清音，再回 ASR 做轉錄，整條工作流幫我排好。" },
  { id: "asr-director-subtitle", label: "交給導演 AI 排字幕", emoji: "🎬", description: "規劃多語字幕翻譯流程", chatPrompt: "我需要把這段 ASR 結果做多語字幕。請規劃一份字幕工作流（含翻譯 / 校對），完成後帶我去 /director。" },
];

export interface ProStudioASRProfile {
  pageId: "pro-studio";
  pagePath: "/pro-studio";
  activeTab: "asr";
  models: ProStudioGenericModel[];
  accelerations: typeof PRO_STUDIO_ASR_ACCELERATIONS;
  collaborations: StudioCollaborationLink[];
}

export const PRO_STUDIO_ASR_PROFILE: ProStudioASRProfile = {
  pageId: "pro-studio",
  pagePath: "/pro-studio",
  activeTab: "asr",
  models: PRO_STUDIO_ASR_MODELS,
  accelerations: PRO_STUDIO_ASR_ACCELERATIONS,
  collaborations: PRO_STUDIO_ASR_COLLABORATION_LINKS,
};

// ─── Avatar（AI 形像影片）────────────────────────────────────────────

export const PRO_STUDIO_AVATAR_MODELS: ProStudioGenericModel[] = [
  { id: "wan-s2v", label: "Wan Speech-to-Video", emoji: "🎬", description: "語音 → 角色說話影片，快速口播", fast: true },
  { id: "echo-mimic", label: "EchoMimic", emoji: "👄", description: "口型同步精準，表情連動佳" },
  { id: "stable-avatar", label: "Stable Avatar", emoji: "🪞", description: "穩定主播型內容，一致性高" },
  { id: "longcat", label: "LongCat Avatar", emoji: "🐱", description: "長時段講解影片首選" },
  { id: "ltx-a2v", label: "LTX 音訊轉影片", emoji: "🎞", description: "音訊驅動動態視覺，開源流程" },
  { id: "dubbing", label: "Dubbing 配音", emoji: "🌐", description: "影片語言重配與本地化" },
];

export const PRO_STUDIO_AVATAR_DUBBING_LANGS: Array<{ id: string; label: string }> = [
  { id: "en", label: "英文 EN" },
  { id: "zh", label: "中文 ZH" },
  { id: "ja", label: "日文 JA" },
  { id: "ko", label: "韓文 KO" },
  { id: "es", label: "西班牙文 ES" },
  { id: "fr", label: "法文 FR" },
  { id: "de", label: "德文 DE" },
];

export const PRO_STUDIO_AVATAR_COLLABORATION_LINKS: StudioCollaborationLink[] = [
  { id: "avatar-recommend-model", label: "幫我選 Avatar 模型", emoji: "🧭", description: "依需求挑 6 個 Avatar 工具", chatPrompt: "我在 avatar 分頁。請依需求（口型精準 / 長片 / 配音翻譯 / 開源），從 6 個 Avatar 模型中推薦一個並用 [ACTION:setModel:...] 套用。" },
  { id: "avatar-from-tts", label: "用剛才的 TTS 當音源", emoji: "🎤", description: "TTS 結果接到 Avatar", chatPrompt: "把我剛在 tts 分頁生成的音訊當作 Avatar 的 audioUrl，建議一個合適的人像圖片來源。" },
  { id: "avatar-from-image", label: "從 image-studio 拿人像", emoji: "🖼", description: "用生成的人像當 Avatar 主體", chatPrompt: "把我最近在 image-studio 生成的人像當作 avatar 的 imageUrl，自動切到 avatar 分頁並建議一個 Avatar 模型。" },
  { id: "avatar-director-narration", label: "交給導演 AI 排講解片", emoji: "🎬", description: "規劃多段講解影片", chatPrompt: "我要做一支系列講解影片。請依主題切成 3-5 段，每段指定 Avatar 模型 / 音源 / 圖源，完成後帶我去 /director。" },
];

export interface ProStudioAvatarProfile {
  pageId: "pro-studio";
  pagePath: "/pro-studio";
  activeTab: "avatar";
  models: ProStudioGenericModel[];
  dubbingLangs: typeof PRO_STUDIO_AVATAR_DUBBING_LANGS;
  collaborations: StudioCollaborationLink[];
}

export const PRO_STUDIO_AVATAR_PROFILE: ProStudioAvatarProfile = {
  pageId: "pro-studio",
  pagePath: "/pro-studio",
  activeTab: "avatar",
  models: PRO_STUDIO_AVATAR_MODELS,
  dubbingLangs: PRO_STUDIO_AVATAR_DUBBING_LANGS,
  collaborations: PRO_STUDIO_AVATAR_COLLABORATION_LINKS,
};

// ─── Pro Studio 共用 builder ─────────────────────────────────────────

export type ProStudioTab =
  | "music"
  | "sfx"
  | "tts"
  | "clone"
  | "process"
  | "asr"
  | "avatar";

export function buildProStudioSetModelActions(
  tab: ProStudioTab,
  modelId: string
): AgentAction[] {
  return [
    { type: "setTab", tabId: tab },
    { type: "setModel", modelId },
  ];
}

export function buildProStudioFillPromptActions(
  tab: ProStudioTab,
  text: string,
  append = false
): AgentAction[] {
  return [
    { type: "setTab", tabId: tab },
    { type: "fillPrompt", text, append },
  ];
}

export function buildProStudioSetParamActions(
  tab: ProStudioTab,
  key: string,
  value: unknown
): AgentAction[] {
  return [
    { type: "setTab", tabId: tab },
    { type: "setParam", key, value },
  ];
}

export function buildProStudioApplyTemplateActions(
  tab: ProStudioTab,
  template: ProStudioPromptTemplate
): AgentAction[] {
  const actions: AgentAction[] = [{ type: "setTab", tabId: tab }];
  if (template.suggestedModelId) {
    actions.push({ type: "setModel", modelId: template.suggestedModelId });
  }
  actions.push({ type: "fillPrompt", text: template.prompt, append: false });
  if (template.params) {
    for (const p of template.params) {
      actions.push({ type: "setParam", key: p.key, value: p.value });
    }
  }
  return actions;
}
