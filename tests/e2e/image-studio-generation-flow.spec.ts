import { test, expect, type Page } from "@playwright/test";
import {
  selectRoleForIntent,
  composeRoleChain,
  pickArrivalSpiritForPath,
  pickDefaultPathForRole,
  buildArrivalFollowUpText,
  getPrimaryNicknameForRole,
  SPIRIT_FAMILY,
  type AgentRole,
} from "../../shared/orb-agent-roles";
import {
  IMAGE_STUDIO_T2I_PROFILE,
  IMAGE_STUDIO_T2I_MODELS,
  IMAGE_STUDIO_T2I_ASPECT_RATIOS,
  IMAGE_STUDIO_VIBE_CARDS,
  IMAGE_STUDIO_PROMPT_TEMPLATES,
  buildImageStudioSetModelActions,
  buildImageStudioFillPromptActions,
  buildImageStudioApplyVibeActions,
  buildImageStudioSetAspectRatioActions,
} from "../../shared/orb-studio-actions";

/**
 * 圖片生成主流程端對端護欄（AIDV-35 opt-cycle 互補項：生成主流程目前
 * 無任何自動 e2e 護欄，先補 image 一條）。
 *
 * 沿用 orb-pro-studio-25-spirits.spec.ts 的雙軸設計：
 *
 *   A. 純邏輯軸（不需要瀏覽器 / 登入 / provider）— 直接 import 真實的
 *      shared/ 路由器與動作建構器，把「使用者一句話 → 圖圖（image-specialist）
 *      → 編出 AgentAction[]」整條決策路徑跑出來，驗證：
 *        1. image-specialist 是登記在案的精靈（family/暱稱/著陸路徑）
 *        2. /image-studio 著陸精靈是圖圖；T2I_PROFILE 綁同一路徑
 *        3. 常見圖片生成指令各自命中 image-specialist + 正確 handoff 鏈
 *        4. setModel / fillPrompt / applyVibe / setAspect 各吐出正確順序的動作
 *        5. T2I_PROFILE 內嵌的 models/vibes/templates/aspectRatios 與
 *           shared/ 來源常數陣列對齊（防 ProfileObject 與 ImageStudio.tsx
 *           渲染來源漂移）
 *
 *   B. 瀏覽器軸（需要 dev server，且 /image-studio 非 guest 阻擋）— 真正開
 *      瀏覽器到 /image-studio，驗證：
 *        1. 頁面 shell 完整渲染（h1「圖片創作室」+ 6 個分頁按鈕 + 光球錨點）
 *        2. 預設停在「文字生圖」分頁（t2i prompt placeholder 可見）
 *        3. 切分頁（文字生圖 → 圖片編輯 → 文字生圖）不噴 console / page error
 *
 * 設計取捨（與 pro-studio spec 一致）：
 *   - /image-studio 走 DashboardLayout（同 pro-studio），guest 會看到
 *     LoginScreen（`.login-cosmic`）。沒提供登入 storageState 時 B 軸用
 *     test.skip 跳過而不是失敗，CI 沒密碼也能跑 A 軸護欄。
 *   - dev server 沒起（ERR_CONNECTION_REFUSED）也以 test.skip 跳過 B 軸。
 *   - A 軸完全不 page.goto，把 orb-agent-roles / orb-studio-actions 的契約
 *     綁到 e2e suite 最外層；任一處改動忘了同步另一處時 suite 就會炸。
 */

// ─── A 軸：純邏輯模擬（圖圖 ↔ 圖片創作室生成主流程） ─────────────────────

