/**
 * shared/site-prompt-catalog.ts
 *
 * 「全站可收集的提示詞」彙整器 — 把散落在 codebase 各處的 prompt 片段
 * 攏進來，讓「個人提示詞收集」（promptCollection router）能列出所有
 * 來源讓使用者點選 collect。
 *
 * 為什麼集中在此：以前 prompt 分散在 6 個檔案（精靈 system slice、
 * 主動觸發、模型樣板、ImageStudio 模板、SD 模板…），如果讓 client / router
 * 各自跑 import 又跑 join，會分散導致漂移。把「列舉所有站內 prompt」這件
 * 事固化成一個 pure function（getSitePromptCatalog），所有消費端用同一份。
 *
 * 設計原則：
 *   - Pure / dependency-free（只 import 同層 shared 模組，不碰 server / DB）
 *   - 每個條目都有穩定 (sourceType, sourceRef) 對 — promptCollection 表的
 *     UNIQUE (userId, sourceType, sourceRef) 防止使用者重複 collect
 *   - 條目順序穩定（依 sourceType / sourceRef 字典序），測試可依賴它
 */

import {
  type AgentRole,
  type ProactiveTriggerEvent,
  SPIRIT_PROACTIVE_TRIGGERS,
  getPrimaryNicknameForRole,
  getRoleSystemPromptSlice,
} from "./orb-agent-roles";
import { MODEL_PROMPT_TEMPLATES } from "./modelPromptTemplates";
import {
  IMAGE_STUDIO_PROMPT_TEMPLATES,
  IMAGE_STUDIO_SD_PROMPT_TEMPLATES,
  IMAGE_STUDIO_EDIT_TEMPLATES,
  VIDEO_STUDIO_T2V_TEMPLATES,
  VIDEO_STUDIO_I2V_TEMPLATES,
  VIDEO_STUDIO_V2V_TEMPLATES,
  VIDEO_STUDIO_CONTROL_TEMPLATES,
  PRO_STUDIO_MUSIC_TEMPLATES,
  PRO_STUDIO_SFX_TEMPLATES,
  PRO_STUDIO_TTS_TEMPLATES,
  PRO_STUDIO_CLONE_TEMPLATES,
  type VideoStudioPromptTemplate,
  type ProStudioPromptTemplate,
} from "./orb-studio-actions";
import {
  PROMPT_REFERENCE_LIBRARY,
  PROMPT_MODALITY_META,
  promptCategoryForLibrary,
} from "./promptReferenceLibrary";
import {
  DIRECTOR_PERSONALITY_LABELS,
  DIRECTOR_PERSONALITY_SYSTEM_PROMPTS,
  type DirectorPersonality,
} from "./director-personality-prompts";

export type SitePromptSourceType =
  | "agent_role"
  | "proactive_trigger"
  | "model_template"
  | "image_studio"
  | "video_studio"
  | "pro_studio"
  | "director_personality"
  | "prompt_reference"
  | "site_prompt"
  | "manual";

export interface SitePromptEntry {
  /** Stable (sourceType, sourceRef) → 與 prompt_collection 表對齊。 */
  sourceType: SitePromptSourceType;
  sourceRef: string;
  /** 顯示用標題（會被當成 collection 的 title 預設值）。 */
  title: string;
  /** 完整的 prompt 內容 — 收集時當 content 寫入。 */
  content: string;
  /** 顯示用來源標籤（例「圖圖 image-specialist」、「FLUX Pro 樣板」）。 */
  sourceLabel: string;
  /** 預設 category。 */
  category: "general" | "image" | "video" | "audio" | "voice" | "story" | "system";
  /** 預設 tags，給 UI 顯示徽章用。 */
  tags: string[];
  /** 一兩句說明這條 prompt 是做什麼用的。 */
  description?: string;
}

const PROACTIVE_EVENT_LABEL: Record<ProactiveTriggerEvent, string> = {
  monthly_spend_threshold: "本月用量超標提醒",
  expensive_op_about_to_run: "高成本任務提示",
  low_quality_generation: "低品質生成輔導",
  prompt_too_short: "提示詞過短建議",
  site_error_detected: "全站錯誤回報",
  page_perf_bad: "頁面效能告警",
  feature_not_used: "未啟用功能推薦",
  context_near_full: "對話壓縮提醒",
  ip_risk_detected: "IP / 版權風險警示",
  credential_leak_detected: "API 金鑰外洩警示",
  user_stuck_detected: "操作卡關輔導",
  team_status_overview: "團隊狀態總覽",
  social_post_ready: "社群貼文排程",
  notes_capture_suggested: "筆記留存建議",
  settings_drift_detected: "偏好與行為偏移",
  multi_step_plan_ready: "多步驟自動執行接手",
};

