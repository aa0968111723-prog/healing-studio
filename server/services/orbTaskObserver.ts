/**
 * orbTaskObserver.ts — post-mortem 觀察器（Agent loop v1）
 *
 * 角色：在 `runOrbTaskToCompletion` 跑完後（不論成功 / 失敗 / 等使用者）
 * 看一遍實際執行紀錄（perStepToolResults + auditEvents），請 LLM 用使
 * 用者語言寫一段「剛剛發生什麼、接下來建議怎麼做」的觀察結論。
 *
 * 為什麼是「post-mortem」而不是「step-by-step observe」：
 *   - 每步驟前都打一次 LLM 太貴又慢（plan 8k tokens / 步驟 ×N）。
 *   - 最痛的問題是 task 失敗時使用者看到的是 raw error code（譬如
 *     `unresolved-step-ref:step1.video_url`）。post-mortem 把這個翻成
 *     「第 2 步沒拿到上一步輸出，要不要改這樣試試？」就解掉八成體驗問題。
 *
 * 設計原則：
 *   - 純函式：依賴 `invokeLLM` 可注入，方便測試。
 *   - 不修改 FSM；caller 自己決定要不要把回傳的觀察寫成 `task.observed`
 *     audit event 或推給前端 SSE。
 *   - 用 strict JSON schema 強制 LLM 回傳 discriminated union，
 *     避免 free-text 解析時對 race。
 */

import { invokeLLM, extractMessageText, type Message } from "../_core/llm";
import type { OrbAgentTask } from "../../shared/orb-task-state-machine";
import type { RunOrbTaskResult } from "./orbTaskOrchestrator";
import {
  getOrbTaskPageState,
  type OrbTaskPageStateSnapshot,
} from "./orbTaskPageStateStore";
import {
  getRecentOrbTaskMemory,
  type OrbTaskMemoryEvent,
} from "./orbTaskMemory";

// ─── Output contract ──────────────────────────────────────────────────────

export type TaskObservation =
  | {
      kind: "complete";
      /** 給使用者看的繁中總結；UI 直接 render */
      userMessage: string;
    }
  | {
      kind: "needs_user";
      /** 需要使用者澄清才能繼續的問題 */
      question: string;
      /** 可選的快速建議答案，UI 渲染為按鈕 */
      suggestions?: string[];
    }
  | {
      kind: "continue";
      /** Agent 認為還可以自動進行的下一步描述（v1 不會真的自動跑，
       *  只把這段建議塞到 audit event；v2 會接 planner re-call） */
      suggestedNextAction: string;
      /** 短說明：為什麼要繼續（給使用者背景） */
      reason: string;
    }
  | {
      kind: "abort";
      /** 失敗解釋（友善版，非 raw error） */
      userMessage: string;
      /** 結構化失敗類別，方便 metric / dashboard 聚合 */
      failureCategory:
        | "tool_error"
        | "missing_input"
        | "approval_blocked"
        | "quota_exceeded"
        | "unknown";
    };

// ─── Input contract ───────────────────────────────────────────────────────

export interface ObserveOrbTaskInput {
  /** 原始使用者意圖（taskDraft.intent / agentTask.intent） */
  intent: string;
  /** Orchestrator 跑完的結果 */
  runResult: RunOrbTaskResult;
  /** FSM task snapshot；可從 runResult.finalAgentTask 取，也可外部傳入 */
  agentTask?: OrbAgentTask | null;
  /**
   * Agent loop v5 — page-state snapshots the client posted via
   * `ai.orbTask.reportPageState` while this task was running. When
   * supplied (or auto-fetched from the in-memory store via `taskId`),
   * the observer prompt includes a "頁面實況" block so the LLM judges
   * outcomes against what the page actually looks like, not just
   * server-side tool results.
   *
   * Either pass the snapshots directly OR set `taskId` and let the
   * observer pull them. Direct passing wins when both are given.
   */
  pageStateSnapshots?: OrbTaskPageStateSnapshot[];
  /** Used to auto-pull snapshots when `pageStateSnapshots` is absent. */
  taskId?: string;
  /**
   * Agent loop v9 — recent task-memory events to surface in the
   * observer prompt as "歷史紀錄". Lets the LLM recognise repeat
   * failure patterns ("we've hit `chain.planner_no_task` on this
   * intent before — give up faster"). When omitted, the observer
   * pulls from `getRecentOrbTaskMemory()` automatically (capped at 5
   * entries). Pass an empty array to opt out.
   */
  recentTaskMemory?: OrbTaskMemoryEvent[];
  /** 注入用 — 預設用全站 invokeLLM，測試時用 stub */
  invoke?: typeof invokeLLM;
  /** 觀察 LLM 回應的最大 tokens；預設 600 */
  maxTokens?: number;
}

