/**
 * shared/agent-codex.ts — 「光球 AI 代理代碼大全系統」
 *
 * 全站 AI 代理能力的單一查詢出口（canonical compendium）。把分散在
 *   - shared/slash-commands.ts        （4 種模式 / 25 精靈 / 快捷指令）
 *   - shared/orb-agent-roles.ts       （家族 / 接棒網絡 / 主動觸發 / 模型偏好 / 模態能力）
 *   - shared/appRegistry.ts           （頁面 + quickActions + orbHints + supportedActions）
 *   - shared/cross-modality-workflows.ts （6 個跨模態工作流）
 *   - shared/agent-skills.ts          （技能登記簿）
 *   - shared/global-agent-tools.ts    （148 個 server 端工具）
 * 的資料聚合成統一的 `CodexEntry` 結構，提供：
 *   1. 「打 /codex 一個關鍵字」就能列出所有相關功能（含同義詞展開）
 *   2. 「給我所有精靈 / 模式 / 主動觸發」分類瀏覽
 *   3. 「哪些功能還沒寫進 slash 指令？」覆蓋率審計（auditCodexCoverage）
 *   4. Markdown 匯出（buildCodexMarkdown）給 LLM / 文件用
 *   5. 倒排索引 + 相關條目交叉連結（getRelatedEntries / searchCodex）
 *
 * 設計原則：
 *   - 純資料 + 純函式，不引入 React / DOM / 後端 IO
 *   - 不重寫資料 — 全部從既有 const 推導出來，避免雙寫漂移
 *   - 「無遺漏」由 auditCodexCoverage 的 vitest 檢查保證
 *   - 搜尋走預建 token 倒排索引，O(tokens) 而非 O(entries × tokens)
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
  SPIRIT_MODEL_CAPABILITIES,
  SPIRIT_PREFERRED_PROVIDER,
  SPIRIT_PROACTIVE_TRIGGERS,
  type AgentRole,
  type ProactiveTriggerEvent,
  type ProactiveTriggerSpec,
  type SpiritFamily,
  type SpiritHandoff,
  type SpiritModelCategory,
} from "./orb-agent-roles";
import { APP_PAGE_REGISTRY, type AppPageRegistryItem } from "./appRegistry";
import { WORKFLOW_TEMPLATES, type WorkflowTemplate } from "./cross-modality-workflows";
import { AGENT_SKILL_REGISTRY, type AgentSkill } from "./agent-skills";
import { GLOBAL_AGENT_TOOL_REGISTRY, type GlobalAgentToolDefinition } from "./global-agent-tools";

// ─── 型別定義 ─────────────────────────────────────────────────────────────

/**
 * 大全分類 — 比 SlashCommandGroup 多了「頁面 / 接棒 / 主動觸發 / 家族」這
 * 些非指令性的能力。UI 依此排序顯示。
 */
export type CodexCategory =
  | "mode"          // 4 種代理模式 (auto / plan / nav / ask)
  | "spirit"        // 25 位精靈個人檔
  | "spirit-family" // 3 個精靈家族 (specialist / role / proactive)
  | "page"          // 站內頁面 + 它們的 quick actions
  | "quick-action"  // 頁面的 quickAction（每個成為獨立可搜尋條目）
  | "workflow"      // 跨模態工作流模板 (cross-modality-workflows)
  | "skill"         // 角色技能登記簿（每個 AgentRole 的 skill 視圖）
  | "tool"          // 148 個 server 端工具
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
    /** 若這個條目對應一個工作流模板，回 templateId。 */
    workflowTemplateId?: string;
    /** 若這個條目對應一個 quickAction，回 quickAction id + 母頁面路徑。 */
    quickAction?: { id: string; pagePath: string };
    /** 若這個條目對應一個 server 端工具，回工具名稱。 */
    toolName?: string;
    /** 若這個條目對應一個技能項，回 skill id (= AgentRole)。 */
    skillId?: AgentRole;
  };
  /**
   * 跨條目「請參考」連結 — 全部為其他 CodexEntry.id。生成期推導：
   *   - spirit ↔ 它的 handoffs / triggers / skill / 推薦頁面
   *   - page   ↔ 它的 quickActions
   *   - workflow ↔ 每步驟 spirit + 用到的 tools
   * UI 顯示在條目卡片底部的「相關」chip 列表。
   */
  related: readonly string[];
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

function entryIdForWorkflow(template: WorkflowTemplate): string {
  return `workflow#${template.templateId}`;
}

function entryIdForSkill(skill: AgentSkill): string {
  return `skill#${skill.id}`;
}

function entryIdForQuickAction(pagePath: string, quickActionId: string): string {
  // pagePath 可能含 "?section=xxx"；id 裡保留 raw path 用 base64 不必要，直接編碼
  return `qa#${pagePath.replace(/[^a-zA-Z0-9/_-]/g, "_")}::${quickActionId}`;
}