/** 列出 codebase 內所有 AgentRole — type 端做 single source of truth，
 * 新增精靈時 TypeScript 會立刻在這裡缺一條失敗。 */
const ALL_AGENT_ROLES: readonly AgentRole[] = [
  "director",
  "composer",
  "critic",
  "researcher",
  "navigator",
  "companion",
  "accountant",
  "quality-coach",
  "inspector",
  "image-specialist",
  "video-specialist",
  "music-specialist",
  "voice-specialist",
  "training-specialist",
  "learning-specialist",
  "legal-advisor",
  "security-guard",
  "community-manager",
  "chief-orchestrator",
  "onboarding-coach",
  "notes-curator",
  "settings-detail",
  "plan-executor",
  "inspiration-specialist",
  "anatomy-specialist",
] as const;

const ROLE_CATEGORY: Partial<Record<AgentRole, SitePromptEntry["category"]>> = {
  "image-specialist": "image",
  "video-specialist": "video",
  "music-specialist": "audio",
  "voice-specialist": "voice",
  "inspiration-specialist": "story",
  "anatomy-specialist": "image",
};

function buildAgentRoleEntries(): SitePromptEntry[] {
  return ALL_AGENT_ROLES.map(role => {
    const nickname = getPrimaryNicknameForRole(role);
    const content = getRoleSystemPromptSlice(role);
    return {
      sourceType: "agent_role",
      sourceRef: role,
      title: `${nickname}（${role}）的系統提示`,
      content,
      sourceLabel: `精靈 · ${nickname}`,
      category: ROLE_CATEGORY[role] ?? "system",
      tags: ["精靈", nickname],
      description: "全站 15+ 位精靈在對話時的 system prompt 切片，集成於 orb-agent-roles.ts",
    };
  });
}

function buildProactiveTriggerEntries(): SitePromptEntry[] {
  return SPIRIT_PROACTIVE_TRIGGERS.map((spec, idx) => {
    const nickname = getPrimaryNicknameForRole(spec.spirit);
    const eventLabel = PROACTIVE_EVENT_LABEL[spec.event] ?? spec.event;
    return {
      sourceType: "proactive_trigger" as const,
      // 同一精靈可能對應多個事件 — 用 spirit+event 組鍵保證唯一。
      // idx 是 fallback，理論上 enum 已唯一所以不會用到。
      sourceRef: `${spec.spirit}:${spec.event}#${idx}`,
      title: `${nickname} · ${eventLabel}`,
      content: spec.defaultPrompt,
      sourceLabel: `主動觸發 · ${nickname}`,
      category: "system" as const,
      tags: ["主動觸發", nickname, spec.surface],
      description: `當 ${eventLabel} 觸發時，${nickname} 會以此模板開場（surface=${spec.surface}）`,
    };
  });
}

function buildModelTemplateEntries(): SitePromptEntry[] {
  return MODEL_PROMPT_TEMPLATES.filter(
    // 通用 fallback (modelIdPrefix="") 沒有實質內容，不收。
    tpl => tpl.modelIdPrefix.length > 0
  ).map(tpl => {
    const parts: string[] = [];
    if (tpl.promptPrefix) {
      parts.push(`【前綴】${tpl.promptPrefix}`);
    }
    if (tpl.promptSuffix) {
      parts.push(`【後綴】${tpl.promptSuffix}`);
    }
    if (tpl.defaultNegativePrompt) {
      parts.push(`【預設負面詞】${tpl.defaultNegativePrompt}`);
    }
    if (parts.length === 0) {
      // 純樣板但沒填料 — 至少把 rationale 當內容。
      parts.push(tpl.rationale);
    }
    const cat: SitePromptEntry["category"] =
      tpl.style === "cinematic"
        ? "video"
        : tpl.style === "music-tags"
          ? "audio"
          : tpl.style === "voice-style"
            ? "voice"
            : "image";
    return {
      sourceType: "model_template" as const,
      sourceRef: tpl.modelIdPrefix,
      title: `${tpl.modelIdPrefix} 的提示詞偏好`,
      content: parts.join("\n"),
      sourceLabel: `模型樣板 · ${tpl.style}`,
      category: cat,
      tags: ["模型偏好", tpl.style, tpl.modelIdPrefix.split("/")[0] ?? "fal"],
      description: tpl.rationale,
    };
  });
}

