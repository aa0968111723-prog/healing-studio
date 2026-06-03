// Capture screenshots of key pages, used as the reference for importing the
// site into Figma (uploaded as image-fill frames via the Figma MCP server).
//
// Reproduce:
//   VITE_FIGMA_CAPTURE=1 npx vite build      # auth-gated pages render (see useAuth.ts)
//   npx vite preview --port 4173 --host &
//   node scripts/figma-screenshots.mjs       # writes PNGs to /tmp/figma-shots
//
// The VITE_FIGMA_CAPTURE flag is only needed for the dashboard-shell pages
// (/create, /dashboard, /studio, /director); the public Home page renders
// without it.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.SHOT_BASE_URL || "http://localhost:4173";
const OUT_DIR = path.resolve("/tmp/figma-shots");
const VIEWPORT = { width: 1440, height: 900 };

const PAGES = [
  { name: "home", route: "/" },
  { name: "creation-hub", route: "/create" },
  { name: "dashboard", route: "/dashboard" },
  { name: "studio", route: "/studio" },
  { name: "director-ai", route: "/director" },
];

fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });

// Pre-mark all onboarding tours as seen so welcome/page tours don't overlay shots.
await ctx.addInitScript(() => {
  const keys = [
    "welcome", "studio", "pro-studio", "image-studio", "video-studio",
    "director", "models", "history", "assets", "vault", "notes",
    "calendar", "shared", "dashboard", "feedback", "settings", "learn",
  ];
  for (const k of keys) localStorage.setItem(`site-tour-${k}-v2`, "true");
  localStorage.setItem("hasSeenTour", "true");
});

const page = await ctx.newPage();

for (const p of PAGES) {
  const url = `${BASE}${p.route}`;
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  } catch {
    // networkidle may never settle if backend calls keep retrying; fall back
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  }
  await page.waitForTimeout(3500); // let lazy chunks + animations settle
  // viewport-sized shot (above the fold) and full-page shot
  await page.screenshot({ path: path.join(OUT_DIR, `${p.name}-viewport.png`) });
  await page.screenshot({ path: path.join(OUT_DIR, `${p.name}-full.png`), fullPage: true });
  console.log(`captured ${p.name} -> ${url}`);
}

await browser.close();
console.log(`Done. Screenshots in ${OUT_DIR}`);
