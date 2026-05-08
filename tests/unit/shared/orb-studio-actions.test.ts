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
  VIDEO_STUDIO_T2V_PROFILE,
  VIDEO_STUDIO_T2V_MODELS,
  VIDEO_STUDIO_T2V_TEMPLATES,
  VIDEO_STUDIO_T2V_DURATIONS,
  VIDEO_STUDIO_T2V_ASPECTS,
  VIDEO_STUDIO_T2V_RESOLUTIONS,
  VIDEO_STUDIO_T2V_COLLABORATION_LINKS,
  VIDEO_STUDIO_T2V_CAPABILITY_LABELS,
  buildVideoStudioT2VSetModelActions,
  buildVideoStudioT2VFillPromptActions,
  buildVideoStudioT2VApplyTemplateActions,
  buildVideoStudioT2VSetParamActions,
  VIDEO_STUDIO_I2V_PROFILE,
  VIDEO_STUDIO_I2V_MODELS,
  VIDEO_STUDIO_I2V_TEMPLATES,
  VIDEO_STUDIO_I2V_DURATIONS,
  VIDEO_STUDIO_I2V_RESOLUTIONS,
  VIDEO_STUDIO_I2V_ASPECTS,
  VIDEO_STUDIO_I2V_COLLABORATION_LINKS,
  VIDEO_STUDIO_I2V_CAPABILITY_LABELS,
  buildVideoStudioI2VSetModelActions,
  buildVideoStudioI2VApplyTemplateActions,
  buildVideoStudioI2VSetParamActions,
  buildVideoStudioI2VSetImageActions,
  VIDEO_STUDIO_V2V_PROFILE,
  VIDEO_STUDIO_V2V_MODELS,
  VIDEO_STUDIO_V2V_TEMPLATES,
  VIDEO_STUDIO_V2V_STRENGTH_PRESETS,
  VIDEO_STUDIO_V2V_CFG_PRESETS,
  VIDEO_STUDIO_V2V_COLLABORATION_LINKS,
  VIDEO_STUDIO_V2V_CAPABILITY_LABELS,
  buildVideoStudioV2VSetModelActions,
  buildVideoStudioV2VApplyTemplateActions,
  buildVideoStudioV2VSetParamActions,
  VIDEO_STUDIO_ENHANCE_PROFILE,
  VIDEO_STUDIO_ENHANCE_MODELS,
  VIDEO_STUDIO_ENHANCE_UPSCALE_FACTORS,
  VIDEO_STUDIO_ENHANCE_RIFE_MULTIPLIERS,
  VIDEO_STUDIO_ENHANCE_RIFE_FPS,
  VIDEO_STUDIO_ENHANCE_TOPAZ_MODELS,
  VIDEO_STUDIO_ENHANCE_TOPAZ_SCALES,
  VIDEO_STUDIO_ENHANCE_COLLABORATION_LINKS,
  VIDEO_STUDIO_ENHANCE_CAPABILITY_LABELS,
  buildVideoStudioEnhanceSetModelActions,
  buildVideoStudioEnhanceSetParamActions,
  VIDEO_STUDIO_CONTROL_PROFILE,
  VIDEO_STUDIO_CONTROL_MODELS,
  VIDEO_STUDIO_CONTROL_CAMERA_MOTIONS,
  VIDEO_STUDIO_CONTROL_CONTROLNETS,
  VIDEO_STUDIO_CONTROL_TEMPLATES,
  VIDEO_STUDIO_CONTROL_COLLABORATION_LINKS,
  VIDEO_STUDIO_CONTROL_CAPABILITY_LABELS,
  buildVideoStudioControlSetModelActions,
  buildVideoStudioControlApplyTemplateActions,
  buildVideoStudioControlSetCameraMotionActions,
  buildVideoStudioControlSetControlNetActions,
  buildVideoStudioControlSetParamActions,
  PRO_STUDIO_MUSIC_PROFILE,
  PRO_STUDIO_MUSIC_MODELS,
  PRO_STUDIO_MUSIC_TEMPLATES,
  PRO_STUDIO_MUSIC_DURATIONS,
  PRO_STUDIO_MUSIC_COLLABORATION_LINKS,
  PRO_STUDIO_SFX_PROFILE,
  PRO_STUDIO_SFX_MODELS,
  PRO_STUDIO_SFX_TEMPLATES,
  PRO_STUDIO_SFX_DURATIONS,
  PRO_STUDIO_TTS_PROFILE,
  PRO_STUDIO_TTS_MODELS,
  PRO_STUDIO_TTS_TEMPLATES,
  PRO_STUDIO_TTS_SPEED_PRESETS,
  PRO_STUDIO_TTS_STABILITY_PRESETS,
  PRO_STUDIO_CLONE_PROFILE,
  PRO_STUDIO_CLONE_MODELS,
  PRO_STUDIO_CLONE_TEMPLATES,
  PRO_STUDIO_PROCESS_PROFILE,
  PRO_STUDIO_PROCESS_MODELS,
  PRO_STUDIO_PROCESS_DEMUCS_MODELS,
  PRO_STUDIO_PROCESS_MERGE_STRATEGIES,
  PRO_STUDIO_ASR_PROFILE,
  PRO_STUDIO_ASR_MODELS,
  PRO_STUDIO_ASR_ACCELERATIONS,
  PRO_STUDIO_AVATAR_PROFILE,
  PRO_STUDIO_AVATAR_MODELS,
  PRO_STUDIO_AVATAR_DUBBING_LANGS,
  buildProStudioSetModelActions,
  buildProStudioFillPromptActions,
  buildProStudioSetParamActions,
  buildProStudioApplyTemplateActions,
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

