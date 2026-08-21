import { test, expect } from "@playwright/test";

/**
 * /creator/dashboard 最小 E2E 護欄（AIDV-277 Creator 可見性儀表板）。
 *
 * 沿用 orb-routes-smoke / agent-preferences-page 的取捨：
 *   - 路由可達性（不 5xx）不需要登入，恆常斷言。
 *   - 頁面內容走 DashboardLayout，guest 會看到 LoginScreen（`.login-cosmic`）
 *     或被導到 /login；此時內容斷言以 test.skip 跳過而非失敗，CI 沒
 *     storageState 也能跑可達性護欄。
 *   - 旗標 OFF 佔位以 runtime override（?creatordashboard=0）驗證，同樣僅在
 *     非 guest 時斷言。
 */

/** guest（LoginScreen / /login 導向）→ 回 true，呼叫端 test.skip。 */
async function isAuthGated(page: import("@playwright/test").Page): Promise<boolean> {
  await page.waitForLoadState("domcontentloaded");
  if (page.url().includes("/login")) return true;
  return (await page.locator(".login-cosmic").count()) > 0;
}

test("GET /creator/dashboard 路由可達（不 5xx）", async ({ page }) => {
  const response = await page.goto("/creator/dashboard");
  expect(response, "no response for /creator/dashboard").not.toBeNull();
  const status = response!.status();
  expect(status, "status for /creator/dashboard").toBeLessThan(500);
  expect(status).toBeGreaterThanOrEqual(200);
});

test("旗標 ON（預設）：頁首與 QuotaWidget / 影片表現區塊渲染", async ({ page }) => {
  await page.goto("/creator/dashboard?creatordashboard=1");
  if (await isAuthGated(page)) {
    test.skip(true, "auth required: provide storageState in playwright config");
  }

  await expect(page.getByText("創作者儀表板")).toBeVisible({ timeout: 10_000 });

  // QuotaWidget：成功 → section[aria-label="用量配額"]；後端不可用 → 錯誤
  // fallback 文案。兩者擇一出現即代表 widget 有掛上且沒讓頁面炸掉。
  const quotaOk = page.locator('section[aria-label="用量配額"]');
  const quotaFallback = page.getByText("暫時無法載入配額資料");
  await expect(quotaOk.or(quotaFallback).first()).toBeVisible({ timeout: 15_000 });

  // VideoPerformanceTable：同樣成功 section 或錯誤 fallback 擇一。
  const perfOk = page.locator('section[aria-label="影片表現"]');
  const perfFallback = page.getByText("暫時無法載入影片列表");
  await expect(perfOk.or(perfFallback).first()).toBeVisible({ timeout: 15_000 });
});

test("旗標 OFF（?creatordashboard=0）：渲染未啟用佔位、不掛資料元件", async ({ page }) => {
  await page.goto("/creator/dashboard?creatordashboard=0");
  if (await isAuthGated(page)) {
    test.skip(true, "auth required: provide storageState in playwright config");
  }

  await expect(page.getByText("此功能尚未啟用。")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('section[aria-label="用量配額"]')).toHaveCount(0);

  // 清掉 runtime override 殘留（readRuntimeOverride 會寫 localStorage）。
  await page.evaluate(() => {
    try {
      window.localStorage.removeItem("flag:creatordashboard");
    } catch {
      /* ignore */
    }
  });
});
