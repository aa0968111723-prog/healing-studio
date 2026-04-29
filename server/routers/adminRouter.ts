import { adminProcedure, router } from "../_core/trpc";
import { runAgentEval } from "../eval/agentEvalRunner";
import { BUILTIN_AGENT_EVAL_CASES } from "../eval/cases";

export const adminRouter = router({
  runAgentEval: adminProcedure.mutation(async () => runAgentEval(BUILTIN_AGENT_EVAL_CASES)),
});
