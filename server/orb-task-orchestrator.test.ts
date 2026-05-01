import { afterEach, describe, expect, it, vi } from "vitest";
import { executeCurrentStepTools } from "./services/orbTaskOrchestrator";
import type { OrbTask } from "../shared/orb-agent-contract";

const baseTask: OrbTask = {
  taskId: "t1",
  userId: 7,
  intent: "build",
  status: "running",
  steps: [
    {
      id: "s1",
      label: "tool step",
      toolCalls: [{ name: "crm.lookup", args: { id: "u_1" }, requiresApproval: false }],
      uiActions: [],
    },
  ],
  currentStepIndex: 0,
  needsApproval: false,
  approvedStepIds: [],
  stepApprovals: [],
  stepReports: [],
  createdAt: 1,
  updatedAt: 1,
};

describe("executeCurrentStepTools", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ORB_TOOL_ALLOWED_ORIGINS;
  });

  it("returns attempted=false when no tools on current step", async () => {
    const out = await executeCurrentStepTools({
      task: { ...baseTask, steps: [{ ...baseTask.steps[0], toolCalls: [] }] },
      userId: 7,
      userRole: "user",
      tools: [],
      approved: true,
    });
    expect(out).toEqual({ attempted: false, toolResults: [], ok: true });
  });

  it("runs tools and returns ok=true when all calls succeed", async () => {
    process.env.ORB_TOOL_ALLOWED_ORIGINS = "https://api.example.com";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    );

    const out = await executeCurrentStepTools({
      task: baseTask,
      userId: 7,
      userRole: "user",
      tools: [
        {
          name: "crm.lookup",
          description: "lookup",
          method: "GET",
          endpoint: "https://api.example.com/customers",
        },
      ],
      approved: true,
    });

    expect(out.attempted).toBe(true);
    expect(out.ok).toBe(true);
    expect(out.toolResults[0]?.ok).toBe(true);
  });

  it("blocks execution when step requires approval and step not approved", async () => {
    process.env.ORB_TOOL_ALLOWED_ORIGINS = "https://api.example.com";
    const out = await executeCurrentStepTools({
      task: {
        ...baseTask,
        steps: [
          {
            ...baseTask.steps[0],
            toolCalls: [
              { name: "crm.lookup", args: { id: "u_1" }, requiresApproval: true },
            ],
          },
        ],
      },
      userId: 7,
      userRole: "user",
      tools: [
        {
          name: "crm.lookup",
          description: "lookup",
          method: "GET",
          endpoint: "https://api.example.com/customers",
          requireConfirmation: true,
        },
      ],
      approved: false,
    });
    expect(out.ok).toBe(false);
    expect(out.blockedByApproval).toBe(true);
    expect(out.attempted).toBe(false);
    expect(out.toolResults[0]?.error).toBe("step-approval-required");
  });

  it("returns forbidden-role when tool role policy denies caller", async () => {
    process.env.ORB_TOOL_ALLOWED_ORIGINS = "https://api.example.com";
    const out = await executeCurrentStepTools({
      task: baseTask,
      userId: 7,
      userRole: "user",
      tools: [
        {
          name: "crm.lookup",
          description: "lookup",
          method: "GET",
          endpoint: "https://api.example.com/customers",
          allowedRoles: ["admin"],
        },
      ],
      approved: true,
    });
    expect(out.ok).toBe(false);
    expect(out.toolResults[0]?.error).toBe("forbidden-role");
  });

  it("fails the step with unresolved-step-ref when ${stepN.x} placeholder cannot be resolved", async () => {
    // Reproduces the audit's #3 silent-failure: planner chains step2 with
    // `${step1.video_url}` but step1 returned `{ url: ... }` instead of
    // `video_url`. Without the guard, the literal placeholder string was
    // forwarded to the remote tool (fal.ai / Suno / ElevenLabs) and the
    // request 4xx'd hours later with no clear error. With the guard, we
    // refuse to dispatch the tool and surface the missing reference up
    // front so the FSM marks the step failed and the user / planner can
    // see exactly which path was wrong.
    process.env.ORB_TOOL_ALLOWED_ORIGINS = "https://api.example.com";
    const fetchSpy = vi.fn(async () =>
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchSpy);

    const out = await executeCurrentStepTools({
      task: {
        ...baseTask,
        steps: [
          {
            ...baseTask.steps[0],
            toolCalls: [
              {
                name: "crm.lookup",
                // Placeholder that won't resolve — no perStepToolResults are
                // provided, so the resolver leaves it in place.
                args: { id: "${step1.video_url}" },
                requiresApproval: false,
              },
            ],
          },
        ],
      },
      userId: 7,
      userRole: "user",
      tools: [
        {
          name: "crm.lookup",
          description: "lookup",
          method: "GET",
          endpoint: "https://api.example.com/customers",
        },
      ],
      approved: true,
    });

    expect(out.attempted).toBe(true);
    expect(out.ok).toBe(false);
    expect(out.toolResults[0]?.error).toContain("unresolved-step-ref");
    expect(out.toolResults[0]?.error).toContain("${step1.video_url}");
    // Critically: the remote tool must NOT have been dispatched.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("dispatches normally when the placeholder resolves to a real value", async () => {
    process.env.ORB_TOOL_ALLOWED_ORIGINS = "https://api.example.com";
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchSpy);

    const out = await executeCurrentStepTools({
      task: {
        ...baseTask,
        steps: [
          {
            ...baseTask.steps[0],
            toolCalls: [
              {
                name: "crm.lookup",
                args: { id: "${step1.video_url}" },
                requiresApproval: false,
              },
            ],
          },
        ],
      },
      userId: 7,
      userRole: "user",
      tools: [
        {
          name: "crm.lookup",
          description: "lookup",
          method: "GET",
          endpoint: "https://api.example.com/customers",
        },
      ],
      approved: true,
      perStepToolResults: [
        {
          stepId: "step1",
          toolResults: [
            { name: "studio.generateVideo", ok: true, data: { video_url: "https://cdn.test/v.mp4" } },
          ],
        },
      ],
    });

    expect(out.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});

