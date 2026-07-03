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

// Full static route set (dynamic `:id` routes omitted — capture those with a
// real sample id via SHOT_ONLY if needed). Mirrors client/src/App.tsx.
const PAGES = [
  { name: "home", route: "/" },
  { name: "creation-hub", route: "/create" },
  { name: "playground", route: "/playground" },
  { name: "studio", route: "/studio" },
  { name: "director-ai", route: "/director" },
  { name: "creative-projects", route: "/creative-projects" },
  { name: "projects", route: "/projects" },
  { name: "animation", route: "/animation" },
  { name: "worldbuilding", route: "/worldbuilding" },
  { name: "assets", route: "/assets" },
  { name: "models", route: "/models" },
  { name: "vault", route: "/vault" },
  { name: "shared", route: "/shared" },
  { name: "notes", route: "/notes" },
  { name: "calendar", route: "/calendar" },
  { name: "dashboard", route: "/dashboard" },
  { name: "feedback", route: "/feedback" },
  { name: "settings", route: "/settings" },
  { name: "settings-agent", route: "/settings/agent" },
  { name: "settings-ai-brain", route: "/settings/ai-brain" },
  { name: "history", route: "/history" },
  { name: "my-brain", route: "/my-brain" },
  { name: "pro-studio", route: "/pro-studio" },
  { name: "image-studio", route: "/image-studio" },
  { name: "light-orb-studio", route: "/light-orb-studio" },
  { name: "video-studio", route: "/video-studio" },
  { name: "learn", route: "/learn" },
  { name: "ai-models-hub", route: "/ai-models-hub" },
  { name: "model-wishlist", route: "/model-wishlist" },
  { name: "tutorial-overview", route: "/tutorial-overview" },
  { name: "lora-trainer", route: "/lora-trainer" },
  { name: "focus-flow", route: "/focus-flow" },
  { name: "background-tasks", route: "/background-tasks" },
  { name: "credits", route: "/credits" },
  { name: "prompt-library", route: "/prompt-library" },
  { name: "prompt-collection", route: "/prompt-collection" },
  { name: "agent", route: "/agent" },
  { name: "teaching-archive", route: "/teaching-archive" },
  { name: "teams", route: "/teams" },
  { name: "account-settings", route: "/account-settings" },
  { name: "process", route: "/process" },
];

// Allow narrowing to a subset: SHOT_ONLY="dashboard,studio" node scripts/...
const only = (process.env.SHOT_ONLY || "").split(",").map(s => s.trim()).filter(Boolean);
const TARGETS = only.length ? PAGES.filter(p => only.includes(p.name)) : PAGES;

fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });

// Pre-mark all onboarding surfaces as seen so tours / intro modals / the orb
// bubble don't overlay the shots.
await ctx.addInitScript(() => {
  const tourKeys = [
    "welcome", "studio", "pro-studio", "image-studio", "video-studio",
    "director", "models", "history", "assets", "vault", "notes",
    "calendar", "shared", "dashboard", "feedback", "settings", "learn",
  ];
  for (const k of tourKeys) localStorage.setItem(`site-tour-${k}-v2`, "true");
  localStorage.setItem("hasSeenTour", "true");
  // Orb onboarding intro modal ("光球初次見面") + skip flags (AidvShellChrome.tsx)
  localStorage.setItem("ai-director-onboarded", "true");
  localStorage.setItem("orb-onboarding-skipped", "true");
  localStorage.setItem("orb-quiet-mode", "true");
  // Home page onboarding surfaces (Home.tsx)
  localStorage.setItem("home-onboarding-missions-v1", "dismissed");
  localStorage.setItem("home-onboarding-track-v1", "dismissed");
  localStorage.setItem("home-orb-lessons-v1", "done");
});

const page = await ctx.newPage();

for (const p of TARGETS) {
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
