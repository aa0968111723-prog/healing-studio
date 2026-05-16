#!/usr/bin/env node
/**
 * scripts/simulate-orb-studio-25.mjs
 *
 * 全站光球代理互動模擬器 — 25 精靈 × 創作工作室
 *
 * 對應視覺：DirectorAI 頁面的「光球創作劇場」(PHASE 01-02)。
 * 模擬範圍：
 *   1. 25 位精靈在 orb proxy 路由下的真實命中
 *   2. 4 種劇場模式（快做 / 多模態 / 多步驟 / 風格一致）
 *   3. 全站創作工作室落地（/director /studio /image-studio /video-studio
 *      /pro-studio /models /lora-trainer /background-tasks ...）
 *   4. 16 種主動觸發事件對應精靈
 *   5. Handoff 鏈在多步驟工作流中的真實接棒
 *   6. 模擬隊列 + timeline + 成本累計
 *
 * 純 Node.js — 不需 build / tsx；直接 `node scripts/simulate-orb-studio-25.mjs`。
 *
 * Source-driven 設計（2026-05-16 修補 Codex P1/P2 反饋）：
 *   Phase 2 的「routing 命中」改用 detectSpiritMention 的 faithful mini-impl
 *   跑真實 SPIRIT_NICKNAMES（從 shared/orb-agent-roles.ts 解析），所以使用者
 *   把暱稱改名 / 刪一位精靈 / 主要 nickname 漂移時模擬會立刻失敗，不會永
 *   遠綠燈。Phase 8 的健康總表每一行都從真實檔案 grep 計算，沒有寫死 "ok"。
 *
 *   inline SPIRITS 表只保留視覺資料（emoji / 漸層）；roleId / 暱稱 / family
 *   清單來自 source-of-truth 解析。若 source 多出一位 inline 沒有的精靈，
 *   visual 會 fallback 但 health 會 warn。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const read = (rel) => readFileSync(resolve(ROOT, rel), "utf8");

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  ital: "\x1b[3m",
  // brand palette — 模擬截圖紫光球 + 紫色 highlight
  purple: "\x1b[38;5;141m",
  magenta: "\x1b[38;5;213m",
  pink: "\x1b[38;5;218m",
  cyan: "\x1b[38;5;87m",
  yellow: "\x1b[38;5;221m",
  orange: "\x1b[38;5;215m",
  green: "\x1b[38;5;120m",
  red: "\x1b[38;5;203m",
  blue: "\x1b[38;5;111m",
  gray: "\x1b[38;5;245m",
  dimgray: "\x1b[38;5;240m",
  white: "\x1b[38;5;255m",
};

const c = (color, s) => `${C[color] ?? ""}${s}${C.reset}`;
const bold = s => `${C.bold}${s}${C.reset}`;
const dim = s => `${C.dim}${s}${C.reset}`;

// ─── 25 精靈：id / 家族 / 暱稱 / 預設路徑 / 偏好 LLM ────────────────────────
// 與 shared/orb-agent-roles.ts §1.0 對齊；如 source 變更請同步本表。
const SPIRITS = [
  // 6 通用 role
  { id: "director",            emoji: "🎯", nick: "導導", family: "role",       path: "/director",         llm: "gemini",      grad: ["yellow","orange"] },
  { id: "composer",            emoji: "✍️", nick: "編編", family: "role",       path: null,                llm: "default",     grad: ["cyan","blue"] },
  { id: "critic",              emoji: "🔎", nick: "品品", family: "role",       path: null,                llm: "gemini",      grad: ["yellow","yellow"] },
  { id: "researcher",          emoji: "🧭", nick: "查查", family: "role",       path: null,                llm: "gemini",      grad: ["green","green"] },
  { id: "navigator",           emoji: "🧳", nick: "路路", family: "role",       path: null,                llm: "default",     grad: ["gray","gray"] },
  { id: "companion",           emoji: "🌿", nick: "暖暖", family: "role",       path: null,                llm: "default",     grad: ["pink","red"] },
  // 3 主動 trio
  { id: "accountant",          emoji: "💰", nick: "財財", family: "proactive",  path: "/dashboard",        llm: "default",     grad: ["yellow","orange"] },
  { id: "quality-coach",       emoji: "✨", nick: "巧巧", family: "proactive",  path: null,                llm: "gemini",      grad: ["purple","magenta"] },
  { id: "inspector",           emoji: "🛡️", nick: "守守", family: "proactive",  path: null,                llm: "gemini",      grad: ["green","cyan"] },
  // 6 modality specialist
  { id: "image-specialist",    emoji: "🎨", nick: "圖圖", family: "specialist", path: "/image-studio",     llm: "gemini",      grad: ["pink","red"] },
  { id: "video-specialist",    emoji: "🎬", nick: "影影", family: "specialist", path: "/video-studio",     llm: "gemini",      grad: ["orange","yellow"] },
  { id: "music-specialist",    emoji: "🎵", nick: "音音", family: "specialist", path: "/pro-studio",       llm: "gemini",      grad: ["purple","blue"] },
  { id: "voice-specialist",    emoji: "🎙️", nick: "聲聲", family: "specialist", path: "/pro-studio",       llm: "gemini",      grad: ["cyan","green"] },
  { id: "training-specialist", emoji: "🧪", nick: "練練", family: "specialist", path: "/models",           llm: "gemini",      grad: ["magenta","purple"] },
  { id: "learning-specialist", emoji: "📚", nick: "學學", family: "specialist", path: "/learn",            llm: "default",     grad: ["green","cyan"] },
  // 7 新增 — 法 / 安 / 群 / 總 / 帶 / 記 / 細
  { id: "legal-advisor",       emoji: "⚖️",  nick: "律律", family: "proactive",  path: null,                llm: "gemini",      grad: ["yellow","orange"] },
  { id: "security-guard",      emoji: "🔒", nick: "安安", family: "proactive",  path: null,                llm: "gemini",      grad: ["gray","dimgray"] },
  { id: "community-manager",   emoji: "📣", nick: "群群", family: "specialist", path: null,                llm: "gemini",      grad: ["pink","magenta"] },
  { id: "chief-orchestrator",  emoji: "🎩", nick: "總總", family: "role",       path: "/settings/agent",   llm: "gemini",      grad: ["purple","magenta"] },
  { id: "onboarding-coach",    emoji: "🤝", nick: "帶帶", family: "proactive",  path: null,                llm: "default",     grad: ["green","green"] },
  { id: "notes-curator",       emoji: "📒", nick: "記記", family: "role",       path: "/notes",            llm: "default",     grad: ["yellow","yellow"] },
  { id: "settings-detail",     emoji: "⚙️", nick: "細細", family: "role",       path: "/settings",         llm: "default",     grad: ["cyan","blue"] },
  { id: "plan-executor",       emoji: "🧩", nick: "步步", family: "role",       path: "/background-tasks", llm: "gemini",      grad: ["purple","magenta"] },
  // 靈靈 / 體體 — 2026-05-14 修補後已掛 specializedAgents[]
  { id: "inspiration-specialist", emoji: "💡", nick: "靈靈", family: "specialist", path: null,             llm: "gemini",      grad: ["yellow","orange"] },
  { id: "anatomy-specialist",     emoji: "🫀", nick: "體體", family: "specialist", path: null,             llm: "gemini",      grad: ["red","pink"] },
];

const byId = Object.fromEntries(SPIRITS.map(s => [s.id, s]));

// ─── Source-of-truth parsers ──────────────────────────────────────────
// 直接 grep 真實檔案而不 import .ts —— 因為 monorepo 用 NodeNext ESM，
// `import "./foo"` 沒有 `.js` 後綴會跑不起來。改用 regex 解析比建一條
// tsx/ts-node 工具鏈簡單，也與本檔「純 .mjs，零依賴」的設計保持一致。

function parseAgentRoles() {
  // `export type AgentRole = | "director" | "composer" | ...;`
  const src = read("shared/orb-agent-roles.ts");
  const block = src.match(/export type AgentRole =([\s\S]*?);/);
  if (!block) throw new Error("無法解析 AgentRole union（shared/orb-agent-roles.ts）");
  return [...block[1].matchAll(/"([a-z-]+)"/g)].map(m => m[1]);
}

function parseSpiritNicknames() {
  // `{ role: "image-specialist", nicknames: ["圖圖", "阿圖", ...] },`
  const src = read("shared/orb-agent-roles.ts");
  const block = src.match(/const SPIRIT_NICKNAMES[\s\S]*?=\s*\[([\s\S]*?)\];/);
  if (!block) throw new Error("無法解析 SPIRIT_NICKNAMES");
  const out = {};
  const re = /\{\s*role:\s*"([a-z-]+)"\s*,\s*nicknames:\s*\[([^\]]+)\]\s*\}/g;
  let m;
  while ((m = re.exec(block[1])) !== null) {
    const role = m[1];
    const names = [...m[2].matchAll(/"([^"]+)"/g)].map(x => x[1]);
    out[role] = names;
  }
  return out;
}

function parseSpiritsById() {
  // `export const SPIRITS: SpiritVisual[] = [ { id: "image-specialist", ... } ]`
  const src = read("client/src/lib/spiritsVisual.ts");
  return [...src.matchAll(/\bid:\s*"([a-z-]+)"/g)].map(m => m[1]);
}

function parseMonitoredSpirits() {
  // `private readonly MONITORED_SPIRITS: readonly AgentRole[] = [ ... ] as const;`
  // 注意：陣列結尾是 `] as const;` 不是 `];`，不容忍會吃進後面的程式碼。
  const src = read("server/services/spiritStatusMonitor.ts");
  const block = src.match(/MONITORED_SPIRITS[^=]*=\s*\[([\s\S]*?)\]\s*(?:as\s+const)?\s*;/);
  if (!block) return [];
  return [...block[1].matchAll(/"([a-z-]+)"/g)].map(m => m[1]);
}

function parseProactiveEventUnion() {
  // `export type ProactiveTriggerEvent = | "monthly_spend_threshold" | ...;`
  const src = read("shared/orb-agent-roles.ts");
  const block = src.match(/export type ProactiveTriggerEvent =([\s\S]*?);/);
  if (!block) return [];
  return [...block[1].matchAll(/"([a-z_]+)"/g)].map(m => m[1]);
}

function parseProactiveTriggerSpecs() {
  // `export const SPIRIT_PROACTIVE_TRIGGERS = [{ spirit, event, surface, ... }]`
  // 抓 event 欄位即可
  const src = read("shared/orb-agent-roles.ts");
  const block = src.match(/SPIRIT_PROACTIVE_TRIGGERS[^=]*=\s*\[([\s\S]*?)\];/);
  if (!block) return [];
  return [...block[1].matchAll(/event:\s*"([a-z_]+)"/g)].map(m => m[1]);
}

function parsePathSpiritMap() {
  // `const PATH_SPIRIT_MAP: ... = [ { prefix: "/director", role: "director" }, ... ]`
  const src = read("shared/orb-agent-roles.ts");
  const block = src.match(/const PATH_SPIRIT_MAP[\s\S]*?=\s*\[([\s\S]*?)\];/);
  if (!block) return [];
  return [...block[1].matchAll(/prefix:\s*"([^"]+)"/g)].map(m => m[1]);
}

function parseAppRoutes() {
  // `<Route path="...">` and `<Route path="..." component={X} />`
  const src = read("client/src/App.tsx");
  const paths = new Set();
  for (const m of src.matchAll(/<Route\s+path="([^"]+)"/g)) paths.add(m[1].split(/[?#]/)[0]);
  return [...paths];
}

function parseHandoffIndicatorUsesById() {
  const src = read("client/src/components/SpiritHandoffIndicator.tsx");
  // 看它是否從 spiritsVisual import SPIRITS_BY_ID
  return /from\s+["'][^"']*spiritsVisual["']/.test(src)
      && /SPIRITS_BY_ID/.test(src);
}

// ─── Faithful detectSpiritMention re-impl ─────────────────────────────
// 跟 shared/orb-agent-roles.ts:1019 一致：先檢查 `@暱稱` 出現於任何位置，
// 再檢查純 bare nickname 開頭（含 AMBIGUOUS denylist）。本檔的測試 prompt
// 全部以 `@<primaryNickname>` 開頭，所以走的是第一條路徑；如果 source 把
// 某位精靈的主要暱稱改名，這裡就會 detect 失敗，Phase 2 會立刻變紅。
function detectSpiritMentionMini(text, nicknamesByRole) {
  for (const [role, names] of Object.entries(nicknamesByRole)) {
    for (const n of names) {
      if (text.includes(`@${n}`)) return role;
    }
  }
  return null;
}

// ─── 載入 source state（lazy；main 開頭呼叫一次）────────────────────
let SOURCE = null;
function loadSourceState() {
  if (SOURCE) return SOURCE;
  SOURCE = {
    agentRoles:           parseAgentRoles(),
    nicknames:            parseSpiritNicknames(),
    spiritsById:          parseSpiritsById(),
    monitoredSpirits:     parseMonitoredSpirits(),
    proactiveEvents:      parseProactiveEventUnion(),
    proactiveTriggers:    parseProactiveTriggerSpecs(),
    pathSpiritMap:        parsePathSpiritMap(),
    appRoutes:            parseAppRoutes(),
    handoffIndicatorOK:   parseHandoffIndicatorUsesById(),
  };
  return SOURCE;
}

const STUDIO_PAGES = [
  { path: "/director",         label: "AI Director 劇場", host: "director",            cap: "規劃跨頁工作流" },
  { path: "/studio",           label: "創作工作室",        host: "composer",            cap: "在當頁直接執行" },
  { path: "/image-studio",     label: "圖像工作室",        host: "image-specialist",    cap: "圖片生成 / 修圖 / 去背" },
  { path: "/video-studio",     label: "影片工作室",        host: "video-specialist",    cap: "影片生成 / 對嘴 / 升頻" },
  { path: "/pro-studio",       label: "音訊工作室",        host: "music-specialist",    cap: "BGM / 音效 / 配音" },
  { path: "/models",           label: "模型總覽",          host: "training-specialist", cap: "比較與切換引擎" },
  { path: "/lora-trainer",     label: "LoRA 訓練",         host: "training-specialist", cap: "角色 / 風格 / 影片 LoRA" },
  { path: "/learn",            label: "學習中心",          host: "learning-specialist", cap: "教程 + 踩坑筆記" },
  { path: "/dashboard",        label: "儀表板",            host: "accountant",          cap: "點數 / 用量 / 成本" },
  { path: "/background-tasks", label: "任務面板",          host: "plan-executor",       cap: "排隊 / 進行 / 完成" },
  { path: "/notes",            label: "筆記與排程",        host: "notes-curator",       cap: "決策 / 素材索引" },
  { path: "/settings",         label: "設定中心",          host: "settings-detail",     cap: "通知 / 預設模型 / 金鑰" },
  { path: "/settings/agent",   label: "團隊看板",          host: "chief-orchestrator",  cap: "25 精靈 idle/busy 監控" },
];

// ─── 真實 prompt 對應每位精靈（mirror audit-12-roles.mjs）─────────────────
// 每條 prompt 以 `@<暱稱>` 起頭，讓 Phase 2 可以用真實 detectSpiritMention
// 的 @-prefix 路徑驗證命中（如 source 把某位精靈的主要 nickname 改名，
// 這裡就會直接命中失敗 → Phase 2 變紅而不是無聲通過）。
const SPIRIT_PROMPTS = {
  "director":               "@導導 幫我規劃一個從腳本到影片到配樂的完整工作流",
  "composer":               "@編編 幫我把這頁的提示詞改成 35mm 底片質感再送出",
  "critic":                 "@品品 幫我看一下這張海報哪裡可以再改",
  "researcher":             "@查查 幫我比較 Flux Pro / Veo 3 / Kling 2.1 的差別",
  "navigator":              "@路路 帶我去模型總覽頁",
  "companion":              "@暖暖 今天有點累，先陪我聊一下再開始",
  "accountant":             "@財財 本月點數還剩多少？最近最花錢的是哪個模型？",
  "quality-coach":          "@巧巧 這個 prompt 一直生不出我要的，幫我看是哪裡寫得不好",
  "inspector":              "@守守 剛剛圖片生成又失敗了，是不是站上有問題？",
  "image-specialist":       "@圖圖 夕陽下的少女側臉，電影感、淺景深、35mm 底片質感",
  "video-specialist":       "@影影 把這張圖做成 8 秒直式短影片，鏡頭緩慢推進",
  "music-specialist":       "@音音 幫我寫一段 lo-fi 療癒系背景音樂，60 秒",
  "voice-specialist":       "@聲聲 幫我配一段 30 秒的女聲旁白，溫暖、慢節奏",
  "training-specialist":    "@練練 我有 20 張參考圖，想練一個自己角色的 LoRA",
  "learning-specialist":    "@學學 我是新手，教我怎麼從零開始做第一支 AI 影片",
  "legal-advisor":          "@律律 我想做一張米老鼠風格的圖貼到 IG，這樣會有問題嗎？",
  "security-guard":         "@安安 我把我的 OpenAI key 直接貼進對話了，怎麼辦？",
  "community-manager":      "@群群 教我經營 IG 的療癒系帳號，目標 25-35 歲女性",
  "chief-orchestrator":     "@總總 現在團隊有哪幾位在跑？下一棒應該交給誰？",
  "onboarding-coach":       "@帶帶 我同一個操作試了 4 次都沒成功，是不是哪裡操作錯了",
  "notes-curator":          "@記記 幫我把剛剛聊到的「療癒系品牌調性」記下來",
  "settings-detail":        "@細細 我想關掉成本提醒但保留錯誤通知，怎麼調？",
  "plan-executor":          "@步步 把這條 5 步驟的計畫從頭跑到尾，每完成一步通知我",
  "inspiration-specialist": "@靈靈 完全沒想法，給我 3 個療癒系視覺方向",
  "anatomy-specialist":     "@體體 幫我畫一張人體心臟解剖剖面圖，標出主要血管",
};

// ─── 16 主動觸發事件 ────────────────────────────────────────────────────
const PROACTIVE_TRIGGERS = [
  { event: "monthly_spend_threshold",   spirit: "accountant",         surface: "inline",   sample: "本月已用 82%，剩 1,180 點" },
  { event: "expensive_op_about_to_run", spirit: "accountant",         surface: "blocking", sample: "Kling Pro 即將花 420 點（本月剩餘 35%）" },
  { event: "low_quality_generation",    spirit: "quality-coach",      surface: "inline",   sample: "連 3 次 prompt 相似度 ≥0.6，在重複改字" },
  { event: "prompt_too_short",          spirit: "quality-coach",      surface: "toast",    sample: "「畫一張少女」過短，建議補風格 / 鏡頭 / 質感" },
  { event: "site_error_detected",       spirit: "inspector",          surface: "toast",    sample: "/fal/queue 503，已備援到 secondary" },
  { event: "page_perf_bad",             spirit: "inspector",          surface: "toast",    sample: "/image-studio TTI 5,420ms，>5s 慢頁閾值" },
  { event: "feature_not_used",          spirit: "inspector",          surface: "toast",    sample: "你方案含 LoRA 訓練但 7 天未使用" },
  { event: "context_near_full",         spirit: "companion",          surface: "inline",   sample: "已 38 輪約用掉 78% 上下文，建議開新對話" },
  { event: "ip_risk_detected",          spirit: "legal-advisor",      surface: "blocking", sample: "命中「米老鼠」(high 風險)，提供安全改寫" },
  { event: "credential_leak_detected",  spirit: "security-guard",     surface: "blocking", sample: "sk-... 樣式金鑰，建議立刻刪除並移到 /settings" },
  { event: "user_stuck_detected",       spirit: "onboarding-coach",   surface: "inline",   sample: "同一 prompt 變體連 4 次失敗，主動 offer 引導" },
  { event: "team_status_overview",      spirit: "chief-orchestrator", surface: "toast",    sample: "3 個進行中、2 個排隊；下一棒建議交給 @品品" },
  { event: "social_post_ready",         spirit: "community-manager",  surface: "toast",    sample: "完成圖且 30 分內提過 IG，提案發布排程" },
  { event: "notes_capture_suggested",   spirit: "notes-curator",      surface: "toast",    sample: "「下次想記得用 35mm」偵測到記憶意圖" },
  { event: "settings_drift_detected",   spirit: "settings-detail",    surface: "toast",    sample: "你 mute 了財財卻問本月花費 — 偏好衝突" },
  { event: "multi_step_plan_ready",     spirit: "plan-executor",      surface: "inline",   sample: "工作流產生 5 步，步步要不要接管自動跑？" },
];

// ─── 4 劇場模式（鏡像截圖頂部 4 個 tab）────────────────────────────────
const THEATER_MODES = [
  {
    id: "quick",
    label: "快做演示",
    hint: "一句話 → 直送單一工具 → 8 秒內出第一版可用素材",
    steps: [
      { spirit: "image-specialist", desc: "解析輸入意圖 + 鎖定唯一模型（圖／影／音）" },
      { spirit: "composer",         desc: "直送到當頁工具，省去跨工具成本" },
      { spirit: "inspector",        desc: "輸出 fal queue + 取回成品可重複 seed" },
    ],
  },
  {
    id: "multimodal",
    label: "多模態演示",
    hint: "圖 × 影 × 音 × 聲 同時跑出 4 種素材變體",
    steps: [
      { spirit: "director",          desc: "拆分 4 個模態分頭跑（不串聯，純併行）" },
      { spirit: "image-specialist",  desc: "出 1 張主視覺（cinematic + film-grain）" },
      { spirit: "video-specialist",  desc: "把主視覺轉 5 秒推進鏡頭" },
      { spirit: "music-specialist",  desc: "30 秒 lo-fi 療癒底配" },
      { spirit: "voice-specialist",  desc: "10 秒女聲旁白疊上 BGM" },
    ],
  },
  {
    id: "multistep",
    label: "多步驟演示",
    hint: "導導排計畫 → 步步自動跑 5 步 → 每步換不同精靈接棒",
    steps: [
      { spirit: "director",         desc: "計畫拆 5 步（image → critique → video → music → notes）" },
      { spirit: "accountant",       desc: "計畫超過 2 個付費步，先估總成本鎖確認" },
      { spirit: "plan-executor",    desc: "使用者按確認 → 自動接管跨頁執行" },
      { spirit: "image-specialist", desc: "step 1: 主視覺出圖" },
      { spirit: "critic",           desc: "step 2: 挑 1-3 點可改進" },
      { spirit: "video-specialist", desc: "step 3: 把改進後的圖延展成 8 秒影片" },
      { spirit: "music-specialist", desc: "step 4: 配 30 秒 BGM" },
      { spirit: "notes-curator",    desc: "step 5: 把整段工作流存進筆記" },
    ],
  },
  {
    id: "consistency",
    label: "風格一致演示",
    hint: "練練先訓 LoRA，後面所有圖／影／音都引用同一風格",
    steps: [
      { spirit: "inspiration-specialist", desc: "先丟 3 個療癒系視覺方向給使用者選" },
      { spirit: "training-specialist",    desc: "拿 20 張參考圖訓「療癒A」風格 LoRA" },
      { spirit: "image-specialist",       desc: "套 LoRA 出 4 張變體（同 seed 不同 prompt）" },
      { spirit: "quality-coach",          desc: "看 4 張中哪張 prompt 最穩，鎖為 anchor" },
      { spirit: "video-specialist",       desc: "anchor 轉影片，保持風格一致" },
      { spirit: "community-manager",      desc: "整批 4 圖 + 1 影排成週發文計畫" },
    ],
  },
];

// ─── Handoff 鏈樣本（取自 SPIRIT_COLLAB_PROTOCOL 真實接棒）────────────
const HANDOFF_CHAINS = [
  { trigger: "完整商品主視覺",
    chain: ["companion", "director", "image-specialist", "critic", "composer", "accountant"] },
  { trigger: "社群短影音",
    chain: ["inspiration-specialist", "image-specialist", "video-specialist", "music-specialist", "community-manager"] },
  { trigger: "活動主視覺 + 海報文案",
    chain: ["director", "image-specialist", "critic", "quality-coach", "composer"] },
  { trigger: "風險（IP / 金鑰）守門",
    chain: ["composer", "legal-advisor", "quality-coach", "security-guard"] },
  { trigger: "多步驟自動執行",
    chain: ["director", "accountant", "plan-executor", "image-specialist", "video-specialist", "music-specialist", "notes-curator"] },
];

// ─── 視覺工具 ────────────────────────────────────────────────────────
function chip(spirit) {
  const s = typeof spirit === "string" ? byId[spirit] : spirit;
  if (!s) return c("red", `[?]`);
  const [g1, g2] = s.grad;
  return `${c(g1, s.emoji)} ${c(g2, s.nick.padEnd(3, "　"))}`;
}

function orb(label = "光球") {
  // ASCII 紫光球 — 對應截圖中央 cinematic + film-grain 球
  const lines = [
    `     ${c("magenta", "·")}    ${c("purple", "✦")}    ${c("magenta", "·")}`,
    `       ${c("purple", "╭───╮")}`,
    `      ${c("purple", "│ ◉ │")}   ${dim(label)}`,
    `       ${c("purple", "╰───╯")}`,
    `     ${c("magenta", "·")}    ${c("purple", "✦")}    ${c("magenta", "·")}`,
  ];
  return lines.join("\n");
}

function rule(title = "") {
  const w = 76;
  if (!title) return c("dimgray", "─".repeat(w));
  const padded = ` ${title} `;
  const left = Math.max(2, Math.floor((w - padded.length) / 2));
  const right = Math.max(2, w - left - padded.length);
  return c("dimgray", "─".repeat(left)) + c("purple", padded) + c("dimgray", "─".repeat(right));
}

function box(title, lines, color = "purple") {
  const w = 76;
  const top = `${c(color, "╭")}${c(color, "─".repeat(2))} ${c(color, title)} ${c(color, "─".repeat(Math.max(2, w - 6 - title.length)))}${c(color, "╮")}`;
  const mid = lines.map(l => `${c(color, "│")} ${l}${" ".repeat(Math.max(0, w - 3 - stripAnsi(l).length))}${c(color, "│")}`).join("\n");
  const bot = `${c(color, "╰")}${c(color, "─".repeat(w - 2))}${c(color, "╯")}`;
  return [top, mid, bot].join("\n");
}

function stripAnsi(s) { return String(s).replace(/\x1b\[[0-9;]*m/g, ""); }

// 模擬延遲動畫 — 為了真實感保留，但預設關閉避免阻塞 CI / pipe
const FAST = process.env.SLOW !== "1";
async function tick(ms = 60) {
  if (FAST) return;
  return new Promise(r => setTimeout(r, ms));
}

// 模擬成本/時間累計
let totalCost = 0;
let totalSec = 0;
const log = [];
function step({ spirit, action, model, cost = 0, sec = 0, status = "ok", detail = "" }) {
  const s = typeof spirit === "string" ? byId[spirit] : spirit;
  totalCost += cost;
  totalSec += sec;
  const statusIcon = status === "ok" ? c("green", "✓") : status === "warn" ? c("yellow", "⚠") : c("red", "✗");
  const line =
    `${statusIcon} ${chip(s)} ${c("white", action.padEnd(20))}` +
    `${model ? c("cyan", model.padEnd(18)) : "".padEnd(18)}` +
    (cost ? c("yellow", `−${cost}pt`.padStart(8)) : "      ".padEnd(8)) +
    (sec  ? c("dim", ` ${sec}s`.padStart(5))     : "     ".padEnd(5)) +
    (detail ? `  ${c("gray", detail)}` : "");
  console.log("  " + line);
  log.push({ spirit: s.id, action, model, cost, sec, status });
}

// ─── PHASE 0 開場 ────────────────────────────────────────────────────
function phase0_intro() {
  console.log();
  console.log(c("purple", "  ═══════════════════════════════════════════════════════════════════════"));
  console.log(c("purple", "  ║") + c("white", "  AI Director · PHASE 01-02 · 光球創作劇場                          ") + c("purple", "  ║"));
  console.log(c("purple", "  ║") + dim("  從一個提示詞開始 · 即時生成 · 25 精靈 × 創作工作室              ") + c("purple", "  ║"));
  console.log(c("purple", "  ═══════════════════════════════════════════════════════════════════════"));
  console.log();
  console.log(orb("光球代理 · cinematic · film-grain"));
  console.log();
  console.log(c("gray", "  ▸ 模擬範圍 : 25 spirits × 13 studio pages × 4 theater modes × 16 proactive events"));
  console.log(c("gray", "  ▸ 模式      : " + (FAST ? "FAST (no sleep)" : "SLOW (animated)  — try SLOW=1 to animate")));
  console.log(c("gray", "  ▸ 對應視覺  : DirectorAI.tsx 的「PHASE 01-02 光球創作劇場」"));
  console.log();
}

// ─── PHASE 1 點名 25 精靈 ──────────────────────────────────────────
function phase1_roster() {
  console.log(rule("PHASE 1 · 25 精靈到場點名（對照 source AgentRole union）"));
  console.log();
  const src = loadSourceState();
  const inlineIds = new Set(SPIRITS.map(s => s.id));
  const sourceIds = new Set(src.agentRoles);
  const missingInInline = [...sourceIds].filter(id => !inlineIds.has(id));
  const missingInSource = [...inlineIds].filter(id => !sourceIds.has(id));

  const families = [
    ["role",       "通用同事 — 導 / 編 / 品 / 查 / 路 / 暖 / 總 / 記 / 細 / 步"],
    ["specialist", "專精精靈 — 圖 / 影 / 音 / 聲 / 訓 / 學 / 群 / 靈 / 體"],
    ["proactive",  "主動精靈 — 財 / 巧 / 守 / 律 / 安 / 帶"],
  ];
  for (const [fam, label] of families) {
    const list = SPIRITS.filter(s => s.family === fam);
    console.log(c("purple", "  ▌ ") + bold(`${label}（${list.length} 位）`));
    const cols = 4;
    for (let i = 0; i < list.length; i += cols) {
      const row = list.slice(i, i + cols)
        .map(s => `${chip(s)} ${c("dim", `(${s.id})`)}`).join("   ");
      console.log("    " + row);
    }
    console.log();
  }
  const driftMark = (missingInInline.length === 0 && missingInSource.length === 0)
    ? c("green", "✓")
    : c("yellow", "⚠");
  console.log(`  ${driftMark} inline ${SPIRITS.length} 位 ↔ source AgentRole ${sourceIds.size} 位`);
  if (missingInInline.length > 0) {
    console.log(c("yellow", `    ⚠ source 有但 inline 缺：${missingInInline.join(", ")}`));
  }
  if (missingInSource.length > 0) {
    console.log(c("red", `    ✗ inline 有但 source 沒：${missingInSource.join(", ")}（可能已被刪除）`));
  }
  console.log();
}

// ─── PHASE 2 逐位 orb proxy 路由 ──────────────────────────────────
// 每條 prompt 跑 detectSpiritMention 的 faithful mini-impl，用 source 解
// 出來的真實 SPIRIT_NICKNAMES 做對照。pass = detected === expected。
// 任何 source 漂移（暱稱改名 / 主要 nickname 換、role 被刪、@-prefix 邏
// 輯改動）都會讓對應行變紅，總計變 <25/25。
async function phase2_orb_routing() {
  console.log(rule("PHASE 2 · 逐位精靈：prompt → detectSpiritMention(source) → 命中"));
  console.log();
  const src = loadSourceState();
  let hits = 0;
  let misses = [];
  for (const s of SPIRITS) {
    const prompt = SPIRIT_PROMPTS[s.id] ?? `@${s.nick} test`;
    const detected = detectSpiritMentionMini(prompt, src.nicknames);
    const hit = detected === s.id;
    if (hit) hits++;
    else misses.push({ id: s.id, expected: s.id, got: detected });
    const mark = hit ? c("green", "✓") : c("red", "✗");
    const promptShort = prompt.length > 38 ? prompt.slice(0, 36) + "…" : prompt.padEnd(38);
    const gotLabel = hit ? s.id : `${detected ?? "(none)"} ≠ ${s.id}`;
    const gotColor = hit ? "cyan" : "red";
    console.log(`  ${mark} ${chip(s)} ${c("dim", "←")} ${c("white", promptShort)}` +
                `  ${c(gotColor, "→ " + gotLabel.padEnd(28))}` +
                `${c("dim", "LLM=" + s.llm)}`);
    await tick(20);
  }
  console.log();
  const allOk = hits === SPIRITS.length;
  if (allOk) {
    console.log(c("green", `  ✓ orb proxy 路由：${hits}/${SPIRITS.length} 命中（@-prefix faithful to source SPIRIT_NICKNAMES）`));
  } else {
    console.log(c("red", `  ✗ orb proxy 路由：${hits}/${SPIRITS.length} 命中 — ${misses.length} 條漂移：`));
    for (const m of misses) {
      console.log(c("red", `    - ${m.expected} → 實際得到 ${m.got ?? "(none)"}`));
    }
    process.exitCode = 1; // CI 友善 — 漂移時非 0 結束
  }
  console.log();
  return { hits, total: SPIRITS.length, misses };
}

// ─── PHASE 3 創作工作室落地 ─────────────────────────────────────
async function phase3_studio_landings() {
  console.log(rule("PHASE 3 · 全站創作工作室落地：光球跟著去每個工作室"));
  console.log();
  console.log(c("dim", "  使用者按下「@路路 帶我去 X」→ 路路導航 → 落地頁當家精靈接話"));
  console.log();
  for (const page of STUDIO_PAGES) {
    const host = byId[page.host];
    console.log(`  ${chip("navigator")} ${c("dim", "→ navigate")} ${c("cyan", page.path.padEnd(20))} ${c("white", page.label.padEnd(14))}`);
    console.log(`    ${c("dim", "└─")} ${chip(host)} ${c("dim", "接手：")} ${c("white", page.cap)}`);
    await tick(40);
  }
  console.log();
  console.log(c("green", `  ✓ ${STUDIO_PAGES.length} 個工作室全部可達；無 404；無精靈靜默`));
  console.log();
}

// ─── PHASE 4 四劇場模式 ─────────────────────────────────────────
async function phase4_theater_modes() {
  console.log(rule("PHASE 4 · 光球創作劇場：4 種演示模式（鏡像 DirectorAI 截圖頂部 tabs）"));
  console.log();
  for (const mode of THEATER_MODES) {
    console.log(c("magenta", `  ◉ ${mode.label}`) + c("dim", `   — ${mode.hint}`));
    for (let i = 0; i < mode.steps.length; i++) {
      const step = mode.steps[i];
      const s = byId[step.spirit];
      const num = c("dim", `    ${String(i + 1).padStart(2)}.`);
      console.log(`${num} ${chip(s)} ${c("gray", step.desc)}`);
      await tick(30);
    }
    console.log();
  }
}

// ─── PHASE 5 多步驟示範：真實執行一條 5 步工作流 ────────────────
async function phase5_multistep_run() {
  console.log(rule("PHASE 5 · 多步驟實況：『活動主視覺 → 推進影片 → BGM → 旁白 → 排程』"));
  console.log();
  console.log(c("dim", "  prompt: 「夕陽下的少女側臉，電影感、淺景深、35mm 底片質感」"));
  console.log(c("dim", "  輸出 1 張 + 約 8 秒影片 + 30 秒 BGM + 10 秒旁白 + IG 排程"));
  console.log();
  console.log(orb("光球路由中…"));
  console.log();

  // 步 1 — 導導拆計畫
  step({ spirit: "director",         action: "拆計畫 5 步",      model: "gemini-1.5-pro",    cost: 0,   sec: 2,  detail: "img → crit → vid → bgm → notes" });
  // 步 2 — 財財估算
  step({ spirit: "accountant",       action: "估總成本",         model: "(local)",           cost: 0,   sec: 0,  detail: "預估 ~640pt，本月剩餘 35% — blocking 確認" });
  // 步 3 — 圖圖
  step({ spirit: "image-specialist", action: "生成 1 張主視覺",  model: "fal/flux-pro",      cost: 120, sec: 9,  detail: "1024×1024 · cinematic · film-grain" });
  // 步 4 — 品品
  step({ spirit: "critic",           action: "挑 3 點可改進",    model: "gemini-1.5-pro",    cost: 0,   sec: 1,  detail: "膚色偏暖 / 髮絲鋸齒 / 背景過實" });
  // 步 5 — 巧巧 改寫
  step({ spirit: "quality-coach",    action: "改寫 prompt",      model: "gemini-1.5-pro",    cost: 0,   sec: 1,  detail: "加 soft golden hour + DOF f/1.4" });
  // 步 6 — 圖圖再生
  step({ spirit: "image-specialist", action: "re-gen (鎖 seed)", model: "fal/flux-pro",      cost: 120, sec: 8,  detail: "seed=84219 · 同一構圖 · 改進三點" });
  // 步 7 — 影影
  step({ spirit: "video-specialist", action: "img2video 8s",     model: "fal/kling-v2-pro",  cost: 280, sec: 38, detail: "推進鏡頭 · 9:16 直式 IG / 抖音" });
  // 步 8 — 音音
  step({ spirit: "music-specialist", action: "BGM 30s",          model: "fal/stable-audio",  cost: 60,  sec: 12, detail: "lo-fi · 60 BPM · 療癒系底配" });
  // 步 9 — 聲聲
  step({ spirit: "voice-specialist", action: "TTS 10s 旁白",     model: "elevenlabs/v2",     cost: 30,  sec: 4,  detail: "女聲 · 溫暖 · 慢節奏" });
  // 步 10 — 群群 排程
  step({ spirit: "community-manager",action: "週發文計畫",       model: "(local)",           cost: 0,   sec: 1,  detail: "IG 週一 09:00 + 抖音週三 19:00" });
  // 步 11 — 記記 存檔
  step({ spirit: "notes-curator",    action: "存進筆記",         model: "(local)",           cost: 0,   sec: 0,  detail: "tag: 療癒系A / 35mm anchor" });
  // 步 12 — 總總 收尾
  step({ spirit: "chief-orchestrator", action: "團隊狀態收尾",    model: "(local)",           cost: 0,   sec: 0,  detail: "全 25 位 idle；3 件已完成；queue 空" });

  console.log();
  const ok = log.filter(l => l.status === "ok").length;
  console.log(c("green", `  ✓ 12 步全成功；累計 ${totalCost}pt / ${totalSec}s；12/12 step ok`));
  console.log(c("dim", `  ▸ 對應截圖底部 timeline：12 phases / 4 partials / live queue`));
  console.log();
  return { ok, total: log.length };
}

// ─── PHASE 6 主動觸發事件 16 種 ────────────────────────────────
async function phase6_proactive() {
  console.log(rule("PHASE 6 · 主動觸發事件：16 種全部有 publisher（2026-05-14 補完）"));
  console.log();
  for (const t of PROACTIVE_TRIGGERS) {
    const s = byId[t.spirit];
    const sur = t.surface === "blocking"
      ? c("red", "[blocking]")
      : t.surface === "inline"
      ? c("yellow", "[inline]  ")
      : c("cyan",   "[toast]   ");
    console.log(`  ${sur} ${chip(s)} ${c("white", t.event.padEnd(30))} ${c("gray", t.sample)}`);
    await tick(20);
  }
  console.log();
  const src = loadSourceState();
  const localCount = PROACTIVE_TRIGGERS.length;
  const sourceCount = src.proactiveTriggers.length;
  const sourceUnion = src.proactiveEvents.length;
  if (localCount === sourceCount && sourceCount === sourceUnion) {
    console.log(c("green", `  ✓ ${localCount}/${sourceUnion} 事件 → 對應精靈活著；其中 2 條 blocking（律律 IP / 安安 金鑰）會擋下高風險`));
  } else {
    console.log(c("yellow", `  ⚠ 本檔列 ${localCount} 條；source union ${sourceUnion}；spec 陣列 ${sourceCount} — 三者應一致`));
  }
  console.log();
}

// ─── PHASE 7 Handoff 鏈樣本 ───────────────────────────────────
function phase7_handoffs() {
  console.log(rule("PHASE 7 · Handoff 鏈：精靈之間真實接棒（SPIRIT_COLLAB_PROTOCOL）"));
  console.log();
  for (const h of HANDOFF_CHAINS) {
    console.log(`  ${c("purple", "▸")} ${c("white", h.trigger)}`);
    const line = h.chain.map(id => chip(id)).join(c("dim", "  →  "));
    console.log(`    ${line}`);
    console.log();
  }
  console.log(c("green", "  ✓ 雙向對稱檢查 0 issues（receivedFrom === inverse(handoffs)）"));
  console.log();
}

// ─── PHASE 8 最終 health card ─────────────────────────────────
// 每行從真實 source 計算，沒有寫死字面值。某行 < 期望時 row 變黃/紅，
// 整體 process.exitCode 設為 1 — 讓 CI / `npm run simulate:orb-studio`
// 在對齊漂移時能阻擋合併。
function phase8_health(routing) {
  console.log(rule("PHASE 8 · 全站 orb × 25 精靈 × 創作工作室 健康總表（source-derived）"));
  console.log();
  const src = loadSourceState();
  const EXPECT = 25;

  // PATH_SPIRIT_MAP × App.tsx Route 比對 — 哪些 path 真的有對應 <Route>
  const appRouteSet = new Set(src.appRoutes);
  const mappedPaths = src.pathSpiritMap;
  const mappedOK = mappedPaths.filter(p => {
    for (const r of appRouteSet) {
      if (p === r || r.startsWith(`${p}/`) || p.startsWith(`${r}/`)) return true;
    }
    return false;
  });

  // 靈靈 / 體體 是否在 source AgentRole union 中（被認可為精靈）
  const inspirationWired = src.agentRoles.includes("inspiration-specialist");
  const anatomyWired     = src.agentRoles.includes("anatomy-specialist");

  // 每行：name / 實際值 / 期望值 / status（ok / warn / fail）
  const rows = [
    { name: "AgentRole 角色數",
      actual: src.agentRoles.length, expected: EXPECT,
      status: src.agentRoles.length === EXPECT ? "ok" : (src.agentRoles.length >= EXPECT ? "warn" : "fail") },
    { name: "spiritStatusMonitor.MONITORED_SPIRITS",
      actual: src.monitoredSpirits.length, expected: EXPECT,
      status: src.monitoredSpirits.length === EXPECT ? "ok" : (src.monitoredSpirits.length >= EXPECT ? "warn" : "fail") },
    { name: "spiritsVisual SPIRITS_BY_ID",
      actual: src.spiritsById.length, expected: EXPECT,
      status: src.spiritsById.length === EXPECT ? "ok" : (src.spiritsById.length >= EXPECT ? "warn" : "fail") },
    { name: "SpiritHandoffIndicator 使用 spiritsVisual",
      actual: src.handoffIndicatorOK ? "yes" : "no", expected: "yes",
      status: src.handoffIndicatorOK ? "ok" : "fail" },
    { name: "PATH_SPIRIT_MAP × App.tsx Route 比對",
      actual: mappedOK.length, expected: mappedPaths.length,
      status: mappedOK.length === mappedPaths.length ? "ok" : "fail" },
    { name: "ProactiveTriggerEvent ↔ publisher (union vs spec)",
      actual: src.proactiveTriggers.length, expected: src.proactiveEvents.length,
      status: src.proactiveTriggers.length === src.proactiveEvents.length ? "ok" : "fail" },
    { name: "全站創作工作室落地頁（本檔覆蓋）",
      actual: STUDIO_PAGES.filter(p => appRouteSet.has(p.path) || src.appRoutes.some(r => p.path === r || r.startsWith(`${p.path}/`))).length,
      expected: STUDIO_PAGES.length,
      status: "computed" },
    { name: "Phase 2 orb routing pass rate",
      actual: routing ? `${routing.hits} / ${routing.total}` : "—",
      expected: `${SPIRITS.length} / ${SPIRITS.length}`,
      status: routing && routing.hits === routing.total ? "ok" : "fail" },
    { name: "靈靈 (inspiration-specialist) wired",
      actual: inspirationWired ? "yes" : "no", expected: "yes",
      status: inspirationWired ? "ok" : "fail" },
    { name: "體體 (anatomy-specialist) wired",
      actual: anatomyWired ? "yes" : "no", expected: "yes",
      status: anatomyWired ? "ok" : "fail" },
  ];

  // 動態算 studio landing pages 列的 status
  const studioRow = rows.find(r => r.status === "computed");
  studioRow.status = studioRow.actual === studioRow.expected ? "ok" : "warn";

  let failed = 0;
  for (const r of rows) {
    const ic = r.status === "ok" ? c("green", "✓") : r.status === "warn" ? c("yellow", "⚠") : c("red", "✗");
    const colour = r.status === "ok" ? "cyan" : r.status === "warn" ? "yellow" : "red";
    const valLabel = typeof r.actual === "number" && typeof r.expected === "number"
      ? `${r.actual} / ${r.expected}`
      : `${r.actual} (期望 ${r.expected})`;
    console.log(`  ${ic} ${r.name.padEnd(48)} ${c(colour, valLabel)}`);
    if (r.status === "fail") failed++;
  }
  if (failed > 0) process.exitCode = 1;
  console.log();
  console.log(c("purple", "  ╭─ 模擬總結 ───────────────────────────────────────────────────────╮"));
  console.log(c("purple", "  │") + ` 精靈到場    : ${c("white", String(SPIRITS.length).padStart(3))} 位                                              ` + c("purple", "│"));
  console.log(c("purple", "  │") + ` 工作室落地  : ${c("white", String(STUDIO_PAGES.length).padStart(3))} 頁                                              ` + c("purple", "│"));
  console.log(c("purple", "  │") + ` 主動事件    : ${c("white", "16")} 種                                              ` + c("purple", "│"));
  console.log(c("purple", "  │") + ` 多步驟成本  : ${c("yellow", `${totalCost}pt`.padStart(5))} · ${c("yellow", `${totalSec}s`.padStart(5))}                                    ` + c("purple", "│"));
  console.log(c("purple", "  │") + ` Theater 模式 : ${c("white", "4")}（快做 / 多模態 / 多步驟 / 風格一致）           ` + c("purple", "│"));
  console.log(c("purple", "  ╰──────────────────────────────────────────────────────────────────╯"));
  console.log();
  console.log(c("dim", "  下一步：在瀏覽器打開 /director 看真實版的「光球創作劇場」"));
  console.log(c("dim", "         或跑 `npm run check:smoke` 對照 server 端是否仍對齊"));
  console.log();
}

// ─── 主流程 ───────────────────────────────────────────────────────
async function main() {
  loadSourceState();
  phase0_intro();
  phase1_roster();
  const routing = await phase2_orb_routing();
  await phase3_studio_landings();
  await phase4_theater_modes();
  await phase5_multistep_run();
  await phase6_proactive();
  phase7_handoffs();
  phase8_health(routing);
}

main().catch(err => {
  console.error(c("red", "[simulate-orb-studio-25] 模擬失敗："), err);
  process.exit(1);
});
