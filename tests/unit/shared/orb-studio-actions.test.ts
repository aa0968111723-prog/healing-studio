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
  IMAGE_STUDIO_UPSCALE_PROFILE,
  IMAGE_STUDIO_UPSCALE_MODELS,
  IMAGE_STUDIO_UPSCALE_FACTORS,
  IMAGE_STUDIO_UPSCALE_COLLABORATION_LINKS,
  buildImageStudioUpscaleSetModelActions,
  buildImageStudioUpscaleSetModeActions,
  buildImageStudioUpscaleSetFactorActions,
  IMAGE_STUDIO_POSE_PROFILE,
  IMAGE_STUDIO_POSE_MODELS,
  IMAGE_STUDIO_POSE_MODES,
  IMAGE_STUDIO_POSE_COLLABORATION_LINKS,
  buildImageStudioPoseSetModelActions,
  buildImageStudioPoseSetDrawModeActions,
  IMAGE_STUDIO_SD_PROFILE,
  IMAGE_STUDIO_SD_MODELS,
  IMAGE_STUDIO_SD_IMAGE_SIZES,
  IMAGE_STUDIO_SD_PROMPT_TEMPLATES,
  IMAGE_STUDIO_SD_GUIDANCE_PRESETS,
  IMAGE_STUDIO_SD_INFER_STEPS_PRESETS,
  IMAGE_STUDIO_SD_COLLABORATION_LINKS,
  IMAGE_STUDIO_SD_CAPABILITY_LABELS,
  buildImageStudioSDSetModelActions,
  buildImageStudioSDApplyPromptTemplateActions,
  buildImageStudioSDSetImageSizeActions,
  buildImageStudioSDSetGuidanceActions,
  buildImageStudioSDSetInferStepsActions,
  buildImageStudioSDSetLoraActions,
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

describe("orb-studio-actions: image studio Upscale profile", () => {
  it("profile points at upscale tab with seedVRUpscale", () => {
    expect(IMAGE_STUDIO_UPSCALE_PROFILE.activeTab).toBe("upscale");
    expect(IMAGE_STUDIO_UPSCALE_MODELS.map(m => m.id)).toEqual(["seedVRUpscale"]);
  });

  it("setModel + setMode actions land on upscale tab", () => {
    const m = buildImageStudioUpscaleSetModelActions("seedVRUpscale");
    expect(m[0]).toEqual({ type: "setTab", tabId: "upscale" });
    expect(m[1]).toEqual({ type: "setModel", modelId: "seedVRUpscale" });
    const mode = buildImageStudioUpscaleSetModeActions("target");
    expect(mode[1]).toEqual({ type: "setParam", key: "upscaleMode", value: "target" });
  });

  it("setFactor forces mode=factor before applying factor value", () => {
    const actions = buildImageStudioUpscaleSetFactorActions(4);
    expect(actions).toHaveLength(3);
    expect(actions[0]).toEqual({ type: "setTab", tabId: "upscale" });
    expect(actions[1]).toEqual({ type: "setParam", key: "upscaleMode", value: "factor" });
    expect(actions[2]).toEqual({ type: "setParam", key: "upscaleFactor", value: 4 });
  });

  it("factors expose ×2 and ×4", () => {
    const values = IMAGE_STUDIO_UPSCALE_FACTORS.map(f => f.value).sort();
    expect(values).toEqual([2, 4]);
  });

  it("upscale collaboration links cover 4 cross-tab handoffs", () => {
    expect(IMAGE_STUDIO_UPSCALE_COLLABORATION_LINKS).toHaveLength(4);
    for (const link of IMAGE_STUDIO_UPSCALE_COLLABORATION_LINKS) {
      expect(link.chatPrompt.length).toBeGreaterThan(0);
    }
  });
});

describe("orb-studio-actions: image studio Pose profile", () => {
  it("profile lists all 7 detection modes (matches ImageStudio.tsx UI)", () => {
    const ids = IMAGE_STUDIO_POSE_MODES.map(m => m.id).sort();
    expect(ids).toEqual([
      "body-pose",
      "face-hand-mask",
      "face-mask",
      "face-pose",
      "full-pose",
      "hand-mask",
      "hand-pose",
    ]);
    // 全部都應該被 PageAgent setParam 接受（修復 allow-list 後）
    for (const m of IMAGE_STUDIO_POSE_MODES) {
      expect(m.acceptedBySetParam).toBe(true);
    }
  });

  it("setModel + setDrawMode actions land on pose tab", () => {
    const m = buildImageStudioPoseSetModelActions("dwPose");
    expect(m[0]).toEqual({ type: "setTab", tabId: "pose" });
    expect(m[1]).toEqual({ type: "setModel", modelId: "dwPose" });
    const draw = buildImageStudioPoseSetDrawModeActions("face-mask");
    expect(draw[1]).toEqual({ type: "setParam", key: "drawMode", value: "face-mask" });
  });

  it("pose has DWPose model and 4 collaboration links", () => {
    expect(IMAGE_STUDIO_POSE_MODELS.map(m => m.id)).toEqual(["dwPose"]);
    expect(IMAGE_STUDIO_POSE_COLLABORATION_LINKS).toHaveLength(4);
    for (const link of IMAGE_STUDIO_POSE_COLLABORATION_LINKS) {
      expect(link.chatPrompt.length).toBeGreaterThan(0);
    }
  });
});

