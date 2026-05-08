import { describe, it, expect } from "vitest";
import {
  STUDIO_MODALITY_PROFILES,
  STUDIO_TOOLBOX_ENTRIES,
  STUDIO_COLLABORATION_LINKS,
  buildToolboxOpenAction,
  getStudioModalityProfile,
  getStudioCollaborationLink,
} from "../../../shared/orb-studio-actions";

describe("orb-studio-actions: four-modal deep operations", () => {
  it("covers all four modalities", () => {
    const modalities = STUDIO_MODALITY_PROFILES.map(p => p.modality).sort();
    expect(modalities).toEqual(["audio", "image", "video", "voice"]);
  });

  it("each modality exposes at least one deep action that yields a non-empty AgentAction[]", () => {
    for (const profile of STUDIO_MODALITY_PROFILES) {
      expect(profile.deepActions.length).toBeGreaterThan(0);
      for (const act of profile.deepActions) {
        const actions = act.buildActions();
        expect(actions.length).toBeGreaterThan(0);
        // 第一個動作應該先把模態切過去，避免在錯誤模態上開錯工具箱
        expect(actions[0]).toEqual({ type: "setModality", modality: profile.modality });
      }
    }
  });

  it("getStudioModalityProfile returns the matching profile or undefined", () => {
    expect(getStudioModalityProfile("image")?.modality).toBe("image");
    // @ts-expect-error — 測試非法值
    expect(getStudioModalityProfile("unknown")).toBeUndefined();
  });
});

describe("orb-studio-actions: toolbox quick-access", () => {
  it("covers vault / assets / models / history / controls", () => {
    const tabs = STUDIO_TOOLBOX_ENTRIES.map(e => e.tab).sort();
    expect(tabs).toEqual(["assets", "controls", "history", "models", "vault"]);
  });

  it("buildToolboxOpenAction emits a Studio-compatible openDialog", () => {
    const action = buildToolboxOpenAction("models");
    expect(action).toEqual({
      type: "openDialog",
      dialogId: "toolbox",
      params: { tab: "models" },
    });
  });
});

describe("orb-studio-actions: collaboration links", () => {
  it("includes model recommend / director / API deep-link / site orb", () => {
    const ids = STUDIO_COLLABORATION_LINKS.map(l => l.id).sort();
    expect(ids).toEqual([
      "api-deep-link",
      "director-handoff",
      "recommend-model",
      "site-orb-collab",
    ]);
  });

  it("each link has a non-empty Chinese chatPrompt the orb can forward", () => {
    for (const link of STUDIO_COLLABORATION_LINKS) {
      expect(link.chatPrompt.length).toBeGreaterThan(0);
    }
  });

  it("getStudioCollaborationLink resolves by id", () => {
    expect(getStudioCollaborationLink("director-handoff")?.label).toBe("交給導演 AI");
    expect(getStudioCollaborationLink("nope")).toBeUndefined();
  });
});
