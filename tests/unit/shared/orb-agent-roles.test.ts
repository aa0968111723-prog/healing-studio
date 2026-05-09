/**
 * tests/unit/shared/orb-agent-roles.test.ts
 *
 * Module — multi-agent role routing.
 */
import { describe, expect, it } from "vitest";
import type { PageAgentSnapshot } from "../../../shared/agent-actions";
import {
  composeRoleChain,
  getRoleSystemPromptSlice,
  selectRoleForIntent,
  summarizeRoleChainForPrompt,
  SPIRIT_COLLAB_PROTOCOL,
  SPIRIT_PROACTIVE_TRIGGERS,
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

  it("proactive triggers all reference one of the 3 proactive spirits", () => {
    const proactiveSet = new Set<AgentRole>(["accountant", "quality-coach", "inspector"]);
    for (const t of SPIRIT_PROACTIVE_TRIGGERS) {
      expect(proactiveSet.has(t.spirit)).toBe(true);
      expect(t.defaultPrompt.length).toBeGreaterThan(0);
    }
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
