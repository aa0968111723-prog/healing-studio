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
 *   - agent-plan:     步步 (plan-executor) 專用 — 真實規劃 + 跨工具執行
 *                     (trpc.spirit.plan → run → status 輪詢)
 *   - page-execution: 編編 (composer) 專用 — 解析使用者一句話為 AgentAction[]
 *                     並 dispatch 到當頁；解析不出來才 fall through 到 LLM。
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
      /**
       * 步步專屬：被 @ 時走「真實規劃 + 執行」agent 流程，不是只回人格回覆。
       *
       * 客戶端流程：
       *   1. 把使用者的訊息當 goal 餵 trpc.spirit.plan → 拿 PlanRecord 預演卡
       *   2. 在 chat 顯示「步驟 1..N + 預估點數」+ 兩顆按鈕（▶ 開跑 / ✕ 取消）
       *   3. 按開跑 → trpc.spirit.run，並以 1.5s 輪詢 trpc.spirit.status 把每步
       *      狀態更新進 chat（✓ 完成 / ✗ 失敗 / ⏸ 暫停）
       *   4. 失敗 → 提供「替代方案 / 跳過 / 整條中止」按鈕，按了就打 spirit.replan
       *
       * 跟 llm-persona 的差別：那條只回「我會這樣做」的人話；這條真的去做。
       */
      kind: "agent-plan";
      /** Prompt 至少這麼長才觸發 — 太短當成閒聊，fall through 到 LLM 人格。 */
      minPromptChars: number;
    }
  | {
      /**
       * 編編 (composer) 專用：在當頁直接執行使用者的指令。客戶端會：
       *   1. 看 currentPage.snapshot.capabilities，把使用者一句話翻成
       *      AgentAction[] (fillPrompt / setModel / setParam / submit …)
       *   2. dispatch 進現有的 executeActions pipeline
       *   3. 解析不出任何動作（太抽象 / 缺資訊）→ fall through 到 LLM，
       *      讓編編的 system prompt 切片帶回 actions JSON 或反問
       * 沒站在工作室頁時 (snapshot.capabilities 空) 會自動退到 LLM 並
       * 提示使用者先去 /image-studio /video-studio /pro-studio。
       */
      kind: "page-execution";
      /** Prompt 至少要這麼長才嘗試解析 — 太短直接走 LLM。 */
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
  // 靈靈：search 站內靈感 / 素材 + 用 LLM 給示範提示詞
  "inspiration-specialist": { kind: "search", minPromptChars: 3 },
  // 體體：真實打 fal.ai 模型產出解剖圖
  "anatomy-specialist": { kind: "fal-generation", minPromptChars: 6 },

  // ─── 6 位通用工作流：路路真的跳頁 / 查查真的搜尋 / 其他用 LLM 人格 ──
  navigator: {
    kind: "navigate",
    intentBased: true,
    arrivalHint: "路路帶你到了。",
  },
  researcher: { kind: "search", minPromptChars: 3 },
  director:  { kind: "llm-persona" },
  // 編編：被 @ 時真的會在當頁動手 — 解析自然語言成 AgentAction[] 並
  // dispatch。解析不出來 / 不在工作室頁，自動 fall back 到 LLM 用編編
  // 的人格切片產出 actions JSON。
  composer:  { kind: "page-execution", minPromptChars: 4 },
  critic:    { kind: "llm-persona" },
  companion: { kind: "llm-persona" },

  // ─── 3 位主動：對話框內走 LLM 人格（主動觸發另有事件 bus） ──
  accountant:      { kind: "llm-persona" },
  "quality-coach": { kind: "llm-persona" },
  inspector:       { kind: "llm-persona" },

  // ─── 7 位新增精靈 ───────────────────────────────────────────
  // 法律 / 資安 / 輔導：被 @ 時走 LLM 人格給建議；主動觸發另有 event bus
  "legal-advisor":      { kind: "llm-persona" },
  "security-guard":     { kind: "llm-persona" },
  "onboarding-coach":   { kind: "llm-persona" },
  // 社群經理：知識諮詢型，走 LLM 人格（產素材時會交棒給 specialist）
  "community-manager":  { kind: "llm-persona" },
  // 總管：純文字討論團隊狀態
  "chief-orchestrator": { kind: "llm-persona" },
  // 記記：跳到 /notes 中心翻舊素材 / 建立筆記
  "notes-curator": {
    kind: "navigate",
    toPath: "/notes",
    arrivalHint: "記記帶你到筆記中心，搜尋或建立都可以。",
  },
  // 細細：跳到 /settings
  "settings-detail": {
    kind: "navigate",
    toPath: "/settings",
    arrivalHint: "細細帶你到設定頁，告訴我要調哪個我直接帶你切過去。",
  },
  // 步步：被 @ 時走真實 agent — 規劃 + 跨工具執行 + 失敗修補，不再只是
  // 「人格回覆」。少於 minPromptChars 視為閒聊，fall through 到 LLM 人格。
  "plan-executor": { kind: "agent-plan", minPromptChars: 6 },
};

export function getChatToolForSpirit(role: AgentRole): SpiritChatTool {
  return SPIRIT_CHAT_TOOLS[role];
}
