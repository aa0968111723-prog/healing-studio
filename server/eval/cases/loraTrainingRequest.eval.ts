import type { AgentEvalCase } from "../../../shared/agent-eval";
export default { id:"lora-training-request", description:"我想訓練我自己的風格模型", pageId:"lora-trainer", userMessage:"我想訓練我自己的風格模型", expectedPlanProperties:{ requiredActionTypes:["delegate_to_lora_trainer"] }, tags:["delegation"] } satisfies AgentEvalCase;