function entryIdForTool(toolName: string): string {
  return `tool#${toolName}`;
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
      related: [],
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
    const provider = SPIRIT_PREFERRED_PROVIDER[role];
    const modelCats = SPIRIT_MODEL_CAPABILITIES[role] ?? [];

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
      `偏好 LLM provider：\`${provider}\``,
      modelCats.length > 0
        ? `可呼叫模型類別（${modelCats.length}）：${modelCats.map(c => `\`${c}\``).join("、")}`
        : "",
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
      aliases: [
        spirit.nickname,
        role,
        `@${spirit.nickname}`,
        ...buildExtraSpiritAliases(role),
        // 把 provider 與模型類別當 alias 讓搜尋打得到
        provider,
        ...modelCats.map(c => String(c)),
      ],
      examples: [`/${spirit.command} 想做的事`, `@${spirit.nickname} 想做的事`],
      iconKey: spirit.command === "director" ? "workflow" : "sparkles",
      refs: {
        slashCommand: `/${spirit.command}`,
        spirit: role,
        family,
      },
      related: [],
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
      related: [],
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
      related: [],
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
      related: [],
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
        related: [],
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
    related: [],
  }));
}

function describeSurface(surface: ProactiveTriggerSpec["surface"]): string {
  switch (surface) {
    case "toast":    return "Toast（一閃而過）";
    case "inline":   return "Inline card（留在對話中）";
    case "blocking": return "Blocking dialog（必須處理）";
  }
}

// ─── 8. 工作流模板條目（6 個跨模態工作流） ─────────────────────────────────

function buildWorkflowEntries(): CodexEntry[] {
  const templates = Object.values(WORKFLOW_TEMPLATES);
  return templates.map(tpl => {
    const stepList = tpl.steps
      .map((s, i) => `${i + 1}. @${primaryNicknameOf(s.spirit)} — ${s.description}（${s.outputType}）`)
      .join("\n");
    const toolList = Array.from(new Set(tpl.steps.flatMap(s => s.tools))).slice(0, 12);
    const detailsParts = [
      tpl.description,
      `分類：${tpl.category}・難度：${tpl.difficulty}・步驟數：${tpl.steps.length}`,
      tpl.estimatedTotalDuration
        ? `預估總時長：${Math.round(tpl.estimatedTotalDuration / 1000)}s`
        : "",
      `步驟：\n${stepList}`,
      toolList.length > 0 ? `用到的工具：${toolList.map(t => `\`${t}\``).join("、")}` : "",
    ].filter(Boolean);
    return {
      id: entryIdForWorkflow(tpl),
      title: `工作流・${tpl.name}`,
      category: "workflow" as const,
      summary: tpl.description,
      details: detailsParts.join("\n\n"),
      aliases: [
        tpl.templateId,
        tpl.name,
        tpl.category,
        tpl.difficulty,
        ...tpl.tags,
      ],
      examples: [`/auto 跑這個工作流：${tpl.name}`, `/plan ${tpl.name}`],
      iconKey: "workflow",
      refs: { workflowTemplateId: tpl.templateId },
      related: [],
    };
  });
}

// ─── 9. 技能登記簿條目（每個 AgentRole 的 skill 視圖） ────────────────────

function buildSkillEntries(): CodexEntry[] {
  return AGENT_SKILL_REGISTRY.map(skill => {
    const role = skill.id;
    const nickname = primaryNicknameOf(role);
    const detailParts = [
      skill.description,
      `模態：${skill.modality}`,
      skill.recommendedPages.length > 0
        ? `推薦頁面：${skill.recommendedPages.map(p => `\`${p}\``).join("、")}`
        : "",
      skill.tools.length > 0
        ? `可呼叫的 server 工具（${skill.tools.length}）：${skill.tools.slice(0, 12).map(t => `\`${t}\``).join("、")}${skill.tools.length > 12 ? " …" : ""}`
        : "",
      skill.knowledgeDomains.length > 0
        ? `知識領域：${skill.knowledgeDomains.join("、")}`
        : "",
      skill.useCases.length > 0
        ? `使用場景：\n${skill.useCases.map(u => `· ${u}`).join("\n")}`
        : "",
      skill.chain.length > 0
        ? `預設角色鏈：${skill.chain.map(r => `@${primaryNicknameOf(r)}`).join(" → ")}`
        : "",
      skill.requiresPage ? "⚠️ 需要對應頁面才能執行" : "✅ 不需要特定頁面",
    ].filter(Boolean);
    return {
      id: entryIdForSkill(skill),
      title: `技能・${skill.displayName}（@${nickname}）`,
      category: "skill" as const,
      summary: skill.description,
      details: detailParts.join("\n\n"),
      aliases: [
        skill.id,
        skill.displayName,
        nickname,
        skill.modality,
        ...skill.knowledgeDomains,
        ...skill.tools,
      ],
      examples: skill.useCases.slice(0, 2).map(u => `@${nickname} ${u}`),
      iconKey: "sparkles",
      refs: { skillId: role, spirit: role },
      related: [],
    };
  });
}

// ─── 10. 頁面快捷動作（每個 quickAction → 獨立條目） ──────────────────────

function buildQuickActionEntries(): CodexEntry[] {
  const entries: CodexEntry[] = [];
  for (const page of APP_PAGE_REGISTRY) {
    for (const qa of page.quickActions) {
      const detailParts = [
        qa.description,
        `母頁面：${page.label}（\`${page.path}\`）`,
        qa.path ? `路徑：\`${qa.path}\`` : "",
        qa.prompt ? `預設提示：\n> ${qa.prompt}` : "",
        qa.action ? `動作類型：\`${qa.action.type}\`` : "",
      ].filter(Boolean);
      entries.push({
        id: entryIdForQuickAction(page.path, qa.id),
        title: `快捷・${qa.label}`,
        category: "quick-action" as const,
        summary: qa.description,
        details: detailParts.join("\n\n"),
        aliases: [qa.id, qa.label, page.label, page.id, ...page.aliases],
        examples: qa.prompt
          ? [qa.prompt]
          : qa.path
            ? [`/nav ${page.label}`]
            : [],
        iconKey: "sparkles",
        refs: {
          quickAction: { id: qa.id, pagePath: page.path },
          pagePath: page.path,
        },
        related: [],
      });
    }
  }
  return entries;
}