describe("orb-studio-actions: video studio T2V profile", () => {
  it("profile points at /video-studio t2v with the 6 T2V models", () => {
    expect(VIDEO_STUDIO_T2V_PROFILE.pageId).toBe("video-studio");
    expect(VIDEO_STUDIO_T2V_PROFILE.activeTab).toBe("t2v");
    expect(VIDEO_STUDIO_T2V_MODELS.map(m => m.id).sort()).toEqual([
      "kling-t2v",
      "ltx-t2v",
      "minimax-t2v",
      "sora-t2v",
      "veo3-t2v",
      "wan-t2v",
    ]);
  });

  it("each T2V model declares only known capabilities and they have a label", () => {
    const allowed = new Set([
      "neg",
      "cfg",
      "resolution",
      "numFrames",
      "promptOptimizer",
      "generateAudio",
    ]);
    for (const m of VIDEO_STUDIO_T2V_MODELS) {
      for (const cap of m.capabilities) {
        expect(allowed.has(cap)).toBe(true);
        expect(VIDEO_STUDIO_T2V_CAPABILITY_LABELS[cap]).toBeTruthy();
      }
    }
  });

  it("T2V actions all start by switching to t2v tab", () => {
    expect(buildVideoStudioT2VSetModelActions("kling-t2v")[0]).toEqual({
      type: "setTab",
      tabId: "t2v",
    });
    expect(buildVideoStudioT2VFillPromptActions("hello")[0]).toEqual({
      type: "setTab",
      tabId: "t2v",
    });
    expect(buildVideoStudioT2VSetParamActions("duration", "10")[0]).toEqual({
      type: "setTab",
      tabId: "t2v",
    });
  });

  it("template apply also sets the suggested model and (when present) fills neg slot", () => {
    const tplWithNeg = VIDEO_STUDIO_T2V_TEMPLATES.find(t => !!t.negPrompt && !!t.suggestedModelId);
    expect(tplWithNeg).toBeTruthy();
    if (!tplWithNeg) return;
    const actions = buildVideoStudioT2VApplyTemplateActions(tplWithNeg);
    expect(actions[0]).toEqual({ type: "setTab", tabId: "t2v" });
    expect(actions[1]).toEqual({ type: "setModel", modelId: tplWithNeg.suggestedModelId });
    expect(actions[2]).toMatchObject({
      type: "fillPrompt",
      text: tplWithNeg.prompt,
      append: false,
    });
    expect(actions[3]).toMatchObject({
      type: "fillPrompt",
      slot: "negativePrompt",
      text: tplWithNeg.negPrompt,
    });
  });

  it("durations / aspects / resolutions match VideoStudio.tsx accepted values", () => {
    expect(VIDEO_STUDIO_T2V_DURATIONS.map(d => d.value)).toEqual(["5", "10"]);
    const aspectValues = new Set(VIDEO_STUDIO_T2V_ASPECTS.map(a => a.value));
    expect(aspectValues).toEqual(new Set(["1:1", "16:9", "9:16"]));
    expect(VIDEO_STUDIO_T2V_RESOLUTIONS.map(r => r.value)).toEqual([
      "480p",
      "720p",
      "1080p",
    ]);
  });

  it("T2V collaboration links cover 4 cross-handoffs", () => {
    const ids = VIDEO_STUDIO_T2V_COLLABORATION_LINKS.map(l => l.id).sort();
    expect(ids).toEqual([
      "t2v-director-storyboard",
      "t2v-handoff-i2v",
      "t2v-prompt-coach",
      "t2v-recommend-model",
    ]);
    for (const link of VIDEO_STUDIO_T2V_COLLABORATION_LINKS) {
      expect(link.chatPrompt.length).toBeGreaterThan(0);
    }
  });
});