test.describe("圖片創作室 × 圖圖（image-specialist）— 純邏輯模擬", () => {
  test("image-specialist 是登記在案的精靈（family / 暱稱 / 著陸路徑）", () => {
    const role: AgentRole = "image-specialist";
    expect(SPIRIT_FAMILY[role], "image-specialist 必須登記 family").toMatch(
      /^(specialist|role|proactive)$/,
    );
    expect(SPIRIT_FAMILY[role]).toBe("specialist");
    expect(getPrimaryNicknameForRole(role)).toBe("圖圖");
    expect(pickDefaultPathForRole(role)).toBe("/image-studio");
  });

  test("/image-studio 著陸精靈是圖圖；T2I_PROFILE 綁同一路徑", () => {
    expect(pickArrivalSpiritForPath("/image-studio")).toBe("image-specialist");
    // 子路徑（例如帶分頁）也要落在圖圖手上
    expect(pickArrivalSpiritForPath("/image-studio/edit")).toBe(
      "image-specialist",
    );
    // profile 物件（光球發動作時讀的）必須指向同一頁，且能 round-trip 回精靈
    expect(IMAGE_STUDIO_T2I_PROFILE.pageId).toBe("image-studio");
    expect(IMAGE_STUDIO_T2I_PROFILE.pagePath).toBe("/image-studio");
    expect(pickDefaultPathForRole("image-specialist")).toBe(
      IMAGE_STUDIO_T2I_PROFILE.pagePath,
    );
  });

  test("圖圖抵達話術明確接手 + 帶上使用者意圖", () => {
    const text = buildArrivalFollowUpText(
      "image-specialist",
      "幫我畫一張寫實風格的貓",
    );
    expect(text).toMatch(/圖圖/);
    expect(text).toMatch(/圖片創作室/);
    expect(text).toMatch(/寫實風格的貓/);
  });

  // 常見「使用者一句話 → 光球路由」案例。這些字串都已對真實 router 驗證會
  // 命中 image-specialist（conf 0.85）；handoff 鏈 = [圖圖, 作曲, 評論]。
  // 註：像「生成一張圖」這種泛詞會落到 companion 泛談手上（不在此斷言），
  //     所以這裡只挑確定命中圖圖的代表性指令，避免脆測。
  const SCENARIOS: ReadonlyArray<{
    user: string;
    expectChainIncludes: AgentRole[];
  }> = [
    { user: "畫一張", expectChainIncludes: ["image-specialist", "composer", "critic"] },
    { user: "修圖", expectChainIncludes: ["image-specialist", "composer", "critic"] },
    { user: "去背", expectChainIncludes: ["image-specialist", "composer", "critic"] },
    {
      user: "幫我生成一張咖啡廳的圖片",
      expectChainIncludes: ["image-specialist", "composer", "critic"],
    },
    {
      user: "幫我畫一張寫實風格的貓",
      expectChainIncludes: ["image-specialist", "composer", "critic"],
    },
  ];

  for (const sc of SCENARIOS) {
    test(`路由：「${sc.user}」→ image-specialist`, () => {
      const head = selectRoleForIntent({ text: sc.user });
      expect(head.role, `head spirit for "${sc.user}"`).toBe("image-specialist");
      expect(head.confidence).toBeGreaterThan(0);

      const chain = composeRoleChain({ text: sc.user });
      for (const expected of sc.expectChainIncludes) {
        expect(
          chain,
          `chain for "${sc.user}" should include ${expected}`,
        ).toContain(expected);
      }
    });
  }
});

test.describe("圖片創作室 × 文字生圖 — AgentAction 模擬", () => {
  test("setModel：先切 t2i 分頁再設模型", () => {
    const modelId = IMAGE_STUDIO_T2I_MODELS[0].id;
    const actions = buildImageStudioSetModelActions(modelId);
    expect(actions[0]).toEqual({ type: "setTab", tabId: "t2i" });
    expect(actions[1]).toEqual({ type: "setModel", modelId });
  });

  test("fillPrompt：先切 t2i 分頁再覆寫提示詞", () => {
    const actions = buildImageStudioFillPromptActions("a cozy cafe at dawn");
    expect(actions[0]).toEqual({ type: "setTab", tabId: "t2i" });
    expect(actions[1]).toMatchObject({
      type: "fillPrompt",
      text: "a cozy cafe at dawn",
      append: false,
    });
  });

  test("applyVibe：先切 t2i 分頁再套風格 preset", () => {
    const vibeId = IMAGE_STUDIO_VIBE_CARDS[0].id;
    const actions = buildImageStudioApplyVibeActions(vibeId);
    expect(actions[0]).toEqual({ type: "setTab", tabId: "t2i" });
    expect(actions[1]).toMatchObject({ type: "applyPreset", presetId: vibeId });
  });

  test("setAspectRatio：先切 t2i 分頁再設長寬比參數", () => {
    const ratio = IMAGE_STUDIO_T2I_ASPECT_RATIOS[0].id;
    const actions = buildImageStudioSetAspectRatioActions(ratio);
    expect(actions[0]).toEqual({ type: "setTab", tabId: "t2i" });
    expect(actions[1]).toEqual({
      type: "setParam",
      key: "aspectRatio",
      value: ratio,
    });
  });

  test("T2I 契約鎖定：模型 union + 關鍵 vibe/aspect 錨點（防 orb↔page 漂移）", () => {
    // 注意：T2I_PROFILE.models 等欄位「就是」這些來源常數的同一參考，
    // 所以拿 profile 跟來源互比會永遠成立（套套邏輯、零防護價值）。真正要
    // 鎖的是這些 shared/ 常數本身與 ImageStudio.tsx 渲染的契約 —— 任一邊
    // 改動但忘了同步另一邊時，下面的硬斷言就會炸，逼出一次有意識的同步。

    // t2i 4 模型必須對齊 ImageStudio.tsx 文字生圖分頁的可選模型 union
    // （同 pro-studio spec 對音樂模型 union 的鎖定手法）
    expect(IMAGE_STUDIO_T2I_MODELS.map((m) => m.id).sort()).toEqual([
      "imagen4",
      "nanoBanana2",
      "nanoBananaPro",
      "seedreamV4",
    ]);

    // profile 是光球發動作時的入口物件，必須非空並承載同一批模型
    expect(IMAGE_STUDIO_T2I_PROFILE.models.length).toBe(
      IMAGE_STUDIO_T2I_MODELS.length,
    );

    // 風格卡 / 長寬比的關鍵 id 錨點（ImageStudio.tsx UI 與 orb 動作都靠它）
    const vibeIds = IMAGE_STUDIO_VIBE_CARDS.map((v) => v.id);
    expect(vibeIds).toContain("cinematic");
    expect(vibeIds).toContain("watercolor");
    const aspectIds = IMAGE_STUDIO_T2I_ASPECT_RATIOS.map((a) => a.id);
    expect(aspectIds).toContain("1:1");
    expect(aspectIds).toContain("16:9");

    // 「幫我寫提示詞」協作流程依賴至少有 prompt 模板可套
    expect(IMAGE_STUDIO_PROMPT_TEMPLATES.length).toBeGreaterThan(0);
  });
});

