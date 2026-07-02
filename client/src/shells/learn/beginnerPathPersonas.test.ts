/**
 * beginnerPathPersonas（AIDV-965）純函式測試。
 * 三大守則：
 *   ① persona→STEPS 映射窮盡測（每個 persona：3–5 步、id 唯一、docId/categoryKey/href 合法）。
 *   ② 「下一步」chips 重排邏輯測（每 persona 釘住順序；null/general＝原順序；不變動輸入）。
 *   ③ 零回歸測：未設 persona（null）時，STEPS／副標題／完成文案與 AIDV-811 現行輸出 100% 相同。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  PERSONAS,
  PERSONA_LS_KEY,
  DEFAULT_STEPS,
  DEFAULT_SUBTITLE,
  DEFAULT_COMPLETION,
  getStepsForPersona,
  getPathSubtitle,
  getCompletionCopy,
  reorderNextStepChips,
  loadPersona,
  savePersona,
  type PersonaKey,
} from "./beginnerPathPersonas";
import { METHODOLOGY_DOCS, LEARN_CATEGORIES } from "./learnContent";

const ALL_KEYS: PersonaKey[] = ["ecommerce", "educator", "freelancer", "brand", "general"];

/** App.tsx 既有路由 + /learn?sub=hub 深連結 + 4-shell /video（現行 STEPS 已用）。 */
const VALID_HREFS = new Set([
  "/create",
  "/video",
  "/pro-studio",
  "/image-studio",
  "/video-studio",
  "/director",
  "/lora-trainer",
  "/vault",
  "/assets",
  "/learn?sub=hub",
]);

// AIDV-810 現行「下一步」chips 原順序（OnboardingFlow NEXT_STEP_CHIPS 的鏡像）。
const CHIPS = [
  { label: "🎵 配音", path: "/pro-studio" },
  { label: "🎬 圖生影", path: "/video-studio" as string | null },
  { label: "🎭 導演", path: "/director" },
  { label: "🖼️ 再生一張", path: null },
];
const ORIGINAL_ORDER = CHIPS.map((c) => c.path);

describe("PERSONAS 定義", () => {
  it("恰好 5 個 persona：電商賣家/教育者/接案者/品牌方/通用", () => {
    expect(PERSONAS.map((p) => p.key)).toEqual(ALL_KEYS);
    expect(PERSONAS.map((p) => p.label)).toEqual([
      "電商賣家", "教育者", "接案者", "品牌方", "通用",
    ]);
  });

  it("每個 persona 都有 emoji / subtitle / completion 文案", () => {
    for (const p of PERSONAS) {
      expect(p.emoji.length, p.key).toBeGreaterThan(0);
      expect(p.subtitle.length, p.key).toBeGreaterThan(0);
      expect(p.completion.title.length, p.key).toBeGreaterThan(0);
      expect(p.completion.body.length, p.key).toBeGreaterThan(0);
    }
  });
});

