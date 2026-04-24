/**
 * server/services/orbReplyParser.ts
 *
 * 把 LLM 回傳的原始字串（含 `[ACTION:...]`、`[INTENT:...]`、`[CONFIRM:...]`、
 * `[SUGGEST:...]` marker）解析成給前端用的結構化資料。
 *
 * 這檔案刻意不依賴 tRPC / Zod / DB，單純是字串→物件的純函式，
 * 方便在 node 環境下用 vitest 做大量回歸測試。
 */

export type OrbRawAction = { type: string; payload: string };
export type OrbRawToolCall = {
  name: string;
  args: Record<string, unknown>;
};

export interface OrbParsedReply {
  /** LLM 去除所有 marker 後的純文字回覆 */
  reply: string;
  /** 白名單過濾後的動作清單，順序同 LLM 原文 */
  actions: Array<OrbRawAction | Record<string, unknown>>;
  /** LLM 自述的意圖摘要（若無則為 null） */
  intent: string | null;
  /** 是否要求使用者在執行前先確認（破壞性動作與 alwaysConfirm 會強制 true） */
  askBeforeAct: boolean;
  /** 快速回覆建議（最多 4 條，每條 1~20 字） */
  suggestions: string[];
  /** 可選：讓前端/後端 tool executor 執行的 API 呼叫 */
  toolCalls: OrbRawToolCall[];
  /** 可選：schema-first planner 原始輸出（前端可用 adaptAgentPlanToActions 轉換） */
  plannerOutput?: unknown;
}

/**
 * ai.chat 可接受的 action type 白名單：
 *   - legacy 路徑（Studio 舊實作仍在用）：navigate / preset / modality / focus /
 *     generate / refine / export
 *   - Phase 1 PageAgent bus：fillPrompt / setModel / setTab / setMode /
 *     setModality / setParam / applyPreset / submit / reset / focusElement
 */
export const ORB_ALLOWED_ACTIONS = new Set([
  // Legacy
  "navigate",
  "preset",
  "modality",
  "focus",
  "generate",
  "refine",
  "export",
  // PageAgent bus
  "fillPrompt",
  "setModel",
  "setTab",
  "setMode",
  "setModality",
  "setParam",
  "applyPreset",
  "submit",
  "reset",
  "focusElement",
  // Phase 4：全站代理人擴展
  "openDialog",
  "search",
  "toggleSetting",
  "runWorkflow",
]);

/**
 * 破壞性動作集合：即使 LLM 沒標 `[CONFIRM:true]`，只要出現這些動作，
 * 我們一律視為要使用者確認。
 */
export const ORB_DESTRUCTIVE_ACTIONS = new Set([
  "submit",
  "reset",
  "applyPreset",
  "preset",
  "generate",
  "runWorkflow",
]);

export const ORB_ALLOWED_TOOL_NAME = /^[a-z][a-z0-9_.-]{1,63}$/i;

function toRawActionPayload(action: Record<string, unknown>): string {
  if (typeof action.payload === "string") return action.payload;
  if (typeof action.text === "string") return action.text;
  if (typeof action.path === "string") return action.path;
  if (typeof action.modelId === "string") return action.modelId;
  if (typeof action.tabId === "string") return action.tabId;
  if (typeof action.modeId === "string") return action.modeId;
  if (typeof action.modality === "string") return action.modality;
  if (typeof action.presetId === "string") return action.presetId;
  if (typeof action.query === "string") return action.query;
  if (typeof action.elementId === "string") return action.elementId;
  if (typeof action.dialogId === "string") return action.dialogId;
  return "";
}

/**
 * 把 LLM 回覆字串解析成結構化物件。
 *
 * @param rawReply LLM 的原始輸出字串
 * @param opts.alwaysConfirm 若為 true，只要有任何動作都會強制要求確認
 */
