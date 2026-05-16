#!/usr/bin/env node
/**
 * scripts/simulate-full-site-orb.mjs
 *
 * 模擬「真實全站光球代理互動」— 25 精靈協作與所有功能。
 *
 * 對應 AI Director 主畫面：
 *   PHASE 01 · 02 · 03            光球創作場
 *   四種演示模式                    快速演示 / 多模態演示 / 多步驟演示 / 風格一致演示
 *   光球代理生成預覽                C0 + V1 ~ V4 五版同框
 *   全站光球代理 · 精靈協作圖
 *     提示詞 → 意圖延伸 → 上下文壓縮 → 路由 → 多軌 prompt → 鎖定
 *     心智圖 → 流程圖 → 進程圖（phase 7/16）
 *   即時 queue                     partial 1 / partial 2 / partial 3 → 評分回收
 *
 * 純 Node.js（zero dep），不打網路，靠 console + ANSI 把全 16 個 phase
 * 的協作鏈印出來，覆蓋 25 位精靈與所有功能模塊。
 *
 * 跑：
 *   node scripts/simulate-full-site-orb.mjs
 *   node scripts/simulate-full-site-orb.mjs --mode multimodal
 *   node scripts/simulate-full-site-orb.mjs --prompt "城市夜景帶霓虹" --no-color
 *   npm run simulate:orb
 *
 * 旗標：
 *   --prompt <text>             覆寫預設提示詞
 *   --mode <quick|multimodal|multistep|style>  演示模式（預設 quick）
 *   --no-color                  關掉 ANSI 色碼
 *   --quiet                     只印 summary
 *   --tick <ms>                 partial 之間節奏（預設 0 = 不延遲，方便 CI）
 */

import { setTimeout as sleep } from "node:timers/promises";
import { argv, stdout } from "node:process";

// ─── ANSI 色碼（可被 --no-color 關掉） ─────────────────────────
const RAW_COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  purple: "\x1b[38;5;141m",
  pink: "\x1b[38;5;213m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
  white: "\x1b[97m",
};
let C = { ...RAW_COLORS };
function disableColor() {
  C = Object.fromEntries(Object.keys(RAW_COLORS).map((k) => [k, ""]));
}

// ─── CLI 解析 ─────────────────────────────────────────────────
const args = argv.slice(2);
function readFlag(name, fallback) {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  return args[i + 1];
}
const NO_COLOR = args.includes("--no-color") || !stdout.isTTY;
const QUIET = args.includes("--quiet");
const MODE = readFlag("--mode", "quick");
const PROMPT = readFlag(
  "--prompt",
  "夕陽下的少女側臉、電影感、淺景深、35mm 底片質感",
);
const TICK = Number(readFlag("--tick", "0"));
if (NO_COLOR) disableColor();

// ─── 25 位精靈（與 shared/orb-agent-roles.ts SPIRIT_NICKNAMES 對齊） ──
const SPIRITS = {
  // 8 specialist
  "image-specialist":      { nick: "圖圖", family: "specialist", emoji: "🎨" },
  "video-specialist":      { nick: "影影", family: "specialist", emoji: "🎬" },
  "music-specialist":      { nick: "音音", family: "specialist", emoji: "🎵" },
  "voice-specialist":      { nick: "聲聲", family: "specialist", emoji: "🎙" },
  "training-specialist":   { nick: "練練", family: "specialist", emoji: "🧠" },
  "learning-specialist":   { nick: "學學", family: "specialist", emoji: "📚" },
  "inspiration-specialist":{ nick: "靈靈", family: "specialist", emoji: "✨" },
  "anatomy-specialist":    { nick: "體體", family: "specialist", emoji: "🦴" },
  // 6 role
  "director":              { nick: "導導", family: "role",       emoji: "🎯" },
  "composer":              { nick: "編編", family: "role",       emoji: "🧩" },
  "critic":                { nick: "品品", family: "role",       emoji: "🔍" },
  "researcher":            { nick: "查查", family: "role",       emoji: "📡" },
  "navigator":             { nick: "路路", family: "role",       emoji: "🧭" },
  "companion":             { nick: "暖暖", family: "role",       emoji: "🫧" },
  // 3 proactive
  "accountant":            { nick: "財財", family: "proactive",  emoji: "💰" },
  "quality-coach":         { nick: "巧巧", family: "proactive",  emoji: "🎯" },
  "inspector":             { nick: "守守", family: "proactive",  emoji: "🛡" },
  // 8 新增
  "legal-advisor":         { nick: "律律", family: "role",       emoji: "⚖" },
  "security-guard":        { nick: "安安", family: "role",       emoji: "🔐" },
  "community-manager":     { nick: "群群", family: "role",       emoji: "📣" },
  "chief-orchestrator":    { nick: "總總", family: "role",       emoji: "👑" },
  "onboarding-coach":      { nick: "帶帶", family: "role",       emoji: "🌱" },
  "notes-curator":         { nick: "記記", family: "role",       emoji: "📒" },
  "settings-detail":       { nick: "細細", family: "role",       emoji: "⚙" },
  "plan-executor":         { nick: "步步", family: "role",       emoji: "🚶" },
};
const ALL_25 = Object.keys(SPIRITS);

