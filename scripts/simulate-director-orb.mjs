#!/usr/bin/env node
/**
 * scripts/simulate-director-orb.mjs
 *
 * 模擬「導演 AI × 全站光球代理 × 25 精靈」的完整互動鏈：
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ 1) 使用者送一句創作 brief 進 AI Director（/director）        │
 *   │ 2) 導演展開成 N 個 sub-task（多鏡頭 + 多模態 + 跨頁工作流）   │
 *   │ 3) 每個 sub-task 走全站光球代理：                            │
 *   │      selectRoleForIntent → getChatToolForSpirit → wire        │
 *   │ 4) 每一條印出 TIMELINE row（推論藍圖時間軸）                  │
 *   │ 5) 收尾報表：25 位精靈是否都被導演夾住、tool 分佈、估時 / 估點 │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * 跟 scripts/audit-25-spirits.mjs 的差別：
 *   - 那條把導演當成 25 位裡的一位，逐位驗證路由；
 *   - 這條把導演升格成「總指揮」，由一個 brief 自行展開 sub-task，
 *     然後從 brief 端到 25 條 wire 全部跑一遍（更貼近圖中設計）。
 *
 * 跑：npx tsx scripts/simulate-director-orb.mjs
 *     或 npm run audit:director-orb
 */
import { selectRoleForIntent, getPrimaryNicknameForRole } from "../shared/orb-agent-roles.ts";
import { SPIRIT_CHAT_TOOLS, getChatToolForSpirit } from "../shared/spirit-chat-tools.ts";

// ─── 0. 使用者送進導演 AI 的一句 brief（與 AI Director 截圖一致）──
const USER_BRIEF =
  "夕陽下的少女側臉、電影感、淺景深、35mm 底片質感";

// ─── 1. 導演 AI 的展開：把 brief 拆成 sub-task ─────────────────
// 每個 sub-task 同時帶兩件事：
//   utterance — 模擬導演發給光球代理的那一句話（會跑 selectRoleForIntent）
//   expect    — 預期會被哪位精靈接住
//   snapshot  — 模擬導演當下站在哪個頁面（影響 composer / page-execution）
const STUDIO_SNAPSHOT = {
  pagePath: "/image-studio",
  pageId: "image-studio",
  pageLabel: "影像工作室",
  capabilities: [
    { action: "fillPrompt" }, { action: "setModel" }, { action: "setParam" },
    { action: "submit" }, { action: "reset" },
  ],
};

