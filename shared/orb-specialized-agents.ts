/**
 * shared/orb-specialized-agents.ts
 *
 * Specialized AI Agent definitions and utilities for the Orb system.
 * These agents are domain experts that assist users with specific creative tasks:
 * - Image Specialist: image generation & editing
 * - Video Specialist: video generation & editing
 * - Music Specialist: music & audio generation
 * - Voice Specialist: voice cloning & dubbing
 * - Training Specialist: model training & LoRA
 * - Learning Specialist: tutorials & guidance
 */

export interface SpecializedAgentCapability {
  /** Agent identifier matching AgentRole */
  agentId: string;
  /** Display name in Chinese */
  displayName: string;
  /** Short description of what this agent does */
  description: string;
  /** Primary tools this agent can use */
  primaryTools: string[];
  /** Knowledge domains this agent specializes in */
  knowledgeDomains: string[];
  /** Recommended use cases */
  useCases: string[];
}

/**
 * Registry of specialized agents with their capabilities.
 * Used for agent selection, routing, and capability discovery.
 */
export const SPECIALIZED_AGENT_CAPABILITIES: SpecializedAgentCapability[] = [
  {
    agentId: "image-specialist",
    displayName: "圖像精靈",
    description: "專精於圖像生成與編輯，熟悉所有圖像模型、參數調整與風格控制",
    primaryTools: [
      "studio.generateImage",
      "studio.generate3D",
    ],
    knowledgeDomains: [
      "text-to-image",
      "image-to-image",
      "image editing",
      "upscaling",
      "inpainting",
      "LoRA integration",
      "ControlNet",
      "pose detection",
      "style transfer",
    ],
    useCases: [
      "生成高品質圖片",
      "圖片風格轉換",
      "圖片編輯與修復",
      "圖片放大增強",
      "3D 模型生成",
      "人物姿勢偵測",
    ],
  },
  {
    agentId: "video-specialist",
    displayName: "影像精靈",
    description: "專精於影片生成與編輯，熟悉 text-to-video、image-to-video、video-to-video 流程",
    primaryTools: [
      "studio.generateVideo",
      "studio.enhanceVideo",
      "studio.animateSpeaker",
    ],
    knowledgeDomains: [
      "text-to-video",
      "image-to-video",
      "video-to-video",
      "video enhancement",
      "video upscaling",
      "video interpolation",
      "talking head animation",
      "lip sync",
    ],
    useCases: [
      "文字生成影片",
      "圖片轉影片動畫",
      "影片風格轉換",
      "影片畫質增強",
      "虛擬人物對嘴",
      "短影片創作",
    ],
  },
  {
    agentId: "music-specialist",
    displayName: "音樂精靈",
    description: "專精於音樂與音訊生成，熟悉音樂創作、音效製作、音軌分離與混音",
    primaryTools: [
      "studio.generateAudio",
      "studio.generateSfx",
      "studio.separateStems",
      "studio.isolateAudio",
      "studio.mergeAudios",
    ],
    knowledgeDomains: [
      "music generation",
      "sound effects",
      "audio mixing",
      "stem separation",
      "audio isolation",
      "audio enhancement",
      "background music",
      "foley sound",
    ],
    useCases: [
      "生成背景音樂",
      "創作音效",
      "分離音軌",
      "音訊混音",
      "音訊增強",
      "音樂風格調整",
    ],
  },
  {
    agentId: "voice-specialist",
    displayName: "語音精靈",
    description: "專精於語音生成與配音，熟悉語音克隆、語音合成、變聲技術",
    primaryTools: [
      "studio.generateVoice",
      "studio.cloneVoice",
      "studio.designVoice",
      "studio.changeVoice",
      "studio.transcribe",
    ],
    knowledgeDomains: [
      "text-to-speech",
      "voice cloning",
      "voice design",
      "voice changing",
      "speech recognition",
      "multilingual TTS",
      "voice emotion",
      "dubbing",
    ],
    useCases: [
      "語音合成",
      "聲音克隆",
      "多語配音",
      "語音轉文字",
      "聲音變換",
      "虛擬角色配音",
    ],
  },
  {
    agentId: "training-specialist",
    displayName: "訓練精靈",
    description: "專精於模型訓練與 LoRA 微調，熟悉客製化模型訓練流程",
    primaryTools: [
      "studio.trainLora",
    ],
    knowledgeDomains: [
      "LoRA training",
      "fine-tuning",
      "model training",
      "dataset preparation",
      "training parameters",
      "style LoRA",
      "character LoRA",
      "video LoRA",
    ],
    useCases: [
      "訓練角色模型",
      "訓練風格模型",
      "訓練場景模型",
      "訓練影片 LoRA",
      "客製化模型",
    ],
  },
  {
    agentId: "learning-specialist",
    displayName: "學習精靈",
    description: "專精於平台教學與導引，熟悉所有功能、教程與最佳實踐",
    primaryTools: [
      "director.suggestPlan",
      "research.deepSearch",
      "inspiration.fetch",
    ],
    knowledgeDomains: [
      "platform tutorials",
      "workflow guidance",
      "best practices",
      "troubleshooting",
      "feature discovery",
      "beginner guidance",
      "advanced techniques",
    ],
    useCases: [
      "新手入門指導",
      "功能使用教學",
      "工作流程規劃",
      "問題排除協助",
      "進階技巧學習",
    ],
  },
];