// ─── 5 顆光球代理變體（對應畫面中 C0 + V1~V4） ─────────────────
const ORB_VARIANTS = [
  { id: "C0", seed: "#dbcf1f2", lens: "35mm",  fStop: "f/1.4", iso: 200, tag: "主版" },
  { id: "V1", seed: "#0c2dav1", lens: "35mm",  fStop: "f/1.4", iso: 400, tag: "中焦冷調" },
  { id: "V2", seed: "#7fa1tv2", lens: "24mm",  fStop: "f/1.8", iso: 320, tag: "廣角逆光" },
  { id: "V3", seed: "#1dabtv1", lens: "35mm",  fStop: "f/2.8", iso: 500, tag: "深景深" },
  { id: "V4", seed: "#7eedfb1", lens: "24mm",  fStop: "f/1.8", iso: 320, tag: "rule of thirds" },
];

// ─── 演示模式（對應畫面四張卡） ─────────────────────────────
const DEMO_MODES = {
  quick: {
    label: "快速演示",
    desc: "一句話 → 直送單一工具 → 8 秒內出第一版可用素材",
    eta: "≈ 8 秒",
    outputs: "1 張圖（C0 主版）",
    cards: [
      "感應層 1/3：解析輸入提示詞、鎖定唯一模板（圖/影/音）",
      "派工層 2/3：直送對應工具，省去舊有工具編排成本",
      "回收層 3/3：輸出 fal queue → 取回成品及可重疊 seed",
    ],
  },
  multimodal: {
    label: "多模態演示",
    desc: "商品主視覺 × 影片 × 音樂 — 一句話跨四模態",
    eta: "8–12 分鐘",
    outputs: "1 海報 + 1 短片 + 1 段 BGM + 1 段旁白",
    cards: [
      "圖圖 → V1~V4 五版同框",
      "影影 → 圖轉影 5s 動畫",
      "音音 → 30s lo-fi BGM",
      "聲聲 → 中文女聲旁白",
    ],
  },
  multistep: {
    query: "社群短影音 9:16 一刀剪",
    label: "多步驟演示",
    desc: "腳本 → 分鏡 → 出圖 → 動畫 → 配樂 → 上稿一條龍",
    eta: "10–15 分鐘",
    outputs: "1 條 9:16 短影音 + 1 段文案",
    cards: [
      "導導 → 步步 8 段步驟拆解",
      "圖圖 × 影影 × 音音 接力",
      "群群 → 社群文案 + tag",
    ],
  },
  style: {
    label: "風格一致演示",
    desc: "活動主視覺海報 — 五版鎖定同一風格 seed",
    eta: "6–10 分鐘",
    outputs: "1 海報 + 1 廣告文案編輯",
    cards: [
      "練練 → 訓 LoRA 鎖定風格",
      "巧巧 → 鎖風格參數（film-grain × rule of thirds）",
      "群群 → 廣告文案編輯",
    ],
  },
};

