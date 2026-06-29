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
  VIDEO_STUDIO_T2V_PROFILE,
  VIDEO_STUDIO_T2V_MODELS,
  VIDEO_STUDIO_T2V_DURATIONS,
  VIDEO_STUDIO_T2V_ASPECTS,
  VIDEO_STUDIO_T2V_RESOLUTIONS,
  VIDEO_STUDIO_T2V_TEMPLATES,
  buildVideoStudioT2VSetModelActions,
  buildVideoStudioT2VFillPromptActions,
  buildVideoStudioT2VApplyTemplateActions,
  buildVideoStudioT2VSetParamActions,
} from "../../shared/orb-studio-actions";

/**
 * 影片生成主流程端對端護欄（AIDV-35 opt-cycle 互補項第二條：image 已於
 * #1064 補上，本卡照同一雙軸範本擴 video 一條）。
 *
 * 沿用 image-studio-generation-flow.spec.ts / orb-pro-studio-25-spirits.spec.ts
 * 的雙軸設計：
 *
 *   A. 純邏輯軸（不需要瀏覽器 / 登入 / provider）— 直接 import 真實的
 *      shared/ 路由器與動作建構器，把「使用者一句話 → 影影（video-specialist）
 *      → 編出 AgentAction[]」整條決策路徑跑出來，驗證：
 *        1. video-specialist 是登記在案的精靈（family / 暱稱 / 著陸路徑）
 *        2. /video-studio 著陸精靈是影影；T2V_PROFILE 綁同一路徑
 *        3. 常見影片生成指令各自命中 video-specialist + 正確 handoff 鏈
 *        4. setModel / fillPrompt / applyTemplate / setParam 各吐出正確順序的動作
 *        5. T2V_PROFILE 內嵌的 models/templates/durations/aspects/resolutions
 *           與 shared/ 來源常數陣列對齊（防 ProfileObject 與 VideoStudio.tsx
 *           渲染來源漂移）
 *
 *   B. 瀏覽器軸（需要 dev server，且 /video-studio 非 guest 阻擋）— 真正開
 *      瀏覽器到 /video-studio，驗證：
 *        1. 頁面 shell 完整渲染（h1「影片專業工作室」+ 5 個分頁 + 光球錨點）
 *        2. 預設停在「文生影」(t2v) 分頁（Kling 卡片的提詞 placeholder 可見）
 *        3. 切分頁（文生影 → 圖生影 → 文生影）不噴 page error
 *
 * 設計取捨（與 image / pro-studio spec 一致）：
 *   - /video-studio 走 DashboardLayout，guest 會看到 LoginScreen
 *     （`.login-cosmic`）。沒提供登入 storageState 時 B 軸用 test.skip 跳過
 *     而不是失敗，CI 沒密碼也能跑 A 軸護欄。
 *   - dev server 沒起（ERR_CONNECTION_REFUSED）也以 test.skip 跳過 B 軸。
 *   - A 軸完全不 page.goto，把 orb-agent-roles / orb-studio-actions 的契約
 *     綁到 e2e suite 最外層；任一處改動忘了同步另一處時 suite 就會炸。
 *
 * 與 image spec 的關鍵差異（活碼核對結果，避免照抄踩雷）：
 *   - VideoStudio.tsx 的分頁是純 `<button>`（不是 image studio 的 role="tab"），
 *     所以 B 軸用 getByRole("button")；又因為生成按鈕也含「文生影」字樣
 *     （如「Kling 文生影」），分頁按鈕名用 ^ 錨定開頭以排除生成按鈕。
 *   - 影影的抵達話術是「影片組到了」而非「影片創作室」，故 B 字串斷言對齊實況。
 */

// ─── A 軸：純邏輯模擬（影影 ↔ 影片專業工作室文生影主流程） ─────────────────

