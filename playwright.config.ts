import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the Healing Studio orb agent + assistant smoke suite.
 *
 * Scope: route-level smoke checks plus a couple of UI shell assertions
 * (ClarificationPromptCard + AgentPreferencesPage tabs). Avoids LLM-dependent
 * flows so the suite stays deterministic in CI.
 *
 * Usage:
 *   npm run dev      (in one shell — listens on PORT or 5173)
 *   npm run test:e2e (in another shell)
 *
 * In CI, prefer `npm run build && npm run start` and point BASE_URL at the
 * production preview.
 */
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:5173";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
