/**
 * shared/orb-agent-roles.ts
 *
 * Multi-agent role routing. The orb is one user-facing assistant but
 * internally it plays distinct roles depending on the request — director
 * for planning, composer for execution, critic for review, researcher for
 * gathering info, navigator for taking the user somewhere. This module
 * centralises the routing logic so the chat router and planner can ask
 * "which role is in charge of this turn?" instead of duplicating
 * keyword heuristics.
 *
 * Pure / sync; no I/O. The actual prompt slices are short on purpose —
 * the full personality + site knowledge already exists in
 * `siteKnowledge.buildOrbSystemPrompt`. These slices just steer that
 * prompt for the current turn.
 */
import type { PageAgentSnapshot } from "./agent-actions";

export type AgentRole =
  | "director"   // multi-step planning across pages
  | "composer"   // execution / dispatch on a single page
  | "critic"     // review user's plan / output, suggest improvements
  | "researcher" // search docs / web / asset library before acting
  | "navigator"  // just take the user somewhere, no execution
  | "companion"  // open conversation, no goal yet
  | "image-specialist"    // image generation & editing specialist
  | "video-specialist"    // video generation & editing specialist
  | "music-specialist"    // music & audio generation specialist
  | "voice-specialist"    // voice cloning & dubbing specialist
  | "training-specialist" // model training & LoRA specialist
  | "learning-specialist"; // learning & tutorial guidance specialist

export interface RoleSelectionInput {
  /** User's most recent utterance, lower-cased before matching. */
  text: string;
  /** Current page snapshot, when available — narrows composer detection. */
  snapshot?: PageAgentSnapshot | null;
  /** Conversation length in turns; >0 means we're not in a cold-start. */
  turnCount?: number;
}

export interface RoleSelection {
  role: AgentRole;
  /** Confidence in the selection (0..1). */
  confidence: number;
  /** Why we picked this role — useful for telemetry + LLM prompts. */
  rationale: string;
}

