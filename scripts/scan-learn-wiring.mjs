#!/usr/bin/env node
// ============================================================================
// scan-learn-wiring.mjs — P6 /learn 補丁的免建置靜態煙霧掃描
// ----------------------------------------------------------------------------
// 不需 build / 不需 DB / 不需金鑰。純讀檔，靜態證明三件事：
//   1) 每個面板都接到「校正後的真實 procedure」（aiModels.list / news.list /
//      learnHub.list / credits.myBalance / dashboard.* / agentModelPicks.recordPick /
//      orbProxy.unifiedSearch / admin.apiKeysStatus）。
//   2) Research 接縫預設 mock（VITE_RESEARCH_PROVIDER 預設 mock）。
//   3) 嚴格加法：new-files 內不 import server/ 或 drizzle/（不碰後端）。
//
// 用法：node tests/scan-learn-wiring.mjs <repoRootOrPackageNewFiles>
//   - 傳入「已套用本補丁的 repo 根目錄」→ 掃 client/src
//   - 不傳 → 預設掃 repo 正式碼 client/src（W1-7 修正：原 new-files 暫存路徑已收編）
// 退出碼非 0 = 有缺漏。
// ============================================================================
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const arg = process.argv[2];
const base = arg
  ? (existsSync(join(arg, "client/src/shells/learn")) ? join(arg, "client/src") : arg)
  : join(__dirname, "..", "client", "src");

const read = (p) => readFileSync(join(base, p), "utf8");
let fail = 0;
const ok = (m) => console.log("  ✓ " + m);
const bad = (m) => { console.log("  ✗ " + m); fail++; };

console.log("P6 /learn wiring scan @", base);

// 1) 面板 → 真實 procedure
const checks = [
  ["shells/learn/panels/AIModelHubPanel.tsx", ["aiModels.list", "agentModelPicks.recordPick"]],
  ["shells/learn/panels/NewsPanel.tsx", ["news.list"]],
  ["shells/learn/panels/LearnDocsPanel.tsx", ["learnHub.list", "learnHub.categories"]],
  ["shells/learn/panels/CreditsUsagePanel.tsx", ["credits.myBalance", "dashboard.myStats", "dashboard.myUsageLogs"]],
  ["shells/learn/panels/ApiKeysPanel.tsx", ["admin.apiKeysStatus"]],
  ["adapters/research.ts", ["orbProxy.unifiedSearch"]],
];
console.log("\n[1] 面板接真實 procedure");
for (const [file, procs] of checks) {
  let src;
  try { src = read(file); } catch { bad(`${file} 不存在`); continue; }
  for (const p of procs) src.includes(p) ? ok(`${file} → ${p}`) : bad(`${file} 缺 ${p}`);
}

// 2) Research 預設 mock
console.log("\n[2] Research 接縫 mock-default");
{
  const src = read("adapters/research.ts");
  /VITE_RESEARCH_PROVIDER/.test(src) ? ok("讀 VITE_RESEARCH_PROVIDER") : bad("未讀 VITE_RESEARCH_PROVIDER");
  /return\s+"mock"/.test(src) ? ok("預設回 mock") : bad("預設未回 mock");
}
{
  const src = read("shells/learn/learnFlags.ts");
  /SHELL_LEARN_RICH[^]*true/.test(src) ? ok("SHELL_LEARN_RICH 預設 true") : bad("SHELL_LEARN_RICH 預設非 true");
}

// 3) 加法：不碰 server/ / drizzle/
console.log("\n[3] 嚴格加法（不 import server/ 或 drizzle/）");
const files = [
  "adapters/research.ts",
  "shells/learn/LearnShell.tsx", "shells/learn/LearnHome.tsx",
  "shells/learn/learnFlags.ts", "shells/learn/learnContent.ts",
  "shells/learn/panels/AIModelHubPanel.tsx", "shells/learn/panels/NewsPanel.tsx",
  "shells/learn/panels/LearnDocsPanel.tsx", "shells/learn/panels/CreditsUsagePanel.tsx",
  "shells/learn/panels/ApiKeysPanel.tsx", "shells/learn/panels/ResearchPanel.tsx",
];
let leak = 0;
for (const f of files) {
  const src = read(f);
  if (/from\s+["'][^"']*\/(server|drizzle)\//.test(src) || /from\s+["']@shared\/schema["']/.test(src)) {
    bad(`${f} 直接 import server/drizzle`); leak++;
  }
}
if (!leak) ok(`${files.length} 個檔皆未 import server/ 或 drizzle/`);

// 4) 富 shell 仍走 P0 接縫（reuse，不重造）
console.log("\n[4] 沿用 P0 接縫");
{
  const src = read("shells/learn/LearnShell.tsx");
  /@\/shells\/ShellFrame/.test(src) ? ok("旗標關閉退回 P0 ShellFrame") : bad("未保留 P0 ShellFrame 退路");
  /@\/app\/lazyPages/.test(src) ? ok("深頁 re-home 沿用 P0 lazyPages") : bad("未沿用 P0 lazyPages");
}
{
  const src = read("shells/learn/panels/ResearchPanel.tsx");
  /@\/providers\/SpineProvider/.test(src) ? ok("ResearchPanel 讀 P0 SpineProvider 故障注入") : bad("未接 SpineProvider");
}

console.log(fail ? `\n✗ scan 失敗：${fail} 項缺漏` : "\n✓ P6 /learn wiring 全綠：面板接真實 procedure、Research mock-default、嚴格加法。");
process.exit(fail ? 1 : 0);
