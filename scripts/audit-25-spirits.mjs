#!/usr/bin/env node
/**
 * scripts/audit-25-spirits.mjs
 *
 * 模擬「真實全站光球代理互動」：把使用者的一句話從入口
 *   1. selectRoleForIntent       ─ 決定哪位精靈接手
 *   2. getChatToolForSpirit      ─ 該精靈對話框內走哪條工具
 *   3. 依 tool kind 合成真實 wire payload
 *      - fal-generation  → trpc.spirit.invoke({...})
 *      - navigate        → AgentAction { type: "navigate", path }
 *      - search          → trpc.orbProxy.unifiedSearch({ query })
 *      - agent-plan      → trpc.spirit.plan({ goal })  + 輪詢 status
 *      - page-execution  → composer 解析成 AgentAction[] 並 dispatch
 *      - llm-persona     → LLM stream 套 role-slice system prompt
 *   4. 印出一行 trace（不打網路）+ 累積覆蓋率
 *
 * 目標：把 25 位精靈每一位都「吃」過一輪，並驗證每一位確實能被光球代
 * 理夾住對應的工具。任何一位掉到 companion fallback 或撞到別人都算失敗。
 *
 * 跑：npx tsx scripts/audit-25-spirits.mjs
 *     或 npm run audit:spirits
 */
import { selectRoleForIntent, getPrimaryNicknameForRole } from "../shared/orb-agent-roles.ts";
import { SPIRIT_CHAT_TOOLS, getChatToolForSpirit } from "../shared/spirit-chat-tools.ts";

// ─── 25 位精靈 ─ 排序與 SpiritFamily 一致 ─────────────────────────
const ALL_25 = [
  // 8 specialist
  "image-specialist", "video-specialist", "music-specialist", "voice-specialist",
  "training-specialist", "learning-specialist", "inspiration-specialist", "anatomy-specialist",
  // 6 generic role
  "director", "composer", "critic", "researcher", "navigator", "companion",
  // 3 proactive
  "accountant", "quality-coach", "inspector",
  // 8 新增
  "legal-advisor", "security-guard", "community-manager", "chief-orchestrator",
  "onboarding-coach", "notes-curator", "settings-detail", "plan-executor",
];

const STUDIO_SNAPSHOT = {
  pagePath: "/image-studio",
  pageId: "image-studio",
  pageLabel: "影像工作室",
  capabilities: [
    { action: "fillPrompt" }, { action: "setModel" }, { action: "setParam" },
    { action: "submit" }, { action: "reset" },
  ],
};

// 每位精靈一段真實風格的使用者輸入。natural = 靠關鍵字 rule 命中；
// mentioned = 用 @暱稱 強制命中（光球協議首選的呼叫方式）。
const SCENARIOS = [
  // ─── 8 specialist ────────────────────────────────────────────
  { spirit: "image-specialist",     style: "natural",  utterance: "畫一張夕陽下的少女側臉，電影感，35mm 底片質感" },
  { spirit: "video-specialist",     style: "natural",  utterance: "做一段 5 秒的短影片，城市夜景帶霓虹" },
  { spirit: "music-specialist",     style: "natural",  utterance: "幫我寫一段 lo-fi 風格的背景音樂，90 秒" },
  { spirit: "voice-specialist",     style: "natural",  utterance: "我要 voice cloning 我的聲音念這段旁白" },
  { spirit: "training-specialist",  style: "natural",  utterance: "幫我訓練一個角色 LoRA，30 步即可" },
  { spirit: "learning-specialist",  style: "natural",  utterance: "教我怎麼開始做影片" },
  { spirit: "inspiration-specialist", style: "mention", utterance: "@靈靈 幫我蒐集賽博龐克的視覺靈感板" },
  { spirit: "anatomy-specialist",   style: "mention",  utterance: "@體體 幫我畫一張手部肌肉的解剖圖" },

  // ─── 6 generic role ─────────────────────────────────────────
  { spirit: "director",   style: "natural", utterance: "幫我規劃一個從腳本到影片到配樂的完整工作流" },
  { spirit: "composer",   style: "natural", utterance: "再來一張", snapshot: STUDIO_SNAPSHOT },
  { spirit: "critic",     style: "natural", utterance: "這個提示詞幫我改一下，再好一點" },
  { spirit: "researcher", style: "natural", utterance: "查一下 Veo 3 的最新規格" },
  { spirit: "navigator",  style: "natural", utterance: "帶我去個人設定頁面" },
  { spirit: "companion",  style: "natural", utterance: "嗨" },

  // ─── 3 proactive ────────────────────────────────────────────
  { spirit: "accountant",    style: "mention", utterance: "@財財 這個月生圖花了多少點數？" },
  { spirit: "quality-coach", style: "natural", utterance: "這張圖品質很差，畫面糊糊的怎麼辦" },
  { spirit: "inspector",     style: "mention", utterance: "@守守 幫我巡邏一下站內有沒有壞掉的連結" },

  // ─── 8 新增 ────────────────────────────────────────────────
  { spirit: "legal-advisor",       style: "mention", utterance: "@律律 用真人照片訓練 LoRA 會有版權問題嗎？" },
  { spirit: "security-guard",      style: "mention", utterance: "@安安 我的帳號好像被陌生 IP 登入了" },
  { spirit: "community-manager",   style: "mention", utterance: "@群群 25-34 歲族群最近在 IG 上喜歡什麼風格？" },
  { spirit: "chief-orchestrator",  style: "mention", utterance: "@總總 幫我看一下團隊現在的任務狀態" },
  { spirit: "onboarding-coach",    style: "mention", utterance: "@帶帶 我第一次用，從哪開始？" },
  { spirit: "notes-curator",       style: "mention", utterance: "@記記 把這段提示詞存成筆記" },
  { spirit: "settings-detail",     style: "mention", utterance: "@細細 把預設模型改成 Flux Schnell" },
  { spirit: "plan-executor",       style: "mention", utterance: "@步步 幫我從腳本到上稿一條龍跑完" },
];

