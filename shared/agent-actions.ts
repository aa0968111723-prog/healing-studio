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

/** 開啟頁面上的對話框或面板（例如資產詳情、設定面板） */
export interface OpenDialogAction {
  type: "openDialog";
  dialogId: string;
  /** 可選：傳給對話框的參數 */
  params?: Record<string, unknown>;
}

/** 在頁面內觸發搜尋（例如資產庫、歷史、提示詞庫、資料庫的搜尋框） */
export interface SearchAction {
  type: "search";
  query: string;
  /** 可選的二級過濾：給支援 mediaType 過濾的頁面用（例如資料庫） */
  mediaType?: string;
  /** 可選的二級過濾：分類字串 */
  lineage?: string;
}

/** 切換二元設定（例如深色模式、自動儲存、靜音） */
export interface ToggleSettingAction {
  type: "toggleSetting";
  key: string;
  value?: boolean;
}

/**
 * 把目前聊天歷史匯出成 PDF（透過瀏覽器列印對話框 → 另存 PDF）。
 * 由 GlobalOrbChatContext 在客戶端處理；不會被 dispatch 到任何頁面。
 */
export interface ExportChatPdfAction {
  type: "exportChatPdf";
  /** 匯出範圍。預設 "all"（最近 7 天 / 100 條訊息上限內全部）。 */
  scope?: "all" | "today" | "this-week";
  /** 自訂 PDF 標題。預設「光球聊天記錄」。 */
  title?: string;
}

/**
 * 用既有 process-spec encoder 把目標（例：上一個 pending workflow、目前聊天的
 * 步驟摘要）打包成可分享的 `/process?spec=...` 連結，並複製到剪貼簿。
 */
export interface ShareViaLinkAction {
  type: "shareViaLink";
  /**
   * 要分享什麼：
   *  - "lastWorkflow"：最近一次的 pending / 已執行 workflow
   *  - "currentChat"：目前聊天歷史摘要成一張流程清單
   *  - "studioState"：創作工作室當下的提示詞 / 模態 / 模型 / 各模態參數
   *    （不需要已跑過 workflow，純讀 PageAgentSnapshot.state）
   */
  target: "lastWorkflow" | "currentChat" | "studioState";
  /** 自訂分享標題。 */
  title?: string;
}

/** 複合任務：光球可以一次描述多步驟計畫，前端依序執行 */
export interface RunWorkflowAction {
  type: "runWorkflow";
  /** 工作流程的人類可讀名稱 */
  name: string;
  /** 依序要執行的子步驟 */
  steps: AgentWorkflowStep[];
  /**
   * 步驟確認策略：
   *  - "all-at-once" / undefined：用整體確認卡（舊行為）。
   *  - "step-by-step"：每步 dispatch 前呼叫 ctx.confirmStep，使用者可逐步審查。
   *  - "high-risk-only"：只在破壞性步驟（submit/reset/applyPreset）前停下來。
   */
  confirmationMode?: "all-at-once" | "step-by-step" | "high-risk-only";
}

/** 交由後端直接執行的創作任務（不經前端 page agent dispatch） */
export interface ExecuteTaskAction {
  type: "execute_task";
  task: {
    type: "generate_image" | "generate_music" | "generate_video";
    params: Record<string, unknown>;
  };
  /** 後端執行完成後補回 URL */
  resultUrl?: string;
}

export interface WorkflowRequiredInput {
  key: string;
  label: string;
  required: boolean;
  defaultValue?: string;
  example?: string;
}

