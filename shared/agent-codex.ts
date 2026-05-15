/**
 * shared/agent-codex.ts — 「光球 AI 代理代碼大全系統」
 *
 * 全站 AI 代理能力的單一查詢出口（canonical compendium）。把分散在
 *   - shared/slash-commands.ts        （4 種模式 / 25 精靈 / 快捷指令）
 *   - shared/orb-agent-roles.ts       （精靈家族 / 接棒網絡 / 主動觸發）
 *   - shared/appRegistry.ts           （36 個頁面 / quick actions / orbHints）
 * 的資料聚合成統一的 `CodexEntry` 結構，提供：
 *   1. 「打 /codex 一個關鍵字」就能列出所有相關功能
 *   2. 「給我所有精靈 / 模式 / 主動觸發」分類瀏覽
 *   3. 「哪些功能還沒寫進 slash 指令？」覆蓋率審計（auditCodexCoverage）
 *   4. Markdown 匯出（buildCodexMarkdown）給 LLM / 文件用
 *
 * 設計原則：
 *   - 純資料 + 純函式，不引入 React / DOM / 後端 IO
 *   - 不重寫資料 — 全部從既有 const 推導出來，避免雙寫漂移
 *   - 「無遺漏」由 auditCodexCoverage 的 vitest 檢查保證
 */

import {
  SLASH_COMMANDS,
  SLASH_GROUP_LABELS,
  SPIRIT_COMMANDS,
  type SlashCommand,
  type SlashCommandGroup,
  type SlashCommandMode,
} from "./slash-commands";
import {
  SPIRIT_COLLAB_PROTOCOL,
  SPIRIT_FAMILY,
  SPIRIT_PROACTIVE_TRIGGERS,
  type AgentRole,
  type ProactiveTriggerEvent,
  type ProactiveTriggerSpec,
  type SpiritFamily,
  type SpiritHandoff,
} from "./orb-agent-roles";
import { APP_PAGE_REGISTRY, type AppPageRegistryItem } from "./appRegistry";

// ─── 型別定義 ─────────────────────────────────────────────────────────────

/**
 * 大全分類 — 比 SlashCommandGroup 多了「頁面 / 接棒 / 主動觸發 / 家族」這
 * 些非指令性的能力。UI 依此排序顯示。
 */
export type CodexCategory =
  | "mode"          // 4 種代理模式 (auto / plan / nav / ask)
  | "spirit"        // 25 位精靈個人檔
  | "spirit-family" // 3 個精靈家族 (specialist / role / proactive)
  | "page"          // 36 個頁面 + 它們的 quick actions
  | "command"       // 非模式、非精靈的 slash 指令
  | "memory"        // 記憶相關
  | "session"       // 對話控制
  | "action"        // 一次性動作
  | "navigate"      // 頁面跳轉指令
  | "help"          // 自助 / 文件
  | "handoff"       // 精靈接棒網絡
  | "trigger";      // 主動觸發事件

/**
 * Codex 條目 — 統一格式。`refs.*` 是給 UI 跳轉用的次要欄位。
 */
export interface CodexEntry {
  /** 唯一 id（categoryId#shortKey），用於 React key 與 URL hash。 */
  id: string;
  /** 顯示標題（含 emoji / @ 前綴）— 例如 "/auto 多步驟代理"、"@圖圖 圖像精靈"。 */
  title: string;
  /** 分類。 */
  category: CodexCategory;
  /** 一句話摘要（≤ 80 字）。 */
  summary: string;
  /** 詳細說明（多句、可含換行）。 */
  details: string;
  /** 別名 / 暱稱 / 縮寫 — 給 fuzzy 搜尋用。 */
  aliases: readonly string[];
  /** 觸發例子（給 UI 一鍵塞進輸入框）。 */
  examples: readonly string[];
  /** 圖示鍵 — 跟 SlashCommand.iconKey 同一份對映表（client 端決定圖樣）。 */
  iconKey: string;
  /** 關聯資料（給 UI 顯示與跳轉用，client 端決定怎麼渲染）。 */
  refs: {
    /** 若這個條目對應一個 slash 指令，回它的名字（含 /）。 */
    slashCommand?: string;
    /** 若這個條目對應一位精靈，回 AgentRole id。 */
    spirit?: AgentRole;
    /** 若這個條目對應一個頁面，回路徑（例如 "/image-studio"）。 */
    pagePath?: string;
    /** 若這個條目對應一個主動事件，回 event id。 */
    triggerEvent?: ProactiveTriggerEvent;
    /** 若這個條目對應一個模式，回 mode id。 */
    mode?: SlashCommandMode;
    /** 若這個條目對應一個家族，回 family id。 */
    family?: SpiritFamily;
    /** 接棒條目專用：來源精靈 → 目的精靈。 */
    handoff?: { from: AgentRole; to: AgentRole; when: string };
  };
}