// ─── 11. server 端工具條目（148 個） ──────────────────────────────────────

function buildToolEntries(): CodexEntry[] {
  return GLOBAL_AGENT_TOOL_REGISTRY.map(tool => {
    const [prefix] = tool.name.split(".");
    const argNames = Object.keys(tool.allowedArgsSchema);
    const detailParts = [
      `工具名稱：\`${tool.name}\``,
      `風險級別：${describeRisk(tool.riskLevel)}`,
      `執行目標：${describeExecutionTarget(tool.executionTarget)}`,
      tool.requiresHuman ? "⚠️ 需要人工確認" : "✅ 可自動執行",
      argNames.length > 0
        ? `參數：${argNames.map(a => `\`${a}\``).join("、")}`
        : "（無參數）",
    ].filter(Boolean);
    return {
      id: entryIdForTool(tool.name),
      title: `工具・${tool.name}`,
      category: "tool" as const,
      summary: `${describeRisk(tool.riskLevel)} 風險的 ${prefix ?? "tool"} 工具，由 ${describeExecutionTarget(tool.executionTarget)} 執行`,
      details: detailParts.join("\n\n"),
      aliases: [tool.name, prefix ?? "", tool.riskLevel, tool.executionTarget],
      examples: [],
      iconKey: tool.riskLevel === "high" ? "trash-2" : "sparkles",
      refs: { toolName: tool.name },
      related: [],
    };
  });
}

function describeRisk(risk: GlobalAgentToolDefinition["riskLevel"]): string {
  switch (risk) {
    case "low":    return "低";
    case "medium": return "中";
    case "high":   return "高";
  }
}

function describeExecutionTarget(target: GlobalAgentToolDefinition["executionTarget"]): string {
  switch (target) {
    case "ui-only":           return "純前端 UI";
    case "server-side":       return "本站 server";
    case "claudeCode":        return "Claude Code 子代理";
    case "external-provider": return "外部 API 廠商";
  }
}

// ─── 主入口 ───────────────────────────────────────────────────────────────

let CODEX_CACHE: readonly CodexEntry[] | null = null;
let CODEX_INDEX_CACHE: SearchIndex | null = null;

/**
 * 完整大全 — 第一次呼叫時建構、跨條目連結、並快取。純函式但生成成本有點
 * 貴（要遍歷 SPIRIT_PROACTIVE_TRIGGERS / SPIRIT_COLLAB_PROTOCOL /
 * WORKFLOW_TEMPLATES / GLOBAL_AGENT_TOOL_REGISTRY），所以做了 lazy cache。
 */
export function getAllCodexEntries(): readonly CodexEntry[] {
  if (CODEX_CACHE) return CODEX_CACHE;
  const raw: CodexEntry[] = [
    ...buildModeEntries(),
    ...buildSpiritEntries(),
    ...buildFamilyEntries(),
    ...buildPageEntries(),
    ...buildOtherCommandEntries(),
    ...buildHandoffEntries(),
    ...buildTriggerEntries(),
    ...buildWorkflowEntries(),
    ...buildSkillEntries(),
    ...buildQuickActionEntries(),
    ...buildToolEntries(),
  ];
  const linked = linkRelatedEntries(raw);
  CODEX_CACHE = Object.freeze(linked);
  return CODEX_CACHE;
}

/**
 * 給 vitest 用 — 重設快取。
 */
export function _resetCodexCacheForTest(): void {
  CODEX_CACHE = null;
  CODEX_INDEX_CACHE = null;
}

// ─── 跨條目連結（related fields） ────────────────────────────────────────

/**
 * 為每個條目算出 `related` — 純 derivation，不需要外部資料。規則：
 *   - spirit  → 它的所有 handoff（in/out）+ trigger + skill + 推薦頁面 +
 *               對應 slash 指令 + 家族
 *   - handoff → from/to 兩個 spirit
 *   - trigger → spirit
 *   - page    → 它的所有 quickAction + 主動處理它的 specialist skill
 *   - quick-action → 母頁面 + 對應 spirit（若 action.type 對應某 spirit）
 *   - workflow → 步驟中所有 spirit + 用到的 tools
 *   - skill   → spirit + 推薦頁面 + 角色鏈裡其他 spirit
 *   - tool    → 用到此工具的 skill / workflow
 *   - mode    → 推薦相關精靈（director for plan, navigator for nav…）
 *   - family  → 所有同家族成員
 */
function linkRelatedEntries(raw: CodexEntry[]): CodexEntry[] {
  const byId = new Map(raw.map(e => [e.id, e]));
  // spirit → entry id
  const spiritEntryId = new Map<AgentRole, string>();
  for (const e of raw) {
    if (e.category === "spirit" && e.refs.spirit) {
      spiritEntryId.set(e.refs.spirit, e.id);
    }
  }
  // page → all quickAction ids
  const pageQuickActions = new Map<string, string[]>();
  for (const e of raw) {
    if (e.category === "quick-action" && e.refs.quickAction) {
      const list = pageQuickActions.get(e.refs.quickAction.pagePath) ?? [];
      list.push(e.id);
      pageQuickActions.set(e.refs.quickAction.pagePath, list);
    }
  }
  // page → entry id
  const pageEntryId = new Map<string, string>();
  for (const e of raw) {
    if (e.category === "page" && e.refs.pagePath) pageEntryId.set(e.refs.pagePath, e.id);
  }
  // tool → entry id
  const toolEntryId = new Map<string, string>();
  for (const e of raw) {
    if (e.category === "tool" && e.refs.toolName) toolEntryId.set(e.refs.toolName, e.id);
  }
  // family → spirit member entry ids
  const familyMembers = new Map<SpiritFamily, string[]>();
  for (const e of raw) {
    if (e.category === "spirit" && e.refs.family && e.refs.spirit) {
      const list = familyMembers.get(e.refs.family) ?? [];
      list.push(e.id);
      familyMembers.set(e.refs.family, list);
    }
  }

  // 把 raw 結凍前先解凍各 entry（reassign related 陣列）
  return raw.map(entry => {
    const related = new Set<string>();
    switch (entry.category) {
      case "spirit": {
        const role = entry.refs.spirit!;
        // 同精靈的 handoffs（含 out + in）、triggers、skill
        for (const e of raw) {
          if (e.category === "handoff" && (e.refs.handoff?.from === role || e.refs.handoff?.to === role)) {
            related.add(e.id);
          }
          if (e.category === "trigger" && e.refs.spirit === role) related.add(e.id);
          if (e.category === "skill" && e.refs.skillId === role) related.add(e.id);
        }
        // 推薦頁面（透過 skill 推導）
        const skill = AGENT_SKILL_REGISTRY.find(s => s.id === role);
        if (skill) {
          for (const path of skill.recommendedPages) {
            const pid = pageEntryId.get(path);
            if (pid) related.add(pid);
          }
        }
        // 家族
        if (entry.refs.family) {
          const fid = `family#${entry.refs.family}`;
          if (byId.has(fid)) related.add(fid);
        }
        break;
      }
      case "handoff": {
        const fromId = spiritEntryId.get(entry.refs.handoff!.from);
        const toId = spiritEntryId.get(entry.refs.handoff!.to);
        if (fromId) related.add(fromId);
        if (toId) related.add(toId);
        break;
      }
      case "trigger": {
        if (entry.refs.spirit) {
          const sid = spiritEntryId.get(entry.refs.spirit);
          if (sid) related.add(sid);
        }
        break;
      }
      case "page": {
        const path = entry.refs.pagePath!;
        for (const qaId of pageQuickActions.get(path) ?? []) related.add(qaId);
        // skill that 推薦此頁
        for (const skill of AGENT_SKILL_REGISTRY) {
          if (skill.recommendedPages.includes(path)) {
            const sid = spiritEntryId.get(skill.id);
            if (sid) related.add(sid);
          }
        }
        break;
      }
      case "quick-action": {
        const path = entry.refs.quickAction!.pagePath;
        const pid = pageEntryId.get(path);
        if (pid) related.add(pid);
        break;
      }
      case "workflow": {
        const tpl = WORKFLOW_TEMPLATES[entry.refs.workflowTemplateId!];
        if (tpl) {
          for (const step of tpl.steps) {
            const sid = spiritEntryId.get(step.spirit);
            if (sid) related.add(sid);
            for (const t of step.tools) {
              const tid = toolEntryId.get(t);
              if (tid) related.add(tid);
            }
          }
        }
        break;
      }
      case "skill": {
        const role = entry.refs.skillId!;
        const sid = spiritEntryId.get(role);
        if (sid) related.add(sid);
        const skill = AGENT_SKILL_REGISTRY.find(s => s.id === role);
        if (skill) {
          for (const path of skill.recommendedPages) {
            const pid = pageEntryId.get(path);
            if (pid) related.add(pid);
          }
          for (const r of skill.chain) {
            const ssid = spiritEntryId.get(r);
            if (ssid && ssid !== sid) related.add(ssid);
          }
          for (const t of skill.tools) {
            const tid = toolEntryId.get(t);
            if (tid) related.add(tid);
          }
        }
        break;
      }
      case "tool": {
        // 哪個 skill / workflow 用到這支工具
        const toolName = entry.refs.toolName!;
        for (const skill of AGENT_SKILL_REGISTRY) {
          if (skill.tools.includes(toolName)) {
            const sid = spiritEntryId.get(skill.id);
            if (sid) related.add(sid);
          }
        }
        for (const tpl of Object.values(WORKFLOW_TEMPLATES)) {
          if (tpl.steps.some(s => s.tools.includes(toolName))) {
            related.add(`workflow#${tpl.templateId}`);
          }
        }
        break;
      }
      case "mode": {
        // 各模式對應主要工作角色
        const SUGGEST_BY_MODE: Record<SlashCommandMode, AgentRole[]> = {
          "multi-step":  ["plan-executor", "director", "chief-orchestrator"],
          plan:          ["director", "accountant", "plan-executor"],
          navigate:      ["navigator", "onboarding-coach"],
          "ask-feature": ["companion", "learning-specialist"],
        };
        for (const r of SUGGEST_BY_MODE[entry.refs.mode!] ?? []) {
          const sid = spiritEntryId.get(r);
          if (sid) related.add(sid);
        }
        break;
      }
      case "spirit-family": {
        for (const sid of familyMembers.get(entry.refs.family!) ?? []) {
          related.add(sid);
        }
        break;
      }
      default:
        break;
    }
    related.delete(entry.id); // 不指向自己
    return { ...entry, related: Object.freeze(Array.from(related)) };
  });
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
  "quick-action": "頁面快捷",
  workflow:       "跨模態工作流",
  skill:          "角色技能",
  tool:           "Server 工具",
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
  "skill",
  "workflow",
  "page",
  "quick-action",
  "navigate",
  "action",
  "memory",
  "session",
  "help",
  "command",
  "handoff",
  "trigger",
  "tool",
];

