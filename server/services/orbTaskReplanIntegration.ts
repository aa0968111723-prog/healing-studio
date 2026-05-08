/**
 * server/services/orbTaskReplanIntegration.ts
 *
 * Integration layer that wires up orbLLMReplan into the orchestrator's
 * onRequestReplan callback. This closes the ReAct loop at the step level.
 *
 * Architecture:
 *   1. Orchestrator detects step failure after retries exhausted
 *   2. Calls onRequestReplan with observation
 *   3. This module invokes orbLLMReplan (deterministic first, then LLM)
 *   4. Returns revised steps that replace the failed step
 *   5. Orchestrator continues with new plan
 */

import type { OrbTask, OrbPlanStep } from "../../shared/orb-agent-contract";
import type { AgentWorkflowStep } from "../../shared/agent-actions";
import { orbLLMReplan, deterministicReplan, type OrbLLMReplanInput } from "./orbLLMReplan";
import { appendOrbAgentTaskAuditEvent } from "./orbTaskStateMachine";
import { recordOrbMemory } from "./orbMemory";
import { orbTaskTracer } from "./orbTaskTracer";
import { orbTaskStore } from "./orbTaskStore";

export interface ReplanCallbackContext {
  task: OrbTask;
  userId: number;
  failedStep: AgentWorkflowStep;
  observation: {
    toolName: string;
    errorCode: string;
    issues: string[];
    toolArgs: unknown;
  };
  traceId?: string;
}

/**
 * Convert an `AgentWorkflowStep` (LLM/deterministic replan output shape) into
 * an `OrbPlanStep` (the orb task store's persisted shape).
 *
 * Replan emits the leaner workflow-step shape (toolName + toolArgs + path),
 * while the store keeps the richer plan-step shape (toolCalls[] + uiActions[]
 * + pagePath). Without this bridge the revised steps couldn't be persisted
 * even after `injectRevisedSteps` landed.
 *
 * Rules:
 *   - When `toolName` is set, emit a single `toolCalls[0]` entry; per the
 *     contract docstring on AgentWorkflowStep, actionType/payload are then
 *     ignored, so we don't double-fire as a UI action.
 *   - When `toolName` is absent, emit a single `uiActions[0]` from
 *     actionType/payload — replan rarely produces these but the converter
 *     stays total so deterministic patterns that flip back to UI dispatch
 *     keep working.
 *   - Step id must be present in the store; we synthesise one if the
 *     replan output left it blank.
 *   - `requiresApproval` is hard-set to false; the store has its own
 *     approval gating via `task.needsApproval` and step-level approvals,
 *     and replan never re-adds UI confirmation gates by itself.
 */