// ─── 共用工具 ─────────────────────────────────────────────────────────────

/**
 * Slash 指令分組 → Codex 分類。把指令系統的分組映射到大全的分類，這樣
 * 同一個 SLASH_COMMANDS 條目可以同時出現在指令清單與大全裡。
 */
const SLASH_GROUP_TO_CATEGORY: Record<SlashCommandGroup, CodexCategory> = {
  mode: "mode",
  spirit: "spirit",
  navigate: "navigate",
  memory: "memory",
  action: "action",
  session: "session",
  help: "help",
};

function entryIdForSlash(cmd: SlashCommand): string {
  return `slash#${cmd.name.slice(1).toLowerCase()}`;
}

function entryIdForSpirit(role: AgentRole): string {
  return `spirit#${role}`;
}

function entryIdForPage(item: AppPageRegistryItem): string {
  return `page#${item.id}`;
}

function entryIdForHandoff(from: AgentRole, to: AgentRole): string {
  return `handoff#${from}->${to}`;
}

function entryIdForTrigger(spec: ProactiveTriggerSpec, index: number): string {
  return `trigger#${spec.spirit}:${spec.event}:${index}`;
}

function entryIdForFamily(family: SpiritFamily): string {
  return `family#${family}`;
}

// ─── 1. 模式條目（4 個） ──────────────────────────────────────────────────

function buildModeEntries(): CodexEntry[] {
  const modes = SLASH_COMMANDS.filter(c => c.group === "mode");
  return modes.map(cmd => {
    if (cmd.action.kind !== "send-with-mode") {
      // 防呆 — 不應該發生，mode 分組裡的指令必為 send-with-mode
      throw new Error(`mode command ${cmd.name} 不是 send-with-mode kind`);
    }
    return {
      id: entryIdForSlash(cmd),
      title: `${cmd.name} ${describeMode(cmd.action.mode)}`,
      category: "mode" as const,
      summary: cmd.description,
      details: buildModeDetails(cmd.action.mode, cmd),
      aliases: cmd.aliases,
      examples: cmd.example ? [`/${cmd.example}`] : [],
      iconKey: cmd.iconKey,
      refs: {
        slashCommand: cmd.name,
        mode: cmd.action.mode,
      },
    };
  });
}

function describeMode(mode: SlashCommandMode): string {
  switch (mode) {
    case "multi-step":   return "多步驟自動代理";
    case "plan":         return "先擬計畫再執行";
    case "navigate":     return "跳頁模式";
    case "ask-feature":  return "功能詢問模式";
  }
}

function buildModeDetails(mode: SlashCommandMode, cmd: SlashCommand): string {
  const base = cmd.description;
  switch (mode) {
    case "multi-step":
      return `${base}\n\n光球會：① 解析目標 → ② 自動拆步驟 → ③ 跑完一條工作流。中途可隨時打斷或補充。適合「幫我做支 30 秒預告片」這種一口氣的指令。`;
    case "plan":
      return `${base}\n\n光球會先列計畫表給你看，等你說「開始」才動工。適合預算敏感、想先看路線圖的場景。可搭配 @財財 預估點數、@品品 預檢素材。`;
    case "navigate":
      return `${base}\n\n光球只負責帶你去對的頁，不會動手執行。例如「我要做配音」→ 跳 /voice。背後走 selectRoleForIntent 的 navigator 角色。`;
    case "ask-feature":
      return `${base}\n\n純資訊查詢，光球不會動手也不會跳頁，只回答「這站有什麼 / 哪個模型適合 / 怎麼做」。背後走站知識庫（siteKnowledge.buildOrbSystemPrompt）。`;
  }
}

