import { describe, expect, it, vi } from "vitest";
import { executeGlobalWorkflow, preflightValidate } from "../shared/global-agent-orchestrator";
import type { RunWorkflowAction } from "../shared/agent-actions";

describe("preflightValidate", () => {
  it("returns MISSING_REQUIRED_FIELDS when required input is empty", () => {
    const workflow: RunWorkflowAction = {
      type: "runWorkflow",
      name: "music flow",
      steps: [
        {
          id: "s1",
          label: "填寫音樂描述",
          actionType: "fillPrompt",
          payload: "",
          requiredInputs: [
            { key: "music_description", label: "音樂描述", required: true, example: "溫暖 lo-fi" },
          ],
        },
      ],
    };
    const out = preflightValidate(workflow, {});
    expect(out.ok).toBe(false);
    expect(out.code).toBe("MISSING_REQUIRED_FIELDS");
    expect(out.missing[0]?.key).toBe("music_description");
  });

  it("blocks execute state when missing required fields", async () => {
    const workflow: RunWorkflowAction = {
      type: "runWorkflow",
      name: "music flow",
      steps: [
        {
          id: "s1",
          label: "填寫音樂描述",
          actionType: "fillPrompt",
          payload: "",
          requiredInputs: [{ key: "music_description", label: "音樂描述", required: true }],
        },
        { id: "s2", label: "送出", actionType: "submit", payload: "" },
      ],
    };

    const res = await executeGlobalWorkflow(workflow, {
      currentPage: null,
      navigate: vi.fn(),
      dispatch: vi.fn(async () => ({ ok: true })),
    });

    expect(res.ok).toBe(false);
    expect(res.reason).toBe("MISSING_REQUIRED_FIELDS");
  });
});