describe("orb-studio-actions: video studio I2V profile", () => {
  it("profile points at /video-studio i2v with the 5 I2V models", () => {
    expect(VIDEO_STUDIO_I2V_PROFILE.pageId).toBe("video-studio");
    expect(VIDEO_STUDIO_I2V_PROFILE.activeTab).toBe("i2v");
    expect(VIDEO_STUDIO_I2V_MODELS.map(m => m.id).sort()).toEqual([
      "kling-i2v",
      "minimax-i2v",
      "pixverse-i2v",
      "runway-i2v",
      "wan-i2v",
    ]);
  });

  it("only Kling i2v advertises tail-frame support (matches VideoStudio.tsx)", () => {
    const kling = VIDEO_STUDIO_I2V_MODELS.find(m => m.id === "kling-i2v");
    expect(kling?.capabilities).toContain("tail");
    const others = VIDEO_STUDIO_I2V_MODELS.filter(m => m.id !== "kling-i2v");
    for (const m of others) {
      expect(m.capabilities).not.toContain("tail");
    }
  });

  it("each I2V model declares only known capabilities and they have a label", () => {
    const allowed = new Set(["tail", "duration", "resolution", "aspect", "promptOptimizer"]);
    for (const m of VIDEO_STUDIO_I2V_MODELS) {
      for (const cap of m.capabilities) {
        expect(allowed.has(cap)).toBe(true);
        expect(VIDEO_STUDIO_I2V_CAPABILITY_LABELS[cap]).toBeTruthy();
      }
    }
  });

  it("I2V actions all start by switching to i2v tab", () => {
    expect(buildVideoStudioI2VSetModelActions("kling-i2v")[0]).toEqual({
      type: "setTab",
      tabId: "i2v",
    });
    expect(buildVideoStudioI2VSetParamActions("duration", "5")[0]).toEqual({
      type: "setTab",
      tabId: "i2v",
    });
  });

  it("setImage emits imageUrl and optionally tailImageUrl", () => {
    const single = buildVideoStudioI2VSetImageActions("https://x/a.png");
    expect(single).toHaveLength(2);
    expect(single[1]).toEqual({ type: "setParam", key: "imageUrl", value: "https://x/a.png" });
    const both = buildVideoStudioI2VSetImageActions("https://x/a.png", "https://x/b.png");
    expect(both).toHaveLength(3);
    expect(both[2]).toEqual({
      type: "setParam",
      key: "tailImageUrl",
      value: "https://x/b.png",
    });
  });

  it("apply template uses suggested model and skips neg slot (i2v has no neg)", () => {
    const tpl = VIDEO_STUDIO_I2V_TEMPLATES[0];
    const actions = buildVideoStudioI2VApplyTemplateActions(tpl);
    expect(actions[0]).toEqual({ type: "setTab", tabId: "i2v" });
    if (tpl.suggestedModelId) {
      expect(actions[1]).toEqual({ type: "setModel", modelId: tpl.suggestedModelId });
    }
    const lastAction = actions[actions.length - 1];
    expect(lastAction).toMatchObject({ type: "fillPrompt", text: tpl.prompt });
    // i2v 模板沒有 negPrompt 槽位，因此不該有 negativePrompt 的 fillPrompt
    for (const a of actions) {
      if (a.type === "fillPrompt") {
        expect(a.slot).toBeUndefined();
      }
    }
  });

  it("durations / resolutions / aspects match VideoStudio.tsx i2v accepted values", () => {
    const durationValues = new Set(VIDEO_STUDIO_I2V_DURATIONS.map(d => d.value));
    expect(durationValues).toEqual(new Set(["4", "5", "8", "10"]));
    const resolutions = VIDEO_STUDIO_I2V_RESOLUTIONS.map(r => r.value);
    expect(resolutions).toContain("360p");
    expect(resolutions).toContain("1080p");
    const aspectValues = new Set(VIDEO_STUDIO_I2V_ASPECTS.map(a => a.value));
    expect(aspectValues).toEqual(new Set(["1:1", "16:9", "9:16"]));
  });

  it("I2V collaboration links cover 4 cross-handoffs", () => {
    const ids = VIDEO_STUDIO_I2V_COLLABORATION_LINKS.map(l => l.id).sort();
    expect(ids).toEqual([
      "i2v-director-sequence",
      "i2v-from-image-studio",
      "i2v-prompt-coach",
      "i2v-recommend-model",
    ]);
    for (const link of VIDEO_STUDIO_I2V_COLLABORATION_LINKS) {
      expect(link.chatPrompt.length).toBeGreaterThan(0);
    }
  });
});