// ─── 16-phase 全站時間軸（對應畫面 Timeline phase 7/16） ───────
// 每個 phase 指派一組精靈，所有 25 位都會在某一個 phase 上場 ── 配合
// SPIRIT_COLLAB_PROTOCOL 中典型的 handoff 順序。
const PHASES = [
  {
    n: 1, name: "感應 · 入口",
    layer: "PHASE 01 / 感應層 (1/3)",
    spirits: ["companion", "onboarding-coach"],
    dialog: [
      ["companion", "嗨～收到啦，幫你叫導導排個計畫。"],
      ["onboarding-coach", "(若你是第一次用，這條我會在旁邊備註小提示)"],
    ],
  },
  {
    n: 2, name: "意圖延伸 · intent expansion",
    layer: "PHASE 01 / 感應層 (1/3)",
    spirits: ["director", "inspiration-specialist"],
    dialog: [
      ["director", "目標：肖像主視覺，模態=圖，風格=電影感，鏡頭=35mm。"],
      ["inspiration-specialist", "風格詞補：golden-hour rim-light、Kodak Portra 400、淺景深 bokeh。"],
    ],
  },
  {
    n: 3, name: "上下文壓縮 · context compression",
    layer: "PHASE 01 / 感應層 (1/3)",
    spirits: ["notes-curator", "researcher"],
    dialog: [
      ["notes-curator", "撈到上次同 user 的 3 條 prompt + 偏好：紫光球 / 35mm / 主版優先。"],
      ["researcher", "比對近期 trend：film-grain × 逆光 × 中焦 — 命中率 78%。"],
    ],
  },
  {
    n: 4, name: "路由 · router",
    layer: "PHASE 02 / 派工層 (2/3)",
    spirits: ["chief-orchestrator", "navigator"],
    dialog: [
      ["chief-orchestrator", "分流：主軌 → 圖圖（image-specialist）；副軌 → 影影備援。"],
      ["navigator", "目的地：/image-studio，已預載 prompt 與 35mm preset。"],
    ],
  },
  {
    n: 5, name: "多軌 prompt · multi-track",
    layer: "PHASE 02 / 派工層 (2/3)",
    spirits: ["composer", "critic"],
    dialog: [
      ["composer", "拆 5 軌 prompt：C0 主版 + V1~V4 共用 seed 變奏。"],
      ["critic", "預審：主軌 ok / V2 廣角逆光提醒過曝風險 / V4 構圖務必三分線。"],
    ],
  },
  {
    n: 6, name: "鎖定 · lock prompt",
    layer: "PHASE 02 / 派工層 (2/3)",
    spirits: ["quality-coach", "settings-detail"],
    dialog: [
      ["quality-coach", "鎖：cinematic + film-grain + rule-of-thirds + active aesthetic。"],
      ["settings-detail", "預設模型：fal-ai/flux/dev；ISO/光圈/焦段已寫入 preset。"],
    ],
  },
  {
    n: 7, name: "派工 · dispatch → fal queue",
    layer: "PHASE 02 / 派工層 (2/3)  ✦ LIVE",
    spirits: ["image-specialist", "accountant"],
    dialog: [
      ["accountant", "5 軌總估 ≈ 0.42 點，餘額 12.30，放行。"],
      ["image-specialist", "5 軌平行投放：image_generator × 5 → fal queue。"],
    ],
    isLive: true,
  },
  {
    n: 8, name: "回收 · partial 1",
    layer: "PHASE 03 / 回收層 (3/3)",
    spirits: ["image-specialist"],
    streamPartial: 1,
    dialog: [
      ["image-specialist", "partial 1 → C0 / V1 縮圖 8% 預覽（fal queue position=2）。"],
    ],
  },
  {
    n: 9, name: "回收 · partial 2",
    layer: "PHASE 03 / 回收層 (3/3)",
    spirits: ["image-specialist"],
    streamPartial: 2,
    dialog: [
      ["image-specialist", "partial 2 → V2/V3 中焦 + 廣角各出一版 42%。"],
    ],
  },
  {
    n: 10, name: "回收 · partial 3 + 落地",
    layer: "PHASE 03 / 回收層 (3/3)",
    spirits: ["image-specialist", "composer"],
    streamPartial: 3,
    dialog: [
      ["image-specialist", "partial 3 → 5 版全收，seed 已寫回 history。"],
      ["composer", "已 dispatch fillPrompt + submit 進 /image-studio。"],
    ],
  },
  {
    n: 11, name: "評分 · critic + 預算結算",
    layer: "PHASE 03 / 回收層 (3/3)",
    spirits: ["critic", "accountant"],
    dialog: [
      ["critic", "排序 C0 ≻ V3 ≻ V1 ≻ V4 ≻ V2；建議微調 V2 高光。"],
      ["accountant", "實扣 0.39 點，回流 0.03（V4 重跑省下來）。"],
    ],
  },
  {
    n: 12, name: "跨模態接力 · 圖→影",
    layer: "PHASE 04 / 跨模態",
    spirits: ["video-specialist"],
    dialog: [
      ["video-specialist", "把 C0 餵 image-to-video，5s 緩推鏡頭，sora-2 預估 65s。"],
    ],
  },
  {
    n: 13, name: "配樂 · music",
    layer: "PHASE 04 / 跨模態",
    spirits: ["music-specialist"],
    dialog: [
      ["music-specialist", "30s lo-fi 鋼琴墊樂，BPM 72，淡入淡出。"],
    ],
  },
  {
    n: 14, name: "配音 · voice",
    layer: "PHASE 04 / 跨模態",
    spirits: ["voice-specialist"],
    dialog: [
      ["voice-specialist", "中文女聲，溫柔，6s 旁白 + 1s 留白。"],
    ],
  },
  {
    n: 15, name: "風格保留 · LoRA 訓練 + 學習",
    layer: "PHASE 05 / 風格保留",
    spirits: ["training-specialist", "learning-specialist", "anatomy-specialist"],
    dialog: [
      ["training-specialist", "用本次 5 版當 dataset，30 步快速 LoRA，估 4 分鐘。"],
      ["learning-specialist", "已在 /learn-hub 收一篇『35mm 底片質感速成』。"],
      ["anatomy-specialist", "若加人物動作，肌肉/骨架 reference 我已備好。"],
    ],
  },
  {
    n: 16, name: "上線 + 收尾 · publish + audit",
    layer: "PHASE 06 / 上線",
    spirits: [
      "community-manager", "legal-advisor", "security-guard",
      "plan-executor", "inspector", "navigator",
    ],
    dialog: [
      ["legal-advisor", "IP 風險：未偵測到名人特徵，✓ 放行。"],
      ["security-guard", "上傳走 HTTPS + 簽章 URL，✓。"],
      ["community-manager", "排程 IG 9:16 主視覺 + caption 草稿。"],
      ["plan-executor", "整條 6 步驟跑完，已寫回 PlanRecord done。"],
      ["inspector", "巡邏：5 版縮圖連結 200 OK，無壞鏈。"],
      ["navigator", "已帶你到 /history?session=latest 可回看全紀錄。"],
    ],
  },
];

