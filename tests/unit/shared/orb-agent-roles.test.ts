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
  pickArrivalSpiritForPath,
  pickDefaultPathForRole,
  selectRoleForIntent,
  stripSpiritMention,
  summarizeRoleChainForPrompt,
  SPIRIT_COLLAB_PROTOCOL,
  SPIRIT_PROACTIVE_TRIGGERS,
  getProtocolReceivedFromHandoffs,
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

  // 「做腳本」「寫劇本」「故事大綱」「分鏡」是站內導演 AI 的固定產出，
  // 必須路由到 director — 不然會 fallback 成 companion，跳頁不會發生，
  // 對話框也接不上。這條是回報「直接跳頁沒對話框」的源頭。
  it("routes 做腳本 / 寫腳本 / 影片腳本 to director", () => {
    expect(selectRoleForIntent({ text: "做腳本" }).role).toBe("director");
    expect(selectRoleForIntent({ text: "我想寫腳本" }).role).toBe("director");
    expect(selectRoleForIntent({ text: "我要寫一支影片腳本" }).role).toBe("director");
    expect(selectRoleForIntent({ text: "幫我做支廣告腳本" }).role).toBe("director");
  });

  it("routes 劇本 / 故事大綱 / 分鏡 to director", () => {
    expect(selectRoleForIntent({ text: "我有一個劇本想改" }).role).toBe("director");
    expect(selectRoleForIntent({ text: "幫我寫一份故事大綱" }).role).toBe("director");
    expect(selectRoleForIntent({ text: "需要分鏡" }).role).toBe("director");
  });
});