describe("orb-studio-actions: video studio V2V profile", () => {
  it("profile points at /video-studio v2v with the 3 V2V models", () => {
    expect(VIDEO_STUDIO_V2V_PROFILE.activeTab).toBe("v2v");
    expect(VIDEO_STUDIO_V2V_MODELS.map(m => m.id).sort()).toEqual([
      "kling-v2v",
      "ltx-v2v",
      "wan-v2v",
    ]);
  });

  it("each V2V model declares only known capabilities", () => {
    const allowed = new Set([
      "strength",
      "cfg",
      "neg",
      "imageInput",
      "frames",
      "guidance",
    ]);
    for (const m of VIDEO_STUDIO_V2V_MODELS) {
      for (const cap of m.capabilities) {
        expect(allowed.has(cap)).toBe(true);
        expect(VIDEO_STUDIO_V2V_CAPABILITY_LABELS[cap]).toBeTruthy();
      }
    }
  });

  it("only ltx-v2v advertises imageInput (matches VideoStudio.tsx routing)", () => {
    const ltx = VIDEO_STUDIO_V2V_MODELS.find(m => m.id === "ltx-v2v");
    expect(ltx?.capabilities).toContain("imageInput");
    const others = VIDEO_STUDIO_V2V_MODELS.filter(m => m.id !== "ltx-v2v");
    for (const m of others) {
      expect(m.capabilities).not.toContain("imageInput");
    }
  });

  it("V2V actions all start by switching to v2v tab", () => {
    expect(buildVideoStudioV2VSetModelActions("wan-v2v")[0]).toEqual({
      type: "setTab",
      tabId: "v2v",
    });
    expect(buildVideoStudioV2VSetParamActions("strength", 0.5)[0]).toEqual({
      type: "setTab",
      tabId: "v2v",
    });
  });

  it("strength presets stay within 0..1 and CFG presets within 0..1", () => {
    for (const p of VIDEO_STUDIO_V2V_STRENGTH_PRESETS) {
      expect(p.value).toBeGreaterThanOrEqual(0);
      expect(p.value).toBeLessThanOrEqual(1);
    }
    for (const p of VIDEO_STUDIO_V2V_CFG_PRESETS) {
      expect(p.value).toBeGreaterThanOrEqual(0);
      expect(p.value).toBeLessThanOrEqual(1);
    }
  });

  it("template apply uses suggested model, fills prompt and (when present) negPrompt slot", () => {
    const tpl = VIDEO_STUDIO_V2V_TEMPLATES.find(t => !!t.negPrompt);
    expect(tpl).toBeTruthy();
    if (!tpl) return;
    const actions = buildVideoStudioV2VApplyTemplateActions(tpl);
    expect(actions[0]).toEqual({ type: "setTab", tabId: "v2v" });
    if (tpl.suggestedModelId) {
      expect(actions[1]).toEqual({ type: "setModel", modelId: tpl.suggestedModelId });
    }
    expect(actions[actions.length - 1]).toMatchObject({
      type: "fillPrompt",
      slot: "negativePrompt",
      text: tpl.negPrompt,
    });
  });

  it("V2V collaboration links cover 4 cross-handoffs", () => {
    const ids = VIDEO_STUDIO_V2V_COLLABORATION_LINKS.map(l => l.id).sort();
    expect(ids).toEqual([
      "v2v-after-i2v",
      "v2v-director-batch",
      "v2v-prompt-coach",
      "v2v-recommend-model",
    ]);
  });
});

