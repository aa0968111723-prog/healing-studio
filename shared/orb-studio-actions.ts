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