describe("pickDefaultPathForRole", () => {
  // 反向查表是 server-side legacy fallback 補打 navigate action 的依據；
  // 漏一個 mapping 就代表那位精靈的「跳頁沒對話框」沒救回來，所以這層
  // 必須有測試保護。
  it("maps each on-page spirit role back to its home path", () => {
    expect(pickDefaultPathForRole("image-specialist")).toBe("/image-studio");
    expect(pickDefaultPathForRole("video-specialist")).toBe("/video-studio");
    expect(pickDefaultPathForRole("music-specialist")).toBe("/pro-studio");
    expect(pickDefaultPathForRole("director")).toBe("/director");
    expect(pickDefaultPathForRole("training-specialist")).toBe("/models");
    expect(pickDefaultPathForRole("learning-specialist")).toBe("/learn");
    expect(pickDefaultPathForRole("accountant")).toBe("/dashboard");
    // 7 位新增精靈：notes-curator / settings-detail / community-manager / chief-orchestrator
    // 各自接手了筆記 / 設定 / 社群 / 團隊頁面；researcher 改回沒有專屬頁面（workflow 角色）。
    expect(pickDefaultPathForRole("notes-curator")).toBe("/notes");
    expect(pickDefaultPathForRole("settings-detail")).toBe("/settings");
    expect(pickDefaultPathForRole("community-manager")).toBe("/social");
    expect(pickDefaultPathForRole("chief-orchestrator")).toBe("/team");
    expect(pickDefaultPathForRole("legal-advisor")).toBe("/legal");
    expect(pickDefaultPathForRole("security-guard")).toBe("/security");
    expect(pickDefaultPathForRole("plan-executor")).toBe("/jobs");
  });

  it("returns null for non-page workflow roles", () => {
    // composer / critic / companion / navigator / researcher / 帶帶 沒有專屬頁面，
    // server 不該補強制跳頁 — 否則會把純對話打斷。
    expect(pickDefaultPathForRole("composer")).toBeNull();
    expect(pickDefaultPathForRole("critic")).toBeNull();
    expect(pickDefaultPathForRole("companion")).toBeNull();
    expect(pickDefaultPathForRole("navigator")).toBeNull();
    // researcher 從原本的 /notes 移交給 notes-curator；自己回歸無頁面的 workflow 角色。
    expect(pickDefaultPathForRole("researcher")).toBeNull();
    // 帶帶 (onboarding-coach) 是「跟著使用者目前所在頁」的 coach，沒有專屬頁面。
    expect(pickDefaultPathForRole("onboarding-coach")).toBeNull();
  });

  it("is the inverse of pickArrivalSpiritForPath for canonical paths", () => {
    const pairs: Array<[string, AgentRole]> = [
      ["/image-studio", "image-specialist"],
      ["/video-studio", "video-specialist"],
      ["/director", "director"],
    ];
    for (const [path, role] of pairs) {
      expect(pickArrivalSpiritForPath(path)).toBe(role);
      expect(pickDefaultPathForRole(role)).toBe(path);
    }
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

describe("scoreProtocolHandoffs / pickBestHandoff", () => {
  // 動態 picker：依 hintTokens 選擇命中的 handoff，busyRoles 扣分，
  // recentRoles 防止 cycle。
  it("scores handoffs higher when hintToken matches the when-text", async () => {
    const { scoreProtocolHandoffs } = await import("../../../shared/orb-agent-roles");
    const scored = scoreProtocolHandoffs("director", { hintTokens: ["video"] });
    // 至少有一條 handoff 應該因為 'video' token 命中而分數 > 0
    const top = scored[0];
    expect(top.score).toBeGreaterThan(0);
    // 命中的多半是 video-specialist
    const videoHandoff = scored.find(s => s.handoff.to === "video-specialist");
    expect(videoHandoff).toBeDefined();
    expect(videoHandoff!.score).toBeGreaterThan(0);
  });

  it("pickBestHandoff returns null when every candidate is muted", async () => {
    const { pickBestHandoff, SPIRIT_COLLAB_PROTOCOL } = await import("../../../shared/orb-agent-roles");
    const allTargets = SPIRIT_COLLAB_PROTOCOL["accountant"].handoffs.map(h => h.to);
    const picked = pickBestHandoff("accountant", { mutedRoles: allTargets });
    expect(picked).toBeNull();
  });

  it("pickBestHandoff penalises busy spirits without removing them", async () => {
    const { scoreProtocolHandoffs } = await import("../../../shared/orb-agent-roles");
    const scored = scoreProtocolHandoffs("director", {
      busyRoles: ["composer"],
    });
    const composer = scored.find(s => s.handoff.to === "composer");
    expect(composer).toBeDefined();
    expect(composer!.score).toBeLessThan(0);
  });

  it("walkProtocolHandoffChain breaks on cycle", async () => {
    const { walkProtocolHandoffChain } = await import("../../../shared/orb-agent-roles");
    const chain = walkProtocolHandoffChain("director", { maxDepth: 6 });
    // 不該出現重複角色
    const unique = new Set(chain);
    expect(unique.size).toBe(chain.length);
  });

  it("walkProtocolHandoffChain respects maxDepth", async () => {
    const { walkProtocolHandoffChain } = await import("../../../shared/orb-agent-roles");
    const chain = walkProtocolHandoffChain("director", { maxDepth: 2 });
    expect(chain.length).toBeLessThanOrEqual(2);
  });
});

describe("composeRoleChain dynamic routing", () => {
  // chief-orchestrator 走 walker，hintTokens 從文字抽 — 「想做影片」應該
  // 把 video-specialist 推到鏈中。
  it("chief-orchestrator chain includes video-specialist when user asks about video", () => {
    const chain = composeRoleChain({ text: "@總總 幫我安排做一支短影片的流程" });
    expect(chain[0]).toBe("chief-orchestrator");
    expect(chain).toContain("video-specialist");
  });

  it("inspiration-specialist chain leans to image when user mentions illustration", () => {
    const chain = composeRoleChain({ text: "@靈靈 我想做一張海報插畫但沒靈感" });
    expect(chain[0]).toBe("inspiration-specialist");
    expect(chain).toContain("image-specialist");
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
  // 全 25 個成員都要列出來 — handoffs[] 也只能指向已知角色。
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
    // 7 位新增精靈
    "legal-advisor",
    "security-guard",
    "community-manager",
    "chief-orchestrator",
    "onboarding-coach",
    "notes-curator",
    "settings-detail",
    // 第 8 位新增：規劃 + 多步驟執行
    "plan-executor",
    // 第 9-10 位：靈感 + 解剖
    "inspiration-specialist",
    "anatomy-specialist",
  ];

  it("covers all 25 spirits", () => {
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

  it("receivedFrom is the derived inverse of handoffs (no drift)", () => {
    // 防止 SPIRIT_COLLAB_PROTOCOL.handoffs ↔ receivedFrom 又長出不對稱。
    // 一旦有人改 handoffs 卻忘改 receivedFrom（或反之），這條會炸。
    for (const role of ALL_ROLES) {
      const derived = getProtocolReceivedFromHandoffs(role);
      const declared = [...SPIRIT_COLLAB_PROTOCOL[role].receivedFrom].sort();
      expect(declared).toEqual([...derived]);
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
    // 6 個 proactive 精靈：原本的 3 位（財財 / 巧巧 / 守守）+ 新增 3 位
    // （律律 / 安安 / 帶帶）。`companion` (暖暖) 是 chat-state 事件的擁有者，
    // 像 `context_near_full` 這類「我們聊太久了」的提示由暖暖出面最自然。
    // 另外社群 / 筆記 / 設定 / 總管也有自己的軟提示事件，於是這份 allowed 把
    // 所有「會主動出聲」的精靈納入；以後新增 trigger 必須選一位明確的擁有者。
    const allowed = new Set<AgentRole>([
      "accountant",
      "quality-coach",
      "inspector",
      "companion",
      "legal-advisor",
      "security-guard",
      "onboarding-coach",
      "chief-orchestrator",
      "community-manager",
      "notes-curator",
      "settings-detail",
      "plan-executor",
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
      // 7 位新增精靈
      "legal-advisor",
      "security-guard",
      "community-manager",
      "chief-orchestrator",
      "onboarding-coach",
      "notes-curator",
      "settings-detail",
      // 第 8 位新增：規劃 + 多步驟執行
      "plan-executor",
      // 第 9-10 位：靈感 + 解剖
      "inspiration-specialist",
      "anatomy-specialist",
    ];
    for (const r of allRoles) {
      expect(SPIRIT_FAMILY[r]).toBeDefined();
    }
    // exactly 25 entries — no orphans, no duplicates
    expect(Object.keys(SPIRIT_FAMILY)).toHaveLength(allRoles.length);
  });

  it("groups proactive trio under proactive family", () => {
    expect(getFamilyForRole("accountant")).toBe("proactive");
    expect(getFamilyForRole("quality-coach")).toBe("proactive");
    expect(getFamilyForRole("inspector")).toBe("proactive");
  });

  it("groups specialist family — 6 original + 群群 + 靈靈 + 體體", () => {
    const specialists = getRolesByFamily("specialist");
    expect(specialists).toEqual(
      expect.arrayContaining([
        "image-specialist",
        "video-specialist",
        "music-specialist",
        "voice-specialist",
        "training-specialist",
        "learning-specialist",
        "community-manager",
        "inspiration-specialist",
        "anatomy-specialist",
      ]),
    );
    expect(specialists).toHaveLength(9);
  });

  it("groups role family — 6 original + 總總 / 記記 / 細細 / 步步", () => {
    const roles = getRolesByFamily("role");
    expect(roles).toEqual(
      expect.arrayContaining([
        "director",
        "composer",
        "critic",
        "researcher",
        "navigator",
        "companion",
        "chief-orchestrator",
        "notes-curator",
        "settings-detail",
        "plan-executor",
      ]),
    );
    expect(roles).toHaveLength(10);
  });

  it("groups proactive family — 3 original + 律律 / 安安 / 帶帶", () => {
    const proactive = getRolesByFamily("proactive");
    expect(proactive).toEqual(
      expect.arrayContaining([
        "accountant",
        "quality-coach",
        "inspector",
        "legal-advisor",
        "security-guard",
        "onboarding-coach",
      ]),
    );
    expect(proactive).toHaveLength(6);
  });

  it("getRolesByFamily families partition every spirit", () => {
    const specialists = getRolesByFamily("specialist");
    const roles = getRolesByFamily("role");
    const proactive = getRolesByFamily("proactive");
    const total = specialists.length + roles.length + proactive.length;
    expect(total).toBe(25);
    // no role appears in two families
    const set = new Set([...specialists, ...roles, ...proactive]);
    expect(set.size).toBe(25);
  });
});

describe("SPIRIT_MODEL_CAPABILITIES", () => {
  it("covers every one of the 25 spirits", () => {
    const roles = Object.keys(SPIRIT_MODEL_CAPABILITIES) as AgentRole[];
    expect(roles).toHaveLength(25);
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

  it("練練 (training-specialist) plus composer + 步步 are the only spirits authorised to call training", () => {
    const allowed = (Object.entries(SPIRIT_MODEL_CAPABILITIES) as Array<
      [AgentRole, ReadonlyArray<string>]
    >)
      .filter(([, cats]) => cats.includes("training"))
      .map(([role]) => role);
    // composer fans out to every category, plan-executor inherits ALL_CATEGORIES
    // because it owns multi-step workflow execution that may include LoRA training;
    // every other spirit must NOT have direct training authority.
    expect(allowed.sort()).toEqual(
      ["composer", "plan-executor", "training-specialist"].sort()
    );
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