function buildImageStudioEntries(): SitePromptEntry[] {
  const t2i = IMAGE_STUDIO_PROMPT_TEMPLATES.map(tpl => ({
    sourceType: "image_studio" as const,
    sourceRef: `t2i:${tpl.id}`,
    title: `${tpl.emoji} ${tpl.label}`,
    content: tpl.text,
    sourceLabel: "ImageStudio · 文字生圖模板",
    category: "image" as const,
    tags: ["ImageStudio", "t2i", tpl.label],
    description: "Image Studio 文字生圖（T2I）內建範例提示詞",
  }));
  const sd = IMAGE_STUDIO_SD_PROMPT_TEMPLATES.map(tpl => {
    const content = tpl.negPrompt
      ? `${tpl.prompt}\n\n【負面詞】${tpl.negPrompt}`
      : tpl.prompt;
    return {
      sourceType: "image_studio" as const,
      sourceRef: `sd:${tpl.id}`,
      title: `${tpl.emoji} ${tpl.label}（SD）`,
      content,
      sourceLabel: "ImageStudio · SD 模板",
      category: "image" as const,
      tags: ["ImageStudio", "sd", tpl.label],
      description: "Image Studio Stable Diffusion 分頁內建模板（含主提示詞 + 負面詞）",
    };
  });
  const edit = IMAGE_STUDIO_EDIT_TEMPLATES.map(tpl => ({
    sourceType: "image_studio" as const,
    sourceRef: `edit:${tpl.id}`,
    title: `${tpl.emoji} ${tpl.label}（編輯）`,
    content: tpl.text,
    sourceLabel: "ImageStudio · 編輯模板",
    category: "image" as const,
    tags: ["ImageStudio", "edit", tpl.label],
    description:
      tpl.suggestedModelId
        ? `Image Studio 圖片編輯模板，建議模型：${tpl.suggestedModelId}`
        : "Image Studio 圖片編輯模板",
  }));
  return [...t2i, ...sd, ...edit];
}

function videoStudioEntry(
  tab: "t2v" | "i2v" | "v2v" | "control",
  tpl: VideoStudioPromptTemplate
): SitePromptEntry {
  const tabLabel: Record<typeof tab, string> = {
    t2v: "文字生影片",
    i2v: "圖生影片",
    v2v: "影片重繪",
    control: "運鏡控制",
  };
  const content = tpl.negPrompt
    ? `${tpl.prompt}\n\n【負面詞】${tpl.negPrompt}`
    : tpl.prompt;
  return {
    sourceType: "video_studio",
    sourceRef: `${tab}:${tpl.id}`,
    title: `${tpl.emoji} ${tpl.label}`,
    content,
    sourceLabel: `VideoStudio · ${tabLabel[tab]}模板`,
    category: "video",
    tags: ["VideoStudio", tab, tpl.label],
    description: tpl.suggestedModelId
      ? `Video Studio ${tabLabel[tab]} 模板，建議模型：${tpl.suggestedModelId}`
      : `Video Studio ${tabLabel[tab]} 模板`,
  };
}

function buildVideoStudioEntries(): SitePromptEntry[] {
  return [
    ...VIDEO_STUDIO_T2V_TEMPLATES.map(t => videoStudioEntry("t2v", t)),
    ...VIDEO_STUDIO_I2V_TEMPLATES.map(t => videoStudioEntry("i2v", t)),
    ...VIDEO_STUDIO_V2V_TEMPLATES.map(t => videoStudioEntry("v2v", t)),
    ...VIDEO_STUDIO_CONTROL_TEMPLATES.map(t => videoStudioEntry("control", t)),
  ];
}

function proStudioEntry(
  tab: "music" | "sfx" | "tts" | "clone",
  tpl: ProStudioPromptTemplate
): SitePromptEntry {
  const tabCfg: Record<
    typeof tab,
    { label: string; category: SitePromptEntry["category"] }
  > = {
    music: { label: "音樂", category: "audio" },
    sfx: { label: "音效", category: "audio" },
    tts: { label: "文字轉語音", category: "voice" },
    clone: { label: "聲音克隆", category: "voice" },
  };
  const cfg = tabCfg[tab];
  // params（duration / instrumental / voiceId…）併進 description 讓使用者
  // 知道 ProStudio 套這個模板時順手會設定哪些參數。
  const paramHint = tpl.params?.length
    ? ` · 預設參數：${tpl.params
        .map(p => `${p.key}=${JSON.stringify(p.value)}`)
        .join(", ")}`
    : "";
  return {
    sourceType: "pro_studio",
    sourceRef: `${tab}:${tpl.id}`,
    title: `${tpl.emoji} ${tpl.label}`,
    content: tpl.prompt,
    sourceLabel: `ProStudio · ${cfg.label}模板`,
    category: cfg.category,
    tags: ["ProStudio", tab, tpl.label],
    description: tpl.suggestedModelId
      ? `ProStudio ${cfg.label} 模板，建議模型：${tpl.suggestedModelId}${paramHint}`
      : `ProStudio ${cfg.label} 模板${paramHint}`,
  };
}