describe("orb-studio-actions: video studio Enhance profile", () => {
  it("profile points at /video-studio enhance with the 3 enhance tools", () => {
    expect(VIDEO_STUDIO_ENHANCE_PROFILE.activeTab).toBe("enhance");
    expect(VIDEO_STUDIO_ENHANCE_MODELS.map(m => m.id).sort()).toEqual([
      "frame-interp",
      "topaz-enhance",
      "video-upscale",
    ]);
  });

  it("each enhance tool declares only known capabilities", () => {
    const allowed = new Set(["upscale", "frameInterp", "topazModel", "outputScale"]);
    for (const m of VIDEO_STUDIO_ENHANCE_MODELS) {
      for (const cap of m.capabilities) {
        expect(allowed.has(cap)).toBe(true);
        expect(VIDEO_STUDIO_ENHANCE_CAPABILITY_LABELS[cap]).toBeTruthy();
      }
    }
  });

  it("upscale factors and RIFE multipliers use string values matching VideoStudio.tsx", () => {
    expect(VIDEO_STUDIO_ENHANCE_UPSCALE_FACTORS.map(f => f.value).sort()).toEqual([
      "2",
      "4",
    ]);
    expect(VIDEO_STUDIO_ENHANCE_RIFE_MULTIPLIERS.map(m => m.value).sort()).toEqual([
      "2",
      "4",
    ]);
  });

  it("RIFE fps presets stay within 24..120", () => {
    for (const f of VIDEO_STUDIO_ENHANCE_RIFE_FPS) {
      expect(f.value).toBeGreaterThanOrEqual(24);
      expect(f.value).toBeLessThanOrEqual(120);
    }
  });

  it("Topaz model ids match VideoStudio.tsx allow-list (iris/artemis/theia/gaia/nyx)", () => {
    const ids = VIDEO_STUDIO_ENHANCE_TOPAZ_MODELS.map(m => m.id).sort();
    expect(ids).toEqual(["artemis", "gaia", "iris", "nyx", "theia"]);
  });

  it("Topaz output scales are numeric 1/2/4", () => {
    expect(VIDEO_STUDIO_ENHANCE_TOPAZ_SCALES.map(s => s.value).sort((a, b) => a - b)).toEqual([
      1,
      2,
      4,
    ]);
  });

  it("enhance actions all start by switching to enhance tab", () => {
    expect(buildVideoStudioEnhanceSetModelActions("video-upscale")[0]).toEqual({
      type: "setTab",
      tabId: "enhance",
    });
    expect(buildVideoStudioEnhanceSetParamActions("upscaleFactor", "4")[0]).toEqual({
      type: "setTab",
      tabId: "enhance",
    });
  });

  it("enhance collaboration links cover 4 expected ids", () => {
    const ids = VIDEO_STUDIO_ENHANCE_COLLABORATION_LINKS.map(l => l.id).sort();
    expect(ids).toEqual([
      "enhance-director-batch",
      "enhance-from-history",
      "enhance-pipeline",
      "enhance-recommend-tool",
    ]);
  });
});