export function parseOrbReply(
  rawReply: string,
  opts: { alwaysConfirm?: boolean } = {}
): OrbParsedReply {
  if (!rawReply) {
    return {
      reply: "",
      actions: [],
      intent: null,
      askBeforeAct: false,
      suggestions: [],
      toolCalls: [],
    };
  }

  const trimmed = rawReply.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const plannerOutput = parsed.plannerOutput ?? parsed.agentPlan ?? parsed.plan;
      const reply =
        typeof parsed.reply === "string"
          ? parsed.reply
          : typeof parsed.message === "string"
          ? parsed.message
          : "";
      const intent = typeof parsed.intent === "string" ? parsed.intent : null;
      const suggestions = Array.isArray(parsed.suggestions)
        ? parsed.suggestions
            .filter((s): s is string => typeof s === "string")
            .map(s => s.trim())
            .filter(s => s.length > 0 && s.length <= 20)
            .slice(0, 4)
        : [];
      const toolCalls = Array.isArray(parsed.toolCalls)
        ? parsed.toolCalls
            .filter(
              (t): t is { name: string; args?: Record<string, unknown> } =>
                !!t && typeof t === "object" && typeof (t as { name?: unknown }).name === "string"
            )
            .map(t => ({
              name: t.name,
              args: t.args && typeof t.args === "object" && !Array.isArray(t.args) ? t.args : {},
            }))
        : [];
      const actions = Array.isArray(parsed.actions)
        ? parsed.actions
            .filter(
              (a): a is Record<string, unknown> =>
                !!a &&
                typeof a === "object" &&
                typeof ((a as Record<string, unknown>).type ?? (a as Record<string, unknown>).action) === "string" &&
                ORB_ALLOWED_ACTIONS.has(
                  String((a as Record<string, unknown>).type ?? (a as Record<string, unknown>).action)
                )
            )
            .map((a) => ({
              ...a,
              type: String(a.type ?? a.action),
              payload: typeof a.payload === "string" ? a.payload : toRawActionPayload(a),
            }))
        : [];

      const confirmExplicit = typeof parsed.askBeforeAct === "boolean";
      const hasDestructive = actions.some(a => ORB_DESTRUCTIVE_ACTIONS.has(a.type));
      let askBeforeAct = parsed.askBeforeAct === true;
      if (!confirmExplicit && hasDestructive) askBeforeAct = true;
      if (opts.alwaysConfirm && (actions.length > 0 || !!plannerOutput)) askBeforeAct = true;

      return {
        reply,
        actions,
        intent,
        askBeforeAct,
        suggestions,
        toolCalls,
        plannerOutput,
      };
    } catch {
      // JSON parse failed -> fallback to marker parser below
    }
  }

  // ── ACTION markers ─────────────────────────────────────────────
  const actionPattern = /\[ACTION:(\w+):([^\]]*)\]/g;
  const actions: OrbRawAction[] = [];
  let reply = rawReply;
  let match: RegExpExecArray | null;
  while ((match = actionPattern.exec(rawReply)) !== null) {
    if (ORB_ALLOWED_ACTIONS.has(match[1])) {
      actions.push({ type: match[1], payload: match[2] });
    }
    reply = reply.replace(match[0], "");
  }
  reply = reply.trim();

  // ── INTENT marker ──────────────────────────────────────────────
  let intent: string | null = null;
  const intentMatch = /\[INTENT:([^\]]+)\]/.exec(reply);
  if (intentMatch) {
    intent = intentMatch[1].trim();
    reply = reply.replace(intentMatch[0], "").trim();
  }

  // ── CONFIRM marker ─────────────────────────────────────────────
  let askBeforeAct = false;
  let confirmExplicit = false;
  const confirmMatch = /\[CONFIRM:(true|false)\]/i.exec(reply);
  if (confirmMatch) {
    askBeforeAct = confirmMatch[1].toLowerCase() === "true";
    confirmExplicit = true;
    reply = reply.replace(confirmMatch[0], "").trim();
  }

  // ── SUGGEST marker ─────────────────────────────────────────────
  const suggestions: string[] = [];
  const suggestMatch = /\[SUGGEST:([^\]]+)\]/.exec(reply);
  if (suggestMatch) {
    suggestMatch[1]
      .split("|")
      .map(s => s.trim())
      .filter(s => s.length > 0 && s.length <= 20)
      .slice(0, 4)
      .forEach(s => suggestions.push(s));
    reply = reply.replace(suggestMatch[0], "").trim();
  }

  // ── TOOL markers ────────────────────────────────────────────────
  const toolCalls: OrbRawToolCall[] = [];
  const toolPattern = /\[TOOL:([a-zA-Z0-9_.-]+):([^\]]*)\]/g;
  while ((match = toolPattern.exec(rawReply)) !== null) {
    const name = match[1].trim();
    if (!ORB_ALLOWED_TOOL_NAME.test(name)) continue;
    let args: Record<string, unknown> = {};
    const rawPayload = match[2].trim();
    if (rawPayload.length > 0) {
      try {
        const decoded = decodeURIComponent(rawPayload);
        const parsed = JSON.parse(decoded) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>;
        }
      } catch {
        // ignore malformed payload
      }
    }
    toolCalls.push({ name, args });
    reply = reply.replace(match[0], "");
  }
  reply = reply.trim();

  // ── Confirm gate：破壞性動作 + alwaysConfirm 的保險絲 ─────────
  const hasDestructive = actions.some(a => ORB_DESTRUCTIVE_ACTIONS.has(a.type));
  if (!confirmExplicit && hasDestructive) askBeforeAct = true;
  if (opts.alwaysConfirm && actions.length > 0) askBeforeAct = true;

  return { reply, actions, intent, askBeforeAct, suggestions, toolCalls };
}