/**
 * 取指定分類的條目。
 */
export function getCodexByCategory(category: CodexCategory): CodexEntry[] {
  return getAllCodexEntries().filter(e => e.category === category);
}

// ─── 同義詞展開 ───────────────────────────────────────────────────────────
//
// CJK ↔ 英文映射的小型表 — 讓使用者打「影片」也能命中 video / 視頻；
// 「成本」命中 預算 / 點數 / cost / budget。比對「token 是否在某 key 的
// 同義詞集合中」，命中則把整組同義詞當查詢使用（OR）。
//
// 只列出「使用者真的會誤打」的詞；超出本表的詞照舊走 substring 比對。
const SYNONYM_GROUPS: ReadonlyArray<readonly string[]> = [
  ["影片", "影像", "視頻", "video"],
  ["圖", "圖片", "圖像", "image", "picture"],
  ["音樂", "配樂", "bgm", "music"],
  ["語音", "配音", "voice", "tts", "speech"],
  ["成本", "預算", "點數", "credit", "cost", "budget", "spend"],
  ["品質", "quality", "高解析"],
  ["跳頁", "導航", "navigate", "nav"],
  ["計畫", "規劃", "plan"],
  ["大全", "compendium", "manual", "codex"],
  ["記憶", "偏好", "memory", "preference"],
  ["訓練", "lora", "training", "finetune"],
  ["解剖", "anatomy", "醫學", "醫療"],
  ["社群", "social", "ig", "instagram", "youtube", "facebook"],
  ["靈感", "inspiration", "創意"],
];

