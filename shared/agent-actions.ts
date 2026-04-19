/**
 * shared/agent-actions.ts — 光球 AI 代理人的結構化動作協議
 *
 * 目的：讓光球（ProactiveOrbWidget / OrbGuide / ai.chat LLM 回傳）
 *       能用一組型別安全的 action 去驅動任何頁面的內部狀態。
 *
 * 放在 shared 層的原因：
 *   - 前端（PageAgentContext）與後端（ai.chat router / siteKnowledge prompt）
 *     都需要知道這些 action 的形狀
 *   - 可被 vitest 純邏輯測試（node 環境）直接 import
 *
 * Phase 1 只定義型別與純函式（queue / 合併），不引入執行邏輯。
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── Modality / Mode / Personality 共用字面量 ─────────────────────────────

export type AgentModality = "image" | "video" | "audio" | "voice";

/** Studio 三檔創作模式 */
export type AgentCreativeMode = "inspiration" | "standard" | "professional";

// ─── AgentAction — 結構化動作聯集 ─────────────────────────────────────────

/** 將文字填入當頁的主要提示詞輸入框 */
export interface FillPromptAction {
  type: "fillPrompt";
  text: string;
  /** true = 附加到現有內容末端；false/undefined = 覆寫 */
  append?: boolean;
  /** 若頁面有多個輸入框，可指定槽位 id，例如 "prompt" | "negativePrompt" | "lyrics" */
  slot?: string;
}

/** 將當頁模型切換到某個 modelId（例如 ImageStudio 的 23 種） */
export interface SetModelAction {
  type: "setModel";
  modelId: string;
}

/** 切換當頁主要分頁（例如 ImageStudio t2i/i2i/upscale…） */
export interface SetTabAction {
  type: "setTab";
  tabId: string;
}

/** 切換當頁模式（例如 Studio 的 inspiration/standard/professional） */
export interface SetModeAction {
  type: "setMode";
  modeId: AgentCreativeMode | string;
}

/** 切換主模態（只在支援的頁面生效，例如 Studio） */
export interface SetModalityAction {
  type: "setModality";
  modality: AgentModality;
}

/** 以 key/value 設定一個具名參數（例如 cfg, steps, seed, length） */
export interface SetParamAction {
  type: "setParam";
  key: string;
  value: unknown;
}

/** 套用一組預設（例如 InspirationPreset 或頁面自帶的 VibeCard） */
export interface ApplyPresetAction {
  type: "applyPreset";
  presetId: string;
}

/** 送出生成 */
export interface SubmitAction {
  type: "submit";
  /** 可選：送出前要等的毫秒數（用來配合畫面動畫） */
  delayMs?: number;
}

/** 重設當頁表單 */
export interface ResetAction {
  type: "reset";
}

/** 導航到指定路徑（由 orb 層處理，頁面端不會收到這個） */
export interface NavigateAction {
  type: "navigate";
  path: string;
}

/** 聚焦到頁面上的一個元素（`id`），通常用於視覺引導 */
export interface FocusElementAction {
  type: "focusElement";
  elementId: string;
  /** 可選引導訊息 */
  message?: string;
}

export type AgentAction =
  | FillPromptAction
  | SetModelAction
  | SetTabAction
  | SetModeAction
  | SetModalityAction
  | SetParamAction
  | ApplyPresetAction
  | SubmitAction
  | ResetAction
  | NavigateAction
  | FocusElementAction;

export type AgentActionType = AgentAction["type"];

// ─── Action 執行結果 ─────────────────────────────────────────────────────

export type AgentActionResult =
  | { ok: true; message?: string }
  | { ok: false; reason: string };

// ─── Capability — 頁面對外宣告「我能做什麼」 ─────────────────────────────

export interface AgentCapabilityOption {
  id: string;
  label: string;
  description?: string;
  /** 自由形式 meta，例如模型的 category / speed / quality */
  meta?: Record<string, unknown>;
}

export interface AgentCapability {
  /** 此能力對應的 action type（例如 "setModel"） */
  action: AgentActionType;
  /** 顯示給 LLM/orb UI 的短標籤（例如「模型」「分頁」） */
  label: string;
  /** 可選：列舉該 action 支援的候選值（例如全部模型、全部 tab） */
  options?: AgentCapabilityOption[];
  /** 目前選中的 option id（若適用） */
  currentId?: string;
  /** 自由形式補充說明，會被餵進 LLM prompt */
  hint?: string;
}