const DIRECTOR_PLAN = [
  // ── A. 多鏡頭主視覺（圖中代理生成型 CU / MS / WS / BTS）────────
  {
    shot: "CU",  // close-up
    utterance: `畫一張${USER_BRIEF}，特寫鏡頭、臉部光影、皮膚紋理`,
    expect: "image-specialist",
    intent: "主視覺 close-up",
  },
  {
    shot: "MS",  // medium shot
    utterance: `畫一張${USER_BRIEF}，半身鏡頭、肩膀以上、構圖留白`,
    expect: "image-specialist",
    intent: "主視覺 medium",
  },
  {
    shot: "WS",  // wide shot
    utterance: `畫一張${USER_BRIEF}，全景遠鏡頭、夕陽地平線、孤獨感`,
    expect: "image-specialist",
    intent: "主視覺 wide",
  },
  {
    shot: "BTS", // behind the scenes / variant
    utterance: `畫一張${USER_BRIEF}，幕後花絮風格、底片刮痕、自然光`,
    expect: "image-specialist",
    intent: "主視覺 BTS variant",
  },

  // ── B. 故事化展開：影 / 音 / 旁白 / LoRA ─────────────────────
  { utterance: "做一段 5 秒的短影片，夕陽少女側臉，鏡頭緩慢推近", expect: "video-specialist", intent: "影片延伸" },
  { utterance: "幫我寫一段 lo-fi 風格的背景音樂，90 秒，柔和", expect: "music-specialist", intent: "配樂" },
  { utterance: "我要 voice cloning 我的聲音念這段旁白：「她看著夕陽，沒有說話」", expect: "voice-specialist", intent: "旁白配音" },
  { utterance: "幫我訓練一個少女角色 LoRA，30 步即可", expect: "training-specialist", intent: "角色 LoRA" },

  // ── C. 靈感 / 解剖 / 教學 / 查資料 ─────────────────────────
  { utterance: "@靈靈 幫我蒐集賽博龐克 × 夕陽美學的視覺靈感板", expect: "inspiration-specialist", intent: "靈感蒐集" },
  { utterance: "@體體 幫我畫一張側臉肌肉的解剖圖", expect: "anatomy-specialist", intent: "解剖參考" },
  { utterance: "教我怎麼開始做影片", expect: "learning-specialist", intent: "教學引導" },
  { utterance: "查一下 Veo 3 的最新規格", expect: "researcher", intent: "規格研究" },

  // ── D. 跨頁導航 / 當頁執行 / 整體規劃 ───────────────────────
  { utterance: "帶我去個人設定頁面", expect: "navigator", intent: "跨頁跳轉" },
  { utterance: "再來一張", expect: "composer", snapshot: STUDIO_SNAPSHOT, intent: "當頁再生" },
  { utterance: "幫我規劃一個從腳本到影片到配樂的完整工作流", expect: "director", intent: "工作流規劃" },
  { utterance: "這個提示詞幫我改一下，再好一點", expect: "critic", intent: "提示詞改寫" },
  { utterance: "嗨", expect: "companion", intent: "閒聊保底" },

  // ── E. 主動型 3 位（財財 / 巧巧 / 守守）─────────────────────
  { utterance: "@財財 這個月生圖花了多少點數？", expect: "accountant", intent: "預算盤點" },
  { utterance: "這張圖品質很差，畫面糊糊的怎麼辦", expect: "quality-coach", intent: "品質教練" },
  { utterance: "@守守 幫我巡邏一下站內有沒有壞掉的連結", expect: "inspector", intent: "站內巡邏" },

  // ── F. 新增 8 位（律律 / 安安 / 群群 / 總總 / 帶帶 / 記記 / 細細 / 步步）──
  { utterance: "@律律 用真人照片訓練 LoRA 會有版權問題嗎？", expect: "legal-advisor", intent: "法律諮詢" },
  { utterance: "@安安 我的帳號好像被陌生 IP 登入了", expect: "security-guard", intent: "資安檢查" },
  { utterance: "@群群 25-34 歲族群最近在 IG 上喜歡什麼風格？", expect: "community-manager", intent: "社群策略" },
  { utterance: "@總總 幫我看一下團隊現在的任務狀態", expect: "chief-orchestrator", intent: "總指揮" },
  { utterance: "@帶帶 我第一次用，從哪開始？", expect: "onboarding-coach", intent: "新手輔導" },
  { utterance: "@記記 把這段提示詞存成筆記", expect: "notes-curator", intent: "筆記歸檔" },
  { utterance: "@細細 把預設模型改成 Flux Schnell", expect: "settings-detail", intent: "設定微調" },
  { utterance: "@步步 幫我從腳本到上稿一條龍跑完", expect: "plan-executor", intent: "自動執行" },
];

// 25 位 AgentRole 必須完全被導演計畫覆蓋。
const ALL_25 = [
  "image-specialist", "video-specialist", "music-specialist", "voice-specialist",
  "training-specialist", "learning-specialist", "inspiration-specialist", "anatomy-specialist",
  "director", "composer", "critic", "researcher", "navigator", "companion",
  "accountant", "quality-coach", "inspector",
  "legal-advisor", "security-guard", "community-manager", "chief-orchestrator",
  "onboarding-coach", "notes-curator", "settings-detail", "plan-executor",
];

const planRoles = new Set(DIRECTOR_PLAN.map(s => s.expect));
const missing = ALL_25.filter(r => !planRoles.has(r));
if (missing.length > 0) {
  console.error("✗ 導演計畫缺少 spirits：", missing);
  process.exit(1);
}

// ─── 2. 光球代理：把一條 sub-task 跑完整條 pipeline ─────────────
function stripMention(text) {
  return text.replace(/^@\S+\s*/, "").trim();
}
function detectNavIntent(prompt) {
  if (/設定|偏好|個人/.test(prompt)) return "/account-settings";
  if (/儀表板|首頁|dashboard/i.test(prompt)) return "/dashboard";
  if (/筆記/.test(prompt)) return "/notes";
  return "/";
}

