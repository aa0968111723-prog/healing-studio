/**
 * VisualSoulInvitation — 光球行動與邀約系統測試
 *
 * 測試觸發邏輯、OARS 模板選取、邀約語句生成。
 * 前端元件邏輯的純函數部分在此驗證。
 */

import { describe, it, expect } from "vitest";

// ─── Replicate core logic from VisualSoulInvitation.tsx ────────────────────

interface IntentResult {
  intentType: string;
  intentLabel: string;
  confidence: number;
  psychologicalInsight: string;
  suggestedAction: string;
  actionDetail: string;
  detectedAesthetics: string[];
  preferredModality: string;
  inferredAt: number;
}

/** 判定是否應該觸發光球邀約 */
function shouldTriggerInvitation(intent: IntentResult | null): boolean {
  if (!intent) return false;
  if (intent.confidence < 0.4) return false;

  const highTriggerTypes = [
    "choice_paralysis",
    "inspiration_seeking",
    "passive_browsing",
  ];
  const mediumTriggerTypes = ["aesthetic_preference"];

  if (highTriggerTypes.includes(intent.intentType)) return true;
  if (mediumTriggerTypes.includes(intent.intentType) && intent.confidence > 0.5)
    return true;
  if (intent.confidence > 0.7) return true;

  return false;
}

/** 從推論結果中提取使用者最感興趣的卡片名稱 */
function extractFavoriteCard(intent: IntentResult): string | undefined {
  const match = intent.psychologicalInsight.match(/「(.+?)」/);
  if (match) return match[1];
  const match2 = intent.actionDetail.match(/「(.+?)」/);
  if (match2) return match2[1];
  return undefined;
}

// ─── OARS Templates (subset for testing) ──────────────────────────────────

interface InvitationTemplate {
  message: (cardTitle?: string, modality?: string) => string;
  cta: string;
}

const INVITATION_TEMPLATES: Record<string, InvitationTemplate[]> = {
  choice_paralysis: [
    {
      message: title =>
        title
          ? `我注意到你在好幾張作品之間猶豫，其中「${title}」似乎特別吸引你的目光。要不要讓我幫你把參數調好，我們直接去創作室試試看？`
          : `看起來你正在尋找最對味的靈感。不如讓我幫你挑一個起點，我們一起去試試看？`,
      cta: "好，一起去試試",
    },
  ],
  inspiration_seeking: [
    {
      message: (_title, modality) =>
        modality && modality !== "unknown"
          ? `看起來你對${modality === "image" ? "圖像" : modality === "video" ? "影片" : modality === "music" ? "音樂" : "語音"}創作特別感興趣。我可以幫你設定一個有趣的起點，讓靈感自然流動。`
          : `靈感有時候需要一點引子。讓我根據你剛才瀏覽的內容，幫你準備一個創作起點？`,
      cta: "給我一個起點",
    },
  ],
  exploration_mode: [
    {
      message: () =>
        `你正在快速探索各種可能性，這是很棒的開始。當你找到心動的作品時，點擊它就能直接進入創作室。`,
      cta: "我知道了",
    },
  ],
};

// ─── Tests ────────────────────────────────────────────────────────────────

describe("shouldTriggerInvitation", () => {
  it("returns false when intent is null", () => {
    expect(shouldTriggerInvitation(null)).toBe(false);
  });

  it("returns false when confidence is below 0.4", () => {
    const intent: IntentResult = {
      intentType: "choice_paralysis",
      intentLabel: "選擇困難症",
      confidence: 0.3,
      psychologicalInsight: "你似乎在猶豫",
      suggestedAction: "simplify_choices",
      actionDetail: "讓我幫你簡化選擇",
      detectedAesthetics: [],
      preferredModality: "unknown",
      inferredAt: Date.now(),
    };
    expect(shouldTriggerInvitation(intent)).toBe(false);
  });

  it("triggers for choice_paralysis with confidence >= 0.4", () => {
    const intent: IntentResult = {
      intentType: "choice_paralysis",
      intentLabel: "選擇困難症",
      confidence: 0.5,
      psychologicalInsight: "你似乎在「星空幻想」和「深海之夢」之間猶豫",
      suggestedAction: "simplify_choices",
      actionDetail: "讓我幫你簡化選擇",
      detectedAesthetics: ["dreamy"],
      preferredModality: "image",
      inferredAt: Date.now(),
    };
    expect(shouldTriggerInvitation(intent)).toBe(true);
  });

  it("triggers for inspiration_seeking with confidence >= 0.4", () => {
    const intent: IntentResult = {
      intentType: "inspiration_seeking",
      intentLabel: "靈感探索",
      confidence: 0.45,
      psychologicalInsight: "你正在尋找靈感方向",
      suggestedAction: "encourage_exploration",
      actionDetail: "繼續探索",
      detectedAesthetics: [],
      preferredModality: "unknown",
      inferredAt: Date.now(),
    };
    expect(shouldTriggerInvitation(intent)).toBe(true);
  });

  it("triggers for passive_browsing with confidence >= 0.4", () => {
    const intent: IntentResult = {
      intentType: "passive_browsing",
      intentLabel: "被動瀏覽",
      confidence: 0.6,
      psychologicalInsight: "你似乎在悠閒瀏覽",
      suggestedAction: "offer_quick_start",
      actionDetail: "隨時可以開始",
      detectedAesthetics: [],
      preferredModality: "unknown",
      inferredAt: Date.now(),
    };
    expect(shouldTriggerInvitation(intent)).toBe(true);
  });

  it("triggers for aesthetic_preference only when confidence > 0.5", () => {
    const lowConfidence: IntentResult = {
      intentType: "aesthetic_preference",
      intentLabel: "美學偏好",
      confidence: 0.45,
      psychologicalInsight: "你偏好某種風格",
      suggestedAction: "recommend_style",
      actionDetail: "推薦類似風格",
      detectedAesthetics: ["cyberpunk"],
      preferredModality: "image",
      inferredAt: Date.now(),
    };
    expect(shouldTriggerInvitation(lowConfidence)).toBe(false);

    const highConfidence: IntentResult = {
      ...lowConfidence,
      confidence: 0.6,
    };
    expect(shouldTriggerInvitation(highConfidence)).toBe(true);
  });

  it("triggers for exploration_mode when confidence > 0.7", () => {
    const lowConfidence: IntentResult = {
      intentType: "exploration_mode",
      intentLabel: "探索模式",
      confidence: 0.5,
      psychologicalInsight: "你正在快速探索",
      suggestedAction: "encourage_exploration",
      actionDetail: "繼續探索",
      detectedAesthetics: [],
      preferredModality: "unknown",
      inferredAt: Date.now(),
    };
    expect(shouldTriggerInvitation(lowConfidence)).toBe(false);

    const highConfidence: IntentResult = {
      ...lowConfidence,
      confidence: 0.75,
    };
    expect(shouldTriggerInvitation(highConfidence)).toBe(true);
  });

  it("triggers for goal_oriented when confidence > 0.7", () => {
    const intent: IntentResult = {
      intentType: "goal_oriented",
      intentLabel: "目標導向",
      confidence: 0.8,
      psychologicalInsight: "你知道自己想要什麼",
      suggestedAction: "proactive_guide",
      actionDetail: "直接開始",
      detectedAesthetics: [],
      preferredModality: "image",
      inferredAt: Date.now(),
    };
    expect(shouldTriggerInvitation(intent)).toBe(true);
  });
});