test.describe("影片專業工作室 × 影影（video-specialist）— 純邏輯模擬", () => {
  test("video-specialist 是登記在案的精靈（family / 暱稱 / 著陸路徑）", () => {
    const role: AgentRole = "video-specialist";
    expect(SPIRIT_FAMILY[role], "video-specialist 必須登記 family").toBe(
      "specialist",
    );
    expect(getPrimaryNicknameForRole(role)).toBe("影影");
    expect(pickDefaultPathForRole(role)).toBe("/video-studio");
  });

  test("/video-studio 著陸精靈是影影；T2V_PROFILE 綁同一路徑", () => {
    expect(pickArrivalSpiritForPath("/video-studio")).toBe("video-specialist");
    // 子路徑（例如帶分頁）也要落在影影手上
    expect(pickArrivalSpiritForPath("/video-studio/i2v")).toBe(
      "video-specialist",
    );
    // profile 物件（光球發動作時讀的）必須指向同一頁，且能 round-trip 回精靈
    expect(VIDEO_STUDIO_T2V_PROFILE.pageId).toBe("video-studio");
    expect(VIDEO_STUDIO_T2V_PROFILE.pagePath).toBe("/video-studio");
    expect(VIDEO_STUDIO_T2V_PROFILE.activeTab).toBe("t2v");
    expect(pickDefaultPathForRole("video-specialist")).toBe(
      VIDEO_STUDIO_T2V_PROFILE.pagePath,
    );
  });

  test("影影抵達話術明確接手 + 帶上使用者意圖", () => {
    const text = buildArrivalFollowUpText(
      "video-specialist",
      "幫我生成一段森林晨霧的影片",
    );
    expect(text).toMatch(/影影/);
    expect(text).toMatch(/影片/);
    expect(text).toMatch(/森林晨霧/);
  });

  // 常見「使用者一句話 → 光球路由」案例。這些字串都已對真實 router 跑過驗證會
  // 命中 video-specialist（conf 0.85）；handoff 鏈 = [影影, 作曲, 評論]。
  // 註：像「幫我做一支貓咪的影片」這種「一支…影片」會被 director（規劃/腳本）
  //     接走、「幫我做一個動畫」的「動畫」會落到 image-specialist，皆不在此斷言，
  //     所以這裡只挑確定命中影影的代表性指令，避免脆測。
  const SCENARIOS: ReadonlyArray<{
    user: string;
    expectChainIncludes: AgentRole[];
  }> = [
    { user: "做一支影片", expectChainIncludes: ["video-specialist", "composer", "critic"] },
    { user: "影片編輯", expectChainIncludes: ["video-specialist", "composer", "critic"] },
    { user: "影片增強", expectChainIncludes: ["video-specialist", "composer", "critic"] },
    {
      user: "幫我生成一段影片",
      expectChainIncludes: ["video-specialist", "composer", "critic"],
    },
    { user: "i2v", expectChainIncludes: ["video-specialist", "composer", "critic"] },
  ];

  for (const sc of SCENARIOS) {
    test(`路由：「${sc.user}」→ video-specialist`, () => {
      const head = selectRoleForIntent({ text: sc.user });
      expect(head.role, `head spirit for "${sc.user}"`).toBe("video-specialist");
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

test.describe("影片專業工作室 × 文生影 — AgentAction 模擬", () => {
  test("setModel：先切 t2v 分頁再設模型", () => {
    const modelId = VIDEO_STUDIO_T2V_MODELS[0].id;
    const actions = buildVideoStudioT2VSetModelActions(modelId);
    expect(actions[0]).toEqual({ type: "setTab", tabId: "t2v" });
    expect(actions[1]).toEqual({ type: "setModel", modelId });
  });

  test("fillPrompt：先切 t2v 分頁再覆寫提示詞", () => {
    const actions = buildVideoStudioT2VFillPromptActions(
      "a slow dolly-in over a misty forest at dawn",
    );
    expect(actions[0]).toEqual({ type: "setTab", tabId: "t2v" });
    expect(actions[1]).toMatchObject({
      type: "fillPrompt",
      text: "a slow dolly-in over a misty forest at dawn",
      append: false,
    });
  });

  test("applyTemplate（含 suggestedModel + negPrompt）：切分頁 → 設模型 → 填 prompt → 填 negativePrompt", () => {
    // t2v-cinematic-portrait 同時帶 suggestedModelId 與 negPrompt，覆蓋兩個條件分支。
    const template = VIDEO_STUDIO_T2V_TEMPLATES.find(
      (t) => t.id === "t2v-cinematic-portrait",
    );
    expect(template, "範本 t2v-cinematic-portrait 必須存在").toBeTruthy();
    expect(template!.suggestedModelId).toBeTruthy();
    expect(template!.negPrompt).toBeTruthy();

    const actions = buildVideoStudioT2VApplyTemplateActions(template!);
    expect(actions[0]).toEqual({ type: "setTab", tabId: "t2v" });
    expect(actions[1]).toEqual({
      type: "setModel",
      modelId: template!.suggestedModelId,
    });
    expect(actions[2]).toMatchObject({
      type: "fillPrompt",
      text: template!.prompt,
      append: false,
    });
    // negPrompt 要落在 negativePrompt slot（防有人忘了帶 slot 把負向詞蓋掉正向詞）
    expect(actions[3]).toMatchObject({
      type: "fillPrompt",
      text: template!.negPrompt,
      append: false,
      slot: "negativePrompt",
    });
    expect(actions).toHaveLength(4);
  });

  test("applyTemplate（無 negPrompt）：不應吐出 negativePrompt 動作", () => {
    // t2v-anime-action 有 suggestedModelId 但無 negPrompt — 條件分支的另一半。
    const template = VIDEO_STUDIO_T2V_TEMPLATES.find(
      (t) => t.id === "t2v-anime-action",
    );
    expect(template, "範本 t2v-anime-action 必須存在").toBeTruthy();
    expect(template!.negPrompt, "此範本刻意不帶 negPrompt").toBeFalsy();

    const actions = buildVideoStudioT2VApplyTemplateActions(template!);
    expect(actions[0]).toEqual({ type: "setTab", tabId: "t2v" });
    expect(actions.some((a) => "slot" in a && a.slot === "negativePrompt")).toBe(
      false,
    );
    // 最後一個動作是覆寫正向 prompt，不是負向
    expect(actions[actions.length - 1]).toMatchObject({
      type: "fillPrompt",
      text: template!.prompt,
      append: false,
    });
  });

  test("setParam：先切 t2v 分頁再設任意參數（如時長）", () => {
    const duration = VIDEO_STUDIO_T2V_DURATIONS[0].value;
    const actions = buildVideoStudioT2VSetParamActions("duration", duration);
    expect(actions[0]).toEqual({ type: "setTab", tabId: "t2v" });
    expect(actions[1]).toEqual({
      type: "setParam",
      key: "duration",
      value: duration,
    });
  });

  test("T2V 契約鎖定：6 模型 union + 時長/比例/解析度錨點（防 orb↔page 漂移）", () => {
    // 注意：T2V_PROFILE.models 等欄位「就是」這些來源常數的同一參考，
    // 所以拿 profile 跟來源互比會永遠成立（套套邏輯、零防護價值）。真正要
    // 鎖的是這些 shared/ 常數本身與 VideoStudio.tsx 渲染的契約 —— 任一邊
    // 改動但忘了同步另一邊時，下面的硬斷言就會炸，逼出一次有意識的同步。

    // t2v 6 模型必須對齊 VideoStudio.tsx 文生影分頁的可選模型 union
    // （同 image spec 對 t2i 模型 union 的鎖定手法）
    expect(VIDEO_STUDIO_T2V_MODELS.map((m) => m.id).sort()).toEqual([
      "kling-t2v",
      "ltx-t2v",
      "minimax-t2v",
      "sora-t2v",
      "veo3-t2v",
      "wan-t2v",
    ]);

    // profile 是光球發動作時的入口物件，必須非空並承載同一批模型
    expect(VIDEO_STUDIO_T2V_PROFILE.models.length).toBe(
      VIDEO_STUDIO_T2V_MODELS.length,
    );

    // 時長 / 比例 / 解析度的關鍵 value 錨點（VideoStudio.tsx UI 與 orb 動作都靠它）
    const durationValues = VIDEO_STUDIO_T2V_DURATIONS.map((d) => d.value);
    expect(durationValues).toContain("5");
    expect(durationValues).toContain("10");
    const aspectValues = VIDEO_STUDIO_T2V_ASPECTS.map((a) => a.value);
    expect(aspectValues).toContain("16:9");
    expect(aspectValues).toContain("9:16");
    const resolutionValues = VIDEO_STUDIO_T2V_RESOLUTIONS.map((r) => r.value);
    expect(resolutionValues).toContain("720p");
    expect(resolutionValues).toContain("1080p");

    // 「幫我寫影片提示詞」協作流程依賴至少有 prompt 範本可套
    expect(VIDEO_STUDIO_T2V_TEMPLATES.length).toBeGreaterThan(0);
  });
});

// ─── B 軸：瀏覽器模擬（需要 storageState 或 guest 可達） ──────────────────

async function pageIsLoginGated(page: Page): Promise<boolean> {
  // DashboardLayout 在 !user 時渲染 LoginScreen — `.login-cosmic` wrapper。
  // 比檢查 URL（前端路由不改 URL）更可靠（同 image / pro-studio spec 取捨）。
  //
  // useAuth().loading 為真時會先顯示 DashboardLayoutSkeleton（兩者都還沒掛），
  // 所以先等「登入畫面」或「頁面標題」其一出現再判定，避免在 loading 空窗期
  // 誤判為「未被擋」。任一出現即可收手；都沒出現（逾時）就照原邏輯判。
  const loginWrapper = page.locator(".login-cosmic");
  const heading = page.getByRole("heading", { name: "影片專業工作室" });
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

test.describe("/video-studio 瀏覽器渲染 — 光球錨點 + 5 分頁", () => {
  // VideoStudio.tsx 的分頁是純 <button>（label + 模型數量徽章），
  // 生成按鈕也含「文生影」等字樣（如「Kling 文生影」），故用 ^ 錨定分頁標籤
  // 開頭，把分頁按鈕與生成按鈕區分開（生成按鈕一律以模型品牌名開頭）。
  const TAB_LABELS = ["文生影", "圖生影", "影生影", "畫質優化", "進階控制"];
  const tabButton = (page: Page, label: string) =>
    page.getByRole("button", { name: new RegExp("^" + label) });

  test("頁面 shell 渲染：h1 + 5 個分頁按鈕 + 光球錨點", async ({ page }) => {
    const reached = await tryGoto(page, "/video-studio");
    if (!reached) {
      test.skip(true, "dev server 未啟動 — 跑 B 軸需先 `npm run dev`");
    }
    await page.waitForLoadState("domcontentloaded");

    if (await pageIsLoginGated(page)) {
      test.skip(
        true,
        "/video-studio 在 guest 看到 LoginScreen — 跑此測試需注入登入 storageState",
      );
    }

    await expect(
      page.getByRole("heading", { name: "影片專業工作室" }),
    ).toBeVisible();

    for (const label of TAB_LABELS) {
      await expect(
        tabButton(page, label),
        `分頁按鈕「${label}」必須可見`,
      ).toBeVisible();
    }

    await expect(page.locator("#proactive-orb-anchor")).toBeAttached({
      timeout: 10_000,
    });
  });

  test("分頁切換實際更新內容（文生影 → 圖生影 → 文生影）", async ({ page }) => {
    // 只收「未捕獲的 JS 例外」(pageerror) 當切換壞掉的訊號。刻意不收所有
    // console.error —— 開發/預覽環境下 tRPC/網路/金鑰相關的 console.error
    // 與分頁切換無關，收進來會造成假性失敗（脆測）。
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    const reached = await tryGoto(page, "/video-studio");
    if (!reached) {
      test.skip(true, "dev server 未啟動 — 跑 B 軸需先 `npm run dev`");
    }
    await page.waitForLoadState("domcontentloaded");

    if (await pageIsLoginGated(page)) {
      test.skip(
        true,
        "/video-studio 在 guest 看到 LoginScreen — 跑此測試需注入登入 storageState",
      );
    }

    // 預設停在文生影 (t2v) 分頁 — 應看到 Kling 卡片的提詞 placeholder
    await expect(
      page.getByPlaceholder(/描述你想要的影片畫面/).first(),
    ).toBeVisible({ timeout: 10_000 });

    // 切到圖生影 (i2v) 分頁
    await tabButton(page, "圖生影").click();

    // 切回文生影 (t2v) 分頁應還能回來
    await tabButton(page, "文生影").click();
    await expect(
      page.getByPlaceholder(/描述你想要的影片畫面/).first(),
    ).toBeVisible({ timeout: 10_000 });

    expect(
      pageErrors,
      `切換分頁過程不能出現未捕獲的 page error，但收到:\n${pageErrors.join("\n")}`,
    ).toEqual([]);
  });
});