describe("persona→STEPS 映射（窮盡）", () => {
  const docIds = new Set(METHODOLOGY_DOCS.map((d) => d.id));
  const catKeys = new Set(LEARN_CATEGORIES.map((c) => c.key));

  it.each(ALL_KEYS)("%s：3–5 步、欄位齊全、docId/categoryKey/href 合法", (key) => {
    const steps = getStepsForPersona(key);
    expect(steps.length).toBeGreaterThanOrEqual(3);
    expect(steps.length).toBeLessThanOrEqual(5);
    const ids = new Set(steps.map((s) => s.id));
    expect(ids.size).toBe(steps.length); // id 唯一
    for (const s of steps) {
      expect(s.title.length, s.id).toBeGreaterThan(0);
      expect(s.learn.length, s.id).toBeGreaterThan(0);
      expect(s.cta.length, s.id).toBeGreaterThan(0);
      expect(docIds.has(s.docId), `${key}/${s.id} docId=${s.docId}`).toBe(true);
      expect(catKeys.has(s.categoryKey), `${key}/${s.id} categoryKey=${s.categoryKey}`).toBe(true);
      expect(VALID_HREFS.has(s.href), `${key}/${s.id} href=${s.href}`).toBe(true);
    }
  });

  it("步驟骨架照卡上表格：電商＝描述商品→生圖→去背/換底→批量；教育者＝講稿→字卡→旁白→輸出；接案者＝定角色→LoRA→比稿→交付；品牌方＝preset→主視覺→成套→審核", () => {
    expect(getStepsForPersona("ecommerce").map((s) => s.id)).toEqual([
      "ec-describe", "ec-generate", "ec-cutout", "ec-batch",
    ]);
    expect(getStepsForPersona("educator").map((s) => s.id)).toEqual([
      "edu-script", "edu-flashcard", "edu-voice", "edu-export",
    ]);
    expect(getStepsForPersona("freelancer").map((s) => s.id)).toEqual([
      "fl-character", "fl-lora", "fl-drafts", "fl-deliver",
    ]);
    expect(getStepsForPersona("brand").map((s) => s.id)).toEqual([
      "br-preset", "br-keyvisual", "br-derive", "br-review",
    ]);
  });

  it("關鍵深連結：LoRA 定版→/lora-trainer、去背換底→/image-studio、品牌 preset→/vault、旁白→/pro-studio", () => {
    expect(getStepsForPersona("freelancer").find((s) => s.id === "fl-lora")!.href).toBe("/lora-trainer");
    expect(getStepsForPersona("ecommerce").find((s) => s.id === "ec-cutout")!.href).toBe("/image-studio");
    expect(getStepsForPersona("brand").find((s) => s.id === "br-preset")!.href).toBe("/vault");
    expect(getStepsForPersona("educator").find((s) => s.id === "edu-voice")!.href).toBe("/pro-studio");
  });

  it("general → 與 DEFAULT_STEPS 同一參照", () => {
    expect(getStepsForPersona("general")).toBe(DEFAULT_STEPS);
  });
});

describe("零回歸（HARD）：未設 persona → 與 AIDV-811 現行輸出 100% 相同", () => {
  it("getStepsForPersona(null) 回傳 DEFAULT_STEPS 同一參照", () => {
    expect(getStepsForPersona(null)).toBe(DEFAULT_STEPS);
  });

  it("DEFAULT_STEPS 內容釘住＝AIDV-811 現行 5 步逐欄位相同", () => {
    expect(DEFAULT_STEPS).toEqual([
      {
        id: "read-prompt",
        title: "看懂提示怎麼寫",
        learn: "學會 CO-STAR 結構化提示，讓 AI 真正懂你的意圖。",
        cta: "看提示參考 →",
        href: "/learn?sub=hub",
        docId: "costar-rag",
        categoryKey: "getting-started",
      },
      {
        id: "first-image",
        title: "生出你的第一張圖",
        learn: "從一句話描述開始，生出第一張屬於自己的 AI 圖像。",
        cta: "去創作 →",
        href: "/create",
        docId: "six-agents",
        categoryKey: "getting-started",
      },
      {
        id: "refine",
        title: "微調，讓它更接近你想的",
        learn: "用靈感積木微調提示，反覆試到滿意。",
        cta: "繼續創作 →",
        href: "/create",
        docId: "confirm-gate",
        categoryKey: "workflow",
      },
      {
        id: "animate",
        title: "讓圖動起來",
        learn: "把靜態圖像轉成短影片，進入導演模式。",
        cta: "進影片殼 →",
        href: "/video",
        docId: "shot-pipeline",
        categoryKey: "generation",
      },
      {
        id: "voice",
        title: "配上聲音，作品完整了",
        learn: "為影片配上旁白或音樂，作品就完整了。",
        cta: "去配音 →",
        href: "/pro-studio",
        docId: "cost-ladder",
        categoryKey: "generation",
      },
    ]);
  });

  it("副標題／完成文案釘住＝現行字串", () => {
    expect(getPathSubtitle(null)).toBe("跟著 5 步，從第一張圖到第一支會說話的短片");
    expect(getCompletionCopy(null)).toEqual({
      title: "🎉 恭喜完成新手路徑！",
      body: "你已經完成了從第一張圖到配音作品的完整旅程。繼續探索其他分頁深入學習吧！",
    });
    expect(getPathSubtitle(null)).toBe(DEFAULT_SUBTITLE);
    expect(getCompletionCopy(null)).toEqual(DEFAULT_COMPLETION);
  });

  it("general persona 的副標題／完成文案＝預設文案（通用＝現行路徑）", () => {
    expect(getPathSubtitle("general")).toBe(DEFAULT_SUBTITLE);
    expect(getCompletionCopy("general")).toEqual(DEFAULT_COMPLETION);
  });
});

