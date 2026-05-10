/**
 * shared/spirit-chat-tools.ts
 *
 * 15 位精靈在對話框內可呼叫的工具定義 — 純 metadata，不執行任何邏輯。
 *
 * 客戶端 GlobalOrbChatContext.sendMessage 攔截 `@nickname` 時，依這份表
 * 決定要走哪條路：
 *   - fal-generation: 真實打 fal.ai 模型（透過 trpc.spirit.invoke）
 *   - navigate:       純客戶端跳頁（emit navigate AgentAction）
 *   - search:         打 trpc.orbProxy.unifiedSearch 並把結果秀回來
 *   - llm-persona:    fall through 到既有 LLM 流程，由 selectRoleForIntent
 *                     套上該精靈的人格切片回應
 *
 * 收 collab：除了 llm-persona 以外的工具完成後，會以
 * `SPIRIT_COLLAB_PROTOCOL` 提供下一棒精靈作為建議按鈕，按了就把
 * `@nextSpirit ...` 拼進輸入框（或自動發送），形成 15 位協作鏈。
 *
 * 同步原則：新增 / 刪除 AgentRole 必須同步這份表（type 強制覆蓋整個 union）。
 */

import type { AgentRole } from "./orb-agent-roles";

export type SpiritChatTool =
  | {
      /** 該精靈在對話框被 @ 時，真的會打 fal.ai 模型出圖 / 出影 / 出聲 / 出訓練。 */
      kind: "fal-generation";
      /** Prompt 至少要這麼長才觸發 — 太短可能只是打招呼。 */
      minPromptChars: number;
    }
  | {
      /** 純跳頁。toPath 是固定目的地；intentBased=true 則用 detectNavIntent 推。 */
      kind: "navigate";
      toPath?: string;
      intentBased?: boolean;
      /** 跳完後在 chat 顯示的提示文字模板。 */
      arrivalHint: string;
    }
  | {
      /** 打 unifiedSearch 把站內結果丟回對話框。 */
      kind: "search";
      minPromptChars: number;
    }
  | {
      /** 沒有特殊工具 — fall through 到 LLM 並由 selectRoleForIntent 套人格。 */
      kind: "llm-persona";
    };

export const SPIRIT_CHAT_TOOLS: Record<AgentRole, SpiritChatTool> = {
  // ─── 6 位專精：4 位真實 fal 生成 + 1 位訓練 + 1 位學習導覽 ──
  "image-specialist":    { kind: "fal-generation", minPromptChars: 6 },
  "video-specialist":    { kind: "fal-generation", minPromptChars: 6 },
  "music-specialist":    { kind: "fal-generation", minPromptChars: 6 },
  "voice-specialist":    { kind: "fal-generation", minPromptChars: 6 },
  "training-specialist": { kind: "fal-generation", minPromptChars: 6 },
  "learning-specialist": {
    kind: "navigate",
    toPath: "/learn-hub",
    arrivalHint: "學學帶你到教學中心，挑一個主題開始。",
  },

  // ─── 6 位通用工作流：路路真的跳頁 / 查查真的搜尋 / 其他用 LLM 人格 ──
  navigator: {
    kind: "navigate",
    intentBased: true,
    arrivalHint: "路路帶你到了。",
  },
  researcher: { kind: "search", minPromptChars: 3 },
  director:  { kind: "llm-persona" },
  composer:  { kind: "llm-persona" },
  critic:    { kind: "llm-persona" },
  companion: { kind: "llm-persona" },

  // ─── 3 位主動：對話框內走 LLM 人格（主動觸發另有事件 bus） ──
  accountant:      { kind: "llm-persona" },
  "quality-coach": { kind: "llm-persona" },
  inspector:       { kind: "llm-persona" },
};

export function getChatToolForSpirit(role: AgentRole): SpiritChatTool {
  return SPIRIT_CHAT_TOOLS[role];
}