import { runOrbTaskToCompletion } from "./services/orbTaskOrchestrator";
import { OrbTaskStore } from "./services/orbTaskStore";
import type { OrbPlanStep } from "../shared/orb-agent-contract";

function makeSteps(): OrbPlanStep[] {
  return [
    {
      id: "step_subtitle",
      label: "subtitle",
      uiActions: [],
      toolCalls: [{ name: "subtitle.generate", args: { lang: "zh-TW" }, requiresApproval: false }],
    },
    {
      id: "step_dub",
      label: "dub",
      uiActions: [],
      toolCalls: [{ name: "dub.synthesize", args: { voice: "v1" }, requiresApproval: false }],
    },
    {
      id: "step_render",
      label: "render",
      uiActions: [],
      toolCalls: [{ name: "video.render", args: { fps: 30 }, requiresApproval: false }],
    },
  ];
}

const ALL_TOOLS = [
  {
    name: "subtitle.generate",
    description: "subtitle",
    method: "POST" as const,
    endpoint: "https://api.example.com/subtitle",
  },
  {
    name: "dub.synthesize",
    description: "dub",
    method: "POST" as const,
    endpoint: "https://api.example.com/dub",
  },
  {
    name: "video.render",
    description: "render",
    method: "POST" as const,
    endpoint: "https://api.example.com/render",
  },
];