function buildProStudioEntries(): SitePromptEntry[] {
  return [
    ...PRO_STUDIO_MUSIC_TEMPLATES.map(t => proStudioEntry("music", t)),
    ...PRO_STUDIO_SFX_TEMPLATES.map(t => proStudioEntry("sfx", t)),
    ...PRO_STUDIO_TTS_TEMPLATES.map(t => proStudioEntry("tts", t)),
    ...PRO_STUDIO_CLONE_TEMPLATES.map(t => proStudioEntry("clone", t)),
  ];
}

function buildDirectorPersonalityEntries(): SitePromptEntry[] {
  const personalities: DirectorPersonality[] = ["calm", "creative", "technical"];
  return personalities.map(p => ({
    sourceType: "director_personality",
    sourceRef: p,
    title: `導演 AI · ${DIRECTOR_PERSONALITY_LABELS[p]} system prompt`,
    content: DIRECTOR_PERSONALITY_SYSTEM_PROMPTS[p],
    sourceLabel: `導演 AI · ${DIRECTOR_PERSONALITY_LABELS[p]}`,
    category: "system",
    tags: ["導演 AI", DIRECTOR_PERSONALITY_LABELS[p], "CO-STAR"],
    description: "DirectorAI 在組 LLM message chain 時送進 role=\"system\" 的人格指令",
  }));
}

function buildPromptReferenceEntries(): SitePromptEntry[] {
  return PROMPT_REFERENCE_LIBRARY.map(ref => {
    const meta = PROMPT_MODALITY_META[ref.modality];
    const content = ref.negativePrompt
      ? `${ref.prompt}\n\n【負面詞】${ref.negativePrompt}`
      : ref.prompt;
    return {
      sourceType: "prompt_reference" as const,
      sourceRef: ref.id,
      title: `${meta.emoji} ${ref.title}`,
      content,
      sourceLabel: `學習中心 · ${meta.label}`,
      category: promptCategoryForLibrary(ref.modality),
      tags: [meta.label, ref.difficulty, ...ref.tags.slice(0, 3)],
      description: ref.modelHint
        ? `${ref.summary}（建議模型：${ref.modelHint}）`
        : ref.summary,
    };
  });
}

/**
 * 一次列出所有站內可收集的 prompt。Order 為：
 *   1) agent_role（25 條）— 精靈 system prompt slice
 *   2) proactive_trigger（依 SPIRIT_PROACTIVE_TRIGGERS 順序）— 18 條主動觸發
 *   3) director_personality（3 條）— 導演 AI 三種人格 system prompt
 *   4) model_template（依 MODEL_PROMPT_TEMPLATES 順序）— FLUX / SD / Kling…
 *   5) image_studio（T2I → SD → 編輯）
 *   6) video_studio（T2V → I2V → V2V → control）
 *   7) pro_studio（music → sfx → tts → clone）
 *   8) prompt_reference（120+ 條學習中心精選）
 * 同一群內依原始來源順序，方便測試固定 snapshot。
 */
export function getSitePromptCatalog(): SitePromptEntry[] {
  return [
    ...buildAgentRoleEntries(),
    ...buildProactiveTriggerEntries(),
    ...buildDirectorPersonalityEntries(),
    ...buildModelTemplateEntries(),
    ...buildImageStudioEntries(),
    ...buildVideoStudioEntries(),
    ...buildProStudioEntries(),
    ...buildPromptReferenceEntries(),
  ];
}

/** Look up a single catalog entry by its (sourceType, sourceRef) — used by
 * the collect mutation to fetch authoritative title / content / label from
 * shared registry rather than trust client-supplied strings. */
export function findSitePromptEntry(
  sourceType: SitePromptSourceType,
  sourceRef: string
): SitePromptEntry | null {
  return (
    getSitePromptCatalog().find(
      entry => entry.sourceType === sourceType && entry.sourceRef === sourceRef
    ) ?? null
  );
}

export const SITE_PROMPT_SOURCE_TYPES: readonly SitePromptSourceType[] = [
  "agent_role",
  "proactive_trigger",
  "model_template",
  "image_studio",
  "video_studio",
  "pro_studio",
  "director_personality",
  "prompt_reference",
  "site_prompt",
  "manual",
] as const;