// 每個 tool kind 的「典型延遲」（毫秒）— 估算 TIMELINE 用，不打網路。
const TYPICAL_LATENCY_MS = {
  "fal-generation":  6000, // 6s 一張圖 / 一段音
  "navigate":          80, // 純客戶端跳頁
  "search":           600, // unifiedSearch 一次
  "agent-plan":      1200, // plan 階段（不含執行）
  "page-execution":   200, // parser + dispatch
  "llm-persona":     1800, // LLM stream first-token + tail
};

// 每個 tool kind 的「典型點數」— 與站內 credit table 量級對齊。
const TYPICAL_CREDITS = {
  "fal-generation":   20,
  "navigate":          0,
  "search":            0,
  "agent-plan":        2,
  "page-execution":    0,
  "llm-persona":       1,
};

function simulateProxy(role, utterance, snapshot) {
  const tool = getChatToolForSpirit(role);
  const cleanPrompt = stripMention(utterance);

  switch (tool.kind) {
    case "fal-generation": {
      const tooShort = cleanPrompt.length < tool.minPromptChars;
      return {
        wire: { endpoint: "trpc.spirit.invoke", input: { spirit: role, prompt: cleanPrompt } },
        note: tooShort
          ? `prompt 太短 < ${tool.minPromptChars} → fall-through LLM`
          : `打 fal.ai → FalDispatchResult`,
      };
    }
    case "navigate": {
      const path = tool.toPath ?? (tool.intentBased ? detectNavIntent(cleanPrompt) : "/");
      const finalPath = tool.passPromptAsSearch && cleanPrompt
        ? `${path}?search=${encodeURIComponent(cleanPrompt)}`
        : path;
      return {
        wire: { action: { type: "navigate", path: finalPath }, chatHint: tool.arrivalHint },
        note: `客戶端 dispatch navigate → ${finalPath}`,
      };
    }
    case "search": {
      const tooShort = cleanPrompt.length < tool.minPromptChars;
      return {
        wire: {
          endpoint: "trpc.orbProxy.unifiedSearch",
          input: { query: cleanPrompt, types: ["asset", "note", "history", "tutorial"] },
        },
        note: tooShort ? `query 太短 → fall-through LLM` : `unifiedSearch 回 items`,
      };
    }
    case "agent-plan": {
      const tooShort = cleanPrompt.length < tool.minPromptChars;
      if (tooShort) {
        return {
          wire: { fallthrough: "llm-persona", reason: `< ${tool.minPromptChars}` },
          note: "太短當閒聊",
        };
      }
      return {
        wire: {
          step1: "trpc.spirit.plan({ goal, maxSteps: 8 })",
          step2: "UI: PlanRecord card + ▶ 開跑",
          step3: "trpc.spirit.run + 1.5s 輪詢 trpc.spirit.status",
        },
        note: "plan + run + status 輪詢",
      };
    }
    case "page-execution": {
      if (!snapshot || snapshot.capabilities.length === 0) {
        return {
          wire: { fallthrough: "llm-persona", reason: "沒站在 studio 頁" },
          note: "提示先去 /image-studio /video-studio /pro-studio",
        };
      }
      const actions = /再來一張|再生|另一張/.test(cleanPrompt)
        ? [{ type: "submit" }]
        : /改成|換成/.test(cleanPrompt)
          ? [{ type: "setParam" }]
          : [];
      return {
        wire: actions.length > 0
          ? { actions, dispatchVia: "executeActions(pageHandle)" }
          : { fallthrough: "llm-persona", reason: "parser 解不出 actions" },
        note: actions.length > 0
          ? `dispatch ${snapshot.pageId} actions=[${actions.map(a => a.type).join(",")}]`
          : "LLM 接手出 actions JSON",
      };
    }
    case "llm-persona": {
      return {
        wire: {
          endpoint: "trpc.ai.chat (stream)",
          systemPromptSlice: `roleSlice(${role})`,
          userMessage: cleanPrompt,
        },
        note: `LLM stream，套 ${role} 人格切片`,
      };
    }
  }
}

// ─── 3. 跑：把導演計畫整條走過去，沿途累積 TIMELINE ──────────
console.log("\n════════════ 導演 AI × 全站光球代理 × 25 精靈 模擬 ════════════\n");
console.log(`Brief：${USER_BRIEF}`);
console.log(`Plan：${DIRECTOR_PLAN.length} 個 sub-task → 覆蓋 ${planRoles.size}/25 位精靈\n`);

