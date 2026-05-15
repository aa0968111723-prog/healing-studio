/**
 * shared/agent-skills.ts
 * ──────────────────────────────────────────────────────────────────────
 * Unified Agent Skill registry.
 *
 * The orb has three overlapping concepts that until now lived in three
 * different files:
 *   1. AgentRole          (orb-agent-roles.ts) — what role the orb is
 *                          playing this turn (director/composer/critic/...)
 *   2. SpecializedAgent    (orb-specialized-agents.ts) — what domain the
 *                          orb is acting on (image/video/voice/...)
 *   3. PageCapability      (global-agent-capabilities.ts) — which page can
 *                          execute which AgentAction
 *
 * In practice these three line up: when the user says "幫我修這張圖", the
 * orb should pick {role: composer, specialist: image, page: image-studio,
 * tools: studio.generateImage}. Without a single source of truth, every
 * caller (planner, role router, prompt builder, page route ranker) has to
 * recompute that mapping with its own keyword heuristics, and they
 * disagree.
 *
 * This module exposes one **AgentSkill** type that bundles them and a
 * **AGENT_SKILL_REGISTRY** so the orb pipeline can:
 *   - selectSkillForIntent(text, ctx) → pick a skill from a user message
 *   - getSkillRecommendedPages(skillId) → which page(s) this skill acts on
 *   - composeSkillChain(skillId)        → full role chain for previews
 *   - serializeSkillsForPrompt()        → system-prompt slice
 *
 * Pure / sync. No I/O. Safe to import from both client and server.
 */

import type { AgentRole, RoleSelection, RoleSelectionInput } from "./orb-agent-roles";
import {
  selectRoleForIntent,
  composeRoleChain as composeRoleChainBase,
  getRoleSystemPromptSlice,
} from "./orb-agent-roles";
import {
  SPECIALIZED_AGENT_CAPABILITIES,
  type SpecializedAgentCapability,
} from "./orb-specialized-agents";
import { APP_PAGE_REGISTRY } from "./appRegistry";

// ─── Types ───────────────────────────────────────────────────────────────

export type SkillModality =
  | "image"
  | "video"
  | "audio"
  | "voice"
  | "text"
  | "model"
  | "general";

export interface AgentSkill {
  /** Unique skill identifier — matches AgentRole so callers can swap freely. */
  id: AgentRole;
  /** Display name for UI / system prompts. */
  displayName: string;
  /** One-line description suitable for orb chat. */
  description: string;
  /** Domain modality (image / video / audio / voice / text / model / general). */
  modality: SkillModality;
  /** Pages where this skill can directly execute AgentActions. */
  recommendedPages: string[];
  /** Server-side tool names this skill is allowed to invoke. */
  tools: string[];
  /** Knowledge domains the orb claims under this skill. */
  knowledgeDomains: string[];
  /** Use cases shown to users when offering this skill. */
  useCases: string[];
  /** Default role chain when this skill is the head. */
  chain: AgentRole[];
  /** Whether this skill needs a domain page mounted to be useful. */
  requiresPage: boolean;
}

export interface SkillSelection {
  skill: AgentSkill;
  /** Source of the pick — "intent" (keywords), "page" (current path),
   *  "tool" (recent tool), or "fallback" (no signal). */
  source: "intent" | "page" | "tool" | "fallback";
  /** Confidence (0..1). */
  confidence: number;
  /** Human-readable rationale. Used for telemetry + system prompt. */
  rationale: string;
}

// ─── Skill Registry ──────────────────────────────────────────────────────

const SPECIALIST_BY_ID: Map<string, SpecializedAgentCapability> = new Map(
  SPECIALIZED_AGENT_CAPABILITIES.map(cap => [cap.agentId, cap])
);

const GENERIC_SKILLS: Array<Pick<
  AgentSkill,
  "id" | "displayName" | "description" | "modality" | "recommendedPages" | "tools" | "knowledgeDomains" | "useCases" | "chain" | "requiresPage"
