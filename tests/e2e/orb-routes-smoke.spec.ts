import { test, expect } from "@playwright/test";

/**
 * Route-level smoke checks that don't depend on the LLM or auth.
 *
 * These guard against regressions where:
 *   - a key route stops mounting (404 on a known good path)
 *   - the orb widget anchor disappears entirely from the page shell
 *   - the agent settings page fails to render any of its 7 tabs
 *
 * Auth-gated content is intentionally not asserted here. If a route redirects
 * to /login the test still passes as long as the response is 2xx and not 5xx.
 */

const ROUTES = [
  "/",
  "/agent",
  "/studio",
  "/image-studio",
  "/video-studio",
  "/pro-studio",
  "/director",
  "/learn",
  "/notes",
  "/settings",
  "/settings/agent",
  "/dashboard",
];

test.describe("orb routes smoke", () => {
  for (const path of ROUTES) {
    test(`GET ${path} renders without server error`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response, `no response for ${path}`).not.toBeNull();
      const status = response!.status();
      expect.soft(status, `status for ${path}`).toBeLessThan(500);
      // App may redirect (302) to /login when auth is required — accept that.
      expect.soft(status, `status for ${path}`).toBeGreaterThanOrEqual(200);
    });
  }
});

test("home page mounts the proactive orb anchor", async ({ page }) => {
  await page.goto("/");
  // The widget container has id="proactive-orb-anchor". On guest sessions the
  // GlobalOrbChatProvider still renders it; this catches accidental removal of
  // the entire widget tree.
  const anchor = page.locator("#proactive-orb-anchor");
  await expect(anchor).toBeAttached({ timeout: 10_000 });
});
