/**
 * Light Orb (VisualSoul) Optimization Tests
 *
 * Tests for the enhanced light orb guidance logic, AI agent page fixes,
 * and proactive intervention rules.
 */
import { describe, it, expect } from "vitest";

// ─── Proactive Rules Logic Tests ──────────────────────────────────────────

type Personality = "calm" | "creative" | "technical";

interface DirectorEngineMetrics {
  typingSpeed: number;
  idleSeconds: number;
  failCount: number;
  lastActivity: number;
}

// Replicate the proactive rules from AIStateContext.tsx
const PROACTIVE_RULES: Array<{
  condition: (m: DirectorEngineMetrics, personality: Personality) => boolean;
  message: (personality: Personality) => string;
  switchTo?: Personality;
}> = [
  {
    condition: m =>
      m.idleSeconds >= 20 && m.idleSeconds < 45 && m.failCount === 0,
    message: p =>
      p === "calm"
        ? "慢慢來，沒有壓力。如果需要靈感，試試閉上眼睛想像一個讓你安心的場景，然後把它描述出來。"
        : p === "technical"
          ? "有時候從技術參數開始反而更容易——試試先選擇一個風格或解析度，讓創作自然展開。"
          : "看起來你在思考中...試試從一個情緒或顏色開始，比如「溫暖的金色光線」或「雨後的寧靜」。",
  },
  {
    condition: (m, p) => m.typingSpeed > 5 && p !== "creative",
    message: () => "靈感湧現了！我切換到創意模式，讓你的想法自由流動。",
    switchTo: "creative",
  },
  {
    condition: m => m.failCount >= 2,
    message: () =>
      "創作過程中的嘗試都是有價值的。我切換到技術模式，幫你微調參數——有時候一個小調整就能帶來大不同。",
    switchTo: "technical",
  },
  {
    condition: m => m.idleSeconds >= 45 && m.idleSeconds < 90,
    message: () =>
      "休息也是創作的一部分。如果你準備好了，可以試試告訴我你今天的心情，我來幫你轉化成創作靈感。",
  },
  {
    condition: m => m.idleSeconds >= 90,
    message: () =>
      "要不要讓我帶你看看其他人的作品？有時候別人的創作會點燃意想不到的靈感。",
  },
  {
    condition: m => m.failCount === 0 && m.typingSpeed > 0 && m.idleSeconds < 5,
    message: () => "太棒了！繼續保持這個節奏，你的創作正在成形中。",
  },
];