>> = [
  {
    id: "director",
    displayName: "導演",
    description: "把跨頁需求拆成分步驟工作流",
    modality: "general",
    recommendedPages: ["/agent", "/director"],
    tools: ["director.suggestPlan"],
    knowledgeDomains: ["multi-step planning", "workflow design", "task decomposition"],
    useCases: ["跨頁工作流規劃", "多步驟創作協調", "把模糊想法變成可執行步驟"],
    chain: ["director", "composer", "critic"],
    requiresPage: false,
  },
  {
    id: "composer",
    displayName: "作曲家",
    description: "在當前工作室執行：填提示詞、設參數、按送出",
    modality: "general",
    recommendedPages: ["/studio", "/image-studio", "/video-studio", "/pro-studio"],
    tools: [],
    knowledgeDomains: ["page action dispatch", "form filling", "parameter tuning"],
    useCases: ["在當頁直接執行", "把計畫轉為實際操作"],
    chain: ["composer"],
    requiresPage: true,
  },
  {
    id: "critic",
    displayName: "評論者",
    description: "檢視既有作品或計畫，給 1-3 個具體可改進處",
    modality: "general",
    recommendedPages: ["/agent", "/studio", "/image-studio", "/video-studio", "/pro-studio"],
    tools: [],
    knowledgeDomains: ["quality review", "creative feedback", "iteration"],
    useCases: ["改進提示詞", "點評生成結果", "提出下一輪迭代方向"],
    chain: ["critic", "composer"],
    requiresPage: false,
  },
  {
    id: "researcher",
    displayName: "研究員",
    description: "比較模型 / 查資料 / 列選項，先研究再行動",
    modality: "general",
    recommendedPages: ["/agent", "/learn", "/models"],
    tools: ["research.deepSearch", "inspiration.fetch"],
    knowledgeDomains: ["model comparison", "documentation lookup", "platform features"],
    useCases: ["比較模型差異", "查找教學文件", "蒐集靈感參考"],
    chain: ["researcher", "director", "composer"],
    requiresPage: false,
  },
  {
    id: "navigator",
    displayName: "導航",
    description: "把使用者帶到正確的頁面，並用一句話提示下一步",
    modality: "general",
    recommendedPages: ["/agent"],
    tools: [],
    knowledgeDomains: ["page routing", "intent → destination mapping"],
    useCases: ["帶我去 X", "我不確定該在哪裡做這件事"],
    chain: ["navigator"],
    requiresPage: false,
  },
  {
    id: "companion",
    displayName: "陪伴",
    description: "開放對話，沒有明確目標時提供 1-2 個下一步",
    modality: "general",
    recommendedPages: ["/agent", "/"],
    tools: [],
    knowledgeDomains: ["open conversation", "intent clarification"],
    useCases: ["閒聊 / 暖身", "整理混亂的需求", "情緒陪伴"],
    chain: ["companion"],
    requiresPage: false,
  },
  {
    id: "accountant",
    displayName: "財財",
    description: "主動全站成本控制：算這次花多少、本月用到哪、推 1 個更省的做法",
    modality: "general",
    recommendedPages: ["/agent", "/dashboard", "/settings"],
    tools: [
      "accountant.estimate",
      "accountant.compare",
      "accountant.usage",
      "accountant.savings",
    ],
    knowledgeDomains: ["cost estimation", "quota / usage tracking", "subscription tier", "model pricing"],
    useCases: ["這次會花多少", "本月用量還剩多少", "有沒有更便宜的做法", "推薦升降級時機"],
    chain: ["accountant"],
    requiresPage: false,
  },
  {
    id: "quality-coach",
    displayName: "巧巧",
    description: "主動式提示詞 + 生成品質教練：給可貼進去的改寫建議",
    modality: "general",
    recommendedPages: ["/agent", "/studio", "/image-studio", "/video-studio", "/pro-studio"],
    tools: [],
    knowledgeDomains: ["prompt engineering", "output quality review", "iteration coaching"],
    useCases: ["怎麼寫 prompt", "這張為什麼糊", "提示詞範例", "下一輪要改什麼"],
    chain: ["quality-coach", "composer", "critic"],
    requiresPage: false,
  },
  {
    id: "inspector",
    displayName: "守守",
    description: "全站糾察隊：巡 404 / 卡住 / a11y / 效能問題並給繞過方法",
    modality: "general",
    recommendedPages: ["/agent", "/dashboard"],
    tools: [],
    knowledgeDomains: ["site health", "broken links", "accessibility", "performance", "bug triage"],
    useCases: ["回報 bug", "頁面壞掉怎麼辦", "找不到功能", "報怪怪的"],
    chain: ["inspector", "navigator"],
    requiresPage: false,
  },
  // ── 8 位新增精靈：去掉 community-manager（已在 SPECIALIZED_AGENT_CAPABILITIES）── //
  {
    id: "legal-advisor",
    displayName: "律律",
    description: "AI 生成法律 / 著作權 / 商標 / 肖像權 / 授權條款專家",
    modality: "general",
    // /legal 專屬頁未實作，先以 /agent 對話入口為主；PATH_SPIRIT_MAP 仍預留
    // /legal 路徑等待頁面實裝時自動接上。
    recommendedPages: ["/agent"],
    tools: ["research.deepSearch"],
    knowledgeDomains: ["copyright", "trademark", "fair use", "creative commons", "AI generation policy"],
    useCases: ["這個能不能商用", "用了會不會侵權", "授權條款查證", "AI 生成法律紅線"],
    chain: ["legal-advisor", "quality-coach", "composer"],
    requiresPage: false,
  },
  {
    id: "security-guard",
    displayName: "安安",
    description: "資安顧問：金鑰 / 密碼 / 帳號被盜 / deepfake 風險警示與處置",
    modality: "general",
    // /security 與 /settings/api-keys 子頁仍未在 APP_PAGE_REGISTRY 註冊；
    // 安安以 /settings 設定中心 + /agent 對話入口為主。
    recommendedPages: ["/settings", "/agent"],
    tools: [],
    knowledgeDomains: ["account security", "API key management", "2FA", "phishing", "deepfake risk"],
    useCases: ["帳號被盜處理", "API key 外洩", "deepfake / 詐騙警示", "兩步驟驗證設定"],
    chain: ["security-guard", "settings-detail"],
    requiresPage: false,
  },
  {
    id: "chief-orchestrator",
    displayName: "總總",
    description: "全團隊總管：看 23 位精靈現況，給下一棒建議與整體進度",
    modality: "general",
    // /team /agents 專屬團隊面板未實裝，總總以 /agent 對話 + /dashboard 為起點。
    recommendedPages: ["/agent", "/dashboard"],
    tools: [
      "orchestrator.getTeamStatus",
      "orchestrator.getSpiritStatus",
      "orchestrator.delegateTask",
      "orchestrator.queryProgress",
      "orchestrator.escalateIssue",
      "orchestrator.getStatistics",
    ],
    knowledgeDomains: ["agent orchestration", "task queue", "team workload", "spirit monitoring", "task delegation"],
    useCases: ["團隊狀態總覽", "誰負責什麼", "下一棒交給誰", "監控精靈進度", "處理執行失敗"],
    chain: ["chief-orchestrator", "director", "composer"],
    requiresPage: false,
  },
  {
    id: "onboarding-coach",
    displayName: "帶帶",
    description: "操作教練：偵測卡關，一步一步陪你走介面",
    modality: "general",
    recommendedPages: ["/agent"],
    tools: [],
    knowledgeDomains: ["site UI", "onboarding flows", "common stuck points"],
    useCases: ["我卡住了", "找不到按鈕", "操作上的困難", "新手指引"],
    chain: ["onboarding-coach", "navigator"],
    requiresPage: false,
  },
  {
    id: "notes-curator",
    displayName: "記記",
    description: "筆記、素材庫、排程的管理員：存、找、排一次完成",
    modality: "general",
    // /schedule /calendar 專屬頁尚未實裝，先以 /notes / /assets 為主，PATH_SPIRIT_MAP
    // 仍預留所有路徑等待頁面實作時自動接上。
    recommendedPages: ["/notes", "/assets", "/agent"],
    tools: [],
    knowledgeDomains: ["notes", "calendar", "asset library", "tagging", "scheduling"],
    useCases: ["記下重點", "翻舊素材", "排程貼文", "整理待辦"],
    chain: ["notes-curator", "composer"],
    requiresPage: false,
  },
  {
    id: "settings-detail",
    displayName: "細細",
    description: "設定 / 偏好 / 細節微調的引路人，並解釋打開後的副作用",
    modality: "general",
    recommendedPages: ["/settings", "/agent"],
    tools: [],
    knowledgeDomains: ["settings surface", "preferences", "feature flags"],
    useCases: ["改通知偏好", "切換主題", "改密碼 / 金鑰前置", "微調預設模型"],
    chain: ["settings-detail"],
    requiresPage: false,
  },
  {
    id: "plan-executor",
    displayName: "步步",
    description: "規劃 + 多步驟自動執行：跨頁、跨精靈一條龍跑完並回報每一步",
    modality: "general",
    // /jobs /tasks 專屬狀態面板尚未實裝，步步先以 /agent 對話 + /dashboard 為主。
    recommendedPages: ["/agent", "/dashboard"],
    // 故意留空 — 步步 *可以* 派遣所有 studio.* / research.* 工具，但
    // findSkillForTool 是「誰擁有這個工具」反向查詢；image / video /
    // music / voice / training / research 的 ownership 已經屬於對應
    // specialist，步步若聲稱也擁有會造成 substring 命中錯亂。步步透過
    // SPIRIT_MODEL_CAPABILITIES (ALL_CATEGORIES) 真實派遣權能仍然完整。
    tools: [],
    knowledgeDomains: ["multi-step orchestration", "tool dispatch", "step retries", "failure recovery"],
    useCases: ["從規劃到執行一條龍", "自動跑完整套 workflow", "跨頁多步驟任務"],
    chain: ["plan-executor", "accountant", "critic"],
    requiresPage: false,
  },
];

