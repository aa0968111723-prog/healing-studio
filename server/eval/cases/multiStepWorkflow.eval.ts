import type { AgentEvalCase } from "../../../shared/agent-eval";
export default { id:"multi-step-workflow", description:"生成圖片後幫我配上背景音樂", pageId:"director", userMessage:"生成圖片後幫我配上背景音樂", expectedPlanProperties:{ minSteps:2, requiredActionTypes:["generate_image","delegate_to_pro_studio"] }, tags:["workflow"] } satisfies AgentEvalCase;