// ─── JSON schema for LLM structured output ────────────────────────────────

const OBSERVATION_JSON_SCHEMA = {
  name: "OrbTaskObservation",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["kind"],
    properties: {
      kind: {
        type: "string",
        enum: ["complete", "needs_user", "continue", "abort"],
      },
      userMessage: { type: "string" },
      question: { type: "string" },
      suggestions: {
        type: "array",
        items: { type: "string" },
        maxItems: 4,
      },
      suggestedNextAction: { type: "string" },
      reason: { type: "string" },
      failureCategory: {
        type: "string",
        enum: [
          "tool_error",
          "missing_input",
          "approval_blocked",
          "quota_exceeded",
          "unknown",
        ],
      },
    },
  },
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * 把 task 的 step + tool 結果摘成 LLM 看得懂的純文字 transcript。
 * 太長會吃掉 context；每個 step 最多 400 chars，整體上限 4000。
 */
function summarizeExecutionForLLM(input: ObserveOrbTaskInput): string {
  const { runResult, agentTask } = input;
  const lines: string[] = [];
  lines.push(`[原始意圖] ${input.intent}`);
  lines.push(`[最終狀態] ${runResult.outcome}${runResult.reason ? ` (${runResult.reason})` : ""}`);
  lines.push(`[執行步驟數] ${runResult.stepsRun}`);

  // FSM step labels (有比 perStepToolResults 多的人類可讀標題)
  const fsmStepsById = new Map<string, { label: string; status: string }>();
  if (agentTask) {
    for (const s of agentTask.steps) {
      fsmStepsById.set(s.id, { label: s.label, status: s.status });
    }
  }

  for (const stepResult of runResult.perStepToolResults) {
    const fsm = fsmStepsById.get(stepResult.stepId);
    const header = fsm
      ? `▸ Step「${fsm.label}」(${fsm.status})`
      : `▸ Step ${stepResult.stepId}`;
    lines.push(header);
    for (const tool of stepResult.toolResults) {
      if (tool.ok) {
        const dataPreview = tool.data
          ? JSON.stringify(tool.data).slice(0, 240)
          : "(no data)";
        lines.push(`  ✓ ${tool.name} → ${dataPreview}`);
      } else {
        lines.push(`  ✗ ${tool.name} → ${(tool.error ?? "unknown").slice(0, 240)}`);
      }
    }
    if (stepResult.blockedByApproval) {
      lines.push("  ⏸ blocked by approval");
    }
  }

  // Surface any unprocessed FSM steps (those that never made it to perStepToolResults)
  if (agentTask) {
    const ranIds = new Set(runResult.perStepToolResults.map(r => r.stepId));
    for (const s of agentTask.steps) {
      if (!ranIds.has(s.id) && s.status !== "pending") {
        lines.push(`▸ Step「${s.label}」(${s.status}) — 未被 orchestrator 跑到`);
      }
    }
    if (agentTask.failedReason) {
      lines.push(`[FSM failedReason] ${agentTask.failedReason}`);
    }
  }

  // Agent loop v5 — append the page-state snapshots the client posted
  // while the task ran. Bounded: only the last 8 snapshots; each state
  // payload truncated to 240 chars when serialised so a chatty page
  // can't blow the LLM context budget.
  const snapshots = resolvePageStateSnapshots(input);
  if (snapshots.length > 0) {
    lines.push("[頁面實況] (最新在底)");
    for (const snap of snapshots.slice(-8)) {
      const where = snap.pageId ? `[${snap.pageId}]` : "[?]";
      const what = snap.actionType ? `${snap.actionType} →` : "snapshot →";
      const summary = snap.summary ? `${snap.summary} · ` : "";
      const stateJson = JSON.stringify(snap.state).slice(0, 240);
      lines.push(`  ${where} ${what} ${summary}${stateJson}`);
    }
  }

  // Agent loop v9 — surface recent chain memory so the observer can
  // recognise repeat patterns ("3rd attempt at this intent has hit
  // the same trap, time to abort, not retry"). Capped at 5 entries
  // and each failedReason truncated so the block stays compact.
  const memory = resolveRecentTaskMemory(input);
  if (memory.length > 0) {
    lines.push("[歷史紀錄] 最近的相關 chain 結果（新→舊）");
    for (const evt of memory) {
      const reason = evt.failedReason ? ` :: ${evt.failedReason.slice(0, 100)}` : "";
      const intentBit = evt.userIntent.slice(0, 40);
      lines.push(`  · ${evt.outcome} | ${intentBit}${reason}`);
    }
  }

  return lines.join("\n").slice(0, 4000);
}

