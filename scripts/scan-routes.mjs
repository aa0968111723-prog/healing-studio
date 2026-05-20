#!/usr/bin/env node
/**
 * scripts/scan-routes.mjs
 *
 * 全站路由 ↔ appRegistry ↔ PageAgent 註冊一致性掃描器。
 *
 * 用途：
 *   - 新增頁面時自動偵測「漏註冊」狀況
 *   - 防止 App.tsx 加路由但 appRegistry 沒對應條目（光球無法導航）
 *   - 防止 appRegistry 宣告 supportsPageAgent=true 但頁面組件忘記
 *     useRegisterPageAgent（光球收不到動作）
 *
 * 用法：
 *   node scripts/scan-routes.mjs
 *
 * 退出碼：
 *   0：所有檢查通過
 *   1：發現問題（資訊輸出至 stderr，方便 CI 抓）
 */

import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const APP_TSX = resolve(root, "client/src/App.tsx");
const APP_REGISTRY = resolve(root, "shared/appRegistry.ts");
const CLIENT_PAGES_DIR = resolve(root, "client/src/pages");

// ── App.tsx route extraction ────────────────────────────────────────────────

async function extractAppRoutes() {
  const source = await fs.readFile(APP_TSX, "utf8");
  const routes = [];
  const redirects = new Set();

  // Match each <Route path="..."> ... </Route> block; if its body contains
  // *Redirect components or <NavigateRedirect>, classify the route as a
  // redirect alias (not a real page that needs a registry entry).
  const blockRe = /<Route\s+path="([^"]+)">([\s\S]*?)<\/Route>/g;
  let blockMatch;
  while ((blockMatch = blockRe.exec(source)) !== null) {
    const [, path, body] = blockMatch;
    routes.push(path);
    if (/(NavigateRedirect|AssetsRedirect|AdminRedirect|Redirect\b)/.test(body)) {
      redirects.add(path);
    }
  }

  // Self-closing <Route path="..." component={X} /> — count but do NOT classify
  // as redirect (no body to inspect; assume real page).
  const selfClosingRe = /<Route\s+path="([^"]+)"\s+component=/g;
  let scMatch;
  while ((scMatch = selfClosingRe.exec(source)) !== null) {
    routes.push(scMatch[1]);
  }

  return {
    routes: Array.from(new Set(routes)).sort(),
    redirects,
  };
}

// ── appRegistry path extraction (regex-based, avoids TS imports) ────────────

async function extractRegistryEntries() {
  const source = await fs.readFile(APP_REGISTRY, "utf8");
  const entries = [];

  // Scope extraction to the APP_PAGE_REGISTRY array only to avoid
  // accidentally matching SIDEBAR_GROUPS or other objects that share
  // the `id:` key but are not page entries.
  const registryStartIdx = source.indexOf("APP_PAGE_REGISTRY:");
  if (registryStartIdx === -1) return entries;
  // Find the opening `= [` of the array (not the `[]` in the type annotation)
  const assignIdx = source.indexOf("= [", registryStartIdx);
  if (assignIdx === -1) return entries;
  const arrayOpenIdx = assignIdx + 2; // points to the `[`
  // Walk forward to find the matching closing `]`, counting nested brackets.
  let depth = 0;
  let arrayCloseIdx = -1;
  for (let i = arrayOpenIdx; i < source.length; i++) {
    if (source[i] === "[" || source[i] === "{") depth++;
    else if (source[i] === "]" || source[i] === "}") {
      depth--;
      if (depth === 0) { arrayCloseIdx = i; break; }
    }
  }
  const registrySource =
    arrayCloseIdx === -1
      ? source.slice(arrayOpenIdx)
      : source.slice(arrayOpenIdx, arrayCloseIdx + 1);

  const idRe = /\bid:\s*"([^"]+)"/;
  const pathRe = /\bpath:\s*"([^"]+)"/;
  const supportsRe = /\bsupportsPageAgent:\s*(true|false)/;

  // Split top-level objects by `},` followed by whitespace then `{` or `]`.
  const matches = registrySource.match(/\{[\s\S]*?\},\s*(?=\{|\])/g) ?? [];
  for (const block of matches) {
    const idMatch = idRe.exec(block);
    const pathMatch = pathRe.exec(block);
    const supportsMatch = supportsRe.exec(block);
    if (!idMatch || !pathMatch) continue;
    entries.push({
      id: idMatch[1],
      path: pathMatch[1],
      supportsPageAgent: supportsMatch ? supportsMatch[1] === "true" : false,
    });
  }
  return entries;
}

// ── useRegisterPageAgent scan ───────────────────────────────────────────────