const KEYWORD_RULES: Array<{
  role: AgentRole;
  keywords: readonly string[];
  rationale: string;
}> = [
  // Director: explicit multi-step / cross-page workflow asks.
  {
    role: "director",
    keywords: [
      "規劃",
      "計畫",
      "工作流",
      "拼起來",
      "整個流程",
      "多步驟",
      "從頭到尾",
      "幫我做一支",
      "幫我做一首",
      "幫我做一張",
      "拆成步驟",
      "plan",
      "workflow",
      "pipeline",
      "story arc",
      "end-to-end",
    ],
    rationale: "user asked for multi-step / cross-page planning",
  },
  // Image Specialist: focused image generation and editing tasks
  {
    role: "image-specialist",
    keywords: [
      "圖片",
      "圖像",
      "照片",
      "畫",
      "繪製",
      "修圖",
      "圖片編輯",
      "去背",
      "放大圖片",
      "圖片風格",
      "image",
      "picture",
      "photo",
      "draw",
      "edit image",
      "upscale",
      "remove background",
      "img2img",
      "inpainting",
    ],
    rationale: "user wants image generation or editing assistance",
  },
  // Video Specialist: video generation and editing tasks
  {
    role: "video-specialist",
    keywords: [
      "影片",
      "視頻",
      "影像",
      "動畫",
      "剪輯",
      "影片編輯",
      "影片增強",
      "影片風格",
      "video",
      "animation",
      "clip",
      "video editing",
      "enhance video",
      "i2v",
      "v2v",
      "video style",
    ],
    rationale: "user wants video generation or editing assistance",
  },
  // Music Specialist: music and audio generation tasks
  {
    role: "music-specialist",
    keywords: [
      "音樂",
      "歌曲",
      "配樂",
      "背景音樂",
      "作曲",
      "音效",
      "聲音",
      "混音",
      "music",
      "song",
      "soundtrack",
      "background music",
      "compose",
      "sound effect",
      "audio mix",
      "stems",
    ],
    rationale: "user wants music or audio generation assistance",
  },
  // Voice Specialist: voice cloning and dubbing tasks
  {
    role: "voice-specialist",
    keywords: [
      "配音",
      "聲音",
      "語音",
      "旁白",
      "聲音克隆",
      "變聲",
      "口播",
      "語音生成",
      "voice",
      "voiceover",
      "narration",
      "voice cloning",
      "voice change",
      "tts",
      "text to speech",
      "dubbing",
    ],
    rationale: "user wants voice generation or cloning assistance",
  },
  // Training Specialist: model training and LoRA tasks
  {
    role: "training-specialist",
    keywords: [
      "訓練",
      "訓練模型",
      "fine-tune",
      "lora",
      "模型訓練",
      "客製化模型",
      "訓練角色",
      "train",
      "training",
      "fine-tuning",
      "custom model",
      "model training",
      "character training",
    ],
    rationale: "user wants model training or LoRA creation assistance",
  },
  // Learning Specialist: learning and tutorial guidance
  {
    role: "learning-specialist",
    keywords: [
      "教學",
      "學習",
      "教程",
      "怎麼用",
      "如何使用",
      "教我",
      "指導",
      "新手",
      "入門",
      "tutorial",
      "learn",
      "how to",
      "teach me",
      "guide",
      "beginner",
      "getting started",
    ],
    rationale: "user wants learning or tutorial guidance",
  },
  // Researcher: gather / look-up before acting.
  {
    role: "researcher",
    keywords: [
      "查",
      "搜尋",
      "找一下",
      "資料",
      "參考",
      "比較",
      "差別",
      "推薦哪個",
      "推薦哪幾個",
      "差在哪",
      "search",
      "look up",
      "compare",
      "what's the difference",
      "research",
    ],
    rationale: "user wants to look up / compare before deciding",
  },
  // Critic: review / improve / fix-up.
  {
    role: "critic",
    keywords: [
      "幫我改",
      "幫我修",
      "怎麼改",
      "改進",
      "優化",
      "再好一點",
      "review",
      "critique",
      "improve",
      "polish",
      "refine",
      "fix this",
    ],
    rationale: "user wants the orb to review / refine existing work",
  },
  // Navigator: take me somewhere.
  {
    role: "navigator",
    keywords: [
      "帶我去",
      "去到",
      "跳到",
      "幫我打開",
      "幫我找到",
      "in哪裡",
      "在哪裡",
      "從哪裡",
      "open",
      "go to",
      "take me to",
      "navigate to",
    ],
    rationale: "user wants to be taken to a specific page",
  },
];

const COMPOSER_ON_STUDIO_HINTS = [
  "生成",
  "送出",
  "做這張",
  "做這個",
  "再來一張",
  "下一張",
  "再生成",
  "submit",
  "generate",
  "render",
];

function lowerOnce(s: string): string {
  return (s ?? "").toLowerCase();
}

function matchesAny(haystack: string, keywords: readonly string[]): boolean {
  for (const k of keywords) {
    if (haystack.includes(k.toLowerCase())) return true;
  }
  return false;
}

/**
 * Pick the most-likely role for the current turn. Order of precedence:
 *   1. director  — explicit multi-step / cross-page intent
 *   2. researcher — explicit lookup / compare intent
 *   3. critic    — explicit review / refine intent
 *   4. navigator — explicit "take me to X" intent
 *   5. composer  — short message + on a studio page that supports execution
 *   6. companion — fallback, open conversation
 *
 * Confidence reflects how strong the keyword evidence is; the chat router
 * can fold this into its decision to actually invoke the role's prompt
 * slice (e.g., only switch when confidence > 0.5).
 */
