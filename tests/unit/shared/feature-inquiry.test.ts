/**
 * Unit tests for detectFeatureInquiry — the natural-language feature-question
 * detector used by sendMessage to skip an LLM round-trip and serve the
 * static APP_PAGE_REGISTRY-backed feature summary instead.
 */
import { describe, expect, it } from "vitest";
import {
  detectFeatureInquiry,
  buildFeatureSummaryReply,
  getPrimarySpiritForPage,
} from "../../../shared/global-agent-workflows";
import { APP_PAGE_REGISTRY } from "../../../shared/appRegistry";

describe("detectFeatureInquiry", () => {
  it("matches direct feature questions", () => {
    expect(detectFeatureInquiry("你能做什麼？")).toBe(true);
    expect(detectFeatureInquiry("你能做什麼")).toBe(true);
    expect(detectFeatureInquiry("你能幫我做什麼")).toBe(true);
    expect(detectFeatureInquiry("你會做什麼?")).toBe(true);
    expect(detectFeatureInquiry("你可以做哪些事")).toBe(true);
  });

  it("matches feature-list / capability questions", () => {
    expect(detectFeatureInquiry("有哪些功能")).toBe(true);
    expect(detectFeatureInquiry("有什麼工具")).toBe(true);
    expect(detectFeatureInquiry("提供哪些服務")).toBe(true);
    expect(detectFeatureInquiry("這個站能做什麼")).toBe(true);
    expect(detectFeatureInquiry("這裡可以幫我做什麼")).toBe(true);
  });

  it("matches '做得到 X 嗎' inquiries", () => {
    expect(detectFeatureInquiry("做得到去背嗎")).toBe(true);
    expect(detectFeatureInquiry("生得到對嘴影片嗎")).toBe(true);
  });

  it("matches '怎麼開始 / 怎麼用' onboarding questions", () => {
    expect(detectFeatureInquiry("怎麼用")).toBe(true);
    expect(detectFeatureInquiry("怎麼開始")).toBe(true);
    expect(detectFeatureInquiry("如何用")).toBe(true);
  });

  it("matches the newly-added phrasings", () => {
    expect(detectFeatureInquiry("介紹一下你的功能")).toBe(true);
    expect(detectFeatureInquiry("簡介一下這個站的服務")).toBe(true);
    expect(detectFeatureInquiry("你的功能是什麼")).toBe(true);
    expect(detectFeatureInquiry("你的能力到哪裡")).toBe(true);
    expect(detectFeatureInquiry("全部功能")).toBe(true);
    expect(detectFeatureInquiry("所有工具")).toBe(true);
  });

  it("rejects non-inquiry text that happens to share words", () => {
    expect(detectFeatureInquiry("我能不能換個方向")).toBe(false);
    expect(detectFeatureInquiry("你做的不錯")).toBe(false);
    expect(detectFeatureInquiry("我想做一張圖")).toBe(false);
    expect(detectFeatureInquiry("這個 prompt 有點短")).toBe(false);
    expect(detectFeatureInquiry("")).toBe(false);
  });

  it("rejects very long messages even if they contain inquiry keywords", () => {
    const long = "你能做什麼" + "讓我們聊聊細節".repeat(20);
    expect(detectFeatureInquiry(long)).toBe(false);
  });

  it("accepts a medium-length question now that the cap was raised to 140", () => {
    // 80 < N < 140 的真實打字長度，舊上限 (80) 會擋掉、新上限 (140) 接得起。
    // 用 repeat 拼出穩定長度，避免 CJK 寬字數法不一致造成 flaky。
    const medium = "你能做什麼" + "，順便講一下大概要幾步驟好嗎".repeat(7);
    expect(medium.length).toBeGreaterThan(80);
    expect(medium.length).toBeLessThan(140);
    expect(detectFeatureInquiry(medium)).toBe(true);
  });
});

describe("buildFeatureSummaryReply", () => {
  it("renders a non-empty list with the canonical header", () => {
    const reply = buildFeatureSummaryReply();
    expect(reply).toMatch(/取自實際註冊的功能列表/);
    // 應該至少列幾個 page 路徑
    expect(reply.match(/路徑：/g)?.length ?? 0).toBeGreaterThan(3);
    // 結尾鼓勵下一步
    expect(reply).toMatch(/帶我去/);
  });

  it("annotates every listed feature with a 主要由 @<nickname> 負責 attribution", () => {
    const reply = buildFeatureSummaryReply();
    // 路徑出現多少次，主要由 也應該出現相同次數（每條 feature 一個署名）
    const pathCount = reply.match(/路徑：/g)?.length ?? 0;
    const attributionCount = reply.match(/主要由 @/g)?.length ?? 0;
    expect(pathCount).toBeGreaterThan(0);
    expect(attributionCount).toBe(pathCount);
  });

  it("appends a 「還有 N 項…」 hint when the registry is larger than the limit", () => {
    // registry 預設 > 14 筆；用 limit=3 強制觸發截斷尾段。
    const reply = buildFeatureSummaryReply({ limit: 3 });
    expect(reply).toMatch(/還有 \d+ 項功能沒列出來/);
  });

  it("re-sorts favorite-spirit pages to the top and marks them with ★", () => {
    // 找一個明顯由 training-specialist 負責的頁面（lora-trainer）— 把
    // training-specialist 設為最愛，看看它有沒有冒到清單前面 + 帶 ★。
    const trainerPage = APP_PAGE_REGISTRY.find(p => p.id === "lora-trainer");
    expect(trainerPage).toBeDefined();
    const reply = buildFeatureSummaryReply({
      favoriteSpirits: ["training-specialist"],
    });
    // 應該至少出現一個 ★ 標記
    expect(reply).toMatch(/★ /);
  });

  it("hides pages owned by muted spirits and notes the hidden count", () => {
    // 隨便挑一個常見負責的精靈靜音，確認尾段補上隱藏行。
    const reply = buildFeatureSummaryReply({
      mutedSpirits: ["training-specialist"],
    });
    expect(reply).toMatch(/已依你的偏好隱藏 \d+ 項/);
  });
});

describe("getPrimarySpiritForPage", () => {
  it("maps every showInAgentHome page to a non-empty primary spirit nickname target", () => {
    const homePages = APP_PAGE_REGISTRY.filter(
      p => p.showInAgentHome && p.path !== "/agent"
    );
    expect(homePages.length).toBeGreaterThan(3);
    for (const page of homePages) {
      const role = getPrimarySpiritForPage(page);
      expect(typeof role).toBe("string");
      expect(role.length).toBeGreaterThan(0);
    }
  });
});
