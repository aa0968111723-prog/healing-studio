import type { AgentEvalCase } from "../../../shared/agent-eval";
export default {
  id: "basic-image-gen",
  description: "幫我生成一張賽博龐克城市的圖片",
  pageId: "image-studio",
  userMessage: "幫我生成一張賽博龐克城市的圖片",
  expectedPlanProperties: { requiredActionTypes: ["generate_image"] },
  tags: ["image"],
} satisfies AgentEvalCase;
