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
}

export async function executeCurrentStepTools(
  input: ExecuteStepToolsInput
): Promise<ExecuteStepToolsResult> {
  const step = input.task.steps[input.task.currentStepIndex];
  if (!step || step.toolCalls.length === 0) {
    return { attempted: false, toolResults: [], ok: true };
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
  };
}