const eaten = new Set();
const failures = [];
const kindCount = {};
let pass = 0;
let totalMs = 0;
let totalCredits = 0;
let cursorMs = 0;

console.log("─────── TIMELINE（推論藍圖時間軸）───────");
console.log(
  "  t(ms) │ shot │ expect(暱稱)        │ → got(暱稱)         │ tool            │ Δms / 點 │ wire / note",
);
console.log("─".repeat(120));

for (let i = 0; i < DIRECTOR_PLAN.length; i++) {
  const sc = DIRECTOR_PLAN[i];
  const sel = selectRoleForIntent({
    text: sc.utterance,
    snapshot: sc.snapshot ?? null,
  });
  const tool = getChatToolForSpirit(sel.role);
  const { wire, note } = simulateProxy(sel.role, sc.utterance, sc.snapshot ?? null);
  const matched = sel.role === sc.expect;

  const expectNick = getPrimaryNicknameForRole(sc.expect) ?? sc.expect;
  const gotNick = getPrimaryNicknameForRole(sel.role) ?? sel.role;
  const dMs = TYPICAL_LATENCY_MS[tool.kind] ?? 0;
  const credits = TYPICAL_CREDITS[tool.kind] ?? 0;
  const mark = matched ? "✅" : "❌";

  console.log(
    `  ${String(cursorMs).padStart(5)} │ ${(sc.shot ?? "--").padEnd(4)} │ ${(expectNick + "(" + sc.expect + ")").padEnd(20)} │ ${mark} ${(gotNick + "(" + sel.role + ")").padEnd(18)} │ ${tool.kind.padEnd(15)} │ ${String(dMs).padStart(5)} / ${String(credits).padStart(2)} │ ${sc.intent}`,
  );
  console.log(
    `        │      │ utter: "${sc.utterance}"`,
  );
  console.log(
    `        │      │ wire : ${JSON.stringify(wire)}`,
  );
  console.log(
    `        │      │ note : ${note}   [router: conf=${sel.confidence.toFixed(2)}, ${sel.rationale}]`,
  );
  console.log("");

  cursorMs += dMs;
  totalMs += dMs;
  totalCredits += credits;
  kindCount[tool.kind] = (kindCount[tool.kind] ?? 0) + 1;

  if (matched) {
    pass++;
    eaten.add(sc.expect);
  } else {
    failures.push({ scenario: sc, got: sel.role });
  }
}

console.log("─".repeat(120));

// ─── 4. 報表 ───────────────────────────────────────────────
const uneaten = ALL_25.filter(r => !eaten.has(r));
console.log("\n════════ 覆蓋率 ════════");
console.log(`  正確命中：${pass}/${DIRECTOR_PLAN.length}`);
console.log(`  25 精靈被導演吃到：${eaten.size}/25`);
if (uneaten.length) console.log(`  ↳ 未吃到：${uneaten.join(", ")}`);

console.log("\n════════ Tool Kind 分佈 ════════");
for (const [kind, n] of Object.entries(kindCount).sort((a, b) => b[1] - a[1])) {
  const bar = "█".repeat(n);
  console.log(`  ${kind.padEnd(16)} ${String(n).padStart(2)}  ${bar}`);
}

console.log("\n════════ 估算 ════════");
console.log(`  TIMELINE 全長：~${(totalMs / 1000).toFixed(1)}s（${totalMs}ms 串行）`);
console.log(`  並行最壞估：~${(Math.max(...Object.entries(kindCount).map(([k, n]) => (TYPICAL_LATENCY_MS[k] ?? 0) * n)) / 1000).toFixed(1)}s（同 kind 排隊）`);
console.log(`  總估點數  ：${totalCredits} pts`);

if (failures.length) {
  console.log("\n════════ 失敗詳情 ════════");
  for (const f of failures) {
    console.log(`  ❌ "${f.scenario.utterance}"`);
    console.log(`     expect=${f.scenario.expect}  got=${f.got}`);
  }
}

console.log("");
if (eaten.size === 25 && failures.length === 0) {
  console.log("✓ 導演 AI 順利透過全站光球代理把 25 位精靈全部夾過一輪。");
  process.exit(0);
} else {
  console.log("✗ 還有未命中的路由，請檢查 DIRECTOR_PLAN 或 KEYWORD_RULES。");
  process.exit(1);
}
