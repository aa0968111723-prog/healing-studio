export interface PlanStep {
  goal: string;
  action: string;
  target?: string;
  inputs?: Record<string, unknown>;
  success_criteria: string;
  fallback?: string;
}

export interface StepObservation {
  step: PlanStep;
  success: boolean;
  evidence: string;
  outputRefId?: string;
}

export interface ClosedLoopContext {
  planNextStep: (args: {
    goal: string;
    previousObservations: StepObservation[];
    context?: Record<string, unknown>;
  }) => Promise<PlanStep | null>;
  executePlanStep: (step: PlanStep) => Promise<{
    ok: boolean;
    evidence: string;
    outputRefId?: string;
  }>;
  onObservation?: (observation: StepObservation) => Promise<void> | void;
}

export async function executeClosedLoopPlan(args: {
  goal: string;
  ctx: ClosedLoopContext;
  context?: Record<string, unknown>;
  maxSteps?: number;
}): Promise<{ ok: boolean; observations: StepObservation[]; reason?: string }> {
  const observations: StepObservation[] = [];
  const maxSteps = Math.max(1, Math.min(args.maxSteps ?? 14, 50));

  for (let i = 0; i < maxSteps; i += 1) {
    const next = await args.ctx.planNextStep({
      goal: args.goal,
      previousObservations: observations,
      context: args.context,
    });
    if (!next) return { ok: true, observations };

    const executed = await args.ctx.executePlanStep(next);
    const observation: StepObservation = {
      step: next,
      success: executed.ok,
      evidence: executed.evidence,
      outputRefId: executed.outputRefId,
    };
    observations.push(observation);
    if (args.ctx.onObservation) await args.ctx.onObservation(observation);
    if (!executed.ok) return { ok: false, observations, reason: executed.evidence };
  }

  return { ok: false, observations, reason: "max_steps_reached" };
}