// ─── B 軸：瀏覽器模擬（需要 storageState 或 guest 可達） ──────────────────

async function pageIsLoginGated(page: Page): Promise<boolean> {
  // DashboardLayout 在 !user 時渲染 LoginScreen — `.login-cosmic` wrapper。
  // 比檢查 URL（前端路由不改 URL）更可靠（同 pro-studio spec 取捨）。
  //
  // useAuth().loading 為真時會先顯示 DashboardLayoutSkeleton（兩者都還沒掛），
  // 所以先等「登入畫面」或「頁面標題」其一出現再判定，避免在 loading 空窗期
  // 誤判為「未被擋」。任一出現即可收手；都沒出現（逾時）就照原邏輯判。
  const loginWrapper = page.locator(".login-cosmic");
  const heading = page.getByRole("heading", { name: "圖片創作室" });
  await Promise.race([
    loginWrapper.first().waitFor({ state: "attached", timeout: 10_000 }),
    heading.first().waitFor({ state: "attached", timeout: 10_000 }),
  ]).catch(() => {
    /* 兩者都沒在時限內出現 — 交給下面的 count() 與後續斷言自行處理 */
  });
  return (await loginWrapper.count()) > 0;
}

async function tryGoto(page: Page, path: string): Promise<boolean> {
  try {
    await page.goto(path);
    return true;
  } catch {
    return false;
  }
}

test.describe("/image-studio 瀏覽器渲染 — 光球錨點 + 6 分頁", () => {
  const TAB_LABELS = [
    "文字生圖",
    "圖片編輯",
    "影像放大",
    "骨骼姿勢",
    "Stable Diffusion",
    "圖片轉3D",
  ];

  test("頁面 shell 渲染：h1 + 6 個分頁按鈕 + 光球錨點", async ({ page }) => {
    const reached = await tryGoto(page, "/image-studio");
    if (!reached) {
      test.skip(true, "dev server 未啟動 — 跑 B 軸需先 `npm run dev`");
    }
    await page.waitForLoadState("domcontentloaded");

    if (await pageIsLoginGated(page)) {
      test.skip(
        true,
        "/image-studio 在 guest 看到 LoginScreen — 跑此測試需注入登入 storageState",
      );
    }

    await expect(
      page.getByRole("heading", { name: "圖片創作室" }),
    ).toBeVisible();

    // 注意：ImageStudio.tsx 的分頁是 `<button role="tab">`，顯式 role 會蓋掉
    // 隱式的 button role，所以必須用 getByRole("tab")（不是 "button"）才抓得到。
    for (const label of TAB_LABELS) {
      const tab = page.getByRole("tab", { name: new RegExp(label) });
      await expect(tab, `分頁按鈕「${label}」必須可見`).toBeVisible();
    }

    await expect(page.locator("#proactive-orb-anchor")).toBeAttached({
      timeout: 10_000,
    });
  });

  test("分頁切換實際更新內容（文字生圖 → 圖片編輯 → 文字生圖）", async ({
    page,
  }) => {
    // 只收「未捕獲的 JS 例外」(pageerror) 當切換壞掉的訊號。刻意不收所有
    // console.error —— 開發/預覽環境下 tRPC/網路/金鑰相關的 console.error
    // 與分頁切換無關，收進來會造成假性失敗（脆測）。
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    const reached = await tryGoto(page, "/image-studio");
    if (!reached) {
      test.skip(true, "dev server 未啟動 — 跑 B 軸需先 `npm run dev`");
    }
    await page.waitForLoadState("domcontentloaded");

    if (await pageIsLoginGated(page)) {
      test.skip(
        true,
        "/image-studio 在 guest 看到 LoginScreen — 跑此測試需注入登入 storageState",
      );
    }

    // 預設停在文字生圖分頁 — 應看到 t2i prompt 的 placeholder
    await expect(
      page.getByPlaceholder(/描述你想生成的圖片/).first(),
    ).toBeVisible({ timeout: 10_000 });

    // 切到圖片編輯分頁（分頁是 role="tab"，非 button）
    await page.getByRole("tab", { name: /圖片編輯/ }).click();

    // 切回文字生圖分頁應還能回來
    await page.getByRole("tab", { name: /文字生圖/ }).click();
    await expect(
      page.getByPlaceholder(/描述你想生成的圖片/).first(),
    ).toBeVisible({ timeout: 10_000 });

    expect(
      pageErrors,
      `切換分頁過程不能出現未捕獲的 page error，但收到:\n${pageErrors.join("\n")}`,
    ).toEqual([]);
  });
});