// ─── 2. 精靈條目（25 位） ─────────────────────────────────────────────────

function buildSpiritEntries(): CodexEntry[] {
  return SPIRIT_COMMANDS.map(spirit => {
    const role = spirit.spiritId as AgentRole;
    const family = SPIRIT_FAMILY[role];
    const collab = SPIRIT_COLLAB_PROTOCOL[role];
    const triggers = SPIRIT_PROACTIVE_TRIGGERS.filter(t => t.spirit === role);

    const handoffSummary = collab.handoffs
      .slice(0, 3)
      .map(h => `→ @${primaryNicknameOf(h.to)}（${h.reason}）`)
      .join("\n");
    const triggerSummary = triggers
      .map(t => `· ${t.event} → ${t.surface}`)
      .join("\n");

    const detailsParts = [
      `家族：${describeFamily(family)}`,
      `首選暱稱：@${spirit.nickname}`,
      collab.handoffs.length > 0 ? `常見接棒（前 3）：\n${handoffSummary}` : "",
      collab.receivedFrom.length > 0
        ? `會被以下精靈交棒過來：${collab.receivedFrom.map(r => `@${primaryNicknameOf(r)}`).join("、")}`
        : "",
      triggers.length > 0 ? `主動觸發事件：\n${triggerSummary}` : "（被動精靈，僅在被點名 / 被導導交棒時介入）",
    ].filter(Boolean);

    return {
      id: entryIdForSpirit(role),
      title: `/${spirit.command} @${spirit.nickname}`,
      category: "spirit" as const,
      summary: spirit.description,
      details: detailsParts.join("\n\n"),
      aliases: [spirit.nickname, role, `@${spirit.nickname}`, ...buildExtraSpiritAliases(role)],
      examples: [`/${spirit.command} 想做的事`, `@${spirit.nickname} 想做的事`],
      iconKey: spirit.command === "director" ? "workflow" : "sparkles",
      refs: {
        slashCommand: `/${spirit.command}`,
        spirit: role,
        family,
      },
    };
  });
}

function describeFamily(family: SpiritFamily): string {
  switch (family) {
    case "specialist": return "專精家族 — 領域知識型，被點名才上場";
    case "role":       return "工作流家族 — 跨領域協調、規劃與執行";
    case "proactive":  return "主動家族 — 偵測事件自動冒出來提醒";
  }
}

function primaryNicknameOf(role: AgentRole): string {
  const spirit = SPIRIT_COMMANDS.find(s => s.spiritId === role);
  return spirit?.nickname ?? role;
}

/**
 * 額外別名 — 把 orb-agent-roles 裡 SPIRIT_NICKNAMES 的舊名搬一些常見的進來，
 * 讓使用者打舊名也找得到（例如「老導 / 嚴選 / 研哥」）。SPIRIT_NICKNAMES
 * 本身沒 export，這份是「使用者最容易誤打的舊名子集」。
 */