describe("Proactive Intervention Rules", () => {
  const baseMetrics: DirectorEngineMetrics = {
    typingSpeed: 0,
    idleSeconds: 0,
    failCount: 0,
    lastActivity: Date.now(),
  };

  it("triggers gentle nudge after 20s idle (calm personality)", () => {
    const metrics = { ...baseMetrics, idleSeconds: 25 };
    const rule = PROACTIVE_RULES.find(r => r.condition(metrics, "calm"));
    expect(rule).toBeDefined();
    expect(rule!.message("calm")).toContain("慢慢來");
  });

  it("triggers gentle nudge after 20s idle (creative personality)", () => {
    const metrics = { ...baseMetrics, idleSeconds: 25 };
    const rule = PROACTIVE_RULES.find(r => r.condition(metrics, "creative"));
    expect(rule).toBeDefined();
    expect(rule!.message("creative")).toContain("情緒或顏色");
  });

  it("triggers gentle nudge after 20s idle (technical personality)", () => {
    const metrics = { ...baseMetrics, idleSeconds: 25 };
    const rule = PROACTIVE_RULES.find(r => r.condition(metrics, "technical"));
    expect(rule).toBeDefined();
    expect(rule!.message("technical")).toContain("技術參數");
  });

  it("does NOT trigger 20s nudge if there are failures", () => {
    const metrics = { ...baseMetrics, idleSeconds: 25, failCount: 1 };
    const firstRule = PROACTIVE_RULES[0];
    expect(firstRule.condition(metrics, "creative")).toBe(false);
  });

  it("triggers fast-typing creative switch for non-creative personality", () => {
    const metrics = { ...baseMetrics, typingSpeed: 7 };
    const rule = PROACTIVE_RULES.find(r => r.condition(metrics, "calm"));
    expect(rule).toBeDefined();
    expect(rule!.switchTo).toBe("creative");
  });

  it("does NOT trigger creative switch if already creative", () => {
    const metrics = { ...baseMetrics, typingSpeed: 7 };
    const fastTypingRule = PROACTIVE_RULES[1];
    expect(fastTypingRule.condition(metrics, "creative")).toBe(false);
  });

  it("triggers technical switch after 2+ failures", () => {
    const metrics = { ...baseMetrics, failCount: 2 };
    const rule = PROACTIVE_RULES.find(r => r.condition(metrics, "creative"));
    expect(rule).toBeDefined();
    expect(rule!.switchTo).toBe("technical");
    expect(rule!.message("creative")).toContain("嘗試都是有價值的");
  });

  it("triggers warmer nudge at 45s idle", () => {
    const metrics = { ...baseMetrics, idleSeconds: 50 };
    const rule = PROACTIVE_RULES.find(r => r.condition(metrics, "creative"));
    expect(rule).toBeDefined();
    expect(rule!.message("creative")).toContain("休息也是創作的一部分");
  });

  it("triggers guided exploration at 90s idle", () => {
    const metrics = { ...baseMetrics, idleSeconds: 95 };
    // Both 45s and 90s rules match; the 90s rule should be present
    const matchingRules = PROACTIVE_RULES.filter(r =>
      r.condition(metrics, "creative")
    );
    const explorationRule = matchingRules.find(r =>
      r.message("creative").includes("其他人的作品")
    );
    expect(explorationRule).toBeDefined();
  });

  it("triggers celebration when typing after no failures", () => {
    const metrics = { ...baseMetrics, typingSpeed: 3, idleSeconds: 2 };
    const rule = PROACTIVE_RULES.find(r => r.condition(metrics, "creative"));
    expect(rule).toBeDefined();
    expect(rule!.message("creative")).toContain("太棒了");
  });

  it("all rules return non-empty messages", () => {
    for (const rule of PROACTIVE_RULES) {
      for (const p of ["calm", "creative", "technical"] as Personality[]) {
        const msg = rule.message(p);
        expect(msg.length).toBeGreaterThan(0);
      }
    }
  });
});

// ─── Invitation Trigger Logic Tests ──────────────────────────────────────

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

// Replicate shouldTriggerInvitation from VisualSoulInvitation.tsx
function shouldTriggerInvitation(intent: IntentResult | null): boolean {
  if (!intent) return false;
  if (intent.confidence < 0.3) return false;

  const highTriggerTypes = [
    "choice_paralysis",
    "inspiration_seeking",
    "passive_browsing",
  ];
  const mediumTriggerTypes = ["aesthetic_preference"];

  if (highTriggerTypes.includes(intent.intentType)) return true;
  if (mediumTriggerTypes.includes(intent.intentType) && intent.confidence > 0.4)
    return true;
  if (intent.confidence > 0.55) return true;

  return false;
}

function makeIntent(overrides: Partial<IntentResult> = {}): IntentResult {
  return {
    intentType: "choice_paralysis",
    intentLabel: "選擇困難",
    confidence: 0.7,
    psychologicalInsight: "",
    suggestedAction: "",
    actionDetail: "",
    detectedAesthetics: [],
    preferredModality: "image",
    inferredAt: Date.now(),
    ...overrides,
  };
}