// ─── 對應「全站光球代理 · 精靈協作圖」的三種視圖 ──────────────
const VIEW_MODES = [
  { id: "mind",  label: "心智圖", desc: "節點：25 精靈 × 16 phase × 5 變體", focus: "誰跟誰連" },
  { id: "flow",  label: "流程圖", desc: "提示詞 → 意圖 → 壓縮 → 路由 → 多軌 → 鎖 → 派 → 收", focus: "資料怎麼流" },
  { id: "phase", label: "進程圖", desc: "Timeline 16 段 + LIVE 高亮", focus: "現在到哪了" },
];

// ─── 輸出工具 ─────────────────────────────────────────────────
function paint(text, color) {
  return `${C[color] ?? ""}${text}${C.reset}`;
}
function hr(char = "─", color = "gray") {
  return paint(char.repeat(72), color);
}
function box(title, color = "purple") {
  const inner = ` ${title} `;
  const bar = "═".repeat(Math.max(2, inner.length));
  console.log(paint(`╔${bar}╗`, color));
  console.log(paint(`║${inner}║`, color));
  console.log(paint(`╚${bar}╝`, color));
}
function header(text) {
  console.log("\n" + paint(`▶ ${text}`, "cyan"));
  console.log(hr());
}
function bullet(text) {
  console.log(`  ${paint("·", "gray")} ${text}`);
}
function progressBar(pct, width = 30, color = "magenta") {
  const filled = Math.round((pct / 100) * width);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  return `${paint(bar, color)} ${String(pct).padStart(3, " ")}%`;
}

