/**
 * shared/cross-modality-workflows.ts
 *
 * Cross-Modality Workflow Templates
 *
 * Pre-defined workflow templates for common multi-spirit collaboration
 * scenarios. Each template defines:
 * - Spirit sequence
 * - Handoff triggers
 * - Expected outputs
 * - Quality gates
 *
 * These templates can be instantiated by chief-orchestrator (總總) or
 * director (導演) when planning complex multi-modal tasks.
 */

import type { AgentRole } from "./orb-agent-roles";
import type {
  SpiritHandoff,
  HandoffReason,
  SharedAsset,
} from "./spirit-handoff-protocol";

/**
 * Workflow step definition
 */
export interface WorkflowStep {
  /** Step ID */
  stepId: string;
  /** Spirit responsible for this step */
  spirit: AgentRole;
  /** Step description */
  description: string;
  /** Expected output type */
  outputType: "image" | "video" | "audio" | "voice" | "text" | "plan" | "analysis" | "lora";
  /** Tools to use */
  tools: string[];
  /** Dependencies on previous steps */
  dependsOn?: string[];
  /** Estimated duration (milliseconds) */
  estimatedDuration?: number;
  /** Quality requirements */
  qualityRequirements?: string[];
  /** Optional - can be skipped if user prefers */
  optional?: boolean;
}

/**
 * Workflow template definition
 */
export interface WorkflowTemplate {
  /** Template ID */
  templateId: string;
  /** Template name */
  name: string;
  /** Description */
  description: string;
  /** Category */
  category: "content-creation" | "social-media" | "learning" | "project" | "custom";
  /** Steps in workflow */
  steps: WorkflowStep[];
  /** Expected total duration */
  estimatedTotalDuration?: number;
  /** Difficulty level */
  difficulty: "beginner" | "intermediate" | "advanced";
  /** Tags for search */
  tags: string[];
}

// ============================================================================
// WORKFLOW TEMPLATES
// ============================================================================

/**
 * Video Creation Workflow
 * Complete end-to-end video production with music and voiceover
 */
export const VIDEO_CREATION_WORKFLOW: WorkflowTemplate = {
  templateId: "video-creation-full",
  name: "影片創作完整流程",
  description: "從構思到成品：規劃 → 生圖 → 成片 → 配樂 → 配音",
  category: "content-creation",
  difficulty: "intermediate",
  tags: ["video", "music", "voice", "image", "storytelling"],
  estimatedTotalDuration: 180000, // 3 minutes
  steps: [
    {
      stepId: "plan",
      spirit: "director",
      description: "規劃影片結構與分鏡",
      outputType: "plan",
      tools: ["director.suggestPlan"],
      qualityRequirements: ["至少3個場景", "清楚的敘事結構"],
    },
    {
      stepId: "generate-keyframes",
      spirit: "image-specialist",
      description: "生成關鍵幀圖片",
      outputType: "image",
      tools: ["studio.generateImage"],
      dependsOn: ["plan"],
      estimatedDuration: 30000,
      qualityRequirements: ["一致的視覺風格", "符合分鏡腳本"],
    },
    {
      stepId: "create-video",
      spirit: "video-specialist",
      description: "將圖片轉換為影片",
      outputType: "video",
      tools: ["studio.generateVideo"],
      dependsOn: ["generate-keyframes"],
      estimatedDuration: 60000,
      qualityRequirements: ["流暢的動畫", "符合時長需求"],
    },
    {
      stepId: "compose-music",
      spirit: "music-specialist",
      description: "為影片配上背景音樂",
      outputType: "audio",
      tools: ["studio.generateAudio"],
      dependsOn: ["create-video"],
      estimatedDuration: 45000,
      qualityRequirements: ["與影片節奏匹配", "情緒氛圍一致"],
    },
    {
      stepId: "add-voiceover",
      spirit: "voice-specialist",
      description: "生成旁白或對白",
      outputType: "voice",
      tools: ["studio.generateVoice"],
      dependsOn: ["create-video"],
      estimatedDuration: 30000,
      qualityRequirements: ["清晰可聽", "與畫面同步"],
      optional: true,
    },
    {
      stepId: "review",
      spirit: "critic",
      description: "檢視最終成品並提供改進建議",
      outputType: "analysis",
      tools: [],
      dependsOn: ["compose-music", "add-voiceover"],
      qualityRequirements: ["整體協調性", "專業品質"],
      optional: true,
    },
  ],
};

