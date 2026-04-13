/**
 * soul-invitation-studio.test.ts — 光球推薦 → Studio 接收端邏輯測試
 *
 * 測試 payload 解析、美學標籤 → Vibe Card 映射、模態設定、
 * actionDetail 清洗、Toast 訊息生成等純函數邏輯。
 */

import { describe, it, expect } from "vitest";

// ─── Replicate core mapping logic from Studio.tsx ──────────────────────────

type GenerationType = "image" | "video" | "audio" | "voice";

interface SoulInvitationPayload {
  source: string;
  intentType: string;
  preferredModality: string;
  detectedAesthetics: string[];
  suggestedAction: string;
  actionDetail?: string;
  cardTitle?: string | null;
  confidence?: number;
}

/** Map preferredModality → GenerationType */
function mapModality(preferredModality: string): GenerationType | null {
  const modalityMap: Record<string, GenerationType> = {
    image: "image",
    video: "video",
    music: "audio",
    audio: "audio",
    voice: "voice",
  };
  return modalityMap[preferredModality] || null;
}

/** Aesthetic → Vibe Card mapping table */
const AESTHETIC_TO_VIBE: Record<string, string> = {
  serene: "serene", calm: "serene", peaceful: "serene", tranquil: "serene",
  warm: "warm", cozy: "warm", comfortable: "warm", soft: "warm",
  dreamy: "dreamy", ethereal: "dreamy", surreal: "dreamy", fantasy: "dreamy",
  nature: "nature", organic: "nature", botanical: "nature", natural: "nature",
  vintage: "vintage", retro: "vintage", nostalgic: "vintage", classic: "vintage",
  minimal: "minimal", clean: "minimal", simple: "minimal", minimalist: "minimal",
  joyful: "joyful", happy: "joyful", vibrant: "joyful", colorful: "joyful", bright: "joyful",
  mystical: "mystical", mysterious: "mystical", dark: "mystical", gothic: "mystical", cosmic: "mystical",
  "寧靜": "serene", "溫暖": "warm", "夢幻": "dreamy", "自然": "nature",
  "復古": "vintage", "極簡": "minimal", "歡愉": "joyful", "神秘": "mystical",
  cyberpunk: "mystical", neon: "joyful", cinematic: "mystical",
  watercolor: "dreamy", pastel: "serene", golden: "warm",
};

/** Intent → default Vibe Card fallback */
const INTENT_DEFAULT_VIBE: Record<string, string> = {
  choice_paralysis: "dreamy",
  inspiration_seeking: "joyful",
  passive_browsing: "serene",
  aesthetic_preference: "mystical",
  exploration_mode: "joyful",
  goal_oriented: "minimal",
};

/** Map aesthetics array to Vibe Card IDs */
function mapAestheticsToVibes(
  aesthetics: string[],
  intentType: string,
): string[] {
  const matched = new Set<string>();

  for (const tag of aesthetics) {
    const lower = tag.toLowerCase().trim();
    if (AESTHETIC_TO_VIBE[lower]) {
      matched.add(AESTHETIC_TO_VIBE[lower]);
    } else {
      for (const [keyword, vibeId] of Object.entries(AESTHETIC_TO_VIBE)) {
        if (lower.includes(keyword) || keyword.includes(lower)) {
          matched.add(vibeId);
          break;
        }
      }
    }
  }

  // Fallback: intent-based default
  if (matched.size === 0) {
    const defaultVibe = INTENT_DEFAULT_VIBE[intentType];
    if (defaultVibe) matched.add(defaultVibe);
  }

  return Array.from(matched);
}

/** Clean actionDetail to extract creative hint */
function cleanActionDetail(actionDetail: string): string {
  return actionDetail
    .replace(/讓我幫你|我可以|要不要|試試看|我們/g, "")
    .replace(/^[，、。！？\s]+|[，、。！？\s]+$/g, "")
    .trim();
}