// ─── PageAgentSnapshot — 頁面向 LLM 揭示的即時狀態 ───────────────────────

export interface PageAgentSnapshot {
  pageId: string;
  pageLabel: string;
  pagePath: string;
  capabilities: AgentCapability[];
  /** 任意即時狀態（promptLength, remainingCredits, isGenerating…） */
  state?: Record<string, unknown>;
}

// ─── Pending Action Queue — 純函式，方便 server 側測試 ──────────────────
//
// 情境：光球在 ProactiveOrbWidget 呼叫 navigate() 後，目標頁面還沒掛載，
// 我們得把 autoFillPrompt / autoTabId 等動作暫存起來，等頁面 register()
// 之後立刻 drain。Phase 1 只實作 queue 的「加入 / 讀取 / 過濾」邏輯。

export interface PendingAction {
  /** 預期是哪個 pageId 來消費（若未指定 = 任何頁面都可 drain） */
  targetPageId?: string;
  action: AgentAction;
  /** 建立時的 timestamp（ms），用來過期清掉 */
  createdAt: number;
}

export const PENDING_ACTION_TTL_MS = 15_000;

/** 把一個動作推入 queue；會過濾掉同槽位的舊項目（最後寫入為準） */
export function enqueueAction(
  queue: PendingAction[],
  next: PendingAction
): PendingAction[] {
  const deduped = queue.filter(
    item =>
      !(
        item.targetPageId === next.targetPageId &&
        item.action.type === next.action.type &&
        sameSlot(item.action, next.action)
      )
  );
  return [...deduped, next];
}

/**
 * 取出要給指定 pageId 執行的動作，並從 queue 中移除。
 * 會過濾掉過期（> TTL）與 type="navigate"（orb 自己處理）的項目。
 */
export function drainActionsForPage(
  queue: PendingAction[],
  pageId: string,
  now: number = Date.now()
): { drained: AgentAction[]; rest: PendingAction[] } {
  const drained: AgentAction[] = [];
  const rest: PendingAction[] = [];
  for (const item of queue) {
    const expired = now - item.createdAt > PENDING_ACTION_TTL_MS;
    if (expired) continue;
    if (item.action.type === "navigate") continue;
    const targetMatches =
      item.targetPageId === undefined || item.targetPageId === pageId;
    if (targetMatches) {
      drained.push(item.action);
    } else {
      rest.push(item);
    }
  }
  return { drained, rest };
}

/**
 * 解析來自 LLM（`ai.chat`）回傳的 actions 陣列，過濾掉無效項目。
 * 前端接到 LLM 回應後會呼叫這個函式，再交給 bus dispatch。
 */
export function parseLLMActions(
  raw: unknown
): AgentAction[] {
  if (!Array.isArray(raw)) return [];
  const out: AgentAction[] = [];
  for (const item of raw) {
    const action = coerceAgentAction(item);
    if (action) out.push(action);
  }
  return out;
}

/** 盡量把一個外部物件（LLM 回應 / 舊事件 detail）轉成嚴格的 AgentAction */
export function coerceAgentAction(input: unknown): AgentAction | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, any>;
  const type = obj.type ?? obj.action;
  if (typeof type !== "string") return null;

  switch (type) {
    case "fillPrompt":
      if (typeof obj.text !== "string") return null;
      return {
        type: "fillPrompt",
        text: obj.text,
        append: obj.append === true,
        slot: typeof obj.slot === "string" ? obj.slot : undefined,
      };
    case "setModel":
      if (typeof (obj.modelId ?? obj.payload) !== "string") return null;
      return { type: "setModel", modelId: String(obj.modelId ?? obj.payload) };
    case "setTab":
      if (typeof (obj.tabId ?? obj.payload) !== "string") return null;
      return { type: "setTab", tabId: String(obj.tabId ?? obj.payload) };
    case "setMode":
      if (typeof (obj.modeId ?? obj.payload) !== "string") return null;
      return { type: "setMode", modeId: String(obj.modeId ?? obj.payload) };
    case "setModality":
    case "modality": {
      const raw = obj.modality ?? obj.payload;
      if (!isModality(raw)) return null;
      return { type: "setModality", modality: raw };
    }
    case "setParam":
      if (typeof obj.key !== "string") return null;
      return { type: "setParam", key: obj.key, value: obj.value };
    case "applyPreset":
    case "preset":
      if (typeof (obj.presetId ?? obj.payload) !== "string") return null;
      return {
        type: "applyPreset",
        presetId: String(obj.presetId ?? obj.payload),
      };
    case "submit":
    case "generate":
      return {
        type: "submit",
        delayMs: typeof obj.delayMs === "number" ? obj.delayMs : undefined,
      };
    case "reset":
      return { type: "reset" };
    case "navigate":
      if (typeof (obj.path ?? obj.payload) !== "string") return null;
      return { type: "navigate", path: String(obj.path ?? obj.payload) };
    case "focusElement":
    case "focus":
      if (typeof (obj.elementId ?? obj.payload) !== "string") return null;
      return {
        type: "focusElement",
        elementId: String(obj.elementId ?? obj.payload),
        message: typeof obj.message === "string" ? obj.message : undefined,
      };
    default:
      return null;
  }
}

