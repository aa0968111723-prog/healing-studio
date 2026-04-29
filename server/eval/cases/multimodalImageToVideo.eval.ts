import type { AgentEvalCase } from "../../../shared/agent-eval";
export default { id:"multimodal-image-to-video", description:"image to video", pageId:"video-studio", userMessage:"把這張圖做成影片", attachments:[{kind:"image"}], expectedPlanProperties:{ requiredActionTypes:["image_to_video"], expectedRouting:{ capabilities:["multimodal"] } }, tags:["multimodal","image"] } satisfies AgentEvalCase;