function expandWithSynonyms(token: string): string[] {
  const lower = token.toLowerCase();
  for (const group of SYNONYM_GROUPS) {
    if (group.some(g => g.toLowerCase() === lower)) {
      return Array.from(new Set([lower, ...group.map(g => g.toLowerCase())]));
    }
  }
  return [lower];
}

// ─── 倒排索引 ─────────────────────────────────────────────────────────────
//
// 結構：四個欄位（title / aliases / summary / details）分別建立 substring
// posting list。CJK 字元無法 token 化成「詞」，所以我們改用「2-gram 滑窗」
// 索引：對每個欄位的小寫文字，把所有長度 ≥ 1 的字元組合進索引。
//
// 查詢時對使用者輸入做同樣的 token 處理（同義詞展開後對每個 token 在四個
// 欄位上各查一次），匯總命中的條目 + 每欄位加權分數。
//
// 為了控制索引大小，我們只索引：
//   - 每個 alias / title token 的「整字串」（含 lowercase 整個）
//   - summary / details 的「3-gram 滑窗」（CJK 也適用）
// 這在 ~500 條目上能跑很快（< 5ms 查詢）。
type SearchField = "title" | "alias" | "summary" | "details";
interface FieldPosting {
  entryId: string;
  field: SearchField;
}
interface SearchIndex {
  /** ngram → posting list */
  byNgram: Map<string, FieldPosting[]>;
  /** entry id → entry（O(1) 拿回 entry） */
  byId: Map<string, CodexEntry>;
}