function buildExtraSpiritAliases(role: AgentRole): string[] {
  const EXTRA: Partial<Record<AgentRole, string[]>> = {
    "image-specialist":  ["阿圖", "圖像精靈"],
    "video-specialist":  ["阿影", "小影", "影像精靈"],
    "music-specialist":  ["哼哼", "小音", "音樂精靈"],
    "voice-specialist":  ["麥麥", "小聲", "語音精靈"],
    "training-specialist": ["阿訓", "訓練精靈"],
    "learning-specialist": ["學長", "學習精靈"],
    director:    ["老導", "導演"],
    composer:    ["編排"],
    critic:      ["嚴選", "評審"],
    researcher:  ["研哥", "研究員"],
    navigator:   ["領航", "導航員"],
    companion:   ["陪伴員"],
    accountant:  ["精算師"],
    "quality-coach": ["品質教練", "提示詞教練"],
    inspector:   ["糾察隊", "巡邏員"],
    "legal-advisor":     ["法律精靈", "法務官"],
    "security-guard":    ["資安精靈", "盾盾"],
    "community-manager": ["社群精靈", "社群經理"],
    "chief-orchestrator": ["總管", "總精靈"],
    "onboarding-coach":   ["輔導精靈", "操作教練"],
    "notes-curator":      ["筆記精靈", "排程精靈"],
    "settings-detail":    ["設定精靈", "細節精靈"],
    "plan-executor":      ["執行精靈", "規劃執行"],
    "inspiration-specialist": ["靈感精靈", "創意精靈"],
    "anatomy-specialist":     ["解剖精靈", "醫學插圖精靈"],
  };
  return EXTRA[role] ?? [];
}

// ─── 3. 精靈家族條目（3 個） ──────────────────────────────────────────────

function buildFamilyEntries(): CodexEntry[] {
  const families: SpiritFamily[] = ["specialist", "role", "proactive"];
  return families.map(family => {
    const members = (Object.entries(SPIRIT_FAMILY) as Array<[AgentRole, SpiritFamily]>)
      .filter(([, f]) => f === family)
      .map(([role]) => role);
    const memberList = members.map(r => `@${primaryNicknameOf(r)}`).join("、");
    return {
      id: entryIdForFamily(family),
      title: `家族・${familyChineseLabel(family)}`,
      category: "spirit-family" as const,
      summary: describeFamily(family),
      details: `成員（${members.length} 位）：${memberList}\n\n${familyDeepDescription(family)}`,
      aliases: [family, familyChineseLabel(family)],
      examples: [],
      iconKey: "users",
      refs: { family },
    };
  });
}

function familyChineseLabel(family: SpiritFamily): string {
  switch (family) {
    case "specialist": return "專精家族";
    case "role":       return "工作流家族";
    case "proactive":  return "主動家族";
  }
}

function familyDeepDescription(family: SpiritFamily): string {
  switch (family) {
    case "specialist":
      return "領域型精靈：被點名（@暱稱）或被導導 / 步步交棒才上場。專注「把單一領域做透」。包含圖、影、音、聲、訓、學、靈、體、群等。";
    case "role":
      return "通用工作流精靈：跨領域協調、規劃、執行、評論、導航、陪伴。包含導、編、品、查、路、暖、總、記、細、步。";
    case "proactive":
      return "主動精靈：訂閱 ProactiveEventBus，偵測到事件自動跳出來。包含財財（成本）、巧巧（品質）、守守（站健康）、律律（IP）、安安（資安）、帶帶（卡關）。";
  }
}

// ─── 4. 頁面條目（36 個） ─────────────────────────────────────────────────

function buildPageEntries(): CodexEntry[] {
  return APP_PAGE_REGISTRY.map(page => {
    const quickActionList = page.quickActions
      .map(qa => `· ${qa.label} — ${qa.description}`)
      .join("\n");
    const orbHintList = page.orbHints.map(h => `「${h}」`).join("、");
    const detailParts = [
      page.description,
      page.quickActions.length > 0 ? `快捷動作：\n${quickActionList}` : "",
      page.orbHints.length > 0 ? `光球例句：${orbHintList}` : "",
      page.supportsPageAgent ? "✅ 支援 PageAgent（光球可直接在此頁動作）" : "ℹ️ 純資訊頁面",
    ].filter(Boolean);
    return {
      id: entryIdForPage(page),
      title: `${page.path} ${page.label}`,
      category: "page" as const,
      summary: page.description,
      details: detailParts.join("\n\n"),
      aliases: [page.id, ...page.aliases],
      examples: [`/nav ${page.label}`, `/go ${page.id}`],
      iconKey: "compass",
      refs: { pagePath: page.path },
    };
  });
}