/** 工作流程子步驟（簡化版，只包含 navigate + 單一動作） */
export interface AgentWorkflowStep {
  /**
   * Inputs required before this step can run. The agent should collect
   * these once before cross-page execution begins.
   */
  requiredInputs?: WorkflowRequiredInput[];
  /** 目標頁面路徑（可選，不填表示在當頁執行） */
  path?: string;
  /** 到站後要執行的動作類型 */
  actionType: string;
  /** 動作參數 */
  payload: string;
  /** 給使用者看的步驟說明 */
  label: string;
  /**
   * Stable id used by the DAG scheduler. When present together with
   * `dependsOn`, the parallel orchestrator can build a topological order;
   * when absent, the legacy sequential executor uses declared order.
   */
  id?: string;
  /** Step ids this step waits for before running. */
  dependsOn?: string[];
  /**
   * 若設定，此步驟走工具呼叫（server-side tRPC）而非 UI dispatch。
   * orchestrator 會優先檢查 toolName；有值時忽略 actionType/payload。
   */
  toolName?: string;
  /**
   * 工具呼叫的參數，支援 `${stepId.key}` 佔位符引用前面步驟的工具結果。
   * 由 orb-step-ref-resolver 在執行前展開。
   */
  toolArgs?: Record<string, unknown>;
  /**
   * 工具呼叫完成後要把結果掛在哪個邏輯名稱下，方便後續步驟用
   * `${binding.key}` 引用。預設等同 `id`。
   */
  toolResultBinding?: string;
  /**
   * 失敗重試 / 跳過策略。預設 maxAttempts=1（不重試）、skipOnFail=false。
   */
  retryPolicy?: {
    maxAttempts: number;
    backoffMs?: number;
    skipOnFail?: boolean;
  };
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
  | FocusElementAction
  | OpenDialogAction
  | SearchAction
  | ToggleSettingAction
  | ExecuteTaskAction
  | RunWorkflowAction
  | ExportChatPdfAction
  | ShareViaLinkAction;

export type AgentActionType = AgentAction["type"];

// ─── Action 執行結果 ─────────────────────────────────────────────────────

export type AgentActionResult =
  | {
      ok: true;
      message?: string;
      /**
       * Optional structured snapshot the page handler can return so the
       * agent loop can observe what actually happened (was the prompt
       * filled? which model is now active? did the generation succeed
       * with what URL?). Backwards compatible — handlers may continue
       * returning `{ ok: true }` and stay valid; observer + planner pull
       * this when present and ignore when absent.
       *
       * Keep payloads small (< ~1 kB serialised) — they're forwarded to
       * the LLM observer prompt and persisted in an in-memory per-task
       * page-state ring buffer.
       */
      data?: Record<string, unknown>;
    }
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
  activeMode?: string;
  activeModel?: string;
  selectedPreset?: string;
  availableModels?: string[];
  availableModes?: string[];
  availableParameters?: string[];
  currentPrompt?: string;
  hasUnsavedChanges?: boolean;
  warnings?: string[];
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

/**
 * 將 schema-first planner 的原始輸出適配成既有 AgentAction[]。
 *
 * 支援常見形狀：
 * - `AgentAction[]`
 * - `{ actions: AgentAction[] }`
 * - `{ steps: AgentWorkflowStep[] }`（會包成單一 runWorkflow）
 * - `{ workflow: {...} }` / `{ runWorkflow: {...} }`
 */
export function adaptAgentPlanToActions(rawPlannerOutput: unknown): AgentAction[] {
  if (!rawPlannerOutput) return [];

  if (Array.isArray(rawPlannerOutput)) {
    return parseLLMActions(rawPlannerOutput);
  }

  if (typeof rawPlannerOutput !== "object") return [];
  const obj = rawPlannerOutput as Record<string, unknown>;

  if (Array.isArray(obj.actions)) {
    return parseLLMActions(obj.actions);
  }

  const nestedWorkflow = obj.workflow ?? obj.runWorkflow;
  if (nestedWorkflow && typeof nestedWorkflow === "object") {
    const coerced = coerceAgentAction({
      type: "runWorkflow",
      ...(nestedWorkflow as Record<string, unknown>),
    });
    return coerced ? [coerced] : [];
  }

  if (Array.isArray(obj.steps)) {
    const steps = obj.steps
      .filter(
        (s: unknown): s is Record<string, unknown> => {
          if (!s || typeof s !== "object") return false;
          const rec = s as Record<string, unknown>;
          return typeof rec.actionType === "string" || typeof rec.toolName === "string";
        }
      )
      .map(coerceWorkflowStep);

    if (steps.length > 0) {
      return [{
        type: "runWorkflow",
        name: typeof obj.name === "string" ? obj.name : "AI Agent Plan",
        steps,
      }];
    }

    // steps 不是 workflow step，當作普通 actions steps 再試一次
    return parseLLMActions(obj.steps);
  }

  // 兜底：若本體已是單一 action 物件
  const one = coerceAgentAction(obj);
  return one ? [one] : [];
}

/** 盡量把一個外部物件（LLM 回應 / 舊事件 detail）轉成嚴格的 AgentAction */
export function coerceAgentAction(input: unknown): AgentAction | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, any>;
  const type = obj.type ?? obj.action;
  if (typeof type !== "string") return null;