const SPECIALIST_PAGE_MAP: Record<string, { pages: string[]; modality: SkillModality }> = {
  "image-specialist": {
    pages: ["/image-studio", "/studio"],
    modality: "image",
  },
  "video-specialist": {
    pages: ["/video-studio", "/studio"],
    modality: "video",
  },
  "music-specialist": {
    pages: ["/pro-studio", "/studio"],
    modality: "audio",
  },
  "voice-specialist": {
    pages: ["/pro-studio", "/studio"],
    modality: "voice",
  },
  "training-specialist": {
    // /models hosts both the lora-trainer surface and the character forge.
    // /studio is acceptable when the user wants to apply a trained LoRA.
    pages: ["/models", "/studio"],
    modality: "model",
  },
  "learning-specialist": {
    pages: ["/learn", "/tutorial-overview", "/agent"],
    modality: "text",
  },
  "community-manager": {
    // /social / /community 專屬社群經營頁尚未實裝，群群以 image / video studio
    // 為主（被 call 來幫忙產貼文素材），加 /agent 對話入口。
    pages: ["/image-studio", "/video-studio", "/agent"],
    modality: "text",
  },
  "inspiration-specialist": {
    // 靈靈在所有創作頁都可能被叫到（卡靈感時）
    pages: ["/image-studio", "/video-studio", "/pro-studio", "/agent"],
    modality: "general",
  },
  "anatomy-specialist": {
    // 體體主要在圖像工作室產出解剖圖
    pages: ["/image-studio", "/studio", "/agent"],
    modality: "image",
  },
};

