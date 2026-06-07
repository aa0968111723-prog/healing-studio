#!/usr/bin/env node
// ============================================================================
// scan-shell-routes.mjs — 無需建置的 4-shell 路由 parity 檢查（static 解析）
// ----------------------------------------------------------------------------
// 用法：
//   node scan-shell-routes.mjs [repoRoot]      # 預設 repoRoot = process.cwd()
// 讀取：
//   <repoRoot>/client/src/App.tsx                     （線上 54 路由）
//   <repoRoot>/client/src/shells/shellRouteTable.ts   （收編 + 相容導向表）
// 驗證並印報告：
//   ① 每條 LEGACY_REDIRECTS.from 都是 App.tsx 真實既有 Route（在 shadow 真路由，非杜撰）
//   ② 每條 LEGACY_REDIRECTS.to（含 :param）都是已宣告的 canonical shell sub-route（無死轉址）
//   ③ canonical sub-route 路徑無碰撞
//   ④ App.tsx 既有 Route 一條不少（與內建基準 54 比對；本 patch 為純加法）
// 任一項失敗 → process.exit(1)（可掛進 CI / 與既有 check:routes 並列）。
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] || process.cwd();
const appPath = join(root, "client/src/App.tsx");
const tablePath = join(root, "client/src/shells/shellRouteTable.ts");

function read(p) {
  try { return readFileSync(p, "utf8"); }
  catch { console.error(`✗ 讀不到 ${p}（請傳入正確 repoRoot）`); process.exit(2); }
}

const appSrc = read(appPath);
const tableSrc = read(tablePath);

// ── App.tsx 既有 Route 路徑（path="..."）─────────────────────────────────────
const appRoutes = [...appSrc.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
const appRouteSet = new Set(appRoutes);

// ── shellRouteTable：LEGACY_REDIRECTS {from,to,param?} ───────────────────────
const redirects = [...tableSrc.matchAll(
  /\{\s*from:\s*"([^"]+)",\s*to:\s*"([^"]+)"(?:,\s*param:\s*"([^"]+)")?\s*\}/g,
)].map((m) => ({ from: m[1], to: m[2], param: m[3] }));

// ── canonical sub-routes：SHELL_SUBROUTES 內所有 path: "..." ──────────────────
// 取 SHELL_SUBROUTES 區塊（到 SHELL_INTERNAL_REDIRECTS 為止）避免吃到別的 path。
const subBlock = tableSrc.slice(
  tableSrc.indexOf("SHELL_SUBROUTES"),
  tableSrc.indexOf("SHELL_INTERNAL_REDIRECTS"),
);
const canonical = [...subBlock.matchAll(/path:\s*"([^"]+)"/g)].map((m) => m[1]);
const canonicalSet = new Set(canonical);

let failures = 0;
const fail = (msg) => { console.error("  ✗ " + msg); failures++; };

console.log("── 4-shell 路由 parity 掃描 ───────────────────────────────");
console.log(`App.tsx <Route> 數：     ${appRoutes.length}`);
console.log(`LEGACY_REDIRECTS：       ${redirects.length}`);
console.log(`canonical sub-routes：   ${canonical.length}`);
console.log("");

// ① redirect.from 必須是真實既有 Route
console.log("① 相容導向 shadow 的是真實既有路由：");
for (const r of redirects) {
  if (!appRouteSet.has(r.from)) fail(`redirect.from "${r.from}" 不在 App.tsx 既有 Route 中`);
}
if (!failures) console.log("  ✓ 全部 from 命中既有 Route");

// ② redirect.to 必須是宣告過的 canonical sub-route（無死轉址）
console.log("② 相容導向指向真實 canonical sub-route：");
let before = failures;
for (const r of redirects) {
  const target = r.param ? `${r.to}/:${r.param}` : r.to;
  if (!canonicalSet.has(target)) fail(`redirect "${r.from}" → "${target}" 不是宣告過的 canonical`);
}
if (failures === before) console.log("  ✓ 全部 to 命中 canonical（舊連結不 404）");

// ③ canonical 無碰撞
console.log("③ canonical sub-route 無碰撞：");
if (canonicalSet.size !== canonical.length) fail("canonical 有重複路徑"); else console.log("  ✓ 無重複");

// ④ 純加法：App.tsx 既有 Route 一條不少（基準 54）
console.log("④ 純加法（App.tsx 既有 Route 未被刪）：");
const BASELINE = 54;
if (appRoutes.length < BASELINE) fail(`App.tsx 路由數 ${appRoutes.length} < 基準 ${BASELINE}（疑似刪到既有路由）`);
else console.log(`  ✓ App.tsx 路由數 ${appRoutes.length} ≥ 基準 ${BASELINE}`);

console.log("");
if (failures) { console.error(`✗ parity 掃描失敗：${failures} 項`); process.exit(1); }
console.log("✓ parity 掃描全綠：收編表與 App.tsx 一致，零路由遺失。");
