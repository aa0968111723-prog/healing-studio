#!/usr/bin/env node
/**
 * scripts/browser-audit/run-audit.mjs
 *
 * Headless Chromium walkthrough that hits every route from
 * shared/appRegistry.ts plus a few static helper routes, then collects:
 *   - HTTP status of the navigation
 *   - JS console errors emitted while the page settled
 *   - Page-level uncaught errors (window.onerror)
 *   - Network responses with status >= 400
 *   - Screenshot per route
 *   - Whether the proactive orb anchor mounts
 *   - Whether the page rendered any visible text (avoid "blank page" cases)
 *
 * Output: scripts/browser-audit/report.json + report.md and PNG screenshots.
 *
 * The script is meant to run against a *live* dev server, not bundled.
 * It does not require auth — auth-gated pages may redirect to /login and
 * still count as pass.
 */

import { chromium } from "playwright";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const APP_REGISTRY = resolve(root, "shared/appRegistry.ts");
const SCREENSHOT_DIR = resolve(here, "screenshots");
const REPORT_JSON = resolve(here, "report.json");
const REPORT_MD = resolve(here, "report.md");

const BASE_URL = process.env.AUDIT_BASE_URL ?? "http://localhost:3000";

async function extractRoutes() {
  const seen = new Set();
  const routes = [];
  const add = (p) => {
    const norm = p.split(/[?#]/)[0];
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      routes.push(p);
    }
  };

  // (1) registry paths (canonical, may include ?section= query strings)
  const regSrc = await fs.readFile(APP_REGISTRY, "utf8");
  const reReg = /^ {4}path:\s*"([^"]+)"/gm;
  let m;
  while ((m = reReg.exec(regSrc)) !== null) add(m[1]);

  // (2) App.tsx <Route path="..."> entries (catches aliases / non-registry pages)
  const appTsxPath = resolve(root, "client/src/App.tsx");
  const appSrc = await fs.readFile(appTsxPath, "utf8");
  const reApp = /<Route\s+path="([^"]+)"/g;
  while ((m = reApp.exec(appSrc)) !== null) add(m[1]);

  // (3) Synthetic check: a deliberately bogus path so we know the SPA's
  // 404 handler renders rather than blowing up.
  add("/this-route-does-not-exist-zzz");

  return routes;
}

const slugify = (path) =>
  path.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "root";

function isExpectedNoise(text) {
  if (!text) return false;
  const noise = [
    // Vite HMR chatter
    "[vite] connected",
    "[vite] connecting",
    "Download the React DevTools",
    // 503 from disabled feature flags is expected without API keys
    "Image generation endpoints will return 503",
    "Video generation endpoints will return 503",
    "Audio generation endpoints will return 503",
    // Sandbox/headless Chromium often has an incomplete CA store; external
    // HTTPS resources (Google Fonts, PostHog) appear as ERR_CERT errors
    // even when the host browser would load them fine. This is an environment
    // artifact, not an application defect.
    "ERR_CERT_AUTHORITY_INVALID",
    "ERR_CERT_DATE_INVALID",
  ];
  return noise.some((needle) => text.includes(needle));
}

async function auditRoute(browser, path) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  const consoleErrors = [];
  const consoleWarnings = [];
  const pageErrors = [];
  const failedRequests = [];

  page.on("console", (msg) => {
    const type = msg.type();
    const text = msg.text();
    if (isExpectedNoise(text)) return;
    if (type === "error") consoleErrors.push(text);
    else if (type === "warning") consoleWarnings.push(text);
  });

  page.on("pageerror", (err) => {
    pageErrors.push(err.message + (err.stack ? "\n" + err.stack.split("\n").slice(0, 3).join("\n") : ""));
  });

  page.on("response", (resp) => {
    const status = resp.status();
    if (status >= 400) {
      const url = resp.url();
      // Ignore expected 404/503 from feature-flag-gated APIs in dev
      if (status === 404 && /\/api\/(news|trends|featured)/.test(url)) return;
      failedRequests.push({ status, url });
    }
  });

  let navStatus = null;
  let navError = null;
  let visibleText = "";
  let hasOrbAnchor = false;
  let title = "";

  const targetUrl = `${BASE_URL}${path}`;

  try {
    const response = await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    navStatus = response ? response.status() : null;
  } catch (err) {
    navError = err.message;
  }

  // Settle for lazy chunks + client hydration. Vite dev keeps the HMR
  // websocket open so we can't rely on networkidle; a fixed delay is
  // more deterministic and the per-route cost stays predictable.
  await page.waitForTimeout(2500);

  try {
    title = await page.title();
  } catch {}

  try {
    visibleText = (await page.evaluate(() => document.body?.innerText || "")).slice(0, 400);
  } catch {}

  try {
    hasOrbAnchor = (await page.locator("#proactive-orb-anchor").count()) > 0;
  } catch {}

  const screenshotPath = `${SCREENSHOT_DIR}/${slugify(path)}.png`;
  try {
    await page.screenshot({ path: screenshotPath, fullPage: false });
  } catch (err) {
    navError = (navError ? navError + "; " : "") + "screenshot failed: " + err.message;
  }

  await context.close();

  return {
    path,
    targetUrl,
    navStatus,
    navError,
    title,
    visibleTextSnippet: visibleText,
    hasOrbAnchor,
    consoleErrors,
    consoleWarnings,
    pageErrors,
    failedRequests,
    screenshot: screenshotPath.replace(root + "/", ""),
  };
}