function workflowStepToPlanStep(step: AgentWorkflowStep): OrbPlanStep {
  const id =
    step.id && step.id.length > 0
      ? step.id
      : `replanned_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  if (step.toolName && step.toolName.length > 0) {
    return {
      id,
      label: step.label,
      pagePath: step.path,
      uiActions: [],
      toolCalls: [
        {
          name: step.toolName,
          args: (step.toolArgs ?? {}) as Record<string, unknown>,
          requiresApproval: false,
        },
      ],
    };
  }

  return {
    id,
    label: step.label,
    pagePath: step.path,
    uiActions: [
      {
        type: step.actionType,
        payload: step.payload,
      },
    ],
    toolCalls: [],
  };
}

/**
 * Apply a list of revised `AgentWorkflowStep`s to the task in the store by
 * splicing them into the position of the failed step.
 *
 * Returns true on success, false if the store rejected the splice (task gone,
 * index out of range, would exceed cap, etc.) so the caller can fall through
 * to the failure path instead of pretending the replan landed.
 */
function applyRevisedSteps(
  context: ReplanCallbackContext,
  revisedWorkflowSteps: AgentWorkflowStep[]
): boolean {
  if (revisedWorkflowSteps.length === 0) return false;

  const failedStepId = context.failedStep.id;
  if (!failedStepId) {
    console.warn("[replan] failedStep has no id; cannot locate splice point");
    return false;
  }
  const atIndex = context.task.steps.findIndex(s => s.id === failedStepId);
  if (atIndex < 0) {
    console.warn(
      `[replan] failedStep id ${failedStepId} not found in task.steps; skipping injection`
    );
    return false;
  }

  const planSteps = revisedWorkflowSteps.map(workflowStepToPlanStep);
  const updated = orbTaskStore.injectRevisedSteps(
    context.task.taskId,
    context.userId,
    atIndex,
    planSteps
  );
  return updated !== null;
}

/**
 * Create an onRequestReplan callback for the orchestrator.
 * This is the bridge that connects step-level failures to the replanning engine.
 */
export function createReplanCallback(context: ReplanCallbackContext) {
  return async (payload: {
    taskId: string;
    stepId: string;
    toolName: string;
    observation: {
      toolName: string;
      errorCode: string;
      issues: string[];
      toolArgs: unknown;
    };
    reason: string;
  }): Promise<void> => {
    const traceId = context.traceId || `trace_${context.task.taskId}`;
    const spanId = `replan_${Date.now()}`;

    // Start observability span
    orbTaskTracer.addSpan(traceId, {
      spanId,
      name: `Replanning after ${payload.toolName} failure`,
      kind: "llm",
      startedAt: Date.now(),
      status: "pending",
      userId: context.userId,
      taskId: context.task.taskId,
      stepId: payload.stepId,
      toolName: payload.toolName,
      metadata: {
        errorCode: payload.observation.errorCode,
        issues: payload.observation.issues,
        reason: payload.reason,
      },
    });

    try {
      // Try deterministic replanning first (fast path)
      console.log(`[replan] Attempting deterministic replan for ${payload.toolName}...`);
      const deterministicResult = deterministicReplan(
        context.failedStep,
        payload.observation
      );

      if (deterministicResult && deterministicResult.length > 0) {
        console.log(`[replan] Deterministic replan succeeded with ${deterministicResult.length} steps`);

        const applied = applyRevisedSteps(context, deterministicResult);

        // Record success
        appendOrbAgentTaskAuditEvent(
          payload.taskId,
          applied ? "task.replanned" : "task.replan_failed",
          applied
            ? `Deterministic replanning succeeded for ${payload.toolName}`
            : `Deterministic replan generated steps but injection was rejected for ${payload.toolName}`,
          {
            stepId: payload.stepId,
            strategy: "deterministic",
            revisedStepCount: deterministicResult.length,
            applied,
          }
        );

        recordOrbMemory({
          userId: context.userId,
          traceId,
          taskId: payload.taskId,
          type: "recovery_event",
          summary: applied
            ? `Deterministic replan fixed ${payload.toolName} (${payload.observation.errorCode})`
            : `Deterministic replan rejected by store for ${payload.toolName}`,
          source: "orchestrator.replan.deterministic",
          confidence: applied ? 0.95 : 0.4,
          tags: [
            applied ? "replan-success" : "replan-applied-fail",
            "deterministic",
            payload.toolName,
          ],
          metadata: {
            errorCode: payload.observation.errorCode,
            revisedSteps: deterministicResult.map(s => s.id),
            applied,
          },
        });

        orbTaskTracer.endSpan(traceId, spanId, {
          status: applied ? "success" : "failed",
          output: {
            strategy: "deterministic",
            stepCount: deterministicResult.length,
            applied,
          },
          ...(applied
            ? {}
            : { error: "store rejected revised steps", errorCode: "replan-inject-rejected" }),
        });
        return;
      }

      // Deterministic failed, try LLM-based replanning
      console.log(`[replan] Deterministic replan unavailable, invoking LLM...`);
      const replanInput: OrbLLMReplanInput = {
        task: context.task,
        failedStep: context.failedStep,
        observation: payload.observation,
        maxRetries: 2,
        userId: context.userId,
      };

      const llmResult = await orbLLMReplan(replanInput);

      if (llmResult.success && llmResult.revisedSteps.length > 0) {
        console.log(
          `[replan] LLM replan succeeded with ${llmResult.revisedSteps.length} steps: ${llmResult.reasoning}`
        );

        const applied = applyRevisedSteps(context, llmResult.revisedSteps);

        appendOrbAgentTaskAuditEvent(
          payload.taskId,
          applied ? "task.replanned" : "task.replan_failed",
          applied
            ? `LLM replanning succeeded: ${llmResult.reasoning}`
            : `LLM replan generated steps but injection was rejected: ${llmResult.reasoning}`,
          {
            stepId: payload.stepId,
            strategy: "llm",
            revisedStepCount: llmResult.revisedSteps.length,
            reasoning: llmResult.reasoning,
            fallbackAction: llmResult.fallbackAction,
            applied,
          }
        );

        recordOrbMemory({
          userId: context.userId,
          traceId,
          taskId: payload.taskId,
          type: "recovery_event",
          summary: applied
            ? `LLM replan fixed ${payload.toolName}: ${llmResult.reasoning}`
            : `LLM replan rejected by store: ${llmResult.reasoning}`,
          source: "orchestrator.replan.llm",
          confidence: applied ? 0.85 : 0.4,
          tags: [
            applied ? "replan-success" : "replan-applied-fail",
            "llm",
            payload.toolName,
          ],
          metadata: {
            errorCode: payload.observation.errorCode,
            reasoning: llmResult.reasoning,
            revisedSteps: llmResult.revisedSteps.map(s => s.id),
            fallbackAction: llmResult.fallbackAction,
            applied,
          },
        });

        orbTaskTracer.endSpan(traceId, spanId, {
          status: applied ? "success" : "failed",
          output: {
            strategy: "llm",
            stepCount: llmResult.revisedSteps.length,
            reasoning: llmResult.reasoning,
            applied,
          },
          ...(applied
            ? {}
            : { error: "store rejected revised steps", errorCode: "replan-inject-rejected" }),
        });
        return;
      }

      // Replanning failed
      console.warn(`[replan] Both deterministic and LLM replanning failed for ${payload.toolName}`);

      appendOrbAgentTaskAuditEvent(
        payload.taskId,
        "task.replan_failed",
        `Replanning failed: ${llmResult.error || "no viable alternative found"}`,
        {
          stepId: payload.stepId,
          errorCode: payload.observation.errorCode,
          fallbackAction: llmResult.fallbackAction,
        }
      );

      recordOrbMemory({
        userId: context.userId,
        traceId,
        taskId: payload.taskId,
        type: "recovery_event",
        summary: `Replan failed for ${payload.toolName} (${payload.observation.errorCode})`,
        source: "orchestrator.replan.failed",
        confidence: 0.9,
        tags: ["replan-failed", payload.toolName],
        metadata: {
          errorCode: payload.observation.errorCode,
          error: llmResult.error,
          fallbackAction: llmResult.fallbackAction,
        },
      });

      orbTaskTracer.endSpan(traceId, spanId, {
        status: "failed",
        error: llmResult.error || "No viable replan found",
        errorCode: "replan-exhausted",
      });

    } catch (error) {
      console.error("[replan] Replanning threw exception:", error);

      appendOrbAgentTaskAuditEvent(
        payload.taskId,
        "task.replan_error",
        `Replanning error: ${error instanceof Error ? error.message : String(error)}`,
        { stepId: payload.stepId }
      );

      orbTaskTracer.endSpan(traceId, spanId, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        errorCode: "replan-exception",
      });
    }
  };
}