export function selectRoleForIntent(input: RoleSelectionInput): RoleSelection {
  const text = lowerOnce(input.text);
  if (!text.trim()) {
    return {
      role: "companion",
      confidence: 0.2,
      rationale: "empty utterance — fall back to companion",
    };
  }

  for (const rule of KEYWORD_RULES) {
    if (matchesAny(text, rule.keywords)) {
      return { role: rule.role, confidence: 0.85, rationale: rule.rationale };
    }
  }

  // Composer: short imperative + we're already on a studio page.
  const onStudioPage =
    !!input.snapshot && /studio|director|focus-flow/.test(input.snapshot.pagePath);
  if (onStudioPage && text.length < 40 && matchesAny(text, COMPOSER_ON_STUDIO_HINTS)) {
    return {
      role: "composer",
      confidence: 0.7,
      rationale: "short imperative on a studio page → execute, don't re-plan",
    };
  }

  // Long message + studio page → composer with lower confidence; the
  // user is likely describing what to fill in.
  if (onStudioPage && text.length >= 40 && text.length <= 240) {
    return {
      role: "composer",
      confidence: 0.55,
      rationale: "concrete, on-page request → execute on the current studio",
    };
  }

  return {
    role: "companion",
    confidence: 0.3,
    rationale: "no explicit signal; default to open conversation",
  };
}

/**
 * Returns the system-prompt slice for a role. Caller appends this AFTER
 * the personality block so the role guidance overrides nothing but
 * narrows behaviour for THIS turn.
 */
export function getRoleSystemPromptSlice(role: AgentRole): string {
  switch (role) {
    case "director":
      return [
        "【本回合扮演：導演 (director)】",
        "這一回合你是規劃者：把使用者需求拆成跨頁面的工作流程，每步說明「為什麼這樣選」與「下一步」。",
        "優先輸出 runWorkflow，每個 step 都要可執行（toolName 或非 navigate 的 UI 動作）；不要只下「導向某頁」。",
      ].join("\n");
    case "composer":
      return [
        "【本回合扮演：作曲家 (composer)】",
        "使用者已經在工作室裡；你只負責執行：在當頁填提示詞、設參數、按送出。",
        "不要重新規劃跨頁流程，也不要把使用者帶離當前頁面，除非他明確要求。",
      ].join("\n");
    case "critic":
      return [
        "【本回合扮演：評論者 (critic)】",
        "使用者要你檢視現有作品或計畫；先點出 1-3 個具體可改進的地方，再給可選的修改路徑。",
        "保持溫和、邀請式語氣，不要列一長串硬性建議。",
      ].join("\n");
    case "researcher":
      return [
        "【本回合扮演：研究員 (researcher)】",
        "使用者想先比較或查資料再決定；先彙整事實（模型、價位、差別），再附上 1-2 個推薦選項。",
        "不要直接執行動作；研究完讓使用者自己選下一步。",
      ].join("\n");
    case "navigator":
      return [
        "【本回合扮演：導航 (navigator)】",
        "使用者只想被帶到某個頁面；用一個 navigate 動作完成，並用 1 句話說「到了之後可以做什麼」。",
        "不要展開跨頁工作流。",
      ].join("\n");
    case "companion":
      return [
        "【本回合扮演：陪伴 (companion)】",
        "對話開放，沒有明確目標；保持輕鬆對話，必要時輕聲提供 1-2 個下一步選項。",
        "不要主動執行動作；先問清意圖。",
      ].join("\n");
    case "image-specialist":
      return [
        "【本回合扮演：圖像精靈 (image specialist)】",
        "你是圖像生成與編輯專家，熟悉所有圖像模型、參數與技巧。",
        "專注於提供精確的圖像生成建議：選擇最適合的模型、調整參數、優化提示詞。",
        "主動提供專業建議（長寬比、風格、細節），但不施壓。可使用 studio.generateImage 工具直接執行。",
      ].join("\n");
    case "video-specialist":
      return [
        "【本回合扮演：影像精靈 (video specialist)】",
        "你是影片生成與編輯專家，熟悉 text-to-video、image-to-video、video-to-video 所有流程。",
        "專注於提供精確的影片生成建議：選擇最適合的模型、設定時長、優化提示詞。",
        "了解影片生成的技術限制與最佳實踐。可使用 studio.generateVideo、studio.enhanceVideo 工具。",
      ].join("\n");
    case "music-specialist":
      return [
        "【本回合扮演：音樂精靈 (music specialist)】",
        "你是音樂與音訊生成專家，熟悉音樂生成、音效製作、音訊混音所有技巧。",
        "專注於提供音樂創作建議：風格選擇、情緒表達、音效配置。",
        "了解音訊處理流程（分離音軌、合併、增強）。可使用 studio.generateAudio、studio.generateSfx、studio.separateStems、studio.mergeAudios 工具。",
      ].join("\n");
    case "voice-specialist":
      return [
        "【本回合扮演：語音精靈 (voice specialist)】",
        "你是語音生成與配音專家，熟悉語音克隆、語音合成、變聲所有技術。",
        "專注於提供語音生成建議：選擇聲音風格、調整語調、優化情感表達。",
        "了解語音克隆流程與虛擬化身動畫。可使用 studio.generateVoice、studio.cloneVoice、studio.designVoice、studio.changeVoice、studio.animateSpeaker 工具。",
      ].join("\n");
    case "training-specialist":
      return [
        "【本回合扮演：訓練精靈 (training specialist)】",
        "你是模型訓練與 LoRA 專家，熟悉客製化模型訓練的完整流程。",
        "專注於提供訓練建議：準備訓練資料、選擇基礎模型、設定訓練參數。",
        "了解 LoRA 訓練的最佳實踐與常見陷阱。可使用 studio.trainLora 工具，並引導使用者完成資料準備。",
      ].join("\n");
    case "learning-specialist":
      return [
        "【本回合扮演：學習精靈 (learning specialist)】",
        "你是平台導師，熟悉所有功能、教程與最佳實踐。",
        "專注於教學引導：分步驟講解、提供範例、解答疑問。",
        "使用溫和、鼓勵的語氣，避免資訊超載。善用學習文件中心的資源，必要時使用 navigate 帶使用者到相關教程。",
      ].join("\n");
  }
}