// 完整性檢查：25 個 SCENARIOS 對應 25 個 AgentRole
if (SCENARIOS.length !== ALL_25.length) {
  console.error(`✗ SCENARIOS 數量 (${SCENARIOS.length}) ≠ 25`);
  process.exit(1);
}
const scenarioRoles = new Set(SCENARIOS.map(s => s.spirit));
const missing = ALL_25.filter(r => !scenarioRoles.has(r));
if (missing.length > 0) {
  console.error("✗ 缺少 scenario：", missing);
  process.exit(1);
}

// ─── 模擬光球代理：把一條使用者輸入跑完整條 pipeline ────────────
function stripMention(text) {
  // 拿掉 @暱稱 與隨後一個空白，模擬客戶端 cleanPrompt 的處理。
  return text.replace(/^@\S+\s*/, "").trim();
}

function detectNavIntent(prompt) {
  if (/設定|偏好|個人/.test(prompt)) return "/account-settings";
  if (/儀表板|首頁|dashboard/i.test(prompt)) return "/dashboard";
  if (/筆記/.test(prompt)) return "/notes";
  return "/";
}

function simulateProxy(role, utterance, snapshot) {
  const tool = getChatToolForSpirit(role);
  const cleanPrompt = stripMention(utterance);

  switch (tool.kind) {
    case "fal-generation": {
      const tooShort = cleanPrompt.length < tool.minPromptChars;
      const wire = {
        endpoint: "trpc.spirit.invoke",
        input: { spirit: role, prompt: cleanPrompt },
      };
      const note = tooShort
        ? `(prompt 太短 < ${tool.minPromptChars} 字 → fall through 到 LLM 人格)`
        : "→ 真實打 fal.ai 模型，回 FalDispatchResult";
      return { wire, note };
    }
    case "navigate": {
      const path = tool.toPath
        ?? (tool.intentBased ? detectNavIntent(cleanPrompt) : "/");
      const finalPath = tool.passPromptAsSearch && cleanPrompt
        ? `${path}?search=${encodeURIComponent(cleanPrompt)}`
        : path;
      const wire = {
        action: { type: "navigate", path: finalPath },
        chatHint: tool.arrivalHint,
      };
      return { wire, note: `→ 客戶端 dispatch navigate to ${finalPath}` };
    }
    case "search": {
      const tooShort = cleanPrompt.length < tool.minPromptChars;
      const wire = {
        endpoint: "trpc.orbProxy.unifiedSearch",
        input: { query: cleanPrompt, types: ["asset", "note", "history", "tutorial"] },
      };
      const note = tooShort
        ? `(query 太短 < ${tool.minPromptChars} 字 → fall through 到 LLM 人格)`
        : "→ 打 unifiedSearch 並把 items 秀回對話框";
      return { wire, note };
    }
    case "agent-plan": {
      const tooShort = cleanPrompt.length < tool.minPromptChars;
      if (tooShort) {
        return {
          wire: { fallthrough: "llm-persona", reason: `< ${tool.minPromptChars} 字` },
          note: "→ 太短當閒聊，fall through LLM",
        };
      }
      const wire = {
        step1: { endpoint: "trpc.spirit.plan", input: { goal: cleanPrompt, maxSteps: 8 } },
        step2: { uiCard: "預演 PlanRecord，按▶開跑 → trpc.spirit.run" },
        step3: { polling: "每 1.5s trpc.spirit.status 直到 done/failed" },
      };
      return { wire, note: "→ 真實 plan + run + status 輪詢" };
    }
    case "page-execution": {
      if (!snapshot || snapshot.capabilities.length === 0) {
        return {
          wire: { fallthrough: "llm-persona", reason: "沒站在 studio 頁" },
          note: "→ 提示先去 /image-studio /video-studio /pro-studio",
        };
      }
      // 真實客戶端會用 imperativeParser 解析；這裡用一條簡化規則模擬。
      const actions = /再來一張|再生|另一張/.test(cleanPrompt)
        ? [{ type: "submit" }]
        : /改成|換成/.test(cleanPrompt)
          ? [{ type: "setParam" }]
          : [];
      const wire = actions.length > 0
        ? { actions, dispatchVia: "executeActions(pageHandle)" }
        : { fallthrough: "llm-persona", reason: "parser 解不出 actions" };
      return {
        wire,
        note: actions.length > 0
          ? `→ 真實 dispatch 在 ${snapshot.pageId} 頁，actions: [${actions.map(a => a.type).join(", ")}]`
          : "→ LLM 接手出 actions JSON 或反問",
      };
    }
    case "llm-persona": {
      const wire = {
        endpoint: "trpc.ai.chat (stream)",
        systemPromptSlice: `roleSlice(${role})`,
        userMessage: cleanPrompt,
      };
      return { wire, note: `→ LLM stream，套 ${role} 人格切片` };
    }
  }
}

