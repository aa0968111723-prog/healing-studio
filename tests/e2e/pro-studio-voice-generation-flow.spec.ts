import { test, expect, type Page } from "@playwright/test";
import {
  selectRoleForIntent,
  composeRoleChain,
  pickDefaultPathForRole,
  buildArrivalFollowUpText,
  getPrimaryNicknameForRole,
  SPIRIT_FAMILY,
  type AgentRole,
} from "../../shared/orb-agent-roles";
import {
  PRO_STUDIO_TTS_MODELS,
  PRO_STUDIO_TTS_TEMPLATES,
  PRO_STUDIO_TTS_SPEED_PRESETS,
  PRO_STUDIO_TTS_STABILITY_PRESETS,
  PRO_STUDIO_TTS_PROFILE,
  PRO_STUDIO_CLONE_MODELS,
  PRO_STUDIO_CLONE_TEMPLATES,
  PRO_STUDIO_CLONE_PROFILE,
  buildProStudioSetModelActions,
  buildProStudioFillPromptActions,
  buildProStudioApplyTemplateActions,
} from "../../shared/orb-studio-actions";

/**
 * 語音生成主流程端對端護欄（AIDV-35 opt-cycle 互補項第三條：image 已於
 * #1064、video 已於 #1066、各創作室子分頁於 #1070 補上；本卡照同一雙軸範本
 * 補上「語音」最後一條 —— 聲聲（voice-specialist）× 音樂配音創作室的
 * 語音合成(TTS) / 聲音克隆(Clone) 主流程）。
 *
 * 與既有 `orb-pro-studio-25-spirits.spec.ts` 的關係（避免重工、互補不重疊）：
 *   - 25-spirits 那條是「音音(music-specialist)」視角 —— 它只鎖了 music 4
 *     模型 union、music 範本、以及 7 分頁的 setModel/fillPrompt/setParam 泛用
 *     形狀（用 "test-model" 佔位），並未鎖任何「語音」域的模型清單 / 預設值 /
 *     範本參數。
 *   - 本條補的是「聲聲(voice-specialist)」視角的**語音域契約**：TTS 兩引擎
 *     union、速度/穩定度預設值、含 params 的 TTS 範本動作序列；以及 Clone
 *     五工具 union、voice-design 的 voice_description 參數契約。任一邊（shared/
 *     常數 ↔ ProStudio.tsx 渲染）改了忘了同步另一邊，這套就會立刻炸。
 *
 * 兩條軸（沿用 image/video/pro-studio spec 的雙軸設計）：
 *
 *   A. 純邏輯軸（不需要瀏覽器 / 登入 / provider）— 直接 import 真實的
 *      shared/ 路由器與動作建構器，把「使用者一句話 → 聲聲（voice-specialist）
 *      → 編出 AgentAction[]」整條決策路徑跑出來。
 *
 *   B. 瀏覽器軸（需要 dev server，且 /pro-studio 非 guest 阻擋）— 真正開
 *      瀏覽器到 /pro-studio，切到語音合成 / 聲音克隆分頁驗 shell 不噴 error。
 *      沒起 dev server 或 guest 被登入頁擋住時 test.skip 跳過（CI 仍跑 A 軸）。
 *
 * 設計取捨（與 image / video / pro-studio spec 一致）：
 *   - /pro-studio 走 DashboardLayout，guest 會看到 LoginScreen（`.login-cosmic`）。
 *     沒提供登入 storageState 時 B 軸用 test.skip 跳過而非失敗。
 *   - 著陸精靈刻意**不**斷言為聲聲 —— /pro-studio 的預設著陸精靈是音音
 *     (music-specialist)；聲聲與音音同住一頁，聲聲的「家路徑」也是 /pro-studio
 *     但不是預設著陸者，照實況斷言避免脆測。
 */

// ─── A 軸：聲聲（voice-specialist）路由與抵達 ────────────────────────────