function isModality(v: unknown): v is AgentModality {
  return v === "image" || v === "video" || v === "audio" || v === "voice";
}

// ─── Phase 1.5：意圖 / 回饋 / 確認 輔助層 ────────────────────────────────
//
// 這一層的目的是讓光球「裝載真正的代理人模型（MiniMax M2.7）」時，
// 仍然能保留「不讓使用者焦慮」的核心原則：
//   - 所有破壞性動作（submit / reset / applyPreset / setModality…）
//     都要先請使用者確認
//   - 使用者的接受 / 修改 / 拒絕會回流給下一輪 LLM，讓他學會你的偏好
//   - 頁面能力 + 當前狀態以結構化形式送給 LLM，減少幻覺
//
// 都是純函式，可在 node / vitest 環境直接呼叫。

/** 光球動作是否屬於「需要使用者確認」的類型 */
export function isDestructiveAction(action: AgentAction): boolean {
  switch (action.type) {
    case "submit":
    case "reset":
    case "applyPreset":
    case "setModality":
      return true;
    default:
      return false;
  }
}

/**
 * 把動作轉成給使用者看的繁中摘要（放在確認卡片上）。
 * 故意保持柔軟、邀請式語氣，不用命令句。
 */
export function summarizeAction(action: AgentAction): string {
  switch (action.type) {
    case "fillPrompt": {
      const preview = action.text.length > 40
        ? action.text.slice(0, 40) + "…"
        : action.text;
      const slotLabel =
        action.slot === "negativePrompt"
          ? "負面提示詞"
          : action.slot === "lyrics"
          ? "歌詞"
          : "提示詞";
      return action.append
        ? `想把「${preview}」補到${slotLabel}後面`
        : `想把${slotLabel}換成「${preview}」`;
    }
    case "setModel":
      return `想把模型切到「${action.modelId}」`;
    case "setTab":
      return `想幫你切到「${action.tabId}」分頁`;
    case "setMode":
      return `想幫你切到「${action.modeId}」模式`;
    case "setModality":
      return `想幫你切到「${action.modality}」創作`;
    case "setParam":
      return `想把 ${action.key} 設成 ${JSON.stringify(action.value)}`;
    case "applyPreset":
      return `想套用「${action.presetId}」這組預設`;
    case "submit":
      return "想幫你送出這次生成";
    case "reset":
      return "想把這一頁的設定重置";
    case "navigate":
      return `想帶你去 ${action.path}`;
    case "focusElement":
      return action.message ?? `想指出「${action.elementId}」這個地方`;
  }
}

/** 光球預覽/確認卡片會用到的 intent 結構 */
export interface AgentIntent {
  /** 簡潔的「我想怎麼做」 */
  summary: string;
  /** 可選：為什麼這樣建議 */
  reason?: string;
  /** 要執行的動作 */
  action: AgentAction;
  /** 派送來源：ai-chat / orb-guide / manual */
  source?: "ai-chat" | "orb-guide" | "manual";
}

// ─── Feedback — 使用者對光球動作的回應 ──────────────────────────────────

export type AgentFeedbackStatus =
  | "accepted" // 使用者按了確認
  | "edited" // 使用者改了再送
  | "cancelled" // 使用者按了先不要
  | "completed" // handler 回報成功
  | "failed"; // handler 回報失敗 / 丟例外