describe("orb-studio-actions: video studio Control profile", () => {
  it("profile points at /video-studio control with 4 tools", () => {
    expect(VIDEO_STUDIO_CONTROL_PROFILE.activeTab).toBe("control");
    expect(VIDEO_STUDIO_CONTROL_MODELS.map(m => m.id).sort()).toEqual([
      "animate-diff",
      "cam-master",
      "depth-crafter",
      "vidu-ref",
    ]);
  });

  it("each control tool declares only known capabilities", () => {
    const allowed = new Set([
      "cameraMotion",
      "controlNet",
      "guidance",
      "neg",
      "imageInput",
      "videoInput",
      "multiRef",
    ]);
    for (const m of VIDEO_STUDIO_CONTROL_MODELS) {
      for (const cap of m.capabilities) {
        expect(allowed.has(cap)).toBe(true);
        expect(VIDEO_STUDIO_CONTROL_CAPABILITY_LABELS[cap]).toBeTruthy();
      }
    }
  });

  it("camera motions cover the 17 values in VideoStudio.tsx CAMERA_MOTIONS", () => {
    const ids = new Set(VIDEO_STUDIO_CONTROL_CAMERA_MOTIONS.map(c => c.id));
    expect(ids).toEqual(
      new Set([
        "static",
        "push_in",
        "pull_out",
        "pan_left",
        "pan_right",
        "tilt_up",
        "tilt_down",
        "orbit_left",
        "orbit_right",
        "crane_up",
        "crane_down",
        "roll_clockwise",
        "roll_counterclockwise",
        "move_left",
        "move_right",
        "move_up",
        "move_down",
      ])
    );
  });

  it("ControlNet conditions are exactly openpose/canny/depth/none", () => {
    const ids = VIDEO_STUDIO_CONTROL_CONTROLNETS.map(c => c.id).sort();
    expect(ids).toEqual(["canny", "depth", "none", "openpose"]);
  });

  it("setCameraMotion forces selecting cam-master before applying motion", () => {
    const actions = buildVideoStudioControlSetCameraMotionActions("orbit_left");
    expect(actions).toEqual([
      { type: "setTab", tabId: "control" },
      { type: "setModel", modelId: "cam-master" },
      { type: "setParam", key: "cameraMotion", value: "orbit_left" },
    ]);
  });

  it("setControlNet forces selecting animate-diff before applying controlNet", () => {
    const actions = buildVideoStudioControlSetControlNetActions("openpose");
    expect(actions).toEqual([
      { type: "setTab", tabId: "control" },
      { type: "setModel", modelId: "animate-diff" },
      { type: "setParam", key: "controlNet", value: "openpose" },
    ]);
  });

  it("control template apply uses suggested model and optional neg slot", () => {
    const tpl = VIDEO_STUDIO_CONTROL_TEMPLATES.find(t => !!t.negPrompt);
    expect(tpl).toBeTruthy();
    if (!tpl) return;
    const actions = buildVideoStudioControlApplyTemplateActions(tpl);
    expect(actions[0]).toEqual({ type: "setTab", tabId: "control" });
    expect(actions[actions.length - 1]).toMatchObject({
      type: "fillPrompt",
      slot: "negativePrompt",
      text: tpl.negPrompt,
    });
  });

  it("generic setParam still works for guidanceScale / negativePrompt", () => {
    expect(buildVideoStudioControlSetParamActions("guidanceScale", 7.5)[1]).toEqual({
      type: "setParam",
      key: "guidanceScale",
      value: 7.5,
    });
  });

  it("control setModel lands on control tab with chosen model", () => {
    const actions = buildVideoStudioControlSetModelActions("vidu-ref");
    expect(actions).toEqual([
      { type: "setTab", tabId: "control" },
      { type: "setModel", modelId: "vidu-ref" },
    ]);
  });

  it("control collaboration links cover 4 expected ids", () => {
    const ids = VIDEO_STUDIO_CONTROL_COLLABORATION_LINKS.map(l => l.id).sort();
    expect(ids).toEqual([
      "control-director-storyboard",
      "control-from-image-studio",
      "control-from-pose",
      "control-recommend-tool",
    ]);
  });
});

