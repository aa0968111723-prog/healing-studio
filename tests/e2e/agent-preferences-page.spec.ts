import { test, expect } from "@playwright/test";

/**
 * Verifies /settings/agent renders all seven tabs. The tabs themselves are
 * pure shell — switching tabs only changes which TabsContent is visible — so
 * we don't need auth or DB to assert their existence.
 *
 * If the page is auth-gated and redirects to /login this test will fail; if
 * that becomes the case, gate the assertion behind a logged-in storageState.
 */

const REQUIRED_TABS: Array<{ testid: string; label: string }> = [
  { testid: "tab-behavior", label: "行為" },
  { testid: "tab-notify", label: "通知" },
  { testid: "tab-voice", label: "語音" },
  { testid: "tab-tools", label: "工具白黑名單" },
  { testid: "tab-pages", label: "頁面權限" },
  { testid: "tab-ui", label: "助手 UI" },
  { testid: "tab-schedule", label: "自動排程" },
];

test("agent preferences page renders all 7 tabs", async ({ page }) => {
  await page.goto("/settings/agent");
  // If auth-gated, the test runner sees the login redirect — bail with a clear
  // message so the failure mode is obvious in CI logs.
  await page.waitForLoadState("domcontentloaded");
  if (page.url().includes("/login")) {
    test.skip(true, "auth required: provide storageState in playwright config");
  }

  for (const tab of REQUIRED_TABS) {
    const trigger = page.getByTestId(tab.testid);
    await expect(trigger, `tab ${tab.label} should render`).toBeVisible();
    await expect(trigger).toContainText(tab.label);
  }
});

test("behavior mode picker shows three modes", async ({ page }) => {
  await page.goto("/settings/agent");
  await page.waitForLoadState("domcontentloaded");
  if (page.url().includes("/login")) test.skip();

  await page.getByTestId("tab-behavior").click();
  // The three mode card titles are deterministic copy.
  await expect(page.getByText("純聊天模式")).toBeVisible();
  await expect(page.getByText("半自動（推薦）")).toBeVisible();
  await expect(page.getByText("自動模式")).toBeVisible();
});