// ─── 5. 其他 slash 指令（不在 mode / spirit 的） ───────────────────────────

function buildOtherCommandEntries(): CodexEntry[] {
  return SLASH_COMMANDS
    .filter(c => c.group !== "mode" && c.group !== "spirit")
    .map(cmd => ({
      id: entryIdForSlash(cmd),
      title: cmd.name,
      category: SLASH_GROUP_TO_CATEGORY[cmd.group],
      summary: cmd.description,
      details: buildCommandDetails(cmd),
      aliases: cmd.aliases,
      examples: cmd.example ? [`/${cmd.example}`] : [],
      iconKey: cmd.iconKey,
      refs: {
        slashCommand: cmd.name,
      },
    }));
}

function buildCommandDetails(cmd: SlashCommand): string {
  const parts = [cmd.description];
  if (cmd.takesArgument) {
    parts.push(`需要參數：${cmd.argumentHint ?? "(自由文字)"}`);
  } else {
    parts.push("無需參數，輸入指令即觸發。");
  }
  if (cmd.example) {
    parts.push(`範例：\`/${cmd.example}\``);
  }
  parts.push(`動作類型：${cmd.action.kind}`);
  return parts.join("\n\n");
}

// ─── 6. 接棒網絡條目（從 SPIRIT_COLLAB_PROTOCOL 推導） ─────────────────────

function buildHandoffEntries(): CodexEntry[] {
  const entries: CodexEntry[] = [];
  for (const [src, spec] of Object.entries(SPIRIT_COLLAB_PROTOCOL) as Array<[
    AgentRole,
    { handoffs: SpiritHandoff[]; receivedFrom: AgentRole[] }
  ]>) {
    for (const h of spec.handoffs) {
      const fromNick = primaryNicknameOf(src);
      const toNick = primaryNicknameOf(h.to);
      entries.push({
        id: entryIdForHandoff(src, h.to),
        title: `@${fromNick} → @${toNick}`,
        category: "handoff" as const,
        summary: h.reason,
        details: `觸發條件：${h.when}\n\n@${fromNick} 在這個情境下會把對話 / 任務交給 @${toNick}。`,
        aliases: [`${src}->${h.to}`, fromNick, toNick],
        examples: [],
        iconKey: "corner-up-right",
        refs: {
          handoff: { from: src, to: h.to, when: h.when },
        },
      });
    }
  }
  return entries;
}

// ─── 7. 主動觸發條目 ──────────────────────────────────────────────────────

function buildTriggerEntries(): CodexEntry[] {
  return SPIRIT_PROACTIVE_TRIGGERS.map((spec, index) => ({
    id: entryIdForTrigger(spec, index),
    title: `${spec.event} → @${primaryNicknameOf(spec.spirit)}`,
    category: "trigger" as const,
    summary: spec.defaultPrompt.split("。")[0] + "。",
    details: `事件：${spec.event}\n精靈：@${primaryNicknameOf(spec.spirit)}\nUI 呈現：${describeSurface(spec.surface)}\n\n預設文案：${spec.defaultPrompt}`,
    aliases: [spec.event, primaryNicknameOf(spec.spirit), spec.spirit],
    examples: [],
    iconKey: spec.surface === "blocking" ? "trash-2" : "sparkles",
    refs: {
      triggerEvent: spec.event,
      spirit: spec.spirit,
    },
  }));
}

function describeSurface(surface: ProactiveTriggerSpec["surface"]): string {
  switch (surface) {
    case "toast":    return "Toast（一閃而過）";
    case "inline":   return "Inline card（留在對話中）";
    case "blocking": return "Blocking dialog（必須處理）";
  }
}

// ─── 主入口 ───────────────────────────────────────────────────────────────

let CODEX_CACHE: readonly CodexEntry[] | null = null;

/**
 * 完整大全 — 第一次呼叫時建構並快取，純函式但生成成本有點貴（要遍歷
 * SPIRIT_PROACTIVE_TRIGGERS / SPIRIT_COLLAB_PROTOCOL）。
 */