describe("orb-studio-actions: pro studio common builders", () => {
  it("setTab actions land on the requested ProStudio tab", () => {
    expect(buildProStudioSetModelActions("music", "sonauto")[0]).toEqual({
      type: "setTab",
      tabId: "music",
    });
    expect(buildProStudioFillPromptActions("tts", "hello")[0]).toEqual({
      type: "setTab",
      tabId: "tts",
    });
    expect(buildProStudioSetParamActions("clone", "mode", "design")[0]).toEqual({
      type: "setTab",
      tabId: "clone",
    });
  });

  it("apply template emits setTab → setModel → fillPrompt → setParam in order", () => {
    const tpl = PRO_STUDIO_MUSIC_TEMPLATES[0];
    const actions = buildProStudioApplyTemplateActions("music", tpl);
    expect(actions[0]).toEqual({ type: "setTab", tabId: "music" });
    expect(actions[1]).toEqual({ type: "setModel", modelId: tpl.suggestedModelId });
    expect(actions[2]).toMatchObject({ type: "fillPrompt", text: tpl.prompt });
    // params 在 fillPrompt 之後依序加入
    if (tpl.params) {
      for (let i = 0; i < tpl.params.length; i++) {
        const a = actions[3 + i];
        expect(a).toEqual({ type: "setParam", key: tpl.params[i].key, value: tpl.params[i].value });
      }
    }
  });

  it("apply template skips setModel when template has no suggestedModelId", () => {
    const tpl = { id: "x", label: "x", emoji: "x", prompt: "x" };
    const actions = buildProStudioApplyTemplateActions("music", tpl);
    expect(actions).toHaveLength(2);
    expect(actions[0]).toEqual({ type: "setTab", tabId: "music" });
    expect(actions[1]).toMatchObject({ type: "fillPrompt", text: "x" });
  });
});

describe("orb-studio-actions: pro studio Music profile", () => {
  it("profile points at /pro-studio music with 4 music models", () => {
    expect(PRO_STUDIO_MUSIC_PROFILE.activeTab).toBe("music");
    expect(PRO_STUDIO_MUSIC_MODELS.map(m => m.id).sort()).toEqual([
      "ace-step",
      "musicgen",
      "sonauto",
      "stable-audio",
    ]);
  });

  it("durations stay positive and templates each carry a non-empty prompt", () => {
    for (const d of PRO_STUDIO_MUSIC_DURATIONS) {
      expect(d.value).toBeGreaterThan(0);
    }
    for (const tpl of PRO_STUDIO_MUSIC_TEMPLATES) {
      expect(tpl.prompt.length).toBeGreaterThan(0);
    }
  });

  it("only sonauto template has instrumental=false (含人聲)", () => {
    const vocalTpl = PRO_STUDIO_MUSIC_TEMPLATES.find(t =>
      t.params?.some(p => p.key === "instrumental" && p.value === false)
    );
    expect(vocalTpl?.suggestedModelId).toBe("sonauto");
  });

  it("collaboration links cover 4 expected ids", () => {
    const ids = PRO_STUDIO_MUSIC_COLLABORATION_LINKS.map(l => l.id).sort();
    expect(ids).toEqual([
      "music-director-score",
      "music-handoff-sfx",
      "music-prompt-coach",
      "music-recommend-model",
    ]);
  });
});

describe("orb-studio-actions: pro studio SFX profile", () => {
  it("profile has 1 model and 6 templates with duration_seconds params", () => {
    expect(PRO_STUDIO_SFX_PROFILE.activeTab).toBe("sfx");
    expect(PRO_STUDIO_SFX_MODELS.map(m => m.id)).toEqual(["sfx"]);
    expect(PRO_STUDIO_SFX_TEMPLATES.length).toBeGreaterThanOrEqual(6);
    for (const tpl of PRO_STUDIO_SFX_TEMPLATES) {
      expect(tpl.params?.some(p => p.key === "duration_seconds")).toBe(true);
    }
  });

  it("durations stay within ElevenLabs SFX 22-second cap", () => {
    for (const d of PRO_STUDIO_SFX_DURATIONS) {
      expect(d.value).toBeLessThanOrEqual(22);
      expect(d.value).toBeGreaterThan(0);
    }
  });
});