/**
 * Social Media Post Workflow
 * Create engaging social media content with images/videos
 */
export const SOCIAL_MEDIA_POST_WORKFLOW: WorkflowTemplate = {
  templateId: "social-media-post",
  name: "社群貼文創作",
  description: "策略 → 素材 → 排程：完整社群行銷流程",
  category: "social-media",
  difficulty: "beginner",
  tags: ["social", "marketing", "image", "video", "scheduling"],
  estimatedTotalDuration: 90000, // 1.5 minutes
  steps: [
    {
      stepId: "strategy",
      spirit: "community-manager",
      description: "分析平台趨勢與發文策略",
      outputType: "analysis",
      tools: ["research.deepSearch", "inspiration.fetch"],
      qualityRequirements: ["符合平台特性", "抓住當前趨勢"],
    },
    {
      stepId: "create-visual",
      spirit: "image-specialist",
      description: "生成吸睛圖片或影片",
      outputType: "image",
      tools: ["studio.generateImage", "studio.generateVideo"],
      dependsOn: ["strategy"],
      estimatedDuration: 40000,
      qualityRequirements: ["視覺衝擊力", "符合品牌風格"],
    },
    {
      stepId: "schedule",
      spirit: "notes-curator",
      description: "整理素材並排程發布",
      outputType: "plan",
      tools: ["notes.createNote", "notes.scheduleTask"],
      dependsOn: ["create-visual"],
      qualityRequirements: ["最佳發文時間", "完整的發文計畫"],
    },
  ],
};

/**
 * Educational Content Workflow
 * Create structured learning materials
 */
export const EDUCATIONAL_CONTENT_WORKFLOW: WorkflowTemplate = {
  templateId: "educational-content",
  name: "教學內容製作",
  description: "研究 → 腳本 → 視覺化 → 配音：完整教學內容",
  category: "learning",
  difficulty: "intermediate",
  tags: ["education", "tutorial", "voice", "image", "video"],
  estimatedTotalDuration: 240000, // 4 minutes
  steps: [
    {
      stepId: "research",
      spirit: "researcher",
      description: "搜集主題相關資料",
      outputType: "text",
      tools: ["research.deepSearch"],
      qualityRequirements: ["資料準確性", "來源可靠性"],
    },
    {
      stepId: "structure",
      spirit: "learning-specialist",
      description: "設計教學架構與學習路徑",
      outputType: "plan",
      tools: [],
      dependsOn: ["research"],
      qualityRequirements: ["清晰的學習目標", "循序漸進的內容"],
    },
    {
      stepId: "create-visuals",
      spirit: "image-specialist",
      description: "製作圖解與示意圖",
      outputType: "image",
      tools: ["studio.generateImage"],
      dependsOn: ["structure"],
      estimatedDuration: 60000,
      qualityRequirements: ["易於理解", "視覺層次清楚"],
    },
    {
      stepId: "record-narration",
      spirit: "voice-specialist",
      description: "錄製教學旁白",
      outputType: "voice",
      tools: ["studio.generateVoice"],
      dependsOn: ["structure"],
      estimatedDuration: 45000,
      qualityRequirements: ["語速適中", "發音清晰"],
    },
    {
      stepId: "assemble",
      spirit: "video-specialist",
      description: "組合成完整教學影片",
      outputType: "video",
      tools: ["studio.generateVideo"],
      dependsOn: ["create-visuals", "record-narration"],
      estimatedDuration: 90000,
      qualityRequirements: ["同步準確", "節奏流暢"],
    },
  ],
};

/**
 * Multimedia Project Workflow
 * Comprehensive project with custom training
 */