/**
 * Get specialized agent capability by agent ID
 */
export function getSpecializedAgentCapability(
  agentId: string
): SpecializedAgentCapability | null {
  return SPECIALIZED_AGENT_CAPABILITIES.find(cap => cap.agentId === agentId) ?? null;
}

/**
 * Check if an agent ID is a specialized agent
 */
export function isSpecializedAgent(agentId: string): boolean {
  return SPECIALIZED_AGENT_CAPABILITIES.some(cap => cap.agentId === agentId);
}

/**
 * Get all tools available to a specialized agent
 */
export function getAgentTools(agentId: string): string[] {
  const capability = getSpecializedAgentCapability(agentId);
  return capability?.primaryTools ?? [];
}

/**
 * Find the most appropriate specialized agent for a given tool
 */
export function findAgentForTool(toolName: string): string | null {
  for (const cap of SPECIALIZED_AGENT_CAPABILITIES) {
    if (cap.primaryTools.includes(toolName)) {
      return cap.agentId;
    }
  }
  return null;
}

/**
 * Serialize specialized agent capabilities for system prompts
 */
export function serializeSpecializedAgents(): string {
  const sections = SPECIALIZED_AGENT_CAPABILITIES.map(cap => {
    const tools = cap.primaryTools.map(t => `  - ${t}`).join("\n");
    const domains = cap.knowledgeDomains.slice(0, 5).join(", ");
    return [
      `## ${cap.displayName} (${cap.agentId})`,
      cap.description,
      `主要工具：`,
      tools,
      `知識領域：${domains}`,
    ].join("\n");
  });

  return [
    "【專精AI助手系統】",
    "光球系統內建 6 種專精助手，各自擁有特定領域的深度知識：",
    "",
    ...sections,
  ].join("\n\n");
}

/**
 * Get recommended agent based on user context and intent
 */
export function recommendAgent(context: {
  currentPage?: string;
  userIntent?: string;
  recentTools?: string[];
}): string | null {
  // Priority 1: Recent tools usage
  if (context.recentTools && context.recentTools.length > 0) {
    const lastTool = context.recentTools[context.recentTools.length - 1];
    const agent = findAgentForTool(lastTool);
    if (agent) return agent;
  }

  // Priority 2: Current page context
  if (context.currentPage) {
    if (context.currentPage.includes("image-studio")) return "image-specialist";
    if (context.currentPage.includes("video-studio")) return "video-specialist";
    if (context.currentPage.includes("models")) return "training-specialist";
    if (context.currentPage.includes("learn")) return "learning-specialist";
  }

  // Priority 3: User intent keywords (if provided)
  if (context.userIntent) {
    const intent = context.userIntent.toLowerCase();
    if (/圖片|圖像|照片|image|picture/.test(intent)) return "image-specialist";
    if (/影片|視頻|video/.test(intent)) return "video-specialist";
    if (/音樂|音訊|audio|music/.test(intent)) return "music-specialist";
    if (/語音|配音|voice|tts/.test(intent)) return "voice-specialist";
    if (/訓練|lora|train/.test(intent)) return "training-specialist";
    if (/教學|學習|how to|tutorial/.test(intent)) return "learning-specialist";
  }

  return null;
}
