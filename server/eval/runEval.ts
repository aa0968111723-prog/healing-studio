import { BUILTIN_AGENT_EVAL_CASES } from "./cases";
import { runAgentEval } from "./agentEvalRunner";

const tagsArg = process.argv.find(arg => arg.startsWith("--tags"));
const tags = tagsArg ? tagsArg.split("=")[1]?.split(",").filter(Boolean) : undefined;

async function main() {
  const report = await runAgentEval(BUILTIN_AGENT_EVAL_CASES, { tags, verbose: true });
  console.table(report.results.map(r => ({ caseId: r.caseId, passed: r.passed, score: r.score.toFixed(2), violations: r.violations.join("; ") })));
  console.log(`Passed ${report.passed}/${report.totalCases}, avg=${report.averageScore.toFixed(2)}`);
  if (report.failed > 0) process.exit(1);
}

void main();