export interface AgentFeedbackEvent {
  at: number;
  status: AgentFeedbackStatus;
  actionType: AgentActionType;
  /** 可選：使用者說的話（從聊天輸入框擷取） */
  note?: string;
  /** 可選：頁面上下文（pageId） */
  pageId?: string;
}

/** 最多保留幾筆近期回饋；太多會污染 prompt */
export const AGENT_FEEDBACK_HISTORY_CAP = 8;

/** 往尾端新增一筆回饋，超過上限則丟棄最舊的 */
export function pushFeedback(
  list: AgentFeedbackEvent[],
  event: AgentFeedbackEvent,
  cap: number = AGENT_FEEDBACK_HISTORY_CAP
): AgentFeedbackEvent[] {
  const next = [...list, event];
  if (next.length <= cap) return next;
  return next.slice(next.length - cap);
}

/** 把 feedback 歷史壓成給 LLM 的一行文字；空列回空字串 */
export function serializeFeedbackForPrompt(
  list: AgentFeedbackEvent[],
  now: number = Date.now()
): string {
  if (!list.length) return "";
  const lines = list.slice(-5).map(ev => {
    const ageSec = Math.max(0, Math.round((now - ev.at) / 1000));
    const note = ev.note ? `（${ev.note}）` : "";
    return `- ${ev.actionType}: ${ev.status}${note}｜${ageSec}s 前`;
  });
  return `【使用者最近對光球建議的反應】\n${lines.join("\n")}`;
}

// ─── Snapshot 序列化 — 讓 LLM 真正看見頁面能力 ─────────────────────────

/**
 * 把頁面 snapshot 壓成 ~600 字內的繁中描述丟進 system prompt。
 * LLM 看到這段後就能用正確的 modelId / tabId / presetId 回覆 [ACTION:...]。
 */
export function serializeSnapshotForPrompt(
  snapshot: PageAgentSnapshot | null | undefined
): string {
  if (!snapshot) return "";
  const lines: string[] = [];
  lines.push(
    `【使用者目前在「${snapshot.pageLabel}」（${snapshot.pagePath}，pageId=${snapshot.pageId}）】`
  );
  if (snapshot.capabilities.length > 0) {
    lines.push("【此頁可用的代理人動作】");
    for (const cap of snapshot.capabilities) {
      const optCount = cap.options?.length ?? 0;
      const current = cap.currentId ? `（目前=${cap.currentId}）` : "";
      const head = `- ${cap.label} [${cap.action}]${current}`;
      lines.push(head);
      if (optCount > 0 && cap.options) {
        const opts = cap.options
          .slice(0, 12)
          .map(o => o.id)
          .join(", ");
        const more = optCount > 12 ? `…+${optCount - 12} 個` : "";
        lines.push(`  可選：${opts}${more}`);
      }
      if (cap.hint) lines.push(`  備註：${cap.hint}`);
    }
  }
  if (snapshot.state && Object.keys(snapshot.state).length > 0) {
    const stateKeys = Object.keys(snapshot.state).slice(0, 8);
    const parts = stateKeys.map(k => {
      const v = (snapshot.state as Record<string, unknown>)[k];
      const s = typeof v === "string" ? v : JSON.stringify(v);
      const trimmed = s && s.length > 40 ? s.slice(0, 40) + "…" : s;
      return `${k}=${trimmed}`;
    });
    lines.push(`【即時狀態】${parts.join(" · ")}`);
  }
  return lines.join("\n");
}

// ─── OrbChatResponse — 新版 ai.chat 回傳形狀（向後相容） ───────────────

export interface OrbChatResponse {
  reply: string;
  actions: Array<{ type: string; payload: string }>;
  /** 新增：光球想做什麼的自然語言摘要（給確認卡片用） */
  intent?: string | null;
  /** 新增：使用者在執行前是否要先確認 */
  askBeforeAct?: boolean;
  /** 新增：快速回覆建議（「好啊」「再想想」「換個模型」） */
  suggestions?: string[];
}

/** 兩個 action 是否指向同一個「槽位」（用於 enqueue 去重） */
function sameSlot(a: AgentAction, b: AgentAction): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "fillPrompt" && b.type === "fillPrompt") {
    return (a.slot ?? "prompt") === (b.slot ?? "prompt");
  }
  if (a.type === "setParam" && b.type === "setParam") {
    return a.key === b.key;
  }
  return true;
}
