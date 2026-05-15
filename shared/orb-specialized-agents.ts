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
 * - Community Manager: social platform strategy
 *
 * 注意：這份 registry 之外另有 8 位精靈（律律 / 安安 / 群群 / 總總 / 帶帶 /
 * 記記 / 細細 / 步步）— 多數沒有自己的 fal 工具或 specialised modality，
 * 只有「社群精靈」(community-manager) 屬於 specialist family（會出貼文素材
 * 並使用 research.deepSearch / studio.* 工具），故僅它被加入這份 registry。
 * 其餘新精靈走 generic skill / proactive trigger 路徑（agent-skills.ts +
 * agentCollaborationOrchestrator.ts）。
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
      // studio.* 是泛用 dispatch（給編編 / 步步 也能呼叫）
      "studio.generateImage",
      "studio.generate3D",
      // imageSpecialist.* 是圖圖獨家的「認知 + 出圖一體」工具集
      // 推薦模型 / 改寫 prompt / 抓 catalog 真實清單 → 才是 AI agent 該有的能力
      "imageSpecialist.recommendModel",
      "imageSpecialist.enhancePrompt",
      "imageSpecialist.getModels",
      "imageSpecialist.generate",
      "imageSpecialist.edit",
      "imageSpecialist.upscale",
      "imageSpecialist.getTips",
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
    description: "專精於音樂與音訊生成，熟悉音樂創作、音效製作、音軌分離與混音；會依需求挑引擎、組 model-specific prompt、估點數、掃使用者素材庫",
    // 12 個工具 = 5 個 studio.* 真實生成 + 7 個 musicSpecialist.* 推理工具
    // （recommendEngine / buildPrompt / estimateCost / listEngines /
    //  getRecentAssets / getOptions / getTips）。前 5 個動引擎、後 7 個動腦
    //  —— 補進來後音音才從「只會打 fal」變成「會推理 + 打 fal」的 AI agent。
    primaryTools: [
      "studio.generateAudio",
      "studio.generateSfx",
      "studio.separateStems",
      "studio.isolateAudio",
      "studio.mergeAudios",
      "musicSpecialist.recommendEngine",
      "musicSpecialist.buildPrompt",
      "musicSpecialist.estimateCost",
      "musicSpecialist.listEngines",
      "musicSpecialist.getRecentAssets",
      "musicSpecialist.getOptions",
      "musicSpecialist.getTips",
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
    description: "專精於語音生成與配音，熟悉語音克隆、語音合成、變聲技術；具備推薦引擎 / 樣本健檢 / 語言偵測等 AI agent 能力",
    primaryTools: [
      // ── 自家 namespace（voiceSpecialist.*）：AI agent 工具 ──
      "voiceSpecialist.recommendModel",
      "voiceSpecialist.listVoices",
      "voiceSpecialist.checkCloneSample",
      "voiceSpecialist.detectLanguage",
      "voiceSpecialist.estimateCost",
      "voiceSpecialist.generateSpeech",
      "voiceSpecialist.cloneVoice",
      "voiceSpecialist.designVoice",
      "voiceSpecialist.changeVoice",
      "voiceSpecialist.transcribe",
      // ── studio.* namespace：與 composer / proStudio 共用的低階 dispatch ──
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
      // 真正開訓的入口（high-risk，會建 fineTunedModels + backgroundJobs）：
      "studio.trainLora",
      // 練練的 sensing + 計算工具：開訓前能看清現況、給準確點數與時間估算
      "trainingSpecialist.listMyModels",
      "trainingSpecialist.getModelStatus",
      "trainingSpecialist.recommendParams",
      "trainingSpecialist.analyzeDataset",
      "trainingSpecialist.estimateTraining",
      "trainingSpecialist.getTips",
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
    // 學學是真正的學習 AI agent — 不只是 FAQ 機器人：
    //   - learningSpecialist.* 9 個工具會真實打 LearnHub / orbFeatureDiscovery
    //   - inspiration.fetch 用來在教學時抓示範素材
    // 注意：director.suggestPlan / research.deepSearch 分別屬於 director /
    // researcher（generic skill 認領，詳見 shared/agent-skills.ts）。
    primaryTools: [
      "learningSpecialist.getTutorial",
      "learningSpecialist.listTutorials",
      "learningSpecialist.searchLearningContent",
      "learningSpecialist.recommendForContext",
      "learningSpecialist.generateLearningPath",
      "learningSpecialist.explainConcept",
      "learningSpecialist.getUserLearningProgress",
      "learningSpecialist.getNextLearningStep",
      "learningSpecialist.getQuickTips",
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
      "concept explanation",
      "personalized learning paths",
    ],
    useCases: [
      "新手入門指導",
      "功能使用教學",
      "工作流程規劃",
      "問題排除協助",
      "進階技巧學習",
      "概念解釋（LoRA / negative prompt / ControlNet …）",
      "依目標規劃學習路徑",
      "依使用紀錄推薦下一步",
    ],
  },
  {
    agentId: "community-manager",
    displayName: "社群精靈",
    description: "專精於社群平台經營，懂 IG / TikTok / YouTube / 小紅書各年齡層風格、貼文公式、發文節奏",
    primaryTools: [
      "research.deepSearch",
      "studio.generateImage",
      "studio.generateVideo",
    ],
    knowledgeDomains: [
      "Instagram Reels",
      "TikTok algorithm",
      "YouTube Shorts",
      "小紅書 grid 風格",
      "Facebook 社團",
      "LinkedIn 個人品牌",
      "hashtag strategy",
      "audience age targeting",
      "post timing",
      "engagement metrics",
    ],
    useCases: [
      "規劃社群貼文公式",
      "找出當前各平台趨勢",
      "依年齡層優化內容",
      "建議最佳發文時段",
      "產出貼文素材（圖 / 短影音）",
      "排程貼文行事曆",
    ],
  },
  {
    agentId: "inspiration-specialist",
    displayName: "靈感精靈",
    description:
      "專精於創意啟發與靈感蒐集：用 inspiration.fetch 拉取真實網路趨勢；用 inspirationSpecialist.* 工具從 30+ 風格策展庫動態組出 mood board、prompt 變體、風格排序、混搭建議。",
    primaryTools: [
      "inspiration.fetch",
      "inspirationSpecialist.searchTrends",
      "inspirationSpecialist.getSuggestions",
      "inspirationSpecialist.analyzeReference",
      "inspirationSpecialist.getStyleMixing",
      "inspirationSpecialist.buildMoodBoard",
      "inspirationSpecialist.refinePromptVariants",
      "inspirationSpecialist.rankStylesByIntent",
      "inspirationSpecialist.getStyleAtlas",
    ],
    knowledgeDomains: [
      "creative inspiration",
      "visual references",
      "mood boards",
      "trending styles",
      "creative brainstorming",
      "style exploration",
      "prompt examples",
      "artistic trends",
    ],
    useCases: [
      "提供創意靈感與視覺參考",
      "探索當前流行風格",
      "產生示範提示詞",
      "蒐集情緒板素材",
      "解決靈感卡關",
    ],
  },
  {
    // 編編 (composer) — 是「跨模態執行員」而非單一專業，但他有實際的工具
    // 表（頁面動作）+ 跨頁工作室知識，要被 findBestAgent / findAgentForTool /
    // recommendAgent 認得，所以列在 SPECIALIZED 裡。注意：他的 tools 是
    // 「頁面動作 namespace」(page.*)，跟 specialist 的 fal.ai studio.*
    // 工具不衝突 — findAgentForTool("page.fillPrompt") 會回 composer，
    // 而 findAgentForTool("studio.generateImage") 仍回 image-specialist。
    agentId: "composer",
    displayName: "編編",
    description: "在當前工作室一次把事情做完：填提示詞、選模型、調參數、按送出，並回報結果",
    primaryTools: [
      "page.fillPrompt",
      "page.setModel",
      "page.setParam",
      "page.setTab",
      "page.setMode",
      "page.applyPreset",
      "page.submit",
      "page.runWorkflow",
    ],
    knowledgeDomains: [
      "page action dispatch",
      "studio capabilities discovery",
      "form filling",
      "parameter tuning",
      "model selection",
      "submit + observe loop",
    ],
    useCases: [
      "在工作室直接執行使用者的指令",
      "把跨頁計畫的單頁步驟轉為動作",
      "回報每一步的結果（已填 / 已選 / 已送出）",
      "一句話跑完當頁的「填提示 → 設參數 → 送出」",
    ],
  },
  {
    agentId: "anatomy-specialist",
    displayName: "解剖精靈",
    description: "專精於人體解剖圖、醫學插圖、身體結構圖示，提供精確的解剖學術語與視覺呈現",
    primaryTools: [
      "studio.generateImage",
    ],
    knowledgeDomains: [
      "human anatomy",
      "skeletal system",
      "muscular system",
      "organ systems",
      "medical illustration",
      "anatomical terminology",
      "body structure diagrams",
      "physiological systems",
      "anatomical views (anterior/posterior/lateral)",
    ],
    useCases: [
      "產出人體解剖圖",
      "繪製醫學教學插圖",
      "製作骨骼肌肉圖示",
      "標註解剖結構",
      "提供精確解剖學術語",
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
    `光球系統內建 ${SPECIALIZED_AGENT_CAPABILITIES.length} 種專精助手，各自擁有特定領域的深度知識：`,
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
    // 8 位新增精靈的頁面
    if (context.currentPage.includes("/legal")) return "legal-advisor";
    if (context.currentPage.includes("/security")) return "security-guard";
    if (context.currentPage.includes("/social") || context.currentPage.includes("/community"))
      return "community-manager";
    if (context.currentPage.includes("/team") || context.currentPage.includes("/agents"))
      return "chief-orchestrator";
    if (context.currentPage.includes("/notes") || context.currentPage.includes("/assets") ||
        context.currentPage.includes("/schedule") || context.currentPage.includes("/calendar"))
      return "notes-curator";
    if (context.currentPage.includes("/settings")) return "settings-detail";
    if (context.currentPage.includes("/jobs") || context.currentPage.includes("/tasks"))
      return "plan-executor";
  }

  // Priority 3: User intent keywords (if provided)
  if (context.userIntent) {
    const intent = context.userIntent.toLowerCase();
    // 8 位新增精靈的高訊號意圖優先（避免被通用模態 keyword 搶走）
    if (/版權|侵權|商標|肖像|授權|copyright|trademark|license/.test(intent)) return "legal-advisor";
    if (/帳號被盜|api key|金鑰|password|資安|釣魚|phishing|credential/.test(intent)) return "security-guard";
    if (/社群|粉專|ig|tiktok|抖音|小紅書|hashtag|演算法/.test(intent)) return "community-manager";
    if (/總管|團隊狀態|誰在做|orchestrate|agent overview/.test(intent)) return "chief-orchestrator";
    if (/卡住|不會用|找不到按鈕|i'm stuck|stuck|guide me/.test(intent)) return "onboarding-coach";
    if (/筆記|排程|行事曆|素材庫|asset library|todo|待辦/.test(intent)) return "notes-curator";
    if (/設定|偏好|preferences|settings|靜音|主題|dark mode/.test(intent)) return "settings-detail";
    if (/從規劃到執行|一條龍|自動執行|end-to-end|auto execute/.test(intent)) return "plan-executor";
    // 既有 6 種模態
    if (/圖片|圖像|照片|image|picture/.test(intent)) return "image-specialist";
    if (/影片|視頻|video/.test(intent)) return "video-specialist";
    if (/音樂|音訊|audio|music/.test(intent)) return "music-specialist";
    if (/語音|配音|voice|tts/.test(intent)) return "voice-specialist";
    if (/訓練|lora|train/.test(intent)) return "training-specialist";
    if (/教學|學習|how to|tutorial/.test(intent)) return "learning-specialist";
  }

  return null;
}
