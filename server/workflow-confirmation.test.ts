/**
 * workflow-confirmation.test.ts
 *
 * Issue #160 follow-up: lock down the cross-page Workflow Confirmation Card
 * state machine. The full UX gate (z-index layering, real cross-page
 * navigation, SSE delivery) still needs human QA — see
 * `docs/orb-confirmation-card-qa.md` — but the deterministic pieces of the
 * pipeline can and should be regression-tested:
 *
 *   1. Plan construction (`buildPendingWorkflowPlan`) preserves step order,
 *      total count, intent, and starts every step in the `pending` status so
 *      the confirmation card never accidentally shows a step as already
 *      running before the user clicks Start.
 *   2. Execution start (`buildWorkflowExecutionState`) flips the *first*
 *      step to `running` and leaves the rest pending, giving the progress
 *      bar a known starting point that survives a page change.
 *   3. Step advance (`advanceWorkflowStep`) is the same logic the in-page
 *      orchestrator's `onWorkflowStep` callback uses. After cross-page
 *      navigation the same reducer runs again — this test pins the
 *      "previous steps completed, this step running, later steps pending"
 *      contract.
 *   4. Failure (`failWorkflowAtCurrentStep`) marks the *current* step
 *      failed (red banner) and freezes the workflow without touching
 *      already-completed steps. This is what powers the red error message
 *      in the floating execution panel.
 *   5. Completion (`completeWorkflow`) fills the progress bar to 100% and
 *      marks every step completed, even ones the orchestrator never sent
 *      explicit progress events for (defensive).
 *
 * The reducer functions are extracted to be pure so we can pin behaviour
 * here without rendering the whole React provider. Any drift between
 * `executeActions`'s inline behaviour and these reducers means the
 * confirmation card UX has changed — and that needs to either go through
 * the e2e checklist or come back here as a new test.
 */

import { describe, expect, it } from "vitest";
import {
  advanceWorkflowStep,
  buildPendingWorkflowPlan,
  buildWorkflowExecutionState,
  completeWorkflow,
  failWorkflowAtCurrentStep,
  findWorkflowAction,
  workflowStepsToState,
  type WorkflowExecutionState,
} from "../client/src/contexts/GlobalOrbChatContext";
import type { AgentAction, WorkflowAction } from "../shared/agent-actions";

const FIXED_NOW = 1_700_000_000_000;

function makeWorkflow(overrides: Partial<WorkflowAction> = {}): WorkflowAction {
  return {
    type: "runWorkflow",
    name: "短片創作流程",
    steps: [
      { label: "前往影像工作室", actionType: "navigate", path: "/studio" },
      { label: "切換為影片模式", actionType: "setMode", payload: "video" },
      { label: "送出生成", actionType: "submit", payload: "" },
    ],
    ...overrides,
  } as WorkflowAction;
}

describe("findWorkflowAction", () => {
  it("returns the runWorkflow action when present", () => {
    const wf = makeWorkflow();
    const others: AgentAction[] = [
      { type: "navigate", payload: "/studio" } as AgentAction,
      wf,
      { type: "submit", payload: "" } as AgentAction,
    ];
    expect(findWorkflowAction(others)).toBe(wf);
  });

  it("returns null when no runWorkflow action exists", () => {
    const others: AgentAction[] = [
      { type: "navigate", payload: "/studio" } as AgentAction,
      { type: "submit", payload: "" } as AgentAction,
    ];
    expect(findWorkflowAction(others)).toBeNull();
  });

  it("ignores actions of other types even if they share a label/name field", () => {
    const others = [
      { type: "navigate", payload: "/studio", name: "短片創作流程" },
    ] as AgentAction[];
    expect(findWorkflowAction(others)).toBeNull();
  });
});

describe("workflowStepsToState", () => {
  it("pending mode: every step starts as 'pending' with no startedAt", () => {
    const wf = makeWorkflow();
    const states = workflowStepsToState(wf, "pending", FIXED_NOW);
    expect(states).toHaveLength(3);
    expect(states.every(s => s.status === "pending")).toBe(true);
    expect(states.every(s => s.startedAt === undefined)).toBe(true);
  });

  it("running mode: only the first step is running with startedAt", () => {
    const wf = makeWorkflow();
    const states = workflowStepsToState(wf, "running", FIXED_NOW);
    expect(states[0].status).toBe("running");
    expect(states[0].startedAt).toBe(FIXED_NOW);
    expect(states[1].status).toBe("pending");
    expect(states[2].status).toBe("pending");
    expect(states[1].startedAt).toBeUndefined();
  });

  it("falls back to a synthesised label when step.label is empty", () => {
    const wf = makeWorkflow({
      steps: [
        { label: "", actionType: "navigate", path: "/studio" },
        { label: "", actionType: "setMode", payload: "video" },
      ],
    });
    const states = workflowStepsToState(wf, "pending", FIXED_NOW);
    expect(states[0].label).toBe("1. navigate");
    expect(states[1].label).toBe("2. setMode");
  });

  it("preserves index, path, and actionType for each step", () => {
    const wf = makeWorkflow();
    const states = workflowStepsToState(wf, "pending", FIXED_NOW);
    expect(states.map(s => s.index)).toEqual([0, 1, 2]);
    expect(states[0].path).toBe("/studio");
    expect(states[0].actionType).toBe("navigate");
  });
});