export const MULTIMEDIA_PROJECT_WORKFLOW: WorkflowTemplate = {
  templateId: "multimedia-project",
  name: "多媒體專案製作",
  description: "訓練風格 → 多模態創作 → 品質把關",
  category: "project",
  difficulty: "advanced",
  tags: ["lora", "custom-style", "image", "video", "music", "quality"],
  estimatedTotalDuration: 600000, // 10 minutes (includes LoRA training)
  steps: [
    {
      stepId: "plan-project",
      spirit: "director",
      description: "規劃整體專案架構",
      outputType: "plan",
      tools: ["director.suggestPlan"],
      qualityRequirements: ["完整的專案規劃", "清楚的里程碑"],
    },
    {
      stepId: "train-style",
      spirit: "training-specialist",
      description: "訓練專屬 LoRA 風格",
      outputType: "lora",
      tools: ["studio.trainLora"],
      dependsOn: ["plan-project"],
      estimatedDuration: 300000,
      qualityRequirements: ["風格一致性", "高品質訓練資料"],
    },
    {
      stepId: "generate-assets",
      spirit: "image-specialist",
      description: "使用 LoRA 生成圖片素材",
      outputType: "image",
      tools: ["studio.generateImage"],
      dependsOn: ["train-style"],
      estimatedDuration: 120000,
      qualityRequirements: ["符合 LoRA 風格", "多樣化構圖"],
    },
    {
      stepId: "create-videos",
      spirit: "video-specialist",
      description: "製作專案影片",
      outputType: "video",
      tools: ["studio.generateVideo"],
      dependsOn: ["generate-assets"],
      estimatedDuration: 90000,
      qualityRequirements: ["動畫流暢", "視覺連貫"],
    },
    {
      stepId: "add-audio",
      spirit: "music-specialist",
      description: "創作配樂與音效",
      outputType: "audio",
      tools: ["studio.generateAudio", "studio.generateSfx"],
      dependsOn: ["create-videos"],
      estimatedDuration: 60000,
      qualityRequirements: ["音樂氛圍匹配", "音效自然"],
    },
    {
      stepId: "quality-check",
      spirit: "quality-coach",
      description: "全面品質檢查與優化建議",
      outputType: "analysis",
      tools: [],
      dependsOn: ["add-audio"],
      qualityRequirements: ["專業水準", "可交付品質"],
    },
    {
      stepId: "final-review",
      spirit: "critic",
      description: "最終審查與改進方向",
      outputType: "analysis",
      tools: [],
      dependsOn: ["quality-check"],
      qualityRequirements: ["整體完成度", "藝術表現力"],
    },
  ],
};

/**
 * Quick Iteration Workflow
 * Fast cycle for rapid prototyping
 */
export const QUICK_ITERATION_WORKFLOW: WorkflowTemplate = {
  templateId: "quick-iteration",
  name: "快速迭代流程",
  description: "生成 → 評估 → 改進：快速試錯循環",
  category: "content-creation",
  difficulty: "beginner",
  tags: ["iteration", "prototyping", "feedback", "improvement"],
  estimatedTotalDuration: 60000, // 1 minute
  steps: [
    {
      stepId: "generate-initial",
      spirit: "image-specialist",
      description: "生成初版",
      outputType: "image",
      tools: ["studio.generateImage"],
      estimatedDuration: 20000,
    },
    {
      stepId: "critique",
      spirit: "critic",
      description: "快速評估並指出改進點",
      outputType: "analysis",
      tools: [],
      dependsOn: ["generate-initial"],
      qualityRequirements: ["具體的改進建議", "可執行的下一步"],
    },
    {
      stepId: "iterate",
      spirit: "image-specialist",
      description: "根據反饋改進",
      outputType: "image",
      tools: ["studio.generateImage"],
      dependsOn: ["critique"],
      estimatedDuration: 20000,
      qualityRequirements: ["解決前次問題", "品質提升"],
    },
  ],
};

/**
 * Character Design Workflow
 * Specialized workflow for character creation
 */
export const CHARACTER_DESIGN_WORKFLOW: WorkflowTemplate = {
  templateId: "character-design",
  name: "角色設計流程",
  description: "構思 → 草圖 → 精修 → 動畫：完整角色創作",
  category: "content-creation",
  difficulty: "advanced",
  tags: ["character", "design", "animation", "3d", "lora"],
  estimatedTotalDuration: 420000, // 7 minutes
  steps: [
    {
      stepId: "inspire",
      spirit: "inspiration-specialist",
      description: "靈感收集與參考資料",
      outputType: "analysis",
      tools: ["inspiration.fetch", "research.deepSearch"],
      qualityRequirements: ["多元參考", "創意發想"],
    },
    {
      stepId: "concept",
      spirit: "image-specialist",
      description: "生成角色概念圖",
      outputType: "image",
      tools: ["studio.generateImage"],
      dependsOn: ["inspire"],
      estimatedDuration: 40000,
      qualityRequirements: ["獨特性", "角色特徵明確"],
    },
    {
      stepId: "anatomy-check",
      spirit: "anatomy-specialist",
      description: "檢查人體比例與結構",
      outputType: "analysis",
      // 之前 tools:[] 是占位 — 體體沒工具可呼叫，整個 step 是 no-op。
      // 現在交給 anatomySpecialist.verifyResult：上游 vision LLM / 標籤偵測
      // 把 detectedLabels 餵進來，體體比對該部位的期望重點回 score + 缺漏。
      tools: ["anatomySpecialist.verifyResult"],
      dependsOn: ["concept"],
      qualityRequirements: ["解剖學正確性", "姿態自然"],
      optional: true,
    },
    {
      stepId: "train-character",
      spirit: "training-specialist",
      description: "訓練角色專屬 LoRA",
      outputType: "lora",
      tools: ["studio.trainLora"],
      dependsOn: ["concept"],
      estimatedDuration: 300000,
      qualityRequirements: ["角色一致性", "多角度可用"],
    },
    {
      stepId: "animate",
      spirit: "video-specialist",
      description: "為角色製作動畫",
      outputType: "video",
      tools: ["studio.generateVideo"],
      dependsOn: ["train-character"],
      estimatedDuration: 60000,
      qualityRequirements: ["動作流暢", "角色特徵保持"],
    },
  ],
};

