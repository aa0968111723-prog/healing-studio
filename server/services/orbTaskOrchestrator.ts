import type { OrbTask } from "../../shared/orb-agent-contract";
import type { OrbApiTool, OrbToolCallResult } from "./agentToolExecutor";
import { executeOrbToolCalls } from "./agentToolExecutor";

export interface ExecuteStepToolsInput {
  task: OrbTask;
  userId: number;
  tools: OrbApiTool[];
  approved: boolean;
}

export interface ExecuteStepToolsResult {
  attempted: boolean;
  toolResults: OrbToolCallResult[];
  ok: boolean;
  blockedByApproval?: boolean;
}

export async function executeCurrentStepTools(
  input: ExecuteStepToolsInput
): Promise<ExecuteStepToolsResult> {
  const step = input.task.steps[input.task.currentStepIndex];
  if (!step || step.toolCalls.length === 0) {
    return { attempted: false, toolResults: [], ok: true };
  }

  const registryByName = new Map(input.tools.map(t => [t.name, t]));
  const stepNeedsApproval = step.toolCalls.some(call => {
    const fromStep = Boolean(call.requiresApproval);
    const fromRegistry = Boolean(registryByName.get(call.name)?.requireConfirmation);
    return fromStep || fromRegistry;
  });
  const isStepApproved = input.task.approvedStepIds.includes(step.id);
  if (stepNeedsApproval && !(input.approved || isStepApproved)) {
    return {
      attempted: false,
      toolResults: [
        {
          name: step.toolCalls[0]?.name ?? "unknown",
          ok: false,
          error: "step-approval-required",
        },
      ],
      ok: false,
      blockedByApproval: true,
    };
  }

  const calls = step.toolCalls.map(call => ({
    name: call.name,
    args: call.args,
  }));

  const toolResults = await executeOrbToolCalls({
    tools: input.tools,
    calls,
    userId: input.userId,
    approved: input.approved,
  });

  return {
    attempted: true,
    toolResults,
    ok: toolResults.every(r => r.ok),
    blockedByApproval: false,
  };
}
