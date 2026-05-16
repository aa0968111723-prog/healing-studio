/**
 * server/services/spiritTools/planExecutorTools.ts
 *
 * 步步（plan-executor）的真實 agent 引擎工具集。
 *
 * 從前這檔案只是回傳 `PLAN-${Date.now()}` 的 stub；現在改成：
 *   - planExecutor.planFromGoal  → 餵自然語言目標，呼叫 agentPlanner 產生 AgentPlanV3
 *     並轉成 AgentWorkflowStep[]，落地到 PLAN_STORE，回傳 planId + 預演卡。
 *   - planExecutor.createPlan    → 收使用者 / LLM 已經編好的 steps，落地、回 planId。
 *   - planExecutor.runPlan       → 把 planId 對應的 plan 整條跑完（非同步、可 pause/cancel），
 *     會逐步呼叫 executeOrbToolCalls，並用 resolveStepRefsInArgs 接前一步輸出。
 *   - planExecutor.executeStep   → 指定 stepIndex 單獨跑一步（給 debugger / UI 點按單步）。
 *   - planExecutor.getStatus     → 回傳 plan 跑到哪、每步的 outputs / errors / retryCount。
 *   - planExecutor.controlPlan   → pause / resume / abort 一個 plan。
 *   - planExecutor.listRuns      → 列出此使用者目前所有 plan（in_progress + 最近完成）。
 *   - planExecutor.replanOnFailure → 拿著 error context 重新呼叫 planner 產生修補步驟。
 *   - planExecutor.getTemplates  → 預設的工作流模板（保留向後相容）。
 *
 * 設計重點：
 *   - In-memory PLAN_STORE 是「現役計畫」的 source of truth；DB 落地由
 *     orbWorkflowEngine 另外負責（讓 step-by-step debug 與長期歷史分層）。
 *   - 每一步透過 `executeOrbToolCalls` 真實打工具，遵守既有 risk gate /
 *     blockedTools / allowlist；不繞過任何安全檢查。
 *   - 步驟結果保留進 `perStepToolResults`，後續步驟可用 `${stepId.path}` 引用。
 *   - pause / cancel 在每步開始前檢查（與 orbWorkflowEngine 同一模式）。
 *   - 內建 retry：依 step.retryPolicy.maxAttempts + 指數退避，失敗就停下來
 *     回報明確錯誤（不悄悄略過，符合步步人格 prompt 的承諾）。
 */

import { randomUUID } from "node:crypto";
import { logger } from "../../_core/logger";
import {
  executeOrbToolCalls,
  type OrbApiTool,
  type OrbToolCall,
  type OrbToolCallResult,
} from "../agentToolExecutor";
import { resolveStepRefsInArgs } from "../../../shared/orb-step-ref-resolver";
import {
  isKnownGlobalAgentTool,
  getGlobalAgentTool,
} from "../../../shared/global-agent-tools";
import {
  runSchemaFirstAgentPlannerWithCritique,
  type AgentPlannerInput,
} from "../agentPlanner";
import type { AgentWorkflowStep, RunWorkflowAction } from "../../../shared/agent-actions";
import { warnIfMultiInstanceSingleton } from "../serverDeploymentMode";

// H6: 多 instance 部署偵測。PLAN_STORE 是 process-local Map,沒 sticky
// session 的話 user A 在 worker 1 建的 plan,下一個請求被 route 到 worker
// 2 會看到 404。在 module load 時(boot)發一次警告,operator 在 stdout
// 就能看見部署模式不符限制。
warnIfMultiInstanceSingleton(
  "planExecutor",
  "in-memory PLAN_STORE → plans created on one worker are invisible to other workers (cross-worker 404 risk; needs sticky session)"
);

// ─── Types ───────────────────────────────────────────────────────────────────

export type PlanStatus =
  | "draft"                 // 已建立、尚未開跑（等使用者按「好，跑」）
  | "awaiting_approval"     // 高風險步驟等使用者明確核可（P1: 不能 auto-run）
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type StepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled";