async function findRegisteredPageIds() {
  const ids = new Set();
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.name.endsWith(".tsx") && !entry.name.endsWith(".ts")) continue;
      const source = await fs.readFile(full, "utf8");
      // Match `useRegisterPageAgent({ pageId: "<id>", ... })`
      const re = /useRegisterPageAgent\s*\(\s*\{[^}]*?pageId:\s*"([^"]+)"/gs;
      let match;
      while ((match = re.exec(source)) !== null) {
        ids.add(match[1]);
      }
    }
  }
  await walk(CLIENT_PAGES_DIR);
  return ids;
}

// ── Path normaliser (strip query/hash so /assets?section=x maps cleanly) ────

function normaliseAppPath(path) {
  return path.split(/[?#]/)[0];
}

// ── Reporters ───────────────────────────────────────────────────────────────

function header(title) {
  console.log(`\n=== ${title} ===`);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const [appRoutesResult, registry, registeredPageIds] = await Promise.all([
    extractAppRoutes(),
    extractRegistryEntries(),
    findRegisteredPageIds(),
  ]);
  const { routes: appRoutes, redirects } = appRoutesResult;

  const registryPaths = new Set(registry.map(item => normaliseAppPath(item.path)));
  const registryIds = registry.map(item => item.id);
  let problems = 0;

  // 1. Routes in App.tsx that have no appRegistry entry.
  // Filter out auth / legal routes that intentionally aren't user-facing pages.
  const ALLOW_LIST_PREFIXES = [
    "/forgot-password",
    "/reset-password",
    "/account-settings",
    "/404",
    "/auth",
    "/oauth",
  ];
  const orphanRoutes = appRoutes.filter(path => {
    const normalised = normaliseAppPath(path);
    if (ALLOW_LIST_PREFIXES.some(prefix => normalised.startsWith(prefix))) return false;
    // Redirect-only routes don't need a registry entry; they're transparent
    // shortcuts to a real page that already has one.
    if (redirects.has(path)) return false;
    if (registryPaths.has(normalised)) return false;
    // Parameterised routes (e.g. /animation/:storyboardId) are deep-link
    // variants of a registered parent path — they are not true orphans.
    // Strip one trailing /:param segment at a time until we find a match.
    let ancestor = normalised;
    while (ancestor.includes("/:")) {
      ancestor = ancestor.replace(/\/:[^/]+$/, "");
      if (registryPaths.has(ancestor)) return false;
    }
    return true;
  });
  if (orphanRoutes.length > 0) {
    header("App.tsx 路由未在 appRegistry 註冊（光球無法導航至此）");
    for (const path of orphanRoutes) console.error(`  ❌ ${path}`);
    problems += orphanRoutes.length;
  }

  // 2. registry entries whose path doesn't appear in App.tsx (dead routes).
  const appPathSet = new Set(appRoutes.map(normaliseAppPath));
  const deadRoutes = registry.filter(item => !appPathSet.has(normaliseAppPath(item.path)));
  if (deadRoutes.length > 0) {
    header("appRegistry 條目在 App.tsx 找不到對應 <Route>（可能是死路由）");
    for (const item of deadRoutes) console.warn(`  ⚠️  ${item.id} → ${item.path}`);
    // Treat as warning, not failure — some entries point to query-string sub-pages
    // that share a parent route (e.g. /assets?section=tasks).
  }

  // 3. registry entries with supportsPageAgent=true but no useRegisterPageAgent.
  const missingHandlers = registry.filter(
    item => item.supportsPageAgent && !registeredPageIds.has(item.id)
  );
  if (missingHandlers.length > 0) {
    header("appRegistry 標 supportsPageAgent=true 但頁面缺少 useRegisterPageAgent");
    for (const item of missingHandlers) {
      console.error(`  ❌ ${item.id} (${item.path}) — 請補上 useRegisterPageAgent({ pageId: "${item.id}", ... })`);
    }
    problems += missingHandlers.length;
  }

  // 4. Stale handlers (registered useRegisterPageAgent but no registry entry).
  const staleHandlers = Array.from(registeredPageIds).filter(id => !registryIds.includes(id));
  if (staleHandlers.length > 0) {
    header("頁面有 useRegisterPageAgent 但 appRegistry 沒對應條目");
    for (const id of staleHandlers) console.warn(`  ⚠️  ${id}`);
  }

  const strict = process.argv.includes("--strict");
  if (problems === 0) {
    console.log(
      `\n✓ scan-routes 通過：${appRoutes.length} 個路由、${registry.length} 個 registry 條目、${registeredPageIds.size} 個 PageAgent 註冊已對齊。`
    );
    process.exit(0);
  } else if (strict) {
    console.error(`\n✗ scan-routes --strict 發現 ${problems} 個必修問題。請修補後再合併。`);
    process.exit(1);
  } else {
    console.warn(
      `\n⚠️  scan-routes 發現 ${problems} 個待補齊項目（lint 模式不阻擋合併）。要在 CI 強制阻擋請加 --strict。`
    );
    process.exit(0);
  }
}

main().catch(err => {
  console.error("[scan-routes] 執行失敗:", err);
  process.exit(2);
});