describe("runOrbTaskToCompletion (multi-step driver)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ORB_TOOL_ALLOWED_ORIGINS;
  });

  it("walks all three steps in order and ends with status=done", async () => {
    process.env.ORB_TOOL_ALLOWED_ORIGINS = "https://api.example.com";
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const store = new OrbTaskStore();
    const created = store.create({
      userId: 42,
      intent: "subtitle → dub → render",
      steps: makeSteps(),
      needsApproval: false,
    });

    const result = await runOrbTaskToCompletion({
      taskId: created.taskId,
      userId: 42,
      userRole: "user",
      tools: ALL_TOOLS,
      store,
    });

    expect(result.outcome).toBe("completed");
    expect(result.stepsRun).toBe(3);
    expect(result.perStepToolResults.map(s => s.stepId)).toEqual([
      "step_subtitle",
      "step_dub",
      "step_render",
    ]);
    expect(result.perStepToolResults.every(s => s.ok)).toBe(true);
    expect(result.finalTask?.status).toBe("done");
    expect(result.finalTask?.currentStepIndex).toBe(3);
    expect(result.finalTask?.stepReports).toHaveLength(3);
    expect(result.finalTask?.stepReports.every(r => r.ok)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("halts on first failed step and marks task=failed without running later steps", async () => {
    process.env.ORB_TOOL_ALLOWED_ORIGINS = "https://api.example.com";
    let callCount = 0;
    const fetchMock = vi.fn(async () => {
      callCount += 1;
      if (callCount === 2) {
        // dub.synthesize fails permanently (4xx, not retryable)
        return new Response("nope", {
          status: 400,
          headers: { "content-type": "text/plain" },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = new OrbTaskStore();
    const created = store.create({
      userId: 42,
      intent: "subtitle → dub → render",
      steps: makeSteps(),
      needsApproval: false,
    });

    const result = await runOrbTaskToCompletion({
      taskId: created.taskId,
      userId: 42,
      userRole: "user",
      tools: ALL_TOOLS,
      store,
    });

    expect(result.outcome).toBe("failed");
    expect(result.stepsRun).toBe(2); // subtitle ok, dub failed, render never attempted
    expect(result.perStepToolResults).toHaveLength(2);
    expect(result.perStepToolResults[0].ok).toBe(true);
    expect(result.perStepToolResults[1].ok).toBe(false);
    expect(result.finalTask?.status).toBe("failed");
    expect(result.finalTask?.stepReports.find(r => !r.ok)?.stepId).toBe("step_dub");
    // render must NOT have been called
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns awaiting_approval when an unapproved step requires confirmation", async () => {
    process.env.ORB_TOOL_ALLOWED_ORIGINS = "https://api.example.com";
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const store = new OrbTaskStore();
    const stepsWithApproval: OrbPlanStep[] = makeSteps();
    // Make step_dub require approval at the step level
    stepsWithApproval[1] = {
      ...stepsWithApproval[1],
      toolCalls: [
        {
          name: "dub.synthesize",
          args: { voice: "v1" },
          requiresApproval: true,
        },
      ],
    };
    const created = store.create({
      userId: 42,
      intent: "subtitle → dub(approval) → render",
      steps: stepsWithApproval,
      needsApproval: false,
    });

    const result = await runOrbTaskToCompletion({
      taskId: created.taskId,
      userId: 42,
      userRole: "user",
      tools: ALL_TOOLS,
      store,
      // No approvalTokensByStepId given for step_dub
    });

    expect(result.outcome).toBe("awaiting_approval");
    expect(result.stepsRun).toBe(2); // subtitle ran, dub blocked (still recorded as a stepRun entry)
    expect(result.perStepToolResults[0].stepId).toBe("step_subtitle");
    expect(result.perStepToolResults[0].ok).toBe(true);
    expect(result.perStepToolResults[1].stepId).toBe("step_dub");
    expect(result.perStepToolResults[1].blockedByApproval).toBe(true);
    expect(result.perStepToolResults[1].toolResults[0]?.error).toBe(
      "step-approval-required"
    );
    // Crucially: render must NOT have been called
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Task should still be in `running` (not failed) so user can approve later
    expect(result.finalTask?.status).toBe("running");
  });

  it("resumes after step approval is granted via approvalTokensByStepId", async () => {
    process.env.ORB_TOOL_ALLOWED_ORIGINS = "https://api.example.com";
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const store = new OrbTaskStore();
    const stepsWithApproval: OrbPlanStep[] = makeSteps();
    stepsWithApproval[1] = {
      ...stepsWithApproval[1],
      toolCalls: [
        {
          name: "dub.synthesize",
          args: { voice: "v1" },
          requiresApproval: true,
        },
      ],
    };
    const created = store.create({
      userId: 42,
      intent: "with approval",
      steps: stepsWithApproval,
      needsApproval: false,
    });

    // First run: should pause at step_dub
    const first = await runOrbTaskToCompletion({
      taskId: created.taskId,
      userId: 42,
      userRole: "user",
      tools: ALL_TOOLS,
      store,
    });
    expect(first.outcome).toBe("awaiting_approval");

    // User approves step_dub via the store and gets a token
    const afterApprove = store.approveStep(created.taskId, 42, "step_dub", true);
    const token = afterApprove?.stepApprovals.find(a => a.stepId === "step_dub")
      ?.token;
    expect(token).toBeTruthy();

    // Second run with the approval token: should complete the rest
    const second = await runOrbTaskToCompletion({
      taskId: created.taskId,
      userId: 42,
      userRole: "user",
      tools: ALL_TOOLS,
      store,
      approvalTokensByStepId: { step_dub: token! },
    });

    expect(second.outcome).toBe("completed");
    expect(second.finalTask?.status).toBe("done");
    expect(second.finalTask?.stepReports.filter(r => r.ok)).toHaveLength(3);
  });

  it("returns cancelled when the task was cancelled before the run starts", async () => {
    const store = new OrbTaskStore();
    const created = store.create({
      userId: 42,
      intent: "to cancel",
      steps: makeSteps(),
      needsApproval: true,
    });
    // Simulate user cancellation via store.approve(false)
    store.approve(created.taskId, 42, false);

    const result = await runOrbTaskToCompletion({
      taskId: created.taskId,
      userId: 42,
      userRole: "user",
      tools: ALL_TOOLS,
      store,
    });

    expect(result.outcome).toBe("cancelled");
    expect(result.stepsRun).toBe(0);
    expect(result.finalTask?.status).toBe("cancelled");
  });

  it("returns failed with reason=task-not-found when taskId is unknown", async () => {
    const store = new OrbTaskStore();
    const result = await runOrbTaskToCompletion({
      taskId: "ghost_task",
      userId: 42,
      userRole: "user",
      tools: ALL_TOOLS,
      store,
    });
    expect(result.outcome).toBe("failed");
    expect(result.reason).toBe("task-not-found");
    expect(result.stepsRun).toBe(0);
  });

  it("forwards tool-level audit events for every step", async () => {
    process.env.ORB_TOOL_ALLOWED_ORIGINS = "https://api.example.com";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    );

    const store = new OrbTaskStore();
    const created = store.create({
      userId: 42,
      intent: "audit",
      steps: makeSteps(),
      needsApproval: false,
    });

    const audit = vi.fn();
    const result = await runOrbTaskToCompletion({
      taskId: created.taskId,
      userId: 42,
      userRole: "user",
      tools: ALL_TOOLS,
      store,
      onToolAuditEvent: audit,
    });

    expect(result.outcome).toBe("completed");
    expect(audit).toHaveBeenCalledTimes(3);
    const toolNames = audit.mock.calls.map(c => c[0].toolName);
    expect(toolNames).toEqual([
      "subtitle.generate",
      "dub.synthesize",
      "video.render",
    ]);
    // Every event has a matching stepId
    const stepIds = audit.mock.calls.map(c => c[0].stepId);
    expect(stepIds).toEqual(["step_subtitle", "step_dub", "step_render"]);
  });

  it("a step with no toolCalls auto-passes (FSM-only / UI-only steps)", async () => {
    const store = new OrbTaskStore();
    const created = store.create({
      userId: 42,
      intent: "ui-only middle step",
      steps: [
        {
          id: "s1",
          label: "step 1",
          uiActions: [],
          toolCalls: [],
        },
        {
          id: "s2",
          label: "step 2 (ui-only, no tools)",
          uiActions: [{ type: "navigate", payload: { to: "/page" } }],
          toolCalls: [],
        },
        {
          id: "s3",
          label: "step 3",
          uiActions: [],
          toolCalls: [],
        },
      ],
      needsApproval: false,
    });

    const result = await runOrbTaskToCompletion({
      taskId: created.taskId,
      userId: 42,
      userRole: "user",
      tools: [],
      store,
    });

    expect(result.outcome).toBe("completed");
    expect(result.stepsRun).toBe(3);
    expect(result.finalTask?.status).toBe("done");
  });

  it("respects maxSteps as a hard ceiling", async () => {
    process.env.ORB_TOOL_ALLOWED_ORIGINS = "https://api.example.com";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    );

    const store = new OrbTaskStore();
    const created = store.create({
      userId: 42,
      intent: "capped",
      steps: makeSteps(),
      needsApproval: false,
    });

    const result = await runOrbTaskToCompletion({
      taskId: created.taskId,
      userId: 42,
      userRole: "user",
      tools: ALL_TOOLS,
      store,
      maxSteps: 1,
    });

    // Only 1 step ran; task is still `running`, outcome reported as failed
    // with reason=max-steps-exceeded (caller can recover by re-invoking).
    expect(result.stepsRun).toBe(1);
    expect(result.outcome).toBe("failed");
    expect(result.reason).toBe("max-steps-exceeded");
    expect(result.finalTask?.status).toBe("running");
    expect(result.finalTask?.currentStepIndex).toBe(1);
  });
});