function buildSearchIndex(entries: readonly CodexEntry[]): SearchIndex {
  const byNgram = new Map<string, FieldPosting[]>();
  const byId = new Map<string, CodexEntry>();
  const NGRAM = 2; // 2-gram CJK + 英文都通用

  const addPosting = (key: string, entryId: string, field: SearchField) => {
    if (!key) return;
    const list = byNgram.get(key);
    if (list) {
      // 避免相同 entry+field 重複 push（同 ngram 在同欄位多次出現只記一筆）
      if (!list.some(p => p.entryId === entryId && p.field === field)) {
        list.push({ entryId, field });
      }
    } else {
      byNgram.set(key, [{ entryId, field }]);
    }
  };

  const indexText = (text: string, entryId: string, field: SearchField) => {
    const lower = text.toLowerCase();
    // 整個字串（包括 ASCII tokens）也進 index — 短 alias 才容易命中
    addPosting(lower, entryId, field);
    if (lower.length >= NGRAM) {
      for (let i = 0; i <= lower.length - NGRAM; i++) {
        const gram = lower.slice(i, i + NGRAM);
        addPosting(gram, entryId, field);
      }
    } else {
      addPosting(lower, entryId, field);
    }
  };

  for (const entry of entries) {
    byId.set(entry.id, entry);
    indexText(entry.title, entry.id, "title");
    for (const alias of entry.aliases) {
      if (alias) indexText(alias, entry.id, "alias");
    }
    indexText(entry.summary, entry.id, "summary");
    indexText(entry.details, entry.id, "details");
  }
  return { byNgram, byId };
}

function getSearchIndex(): SearchIndex {
  if (CODEX_INDEX_CACHE) return CODEX_INDEX_CACHE;
  CODEX_INDEX_CACHE = buildSearchIndex(getAllCodexEntries());
  return CODEX_INDEX_CACHE;
}

/**
 * 搜尋結果含命中欄位（給 UI 高亮 + ranking 提示用）。
 */
export interface SearchHit {
  entry: CodexEntry;
  score: number;
  /** 命中欄位（按權重排序）。 */
  matchedFields: readonly SearchField[];
}

/**
 * Fuzzy 搜尋（升級版）— 經倒排索引 + 同義詞展開的 O(tokens) 查詢。
 *
 *   - 空字串 → 全部
 *   - 多 token 用空白分隔；每個 token 經同義詞展開後做 OR；token 之間是 AND
 *   - 對每個 token 走 2-gram 倒排索引快速找到所有候選 entry
 *   - 排名：title prefix > title substring > alias exact > alias prefix >
 *     summary > details，多 token 線性加總；後扣分項是 entry.details 長度
 *     超過 200 時略降一點（避免無關大段條目浮上來）
 *
 * @returns CodexEntry[]（向後相容；若要 score / matchedFields，用 searchCodexDetailed）
 */
export function searchCodex(query: string, limit = 50): CodexEntry[] {
  return searchCodexDetailed(query, limit).map(h => h.entry);
}

