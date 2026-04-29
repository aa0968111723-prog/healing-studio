#!/usr/bin/env node
/**
 * scripts/smoke-routes.mjs
 *
 * Headless HTTP smoke check: hits every appRegistry route on a running server
 * and asserts the status is < 500. Use it as a lightweight substitute for
 * Playwright when you just need to verify the app boots and serves all
 * registered pages.
 *
 * Usage:
 *   SMOKE_BASE_URL=http://localhost:5173 node scripts/smoke-routes.mjs
 *   SMOKE_BASE_URL=http://localhost:3000 node scripts/smoke-routes.mjs --strict
 *
 * Behaviour without SMOKE_BASE_URL: exits 0 with a friendly notice — the
 * script is safe to wire into `npm run check` even when no dev server runs.
 *
 * Requirement 4 reminder: this script is a verifier, not a fixer. It only
 * reports; it never mutates state.
 */

import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const APP_REGISTRY = resolve(root, "shared/appRegistry.ts");

async function extractRegistryPaths() {
  const source = await fs.readFile(APP_REGISTRY, "utf8");
  const paths = new Set();
  // Match top-level `path: "/..."` lines that live inside APP_PAGE_REGISTRY
  // entries. The 4-space indent prefix matches our file convention.
  const re = /^ {4}path:\s*"([^"]+)"/gm;
  let match;
  while ((match = re.exec(source)) !== null) {
    paths.add(match[1].split(/[?#]/)[0]);
  }
  return Array.from(paths).sort();
}

async function probe(baseUrl, path) {
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  try {
    const res = await fetch(url, {
      redirect: "manual",
      headers: { Accept: "text/html" },
    });
    return { url, status: res.status };
  } catch (err) {
    return { url, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  const baseUrl = process.env.SMOKE_BASE_URL ?? "";
  const strict = process.argv.includes("--strict");
  const paths = await extractRegistryPaths();

  if (!baseUrl) {
    console.log(
      `[smoke] SMOKE_BASE_URL not set — would probe ${paths.length} route(s). ` +
        `Set SMOKE_BASE_URL to a running server (e.g. http://localhost:5173) to run probes.`
    );
    process.exit(0);
  }

  console.log(`[smoke] probing ${paths.length} route(s) on ${baseUrl}`);
  const results = [];
  for (const path of paths) {
    results.push(await probe(baseUrl, path));
  }

  const failures = results.filter(r => r.status === 0 || r.status >= 500);
  for (const result of results) {
    const symbol = result.status === 0 ? "✗" : result.status >= 500 ? "✗" : "✓";
    const detail = result.error ? ` (${result.error})` : "";
    console.log(`  ${symbol} ${String(result.status).padEnd(3)} ${result.url}${detail}`);
  }

  if (failures.length === 0) {
    console.log(`\n✓ smoke 通過：${results.length} 個路由全部 < 500。`);
    process.exit(0);
  }
  if (strict) {
    console.error(`\n✗ smoke --strict 發現 ${failures.length} 個失敗路由。`);
    process.exit(1);
  }
  console.warn(`\n⚠️  smoke 發現 ${failures.length} 個失敗路由（lint 模式不阻擋）。`);
  process.exit(0);
}

main().catch(err => {
  console.error("[smoke] 執行失敗:", err);
  process.exit(2);
});