function resolveRecentTaskMemory(
  input: ObserveOrbTaskInput
): OrbTaskMemoryEvent[] {
  if (input.recentTaskMemory !== undefined) {
    // Caller opted in (or out by passing []) — honour exactly.
    return input.recentTaskMemory.slice(0, 5);
  }
  return getRecentOrbTaskMemory(5);
}

function resolvePageStateSnapshots(
  input: ObserveOrbTaskInput
): OrbTaskPageStateSnapshot[] {
  if (input.pageStateSnapshots && input.pageStateSnapshots.length > 0) {
    return input.pageStateSnapshots;
  }
  if (input.taskId) {
    return getOrbTaskPageState(input.taskId);
  }
  return [];
}

function buildObserverMessages(input: ObserveOrbTaskInput): Message[] {
  const transcript = summarizeExecutionForLLM(input);
  const system =
    `你是「全站光球代理」的 post-mortem 觀察員。你會看一份剛跑完的多步驟代理任務執行紀錄，` +
    `判斷現在處在哪一種狀態，並用「對使用者說話的語氣」（繁體中文、簡短、不要列序號）寫出觀察結論。\n\n` +
    `必須回傳 JSON，遵守提供的 schema。kind 從以下 4 種選一個：\n` +
    `  - "complete"：任務已成功完成，所有步驟通過，使用者要的結果已產出。userMessage 寫「我幫你做完了 …」。\n` +
    `  - "needs_user"：被使用者必須提供的資訊／審核擋住（例：缺檔案、缺批准）。question 寫成自然問句。\n` +
    `  - "continue"：技術上失敗但有明確下一步可試（例：retry 用不同模型、改 prompt）。` +
    `suggestedNextAction 用繁中描述要做什麼，reason 講為什麼。\n` +
    `  - "abort"：失敗且短期內無法恢復（quota 用完、不支援的功能、外部 API 持續壞）。` +
    `userMessage 用同理的口氣解釋並說「先暫停這條路徑」，failureCategory 從 enum 中選最貼近的一個。\n\n` +
    `注意：使用者只看得到 userMessage / question / suggestedNextAction 的字，不要在裡面塞 raw error code、` +
    `step id、tool name 這些開發者語言；如果一定要提及失敗原因，用人話翻譯（例：「上一步沒拿到影片網址」` +
    `而不是「unresolved-step-ref:step1.video_url」）。\n\n` +
    `紀錄裡可能會有「[頁面實況]」區塊 — 這是目標頁面在動作執行後實際的狀態（例如 prompt 是不是真的填上去、` +
    `目前選的模型、生成是不是回到 URL）。判斷 kind 的時候要把這個放在第一順位：tool 看似成功但頁面實況顯示` +
    `prompt 是空的，那其實就是 needs_user 或 continue，不是 complete。\n\n` +
    `也可能會有「[歷史紀錄]」區塊 — 之前類似 chain 的結果與失敗原因。如果發現使用者最近已經連續多次卡在` +
    `同一個 trap（例：兩次都是 chain.planner_no_task），就傾向回 abort 而不是繼續 continue —` +
    `agent 一直撞同一面牆對使用者沒幫助；把問題誠實告訴他並請他換個方向。`;

  const user = `以下是剛跑完的任務執行紀錄：\n\n${transcript}`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

// ─── Pure deterministic shortcut ──────────────────────────────────────────

/**
 * 在 LLM 之前先用規則處理一些非常明確的情況，省一次 LLM call 並避免
 * LLM 把成功的任務說成「應該還有下一步」。回傳 null = 沒命中 → 繼續走 LLM。
 */
function deterministicShortcut(
  input: ObserveOrbTaskInput
): TaskObservation | null {
  const { runResult } = input;

  // 沒跑任何步驟、又沒失敗 — 通常是 cancel / 異常路徑
  if (runResult.stepsRun === 0 && runResult.outcome === "cancelled") {
    return {
      kind: "abort",
      userMessage: "任務已被取消，沒有實際執行任何步驟。",
      failureCategory: "unknown",
    };
  }

  // awaiting_approval 一定是 needs_user — 不需要 LLM 想
  if (runResult.outcome === "awaiting_approval") {
    return null; // 仍交給 LLM 寫一段對應 step 的友善問句
  }

  return null;
}

// ─── Main entry ───────────────────────────────────────────────────────────

/**
 * 看一遍 orchestrator 的執行結果，請 LLM 寫出觀察結論。
 *
 * 任何 LLM 解析失敗都會 fallback 到一個保守的觀察（按 outcome 對映成
 * complete / abort），絕不丟例外 — caller 是背景 driver，丟了就沒人接。
 */
export async function observeOrbTaskOutcome(
  input: ObserveOrbTaskInput
): Promise<TaskObservation> {
  const shortcut = deterministicShortcut(input);
  if (shortcut) return shortcut;

  const llm = input.invoke ?? invokeLLM;
  try {
    const result = await llm({
      messages: buildObserverMessages(input),
      runName: "orb-task-observer",
      maxTokens: input.maxTokens ?? 600,
      response_format: {
        type: "json_schema",
        json_schema: OBSERVATION_JSON_SCHEMA as unknown as {
          name: string;
          schema: Record<string, unknown>;
          strict?: boolean;
        },
      },
    });
    const text = extractMessageText(result.choices[0]?.message?.content);
    const parsed = safeParseObservation(text);
    if (parsed) return parsed;
  } catch (err) {
    console.warn(
      "[orbTaskObserver] LLM call failed, using fallback:",
      err instanceof Error ? err.message : String(err)
    );
  }

  return fallbackObservation(input);
}

function safeParseObservation(text: string): TaskObservation | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const kind = obj.kind;
  if (typeof kind !== "string") return null;
  switch (kind) {
    case "complete": {
      if (typeof obj.userMessage !== "string" || !obj.userMessage.trim()) return null;
      return { kind: "complete", userMessage: obj.userMessage };
    }
    case "needs_user": {
      if (typeof obj.question !== "string" || !obj.question.trim()) return null;
      const suggestions = Array.isArray(obj.suggestions)
        ? obj.suggestions
            .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
            .slice(0, 4)
        : undefined;
      return {
        kind: "needs_user",
        question: obj.question,
        ...(suggestions && suggestions.length ? { suggestions } : {}),
      };
    }
    case "continue": {
      if (
        typeof obj.suggestedNextAction !== "string" ||
        !obj.suggestedNextAction.trim() ||
        typeof obj.reason !== "string"
      ) {
        return null;
      }
      return {
        kind: "continue",
        suggestedNextAction: obj.suggestedNextAction,
        reason: obj.reason,
      };
    }
    case "abort": {
      if (typeof obj.userMessage !== "string" || !obj.userMessage.trim()) return null;
      const cat = obj.failureCategory;
      const valid = [
        "tool_error",
        "missing_input",
        "approval_blocked",
        "quota_exceeded",
        "unknown",
      ] as const;
      const failureCategory = (valid as readonly string[]).includes(String(cat))
        ? (cat as TaskObservation extends { kind: "abort"; failureCategory: infer F }
            ? F
            : never)
        : ("unknown" as const);
      return {
        kind: "abort",
        userMessage: obj.userMessage,
        failureCategory,
      };
    }
    default:
      return null;
  }
}