function buildSpecialistSkill(cap: SpecializedAgentCapability): AgentSkill {
  const meta = SPECIALIST_PAGE_MAP[cap.agentId] ?? {
    pages: ["/agent"],
    modality: "general" as const,
  };
  // Specialists don't open with director planning (overkill for a single
  // domain task); they go specialist → composer → critic so the user
  // gets a concrete attempt + one feedback loop.
  const baseChain: AgentRole[] =
    cap.agentId === "learning-specialist"
      ? [cap.agentId as AgentRole, "navigator"]
      : [cap.agentId as AgentRole, "composer", "critic"];
  return {
    id: cap.agentId as AgentRole,
    displayName: cap.displayName,
    description: cap.description,
    modality: meta.modality,
    recommendedPages: meta.pages,
    tools: cap.primaryTools,
    knowledgeDomains: cap.knowledgeDomains,
    useCases: cap.useCases,
    chain: baseChain,
    requiresPage: cap.agentId !== "learning-specialist",
  };
}

export const AGENT_SKILL_REGISTRY: AgentSkill[] = [
  ...GENERIC_SKILLS.map(skill => ({ ...skill })),
  ...SPECIALIZED_AGENT_CAPABILITIES.map(buildSpecialistSkill),
];

const SKILL_BY_ID: Map<AgentRole, AgentSkill> = new Map(
  AGENT_SKILL_REGISTRY.map(skill => [skill.id, skill])
);