test.describe("音樂配音創作室 × 聲聲（voice-specialist）— 純邏輯模擬", () => {
  test("voice-specialist 是登記在案的精靈（family / 暱稱 / 著陸契約）", () => {
    const role: AgentRole = "voice-specialist";
    expect(SPIRIT_FAMILY[role], "voice-specialist 必須登記 family").toBe(
      "specialist",
    );
    expect(getPrimaryNicknameForRole(role)).toBe("聲聲");
    // 聲聲沒有自己的「預設著陸路徑」—— 它與音音同住 /pro-studio，但該頁的
    // 預設著陸者是音音(music-specialist)；聲聲是經由語意路由 / 交棒被叫上場
    // 的。這裡鎖住此契約：voice-specialist 的 pickDefaultPathForRole 為 null，
    // 而 music-specialist 才擁有 /pro-studio 的預設著陸權。若哪天給聲聲開了
    // 獨立著陸頁，這條會炸，逼出一次有意識的更新。
    expect(pickDefaultPathForRole(role)).toBeNull();
    expect(pickDefaultPathForRole("music-specialist")).toBe("/pro-studio");
  });

  test("聲聲抵達話術明確接手 + 帶上使用者意圖", () => {
    const text = buildArrivalFollowUpText(
      "voice-specialist",
      "幫我做一段中文旁白",
    );
    expect(text).toMatch(/聲聲/);
    expect(text).toMatch(/配音間/);
    expect(text).toMatch(/中文旁白/);
  });

  // 常見「使用者一句話 → 光球路由」案例。這些字串都已對真實 router 跑過驗證會
  // 命中 voice-specialist；handoff 鏈 = [聲聲, 編編(composer), 品品(critic)]。
  // 註：像「幫我從腳本一路做到影片＋BGM＋旁白」這種會被 director 接走、純「音樂」
  //     會落到 music-specialist，皆不在此斷言；這裡只挑確定命中聲聲的代表指令。
  const SCENARIOS: ReadonlyArray<{
    user: string;
    expectChainIncludes: AgentRole[];
  }> = [
    {
      user: "幫我做一段中文旁白",
      expectChainIncludes: ["voice-specialist", "composer", "critic"],
    },
    {
      user: "幫我配音",
      expectChainIncludes: ["voice-specialist", "composer", "critic"],
    },
    {
      user: "口播",
      expectChainIncludes: ["voice-specialist", "composer", "critic"],
    },
    {
      user: "聲音克隆",
      expectChainIncludes: ["voice-specialist", "composer", "critic"],
    },
    {
      user: "voiceover",
      expectChainIncludes: ["voice-specialist", "composer", "critic"],
    },
  ];

  for (const sc of SCENARIOS) {
    test(`路由：「${sc.user}」→ voice-specialist`, () => {
      const head = selectRoleForIntent({ text: sc.user });
      expect(head.role, `head spirit for "${sc.user}"`).toBe(
        "voice-specialist",
      );
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

// ─── A 軸：語音合成(TTS) AgentAction 契約 ────────────────────────────────

test.describe("音樂配音創作室 × 語音合成(TTS) — AgentAction 模擬", () => {
  test("setModel：先切 tts 分頁再設模型", () => {
    const modelId = PRO_STUDIO_TTS_MODELS[0].id;
    const actions = buildProStudioSetModelActions("tts", modelId);
    expect(actions[0]).toEqual({ type: "setTab", tabId: "tts" });
    expect(actions[1]).toEqual({ type: "setModel", modelId });
  });

  test("fillPrompt：先切 tts 分頁再覆寫稿件", () => {
    const actions = buildProStudioFillPromptActions(
      "tts",
      "在那個遙遠的午後，陽光穿過窗簾的縫隙。",
    );
    expect(actions[0]).toEqual({ type: "setTab", tabId: "tts" });
    expect(actions[1]).toMatchObject({
      type: "fillPrompt",
      text: "在那個遙遠的午後，陽光穿過窗簾的縫隙。",
      append: false,
    });
  });

  test("applyTemplate（含 params）：冥想引導 → 切分頁 → 設模型 → 填稿 → setParam×2（速度 + 穩定度）", () => {
    // tts-meditation 同時帶 suggestedModelId(eleven-tts) 與 params(speed/stability)，
    // 覆蓋「範本帶參數」這條分支 —— 防有人把 params 漏掉時靜默 no-op。
    const meditation = PRO_STUDIO_TTS_TEMPLATES.find(
      (t) => t.id === "tts-meditation",
    );
    expect(meditation, "範本 tts-meditation 必須存在").toBeTruthy();
    expect(meditation!.suggestedModelId).toBe("eleven-tts");
    expect(meditation!.params, "tts-meditation 必須帶 params").toBeTruthy();

    const actions = buildProStudioApplyTemplateActions("tts", meditation!);
    expect(actions[0]).toEqual({ type: "setTab", tabId: "tts" });
    expect(actions[1]).toEqual({
      type: "setModel",
      modelId: "eleven-tts",
    });
    expect(actions[2]).toMatchObject({
      type: "fillPrompt",
      text: meditation!.prompt,
      append: false,
    });
    // 其後皆為 setParam，且 key 集合須涵蓋 speed / stability。
    const paramActions = actions.slice(3);
    expect(paramActions.length).toBeGreaterThanOrEqual(2);
    expect(paramActions.every((a) => a.type === "setParam")).toBe(true);
    const paramKeys = paramActions.map((a) =>
      a.type === "setParam" ? a.key : "",
    );
    expect(paramKeys).toContain("speed");
    expect(paramKeys).toContain("stability");
  });

  test("applyTemplate（無 params）：旁白朗讀 → 只到 fillPrompt、不吐 setParam", () => {
    // tts-narration 有 suggestedModelId(qwen-tts) 但無 params — 條件分支另一半。
    const narration = PRO_STUDIO_TTS_TEMPLATES.find(
      (t) => t.id === "tts-narration",
    );
    expect(narration, "範本 tts-narration 必須存在").toBeTruthy();
    expect(narration!.params, "此範本刻意不帶 params").toBeFalsy();

    const actions = buildProStudioApplyTemplateActions("tts", narration!);
    expect(actions[0]).toEqual({ type: "setTab", tabId: "tts" });
    expect(actions[1]).toEqual({ type: "setModel", modelId: "qwen-tts" });
    expect(actions[actions.length - 1]).toMatchObject({
      type: "fillPrompt",
      text: narration!.prompt,
    });
    expect(actions.some((a) => a.type === "setParam")).toBe(false);
  });

  test("TTS 契約鎖定：2 引擎 union + 速度/穩定度預設錨點（防 orb↔ProStudio 漂移）", () => {
    // TTS 兩引擎必須對齊 ProStudio.tsx 語音合成分頁的可選引擎 union。
    expect(PRO_STUDIO_TTS_MODELS.map((m) => m.id).sort()).toEqual([
      "eleven-tts",
      "qwen-tts",
    ]);

    // 速度預設關鍵 value 錨點（慢 / 自然 / 快）。
    const speedValues = PRO_STUDIO_TTS_SPEED_PRESETS.map((p) => p.value);
    expect(speedValues).toContain(0.85);
    expect(speedValues).toContain(1.0);
    expect(speedValues).toContain(1.15);

    // 穩定度預設關鍵 value 錨點（情緒 / 平衡 / 穩定）。
    const stabilityValues = PRO_STUDIO_TTS_STABILITY_PRESETS.map((p) => p.value);
    expect(stabilityValues).toContain(0.4);
    expect(stabilityValues).toContain(0.6);
    expect(stabilityValues).toContain(0.85);

    // profile 是光球發動作時的入口物件，必須非空並承載同一批引擎與預設。
    expect(PRO_STUDIO_TTS_PROFILE.pagePath).toBe("/pro-studio");
    expect(PRO_STUDIO_TTS_PROFILE.activeTab).toBe("tts");
    expect(PRO_STUDIO_TTS_PROFILE.models.length).toBe(
      PRO_STUDIO_TTS_MODELS.length,
    );
    expect(PRO_STUDIO_TTS_PROFILE.templates.length).toBeGreaterThan(0);
  });
});

// ─── A 軸：聲音克隆(Clone) AgentAction 契約 ──────────────────────────────

test.describe("音樂配音創作室 × 聲音克隆(Clone) — AgentAction 模擬", () => {
  test("Clone 契約鎖定：5 工具 union + profile 對齊（防 orb↔ProStudio 漂移）", () => {
    // 聲音克隆五工具必須對齊 ProStudio.tsx 聲音克隆分頁的可選工具 union。
    expect(PRO_STUDIO_CLONE_MODELS.map((m) => m.id).sort()).toEqual([
      "dia-clone",
      "eleven-ivc",
      "kling-voice",
      "qwen-clone",
      "voice-design",
    ]);
    expect(PRO_STUDIO_CLONE_PROFILE.pagePath).toBe("/pro-studio");
    expect(PRO_STUDIO_CLONE_PROFILE.activeTab).toBe("clone");
    expect(PRO_STUDIO_CLONE_PROFILE.models.length).toBe(
      PRO_STUDIO_CLONE_MODELS.length,
    );
  });

  test("applyTemplate（voice-design）：切 clone → 設 voice-design → 填稿 → setParam mode + voice_description", () => {
    // clone-design-warm 是「從零設計音色」的代表範本，帶 mode=design 與
    // voice_description 兩個 params。voice_description 是 voice-design 模式的
    // 靈魂參數（沒它就退化成隨機音色），所以特別鎖它有被帶進動作序列。
    const designWarm = PRO_STUDIO_CLONE_TEMPLATES.find(
      (t) => t.id === "clone-design-warm",
    );
    expect(designWarm, "範本 clone-design-warm 必須存在").toBeTruthy();
    expect(designWarm!.suggestedModelId).toBe("voice-design");

    const actions = buildProStudioApplyTemplateActions("clone", designWarm!);
    expect(actions[0]).toEqual({ type: "setTab", tabId: "clone" });
    expect(actions[1]).toEqual({ type: "setModel", modelId: "voice-design" });
    expect(actions[2]).toMatchObject({ type: "fillPrompt", append: false });

    const paramEntries = actions
      .filter((a) => a.type === "setParam")
      .map((a) => (a.type === "setParam" ? [a.key, a.value] : []));
    const paramMap = new Map(paramEntries as [string, unknown][]);
    expect(paramMap.get("mode")).toBe("design");
    expect(
      typeof paramMap.get("voice_description"),
      "voice-design 的靈魂參數 voice_description 必須被帶進動作序列",
    ).toBe("string");
  });
});

// ─── B 軸：瀏覽器模擬（需要 storageState 或 guest 可達） ──────────────────

async function pageIsLoginGated(page: Page): Promise<boolean> {
  // DashboardLayout 在 !user 時渲染 LoginScreen — `.login-cosmic` wrapper。
  // useAuth().loading 為真時先顯示 skeleton，故先等「登入畫面」或「頁面標題」
  // 其一出現再判定，避免在 loading 空窗期誤判為「未被擋」。
  const loginWrapper = page.locator(".login-cosmic");
  const heading = page.getByRole("heading", { name: "音樂配音創作室" });
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

test.describe("/pro-studio 語音分頁瀏覽器 smoke — 語音合成 + 聲音克隆", () => {
  test("切到語音合成分頁顯示 TTS 雙引擎、切到聲音克隆不噴 page error", async ({
    page,
  }) => {
    // 只收「未捕獲的 JS 例外」(pageerror) 當切換壞掉的訊號；不收所有
    // console.error（tRPC / 網路 / 金鑰相關的 error 與分頁切換無關，收進來
    // 會造成假性失敗）。
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));

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

    await expect(
      page.getByRole("heading", { name: "音樂配音創作室" }),
    ).toBeVisible();

    // 切到語音合成 (tts) 分頁 — 應看到 TTS 標題與雙引擎描述（直接守 UI 層 union）。
    await page.getByRole("button", { name: /語音合成/ }).click();
    await expect(page.getByText("AI 語音合成 (TTS)").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/ElevenLabs Turbo v2\.5/).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/Qwen3-TTS/).first()).toBeVisible({
      timeout: 10_000,
    });

    // 切到聲音克隆 (clone) 分頁 — 只驗切換不噴 page error。
    await page.getByRole("button", { name: /聲音克隆/ }).click();

    expect(
      pageErrors,
      `切換語音分頁過程不能出現未捕獲的 page error，但收到:\n${pageErrors.join("\n")}`,
    ).toEqual([]);
  });
});