export function searchCodexDetailed(query: string, limit = 50): SearchHit[] {
  const q = (query ?? "").trim();
  if (!q) {
    return getAllCodexEntries()
      .slice(0, limit)
      .map(entry => ({ entry, score: 0, matchedFields: [] as readonly SearchField[] }));
  }
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return getAllCodexEntries()
      .slice(0, limit)
      .map(entry => ({ entry, score: 0, matchedFields: [] as readonly SearchField[] }));
  }

  const index = getSearchIndex();
  const FIELD_WEIGHT: Record<SearchField, number> = {
    title: 12,
    alias: 8,
    summary: 4,
    details: 1,
  };

  // 每個 token 做「同義詞展開後 OR」匯總一個 candidate set
  function candidatesForToken(token: string): Map<string, Set<SearchField>> {
    const variants = expandWithSynonyms(token);
    const hits = new Map<string, Set<SearchField>>(); // entryId → fields
    for (const v of variants) {
      // 找與 v 完全相同的 ngram；以及對 v 做 2-gram 拆分後 ALL 必須命中
      const NGRAM = 2;
      const need: string[] = [];
      if (v.length < NGRAM) {
        need.push(v);
      } else {
        for (let i = 0; i <= v.length - NGRAM; i++) {
          need.push(v.slice(i, i + NGRAM));
        }
      }
      // 對每個 ngram 取 posting list；AND 起來
      let candidateIds: Map<string, Set<SearchField>> | null = null;
      for (const gram of need) {
        const postings = index.byNgram.get(gram);
        if (!postings) {
          candidateIds = new Map();
          break;
        }
        const fresh = new Map<string, Set<SearchField>>();
        for (const p of postings) {
          if (candidateIds === null || candidateIds.has(p.entryId)) {
            const fields = fresh.get(p.entryId) ?? new Set<SearchField>();
            fields.add(p.field);
            // 把上一輪累積的也帶進來
            if (candidateIds) {
              for (const f of candidateIds.get(p.entryId) ?? []) fields.add(f);
            }
            fresh.set(p.entryId, fields);
          }
        }
        candidateIds = fresh;
      }
      // 二次驗證：用整段字串 substring 比對（避免 2-gram 的偽命中）
      if (candidateIds) {
        for (const [eid, fields] of candidateIds) {
          const entry = index.byId.get(eid);
          if (!entry) continue;
          const inTitle   = entry.title.toLowerCase().includes(v);
          const inAlias   = entry.aliases.some(a => a.toLowerCase().includes(v));
          const inSummary = entry.summary.toLowerCase().includes(v);
          const inDetails = entry.details.toLowerCase().includes(v);
          if (!inTitle && !inAlias && !inSummary && !inDetails) continue;
          const merged = hits.get(eid) ?? new Set<SearchField>();
          if (inTitle) merged.add("title");
          if (inAlias) merged.add("alias");
          if (inSummary) merged.add("summary");
          if (inDetails) merged.add("details");
          // 也保留 ngram-推導的 field 來源（更寬鬆）
          for (const f of fields) merged.add(f);
          hits.set(eid, merged);
        }
      }
    }
    return hits;
  }

  // 多 token：AND（每個 token 都要有命中）
  let working: Map<string, Set<SearchField>> | null = null;
  for (const token of tokens) {
    const hits = candidatesForToken(token);
    if (working === null) {
      working = hits;
    } else {
      const merged = new Map<string, Set<SearchField>>();
      for (const [eid, fields] of working) {
        if (hits.has(eid)) {
          const all = new Set<SearchField>([...fields, ...(hits.get(eid) ?? [])]);
          merged.set(eid, all);
        }
      }
      working = merged;
    }
    if (working.size === 0) break;
  }
  if (!working) return [];

  // 計分
  const results: SearchHit[] = [];
  for (const [eid, fields] of working) {
    const entry = index.byId.get(eid);
    if (!entry) continue;
    let score = 0;
    for (const field of fields) {
      score += FIELD_WEIGHT[field];
    }
    // bonus：title 開頭命中第一個 token
    if (
      tokens.length > 0 &&
      entry.title.toLowerCase().startsWith(tokens[0]!)
    ) {
      score += 10;
    }
    // bonus：alias 完全等於某 token
    if (tokens.some(t => entry.aliases.some(a => a.toLowerCase() === t))) {
      score += 6;
    }
    // 略降長 details
    if (entry.details.length > 200 && !fields.has("title") && !fields.has("alias")) {
      score -= 2;
    }
    results.push({
      entry,
      score,
      matchedFields: Array.from(fields).sort(
        (a, b) => FIELD_WEIGHT[b] - FIELD_WEIGHT[a]
      ),
    });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
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
  skill: CodexEntry | null;
  recommendedPages: CodexEntry[];
} {
  const all = getAllCodexEntries();
  const spirit = all.find(e => e.refs.spirit === role && e.category === "spirit") ?? null;
  const handoffsOut = all.filter(e => e.category === "handoff" && e.refs.handoff?.from === role);
  const handoffsIn  = all.filter(e => e.category === "handoff" && e.refs.handoff?.to === role);
  const triggers    = all.filter(e => e.category === "trigger" && e.refs.spirit === role);
  const skill       = all.find(e => e.category === "skill" && e.refs.skillId === role) ?? null;
  const skillDef    = AGENT_SKILL_REGISTRY.find(s => s.id === role);
  const recommendedPaths = new Set(skillDef?.recommendedPages ?? []);
  const recommendedPages = all.filter(
    e => e.category === "page" && e.refs.pagePath && recommendedPaths.has(e.refs.pagePath)
  );
  return { spirit, handoffsOut, handoffsIn, triggers, skill, recommendedPages };
}

/**
 * 取單一條目的「相關」清單（解析 entry.related id list → entries）。
 * UI 在條目卡片底部顯示「相關」chip 時用。
 */