/**
 * For multi-step intents, return the sequence of roles the orb should
 * play in order. Used by chat routers that surface "我接下來會這樣陪你"
 * preview cards — purely advisory; the actual planner still owns step
 * generation.
 */
export function composeRoleChain(input: RoleSelectionInput): AgentRole[] {
  const head = selectRoleForIntent(input);
  switch (head.role) {
    case "director":
      // Director typically delegates to composer once each downstream
      // page is reached; critic optionally reviews before final ship.
      return ["director", "composer", "critic"];
    case "researcher":
      return ["researcher", "director", "composer"];
    case "critic":
      return ["critic", "composer"];
    case "navigator":
      return ["navigator"];
    case "composer":
      return ["composer"];
    case "companion":
      return ["companion"];
    default:
      return ["companion"];
  }
}

/** Render a role chain into a 1-2 sentence preview for the orb's reply. */
export function summarizeRoleChainForPrompt(chain: AgentRole[]): string {
  if (chain.length === 0) return "";
  const labels: Record<AgentRole, string> = {
    director: "導演",
    composer: "作曲家",
    critic: "評論者",
    researcher: "研究員",
    navigator: "導航",
    companion: "陪伴",
    "image-specialist": "圖像精靈",
    "video-specialist": "影像精靈",
    "music-specialist": "音樂精靈",
    "voice-specialist": "語音精靈",
    "training-specialist": "訓練精靈",
    "learning-specialist": "學習精靈",
  };
  if (chain.length === 1) return `【角色】${labels[chain[0]]}`;
  return `【角色鏈】${chain.map(r => labels[r]).join(" → ")}`;
}