describe("extractFavoriteCard", () => {
  it("extracts card title from psychologicalInsight", () => {
    const intent: IntentResult = {
      intentType: "choice_paralysis",
      intentLabel: "選擇困難症",
      confidence: 0.7,
      psychologicalInsight: "你似乎被「星空幻想」這張作品深深吸引",
      suggestedAction: "simplify_choices",
      actionDetail: "讓我幫你從這裡開始",
      detectedAesthetics: [],
      preferredModality: "image",
      inferredAt: Date.now(),
    };
    expect(extractFavoriteCard(intent)).toBe("星空幻想");
  });

  it("falls back to actionDetail when psychologicalInsight has no title", () => {
    const intent: IntentResult = {
      intentType: "aesthetic_preference",
      intentLabel: "美學偏好",
      confidence: 0.6,
      psychologicalInsight: "你偏好夢幻風格的作品",
      suggestedAction: "recommend_style",
      actionDetail: "試試「深海之夢」這個風格",
      detectedAesthetics: ["dreamy"],
      preferredModality: "image",
      inferredAt: Date.now(),
    };
    expect(extractFavoriteCard(intent)).toBe("深海之夢");
  });

  it("returns undefined when no title is found", () => {
    const intent: IntentResult = {
      intentType: "exploration_mode",
      intentLabel: "探索模式",
      confidence: 0.5,
      psychologicalInsight: "你正在自由探索各種可能性",
      suggestedAction: "encourage_exploration",
      actionDetail: "繼續瀏覽，找到你喜歡的風格",
      detectedAesthetics: [],
      preferredModality: "unknown",
      inferredAt: Date.now(),
    };
    expect(extractFavoriteCard(intent)).toBeUndefined();
  });
});

describe("OARS Invitation Templates", () => {
  it("choice_paralysis template includes card title when provided", () => {
    const template = INVITATION_TEMPLATES.choice_paralysis[0];
    const msg = template.message("星空幻想");
    expect(msg).toContain("星空幻想");
    expect(msg).toContain("要不要讓我幫你把參數調好");
  });

  it("choice_paralysis template provides fallback when no card title", () => {
    const template = INVITATION_TEMPLATES.choice_paralysis[0];
    const msg = template.message();
    expect(msg).toContain("尋找最對味的靈感");
    expect(msg).not.toContain("undefined");
  });

  it("inspiration_seeking template adapts to modality", () => {
    const template = INVITATION_TEMPLATES.inspiration_seeking[0];

    const imageMsg = template.message(undefined, "image");
    expect(imageMsg).toContain("圖像");

    const videoMsg = template.message(undefined, "video");
    expect(videoMsg).toContain("影片");

    const musicMsg = template.message(undefined, "music");
    expect(musicMsg).toContain("音樂");

    const unknownMsg = template.message(undefined, "unknown");
    expect(unknownMsg).toContain("靈感有時候需要一點引子");
  });

  it("exploration_mode template is generic and non-intrusive", () => {
    const template = INVITATION_TEMPLATES.exploration_mode[0];
    const msg = template.message();
    expect(msg).toContain("快速探索");
    expect(template.cta).toBe("我知道了");
  });

  it("all templates have non-empty CTA text", () => {
    for (const [type, templates] of Object.entries(INVITATION_TEMPLATES)) {
      for (const template of templates) {
        expect(template.cta).toBeTruthy();
        expect(template.cta.length).toBeGreaterThan(0);
      }
    }
  });
});