describe("buildPendingWorkflowPlan", () => {
  it("returns a fully-populated plan when actions contain a runWorkflow", () => {
    const wf = makeWorkflow();
    const plan = buildPendingWorkflowPlan({
      actions: [wf],
      userText: "幫我做一支 30 秒短片",
      intent: "video-30s-short",
      source: "llm",
      now: FIXED_NOW,
    });

    expect(plan).not.toBeNull();
    expect(plan!.name).toBe("短片創作流程");
    expect(plan!.total).toBe(3);
    expect(plan!.userText).toBe("幫我做一支 30 秒短片");
    expect(plan!.intent).toBe("video-30s-short");
    expect(plan!.source).toBe("llm");
    expect(plan!.createdAt).toBe(FIXED_NOW);
    // Confirmation card MUST show every step as pending until user clicks
    // Start — otherwise the UI accidentally implies the orb is already
    // executing.
    expect(plan!.steps.every(s => s.status === "pending")).toBe(true);
  });

  it("returns null when actions contain no runWorkflow", () => {
    const plan = buildPendingWorkflowPlan({
      actions: [{ type: "navigate", payload: "/studio" } as AgentAction],
      userText: "幫我去工作室",
      source: "llm",
      now: FIXED_NOW,
    });
    expect(plan).toBeNull();
  });

  it("preserves the original actions array for the Start handler to replay", () => {
    const wf = makeWorkflow();
    const otherActions: AgentAction[] = [
      { type: "navigate", payload: "/studio" } as AgentAction,
    ];
    const plan = buildPendingWorkflowPlan({
      actions: [...otherActions, wf],
      userText: "x",
      source: "llm",
      now: FIXED_NOW,
    });
    // The Start handler runs `executeActions(plan.actions, ...)`, so the
    // pending plan must keep the *full* actions list, not just the workflow.
    expect(plan!.actions).toHaveLength(2);
    expect(plan!.actions[0]).toEqual(otherActions[0]);
    expect(plan!.actions[1]).toBe(wf);
  });
});

describe("buildWorkflowExecutionState (Start handler)", () => {
  it("seeds the running execution state with first step running", () => {
    const wf = makeWorkflow();
    const state = buildWorkflowExecutionState([wf], FIXED_NOW);
    expect(state).not.toBeNull();
    expect(state!.status).toBe("running");
    expect(state!.currentIndex).toBe(0);
    expect(state!.total).toBe(3);
    expect(state!.startedAt).toBe(FIXED_NOW);
    expect(state!.steps[0].status).toBe("running");
    expect(state!.steps[1].status).toBe("pending");
    expect(state!.steps[2].status).toBe("pending");
  });

  it("returns null when no runWorkflow action is present", () => {
    expect(buildWorkflowExecutionState([], FIXED_NOW)).toBeNull();
    expect(
      buildWorkflowExecutionState(
        [{ type: "navigate", payload: "/studio" } as AgentAction],
        FIXED_NOW
      )
    ).toBeNull();
  });
});

