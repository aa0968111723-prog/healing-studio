/**
 * tests/unit/shared/orb-agent-roles.test.ts
 *
 * Module — multi-agent role routing.
 */
import { describe, expect, it } from "vitest";
import type { PageAgentSnapshot } from "../../../shared/agent-actions";
import {
  composeRoleChain,
  detectSpiritMention,
  getPrimaryNicknameForRole,
  getRoleSystemPromptSlice,
  hasSpiritMention,
  selectRoleForIntent,
  stripSpiritMention,
  summarizeRoleChainForPrompt,
  SPIRIT_COLLAB_PROTOCOL,
  SPIRIT_PROACTIVE_TRIGGERS,
  SPIRIT_FAMILY,
  SPIRIT_MODEL_CAPABILITIES,
  canSpiritCallCategory,
  getCategoriesForSpirit,
  getFamilyForRole,
  getRolesByFamily,
  type AgentRole,
} from "../../../shared/orb-agent-roles";

const studioSnap = (path = "/studio"): PageAgentSnapshot => ({
  pageId: "studio",
  pageLabel: "Studio",
  pagePath: path,
  capabilities: [],
});

describe("selectRoleForIntent", () => {
  it("routes multi-step requests to director", () => {
    const r = selectRoleForIntent({ text: "幫我把整個流程拼起來，從腳本到影片到配樂" });
    expect(r.role).toBe("director");
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it("routes lookup intents to researcher", () => {
    const r = selectRoleForIntent({ text: "幫我比較 Flux 和 SDXL 的差別" });
    expect(r.role).toBe("researcher");
  });

  it("routes review intents to critic", () => {
    const r = selectRoleForIntent({ text: "這個提示詞幫我改一下，再好一點" });
    expect(r.role).toBe("critic");
  });

  it("routes navigate intents to navigator", () => {
    // 用「設定頁面」這類沒有觸發其他 specialist 關鍵字的目標，確保
    // navigator 規則不會被前面的 specialist 規則搶走。
    const r = selectRoleForIntent({ text: "帶我去個人設定頁面" });
    expect(r.role).toBe("navigator");
  });

  it("routes short imperative on a studio page to composer", () => {
    const r = selectRoleForIntent({
      text: "再來一張",
      snapshot: studioSnap("/image-studio"),
    });
    expect(r.role).toBe("composer");
  });

  it("routes empty text to companion", () => {
    const r = selectRoleForIntent({ text: "" });
    expect(r.role).toBe("companion");
  });

  it("routes ambiguous off-studio text to companion", () => {
    const r = selectRoleForIntent({ text: "嗨，今天天氣不錯" });
    expect(r.role).toBe("companion");
  });
});

describe("composeRoleChain", () => {
  it("director chain ends with critic", () => {
    const chain = composeRoleChain({ text: "幫我規劃一個跨頁工作流" });
    expect(chain).toEqual(["director", "composer", "critic"]);
  });
  it("navigator chain is single-role", () => {
    const chain = composeRoleChain({ text: "帶我去儀表板" });
    expect(chain).toEqual(["navigator"]);
  });
  it("researcher chain leads with researcher then planning", () => {
    const chain = composeRoleChain({ text: "請查 SDXL vs Flux 差別" });
    expect(chain[0]).toBe("researcher");
    expect(chain).toContain("director");
  });
});

describe("getRoleSystemPromptSlice", () => {
  it("emits a non-empty prompt for every role", () => {
    const roles = ["director", "composer", "critic", "researcher", "navigator", "companion"] as const;
    for (const r of roles) {
      const slice = getRoleSystemPromptSlice(r);
      expect(slice.length).toBeGreaterThan(20);
    }
  });

  it("director prompt mentions runWorkflow and cross-page planning", () => {
    expect(getRoleSystemPromptSlice("director")).toMatch(/runWorkflow/);
  });

  // ── Operational briefs: each spirit's slice now ships real model IDs,
  // handoff payload schema, and known failure-mode workarounds. These
  // assertions catch silent regressions where someone shortens the
  // prompt back into a vibe sketch and loses the actionable content.
  it("image specialist references real text-to-image model IDs", () => {
    const slice = getRoleSystemPromptSlice("image-specialist");
    expect(slice).toMatch(/fal-ai\/flux-pro\/v1\.1/);
    expect(slice).toMatch(/fal-ai\/flux\/schnell/);
    expect(slice).toMatch(/seedream/);
    expect(slice).toMatch(/imagen4/);
  });

  it("video specialist references real image-to-video model IDs", () => {
    const slice = getRoleSystemPromptSlice("video-specialist");
    expect(slice).toMatch(/fal-ai\/kling-video/);
    expect(slice).toMatch(/runway-gen4-turbo/);
    expect(slice).toMatch(/pixverse/);
    expect(slice).toMatch(/wan-i2v/);
  });

  it("music specialist references real audio model IDs and Suno/ElevenLabs split", () => {
    const slice = getRoleSystemPromptSlice("music-specialist");
    expect(slice).toMatch(/suno-v4/);
    expect(slice).toMatch(/elevenlabs\/music/);
    expect(slice).toMatch(/stable-audio/);
  });

  it("voice specialist references real TTS / clone model IDs", () => {
    const slice = getRoleSystemPromptSlice("voice-specialist");
    expect(slice).toMatch(/elevenlabs\/eleven-v3/);
    expect(slice).toMatch(/multilingual/);
    expect(slice).toMatch(/cloneVoice/);
  });

  it("training specialist gives concrete LoRA dataset + parameter defaults", () => {
    const slice = getRoleSystemPromptSlice("training-specialist");
    // Concrete numbers users can act on, not vague "prepare data"
    expect(slice).toMatch(/15-20|15\s*-\s*20/);
    expect(slice).toMatch(/rank/);
    expect(slice).toMatch(/trainLora/);
  });

  it("learning specialist names concrete entry-point pages per modality", () => {
    const slice = getRoleSystemPromptSlice("learning-specialist");
    expect(slice).toMatch(/\/image-studio/);
    expect(slice).toMatch(/\/video-studio/);
    expect(slice).toMatch(/\/pro-studio/);
  });

  it("accountant gives concrete credit-cost ranges so estimates aren't hallucinated", () => {
    const slice = getRoleSystemPromptSlice("accountant");
    expect(slice).toMatch(/FLUX/);
    expect(slice).toMatch(/Kling/);
    // Caveat is critical so users don't treat the estimate as billing truth
    expect(slice).toMatch(/實際以扣款為準|modelPricing/);
  });

  it("quality coach ships before/after rewrite examples, not just guidance", () => {
    const slice = getRoleSystemPromptSlice("quality-coach");
    expect(slice).toMatch(/橘貓|teaser|9:16/);
    expect(slice).toMatch(/改寫公式|主體|構圖/);
  });

  it("inspector ships concrete workarounds for common failure modes", () => {
    const slice = getRoleSystemPromptSlice("inspector");
    expect(slice).toMatch(/incognito|schnell|wan-i2v|繞過/);
  });

  it("composer slice instructs concrete dispatch sequence + confirmation", () => {
    const slice = getRoleSystemPromptSlice("composer");
    expect(slice).toMatch(/fillPrompt|setModel|setParam|submit/);
  });

  it("critic slice covers all four modality framings (image/video/audio/text)", () => {
    const slice = getRoleSystemPromptSlice("critic");
    expect(slice).toMatch(/構圖/);
    expect(slice).toMatch(/節奏/);
    expect(slice).toMatch(/情緒/);
    expect(slice).toMatch(/CTA|鉤子|開場/);
  });

  it("researcher slice references the actual cross-modality model registry", () => {
    const slice = getRoleSystemPromptSlice("researcher");
    expect(slice).toMatch(/FLUX Pro/);
    expect(slice).toMatch(/Kling/);
    expect(slice).toMatch(/Suno/);
    expect(slice).toMatch(/ElevenLabs/);
  });

  it("navigator slice ships a concrete page → spirit handoff map", () => {
    const slice = getRoleSystemPromptSlice("navigator");
    expect(slice).toMatch(/\/image-studio/);
    expect(slice).toMatch(/\/video-studio/);
    expect(slice).toMatch(/\/pro-studio/);
  });
});

describe("selectRoleForIntent — proactive spirits", () => {
  it("routes cost / budget intents to accountant (財財)", () => {
    expect(selectRoleForIntent({ text: "本月花了多少點數？" }).role).toBe("accountant");
    expect(selectRoleForIntent({ text: "有沒有更省錢的方案" }).role).toBe("accountant");
    expect(selectRoleForIntent({ text: "how much did I spend this month" }).role).toBe("accountant");
  });

  it("routes prompt / quality coaching intents to quality-coach (巧巧)", () => {
    expect(selectRoleForIntent({ text: "幫我看這段提示詞" }).role).toBe("quality-coach");
    expect(selectRoleForIntent({ text: "畫面糊，怎麼改 prompt 比較好" }).role).toBe("quality-coach");
    expect(selectRoleForIntent({ text: "this prompt looks weird" }).role).toBe("quality-coach");
  });

  it("routes site error / patrol intents to inspector (守守)", () => {
    expect(selectRoleForIntent({ text: "這頁壞掉了，怪怪的" }).role).toBe("inspector");
    expect(selectRoleForIntent({ text: "送出之後就 404" }).role).toBe("inspector");
  });
});

describe("selectRoleForIntent — mutedRoles", () => {
  it("skips muted roles in keyword matching", () => {
    // Without mute, 「成本」走 accountant
    expect(selectRoleForIntent({ text: "這個成本會多少" }).role).toBe("accountant");
    // Muted accountant — should fall through to companion (no other rule matches)
    const muted = selectRoleForIntent({
      text: "這個成本會多少",
      mutedRoles: ["accountant"],
    });
    expect(muted.role).not.toBe("accountant");
  });

  it("respects multiple muted roles simultaneously", () => {
    // 「教我怎麼下提示詞」會命中 quality-coach 或 learning-specialist；
    // 兩個都靜音時必須交給 companion，而不是依然回 quality-coach。
    const r = selectRoleForIntent({
      text: "教我怎麼寫 prompt",
      mutedRoles: ["quality-coach", "learning-specialist"],
    });
    expect(r.role).not.toBe("quality-coach");
    expect(r.role).not.toBe("learning-specialist");
  });

  it("@nickname overrides mute (explicit summon always wins)", () => {
    // 使用者明示 @財財 即使 accountant 在靜音清單也應交給他 — 明示 > 偏好。
    const r = selectRoleForIntent({
      text: "@財財 幫我看本月花費",
      mutedRoles: ["accountant"],
    });
    expect(r.role).toBe("accountant");
  });
});

describe("@nickname mention routing", () => {
  // detectSpiritMention 是 module-internal，靠 selectRoleForIntent 的 override 0 路徑驗證。
  it("@圖圖 routes to image-specialist", () => {
    expect(selectRoleForIntent({ text: "@圖圖 幫我做一張海報" }).role).toBe("image-specialist");
  });

  it("@導導 routes to director", () => {
    expect(selectRoleForIntent({ text: "@導導 幫我規劃" }).role).toBe("director");
  });

  it("@巧巧 routes to quality-coach (proactive)", () => {
    expect(selectRoleForIntent({ text: "@巧巧 看一下這段提示詞" }).role).toBe("quality-coach");
  });

  it("@守守 routes to inspector (proactive)", () => {
    expect(selectRoleForIntent({ text: "@守守 這頁怎麼怪怪的" }).role).toBe("inspector");
  });

  it("舊別名 @阿圖 仍指向 image-specialist (backwards compat)", () => {
    // 舊命名保留在 SPIRIT_NICKNAMES 的別名清單，既有對話 / 儲存 prompt 不會壞。
    expect(selectRoleForIntent({ text: "@阿圖 幫我畫一張" }).role).toBe("image-specialist");
  });

  it("@-mention has higher confidence than keyword match", () => {
    const explicit = selectRoleForIntent({ text: "@查查 幫我比較一下" });
    const keyword = selectRoleForIntent({ text: "幫我比較 A 和 B" });
    expect(explicit.confidence).toBeGreaterThan(keyword.confidence);
  });
});

describe("SPIRIT_COLLAB_PROTOCOL", () => {
  // 全 15 個成員都要列出來 — handoffs[] 也只能指向已知角色。
  const ALL_ROLES: AgentRole[] = [
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
  ];

  it("covers all 15 spirits", () => {
    for (const role of ALL_ROLES) {
      expect(SPIRIT_COLLAB_PROTOCOL[role]).toBeDefined();
    }
    expect(Object.keys(SPIRIT_COLLAB_PROTOCOL).sort()).toEqual([...ALL_ROLES].sort());
  });

  it("every handoff target is itself a known spirit", () => {
    for (const role of ALL_ROLES) {
      const spec = SPIRIT_COLLAB_PROTOCOL[role];
      for (const h of spec.handoffs) {
        expect(ALL_ROLES).toContain(h.to);
      }
      for (const r of spec.receivedFrom) {
        expect(ALL_ROLES).toContain(r);
      }
    }
  });

  it("handoff metadata is non-empty", () => {
    for (const role of ALL_ROLES) {
      for (const h of SPIRIT_COLLAB_PROTOCOL[role].handoffs) {
        expect(h.reason.length).toBeGreaterThan(0);
        expect(h.when.length).toBeGreaterThan(0);
        // 不該交棒給自己 — 那不算交棒
        expect(h.to).not.toBe(role);
      }
    }
  });

  it("proactive triggers reference one of the proactive spirits OR companion (chat-state events)", () => {
    // The original 3 proactive spirits handle cost / quality / site-error.
    // `companion` (暖暖) was added later as the owner of conversation-state
    // proactive events like `context_near_full`, since open-conversation
    // upkeep is their natural beat. Lock the union here so adding new
    // owners requires an explicit decision.
    const allowed = new Set<AgentRole>([
      "accountant",
      "quality-coach",
      "inspector",
      "companion",
    ]);
    for (const t of SPIRIT_PROACTIVE_TRIGGERS) {
      expect(allowed.has(t.spirit)).toBe(true);
      expect(t.defaultPrompt.length).toBeGreaterThan(0);
    }
  });

  it("context_near_full is owned by the companion spirit + uses inline surface (don't auto-dismiss)", () => {
    const ctx = SPIRIT_PROACTIVE_TRIGGERS.find(t => t.event === "context_near_full");
    expect(ctx).toBeDefined();
    expect(ctx?.spirit).toBe("companion");
    expect(ctx?.surface).toBe("inline");
    // Template tokens the publisher must supply.
    expect(ctx?.defaultPrompt).toContain("{messageCount}");
    expect(ctx?.defaultPrompt).toContain("{usedPct}");
    expect(ctx?.defaultPrompt).toContain("{conversationTitle}");
  });
});

describe("detectSpiritMention / hasSpiritMention", () => {
  it("detects @-mentions inside text", () => {
    expect(detectSpiritMention("@圖圖 幫我做一張海報")).toBe("image-specialist");
    expect(detectSpiritMention("好的，@導導 你看怎樣")).toBe("director");
    expect(hasSpiritMention("@巧巧 看一下")).toBe(true);
  });

  it("detects bare nickname at start", () => {
    expect(detectSpiritMention("圖圖 幫我畫")).toBe("image-specialist");
    expect(hasSpiritMention("守守 巡一下")).toBe(true);
  });

  it("returns null for text without any spirit mention", () => {
    expect(detectSpiritMention("幫我做一張海報")).toBeNull();
    expect(hasSpiritMention("我想做點東西")).toBe(false);
    expect(hasSpiritMention("")).toBe(false);
  });

  it("does not match nickname appearing mid-sentence (only @ or start)", () => {
    // 一般句子裡偶然提到「圖圖」不應誤判為 @-mention
    expect(detectSpiritMention("我和朋友圖圖一起去")).toBeNull();
  });
});

describe("getPrimaryNicknameForRole", () => {
  it("returns the first nickname for each known role", () => {
    expect(getPrimaryNicknameForRole("image-specialist")).toBe("圖圖");
    expect(getPrimaryNicknameForRole("director")).toBe("導導");
    expect(getPrimaryNicknameForRole("accountant")).toBe("財財");
    expect(getPrimaryNicknameForRole("quality-coach")).toBe("巧巧");
    expect(getPrimaryNicknameForRole("inspector")).toBe("守守");
  });

  it("falls back to 暖暖 for an unknown role string", () => {
    // typed as AgentRole but at runtime we want graceful fallback
    expect(getPrimaryNicknameForRole("nonsense" as AgentRole)).toBe("暖暖");
  });

  it("primary nicknames round-trip through selectRoleForIntent", () => {
    // 鎖定 (pinning) 流程靠這個：UI 把 @<primary> 補在最前面，server 端
    // detectSpiritMention 必須認得回來，否則「鎖定」就是假象。
    const allRoles: AgentRole[] = [
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
    ];
    for (const role of allRoles) {
      const nick = getPrimaryNicknameForRole(role);
      const sel = selectRoleForIntent({ text: `@${nick} 幫我看一下` });
      expect(sel.role).toBe(role);
      expect(sel.confidence).toBeGreaterThan(0.9);
    }
  });
});

describe("SPIRIT_FAMILY classification", () => {
  it("covers every AgentRole exactly once", () => {
    const allRoles: AgentRole[] = [
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
    ];
    for (const r of allRoles) {
      expect(SPIRIT_FAMILY[r]).toBeDefined();
    }
    // exactly 15 entries — no orphans, no duplicates
    expect(Object.keys(SPIRIT_FAMILY)).toHaveLength(allRoles.length);
  });

  it("groups proactive trio under proactive family", () => {
    expect(getFamilyForRole("accountant")).toBe("proactive");
    expect(getFamilyForRole("quality-coach")).toBe("proactive");
    expect(getFamilyForRole("inspector")).toBe("proactive");
  });

  it("groups specialist 6 under specialist family", () => {
    const specialists = getRolesByFamily("specialist");
    expect(specialists).toEqual(
      expect.arrayContaining([
        "image-specialist",
        "video-specialist",
        "music-specialist",
        "voice-specialist",
        "training-specialist",
        "learning-specialist",
      ]),
    );
    expect(specialists).toHaveLength(6);
  });

  it("groups generic workflow 6 under role family", () => {
    const roles = getRolesByFamily("role");
    expect(roles).toEqual(
      expect.arrayContaining([
        "director",
        "composer",
        "critic",
        "researcher",
        "navigator",
        "companion",
      ]),
    );
    expect(roles).toHaveLength(6);
  });

  it("getRolesByFamily families partition every spirit", () => {
    const specialists = getRolesByFamily("specialist");
    const roles = getRolesByFamily("role");
    const proactive = getRolesByFamily("proactive");
    const total = specialists.length + roles.length + proactive.length;
    expect(total).toBe(15);
    // no role appears in two families
    const set = new Set([...specialists, ...roles, ...proactive]);
    expect(set.size).toBe(15);
  });
});

describe("SPIRIT_MODEL_CAPABILITIES", () => {
  it("covers every one of the 15 spirits", () => {
    const roles = Object.keys(SPIRIT_MODEL_CAPABILITIES) as AgentRole[];
    expect(roles).toHaveLength(15);
  });

  it("圖圖 (image-specialist) can call image generation, editing, and 3D categories", () => {
    const cats = getCategoriesForSpirit("image-specialist");
    expect(cats).toEqual(
      expect.arrayContaining([
        "text-to-image",
        "image-to-image",
        "image-to-3d",
        "text-to-3d",
        "image-to-json",
      ]),
    );
    expect(canSpiritCallCategory("image-specialist", "text-to-image")).toBe(true);
    expect(canSpiritCallCategory("image-specialist", "text-to-video")).toBe(false);
  });

  it("影影 (video-specialist) can call all video generation / conversion categories", () => {
    const cats = getCategoriesForSpirit("video-specialist");
    expect(cats).toEqual(
      expect.arrayContaining([
        "text-to-video",
        "image-to-video",
        "video-to-video",
        "video-to-text",
        "video-to-audio",
      ]),
    );
    expect(canSpiritCallCategory("video-specialist", "image-to-video")).toBe(true);
    expect(canSpiritCallCategory("video-specialist", "text-to-image")).toBe(false);
  });

  it("音音 (music-specialist) is scoped to text-to-audio", () => {
    expect(canSpiritCallCategory("music-specialist", "text-to-audio")).toBe(true);
    expect(canSpiritCallCategory("music-specialist", "text-to-speech")).toBe(false);
  });

  it("聲聲 (voice-specialist) covers tts and stt", () => {
    expect(canSpiritCallCategory("voice-specialist", "text-to-speech")).toBe(true);
    expect(canSpiritCallCategory("voice-specialist", "audio-to-text")).toBe(true);
    expect(canSpiritCallCategory("voice-specialist", "text-to-audio")).toBe(false);
  });

  it("練練 (training-specialist) is the only spirit that may call training", () => {
    const allowed = (Object.entries(SPIRIT_MODEL_CAPABILITIES) as Array<
      [AgentRole, ReadonlyArray<string>]
    >)
      .filter(([, cats]) => cats.includes("training"))
      .map(([role]) => role);
    // composer fans out to every category, so it also has training; the rest must not
    expect(allowed.sort()).toEqual(["composer", "training-specialist"].sort());
  });

  it("編編 (composer) can dispatch every category (executes whatever the page needs)", () => {
    const cats = getCategoriesForSpirit("composer");
    // composer should be the broadest — at least covers all four generation modalities
    expect(cats).toEqual(
      expect.arrayContaining([
        "text-to-image",
        "text-to-video",
        "text-to-audio",
        "text-to-speech",
        "training",
      ]),
    );
  });

  it("陪聊 / 導航 / 主動精靈 limit themselves to LLM-style reasoning categories", () => {
    for (const role of ["companion", "navigator"] as const) {
      const cats = getCategoriesForSpirit(role);
      expect(cats).toEqual(expect.arrayContaining(["llm"]));
      expect(canSpiritCallCategory(role, "text-to-image")).toBe(false);
      expect(canSpiritCallCategory(role, "text-to-video")).toBe(false);
    }
    for (const role of [
      "director",
      "researcher",
      "accountant",
      "quality-coach",
      "inspector",
      "learning-specialist",
    ] as const) {
      expect(canSpiritCallCategory(role, "llm")).toBe(true);
      expect(canSpiritCallCategory(role, "text-to-image")).toBe(false);
      expect(canSpiritCallCategory(role, "training")).toBe(false);
    }
  });

  it("品品 (critic) can read multimodal content via *-to-json and *-to-text but cannot generate it", () => {
    expect(canSpiritCallCategory("critic", "image-to-json")).toBe(true);
    expect(canSpiritCallCategory("critic", "video-to-text")).toBe(true);
    expect(canSpiritCallCategory("critic", "audio-to-text")).toBe(true);
    expect(canSpiritCallCategory("critic", "text-to-image")).toBe(false);
    expect(canSpiritCallCategory("critic", "text-to-video")).toBe(false);
  });
});

describe("stripSpiritMention", () => {
  it("removes leading bare nickname", () => {
    expect(stripSpiritMention("圖圖 一隻橘貓")).toBe("一隻橘貓");
  });

  it("removes inline @nickname", () => {
    expect(stripSpiritMention("我想要 @圖圖 畫一隻貓")).toBe("我想要 畫一隻貓");
  });

  it("returns original when no spirit is mentioned", () => {
    expect(stripSpiritMention("一隻橘貓側臥窗台")).toBe("一隻橘貓側臥窗台");
  });

  it("collapses extra whitespace from inline removal", () => {
    expect(stripSpiritMention("@影影  一支 5 秒影片")).toBe("一支 5 秒影片");
  });
});

describe("summarizeRoleChainForPrompt", () => {
  it("returns Chinese chain summary for multi-role chains", () => {
    expect(summarizeRoleChainForPrompt(["director", "composer"])).toMatch(/角色鏈/);
  });
  it("returns single-role label for length-1 chains", () => {
    expect(summarizeRoleChainForPrompt(["navigator"])).toMatch(/角色/);
    expect(summarizeRoleChainForPrompt(["navigator"])).not.toMatch(/角色鏈/);
  });
  it("returns empty string for empty chain", () => {
    expect(summarizeRoleChainForPrompt([])).toBe("");
  });
});