// ─── 主流程 ───────────────────────────────────────────────────
async function main() {
  // ── 頂部 banner：對應畫面 AI Director header
  if (!QUIET) {
    box("AI Director · 全站光球代理模擬", "purple");
    console.log(paint("  PHASE 01 · 02 · 03   光球創作場", "magenta"));
    console.log(paint("  從一個提示詞開始 · 即時生成", "white"));
    console.log();
  }

  // ── 演示模式總覽（畫面四張卡片）
  if (!QUIET) {
    header("演示模式（4 種）");
    for (const [key, mode] of Object.entries(DEMO_MODES)) {
      const arrow = key === MODE ? paint("●", "pink") : paint("○", "gray");
      const label = key === MODE ? paint(mode.label, "bold") : paint(mode.label, "gray");
      console.log(`  ${arrow} ${label}   ${paint(mode.eta, "yellow")}`);
      console.log(`     ${paint(mode.desc, "gray")}`);
      console.log(`     ${paint("輸出：", "gray")}${mode.outputs}`);
      for (const card of mode.cards) {
        console.log(`       · ${card}`);
      }
    }
  }

  // ── 提示詞區
  const chosen = DEMO_MODES[MODE] ?? DEMO_MODES.quick;
  if (!QUIET) {
    header("輸入提示詞");
    console.log(`  ${paint("✎", "pink")} ${paint(PROMPT, "white")}`);
    const counter = `${PROMPT.length}/400`;
    console.log(`     ${paint(counter, "gray")}    ${paint(`輸出：${chosen.outputs} · ${chosen.eta}`, "cyan")}`);
  }

  // ── 光球感應卡（紫色光球 + 美學詞）
  if (!QUIET) {
    header("光球感應");
    console.log(`  ${paint("◉", "purple")}  ${paint("明亮個好電影底蘊宣實境的美學", "white")}`);
    console.log(`      ${paint("cinematic · film-grain · rule-of-thirds · active", "magenta")}`);
  }

  // ── 5 顆光球代理變體（畫面五張卡）
  if (!QUIET) {
    header("光球代理生成預覽（C0 + V1~V4）");
    for (const v of ORB_VARIANTS) {
      const left = `  ${paint(v.id.padEnd(3), "bold")} ${paint(v.seed, "gray")}`;
      const mid  = `${v.lens} ${v.fStop} ISO ${v.iso}`;
      const right = paint(v.tag, "magenta");
      console.log(`${left}   ${mid}   ${right}`);
    }
  }

  // ── 視圖模式（心智圖 / 流程圖 / 進程圖）
  if (!QUIET) {
    header("全站光球代理 · 精靈協作圖");
    for (const view of VIEW_MODES) {
      console.log(`  ${paint("◆", "cyan")} ${paint(view.label, "bold")}  ${paint(view.desc, "gray")}`);
      console.log(`      ${paint("焦點：", "gray")}${view.focus}`);
    }
  }

  // ── 走 16 phase（畫面右下 LIVE timeline）
  // QUIET 模式下不打字、不睡 TICK；只跑 fired 累計給 summary 用。
  if (!QUIET) header("Timeline · 16 段協作（LIVE）");
  const fired = new Set();
  for (const ph of PHASES) {
    if (!QUIET) {
      const tag = ph.isLive ? paint(" ◉ LIVE", "pink") : "";
      const head = `phase ${String(ph.n).padStart(2, "0")}/16 · ${ph.name}${tag}`;
      console.log("\n" + paint(head, "cyan"));
      console.log("  " + paint(ph.layer, "gray"));
    }

    for (const role of ph.spirits) {
      fired.add(role);
      if (!QUIET) {
        const sp = SPIRITS[role];
        bullet(`${sp.emoji} ${paint(sp.nick, "bold")} ${paint(`(${role})`, "gray")}  ↻ on-stage`);
      }
    }

    if (!QUIET) {
      for (const [role, line] of ph.dialog) {
        const sp = SPIRITS[role];
        console.log(`    ${paint("›", "magenta")} ${paint(sp.nick, "yellow")}：${line}`);
      }

      if (ph.streamPartial) {
        const pct = [25, 65, 100][ph.streamPartial - 1];
        console.log(`    ${paint("queue", "gray")}  ${progressBar(pct)}  ${paint(`partial ${ph.streamPartial}`, "pink")}`);
        if (TICK > 0) await sleep(TICK);
      }
    }
  }

  // ── 覆蓋率報表（25 位都吃過？）
  const missing = ALL_25.filter((r) => !fired.has(r));
  if (!QUIET) {
    header("精靈覆蓋率");
    const familyBuckets = { specialist: [], role: [], proactive: [] };
    for (const r of ALL_25) familyBuckets[SPIRITS[r].family].push(r);

    for (const [fam, list] of Object.entries(familyBuckets)) {
      const hit = list.filter((r) => fired.has(r));
      console.log(
        `  ${paint(fam.padEnd(10), "cyan")} ${paint(`${hit.length}/${list.length}`, "bold")}  ` +
        list.map((r) => fired.has(r)
          ? paint(SPIRITS[r].nick, "green")
          : paint(SPIRITS[r].nick, "red")).join(" "),
      );
    }
    console.log();
    if (missing.length === 0) {
      console.log(paint("  ✓ 25 / 25 精靈全部協作就位", "green"));
    } else {
      console.log(paint(`  ✗ ${missing.length} 位未上場：${missing.map((r) => SPIRITS[r].nick).join(" ")}`, "red"));
    }
  }

  // ── 最終 summary
  header("Summary");
  console.log(`  mode      : ${paint(chosen.label, "bold")}`);
  console.log(`  prompt    : ${PROMPT}`);
  console.log(`  variants  : ${ORB_VARIANTS.map((v) => v.id).join(", ")}`);
  console.log(`  phases    : ${PHASES.length} / 16`);
  console.log(`  spirits   : ${fired.size} / 25`);
  console.log(`  result    : ${paint(missing.length === 0 ? "PASS" : "INCOMPLETE", missing.length === 0 ? "green" : "red")}`);
  console.log();

  process.exit(missing.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(paint(`✗ simulate-full-site-orb crashed: ${err?.message ?? err}`, "red"));
  process.exit(2);
});