// ============================================================================
// WORKFLOW REGISTRY
// ============================================================================

/**
 * Animation Production Workflow（世界觀 → 分鏡 → 圖楨 → 配樂配音 → 成片）
 *
 * 對應 shared/worldbuilding-animation.ts 的 planAnimationPipeline 編排策略，
 * 每場分鏡會 fan-out 出多個 image / video / music / voice step，最後一個
 * compose 步驟把所有素材合成 final cut。
 *
 * 適用：角色與場景已備齊三視圖、表情、穿衣、配音；風格 profile 已選定；
 * storyboard 已 seed skeleton。
 */
export const ANIMATION_PRODUCTION_WORKFLOW: WorkflowTemplate = {
  templateId: "animation-production",
  name: "動畫製作完整流程",
  description:
    "世界觀建立 → 三視圖設計 → 分鏡時間軸 → 圖楨生成 → 細膩化 → 圖轉影 → 配樂 → 配音 → 成片合成",
  category: "content-creation",
  difficulty: "advanced",
  tags: [
    "animation",
    "worldbuilding",
    "storyboard",
    "video",
    "music",
    "voice",
    "image",
    "lora",
  ],
  estimatedTotalDuration: 900000, // 15 分鐘（依分鏡長度成長）
  steps: [
    {
      stepId: "world-design",
      spirit: "director",
      description:
        "建立世界觀：角色（含三視圖/表情/穿衣/口氣/語音/腳本定位）、場景、畫面風格、配樂主題",
      outputType: "plan",
      tools: ["worldbuilding.create", "worldbuilding.update"],
      qualityRequirements: ["至少 1 主角 + 1 場景", "已選定風格 profile"],
    },
    {
      stepId: "character-three-view",
      spirit: "image-specialist",
      description: "為每個主要角色生成三視圖（正/側/背/3-4 視角）",
      outputType: "image",
      tools: ["studio.generateImage"],
      dependsOn: ["world-design"],
      estimatedDuration: 120000,
      qualityRequirements: ["保持比例一致", "服飾細節清楚"],
    },
    {
      stepId: "storyboard-seed",
      spirit: "director",
      description: "依目標時長與世界觀派生分鏡骨架（幾分幾秒、角色出場、場景）",
      outputType: "plan",
      tools: ["worldStoryboard.seedSkeleton"],
      dependsOn: ["world-design"],
      qualityRequirements: ["時間軸不重疊", "主角戲份分配合理"],
    },
    {
      stepId: "storyboard-fill",
      spirit: "director",
      description: "補完每場的對白、運鏡、轉場、表情、穿著",
      outputType: "plan",
      tools: ["worldStoryboard.update"],
      dependsOn: ["storyboard-seed"],
      qualityRequirements: ["對白符合角色口氣", "鏡頭運動與情緒匹配"],
    },
    {
      stepId: "generate-keyframes",
      spirit: "image-specialist",
      description: "為每張圖楨跑 t2i，注入角色/場景/風格 trigger word",
      outputType: "image",
      tools: ["studio.generateImage"],
      dependsOn: ["storyboard-fill", "character-three-view"],
      estimatedDuration: 240000,
      qualityRequirements: ["角色一致性", "畫面風格鎖定"],
    },
    {
      stepId: "refine-frames",
      spirit: "image-specialist",
      description: "細膩化：image-to-image / inpaint / upscale 修崩、補細節",
      outputType: "image",
      tools: ["studio.imageToImage", "studio.upscaleImage"],
      dependsOn: ["generate-keyframes"],
      estimatedDuration: 180000,
      optional: true,
      qualityRequirements: ["無破圖", "細節清晰"],
    },
    {
      stepId: "image-to-video",
      spirit: "video-specialist",
      description: "把每張關鍵幀轉成短片，套用本場 cameraMovement",
      outputType: "video",
      tools: ["studio.imageToVideo"],
      dependsOn: ["refine-frames"],
      estimatedDuration: 360000,
      qualityRequirements: ["動畫流暢", "運鏡符合分鏡指示"],
    },
    {
      stepId: "compose-music",
      spirit: "music-specialist",
      description: "依每場配樂主題生成 BGM",
      outputType: "audio",
      tools: ["studio.generateMusic"],
      dependsOn: ["storyboard-fill"],
      estimatedDuration: 90000,
      qualityRequirements: ["情緒匹配", "節奏與場長相符"],
    },
    {
      stepId: "generate-voiceover",
      spirit: "voice-specialist",
      description: "依角色語音檔生成對白與旁白",
      outputType: "voice",
      tools: ["studio.generateVoice"],
      dependsOn: ["storyboard-fill"],
      estimatedDuration: 90000,
      qualityRequirements: ["音色一致", "情緒到位"],
    },
    {
      stepId: "final-compose",
      spirit: "video-specialist",
      description: "把所有 video clip + audio track 合成最終影片",
      outputType: "video",
      tools: ["video.composeFinal"],
      dependsOn: ["image-to-video", "compose-music", "generate-voiceover"],
      estimatedDuration: 60000,
      qualityRequirements: ["音畫對齊", "轉場流暢", "符合目標長寬比"],
    },
    {
      stepId: "review",
      spirit: "critic",
      description: "成片 review：角色一致性、節奏、音畫同步",
      outputType: "analysis",
      tools: [],
      dependsOn: ["final-compose"],
      optional: true,
      qualityRequirements: ["整體完成度", "可上線品質"],
    },
  ],
};

