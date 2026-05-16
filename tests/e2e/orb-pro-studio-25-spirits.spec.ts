import { test, expect, type Page } from "@playwright/test";
import {
  composeRoleChain,
  pickArrivalSpiritForPath,
  pickDefaultPathForRole,
  selectRoleForIntent,
  buildArrivalFollowUpText,
  getPrimaryNicknameForRole,
  SPIRIT_FAMILY,
  type AgentRole,
} from "../../shared/orb-agent-roles";
import {
  PRO_STUDIO_MUSIC_PROFILE,
  PRO_STUDIO_MUSIC_MODELS,
  PRO_STUDIO_MUSIC_TEMPLATES,
  PRO_STUDIO_TTS_PROFILE,
  PRO_STUDIO_CLONE_PROFILE,
  buildProStudioSetModelActions,
  buildProStudioFillPromptActions,
  buildProStudioSetParamActions,
  buildProStudioApplyTemplateActions,
} from "../../shared/orb-studio-actions";

/**
 * 模擬「真實全站光球代理互動 25 精靈 ↔ 音樂配音創作室」端對端旅程。
 *
 * 兩條軸：
 *
 *   A. 純邏輯軸（不需要瀏覽器登入）— 從 shared/ 直接 import 真實的路由器
 *      （selectRoleForIntent / composeRoleChain / pickArrivalSpiritForPath
 *      / buildProStudio*Actions），把光球收到「自然語言」→ 選精靈 → 編出
 *      AgentAction[] 的決策路徑跑出來，驗證:
 *        1. 25 位精靈每一位都有家（family / arrival path / default path）
 *        2. /pro-studio 著陸精靈是音音 (music-specialist)
 *        3. 5 種常見音樂配音指令各自命中正確的精靈與 handoff 鏈
 *        4. buildProStudio*Actions 對 7 個分頁都吐得出可 dispatch 的動作
 *
 *   B. 瀏覽器軸（需要可登入或預先注入 storageState）— 真正開瀏覽器到
 *      /pro-studio，驗證:
 *        1. 頁面 shell 完整渲染（h1 "音樂配音創作室" + 7 個分頁按鈕）
 *        2. 點分頁切換真的會改變內容（每個分頁有獨特 SR 友善文字）
 *        3. 全站光球錨點 (#proactive-orb-anchor) 隨頁面掛載
 *        4. 點分頁切換沒造成任何未捕獲的 console error
 *
 * 設計取捨：
 *   - /pro-studio 在 DashboardLayout 內走 useAuth，guest 看到 LoginScreen；
 *     如果跑 e2e 時沒提供登入 storageState，B 軸的測試會用 test.skip 跳過
 *     而不是失敗，這樣 CI smoke 仍能在沒密碼的環境跑 A 軸保護
 *   - A 軸完全不用 page.goto，直接吃 shared/ 模組，等同於把
 *     orb-studio-actions / orb-agent-roles 的契約綁到 Playwright e2e 套件
 *     最外層，任何一處被改動但忘了同步另一處時 e2e suite 也會炸
 */

// ─── A 軸：純邏輯模擬（25 精靈 ↔ ProStudio 決策路徑） ─────────────────────

const ALL_SPIRITS: AgentRole[] = [
  "director",
  "composer",
  "critic",
  "researcher",
  "navigator",
  "companion",
  "accountant",
  "quality-coach",
  "inspector",
  "image-specialist",
  "video-specialist",
  "music-specialist",
  "voice-specialist",
  "training-specialist",
  "learning-specialist",
  "legal-advisor",
  "security-guard",
  "community-manager",
  "chief-orchestrator",
  "onboarding-coach",
  "notes-curator",
  "settings-detail",
  "plan-executor",
  "inspiration-specialist",
  "anatomy-specialist",
];

