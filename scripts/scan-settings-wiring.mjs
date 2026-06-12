#!/usr/bin/env node
// ============================================================================
// scan-settings-wiring.mjs — /settings 補丁的免建置靜態煙霧掃描
// ----------------------------------------------------------------------------
// 不需 build / DB / 金鑰。純讀檔，靜態證明：
//   1) 面板/分頁接「校正後真實 procedure」（settings.get/update、admin.allUsers/updateQuota/
//      updateRole/usageLogs/systemStats/allBackgroundJobs/apiKeysStatus、agentPreferences.*、
//      langsmith.status、credits/dashboard…）。
//   2) provider 切換走 P0 SpineProvider（hf|gemini|fal|mock）。
//   3) RBAC：admin 後台讀 rbac.ts（useRole / roleAtLeast / canSeeAdminTab）。
//   4) 嚴格加法：不 import server/ 或 drizzle/。
// 用法：node tests/scan-settings-wiring.mjs [repoRoot]
// ============================================================================
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const arg = process.argv[2];
const base = arg
  ? (existsSync(join(arg, "client/src/shells/settings")) ? join(arg, "client/src") : arg)
  : join(__dirname, "..", "client", "src"); // W1-7 修正：原 new-files 暫存路徑已收編
const read = (p) => readFileSync(join(base, p), "utf8");
let fail = 0;
const ok = (m) => console.log("  ✓ " + m);
const bad = (m) => { console.log("  ✗ " + m); fail++; };

console.log("/settings wiring scan @", base);

console.log("\n[1] 分頁接真實 procedure");
const checks = [
  ["shells/settings/panels/GeneralSettingsPanel.tsx", ["settings.get", "settings.update"]],
  ["shells/settings/panels/AgentPrefsPanel.tsx", ["agentPreferences.getPreferences", "agentPreferences.updatePreferences"]],
  ["shells/settings/panels/ObservabilityPanel.tsx", ["langsmith.status", "admin.allBackgroundJobs", "admin.systemStats"]],
  ["shells/settings/admin/UsersCreditsTab.tsx", ["admin.allUsers", "admin.updateQuota", "admin.updateRole"]],
  ["shells/settings/admin/FeatureFlagsTab.tsx", ["settings.update", "@/config/featureFlags"]],
  ["shells/settings/admin/AuditTab.tsx", ["admin.usageLogs", "admin.apiKeysStatus"]],
  ["shells/settings/admin/ContentTab.tsx", ["aiModels.list", "news.list", "learnHub.categories"]],
  ["shells/settings/admin/DataRepairTab.tsx", ["admin.allBackgroundJobs"]],
];
for (const [file, procs] of checks) {
  let src; try { src = read(file); } catch { bad(`${file} 不存在`); continue; }
  for (const p of procs) src.includes(p) ? ok(`${file} → ${p}`) : bad(`${file} 缺 ${p}`);
}

console.log("\n[2] provider 切換走 P0 SpineProvider（hf|gemini|fal|mock）");
{
  const src = read("shells/settings/panels/ProviderPanel.tsx");
  /@\/providers\/SpineProvider/.test(src) ? ok("讀 SpineProvider") : bad("未讀 SpineProvider");
  /setProvider/.test(src) ? ok("呼叫 setProvider") : bad("未呼叫 setProvider");
  (/"hf"/.test(src) && /"gemini"/.test(src) && /"fal"/.test(src) && /"mock"/.test(src))
    ? ok("四 provider 齊全 hf|gemini|fal|mock") : bad("provider 列舉不齊");
  /toggleFault/.test(src) ? ok("故障注入 toggleFault") : bad("未接故障注入");
}

console.log("\n[3] RBAC");
{
  const src = read("shells/settings/panels/AdminPanel.tsx");
  /\.\.\/rbac/.test(src) ? ok("AdminPanel 讀 rbac") : bad("AdminPanel 未讀 rbac");
  /roleAtLeast|canSeeAdminTab/.test(src) ? ok("依角色過濾分頁") : bad("未依角色過濾");
  const rb = read("shells/settings/rbac.ts");
  /useAuth/.test(rb) ? ok("rbac 讀 auth.me 角色") : bad("rbac 未讀 auth");
  /updateRole/.test(read("shells/settings/admin/UsersCreditsTab.tsx")) ? ok("改角色按鈕對應 admin.updateRole") : bad("缺改角色");
}

console.log("\n[4] 嚴格加法（不 import server/ 或 drizzle/）");
const files = [
  "shells/settings/SettingsShell.tsx", "shells/settings/SettingsHome.tsx",
  "shells/settings/settingsFlags.ts", "shells/settings/rbac.ts",
  "shells/settings/panels/GeneralSettingsPanel.tsx", "shells/settings/panels/ProviderPanel.tsx",
  "shells/settings/panels/AgentPrefsPanel.tsx", "shells/settings/panels/ObservabilityPanel.tsx",
  "shells/settings/panels/AdminPanel.tsx",
  "shells/settings/admin/UsersCreditsTab.tsx", "shells/settings/admin/FeatureFlagsTab.tsx",
  "shells/settings/admin/ContentTab.tsx", "shells/settings/admin/DataRepairTab.tsx",
  "shells/settings/admin/AuditTab.tsx",
];
let leak = 0;
for (const f of files) {
  const src = read(f);
  if (/from\s+["'][^"']*\/(server|drizzle)\//.test(src) || /from\s+["']@shared\/schema["']/.test(src)) { bad(`${f} 直接 import server/drizzle`); leak++; }
}
if (!leak) ok(`${files.length} 個檔皆未 import server/ 或 drizzle/`);

console.log("\n[5] 沿用 P0 接縫 / 退路");
{
  const src = read("shells/settings/SettingsShell.tsx");
  /@\/shells\/ShellFrame/.test(src) ? ok("旗標關閉退回 P0 ShellFrame") : bad("未保留 P0 ShellFrame 退路");
  /@\/app\/lazyPages/.test(src) ? ok("深頁 re-home 沿用 P0 lazyPages") : bad("未沿用 P0 lazyPages");
}

console.log(fail ? `\n✗ scan 失敗：${fail} 項缺漏` : "\n✓ /settings wiring 全綠：分頁接真實 procedure、provider 四選一、RBAC、嚴格加法。");
process.exit(fail ? 1 : 0);
