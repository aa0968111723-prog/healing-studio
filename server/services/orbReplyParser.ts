/**
 * server/services/orbReplyParser.ts
 *
 * 把 LLM 回傳的原始字串（含 `[ACTION:...]`、`[INTENT:...]`、`[CONFIRM:...]`、
 * `[SUGGEST:...]` marker）解析成給前端用的結構化資料。
 *
 * 這檔案刻意不依賴 tRPC / Zod / DB，單純是字串→物件的純函式，
 * 方便在 node 環境下用 vitest 做大量回歸測試。
 */

import {
  buildContextualClarificationOptions,
  extractPhantomPlanQuestion,
  isPhantomPlanReply,
} from "../../shared/orb-clarification-options";

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
  /** LLM 判斷使用者輸入過於模糊時，要求先反問釐清而非派動作 */
  needsClarification: boolean;
  /** 反問的問題文字（needsClarification=true 時必填） */
  clarificationQuestion?: string;
  /** 反問時提供的快速選項（最多 4 條，每條 1~24 字） */
  clarificationOptions?: string[];
  /** Citations the planner used (memory / page / tool / web). */
  citations?: Array<{
    kind: "memory" | "page" | "tool" | "web";
    id: string;
    label?: string;
  }>;
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
  "execute_task",
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
  "fillPrompt",
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
  opts: { alwaysConfirm?: boolean; userText?: string } = {}
): OrbParsedReply {
  if (!rawReply) {
    return {
      reply: "",
      actions: [],
      intent: null,
      askBeforeAct: false,
      suggestions: [],
      toolCalls: [],
      needsClarification: false,
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
            .filter(s => s.length > 0 && Array.from(s).length <= 20)
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

      const clarification = extractClarificationFromJson(parsed, plannerOutput);
      // When the LLM commits to clarification mode but ships an empty
      // options list (or generic placeholders the planner discarded),
      // derive context-aware options from the user's own text so the
      // quick-pick card actually helps the user disambiguate.
      if (
        clarification.needsClarification &&
        (!clarification.clarificationOptions ||
          clarification.clarificationOptions.length === 0) &&
        opts.userText
      ) {
        const optionPack = buildContextualClarificationOptions({
          userText: opts.userText,
          dimension: "format",
        });
        if (optionPack.options.length > 0) {
          clarification.clarificationOptions = optionPack.options;
        }
      }
      const clarifiedActions = clarification.needsClarification ? [] : actions;
      const finalAskBeforeAct = clarification.needsClarification ? true : askBeforeAct;
      const citations = extractCitationsFromJson(parsed, plannerOutput);

      return {
        reply,
        actions: clarifiedActions,
        intent,
        askBeforeAct: finalAskBeforeAct,
        suggestions,
        toolCalls,
        plannerOutput,
        needsClarification: clarification.needsClarification,
        clarificationQuestion: clarification.clarificationQuestion,
        clarificationOptions: clarification.clarificationOptions,
        citations,
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
  const suggestMatches = Array.from(reply.matchAll(/\[SUGGEST:([^\]]+)\]/g));
  if (suggestMatches.length > 0) {
    suggestMatches
      .flatMap(m => m[1].split("|"))
      .map(s => s.trim())
      .filter(s => s.length > 0 && Array.from(s).length <= 20)
      .forEach(s => {
        if (!suggestions.includes(s)) suggestions.push(s);
      });
    suggestions.splice(4);
    reply = reply.replace(/\[SUGGEST:[^\]]+\]/g, "").trim();
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

  // ── CLARIFY marker：[CLARIFY:question|opt1|opt2|opt3] ──────────
  let needsClarification = false;
  let clarificationQuestion: string | undefined;
  let clarificationOptions: string[] | undefined;
  const clarifyMatch = /\[CLARIFY:([^\]]+)\]/.exec(reply);
  if (clarifyMatch) {
    const parts = clarifyMatch[1]
      .split("|")
      .map(s => s.trim())
      .filter(s => s.length > 0);
    if (parts.length > 0) {
      needsClarification = true;
      clarificationQuestion = parts[0].slice(0, 300);
      const options = parts
        .slice(1, 5)
        .map(s => s.slice(0, 24))
        .filter(s => s.length > 0);
      if (options.length > 0) clarificationOptions = options;
    }
    reply = reply.replace(clarifyMatch[0], "").trim();
  }

  // ── Confirm gate：破壞性動作 + alwaysConfirm 的保險絲 ─────────
  const hasDestructive = actions.some(a => ORB_DESTRUCTIVE_ACTIONS.has(a.type));
  if (!confirmExplicit && hasDestructive) askBeforeAct = true;
  if (opts.alwaysConfirm && actions.length > 0) askBeforeAct = true;

  // 反問模式下強制清空動作並要求確認，避免 LLM 同時下指令
  if (needsClarification) {
    askBeforeAct = true;
    return {
      reply,
      actions: [],
      intent,
      askBeforeAct,
      suggestions,
      toolCalls,
      needsClarification,
      clarificationQuestion,
      clarificationOptions,
    };
  }

  // ── Phantom-plan reclassification ───────────────────────────────
  // The LLM sometimes describes a multi-step plan in chat ("步驟 1 ... 步驟 4
  // 你比較想從哪步開始？") without committing to decision.mode='clarification'
  // and without emitting any actions. The result is a wall of text the user
  // can't act on. Catch that pattern here and surface it as a real
  // clarification with quick-pick options derived from the user's own topic.
  if (
    actions.length === 0 &&
    toolCalls.length === 0 &&
    isPhantomPlanReply(reply)
  ) {
    const question =
      extractPhantomPlanQuestion(reply) ?? "想先確認一下你要的方向，這樣才能做對。";
    const userText = opts.userText ?? "";
    const optionPack = buildContextualClarificationOptions({
      userText,
      dimension: "format",
    });
    return {
      reply,
      actions: [],
      intent,
      askBeforeAct: true,
      suggestions,
      toolCalls,
      needsClarification: true,
      clarificationQuestion: question,
      clarificationOptions:
        optionPack.options.length > 0 ? optionPack.options : undefined,
    };
  }

  return {
    reply,
    actions,
    intent,
    askBeforeAct,
    suggestions,
    toolCalls,
    needsClarification: false,
  };
}

interface ClarificationExtract {
  needsClarification: boolean;
  clarificationQuestion?: string;
  clarificationOptions?: string[];
}

function extractCitationsFromJson(
  parsed: Record<string, unknown>,
  plannerOutput: unknown
): Array<{ kind: "memory" | "page" | "tool" | "web"; id: string; label?: string }> | undefined {
  const candidates: Array<Record<string, unknown> | undefined> = [
    parsed,
    typeof plannerOutput === "object" && plannerOutput !== null
      ? (plannerOutput as Record<string, unknown>)
      : undefined,
  ];
  if (typeof plannerOutput === "object" && plannerOutput !== null) {
    const planLike = plannerOutput as Record<string, unknown>;
    if (planLike.plan && typeof planLike.plan === "object") {
      candidates.push(planLike.plan as Record<string, unknown>);
    }
  }
  const allowedKinds = new Set(["memory", "page", "tool", "web"]);
  for (const candidate of candidates) {
    if (!candidate) continue;
    const raw = candidate.citations;
    if (!Array.isArray(raw)) continue;
    const cleaned = raw
      .filter(
        (c): c is { kind?: unknown; id?: unknown; label?: unknown } =>
          !!c && typeof c === "object"
      )
      .map((c): { kind: "memory" | "page" | "tool" | "web"; id: string; label?: string } | null => {
        const kind =
          typeof c.kind === "string" && allowedKinds.has(c.kind)
            ? (c.kind as "memory" | "page" | "tool" | "web")
            : "memory";
        const id = typeof c.id === "string" ? c.id.trim().slice(0, 160) : "";
        const label =
          typeof c.label === "string" ? c.label.trim().slice(0, 120) : undefined;
        if (!id) return null;
        return label !== undefined ? { kind, id, label } : { kind, id };
      })
      .filter((c): c is { kind: "memory" | "page" | "tool" | "web"; id: string; label?: string } => c !== null)
      .slice(0, 8);
    if (cleaned.length > 0) return cleaned;
  }
  return undefined;
}

function extractClarificationFromJson(
  parsed: Record<string, unknown>,
  plannerOutput: unknown
): ClarificationExtract {
  const candidates: Array<Record<string, unknown> | undefined> = [
    parsed,
    typeof plannerOutput === "object" && plannerOutput !== null
      ? (plannerOutput as Record<string, unknown>)
      : undefined,
  ];

  if (typeof plannerOutput === "object" && plannerOutput !== null) {
    const planLike = plannerOutput as Record<string, unknown>;
    if (planLike.plan && typeof planLike.plan === "object") {
      candidates.push(planLike.plan as Record<string, unknown>);
    }
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    const flag = candidate.shouldAskClarification;
    const decisionMode =
      typeof candidate.decision === "object" && candidate.decision !== null
        ? (candidate.decision as Record<string, unknown>).mode
        : undefined;
    const isClarifying = flag === true || decisionMode === "clarification";
    if (!isClarifying) continue;

    const question =
      typeof candidate.clarificationQuestion === "string"
        ? candidate.clarificationQuestion.trim()
        : undefined;
    const rawOptions = candidate.clarificationOptions;
    const options = Array.isArray(rawOptions)
      ? rawOptions
          .filter((s): s is string => typeof s === "string")
          .map(s => s.trim())
          .filter(s => s.length > 0 && Array.from(s).length <= 24)
          .slice(0, 4)
      : undefined;

    if (question && question.length > 0) {
      return {
        needsClarification: true,
        clarificationQuestion: question.slice(0, 300),
        clarificationOptions: options && options.length > 0 ? options : undefined,
      };
    }
  }

  return { needsClarification: false };
}