describe("orb-studio-actions: image studio SD profile", () => {
  it("profile points at sd tab with the 3 SD models", () => {
    expect(IMAGE_STUDIO_SD_PROFILE.activeTab).toBe("sd");
    expect(IMAGE_STUDIO_SD_MODELS.map(m => m.id).sort()).toEqual([
      "fastSdxl",
      "sdLora",
      "stableDiffusion35",
    ]);
  });

  it("each SD model declares only known capabilities and labels exist", () => {
    const allowed = new Set(["neg", "guidance", "lora", "controlnet"]);
    for (const m of IMAGE_STUDIO_SD_MODELS) {
      for (const cap of m.capabilities) {
        expect(allowed.has(cap)).toBe(true);
        expect(IMAGE_STUDIO_SD_CAPABILITY_LABELS[cap]).toBeTruthy();
      }
    }
  });

  it("only SD 3.5 advertises ControlNet support (matches MODELS array)", () => {
    const sd35 = IMAGE_STUDIO_SD_MODELS.find(m => m.id === "stableDiffusion35");
    expect(sd35?.capabilities).toContain("controlnet");
    const others = IMAGE_STUDIO_SD_MODELS.filter(m => m.id !== "stableDiffusion35");
    for (const m of others) {
      expect(m.capabilities).not.toContain("controlnet");
    }
  });

  it("image sizes match ImageStudio.tsx IMAGE_SIZES (6 entries)", () => {
    const ids = IMAGE_STUDIO_SD_IMAGE_SIZES.map(s => s.id).sort();
    expect(ids).toEqual([
      "landscape_16_9",
      "landscape_4_3",
      "portrait_16_9",
      "portrait_4_3",
      "square",
      "square_hd",
    ]);
  });

  it("guidance presets stay within 1..20 and infer steps within 10..50", () => {
    for (const p of IMAGE_STUDIO_SD_GUIDANCE_PRESETS) {
      expect(p.value).toBeGreaterThanOrEqual(1);
      expect(p.value).toBeLessThanOrEqual(20);
    }
    for (const p of IMAGE_STUDIO_SD_INFER_STEPS_PRESETS) {
      expect(p.value).toBeGreaterThanOrEqual(10);
      expect(p.value).toBeLessThanOrEqual(50);
    }
  });

  it("apply prompt template fills both positive and negative slots", () => {
    const template = IMAGE_STUDIO_SD_PROMPT_TEMPLATES[0];
    expect(template.negPrompt).toBeTruthy();
    const actions = buildImageStudioSDApplyPromptTemplateActions(template);
    expect(actions[0]).toEqual({ type: "setTab", tabId: "sd" });
    expect(actions[1]).toMatchObject({
      type: "fillPrompt",
      text: template.prompt,
      append: false,
    });
    expect(actions[2]).toMatchObject({
      type: "fillPrompt",
      slot: "negativePrompt",
      text: template.negPrompt,
    });
  });

  it("apply prompt template skips negative slot when template lacks negPrompt", () => {
    const template = {
      id: "no-neg",
      label: "純正向",
      emoji: "🎯",
      prompt: "just positive",
    };
    const actions = buildImageStudioSDApplyPromptTemplateActions(template);
    expect(actions).toHaveLength(2);
    expect(actions[1]).toMatchObject({ type: "fillPrompt", text: "just positive" });
  });

  it("setImageSize / setGuidance / setInferSteps land on SD tab", () => {
    expect(buildImageStudioSDSetImageSizeActions("square_hd")[1]).toEqual({
      type: "setParam",
      key: "sdImageSize",
      value: "square_hd",
    });
    expect(buildImageStudioSDSetGuidanceActions(7.5)[1]).toEqual({
      type: "setParam",
      key: "sdGuidance",
      value: 7.5,
    });
    expect(buildImageStudioSDSetInferStepsActions(30)[1]).toEqual({
      type: "setParam",
      key: "sdInferSteps",
      value: 30,
    });
  });

  it("setLora applies path + scale together", () => {
    const actions = buildImageStudioSDSetLoraActions(
      "https://huggingface.co/example/lora",
      0.8
    );
    expect(actions).toHaveLength(3);
    expect(actions[1]).toMatchObject({
      type: "setParam",
      key: "loraPath",
      value: "https://huggingface.co/example/lora",
    });
    expect(actions[2]).toMatchObject({ type: "setParam", key: "loraScale", value: 0.8 });
  });

  it("SD setModel lands on sd tab", () => {
    const actions = buildImageStudioSDSetModelActions("stableDiffusion35");
    expect(actions[0]).toEqual({ type: "setTab", tabId: "sd" });
    expect(actions[1]).toEqual({ type: "setModel", modelId: "stableDiffusion35" });
  });

  it("SD collaboration links cover 4 expected ids", () => {
    const ids = IMAGE_STUDIO_SD_COLLABORATION_LINKS.map(l => l.id).sort();
    expect(ids).toEqual([
      "sd-controlnet-from-pose",
      "sd-find-lora",
      "sd-prompt-coach",
      "sd-recommend-model",
    ]);
    for (const link of IMAGE_STUDIO_SD_COLLABORATION_LINKS) {
      expect(link.chatPrompt.length).toBeGreaterThan(0);
    }
  });
});