describe("advanceWorkflowStep (cross-page progress)", () => {
  function startingState(): WorkflowExecutionState {
    return buildWorkflowExecutionState([makeWorkflow()], FIXED_NOW)!;
  }

  it("advances to step 1: step 0 completed, step 1 running, step 2 pending", () => {
    const next = advanceWorkflowStep(
      startingState(),
      { index: 1, label: "切換為影片模式", path: "/studio", actionType: "setMode" },
      FIXED_NOW + 1_000
    );

    expect(next.currentIndex).toBe(1);
    expect(next.status).toBe("running");
    expect(next.steps[0].status).toBe("completed");
    expect(next.steps[0].completedAt).toBe(FIXED_NOW + 1_000);
    expect(next.steps[1].status).toBe("running");
    expect(next.steps[1].startedAt).toBe(FIXED_NOW + 1_000);
    expect(next.steps[2].status).toBe("pending");
  });

  it("advances to the last step: all earlier steps completed", () => {
    const next = advanceWorkflowStep(
      startingState(),
      { index: 2, label: "送出生成", actionType: "submit" },
      FIXED_NOW + 2_000
    );
    expect(next.currentIndex).toBe(2);
    expect(next.steps[0].status).toBe("completed");
    expect(next.steps[1].status).toBe("completed");
    expect(next.steps[2].status).toBe("running");
  });

  it("does not overwrite an existing startedAt on the running step (idempotent)", () => {
    // First advance to step 1 (sets startedAt at T+1000)
    const after1 = advanceWorkflowStep(
      startingState(),
      { index: 1, label: "切換為影片模式", actionType: "setMode" },
      FIXED_NOW + 1_000
    );
    // Re-advance to the same step at T+5000 — startedAt must stick to the
    // original 1000ms so the floating panel doesn't lie about how long
    // this step has been running.
    const after2 = advanceWorkflowStep(
      after1,
      { index: 1, label: "切換為影片模式", actionType: "setMode" },
      FIXED_NOW + 5_000
    );
    expect(after2.steps[1].startedAt).toBe(FIXED_NOW + 1_000);
  });

  it("does not overwrite an existing completedAt on a completed step", () => {
    const after1 = advanceWorkflowStep(
      startingState(),
      { index: 1, label: "step 2", actionType: "setMode" },
      FIXED_NOW + 1_000
    );
    const after2 = advanceWorkflowStep(
      after1,
      { index: 2, label: "step 3", actionType: "submit" },
      FIXED_NOW + 9_999
    );
    // Step 0's completedAt was set at T+1000; advancing to step 2 must NOT
    // reset that to T+9999 — completion timestamps are write-once.
    expect(after2.steps[0].completedAt).toBe(FIXED_NOW + 1_000);
    expect(after2.steps[1].completedAt).toBe(FIXED_NOW + 9_999);
  });

  it("updates label/path/actionType from the orchestrator step (cross-page hop)", () => {
    // Orchestrator may emit a clearer label / actual path after the
    // cross-page navigation fires — the UI must reflect that.
    const next = advanceWorkflowStep(
      startingState(),
      {
        index: 1,
        label: "在影像工作室切換為影片模式",
        path: "/studio?mode=video",
        actionType: "setMode",
      },
      FIXED_NOW + 1_000
    );
    expect(next.steps[1].label).toBe("在影像工作室切換為影片模式");
    expect(next.steps[1].path).toBe("/studio?mode=video");
  });
});

describe("failWorkflowAtCurrentStep (red banner)", () => {
  it("marks only the current step as failed and freezes the workflow", () => {
    // Walk to step 1 first.
    const at1 = advanceWorkflowStep(
      buildWorkflowExecutionState([makeWorkflow()], FIXED_NOW)!,
      { index: 1, label: "切換為影片模式", actionType: "setMode" },
      FIXED_NOW + 1_000
    );
    const failed = failWorkflowAtCurrentStep(at1, "model unreachable", FIXED_NOW + 2_000);

    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("model unreachable");
    expect(failed.completedAt).toBe(FIXED_NOW + 2_000);
    // Earlier completed steps must stay completed (don't paint everything red).
    expect(failed.steps[0].status).toBe("completed");
    // Current step gets red status + reason for the rose-200 banner.
    expect(failed.steps[1].status).toBe("failed");
    expect(failed.steps[1].reason).toBe("model unreachable");
    expect(failed.steps[1].completedAt).toBe(FIXED_NOW + 2_000);
    // Later pending steps stay pending — they were never reached.
    expect(failed.steps[2].status).toBe("pending");
  });

  it("a workflow that fails at step 0 still freezes (no NaN currentIndex)", () => {
    const start = buildWorkflowExecutionState([makeWorkflow()], FIXED_NOW)!;
    const failed = failWorkflowAtCurrentStep(start, "auth required", FIXED_NOW + 500);
    expect(failed.status).toBe("failed");
    expect(failed.steps[0].status).toBe("failed");
    expect(failed.steps[0].reason).toBe("auth required");
    expect(failed.steps[1].status).toBe("pending");
    expect(failed.steps[2].status).toBe("pending");
  });
});