describe("完成畫面文案依 persona 客製", () => {
  it.each(["ecommerce", "educator", "freelancer", "brand"] as const)(
    "%s：完成文案非預設文案",
    (key) => {
      const copy = getCompletionCopy(key);
      expect(copy.title).not.toBe(DEFAULT_COMPLETION.title);
      expect(copy.body).not.toBe(DEFAULT_COMPLETION.body);
    },
  );
});

describe("reorderNextStepChips（重排邏輯）", () => {
  it("null（未選）→ 原順序（零回歸）", () => {
    expect(reorderNextStepChips(CHIPS, null).map((c) => c.path)).toEqual(ORIGINAL_ORDER);
  });

  it("general → 原順序", () => {
    expect(reorderNextStepChips(CHIPS, "general").map((c) => c.path)).toEqual(ORIGINAL_ORDER);
  });

  it("ecommerce → 「再生一張」最前、其次圖生影", () => {
    expect(reorderNextStepChips(CHIPS, "ecommerce").map((c) => c.path)).toEqual([
      null, "/video-studio", "/pro-studio", "/director",
    ]);
  });

  it("educator → 配音（/pro-studio）最前、其次再生一張", () => {
    expect(reorderNextStepChips(CHIPS, "educator").map((c) => c.path)).toEqual([
      "/pro-studio", null, "/video-studio", "/director",
    ]);
  });

  it("freelancer → 再生一張最前、其次導演", () => {
    expect(reorderNextStepChips(CHIPS, "freelancer").map((c) => c.path)).toEqual([
      null, "/director", "/pro-studio", "/video-studio",
    ]);
  });

  it("brand → 導演最前、其次圖生影", () => {
    expect(reorderNextStepChips(CHIPS, "brand").map((c) => c.path)).toEqual([
      "/director", "/video-studio", "/pro-studio", null,
    ]);
  });

  it.each(ALL_KEYS)("%s：重排是同元素的置換、不變動輸入陣列", (key) => {
    const input = [...CHIPS];
    const out = reorderNextStepChips(input, key);
    expect(input).toEqual(CHIPS); // 輸入不被 mutate
    expect(out).toHaveLength(CHIPS.length);
    expect(new Set(out)).toEqual(new Set(CHIPS)); // 同一批元素
  });
});

describe("localStorage 讀寫（try/catch 安全）", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubStorage(store: Map<string, string>) {
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    });
    return store;
  }

  it("savePersona → loadPersona roundtrip（key=learn:beginner-path:persona）", () => {
    const store = stubStorage(new Map());
    savePersona("brand");
    expect(store.get(PERSONA_LS_KEY)).toBe("brand");
    expect(loadPersona()).toBe("brand");
  });

  it("savePersona(null) → 移除 key、loadPersona 回 null", () => {
    const store = stubStorage(new Map([[PERSONA_LS_KEY, "educator"]]));
    savePersona(null);
    expect(store.has(PERSONA_LS_KEY)).toBe(false);
    expect(loadPersona()).toBeNull();
  });

  it("非法值 → loadPersona 回 null（不吐未知 persona）", () => {
    stubStorage(new Map([[PERSONA_LS_KEY, "hacker"]]));
    expect(loadPersona()).toBeNull();
  });

  it("localStorage 丟例外（私密模式）→ loadPersona 回 null、savePersona 不 throw", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); },
    });
    expect(loadPersona()).toBeNull();
    expect(() => savePersona("ecommerce")).not.toThrow();
    expect(() => savePersona(null)).not.toThrow();
  });

  it("無 localStorage 全域（SSR）→ 安全回 null / 不 throw", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(loadPersona()).toBeNull();
    expect(() => savePersona("brand")).not.toThrow();
  });
});