export function getAllCodexEntries(): readonly CodexEntry[] {
  if (CODEX_CACHE) return CODEX_CACHE;
  const entries: CodexEntry[] = [
    ...buildModeEntries(),
    ...buildSpiritEntries(),
    ...buildFamilyEntries(),
    ...buildPageEntries(),
    ...buildOtherCommandEntries(),
    ...buildHandoffEntries(),
    ...buildTriggerEntries(),
  ];
  CODEX_CACHE = Object.freeze(entries);
  return CODEX_CACHE;
}

/**
 * 給 vitest 用 — 重設快取（並非業務需要，只給測試的 beforeEach）。
 */
export function _resetCodexCacheForTest(): void {
  CODEX_CACHE = null;
}

// ─── 查詢 API ──────────────────────────────────────────────────────────────

/**
 * 中文翻譯 — UI 分類標籤用。
 */
export const CODEX_CATEGORY_LABELS: Record<CodexCategory, string> = {
  mode:           "代理模式",
  spirit:         "精靈個人檔",
  "spirit-family": "精靈家族",
  page:           "站內頁面",
  command:        "指令（其他）",
  navigate:       "頁面跳轉指令",
  memory:         "記憶相關",
  session:        "對話控制",
  action:         "快捷動作",
  help:           "幫助 / 自助",
  handoff:        "接棒網絡",
  trigger:        "主動觸發",
};

/** 顯示順序 — UI 依此排條目分群。 */
export const CODEX_CATEGORY_ORDER: readonly CodexCategory[] = [
  "mode",
  "spirit-family",
  "spirit",
  "page",
  "navigate",
  "action",
  "memory",
  "session",
  "help",
  "command",
  "handoff",
  "trigger",
];

/**
 * 取指定分類的條目。
 */
export function getCodexByCategory(category: CodexCategory): CodexEntry[] {
  return getAllCodexEntries().filter(e => e.category === category);
}

/**
 * Fuzzy 搜尋。比對 title / summary / aliases / details（依序）。
 *   - 空字串 → 全部
 *   - 多 token 用空白分隔，需要全部命中
 *   - 不分大小寫；CJK 字元也支援 substring 比對
 */