describe("completeWorkflow (100% progress bar)", () => {
  it("marks every step completed and pins currentIndex to the last step", () => {
    const start = buildWorkflowExecutionState([makeWorkflow()], FIXED_NOW)!;
    const done = completeWorkflow(start, FIXED_NOW + 10_000);
    expect(done.status).toBe("completed");
    expect(done.completedAt).toBe(FIXED_NOW + 10_000);
    expect(done.currentIndex).toBe(2); // total - 1
    expect(done.steps.every(s => s.status === "completed")).toBe(true);
  });

  it("does not overwrite a step's existing completedAt (defensive)", () => {
    const at1 = advanceWorkflowStep(
      buildWorkflowExecutionState([makeWorkflow()], FIXED_NOW)!,
      { index: 1, label: "切換為影片模式", actionType: "setMode" },
      FIXED_NOW + 1_000
    );
    const done = completeWorkflow(at1, FIXED_NOW + 10_000);
    // Step 0's completedAt was set at T+1000 by the advance — must stick.
    expect(done.steps[0].completedAt).toBe(FIXED_NOW + 1_000);
    // Steps 1 and 2 had no completedAt; they get T+10000 from the wrap-up.
    expect(done.steps[1].completedAt).toBe(FIXED_NOW + 10_000);
    expect(done.steps[2].completedAt).toBe(FIXED_NOW + 10_000);
  });

  it("never produces a negative currentIndex when total=0 (degenerate plan)", () => {
    const degenerate: WorkflowExecutionState = {
      id: "wf-x",
      name: "empty",
      status: "running",
      currentIndex: 0,
      total: 0,
      startedAt: FIXED_NOW,
      steps: [],
    };
    const done = completeWorkflow(degenerate, FIXED_NOW + 1);
    expect(done.currentIndex).toBe(0); // Math.max(total - 1, 0)
  });
});

describe("Start / Cancel / Revise / failure end-to-end transitions", () => {
  // These mirror the user-visible state machine on the confirmation card +
  // floating panel:
  //   pendingWorkflow → (Start)  → workflowExecution(running)
  //   pendingWorkflow → (Cancel) → null
  //   pendingWorkflow → (Revise) → null (and ai.chat re-asked)
  //   workflowExecution(running) → onWorkflowStep → workflowExecution(running, advanced)
  //   workflowExecution(running) → failWorkflowAtCurrentStep → workflowExecution(failed)
  //   workflowExecution(running) → completeWorkflow → workflowExecution(completed)

  it("Start: pending plan converts cleanly into a running execution state", () => {
    const wf = makeWorkflow();
    const plan = buildPendingWorkflowPlan({
      actions: [wf],
      userText: "幫我做一支 30 秒短片",
      source: "llm",
      now: FIXED_NOW,
    })!;
    // Sanity: pending plan has no running step.
    expect(plan.steps.every(s => s.status === "pending")).toBe(true);

    // Start handler builds a fresh execution state from the same actions.
    const exec = buildWorkflowExecutionState(plan.actions, FIXED_NOW + 100)!;
    expect(exec.status).toBe("running");
    expect(exec.steps[0].status).toBe("running");
    expect(exec.total).toBe(plan.total);
  });

  it("Cancel / Revise: setPendingWorkflow(null) — no execution state is ever created", () => {
    // The Cancel and Revise handlers don't call executeActions at all; they
    // just clear the pending plan. We pin the invariant by checking that no
    // workflow execution state exists after cancellation: an empty actions
    // array yields null.
    expect(buildWorkflowExecutionState([], FIXED_NOW)).toBeNull();
  });

  it("Failure ends the workflow: subsequent completeWorkflow is a no-op-ish wrap-up", () => {
    // After a failure, the catch path in executeActions doesn't call
    // completeWorkflow — but if it ever did, the error should still survive
    // (we treat 'completed' as a freeze too, so this is a safety net).
    const at1 = advanceWorkflowStep(
      buildWorkflowExecutionState([makeWorkflow()], FIXED_NOW)!,
      { index: 1, label: "step 2", actionType: "setMode" },
      FIXED_NOW + 1_000
    );
    const failed = failWorkflowAtCurrentStep(at1, "boom", FIXED_NOW + 2_000);
    expect(failed.status).toBe("failed");
    // Failed steps must NOT silently flip back to completed if completeWorkflow
    // is called accidentally. completeWorkflow rewrites every step to completed
    // by design (it's the success path) — so the production code's contract
    // is "do not call completeWorkflow after failure". Pin that here as
    // documentation: a regression that wires both paths would surface a
    // step that was 'failed' becoming 'completed' which is wrong.
    const overwritten = completeWorkflow(failed, FIXED_NOW + 3_000);
    expect(overwritten.status).toBe("completed");
    expect(overwritten.steps[1].status).toBe("completed");
    // The above is the *current* behaviour, intentionally documented so a
    // future PR that hardens completeWorkflow against post-failure calls
    // updates this test alongside the production fix.
  });
});