  switch (type) {
    case "fillPrompt": {
      const text = typeof obj.text === "string" ? obj.text : obj.payload;
      if (typeof text !== "string") return null;
      return {
        type: "fillPrompt",
        text,
        append: obj.append === true,
        slot: typeof obj.slot === "string" ? obj.slot : undefined,
      };
    }
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
    case "openDialog": {
      const dialogId = obj.dialogId ?? obj.payload;
      if (typeof dialogId !== "string") return null;
      const legacyAssetId = obj.assetId;
      const mergedParams =
        obj.params && typeof obj.params === "object" && !Array.isArray(obj.params)
          ? { ...obj.params }
          : {};
      if (legacyAssetId !== undefined && mergedParams.assetId === undefined) {
        mergedParams.assetId = legacyAssetId;
      }
      return {
        type: "openDialog",
        dialogId: String(dialogId),
        params: Object.keys(mergedParams).length > 0 ? mergedParams : undefined,
      };
    }
    case "search": {
      const query = obj.query ?? obj.payload;
      if (typeof query !== "string") return null;
      return { type: "search", query: String(query) };
    }
    case "toggleSetting": {
      const key = obj.key ?? obj.payload;
      if (typeof key !== "string") return null;
      return {
        type: "toggleSetting",
        key: String(key),
        value: typeof obj.value === "boolean" ? obj.value : undefined,
      };
    }
    case "exportChatPdf":
    case "exportPdf": {
      const scope =
        obj.scope === "today" || obj.scope === "this-week" || obj.scope === "all"
          ? obj.scope
          : undefined;
      return {
        type: "exportChatPdf",
        ...(scope ? { scope } : {}),
        ...(typeof obj.title === "string" && obj.title ? { title: obj.title } : {}),
      };
    }
    case "shareViaLink":
    case "share": {
      const target =
        obj.target === "lastWorkflow" ||
        obj.target === "currentChat" ||
        obj.target === "studioState"
          ? obj.target
          : "lastWorkflow";
      return {
        type: "shareViaLink",
        target,
        ...(typeof obj.title === "string" && obj.title ? { title: obj.title } : {}),
      };
    }
    case "runWorkflow": {
      const name = obj.name ?? obj.payload;
      if (typeof name !== "string") return null;
      const steps = Array.isArray(obj.steps) ? obj.steps : [];
      const confirmationMode =
        obj.confirmationMode === "step-by-step" ||
        obj.confirmationMode === "high-risk-only" ||
        obj.confirmationMode === "all-at-once"
          ? obj.confirmationMode
          : undefined;
      return {
        type: "runWorkflow",
        name: String(name),
        steps: steps
          .filter(
            (s: unknown): s is Record<string, unknown> => {
              if (!s || typeof s !== "object") return false;
              const rec = s as Record<string, unknown>;
              // Tool-call steps may omit actionType entirely; UI-dispatch
              // steps must declare actionType:string.
              return typeof rec.actionType === "string" || typeof rec.toolName === "string";
            }
          )
          .map(coerceWorkflowStep),
        ...(confirmationMode ? { confirmationMode } : {}),
      };
    }
    default:
      return null;
  }
}

function isModality(v: unknown): v is AgentModality {
  return v === "image" || v === "video" || v === "audio" || v === "voice";
}

/**
 * Coerce a raw workflow step object (LLM-emitted or DB-loaded) into a strict
 * `AgentWorkflowStep`. Preserves the optional advanced fields
 * (`id`, `dependsOn`, `toolName`, `toolArgs`, `toolResultBinding`,
 * `retryPolicy`) so the orchestrator can route tool-call steps and replan.
 */
