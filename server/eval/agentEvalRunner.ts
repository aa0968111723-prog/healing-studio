import type { AgentEvalCase, AgentEvalReport, AgentEvalResult } from "../../shared/agent-eval";
import { runSchemaFirstAgentPlanner } from "../services/agentPlanner";

export async function runAgentEval(cases: AgentEvalCase[], options?: { tags?: string[]; verbose?: boolean }): Promise<AgentEvalReport> {
  const selected = options?.tags?.length ? cases.filter(c => c.tags?.some(t => options.tags?.includes(t))) : cases;
  const results: AgentEvalResult[] = [];
  for (const c of selected) {
    const start = Date.now();
    const violations: string[] = [];
    let checks = 0;
    let passedChecks = 0;
    const res = await runSchemaFirstAgentPlanner({ messages: [{ role: "user", content: c.userMessage }] });
    const plan = res.plan as Record<string, any> | undefined;
    const steps = Array.isArray(plan?.steps) ? plan!.steps : [];
    const actionTypes = steps.map((s: any) => s.toolName ?? s.action?.type).filter(Boolean);
    const check = (ok: boolean, msg: string) => { checks += 1; if (ok) passedChecks += 1; else violations.push(msg); };
    if (c.expectedPlanProperties.minSteps !== undefined) check(steps.length >= c.expectedPlanProperties.minSteps, `steps < minSteps (${steps.length} < ${c.expectedPlanProperties.minSteps})`);
    if (c.expectedPlanProperties.maxSteps !== undefined) check(steps.length <= c.expectedPlanProperties.maxSteps, `steps > maxSteps (${steps.length} > ${c.expectedPlanProperties.maxSteps})`);
    for (const r of c.expectedPlanProperties.requiredActionTypes ?? []) check(actionTypes.includes(r), `missing required action type: ${r}`);
    for (const f of c.expectedPlanProperties.forbiddenActionTypes ?? []) check(!actionTypes.includes(f), `forbidden action type present: ${f}`);
    if (c.expectedPlanProperties.shouldNotBeBlocked) check(res.status !== "blocked", "plan should not be blocked");
    if (c.expectedPlanProperties.shouldBeBlocked) check(res.status === "blocked", "plan should be blocked");
    if (c.expectedPlanProperties.expectedRouting) {
      for (const [k, v] of Object.entries(c.expectedPlanProperties.expectedRouting)) check(JSON.stringify((plan as any)?.routing?.[k]) === JSON.stringify(v), `routing mismatch: ${k}`);
    }
    const score = checks === 0 ? 1 : passedChecks / checks;
    results.push({ caseId: c.id, passed: violations.length === 0, score, violations, rawPlan: plan, durationMs: Date.now() - start });
  }
  const passed = results.filter(r => r.passed).length;
  return { totalCases: results.length, passed, failed: results.length - passed, averageScore: results.length ? results.reduce((a,b)=>a+b.score,0)/results.length : 0, results, ranAt: new Date().toISOString() };
}