function classify(result) {
  const issues = [];
  if (result.navError) issues.push("nav-error: " + result.navError);
  if (result.navStatus && result.navStatus >= 500) issues.push(`server-error ${result.navStatus}`);
  if (result.pageErrors.length) issues.push(`page-error x${result.pageErrors.length}`);
  if (result.consoleErrors.length) issues.push(`console-error x${result.consoleErrors.length}`);
  if (!result.visibleTextSnippet || result.visibleTextSnippet.trim().length < 10) {
    issues.push("blank-or-minimal-content");
  }
  const fatalNet = result.failedRequests.filter((r) => r.status >= 500);
  if (fatalNet.length) issues.push(`fatal-network x${fatalNet.length}`);
  return issues;
}

async function main() {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  const routes = await extractRoutes();
  console.log(`Auditing ${routes.length} routes against ${BASE_URL}...`);

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const results = [];
  for (const path of routes) {
    process.stdout.write(`  ${path} ... `);
    const r = await auditRoute(browser, path);
    const issues = classify(r);
    r.issues = issues;
    results.push(r);
    console.log(issues.length ? `[ISSUES] ${issues.join(" | ")}` : "ok");
  }
  await browser.close();

  await fs.writeFile(REPORT_JSON, JSON.stringify(results, null, 2));

  // Markdown report
  const lines = [];
  lines.push(`# Browser Audit Report`);
  lines.push("");
  lines.push(`- Base URL: ${BASE_URL}`);
  lines.push(`- Routes audited: ${results.length}`);
  lines.push(`- Routes with issues: ${results.filter((r) => r.issues.length).length}`);
  lines.push("");
  lines.push(`## Per-route summary`);
  lines.push("");
  lines.push(`| Path | Status | Title | Orb anchor | Issues |`);
  lines.push(`|------|--------|-------|------------|--------|`);
  for (const r of results) {
    const issuesStr = r.issues.length ? r.issues.join("<br>") : "ok";
    const title = (r.title || "").replace(/\|/g, "\\|").slice(0, 60);
    lines.push(
      `| \`${r.path}\` | ${r.navStatus ?? "ERR"} | ${title} | ${r.hasOrbAnchor ? "✓" : "✗"} | ${issuesStr} |`,
    );
  }
  lines.push("");
  lines.push(`## Issue details`);
  for (const r of results.filter((x) => x.issues.length)) {
    lines.push("");
    lines.push(`### \`${r.path}\``);
    if (r.navError) lines.push(`- nav error: ${r.navError}`);
    if (r.pageErrors.length) {
      lines.push(`- page errors:`);
      for (const e of r.pageErrors) lines.push(`  - ${e.split("\n")[0]}`);
    }
    if (r.consoleErrors.length) {
      lines.push(`- console errors:`);
      for (const e of r.consoleErrors.slice(0, 8)) lines.push(`  - ${e}`);
      if (r.consoleErrors.length > 8) lines.push(`  - ... +${r.consoleErrors.length - 8} more`);
    }
    const fatalNet = r.failedRequests.filter((x) => x.status >= 500);
    if (fatalNet.length) {
      lines.push(`- fatal network responses:`);
      for (const f of fatalNet.slice(0, 8)) lines.push(`  - ${f.status} ${f.url}`);
    }
    const otherNet = r.failedRequests.filter((x) => x.status < 500);
    if (otherNet.length) {
      lines.push(`- other 4xx network responses:`);
      for (const f of otherNet.slice(0, 8)) lines.push(`  - ${f.status} ${f.url}`);
    }
    if (r.visibleTextSnippet) {
      lines.push(`- visible text snippet: \`${r.visibleTextSnippet.slice(0, 120).replace(/\s+/g, " ")}\``);
    }
  }

  await fs.writeFile(REPORT_MD, lines.join("\n"));
  console.log(`\nReport: ${REPORT_MD}`);
  console.log(`JSON: ${REPORT_JSON}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