function coerceWorkflowStep(s: Record<string, unknown>): AgentWorkflowStep {
  const out: AgentWorkflowStep = {
    path: typeof s.path === "string" ? s.path : undefined,
    actionType: typeof s.actionType === "string" ? s.actionType : "",
    payload: typeof s.payload === "string" ? s.payload : "",
    label: typeof s.label === "string" ? s.label : String(s.actionType ?? s.toolName ?? "step"),
  };
  if (typeof s.id === "string" && s.id) out.id = s.id;
  if (Array.isArray(s.dependsOn)) {
    const deps = s.dependsOn.filter((d): d is string => typeof d === "string" && d.length > 0);
    if (deps.length > 0) out.dependsOn = deps;
  }
  if (typeof s.toolName === "string" && s.toolName) out.toolName = s.toolName;
  if (s.toolArgs && typeof s.toolArgs === "object" && !Array.isArray(s.toolArgs)) {
    out.toolArgs = { ...(s.toolArgs as Record<string, unknown>) };
  }
  if (typeof s.toolResultBinding === "string" && s.toolResultBinding) {
    out.toolResultBinding = s.toolResultBinding;
  }
  if (s.retryPolicy && typeof s.retryPolicy === "object" && !Array.isArray(s.retryPolicy)) {
    const rp = s.retryPolicy as Record<string, unknown>;
    const maxAttempts = typeof rp.maxAttempts === "number" && rp.maxAttempts >= 1
      ? Math.floor(rp.maxAttempts)
      : 1;
    const policy: AgentWorkflowStep["retryPolicy"] = { maxAttempts };
    if (typeof rp.backoffMs === "number" && rp.backoffMs >= 0) {
      policy.backoffMs = rp.backoffMs;
    }
    if (typeof rp.skipOnFail === "boolean") policy.skipOnFail = rp.skipOnFail;
    out.retryPolicy = policy;
  }
  return out;
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
    case "execute_task":
    case "runWorkflow":
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
    case "openDialog":
      return `想幫你打開「${action.dialogId}」面板`;
    case "search":
      return `想幫你搜尋「${action.query.length > 30 ? action.query.slice(0, 30) + "…" : action.query}」`;
    case "toggleSetting":
      return action.value !== undefined
        ? `想把「${action.key}」${action.value ? "開啟" : "關閉"}`
        : `想幫你切換「${action.key}」設定`;
    case "execute_task":
      return `想直接幫你執行「${action.task.type}」`;
    case "runWorkflow": {
      const stepCount = action.steps.length;
      return `想幫你執行「${action.name}」計畫（共 ${stepCount} 步）`;
    }
    case "exportChatPdf": {
      const scopeLabel =
        action.scope === "today"
          ? "今天"
          : action.scope === "this-week"
          ? "本週"
          : "全部";
      return `想幫你把${scopeLabel}的聊天記錄整理成 PDF`;
    }
    case "shareViaLink":
      return action.target === "currentChat"
        ? "想幫你把這段對話打包成可分享的流程連結"
        : action.target === "studioState"
          ? "想幫你把目前創作工作室的設定打包成可分享連結"
          : "想幫你把剛剛的工作流程打包成可分享連結";
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

/**
 * Phase 3c：把「本 session 的 feedback」與「DB 長期記憶」合併成一份給 prompt 的清單。
 *
 * 規則：
 *   - 兩邊以 at（timestamp ms）為基準合併
 *   - 依時間新到舊排序
 *   - 最多取 cap 筆，預設 12（比 session cap 8 多一點，給長期記憶一點空間）
 *   - 同一筆事件（at + actionType + status 三合一完全相同）視為重複，去重
 *
 * 純函式，不動 DB／不動 state；適合在 server 側 ai.chat 組 prompt 時使用。
 *
 * 型別刻意寬鬆（actionType 收 string 而非 AgentActionType union），因為：
 *   - server 從 DB / Zod 收到的是字串
 *   - serializeFeedbackForPrompt 只會把它丟進 template，不做分支
 *   - 未來 LLM 端新增動作時不用改這邊的 signature
 */
export type FeedbackEventLike = Omit<AgentFeedbackEvent, "actionType"> & {
  actionType: string;
};

export function mergeFeedbackHistories<T extends FeedbackEventLike>(
  sessionEvents: T[] | undefined,
  dbEvents: T[] | undefined,
  cap: number = 12
): T[] {
  const a = sessionEvents ?? [];
  const b = dbEvents ?? [];
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const ev of [...a, ...b]) {
    const key = `${ev.at}|${ev.actionType}|${ev.status}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(ev);
  }
  merged.sort((x, y) => y.at - x.at);
  return merged.slice(0, Math.max(0, cap));
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
  plannerOutput?: unknown;
  toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
  /** 新增：光球想做什麼的自然語言摘要（給確認卡片用） */
  intent?: string | null;
  /** 新增：使用者在執行前是否要先確認 */
  askBeforeAct?: boolean;
  /** 新增：快速回覆建議（「好啊」「再想想」「換個模型」） */
  suggestions?: string[];
}

// ─── Phase 3d-hybrid：OrbGuide 逐題 LLM 軟化 / 擴充 / 跳題 ────────────────
//
// 規則 skeleton 繼續由 INTENT_CONFIGS 提供（哪個 intent → 哪幾題、預設選項、
// 預設 orbMessage / promptHint）。Phase 3d-hybrid 讓 MiniMax 在每一步多做幾件事：
//   - 把當前題目的開場白軟化（softenedQuestion）
//   - 視答案情境補 0–2 個貼情境的額外選項
//   - 若答案已收斂可建議跳過下一題
//   - 最後一題時，可改寫 orbMessage / promptHint（但 schema 由規則端決定）
//
// LLM 任何欄位缺失、超長、格式錯 → fallback 回 stock，使用者無感。
// 所有型別與解析器都放在這層純函式，vitest 可直接測。

export type OrbGuidePersonality = "calm" | "creative" | "technical";

export interface OrbGuideAnsweredEntry {
  questionId: string;
  value: string;
  /** 選項中文 label（給 LLM 更易讀） */
  label?: string;
}

export interface OrbGuideStockOption {
  label: string;
  value: string;
  emoji: string;
}

export interface OrbGuideStepContext {
  /** intent id，例如 "image" / "video" */
  intent: string;
  /** intent 顯示名稱，例如 "生成圖像" */
  intentLabel: string;
  /** 要去的頁面標籤 */
  targetLabel: string;
  /** 當前個性 */
  personality: OrbGuidePersonality;
  /** 使用者已回答過的 Q/A */
  answeredSoFar: OrbGuideAnsweredEntry[];
  /** 當前題目（若 isFinalStep=true 時可能為 undefined） */
  currentQuestion?: {
    id: string;
    stockText: string;
    stockOptions: OrbGuideStockOption[];
  };
  /** 這題是不是收尾那題（用來決定 LLM 是否可改寫 finalOverrides） */
  isFinalStep: boolean;
  /** 收尾時規則端算好的 orb message / prompt hint，給 LLM 當參考 */
  stockOrbMessage?: string;
  stockPromptHint?: string;
}

export interface OrbGuideStepRewrite {
  /** 軟化後的開場白；空字串 = 沿用 stockText */
  softenedQuestion?: string;
  /** 情境額外選項，最多 2 個 */
  extraOptions?: OrbGuideStockOption[];
  /** true = 可以跳過下一題（由 UI 自行決定要不要採納） */
  skipNext?: boolean;
  /** 收尾用的 orb message 改寫 */
  orbMessageOverride?: string;
  /** 收尾用的 prompt hint 改寫（英文，會餵進生成模型） */
  promptHintOverride?: string;
}

const ORB_GUIDE_LIMITS = {
  /** 單題開場白最大長度（超過會被裁掉） */
  questionMaxLen: 80,
  /** 最多幾個 LLM 額外選項 */
  extraOptionsCap: 2,
  /** 選項 label / emoji / value 長度 */
  optionLabelMaxLen: 12,
  optionValueMaxLen: 32,
  orbMessageMaxLen: 120,
  promptHintMaxLen: 240,
} as const;

/** 回給 LLM 的 system prompt；純函式，可直接 snapshot-test */
export function buildOrbGuideStepPrompt(ctx: OrbGuideStepContext): string {
  const toneGuide = ctx.personality === "calm"
    ? "語氣溫柔、平靜、不壓迫"
    : ctx.personality === "technical"
    ? "語氣直接、清晰、不囉嗦"
    : "語氣活潑、有創意感、友善";

  const answeredBlock = ctx.answeredSoFar.length
    ? ctx.answeredSoFar
        .map(e => `- ${e.questionId} = ${e.label ?? e.value}`)
        .join("\n")
    : "（還沒回答任何題目）";

  const currentBlock = ctx.currentQuestion
    ? [
        `這題 id：${ctx.currentQuestion.id}`,
        `這題預設開場白：「${ctx.currentQuestion.stockText}」`,
        `這題預設選項（你不用重複這些，只補情境額外的）：`,
        ...ctx.currentQuestion.stockOptions.map(
          o => `  - ${o.label} (${o.value})`
        ),
      ].join("\n")
    : "（這步已沒有題目，收尾中）";

  const finalBlock = ctx.isFinalStep
    ? `\n這一步是收尾。規則端算好的草稿是：
- orb_message 草稿：「${ctx.stockOrbMessage ?? ""}」
- prompt_hint 草稿：「${ctx.stockPromptHint ?? ""}」
你可以改寫這兩句，讓它更貼使用者的答案與個性；prompt_hint 請保持英文、技術關鍵字。`
    : "\n這一步還沒到收尾，請把 final_overrides 留空。";

  return [
    "你是一個引導式創作助手「光球」的一部分，每一步只做「軟化問題 + 補選項 + 決定是否跳題」。",
    `你正在陪使用者走「${ctx.intentLabel}」的流程，最終會帶他去「${ctx.targetLabel}」。`,
    `當前個性：${ctx.personality}（${toneGuide}）。`,
    "",
    "【已收集到的答案】",
    answeredBlock,
    "",
    "【當前題目】",
    currentBlock,
    finalBlock,
    "",
    "你只回 JSON，不要加任何解釋或 markdown。欄位：",
    "- softened_question: 這題的開場白重寫（繁中，80 字內，沿用預設意思但更軟更貼答案）",
    "- extra_options: 情境額外選項（最多 2 個；不要跟預設重複；label 中文 12 字內）",
    "- skip_next: 如果答案已經足夠收斂，可以提議跳過下一題（true/false）",
    "- final_overrides: 只在收尾步驟填；非收尾時請回 null",
    "任何欄位不確定就省略或回空字串／null，絕不編造事實或連結。",
  ].join("\n");
}

/**
 * 解析 LLM 回傳的 JSON（字串或已 parse 的物件都接），嚴格 sanitize。
 * 任何異常 / 超出限制 / 格式不對 → 對應欄位留空，caller 退回 stock。
 */
export function parseOrbGuideStepReply(
  raw: string | unknown,
  ctx: OrbGuideStepContext
): OrbGuideStepRewrite {
  const parsed = typeof raw === "string" ? tryParseJson(raw) : raw;
  if (!parsed || typeof parsed !== "object") return {};
  const obj = parsed as Record<string, any>;

  const out: OrbGuideStepRewrite = {};

  // softened_question
  const sq = cleanString(obj.softened_question ?? obj.softenedQuestion);
  if (sq) {
    out.softenedQuestion = truncate(sq, ORB_GUIDE_LIMITS.questionMaxLen);
  }

  // extra_options
  const rawOpts = obj.extra_options ?? obj.extraOptions;
  if (Array.isArray(rawOpts)) {
    const seenValues = new Set(
      (ctx.currentQuestion?.stockOptions ?? []).map(o => o.value)
    );
    const cleaned: OrbGuideStockOption[] = [];
    for (const item of rawOpts) {
      if (!item || typeof item !== "object") continue;
      const label = cleanString((item as any).label);
      const value = cleanString((item as any).value);
      const emoji = cleanString((item as any).emoji);
      if (!label || !value || !emoji) continue;
      if (seenValues.has(value)) continue;
      seenValues.add(value);
      cleaned.push({
        label: truncate(label, ORB_GUIDE_LIMITS.optionLabelMaxLen),
        value: truncate(value, ORB_GUIDE_LIMITS.optionValueMaxLen),
        emoji: truncate(emoji, 4),
      });
      if (cleaned.length >= ORB_GUIDE_LIMITS.extraOptionsCap) break;
    }
    if (cleaned.length) out.extraOptions = cleaned;
  }

  // skip_next
  const skip = obj.skip_next ?? obj.skipNext;
  if (typeof skip === "boolean" && skip && ctx.answeredSoFar.length > 0 && !ctx.isFinalStep) {
    out.skipNext = true;
  }

  // final_overrides — 只在 isFinalStep 才接
  if (ctx.isFinalStep) {
    const fo = obj.final_overrides ?? obj.finalOverrides;
    if (fo && typeof fo === "object") {
      const om = cleanString((fo as any).orb_message ?? (fo as any).orbMessage);
      if (om) out.orbMessageOverride = truncate(om, ORB_GUIDE_LIMITS.orbMessageMaxLen);
      const ph = cleanString((fo as any).prompt_hint ?? (fo as any).promptHint);
      if (ph) out.promptHintOverride = truncate(ph, ORB_GUIDE_LIMITS.promptHintMaxLen);
    }
  }

  return out;
}

function tryParseJson(raw: string): unknown {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^\uFEFF/, "");
  if (!trimmed) return null;
  // MiniMax 偶爾會用 ```json … ``` 包起來，先剝掉
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}

function cleanString(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u001F\u007F]/g, "").trim();
}

function truncate(v: string, max: number): string {
  return v.length <= max ? v : v.slice(0, max);
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