export interface PlanStepRecord {
  /** Stable id used by step refs (`${stepId.path}`). */
  id: string;
  /** UI label shown to user. */
  label: string;
  /** Server-side tool call (when path-less / cross-page). */
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  /** Logical bucket name for resolveStepRefsInArgs (defaults to id). */
  toolResultBinding?: string;
  /** Steps this one must wait for. */
  dependsOn?: string[];
  /** UI dispatch (when this step lives on a studio page). */
  path?: string;
  actionType?: string;
  payload?: string;
  retryPolicy?: { maxAttempts?: number; backoffMs?: number; skipOnFail?: boolean };
  // Runtime fields:
  status: StepStatus;
  attempts: number;
  startedAt?: number;
  completedAt?: number;
  outputs?: unknown;
  error?: string;
  /** Resolved tool args after `${stepId.path}` substitution (for debug). */
  resolvedArgs?: Record<string, unknown>;
}

export interface PlanRecord {
  id: string;
  userId: number;
  userRole: string;
  goal: string;
  status: PlanStatus;
  steps: PlanStepRecord[];
  /** ISO ms */
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  /** Set by replanOnFailure when a step's failure produced a remediation plan. */
  parentPlanId?: string;
  /** Cancel signal — set by controlPlan({ action: "cancel" / "pause" }). */
  control?: "pause" | "cancel";
  /** Last error message when status === "failed". */
  error?: string;
  /** Tool allowlist / blocklist passed through to executeOrbToolCalls. */
  blockedTools?: string[];
  /** Concrete tools registry handed to executeOrbToolCalls (HTTP-tool subset). */
  tools?: OrbApiTool[];
  /**
   * High-risk steps gated on explicit user approval (P1 review fix).
   *
   * GLOBAL_AGENT_TOOL_REGISTRY marks each tool with `riskLevel` + `requiresHuman`;
   * any step where either flag is set ("high" or `requiresHuman: true`) is held
   * back until the caller passes `approveHighRisk: true` to runPlan. Without
   * this, hard-coding `approved: true` for `executeOrbToolCalls` would silently
   * bypass the human-in-the-loop contract that the registry promises.
   */
  approvedHighRisk?: boolean;
}

interface CreatePlanInput {
  userId: number;
  userRole?: string;
  goal: string;
  steps: Array<{
    id?: string;
    label?: string;
    toolName?: string;
    toolArgs?: Record<string, unknown>;
    toolResultBinding?: string;
    dependsOn?: string[];
    path?: string;
    actionType?: string;
    payload?: string;
    retryPolicy?: PlanStepRecord["retryPolicy"];
  }>;
  blockedTools?: string[];
  tools?: OrbApiTool[];
}

// ─── In-memory store ─────────────────────────────────────────────────────────
// 為什麼用 in-memory：
//   1. 計畫的「現役執行狀態」高頻寫入（每步多次 update），不需要持久化每個
//      tick；持久化只在「最終 outputs」由 orbWorkflowEngine 處理。
//   2. 使用者重新整理頁面後可重新查詢（getStatus），所以 plan 在 instance
//      lifetime 內穩定可見即可。多實例部署需要時可改成 Redis（介面已抽象）。
const PLAN_STORE = new Map<string, PlanRecord>();

