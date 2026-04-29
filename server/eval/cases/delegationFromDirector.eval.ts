import type { AgentEvalCase } from "../../../shared/agent-eval";
export default { id:"delegation-from-director", description:"幫我製作一個30秒的宣傳影片", pageId:"director", userMessage:"幫我製作一個30秒的宣傳影片", expectedPlanProperties:{ requiredActionTypes:["delegate_to_video_studio"] }, tags:["delegation"] } satisfies AgentEvalCase;