// ─── 跑 ─────────────────────────────────────────────────────
console.log("\n════════ 25 精靈 × 全站光球代理模擬 ════════\n");
console.log(`場景數：${SCENARIOS.length}  精靈總數：${ALL_25.length}\n`);

const eaten = new Set();
const failures = [];
let pass = 0;
let fall = 0;

for (const sc of SCENARIOS) {
  const sel = selectRoleForIntent({
    text: sc.utterance,
    snapshot: sc.snapshot ?? null,
  });
  const matched = sel.role === sc.spirit;
  const { wire, note } = simulateProxy(sel.role, sc.utterance, sc.snapshot ?? null);
  const tool = getChatToolForSpirit(sel.role);
  const nick = getPrimaryNicknameForRole(sel.role) ?? sel.role;
  const expectedNick = getPrimaryNicknameForRole(sc.spirit) ?? sc.spirit;

  const mark = matched ? "✅" : "❌";
  console.log(`${mark} [${sc.style.padEnd(7)}] expect=${expectedNick}(${sc.spirit})`);
  console.log(`    utter: "${sc.utterance}"`);
  console.log(`    route: → ${nick}(${sel.role}) [conf=${sel.confidence.toFixed(2)}, ${sel.rationale}]`);
  console.log(`    tool : ${tool.kind}`);
  console.log(`    wire : ${JSON.stringify(wire)}`);
  console.log(`    sim  : ${note}`);
  console.log();

  if (matched) {
    pass++;
    eaten.add(sc.spirit);
  } else {
    failures.push({ scenario: sc, got: sel.role });
    if (sel.role === "companion") fall++;
  }
}

// ─── 報表 ────────────────────────────────────────────────────
console.log("════════ 覆蓋率 ════════");
const uneaten = ALL_25.filter(r => !eaten.has(r));
console.log(`已吃 (路由正確命中)：${eaten.size}/25`);
console.log(`未吃：${uneaten.length}  ${uneaten.length ? "→ " + uneaten.join(", ") : ""}`);
console.log(`掉到 companion fallback：${fall}`);
console.log(`Pass / Total：${pass}/${SCENARIOS.length}`);

if (failures.length) {
  console.log("\n失敗詳情：");
  for (const f of failures) {
    console.log(`  ❌ "${f.scenario.utterance}"`);
    console.log(`     expected=${f.scenario.spirit}  got=${f.got}`);
  }
}

// ─── 工具 kind 分佈 ──────────────────────────────────────────
console.log("\n════════ Tool Kind 分佈（25 位精靈）════════");
const kindCount = {};
for (const role of ALL_25) {
  const kind = SPIRIT_CHAT_TOOLS[role].kind;
  kindCount[kind] = (kindCount[kind] ?? 0) + 1;
}
for (const [kind, n] of Object.entries(kindCount).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${kind.padEnd(18)} ${n}`);
}

// ─── exit code ───────────────────────────────────────────────
if (eaten.size === 25 && failures.length === 0) {
  console.log("\n✓ 全 25 位精靈已被全站光球代理吃過一輪。");
  process.exit(0);
} else {
  console.log("\n✗ 還有精靈沒吃到或路由錯誤，請修 SCENARIOS 或 KEYWORD_RULES。");
  process.exit(1);
}