describe("orb-studio-actions: pro studio TTS profile", () => {
  it("profile has 2 engines (Eleven + Qwen)", () => {
    expect(PRO_STUDIO_TTS_PROFILE.activeTab).toBe("tts");
    expect(PRO_STUDIO_TTS_MODELS.map(m => m.id).sort()).toEqual([
      "eleven-tts",
      "qwen-tts",
    ]);
  });

  it("speed and stability presets stay within sensible ranges", () => {
    for (const p of PRO_STUDIO_TTS_SPEED_PRESETS) {
      expect(p.value).toBeGreaterThan(0);
      expect(p.value).toBeLessThanOrEqual(2);
    }
    for (const p of PRO_STUDIO_TTS_STABILITY_PRESETS) {
      expect(p.value).toBeGreaterThanOrEqual(0);
      expect(p.value).toBeLessThanOrEqual(1);
    }
  });

  it("templates fan out across 5 Chinese scenarios", () => {
    expect(PRO_STUDIO_TTS_TEMPLATES.length).toBeGreaterThanOrEqual(5);
    for (const tpl of PRO_STUDIO_TTS_TEMPLATES) {
      expect(tpl.prompt.length).toBeGreaterThan(0);
    }
  });
});

describe("orb-studio-actions: pro studio Clone profile", () => {
  it("profile has 5 clone tools matching ProStudio.tsx PRO_MODELS clone subset", () => {
    expect(PRO_STUDIO_CLONE_PROFILE.activeTab).toBe("clone");
    expect(PRO_STUDIO_CLONE_MODELS.map(m => m.id).sort()).toEqual([
      "dia-clone",
      "eleven-ivc",
      "kling-voice",
      "qwen-clone",
      "voice-design",
    ]);
  });

  it("each template carries a mode param matching ProStudio.tsx AUDIO_PRESETS", () => {
    const allowedModes = new Set(["qwen", "dia", "elevenlabs", "design"]);
    for (const tpl of PRO_STUDIO_CLONE_TEMPLATES) {
      const mode = tpl.params?.find(p => p.key === "mode")?.value;
      expect(typeof mode).toBe("string");
      expect(allowedModes.has(mode as string)).toBe(true);
    }
  });
});

describe("orb-studio-actions: pro studio Process profile", () => {
  it("profile has 4 processing tools", () => {
    expect(PRO_STUDIO_PROCESS_PROFILE.activeTab).toBe("process");
    expect(PRO_STUDIO_PROCESS_MODELS.map(m => m.id).sort()).toEqual([
      "demucs",
      "iso",
      "merge",
      "voice-changer",
    ]);
  });

  it("Demucs sub-models are non-empty and merge strategies cover 3 options", () => {
    expect(PRO_STUDIO_PROCESS_DEMUCS_MODELS.length).toBeGreaterThan(0);
    expect(PRO_STUDIO_PROCESS_MERGE_STRATEGIES.map(s => s.id).sort()).toEqual([
      "concat",
      "crossfade",
      "overlay",
    ]);
  });
});

describe("orb-studio-actions: pro studio ASR profile", () => {
  it("profile has 1 ASR tool with 3 acceleration tiers", () => {
    expect(PRO_STUDIO_ASR_PROFILE.activeTab).toBe("asr");
    expect(PRO_STUDIO_ASR_MODELS.map(m => m.id)).toEqual(["asr"]);
    expect(PRO_STUDIO_ASR_ACCELERATIONS.map(a => a.id).sort()).toEqual([
      "high",
      "none",
      "regular",
    ]);
  });
});

describe("orb-studio-actions: pro studio Avatar profile", () => {
  it("profile has 6 avatar tools", () => {
    expect(PRO_STUDIO_AVATAR_PROFILE.activeTab).toBe("avatar");
    expect(PRO_STUDIO_AVATAR_MODELS.map(m => m.id).sort()).toEqual([
      "dubbing",
      "echo-mimic",
      "longcat",
      "ltx-a2v",
      "stable-avatar",
      "wan-s2v",
    ]);
  });

  it("dubbing langs cover at least the 7 common locales used in product", () => {
    const ids = new Set(PRO_STUDIO_AVATAR_DUBBING_LANGS.map(l => l.id));
    for (const expected of ["en", "zh", "ja", "ko", "es", "fr", "de"]) {
      expect(ids.has(expected)).toBe(true);
    }
  });
});