function fallbackObservation(input: ObserveOrbTaskInput): TaskObservation {
  const { runResult } = input;
  switch (runResult.outcome) {
    case "completed":
      return {
        kind: "complete",
        userMessage: "任務看起來完成了，但我無法產出更詳細的說明。",
      };
    case "awaiting_approval":
      return {
        kind: "needs_user",
        question: "需要你確認下一步才能繼續，要不要看一下？",
      };
    case "cancelled":
      return {
        kind: "abort",
        userMessage: "任務已被取消。",
        failureCategory: "unknown",
      };
    case "failed":
    default:
      return {
        kind: "abort",
        userMessage:
          "中途遇到狀況沒辦法繼續，先暫停在這裡。你可以調整需求再試一次。",
        failureCategory: "unknown",
      };
  }
}

// ─── Helper: 把 observation 翻成 audit event metadata ─────────────────────

/**
 * 把 observation 物件包成可寫進 OrbTaskAuditEvent.metadata 的形狀。
 * caller 用 `pushEvent(task, "task.observed", message, metadata)` 寫進
 * FSM；前端訂閱 audit events SSE 後就能渲染。
 */
export function observationToAuditMetadata(
  observation: TaskObservation
): Record<string, unknown> {
  return { observation };
}

/** Short message field for the audit event row itself. */
export function observationToAuditMessage(observation: TaskObservation): string {
  switch (observation.kind) {
    case "complete":
      return `Observed: complete — ${observation.userMessage.slice(0, 120)}`;
    case "needs_user":
      return `Observed: needs_user — ${observation.question.slice(0, 120)}`;
    case "continue":
      return `Observed: continue — ${observation.suggestedNextAction.slice(0, 120)}`;
    case "abort":
      return `Observed: abort (${observation.failureCategory}) — ${observation.userMessage.slice(0, 100)}`;
  }
}