/**
 * All available workflow templates
 */
export const WORKFLOW_TEMPLATES: Record<string, WorkflowTemplate> = {
  "video-creation-full": VIDEO_CREATION_WORKFLOW,
  "social-media-post": SOCIAL_MEDIA_POST_WORKFLOW,
  "educational-content": EDUCATIONAL_CONTENT_WORKFLOW,
  "multimedia-project": MULTIMEDIA_PROJECT_WORKFLOW,
  "quick-iteration": QUICK_ITERATION_WORKFLOW,
  "character-design": CHARACTER_DESIGN_WORKFLOW,
  "animation-production": ANIMATION_PRODUCTION_WORKFLOW,
};

/**
 * Get workflow template by ID
 */
export function getWorkflowTemplate(templateId: string): WorkflowTemplate | null {
  return WORKFLOW_TEMPLATES[templateId] || null;
}

/**
 * Find workflows by category
 */
export function getWorkflowsByCategory(
  category: WorkflowTemplate["category"]
): WorkflowTemplate[] {
  return Object.values(WORKFLOW_TEMPLATES).filter(t => t.category === category);
}

/**
 * Find workflows by tag
 */
export function getWorkflowsByTag(tag: string): WorkflowTemplate[] {
  return Object.values(WORKFLOW_TEMPLATES).filter(t => t.tags.includes(tag));
}

/**
 * Find workflows by difficulty
 */
export function getWorkflowsByDifficulty(
  difficulty: WorkflowTemplate["difficulty"]
): WorkflowTemplate[] {
  return Object.values(WORKFLOW_TEMPLATES).filter(t => t.difficulty === difficulty);
}

/**
 * Get all workflow template IDs
 */
export function getAllWorkflowIds(): string[] {
  return Object.keys(WORKFLOW_TEMPLATES);
}

/**
 * Search workflows by name or description
 */
export function searchWorkflows(query: string): WorkflowTemplate[] {
  const lowerQuery = query.toLowerCase();
  return Object.values(WORKFLOW_TEMPLATES).filter(
    t =>
      t.name.toLowerCase().includes(lowerQuery) ||
      t.description.toLowerCase().includes(lowerQuery) ||
      t.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
  );
}