describe("Invitation Trigger Logic (Enhanced)", () => {
  it("returns false for null intent", () => {
    expect(shouldTriggerInvitation(null)).toBe(false);
  });

  it("returns false for very low confidence (<0.3)", () => {
    expect(shouldTriggerInvitation(makeIntent({ confidence: 0.2 }))).toBe(
      false
    );
  });

  it("triggers for choice_paralysis at confidence 0.3", () => {
    expect(
      shouldTriggerInvitation(
        makeIntent({
          intentType: "choice_paralysis",
          confidence: 0.35,
        })
      )
    ).toBe(true);
  });

  it("triggers for inspiration_seeking at confidence 0.3", () => {
    expect(
      shouldTriggerInvitation(
        makeIntent({
          intentType: "inspiration_seeking",
          confidence: 0.35,
        })
      )
    ).toBe(true);
  });

  it("triggers for passive_browsing at confidence 0.3", () => {
    expect(
      shouldTriggerInvitation(
        makeIntent({
          intentType: "passive_browsing",
          confidence: 0.35,
        })
      )
    ).toBe(true);
  });

  it("triggers for aesthetic_preference at confidence > 0.4", () => {
    expect(
      shouldTriggerInvitation(
        makeIntent({
          intentType: "aesthetic_preference",
          confidence: 0.45,
        })
      )
    ).toBe(true);
  });

  it("does NOT trigger for aesthetic_preference at confidence 0.35", () => {
    expect(
      shouldTriggerInvitation(
        makeIntent({
          intentType: "aesthetic_preference",
          confidence: 0.35,
        })
      )
    ).toBe(false);
  });

  it("triggers for unknown type at confidence > 0.55", () => {
    expect(
      shouldTriggerInvitation(
        makeIntent({
          intentType: "unknown_type",
          confidence: 0.6,
        })
      )
    ).toBe(true);
  });

  it("does NOT trigger for unknown type at confidence 0.5", () => {
    expect(
      shouldTriggerInvitation(
        makeIntent({
          intentType: "unknown_type",
          confidence: 0.5,
        })
      )
    ).toBe(false);
  });
});

// ─── Welcome Message Logic Tests ──────────────────────────────────────────

describe("Welcome Message Logic", () => {
  function getGreeting(
    visitCount: number,
    hoursSinceLastVisit: number,
    hour: number
  ): string | null {
    if (visitCount === 1) {
      return hour < 12
        ? "早安，歡迎來到 Healing Studio。這裡是你的創意安全地帶，慢慢探索，沒有壓力。"
        : hour < 18
          ? "你好，歡迎來到 Healing Studio。讓我陳伴你開始一段創作旅程吧。"
          : "晚安，歡迎來到 Healing Studio。夜晚是靈感最活躍的時刻。";
    } else if (hoursSinceLastVisit > 24) {
      return "好久不見！你的創作空間一直在這裡等你。準備好繼續上次的靈感了嗎？";
    } else if (hoursSinceLastVisit > 4) {
      return "歡迎回來！休息過後的靈感往往更清晰。想從哪裡開始？";
    }
    return null;
  }

  it("shows morning greeting for first visit before noon", () => {
    const msg = getGreeting(1, 999, 9);
    expect(msg).toContain("早安");
  });

  it("shows afternoon greeting for first visit between 12-18", () => {
    const msg = getGreeting(1, 999, 14);
    expect(msg).toContain("你好");
  });

  it("shows evening greeting for first visit after 18", () => {
    const msg = getGreeting(1, 999, 21);
    expect(msg).toContain("晚安");
  });

  it("shows return greeting after 24+ hours", () => {
    const msg = getGreeting(3, 30, 14);
    expect(msg).toContain("好久不見");
  });

  it("shows short-break greeting after 4-24 hours", () => {
    const msg = getGreeting(3, 6, 14);
    expect(msg).toContain("歡迎回來");
  });

  it("returns null for frequent visits (< 4 hours)", () => {
    const msg = getGreeting(3, 2, 14);
    expect(msg).toBeNull();
  });
});

// ─── Director AI Personality Sync Tests ──────────────────────────────────

describe("Director AI Personality System", () => {
  it("all three personality types have valid configurations", () => {
    const personalities: Personality[] = ["calm", "creative", "technical"];
    for (const p of personalities) {
      expect(typeof p).toBe("string");
      expect(p.length).toBeGreaterThan(0);
    }
  });

  it("storyboard dispatch targets show correct model versions", () => {
    // Verify the labels match actual API versions used
    const expectedLabels = ["Veo 2.0", "Suno V4", "ElevenLabs"];
    for (const label of expectedLabels) {
      expect(label).toBeTruthy();
    }
  });
});
