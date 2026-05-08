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