test.describe("光球代理 × 25 精靈 — 純邏輯模擬", () => {
  test("剛好 25 位精靈，每一位都有 family", () => {
    expect(ALL_SPIRITS).toHaveLength(25);
    const families = new Set(ALL_SPIRITS.map((r) => SPIRIT_FAMILY[r]));
    expect(families.size).toBeGreaterThanOrEqual(2);
    for (const role of ALL_SPIRITS) {
      expect(SPIRIT_FAMILY[role], `${role} 必須登記 family`).toMatch(
        /^(specialist|role|proactive)$/,
      );
      expect(getPrimaryNicknameForRole(role).length).toBeGreaterThan(0);
    }
  });

  test("/pro-studio 著陸精靈是音音 (music-specialist)", () => {
    expect(pickArrivalSpiritForPath("/pro-studio")).toBe("music-specialist");
    expect(pickArrivalSpiritForPath("/pro-studio/music")).toBe(
      "music-specialist",
    );
    expect(pickDefaultPathForRole("music-specialist")).toBe("/pro-studio");
  });

  test("音音抵達話術明確接手 + 帶上使用者意圖", () => {
    const text = buildArrivalFollowUpText(
      "music-specialist",
      "做一段 60 秒咖啡廳輕音樂",
    );
    expect(text).toMatch(/音音/);
    expect(text).toMatch(/音樂室/);
    expect(text).toMatch(/咖啡廳/);
  });

  // 5 種常見「使用者一句話 → 光球路由」案例，每個都要命中正確精靈 +
  // 完整 handoff 鏈裡含目標 specialist。
  const SCENARIOS: ReadonlyArray<{
    user: string;
    expectHead: AgentRole;
    expectChainIncludes: AgentRole[];
  }> = [
    {
      user: "幫我做一段 60 秒咖啡廳輕音樂",
      expectHead: "music-specialist",
      expectChainIncludes: ["music-specialist", "composer", "critic"],
    },
    {
      user: "幫我做一段中文旁白",
      expectHead: "voice-specialist",
      expectChainIncludes: ["voice-specialist", "composer", "critic"],
    },
    {
      user: "幫我從腳本一路做到影片＋BGM＋旁白",
      expectHead: "director",
      expectChainIncludes: ["director", "composer", "critic"],
    },
    {
      user: "幫我把這段 prompt 改寫得更好",
      expectHead: "quality-coach",
      expectChainIncludes: ["quality-coach", "composer", "critic"],
    },
    {
      user: "比較 Sonauto 跟 ACE-Step 差在哪",
      expectHead: "researcher",
      expectChainIncludes: ["researcher"],
    },
  ];

  for (const sc of SCENARIOS) {
    test(`路由：「${sc.user}」→ ${sc.expectHead}`, () => {
      const head = selectRoleForIntent({ text: sc.user });
      expect(head.role, `head spirit for "${sc.user}"`).toBe(sc.expectHead);
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

test.describe("光球代理 × ProStudio 7 分頁 — AgentAction 模擬", () => {
  // 「音音收到請求 → 編出 AgentAction[]」— 每一個分頁都驗一次能跑通
  // setTab / setModel / fillPrompt / setParam / applyTemplate 五條主軸。
  const PRO_TABS = [
    "music",
    "sfx",
    "tts",
    "clone",
    "process",
    "asr",
    "avatar",
  ] as const;

  for (const tab of PRO_TABS) {
    test(`分頁 ${tab}：setModel + fillPrompt + setParam 動作序列`, () => {
      const setModel = buildProStudioSetModelActions(tab, "test-model");
      expect(setModel[0]).toEqual({ type: "setTab", tabId: tab });
      expect(setModel[1]).toEqual({ type: "setModel", modelId: "test-model" });

      const fillPrompt = buildProStudioFillPromptActions(tab, "hello world");
      expect(fillPrompt[0]).toEqual({ type: "setTab", tabId: tab });
      expect(fillPrompt[1]).toMatchObject({
        type: "fillPrompt",
        text: "hello world",
      });

      const setParam = buildProStudioSetParamActions(tab, "duration", 60);
      expect(setParam[0]).toEqual({ type: "setTab", tabId: tab });
      expect(setParam[1]).toEqual({
        type: "setParam",
        key: "duration",
        value: 60,
      });
    });
  }

  test("套用音樂模板「冥想引導」→ 4 條動作依序送出（setTab → setModel → fillPrompt → setParam×2）", () => {
    const meditation = PRO_STUDIO_MUSIC_TEMPLATES.find(
      (t) => t.id === "music-meditation",
    );
    expect(meditation, "PRO_STUDIO_MUSIC_TEMPLATES 必須有 music-meditation").toBeDefined();
    const actions = buildProStudioApplyTemplateActions("music", meditation!);
    expect(actions[0]).toEqual({ type: "setTab", tabId: "music" });
    expect(actions[1]).toMatchObject({ type: "setModel" });
    expect(actions[2]).toMatchObject({ type: "fillPrompt" });
    expect(actions.slice(3).every((a) => a.type === "setParam")).toBe(true);
  });

  test("ProStudio profile 對齊 ProStudio.tsx 實際分頁配置", () => {
    expect(PRO_STUDIO_MUSIC_PROFILE.pagePath).toBe("/pro-studio");
    expect(PRO_STUDIO_MUSIC_PROFILE.activeTab).toBe("music");
    // 音樂分頁的 4 個模型必須對齊 ProStudio.tsx 裡 MusicModelChoice 的 union
    const musicModelIds = PRO_STUDIO_MUSIC_MODELS.map((m) => m.id).sort();
    expect(musicModelIds).toEqual([
      "ace-step",
      "musicgen",
      "sonauto",
      "stable-audio",
    ]);
    expect(PRO_STUDIO_TTS_PROFILE.activeTab).toBe("tts");
    expect(PRO_STUDIO_CLONE_PROFILE.activeTab).toBe("clone");
  });
});

// ─── B 軸：瀏覽器模擬（需要 storageState 或 guest 可達） ──────────────────

async function pageIsLoginGated(page: Page): Promise<boolean> {
  // DashboardLayout 在 !user 時渲染 LoginScreen — 它有 `.login-cosmic` wrapper
  // 跟「歡迎」/「登入」字串。比起檢查 URL（前端路由不會改 URL）更可靠。
  const loginWrapper = page.locator(".login-cosmic");
  return (await loginWrapper.count()) > 0;
}

/**
 * 嘗試 page.goto，失敗（ERR_CONNECTION_REFUSED — 沒人在跑 dev server）就
 * 回 false，讓 caller 用 test.skip 跳過 — 這樣 CI 沒備好 dev server 時也
 * 能讓 A 軸（純邏輯）測試正常跑完，不會被 B 軸的連線失敗整個炸掉。
 */
async function tryGoto(page: Page, path: string): Promise<boolean> {
  try {
    await page.goto(path);
    return true;
  } catch {
    return false;
  }
}

test.describe("/pro-studio 瀏覽器渲染 — 光球錨點 + 7 分頁", () => {
  const PROD_TABS_LABELS = [
    "音樂生成",
    "音效生成",
    "語音合成",
    "聲音克隆",
    "音訊處理",
    "語音識別",
    "AI 形像影片",
  ];

  test("頁面 shell 渲染：h1 + 7 個分頁按鈕 + 光球錨點", async ({ page }) => {
    const reached = await tryGoto(page, "/pro-studio");
    if (!reached) {
      test.skip(true, "dev server 未啟動 — 跑 B 軸需先 `npm run dev`");
    }
    await page.waitForLoadState("domcontentloaded");

    if (await pageIsLoginGated(page)) {
      test.skip(
        true,
        "/pro-studio 在 guest 看到 LoginScreen — 跑此測試需注入登入 storageState",
      );
    }

    // 主標題
    await expect(page.getByRole("heading", { name: "音樂配音創作室" })).toBeVisible();

    // 7 個分頁按鈕（用文字判定就好 — ProStudio 直接用 <button>+標籤）
    for (const label of PROD_TABS_LABELS) {
      const btn = page.getByRole("button", { name: new RegExp(label) });
      await expect(btn, `分頁按鈕「${label}」必須可見`).toBeVisible();
    }

    // 全站光球錨點
    await expect(page.locator("#proactive-orb-anchor")).toBeAttached({
      timeout: 10_000,
    });
  });

  test("分頁切換實際更新內容（音樂 → 語音合成 → 聲音克隆）", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => consoleErrors.push(String(err)));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    const reached = await tryGoto(page, "/pro-studio");
    if (!reached) {
      test.skip(true, "dev server 未啟動 — 跑 B 軸需先 `npm run dev`");
    }
    await page.waitForLoadState("domcontentloaded");

    if (await pageIsLoginGated(page)) {
      test.skip(
        true,
        "/pro-studio 在 guest 看到 LoginScreen — 跑此測試需注入登入 storageState",
      );
    }

    // 預設停在音樂分頁 — 應該看到「咖啡廳輕音樂」這類音樂分頁限定文字
    await expect(page.getByText("咖啡廳輕音樂").first()).toBeVisible({
      timeout: 10_000,
    });

    // 切到語音合成分頁
    await page.getByRole("button", { name: /語音合成/ }).click();
    await expect(page.getByText(/AI 語音合成|TTS/).first()).toBeVisible({
      timeout: 10_000,
    });

    // 切到聲音克隆分頁
    await page.getByRole("button", { name: /聲音克隆/ }).click();
    // 聲音克隆分頁有獨特的 placeholder 文案（design 模式預設句）
    await expect(
      page.getByPlaceholder(/我是你設計的聲音/).first(),
    ).toBeVisible({ timeout: 10_000 });

    // 切回音樂分頁應該還能再回來
    await page.getByRole("button", { name: /音樂生成/ }).click();
    await expect(page.getByText("咖啡廳輕音樂").first()).toBeVisible({
      timeout: 10_000,
    });

    expect(
      consoleErrors,
      `切換分頁過程不能出現 console error / page error，但收到:\n${consoleErrors.join("\n")}`,
    ).toEqual([]);
  });
});