// ─── Lookups ─────────────────────────────────────────────────────────────

export function getSkill(id: AgentRole): AgentSkill | null {
  return SKILL_BY_ID.get(id) ?? null;
}

export function listSkillsByModality(modality: SkillModality): AgentSkill[] {
  return AGENT_SKILL_REGISTRY.filter(skill => skill.modality === modality);
}

export function getSkillRecommendedPages(id: AgentRole): string[] {
  return getSkill(id)?.recommendedPages ?? [];
}

export function getSkillTools(id: AgentRole): string[] {
  return getSkill(id)?.tools ?? [];
}

export function findSkillForTool(toolName: string): AgentSkill | null {
  for (const skill of AGENT_SKILL_REGISTRY) {
    if (skill.tools.includes(toolName)) return skill;
  }
  return null;
}

export function findSkillForPage(pagePath: string | undefined | null): AgentSkill | null {
  if (!pagePath) return null;
  // Prefer specialists over generics — composer matches every studio so
  // it would always win the first hit otherwise.
  const specialists = AGENT_SKILL_REGISTRY.filter(s => SPECIALIST_BY_ID.has(s.id));
  for (const skill of specialists) {
    if (skill.recommendedPages.includes(pagePath)) return skill;
  }
  for (const skill of AGENT_SKILL_REGISTRY) {
    if (skill.recommendedPages.includes(pagePath)) return skill;
  }
  return null;
}

// ─── Selection ───────────────────────────────────────────────────────────

export interface SkillSelectionInput extends RoleSelectionInput {
  /** Recent server-side tools the orb has invoked. Used as a tiebreaker. */
  recentTools?: string[];
  /** Current page path — when provided, used to bias selection on
   *  short imperatives ("再來一張" on /image-studio → image-specialist). */
  currentPagePath?: string | null;
}

/**
 * Pick the best skill for the current turn.
 *
 * Priority:
 *   1. Recent tool usage — highest signal that the user is mid-task.
 *   2. Keyword match (delegated to selectRoleForIntent).
 *   3. Current page — short imperatives on a domain page snap to the
 *      page's specialist.
 *   4. Companion fallback.
 */
export function selectSkillForIntent(input: SkillSelectionInput): SkillSelection {
  // 1. Recent tool — strong signal that we're continuing a task.
  if (input.recentTools && input.recentTools.length > 0) {
    const lastTool = input.recentTools[input.recentTools.length - 1];
    const hit = findSkillForTool(lastTool);
    if (hit) {
      return {
        skill: hit,
        source: "tool",
        confidence: 0.9,
        rationale: `recent tool "${lastTool}" → ${hit.displayName}`,
      };
    }
  }

  // 2. Keyword router (existing role selector). It already knows about
  // specialists since the keyword rules were extended in orb-agent-roles.
  const roleHit: RoleSelection = selectRoleForIntent(input);
  const skillFromRole = SKILL_BY_ID.get(roleHit.role);
  if (skillFromRole && roleHit.confidence >= 0.5) {
    return {
      skill: skillFromRole,
      source: "intent",
      confidence: roleHit.confidence,
      rationale: roleHit.rationale,
    };
  }

  // 3. Current page snapshot — short imperatives on a studio page should
  // hand off to that page's specialist, not fall through to companion.
  const pagePath = input.currentPagePath ?? input.snapshot?.pagePath ?? null;
  const pageSkill = findSkillForPage(pagePath);
  const isShortImperative = (input.text ?? "").trim().length < 40;
  if (pageSkill && isShortImperative) {
    return {
      skill: pageSkill,
      source: "page",
      confidence: 0.6,
      rationale: `on-page short imperative → ${pageSkill.displayName} (page=${pagePath})`,
    };
  }

  // 4. Last resort: low-confidence role result, else companion.
  const fallback = SKILL_BY_ID.get(roleHit.role) ?? SKILL_BY_ID.get("companion")!;
  return {
    skill: fallback,
    source: "fallback",
    confidence: Math.max(0.2, roleHit.confidence),
    rationale: roleHit.rationale,
  };
}

