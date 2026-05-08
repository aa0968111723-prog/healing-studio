import { describe, it, expect } from "vitest";
import {
  STUDIO_MODALITY_PROFILES,
  STUDIO_TOOLBOX_ENTRIES,
  STUDIO_COLLABORATION_LINKS,
  buildToolboxOpenAction,
  getStudioModalityProfile,
  getStudioCollaborationLink,
  IMAGE_STUDIO_T2I_PROFILE,
  IMAGE_STUDIO_T2I_MODELS,
  IMAGE_STUDIO_VIBE_CARDS,
  IMAGE_STUDIO_PROMPT_TEMPLATES,
  IMAGE_STUDIO_T2I_ASPECT_RATIOS,
  IMAGE_STUDIO_T2I_COLLABORATION_LINKS,
  buildImageStudioSetModelActions,
  buildImageStudioApplyVibeActions,
  buildImageStudioFillPromptActions,
  buildImageStudioSetAspectRatioActions,
  IMAGE_STUDIO_EDIT_PROFILE,
  IMAGE_STUDIO_EDIT_MODELS,
  IMAGE_STUDIO_EDIT_TEMPLATES,
  IMAGE_STUDIO_EDIT_STRENGTH_PRESETS,
  IMAGE_STUDIO_EDIT_OUTPUT_SIZES,
  IMAGE_STUDIO_EDIT_COLLABORATION_LINKS,
  IMAGE_STUDIO_EDIT_CAPABILITY_LABELS,
  buildImageStudioEditSetModelActions,
  buildImageStudioEditFillPromptActions,
  buildImageStudioEditSetStrengthActions,
  buildImageStudioEditSetOutputSizeActions,
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

describe("orb-studio-actions: image studio T2I profile", () => {
  it("profile points at /image-studio with the four T2I models", () => {
    expect(IMAGE_STUDIO_T2I_PROFILE.pageId).toBe("image-studio");
    expect(IMAGE_STUDIO_T2I_PROFILE.pagePath).toBe("/image-studio");
    expect(IMAGE_STUDIO_T2I_MODELS.map(m => m.id).sort()).toEqual([
      "imagen4",
      "nanoBanana2",
      "nanoBananaPro",
      "seedreamV4",
    ]);
  });

  it("buildImageStudioSetModelActions starts with setTab=t2i to avoid stranded edit/SD context", () => {
    const actions = buildImageStudioSetModelActions("nanoBanana2");
    expect(actions[0]).toEqual({ type: "setTab", tabId: "t2i" });
    expect(actions[1]).toEqual({ type: "setModel", modelId: "nanoBanana2" });
  });

  it("vibes catalog matches ImageStudio's 8 cards and emits applyPreset actions", () => {
    expect(IMAGE_STUDIO_VIBE_CARDS).toHaveLength(8);
    const actions = buildImageStudioApplyVibeActions("cinematic");
    expect(actions[0]).toEqual({ type: "setTab", tabId: "t2i" });
    expect(actions[1]).toEqual({ type: "applyPreset", presetId: "cinematic" });
  });

  it("prompt templates emit fillPrompt actions and respect append flag", () => {
    expect(IMAGE_STUDIO_PROMPT_TEMPLATES.length).toBeGreaterThanOrEqual(6);
    const overwrite = buildImageStudioFillPromptActions("hello");
    expect(overwrite[1]).toEqual({ type: "fillPrompt", text: "hello", append: false });
    const append = buildImageStudioFillPromptActions(", more", true);
    expect(append[1]).toEqual({ type: "fillPrompt", text: ", more", append: true });
  });

  it("aspect ratio shortcut emits setParam aspectRatio", () => {
    expect(IMAGE_STUDIO_T2I_ASPECT_RATIOS.map(a => a.id)).toContain("16:9");
    const actions = buildImageStudioSetAspectRatioActions("16:9");
    expect(actions[1]).toEqual({ type: "setParam", key: "aspectRatio", value: "16:9" });
  });

  it("T2I collaboration links cover prompt coach / model recommender / handoff edit / director", () => {
    const ids = IMAGE_STUDIO_T2I_COLLABORATION_LINKS.map(l => l.id).sort();
    expect(ids).toEqual([
      "t2i-director-storyboard",
      "t2i-handoff-edit",
      "t2i-prompt-coach",
      "t2i-recommend-model",
    ]);
    for (const link of IMAGE_STUDIO_T2I_COLLABORATION_LINKS) {
      expect(link.chatPrompt.length).toBeGreaterThan(0);
    }
  });
});

describe("orb-studio-actions: image studio Edit profile", () => {
  it("profile points at /image-studio edit tab with the nine edit models", () => {
    expect(IMAGE_STUDIO_EDIT_PROFILE.pageId).toBe("image-studio");
    expect(IMAGE_STUDIO_EDIT_PROFILE.activeTab).toBe("edit");
    expect(IMAGE_STUDIO_EDIT_MODELS.map(m => m.id).sort()).toEqual([
      "flux2ProEdit",
      "fluxKontext",
      "gptImage15Edit",
      "grokEdit",
      "nanoBanana2Edit",
      "nanoBananaEdit",
      "nanoBananaProEdit",
      "seedreamV45Edit",
      "seedreamV5LiteEdit",
    ]);
  });

  it("each model declares only known capabilities and they have a Chinese label", () => {
    const allowed = new Set(["multiRef", "strength", "neg", "mask", "guidance", "size"]);
    for (const m of IMAGE_STUDIO_EDIT_MODELS) {
      for (const cap of m.capabilities) {
        expect(allowed.has(cap)).toBe(true);
        expect(IMAGE_STUDIO_EDIT_CAPABILITY_LABELS[cap]).toBeTruthy();
      }
    }
  });

  it("buildImageStudioEditSetModelActions starts with setTab=edit", () => {
    const actions = buildImageStudioEditSetModelActions("seedreamV45Edit");
    expect(actions[0]).toEqual({ type: "setTab", tabId: "edit" });
    expect(actions[1]).toEqual({ type: "setModel", modelId: "seedreamV45Edit" });
  });

  it("templates emit fillPrompt actions (overwrite & append) on the edit tab", () => {
    expect(IMAGE_STUDIO_EDIT_TEMPLATES.length).toBeGreaterThanOrEqual(6);
    const overwrite = buildImageStudioEditFillPromptActions("clean cutout");
    expect(overwrite[0]).toEqual({ type: "setTab", tabId: "edit" });
    expect(overwrite[1]).toEqual({ type: "fillPrompt", text: "clean cutout", append: false });
    const append = buildImageStudioEditFillPromptActions(", style", true);
    expect(append[1]).toEqual({ type: "fillPrompt", text: ", style", append: true });
  });

  it("strength presets are within 0..1 and emit setParam strength", () => {
    expect(IMAGE_STUDIO_EDIT_STRENGTH_PRESETS).toHaveLength(4);
    for (const p of IMAGE_STUDIO_EDIT_STRENGTH_PRESETS) {
      expect(p.value).toBeGreaterThanOrEqual(0);
      expect(p.value).toBeLessThanOrEqual(1);
    }
    const actions = buildImageStudioEditSetStrengthActions(0.5);
    expect(actions[1]).toEqual({ type: "setParam", key: "strength", value: 0.5 });
  });

  it("output sizes match Studio.tsx select values and emit setParam outputSize", () => {
    const ids = IMAGE_STUDIO_EDIT_OUTPUT_SIZES.map(s => s.id).sort();
    expect(ids).toEqual(["1024x1024", "1024x1536", "1536x1024", "auto"]);
    const actions = buildImageStudioEditSetOutputSizeActions("1536x1024");
    expect(actions[1]).toEqual({ type: "setParam", key: "outputSize", value: "1536x1024" });
  });

  it("Edit collaboration links cover prompt coach / model recommender / re-shoot t2i / director flow", () => {
    const ids = IMAGE_STUDIO_EDIT_COLLABORATION_LINKS.map(l => l.id).sort();
    expect(ids).toEqual([
      "edit-director-flow",
      "edit-from-t2i",
      "edit-prompt-coach",
      "edit-recommend-model",
    ]);
    for (const link of IMAGE_STUDIO_EDIT_COLLABORATION_LINKS) {
      expect(link.chatPrompt.length).toBeGreaterThan(0);
    }
  });
});