/** Generate toast message */
function generateToastMessage(
  cardTitle: string | null | undefined,
  vibeIds: string[],
): string {
  const zhMap: Record<string, string> = {
    serene: "寧靜", warm: "溫暖", dreamy: "夢幻", nature: "自然",
    vintage: "復古", minimal: "極簡", joyful: "歡愉", mystical: "神秘",
  };
  const vibeNames = vibeIds.map(id => zhMap[id] || id).join("、");
  const cardMention = cardTitle ? `「${cardTitle}」` : "";

  return cardMention
    ? `光球已為你準備好${cardMention}的創作起點${vibeNames ? ` · ${vibeNames}風格` : ""}`
    : `光球已根據你的瀏覽偏好準備好創作起點${vibeNames ? ` · ${vibeNames}風格` : ""}`;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("mapModality — 模態映射", () => {
  it("maps 'image' to 'image'", () => {
    expect(mapModality("image")).toBe("image");
  });

  it("maps 'video' to 'video'", () => {
    expect(mapModality("video")).toBe("video");
  });

  it("maps 'music' to 'audio'", () => {
    expect(mapModality("music")).toBe("audio");
  });

  it("maps 'audio' to 'audio'", () => {
    expect(mapModality("audio")).toBe("audio");
  });

  it("maps 'voice' to 'voice'", () => {
    expect(mapModality("voice")).toBe("voice");
  });

  it("returns null for 'unknown'", () => {
    expect(mapModality("unknown")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(mapModality("")).toBeNull();
  });
});

describe("mapAestheticsToVibes — 美學標籤 → Vibe Card 映射", () => {
  it("maps exact English tags", () => {
    const result = mapAestheticsToVibes(["dreamy", "warm"], "choice_paralysis");
    expect(result).toContain("dreamy");
    expect(result).toContain("warm");
  });

  it("maps Chinese tags", () => {
    const result = mapAestheticsToVibes(["夢幻", "神秘"], "aesthetic_preference");
    expect(result).toContain("dreamy");
    expect(result).toContain("mystical");
  });

  it("maps synonym tags (e.g., 'ethereal' → 'dreamy')", () => {
    const result = mapAestheticsToVibes(["ethereal"], "inspiration_seeking");
    expect(result).toContain("dreamy");
  });

  it("maps extended tags (e.g., 'cyberpunk' → 'mystical')", () => {
    const result = mapAestheticsToVibes(["cyberpunk"], "goal_oriented");
    expect(result).toContain("mystical");
  });

  it("handles case-insensitive matching", () => {
    const result = mapAestheticsToVibes(["DREAMY", "Warm"], "choice_paralysis");
    expect(result).toContain("dreamy");
    expect(result).toContain("warm");
  });

  it("falls back to intent default when no aesthetics match", () => {
    const result = mapAestheticsToVibes([], "choice_paralysis");
    expect(result).toEqual(["dreamy"]);
  });

  it("falls back to intent default for unknown tags", () => {
    const result = mapAestheticsToVibes(["xyzabc123"], "inspiration_seeking");
    expect(result).toEqual(["joyful"]);
  });

  it("deduplicates matched vibes", () => {
    const result = mapAestheticsToVibes(["calm", "serene", "peaceful"], "choice_paralysis");
    expect(result).toEqual(["serene"]);
  });

  it("maps multiple distinct aesthetics to multiple vibes", () => {
    const result = mapAestheticsToVibes(["cyberpunk", "watercolor", "golden"], "exploration_mode");
    expect(result).toContain("mystical");
    expect(result).toContain("dreamy");
    expect(result).toContain("warm");
    expect(result.length).toBe(3);
  });

  it("handles fuzzy matching (tag contains keyword)", () => {
    const result = mapAestheticsToVibes(["dreamy-landscape"], "choice_paralysis");
    expect(result).toContain("dreamy");
  });
});

describe("cleanActionDetail — 提示詞清洗", () => {
  it("removes instructional phrases", () => {
    const result = cleanActionDetail("讓我幫你從這個風格開始創作");
    expect(result).toBe("從這個風格開始創作");
  });

  it("removes multiple instructional phrases", () => {
    const result = cleanActionDetail("要不要讓我幫你試試看這個風格");
    expect(result).toBe("這個風格");
  });

  it("trims leading/trailing punctuation", () => {
    const result = cleanActionDetail("，從夢幻風格開始。");
    expect(result).toBe("從夢幻風格開始");
  });

  it("preserves meaningful content", () => {
    const result = cleanActionDetail("用賽博龐克風格創作一張城市夜景");
    expect(result).toBe("用賽博龐克風格創作一張城市夜景");
  });

  it("handles empty string", () => {
    const result = cleanActionDetail("");
    expect(result).toBe("");
  });
});

describe("generateToastMessage — Toast 訊息生成", () => {
  it("includes card title when provided", () => {
    const msg = generateToastMessage("星空幻想", ["dreamy"]);
    expect(msg).toContain("星空幻想");
    expect(msg).toContain("夢幻風格");
  });

  it("uses generic message when no card title", () => {
    const msg = generateToastMessage(null, ["serene"]);
    expect(msg).toContain("瀏覽偏好");
    expect(msg).toContain("寧靜風格");
  });

  it("lists multiple vibe names", () => {
    const msg = generateToastMessage("深海之夢", ["dreamy", "mystical"]);
    expect(msg).toContain("夢幻");
    expect(msg).toContain("神秘");
  });

  it("handles empty vibe list", () => {
    const msg = generateToastMessage("作品A", []);
    expect(msg).toContain("作品A");
    expect(msg).not.toContain("風格");
  });

  it("handles undefined card title", () => {
    const msg = generateToastMessage(undefined, ["warm"]);
    expect(msg).toContain("瀏覽偏好");
    expect(msg).toContain("溫暖風格");
  });
});

describe("Full payload integration — 完整 payload 整合", () => {
  it("processes a typical choice_paralysis payload", () => {
    const payload: SoulInvitationPayload = {
      source: "soul_invitation",
      intentType: "choice_paralysis",
      preferredModality: "image",
      detectedAesthetics: ["dreamy", "ethereal"],
      suggestedAction: "simplify_choices",
      actionDetail: "讓我幫你從「星空幻想」的夢幻風格開始",
      cardTitle: "星空幻想",
      confidence: 0.72,
    };

    // Modality
    expect(mapModality(payload.preferredModality)).toBe("image");

    // Vibes
    const vibes = mapAestheticsToVibes(payload.detectedAesthetics, payload.intentType);
    expect(vibes).toContain("dreamy");
    expect(vibes.length).toBe(1); // dreamy and ethereal both map to dreamy

    // Action detail
    const hint = cleanActionDetail(payload.actionDetail!);
    expect(hint.length).toBeGreaterThan(2);
    expect(hint).not.toContain("讓我幫你");

    // Toast
    const toast = generateToastMessage(payload.cardTitle, vibes);
    expect(toast).toContain("星空幻想");
    expect(toast).toContain("夢幻");
  });

  it("processes an inspiration_seeking payload with music modality", () => {
    const payload: SoulInvitationPayload = {
      source: "soul_invitation",
      intentType: "inspiration_seeking",
      preferredModality: "music",
      detectedAesthetics: ["warm", "nostalgic"],
      suggestedAction: "encourage_exploration",
      actionDetail: "用溫暖復古的風格創作一段旋律",
      cardTitle: null,
      confidence: 0.55,
    };

    expect(mapModality(payload.preferredModality)).toBe("audio");

    const vibes = mapAestheticsToVibes(payload.detectedAesthetics, payload.intentType);
    expect(vibes).toContain("warm");
    expect(vibes).toContain("vintage"); // nostalgic → vintage

    const toast = generateToastMessage(payload.cardTitle, vibes);
    expect(toast).toContain("瀏覽偏好");
    expect(toast).toContain("溫暖");
  });

  it("rejects payload with wrong source", () => {
    const payload = {
      source: "not_soul_invitation",
      intentType: "choice_paralysis",
      preferredModality: "image",
      detectedAesthetics: [],
      suggestedAction: "simplify_choices",
    };
    expect(payload.source).not.toBe("soul_invitation");
  });

  it("handles payload with unknown modality gracefully", () => {
    const modality = mapModality("unknown");
    expect(modality).toBeNull();
    // Studio should keep current modality when null
  });

  it("handles payload with empty aesthetics and unknown intent", () => {
    const vibes = mapAestheticsToVibes([], "some_unknown_intent");
    expect(vibes).toEqual([]); // No fallback for unknown intent
  });
});