/**
 * Convenience: full role chain for a given skill. Falls back to the
 * skill's declared `chain`; matches `composeRoleChain` for non-specialist
 * heads so existing callers keep working.
 */
export function composeSkillChain(input: SkillSelectionInput): AgentRole[] {
  const selection = selectSkillForIntent(input);
  // For specialists, prefer the skill's curated chain; for generic roles,
  // fall back to the existing composeRoleChain so behaviour stays
  // identical to the role-only path.
  if (SPECIALIST_BY_ID.has(selection.skill.id)) {
    return [...selection.skill.chain];
  }
  return composeRoleChainBase(input);
}

// ─── Prompt rendering ────────────────────────────────────────────────────

/** Two-line skill summary block for the system prompt. */
export function summarizeSkillForPrompt(skill: AgentSkill): string {
  const tools = skill.tools.length > 0 ? skill.tools.slice(0, 3).join(", ") : "(無 tool)";
  const pages = skill.recommendedPages.slice(0, 3).join(", ");
  return [
    `## ${skill.displayName} (${skill.id})`,
    skill.description,
    `主要頁面：${pages}　主要工具：${tools}`,
  ].join("\n");
}

/** Full skill index for the orb system prompt — sectioned by modality. */
export function serializeSkillsForPrompt(): string {
  const sections: string[] = ["【全站 Agent Skill 索引】"];
  const order: SkillModality[] = ["general", "image", "video", "audio", "voice", "model", "text"];
  const labels: Record<SkillModality, string> = {
    general: "通用角色",
    image: "圖像",
    video: "影片",
    audio: "音樂",
    voice: "語音",
    model: "模型訓練",
    text: "學習",
  };
  for (const modality of order) {
    const skills = listSkillsByModality(modality);
    if (skills.length === 0) continue;
    sections.push(`### ${labels[modality]}`);
    for (const skill of skills) {
      sections.push(summarizeSkillForPrompt(skill));
    }
  }
  return sections.join("\n\n");
}

/** Combined slice for a turn: selected skill description + its role
 *  prompt slice (so callers don't need to import both modules). */
export function buildSkillTurnPromptSlice(input: SkillSelectionInput): {
  skill: AgentSkill;
  selection: SkillSelection;
  slice: string;
} {
  const selection = selectSkillForIntent(input);
  const slice = [
    summarizeSkillForPrompt(selection.skill),
    "",
    getRoleSystemPromptSlice(selection.skill.id),
  ].join("\n");
  return { skill: selection.skill, selection, slice };
}

// ─── Validation ──────────────────────────────────────────────────────────

/** Sanity check that every page referenced by a skill exists in the page
 *  registry. Catches typos when wiring new pages. */
export function validateSkillRegistry(): {
  ok: boolean;
  unknownPages: Array<{ skill: AgentRole; path: string }>;
  duplicateIds: AgentRole[];
} {
  const knownPaths = new Set(APP_PAGE_REGISTRY.map(p => p.path));
  const unknownPages: Array<{ skill: AgentRole; path: string }> = [];
  for (const skill of AGENT_SKILL_REGISTRY) {
    for (const path of skill.recommendedPages) {
      // Strip query string so /admin?section=brain still matches /admin.
      const normalized = path.split("?")[0];
      if (!knownPaths.has(normalized)) {
        unknownPages.push({ skill: skill.id, path });
      }
    }
  }
  const seen = new Set<AgentRole>();
  const duplicateIds: AgentRole[] = [];
  for (const skill of AGENT_SKILL_REGISTRY) {
    if (seen.has(skill.id)) duplicateIds.push(skill.id);
    seen.add(skill.id);
  }
  return {
    ok: unknownPages.length === 0 && duplicateIds.length === 0,
    unknownPages,
    duplicateIds,
  };
}