export function getRelatedEntries(id: string, limit = 12): CodexEntry[] {
  const entry = getCodexEntry(id);
  if (!entry) return [];
  const all = getAllCodexEntries();
  const byId = new Map(all.map(e => [e.id, e]));
  const result: CodexEntry[] = [];
  for (const rel of entry.related) {
    const e = byId.get(rel);
    if (e) result.push(e);
    if (result.length >= limit) break;
  }
  return result;
}

/**
 * 取所有「對應到某精靈」的條目（spirit、handoff in/out、trigger、skill）。
 * 跟 getSpiritFullProfile 不同：這個回傳「扁平 entry 清單」適合搜尋頁面。
 */
export function getEntriesBySpirit(role: AgentRole): CodexEntry[] {
  return getAllCodexEntries().filter(
    e =>
      e.refs.spirit === role ||
      e.refs.handoff?.from === role ||
      e.refs.handoff?.to === role ||
      e.refs.skillId === role
  );
}

/**
 * 取所有「對應到某頁面」的條目（page + 它的 quickActions）。
 */
export function getEntriesByPage(pagePath: string): CodexEntry[] {
  return getAllCodexEntries().filter(
    e => e.refs.pagePath === pagePath || e.refs.quickAction?.pagePath === pagePath
  );
}

/**
 * 「今日特輯」— 用 (seed % length) 從整本大全挑一條展示用。預設用日期當
 * seed 讓每天都看同一條，到隔天才換。可傳自訂 seed 給 SSR / 測試用。
 */
export function pickFeatureOfTheDay(seed?: number): CodexEntry | null {
  const all = getAllCodexEntries();
  if (all.length === 0) return null;
  const s = seed ?? (() => {
    const now = new Date();
    return now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  })();
  return all[Math.abs(s) % all.length] ?? null;
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
  source:
    | "SLASH_COMMANDS"
    | "SPIRIT_COMMANDS"
    | "APP_PAGE_REGISTRY"
    | "SPIRIT_COLLAB_PROTOCOL"
    | "SPIRIT_PROACTIVE_TRIGGERS"
    | "WORKFLOW_TEMPLATES"
    | "AGENT_SKILL_REGISTRY"
    | "GLOBAL_AGENT_TOOL_REGISTRY"
    | "APP_PAGE_QUICK_ACTIONS";
  id: string;
  reason: string;
}

export function auditCodexCoverage(): CoverageGap[] {
  const gaps: CoverageGap[] = [];
  const all = getAllCodexEntries();
  const slashIds = new Set(all.filter(e => e.refs.slashCommand).map(e => e.refs.slashCommand!));
  const spiritIds = new Set(all.filter(e => e.refs.spirit && e.category === "spirit").map(e => e.refs.spirit!));
  const pageIds = new Set(all.filter(e => e.refs.pagePath && e.category === "page").map(e => e.refs.pagePath!));
  const workflowIds = new Set(all.filter(e => e.refs.workflowTemplateId).map(e => e.refs.workflowTemplateId!));
  const skillIds = new Set(all.filter(e => e.refs.skillId).map(e => e.refs.skillId!));
  const toolIds = new Set(all.filter(e => e.refs.toolName).map(e => e.refs.toolName!));
  const qaKeys = new Set(
    all
      .filter(e => e.refs.quickAction)
      .map(e => `${e.refs.quickAction!.pagePath}::${e.refs.quickAction!.id}`)
  );

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
    for (const qa of page.quickActions) {
      const key = `${page.path}::${qa.id}`;
      if (!qaKeys.has(key)) {
        gaps.push({
          source: "APP_PAGE_QUICK_ACTIONS",
          id: key,
          reason: `頁面 ${page.label} 的 quickAction "${qa.label}" 沒有對應的 codex entry`,
        });
      }
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
  // 工作流模板
  for (const tpl of Object.values(WORKFLOW_TEMPLATES)) {
    if (!workflowIds.has(tpl.templateId)) {
      gaps.push({
        source: "WORKFLOW_TEMPLATES",
        id: tpl.templateId,
        reason: `工作流 ${tpl.name}(${tpl.templateId}) 沒有對應的 codex entry`,
      });
    }
  }
  // 技能登記簿
  for (const skill of AGENT_SKILL_REGISTRY) {
    if (!skillIds.has(skill.id)) {
      gaps.push({
        source: "AGENT_SKILL_REGISTRY",
        id: skill.id,
        reason: `技能 ${skill.displayName}(${skill.id}) 沒有對應的 codex entry`,
      });
    }
  }
  // server 端工具
  for (const tool of GLOBAL_AGENT_TOOL_REGISTRY) {
    if (!toolIds.has(tool.name)) {
      gaps.push({
        source: "GLOBAL_AGENT_TOOL_REGISTRY",
        id: tool.name,
        reason: `工具 ${tool.name} 沒有對應的 codex entry`,
      });
    }
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