export function searchCodex(query: string, limit = 50): CodexEntry[] {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return getAllCodexEntries().slice(0, limit);
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return getAllCodexEntries().slice(0, limit);

  const scored: Array<{ entry: CodexEntry; score: number }> = [];
  for (const entry of getAllCodexEntries()) {
    const haystacks: string[] = [
      entry.title.toLowerCase(),
      entry.summary.toLowerCase(),
      entry.details.toLowerCase(),
      ...entry.aliases.map(a => a.toLowerCase()),
    ];
    let score = 0;
    let matchedAll = true;
    for (const token of tokens) {
      const inTitle   = entry.title.toLowerCase().includes(token);
      const inAlias   = entry.aliases.some(a => a.toLowerCase().includes(token));
      const inSummary = entry.summary.toLowerCase().includes(token);
      const inAny     = haystacks.some(h => h.includes(token));
      if (!inAny) {
        matchedAll = false;
        break;
      }
      // 越早出現的欄位加越多分
      if (inTitle)   score += 8;
      if (inAlias)   score += 5;
      if (inSummary) score += 3;
      score += 1;
    }
    if (matchedAll) scored.push({ entry, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(s => s.entry);
}

/**
 * 取單一條目（exact match by id）。
 */
export function getCodexEntry(id: string): CodexEntry | null {
  return getAllCodexEntries().find(e => e.id === id) ?? null;
}

/**
 * 依精靈 id 取它的詳情條目 + 所有相關接棒 / 觸發。給「精靈個人卡片頁」用。
 */
export function getSpiritFullProfile(role: AgentRole): {
  spirit: CodexEntry | null;
  handoffsOut: CodexEntry[];
  handoffsIn: CodexEntry[];
  triggers: CodexEntry[];
} {
  const all = getAllCodexEntries();
  const spirit = all.find(e => e.refs.spirit === role && e.category === "spirit") ?? null;
  const handoffsOut = all.filter(e => e.category === "handoff" && e.refs.handoff?.from === role);
  const handoffsIn  = all.filter(e => e.category === "handoff" && e.refs.handoff?.to === role);
  const triggers    = all.filter(e => e.category === "trigger" && e.refs.spirit === role);
  return { spirit, handoffsOut, handoffsIn, triggers };
}

// ─── 統計 + 覆蓋率審計 ────────────────────────────────────────────────────

export interface CodexStats {
  /** 條目總數。 */
  total: number;
  /** 各分類條目數。 */
  byCategory: Record<CodexCategory, number>;
  /** 25 精靈各自的接棒數 + 主動觸發數，給 dashboard 用。 */
  spiritActivity: Array<{
    role: AgentRole;
    nickname: string;
    handoffsOut: number;
    handoffsIn: number;
    triggers: number;
  }>;
}

export function getCodexStats(): CodexStats {
  const all = getAllCodexEntries();
  const byCategory = CODEX_CATEGORY_ORDER.reduce(
    (acc, cat) => {
      acc[cat] = all.filter(e => e.category === cat).length;
      return acc;
    },
    {} as Record<CodexCategory, number>
  );
  const spiritActivity = SPIRIT_COMMANDS.map(s => {
    const role = s.spiritId as AgentRole;
    const profile = getSpiritFullProfile(role);
    return {
      role,
      nickname: s.nickname,
      handoffsOut: profile.handoffsOut.length,
      handoffsIn: profile.handoffsIn.length,
      triggers: profile.triggers.length,
    };
  });
  return {
    total: all.length,
    byCategory,
    spiritActivity,
  };
}

/**
 * 覆蓋率審計 — 「有沒有遺漏」是這份大全的核心承諾。回傳所有「在源資料裡
 * 出現但沒進大全」的 id。Vitest 會 assert 全部為空。
 */
export interface CoverageGap {
  source: "SLASH_COMMANDS" | "SPIRIT_COMMANDS" | "APP_PAGE_REGISTRY" | "SPIRIT_COLLAB_PROTOCOL" | "SPIRIT_PROACTIVE_TRIGGERS";
  id: string;
  reason: string;
}

export function auditCodexCoverage(): CoverageGap[] {
  const gaps: CoverageGap[] = [];
  const all = getAllCodexEntries();
  const slashIds = new Set(all.filter(e => e.refs.slashCommand).map(e => e.refs.slashCommand!));
  const spiritIds = new Set(all.filter(e => e.refs.spirit && e.category === "spirit").map(e => e.refs.spirit!));
  const pageIds = new Set(all.filter(e => e.refs.pagePath).map(e => e.refs.pagePath!));

  for (const cmd of SLASH_COMMANDS) {
    if (!slashIds.has(cmd.name)) {
      gaps.push({
        source: "SLASH_COMMANDS",
        id: cmd.name,
        reason: `${cmd.name} 沒有對應的 codex entry`,
      });
    }
  }
  for (const spirit of SPIRIT_COMMANDS) {
    if (!spiritIds.has(spirit.spiritId as AgentRole)) {
      gaps.push({
        source: "SPIRIT_COMMANDS",
        id: spirit.spiritId,
        reason: `精靈 ${spirit.nickname}(${spirit.spiritId}) 沒有對應的 codex entry`,
      });
    }
  }
  for (const page of APP_PAGE_REGISTRY) {
    if (!pageIds.has(page.path)) {
      gaps.push({
        source: "APP_PAGE_REGISTRY",
        id: page.path,
        reason: `頁面 ${page.label}(${page.path}) 沒有對應的 codex entry`,
      });
    }
  }
  // 接棒：每條 handoff 都該有 entry
  const handoffKeys = new Set(
    all.filter(e => e.category === "handoff").map(e => `${e.refs.handoff!.from}->${e.refs.handoff!.to}`)
  );
  for (const [src, spec] of Object.entries(SPIRIT_COLLAB_PROTOCOL) as Array<[AgentRole, { handoffs: SpiritHandoff[] }]>) {
    for (const h of spec.handoffs) {
      const key = `${src}->${h.to}`;
      if (!handoffKeys.has(key)) {
        gaps.push({
          source: "SPIRIT_COLLAB_PROTOCOL",
          id: key,
          reason: `接棒 ${key} 沒有對應的 codex entry`,
        });
      }
    }
  }
  // 主動觸發：每個 (spirit,event,index) 都該有 entry
  const triggerCount = all.filter(e => e.category === "trigger").length;
  if (triggerCount !== SPIRIT_PROACTIVE_TRIGGERS.length) {
    gaps.push({
      source: "SPIRIT_PROACTIVE_TRIGGERS",
      id: "<count>",
      reason: `主動觸發條目數 ${triggerCount} ≠ 來源 ${SPIRIT_PROACTIVE_TRIGGERS.length}`,
    });
  }
  return gaps;
}

// ─── Markdown 匯出 ────────────────────────────────────────────────────────

/**
 * 把整份大全（或某個查詢結果）轉成 markdown。用途：
 *   1. 給 LLM 當 system prompt 補丁（「站內所有功能總覽」）
 *   2. 給 /help / /codex 的 chat 回覆內容
 *   3. 給文件站直接抓檔
 */
export function buildCodexMarkdown(options?: {
  /** 只匯出某些分類；省略則全部。 */
  categories?: readonly CodexCategory[];
  /** 自訂篩選後的條目（例如 searchCodex 的結果）。會覆蓋 categories。 */
  entries?: readonly CodexEntry[];
  /** 標題（預設「光球 AI 代理代碼大全」）。 */
  title?: string;
}): string {
  const entries = options?.entries
    ? options.entries
    : options?.categories
      ? getAllCodexEntries().filter(e => options.categories!.includes(e.category))
      : getAllCodexEntries();
  const title = options?.title ?? "光球 AI 代理代碼大全";

  const byCategory = new Map<CodexCategory, CodexEntry[]>();
  for (const entry of entries) {
    const list = byCategory.get(entry.category) ?? [];
    list.push(entry);
    byCategory.set(entry.category, list);
  }

  const lines: string[] = [`# ${title}`];
  lines.push(`\n（共 ${entries.length} 條目；分類順序與 UI 對齊）`);

  for (const cat of CODEX_CATEGORY_ORDER) {
    const items = byCategory.get(cat);
    if (!items || items.length === 0) continue;
    lines.push(`\n## ${CODEX_CATEGORY_LABELS[cat]} (${items.length})`);
    for (const entry of items) {
      lines.push(`\n### ${entry.title}`);
      lines.push(entry.summary);
      if (entry.aliases.length > 0) {
        lines.push(`- 別名：${entry.aliases.map(a => `\`${a}\``).join("、")}`);
      }
      if (entry.examples.length > 0) {
        lines.push(`- 範例：${entry.examples.map(x => `\`${x}\``).join("、")}`);
      }
      if (entry.details && entry.details !== entry.summary) {
        lines.push(`\n${entry.details}`);
      }
    }
  }

  return lines.join("\n");
}

/**
 * 對應 SlashCommandGroup → CodexCategory 的對外輔助（給 UI 從指令選單跳到
 * 大全頁時用）。
 */
export function categoryForSlashGroup(group: SlashCommandGroup): CodexCategory {
  return SLASH_GROUP_TO_CATEGORY[group];
}

/**
 * 取分類顯示順序（給 UI 排序用）。會保留沒列在 ORDER 裡的分類（fallback）。
 */
export function getCategoriesInDisplayOrder(): readonly CodexCategory[] {
  return CODEX_CATEGORY_ORDER;
}

// ─── 對外重新匯出（給 UI 一個出口拿 group labels） ────────────────────────
export { SLASH_GROUP_LABELS };