function newPlanId(): string {
  return `plan_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
}

function newStepId(index: number): string {
  return `step${index + 1}`;
}

/** Truncate stored plans to avoid unbounded memory growth. */
function pruneOldPlans(maxAgeMs = 24 * 60 * 60 * 1000, hardCap = 500): void {
  const now = Date.now();
  for (const [id, plan] of PLAN_STORE) {
    const ageMs = now - (plan.completedAt ?? plan.createdAt);
    if ((plan.status === "completed" || plan.status === "failed" || plan.status === "cancelled") && ageMs > maxAgeMs) {
      PLAN_STORE.delete(id);
    }
  }
  if (PLAN_STORE.size <= hardCap) return;
  // Drop oldest completed first if we still exceed cap.
  const sorted = [...PLAN_STORE.entries()].sort(
    (a, b) => (a[1].completedAt ?? a[1].createdAt) - (b[1].completedAt ?? b[1].createdAt)
  );
  for (const [id, plan] of sorted) {
    if (PLAN_STORE.size <= hardCap) break;
    if (plan.status !== "running" && plan.status !== "paused") PLAN_STORE.delete(id);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildPerStepResults(steps: PlanStepRecord[]): Array<{
  stepId: string;
  toolResults: Array<{ ok: boolean; data?: unknown }>;
}> {
  return steps
    .filter(s => s.status === "completed" && s.outputs !== undefined)
    .map(s => ({
      stepId: s.toolResultBinding ?? s.id,
      toolResults: [{ ok: true, data: s.outputs }],
    }));
}

/** Topological order via dependsOn; falls back to declaration order on cycles. */
function topoOrder(steps: PlanStepRecord[]): PlanStepRecord[] {
  const byId = new Map(steps.map(s => [s.id, s]));
  const out: PlanStepRecord[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  let cycle = false;

  function visit(step: PlanStepRecord): void {
    if (visited.has(step.id)) return;
    if (visiting.has(step.id)) {
      cycle = true;
      return;
    }
    visiting.add(step.id);
    for (const dep of step.dependsOn ?? []) {
      const target = byId.get(dep);
      if (target) visit(target);
    }
    visiting.delete(step.id);
    visited.add(step.id);
    out.push(step);
  }

  for (const s of steps) visit(s);
  if (cycle) {
    logger.warn("plan_executor_topo_cycle_detected", { stepIds: steps.map(s => s.id) });
    return steps;
  }
  return out;
}

function isStepHighRisk(step: PlanStepRecord): boolean {
  if (!step.toolName) return false;
  const def = getGlobalAgentTool(step.toolName);
  return def?.riskLevel === "high" || def?.requiresHuman === true;
}

async function executeSingleStep(
  plan: PlanRecord,
  step: PlanStepRecord,
  taskId: string
): Promise<void> {
  step.status = "running";
  step.startedAt = Date.now();

  // 1) Resolve `${stepId.path}` against prior successful steps.
  const resolvedArgs = step.toolArgs
    ? resolveStepRefsInArgs({
        args: step.toolArgs,
        perStepToolResults: buildPerStepResults(plan.steps),
      })
    : undefined;
  step.resolvedArgs = resolvedArgs;

  // 2) For UI-only steps (no toolName) we mark completed and let the
  //    client side perform navigation / fillPrompt. Otherwise dispatch.
  if (!step.toolName) {
    step.status = "completed";
    step.outputs = { uiOnly: true, path: step.path, actionType: step.actionType, payload: step.payload };
    step.completedAt = Date.now();
    return;
  }

  // 3) Validate against the global tool registry — never let the planner
  //    smuggle in unknown tools (this is what risk gates exist for).
  if (!isKnownGlobalAgentTool(step.toolName)) {
    step.status = "failed";
    step.error = `unknown tool: ${step.toolName}`;
    step.completedAt = Date.now();
    throw new Error(step.error);
  }

  const call: OrbToolCall = {
    name: step.toolName,
    args: resolvedArgs,
  };

  const maxAttempts = Math.max(1, step.retryPolicy?.maxAttempts ?? 1);
  const backoffMs = Math.max(0, step.retryPolicy?.backoffMs ?? 500);

  let lastResult: OrbToolCallResult | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (plan.control === "cancel") {
      step.status = "cancelled";
      step.completedAt = Date.now();
      throw new Error("cancelled-by-user");
    }
    if (plan.control === "pause") {
      // Bubble up a sentinel so runPlan can re-enter from current step
      // once status flips back to running.
      step.status = "pending";
      throw new Error("__paused__");
    }

    step.attempts += 1;
    // P1 fix: don't blanket-approve every step. High-risk steps (riskLevel:high
    // or requiresHuman:true in the global registry) need explicit user approval
    // — runPlan() refuses to even enter executeSingleStep for those without
    // `approvedHighRisk`, but this defence-in-depth also tells the executor
    // which gate to apply so any future downstream check stays honest.
    const approved = !isStepHighRisk(step) || plan.approvedHighRisk === true;
    const results = await executeOrbToolCalls({
      tools: plan.tools ?? [],
      calls: [call],
      userId: plan.userId,
      userRole: plan.userRole,
      approved,
      taskId,
      stepId: step.id,
      blockedTools: plan.blockedTools,
    });
    lastResult = results[0] ?? null;
    if (lastResult?.ok) {
      step.status = "completed";
      step.outputs = lastResult.data ?? null;
      step.completedAt = Date.now();
      return;
    }
    if (attempt < maxAttempts && backoffMs > 0) {
      await new Promise(resolve => setTimeout(resolve, backoffMs * attempt));
    }
  }

  if (step.retryPolicy?.skipOnFail) {
    step.status = "skipped";
    step.error = lastResult?.error ?? "skip-on-fail";
    step.completedAt = Date.now();
    return;
  }

  step.status = "failed";
  step.error = lastResult?.error ?? "tool-call-failed";
  step.completedAt = Date.now();
  throw new Error(step.error);
}

// ─── Public tool: planExecutor.planFromGoal ──────────────────────────────────

export interface PlanFromGoalInput {
  userId: number;
  userRole?: string;
  goal: string;
  /** Pass `context` from the chat (e.g. "user attached image, current page=/image-studio"). */
  context?: string;
  /** Tools that the orchestrator MAY call. */
  tools?: OrbApiTool[];
  blockedTools?: string[];
  /** Cap steps for safety. */
  maxSteps?: number;
}

export async function planFromGoal(input: PlanFromGoalInput): Promise<{
  success: boolean;
  planId?: string;
  preview?: PlanRecord;
  highRiskCount?: number;
  message: string;
}> {
  pruneOldPlans();
  try {
    const plannerInput: AgentPlannerInput = {
      messages: [{ role: "user", content: input.goal }],
      context: input.context,
      // 步步：規劃 + 跨頁執行需要強推理保證每步參數正確（見 SPIRIT_PREFERRED_PROVIDER）。
      // 開 critique 讓 plan-critic 自動跑一輪修補：score < 75 或有 blocker 就 refine。
      enableCritique: true,
    };
    const result = await runSchemaFirstAgentPlannerWithCritique(plannerInput);
    if (
      (result.status !== "converted" && result.status !== "tasked") ||
      result.actions.length === 0
    ) {
      return {
        success: false,
        message:
          `規劃失敗：${result.reason ?? result.clarificationQuestion ?? "planner_returned_invalid_plan"}。` +
          ` 試試把目標再講具體一點，例如「幫我生圖 → 加文字 → 變影片」這種拆好的順序。`,
      };
    }

    // gating layer 已經把 v1 / v3 plan 都統一成 AgentAction[]，其中包含
    // RunWorkflowAction (`type === "runWorkflow"`) — 那就是我們要的 step list。
    const workflowAction = result.actions.find(
      (a): a is RunWorkflowAction => a.type === "runWorkflow"
    );

    if (!workflowAction || workflowAction.steps.length === 0) {
      return {
        success: false,
        message:
          `規劃出的 plan 沒有可執行的步驟（${result.actions.map(a => a.type).join(", ") || "empty"}）。` +
          ` 可能是純跳頁 / 純對話 — 試試 @導導 或直接告訴我「拆 N 步」。`,
      };
    }

    const rawSteps: AgentWorkflowStep[] = workflowAction.steps;

    const maxSteps = Math.max(1, input.maxSteps ?? 20);
    if (rawSteps.length > maxSteps) {
      return {
        success: false,
        message: `規劃出 ${rawSteps.length} 步超過上限 ${maxSteps}；請縮小目標或拆成兩條 plan。`,
      };
    }

    return createPlan({
      userId: input.userId,
      userRole: input.userRole,
      goal: input.goal,
      steps: rawSteps.map((s, idx) => ({
        id: s.id ?? newStepId(idx),
        label: s.label ?? `Step ${idx + 1}`,
        toolName: s.toolName,
        toolArgs: s.toolArgs,
        toolResultBinding: s.toolResultBinding ?? s.id ?? newStepId(idx),
        dependsOn: s.dependsOn,
        path: s.path,
        actionType: s.actionType,
        payload: s.payload,
        retryPolicy: s.retryPolicy,
      })),
      tools: input.tools,
      blockedTools: input.blockedTools,
    });
  } catch (err) {
    logger.error("plan_executor_plan_from_goal_failed", {
      userId: input.userId,
      goal: input.goal.slice(0, 200),
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      success: false,
      message: `規劃出錯：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ─── Public tool: planExecutor.createPlan ────────────────────────────────────

export function createPlan(input: CreatePlanInput): {
  success: boolean;
  planId?: string;
  preview?: PlanRecord;
  highRiskCount?: number;
  message: string;
} {
  pruneOldPlans();
  if (!input.steps?.length) {
    return { success: false, message: "至少要有一個步驟才能建立計畫。" };
  }

  const plan: PlanRecord = {
    id: newPlanId(),
    userId: input.userId,
    userRole: input.userRole ?? "user",
    goal: input.goal,
    status: "draft",
    createdAt: Date.now(),
    blockedTools: input.blockedTools,
    tools: input.tools,
    steps: input.steps.map((raw, idx) => ({
      id: raw.id ?? newStepId(idx),
      label: raw.label ?? `Step ${idx + 1}`,
      toolName: raw.toolName,
      toolArgs: raw.toolArgs,
      toolResultBinding: raw.toolResultBinding ?? raw.id ?? newStepId(idx),
      dependsOn: raw.dependsOn,
      path: raw.path,
      actionType: raw.actionType,
      payload: raw.payload,
      retryPolicy: raw.retryPolicy,
      status: "pending",
      attempts: 0,
    })),
  };

  PLAN_STORE.set(plan.id, plan);

  const highRiskCount = plan.steps.filter(isStepHighRisk).length;
  logger.info("plan_executor_plan_created", {
    planId: plan.id,
    userId: input.userId,
    stepCount: plan.steps.length,
    highRiskCount,
  });

  return {
    success: true,
    planId: plan.id,
    preview: plan,
    highRiskCount,
    message:
      `已建立 ${plan.steps.length} 步計畫（高風險 ${highRiskCount} 步）。` +
      ` 確認後呼叫 planExecutor.runPlan({ planId: "${plan.id}" }) 我就開跑。`,
  };
}

// ─── Public tool: planExecutor.runPlan ───────────────────────────────────────

export async function runPlan(input: {
  userId: number;
  planId: string;
  /** When true, return after kicking off (default). False = await full completion. */
  async?: boolean;
  /**
   * Caller acknowledges that high-risk steps (riskLevel:high OR requiresHuman:true
   * in the global tool registry) may execute without further interactive
   * confirmation. Without this flag, a plan that contains any high-risk step
   * is parked in `awaiting_approval` instead of running — P1 review fix.
   */
  approveHighRisk?: boolean;
}): Promise<{
  success: boolean;
  status: PlanStatus;
  message: string;
  completedSteps?: number;
  totalSteps?: number;
  highRiskCount?: number;
  failedStep?: { id: string; error: string };
}> {
  const plan = PLAN_STORE.get(input.planId);
  if (!plan) return { success: false, status: "failed", message: `找不到 plan：${input.planId}` };
  if (plan.userId !== input.userId) {
    return { success: false, status: "failed", message: "沒有權限存取這個 plan" };
  }
  if (plan.status === "running") {
    return { success: true, status: "running", message: "plan 已經在跑了" };
  }
  if (plan.status === "completed") {
    return { success: true, status: "completed", message: "plan 已經跑完", totalSteps: plan.steps.length, completedSteps: plan.steps.length };
  }

  // P1 fix: gate high-risk plans behind explicit approval. The caller must
  // pass approveHighRisk=true after the user sees the preview card — without
  // it, the plan flips to `awaiting_approval` and never dispatches a tool.
  if (input.approveHighRisk === true) {
    plan.approvedHighRisk = true;
  }
  const highRiskCount = plan.steps.filter(isStepHighRisk).length;
  if (highRiskCount > 0 && !plan.approvedHighRisk) {
    plan.status = "awaiting_approval";
    return {
      success: false,
      status: "awaiting_approval",
      message:
        `這個計畫有 ${highRiskCount} 個高風險步驟（標 high 或 requiresHuman），需要使用者明確核可。` +
        ` 請再呼叫一次 planExecutor.runPlan({ planId, approveHighRisk: true })。`,
      highRiskCount,
      totalSteps: plan.steps.length,
      completedSteps: plan.steps.filter(s => s.status === "completed").length,
    };
  }

  plan.status = "running";
  plan.control = undefined;
  plan.startedAt = plan.startedAt ?? Date.now();
  plan.error = undefined;

  const runner = (async () => {
    const taskId = plan.id;
    try {
      const ordered = topoOrder(plan.steps);
      for (const step of ordered) {
        if (step.status === "completed" || step.status === "skipped") continue;
        if (plan.control === "cancel") {
          plan.status = "cancelled";
          plan.completedAt = Date.now();
          return;
        }
        if (plan.control === "pause") {
          plan.status = "paused";
          return;
        }
        try {
          await executeSingleStep(plan, step, taskId);
        } catch (err) {
          if ((err as Error).message === "__paused__") {
            plan.status = "paused";
            return;
          }
          if ((err as Error).message === "cancelled-by-user") {
            plan.status = "cancelled";
            plan.completedAt = Date.now();
            return;
          }
          plan.status = "failed";
          plan.error = (err as Error).message;
          plan.completedAt = Date.now();
          logger.warn("plan_executor_step_failed", {
            planId: plan.id,
            stepId: step.id,
            error: plan.error,
          });
          return;
        }
      }
      plan.status = "completed";
      plan.completedAt = Date.now();
      logger.info("plan_executor_plan_completed", {
        planId: plan.id,
        userId: plan.userId,
        steps: plan.steps.length,
        durationMs: plan.completedAt - (plan.startedAt ?? plan.createdAt),
      });
    } catch (err) {
      plan.status = "failed";
      plan.error = err instanceof Error ? err.message : String(err);
      plan.completedAt = Date.now();
      logger.error("plan_executor_runner_crashed", {
        planId: plan.id,
        error: plan.error,
      });
    }
  })();

  if (input.async === false) await runner;

  return {
    success: true,
    status: plan.status,
    completedSteps: plan.steps.filter(s => s.status === "completed").length,
    totalSteps: plan.steps.length,
    message:
      input.async === false
        ? `plan ${plan.id} 跑完，最終狀態：${plan.status}`
        : `plan ${plan.id} 已開跑，呼叫 planExecutor.getStatus 看進度。`,
  };
}

// ─── Public tool: planExecutor.executeStep ───────────────────────────────────

export async function executeStep(input: {
  userId: number;
  planId: string;
  stepIndex?: number;
  stepId?: string;
}): Promise<{
  success: boolean;
  status: StepStatus;
  outputs?: unknown;
  error?: string;
  message: string;
}> {
  const plan = PLAN_STORE.get(input.planId);
  if (!plan) return { success: false, status: "failed", message: `找不到 plan：${input.planId}` };
  if (plan.userId !== input.userId) {
    return { success: false, status: "failed", message: "沒有權限存取這個 plan" };
  }
  const step =
    input.stepId !== undefined
      ? plan.steps.find(s => s.id === input.stepId)
      : typeof input.stepIndex === "number"
        ? plan.steps[input.stepIndex]
        : undefined;
  if (!step) return { success: false, status: "failed", message: "找不到對應步驟" };

  try {
    await executeSingleStep(plan, step, plan.id);
    return {
      success: step.status === "completed",
      status: step.status,
      outputs: step.outputs,
      message: `步驟「${step.label}」狀態：${step.status}`,
    };
  } catch (err) {
    return {
      success: false,
      status: step.status,
      error: step.error,
      message: `步驟「${step.label}」失敗：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ─── Public tool: planExecutor.getStatus ─────────────────────────────────────

export function getStatus(input: { userId: number; planId: string }): {
  success: boolean;
  status?: PlanStatus;
  goal?: string;
  steps?: Array<Pick<PlanStepRecord, "id" | "label" | "status" | "outputs" | "error" | "attempts" | "toolName" | "resolvedArgs">>;
  currentStep?: number;
  totalSteps?: number;
  progress?: number;
  message: string;
} {
  const plan = PLAN_STORE.get(input.planId);
  if (!plan) return { success: false, message: `找不到 plan：${input.planId}` };
  if (plan.userId !== input.userId) {
    return { success: false, message: "沒有權限存取這個 plan" };
  }
  const completed = plan.steps.filter(s => s.status === "completed").length;
  const total = plan.steps.length || 1;
  return {
    success: true,
    status: plan.status,
    goal: plan.goal,
    currentStep: completed,
    totalSteps: plan.steps.length,
    progress: Math.round((completed / total) * 100),
    steps: plan.steps.map(s => ({
      id: s.id,
      label: s.label,
      status: s.status,
      outputs: s.outputs,
      error: s.error,
      attempts: s.attempts,
      toolName: s.toolName,
      resolvedArgs: s.resolvedArgs,
    })),
    message: `plan ${plan.id}: ${completed}/${plan.steps.length} done, status=${plan.status}`,
  };
}

// ─── Public tool: planExecutor.controlPlan ───────────────────────────────────

export function controlPlan(input: {
  userId: number;
  planId: string;
  action: "pause" | "resume" | "cancel";
}): {
  success: boolean;
  status?: PlanStatus;
  message: string;
} {
  const plan = PLAN_STORE.get(input.planId);
  if (!plan) return { success: false, message: `找不到 plan：${input.planId}` };
  if (plan.userId !== input.userId) {
    return { success: false, message: "沒有權限存取這個 plan" };
  }
  switch (input.action) {
    case "pause":
      if (plan.status !== "running") {
        return { success: false, status: plan.status, message: `plan 不在 running 狀態（現為 ${plan.status}）` };
      }
      plan.control = "pause";
      return { success: true, status: plan.status, message: "已通知 plan 暫停（會在當前步結束後停下）" };
    case "resume":
      if (plan.status !== "paused") {
        return { success: false, status: plan.status, message: `plan 不在 paused 狀態（現為 ${plan.status}）` };
      }
      // 用 runPlan 重新接手（會從第一個 pending 步繼續）
      void runPlan({ userId: input.userId, planId: input.planId });
      return { success: true, status: "running", message: "已恢復執行" };
    case "cancel":
      if (plan.status === "completed" || plan.status === "cancelled" || plan.status === "failed") {
        return { success: false, status: plan.status, message: `plan 已經是 ${plan.status}，無法取消` };
      }
      plan.control = "cancel";
      if (plan.status === "paused" || plan.status === "draft") {
        plan.status = "cancelled";
        plan.completedAt = Date.now();
      }
      return { success: true, status: plan.status, message: "已取消（會在當前步結束後停下）" };
  }
}

// ─── Public tool: planExecutor.listRuns ──────────────────────────────────────

export function listRuns(input: { userId: number; limit?: number }): {
  success: boolean;
  runs: Array<{
    planId: string;
    goal: string;
    status: PlanStatus;
    stepCount: number;
    completed: number;
    createdAt: number;
    completedAt?: number;
  }>;
  message: string;
} {
  const limit = Math.min(50, Math.max(1, input.limit ?? 20));
  const runs = [...PLAN_STORE.values()]
    .filter(p => p.userId === input.userId)
    .sort((a, b) => (b.startedAt ?? b.createdAt) - (a.startedAt ?? a.createdAt))
    .slice(0, limit)
    .map(p => ({
      planId: p.id,
      goal: p.goal,
      status: p.status,
      stepCount: p.steps.length,
      completed: p.steps.filter(s => s.status === "completed").length,
      createdAt: p.createdAt,
      completedAt: p.completedAt,
    }));
  return { success: true, runs, message: `找到 ${runs.length} 個近期計畫` };
}

// ─── Public tool: planExecutor.replanOnFailure ───────────────────────────────

export async function replanOnFailure(input: {
  userId: number;
  userRole?: string;
  planId: string;
  /** Free-form addendum from user / inspector explaining the failure context. */
  hint?: string;
  tools?: OrbApiTool[];
  blockedTools?: string[];
}): Promise<{
  success: boolean;
  newPlanId?: string;
  message: string;
}> {
  const parent = PLAN_STORE.get(input.planId);
  if (!parent) return { success: false, message: `找不到 plan：${input.planId}` };
  if (parent.userId !== input.userId) {
    return { success: false, message: "沒有權限存取這個 plan" };
  }
  const failed = parent.steps.find(s => s.status === "failed");
  // 把失敗 step 的錯誤、原 args、與使用者 hint 一起餵 planner，讓它重排
  // 「剩餘」步驟（保留已完成步驟的結果作為 context，不重跑）。
  const completedSummary = parent.steps
    .filter(s => s.status === "completed")
    .map(s => `- ${s.id} (${s.label}) → outputs=${JSON.stringify(s.outputs).slice(0, 200)}`)
    .join("\n");
  const goal =
    `原目標：${parent.goal}\n` +
    `已完成步驟：\n${completedSummary || "(無)"}\n` +
    (failed
      ? `失敗步驟：${failed.id} (${failed.label}) — toolName=${failed.toolName} args=${JSON.stringify(failed.toolArgs)} error=${failed.error}\n`
      : "") +
    `使用者補充：${input.hint ?? "(無)"}\n` +
    `請只規劃「修補 + 剩餘步驟」，已完成的不要重跑；如需改用替代工具請給理由。`;

  const result = await planFromGoal({
    userId: input.userId,
    userRole: input.userRole,
    goal,
    tools: input.tools ?? parent.tools,
    blockedTools: input.blockedTools ?? parent.blockedTools,
  });
  if (result.success && result.planId) {
    const child = PLAN_STORE.get(result.planId);
    if (child) child.parentPlanId = parent.id;
  }
  return {
    success: result.success,
    newPlanId: result.planId,
    message: result.success ? `已建立修補 plan：${result.planId}` : result.message,
  };
}

// ─── Templates (kept for backward-compat with existing UI) ──────────────────

export function getWorkflowTemplates(): {
  success: boolean;
  templates: Array<{
    id: string;
    name: string;
    description: string;
    steps: string[];
    estimatedTime: string;
    suggestedTools?: string[];
  }>;
} {
  return {
    success: true,
    templates: [
      {
        id: "image-to-video-with-music",
        name: "圖片轉影片並配樂",
        description: "將圖片轉換成影片，自動生成背景音樂",
        steps: ["生成或上傳圖片", "圖片轉影片", "生成背景音樂", "合併影片和音樂"],
        estimatedTime: "10-15 分鐘",
        suggestedTools: ["studio.generateImage", "studio.generateVideo", "studio.generateAudio", "studio.mergeAudios"],
      },
      {
        id: "multi-image-story",
        name: "多圖故事生成",
        description: "根據劇本生成一系列連貫的圖片",
        steps: ["分析劇本", "生成場景圖片", "調整風格一致性", "整理成作品集"],
        estimatedTime: "15-20 分鐘",
        suggestedTools: ["director.suggestPlan", "studio.generateImage", "notesCurator.tagAssets"],
      },
      {
        id: "video-with-narration",
        name: "影片配旁白",
        description: "為影片生成並添加旁白",
        steps: ["分析影片", "生成旁白腳本", "語音合成", "合併影片和旁白"],
        estimatedTime: "10-12 分鐘",
        suggestedTools: ["studio.transcribe", "director.suggestPlan", "studio.generateVoice", "studio.mergeAudios"],
      },
    ],
  };
}

// ─── Back-compat shim: legacy createWorkflowPlan / executeWorkflowStep ──────
// 之前的 stub API 還有測試 / UI 在用，保留 thin wrapper 走新引擎。

export async function createWorkflowPlan(input: {
  userId: number;
  goal: string;
  steps: Array<{ action: string; parameters?: Record<string, unknown> }>;
}): Promise<{ success: boolean; planId?: string; message: string }> {
  return createPlan({
    userId: input.userId,
    goal: input.goal,
    steps: input.steps.map((s, idx) => ({
      id: newStepId(idx),
      label: s.action,
      toolName: s.action.includes(".") ? s.action : undefined,
      toolArgs: s.parameters,
    })),
  });
}

export async function executeWorkflowStep(input: {
  userId: number;
  planId: string;
  stepIndex: number;
}): Promise<{ success: boolean; result?: unknown; nextStep?: number; message: string }> {
  const r = await executeStep({
    userId: input.userId,
    planId: input.planId,
    stepIndex: input.stepIndex,
  });
  return {
    success: r.success,
    result: r.outputs,
    nextStep: r.success ? input.stepIndex + 1 : undefined,
    message: r.message,
  };
}

export async function getWorkflowStatus(input: {
  userId: number;
  planId: string;
}): Promise<{
  success: boolean;
  status: "pending" | "in_progress" | "completed" | "failed";
  currentStep?: number;
  totalSteps?: number;
  progress?: number;
}> {
  const r = getStatus({ userId: input.userId, planId: input.planId });
  if (!r.success || !r.status) return { success: false, status: "failed" };
  const mapped: "pending" | "in_progress" | "completed" | "failed" =
    r.status === "completed"
      ? "completed"
      : r.status === "failed" || r.status === "cancelled"
        ? "failed"
        : r.status === "running" || r.status === "paused"
          ? "in_progress"
          : "pending";
  return {
    success: true,
    status: mapped,
    currentStep: r.currentStep,
    totalSteps: r.totalSteps,
    progress: r.progress,
  };
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** @internal — used by unit tests to reset state between cases. */
export function _resetPlanStoreForTest(): void {
  PLAN_STORE.clear();
}

/** @internal — used by unit tests to inspect a plan directly. */
export function _getPlanForTest(planId: string): PlanRecord | undefined {
  return PLAN_STORE.get(planId);
}
