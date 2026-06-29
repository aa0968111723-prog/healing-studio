import { test, expect } from "@playwright/test";
import {
  IMAGE_STUDIO_EDIT_MODELS,
  IMAGE_STUDIO_UPSCALE_MODELS,
  IMAGE_STUDIO_POSE_MODELS,
  IMAGE_STUDIO_SD_MODELS,
  VIDEO_STUDIO_I2V_MODELS,
  VIDEO_STUDIO_V2V_MODELS,
  VIDEO_STUDIO_ENHANCE_MODELS,
  VIDEO_STUDIO_CONTROL_MODELS,
  buildImageStudioEditSetModelActions,
  buildImageStudioEditSetStrengthActions,
  buildImageStudioEditSetOutputSizeActions,
  buildImageStudioUpscaleSetModelActions,
  buildImageStudioUpscaleSetFactorActions,
  buildImageStudioPoseSetModelActions,
  buildImageStudioPoseSetDrawModeActions,
  buildImageStudioSDSetModelActions,
  buildImageStudioSDFillPromptActions,
  buildImageStudioSDFillNegPromptActions,
  buildImageStudioSDSetLoraActions,
  buildVideoStudioI2VSetModelActions,
  buildVideoStudioI2VFillPromptActions,
  buildVideoStudioI2VSetParamActions,
  buildVideoStudioI2VSetImageActions,
  buildVideoStudioV2VSetModelActions,
  buildVideoStudioV2VSetParamActions,
  buildVideoStudioEnhanceSetModelActions,
  buildVideoStudioEnhanceSetParamActions,
  buildVideoStudioControlSetModelActions,
  buildVideoStudioControlSetCameraMotionActions,
  buildVideoStudioControlSetControlNetActions,
} from "../../shared/orb-studio-actions";

/**
 * 光球 → 各創作室「子分頁」AgentAction 契約護欄（AIDV-35 opt-cycle 延伸）。
 *
 * 既有護欄只覆蓋主流程分頁：image t2i（image-studio-generation-flow.spec）、
 * video t2v（video-studio-generation-flow.spec）、pro-studio（orb-pro-studio）。
 * 但光球其實能驅動更多「子分頁」——圖片創作室的 edit/upscale/pose/sd，影片
 * 工作室的 i2v/v2v/enhance/control——這些 AgentAction 建構器目前「零測試」，
 * 一旦有人改了 tabId、action 形狀或模型集合而沒同步，光球會悄悄送出對不上
 * UI 的動作（切錯分頁／設不存在的模型），使用者端表現為「光球說做了卻沒反應」。
 *
 * 本檔是純邏輯 A 軸（不需 server/login/provider/browser，CI 與本機都能跑綠）：
 * 對每個子分頁鎖兩件事——
 *   (1) 動作序列「先切到正確子分頁(setTab tabId)再做事」，且關鍵動作形狀正確；
 *   (2) 模型集合 union 鎖定（防 shared/ 與各 *Studio.tsx 渲染清單漂移）。
 *
 * 形狀以對真實建構器實跑的結果為準（非臆測）。
 */

const ids = (arr: ReadonlyArray<{ id: string }>) => arr.map((m) => m.id).sort();

// ─── 圖片創作室子分頁 ───────────────────────────────────────────────

test.describe("圖片創作室子分頁 — AgentAction 契約", () => {
  test("edit：setModel / strength / outputSize 都先切 edit 分頁", () => {
    const setModel = buildImageStudioEditSetModelActions(
      IMAGE_STUDIO_EDIT_MODELS[0].id,
    );
    expect(setModel[0]).toEqual({ type: "setTab", tabId: "edit" });
    expect(setModel[1]).toEqual({
      type: "setModel",
      modelId: IMAGE_STUDIO_EDIT_MODELS[0].id,
    });

    const strength = buildImageStudioEditSetStrengthActions(0.5);
    expect(strength[0]).toEqual({ type: "setTab", tabId: "edit" });
    expect(strength[1]).toEqual({
      type: "setParam",
      key: "strength",
      value: 0.5,
    });

    const outSize = buildImageStudioEditSetOutputSizeActions(1024, 768);
    expect(outSize[0]).toEqual({ type: "setTab", tabId: "edit" });
    expect(outSize.some((a) => a.type === "setParam")).toBe(true);
  });

  test("edit：模型 union 鎖定", () => {
    expect(ids(IMAGE_STUDIO_EDIT_MODELS)).toEqual([
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

  test("upscale：setModel + factor（先切 upscale 分頁；factor 連帶設 mode）", () => {
    const setModel = buildImageStudioUpscaleSetModelActions(
      IMAGE_STUDIO_UPSCALE_MODELS[0].id,
    );
    expect(setModel[0]).toEqual({ type: "setTab", tabId: "upscale" });
    expect(setModel[1]).toMatchObject({ type: "setModel" });

    const factor = buildImageStudioUpscaleSetFactorActions(2);
    expect(factor[0]).toEqual({ type: "setTab", tabId: "upscale" });
    expect(factor).toContainEqual({
      type: "setParam",
      key: "upscaleFactor",
      value: 2,
    });

    expect(ids(IMAGE_STUDIO_UPSCALE_MODELS)).toEqual(["seedVRUpscale"]);
  });

  test("pose：setModel + drawMode 都先切 pose 分頁", () => {
    const setModel = buildImageStudioPoseSetModelActions(
      IMAGE_STUDIO_POSE_MODELS[0].id,
    );
    expect(setModel[0]).toEqual({ type: "setTab", tabId: "pose" });

    const draw = buildImageStudioPoseSetDrawModeActions("openpose");
    expect(draw[0]).toEqual({ type: "setTab", tabId: "pose" });
    expect(draw).toContainEqual({
      type: "setParam",
      key: "drawMode",
      value: "openpose",
    });

    expect(ids(IMAGE_STUDIO_POSE_MODELS)).toEqual(["dwPose"]);
  });

  test("sd：setModel / fillPrompt / 負向提示 / LoRA 都先切 sd 分頁", () => {
    const setModel = buildImageStudioSDSetModelActions(
      IMAGE_STUDIO_SD_MODELS[0].id,
    );
    expect(setModel[0]).toEqual({ type: "setTab", tabId: "sd" });

    const fill = buildImageStudioSDFillPromptActions("a fox");
    expect(fill[0]).toEqual({ type: "setTab", tabId: "sd" });
    expect(fill[1]).toMatchObject({
      type: "fillPrompt",
      text: "a fox",
      append: false,
    });

    // 負向提示詞用 fillPrompt 但帶 slot:"negativePrompt"（不可誤填到主提示）
    const neg = buildImageStudioSDFillNegPromptActions("blurry");
    expect(neg[0]).toEqual({ type: "setTab", tabId: "sd" });
    expect(neg[1]).toMatchObject({
      type: "fillPrompt",
      text: "blurry",
      slot: "negativePrompt",
    });

    // LoRA 連帶設 path + scale 兩個參數
    const lora = buildImageStudioSDSetLoraActions("lora-1", 0.8);
    expect(lora[0]).toEqual({ type: "setTab", tabId: "sd" });
    expect(lora).toContainEqual({
      type: "setParam",
      key: "loraScale",
      value: 0.8,
    });

    expect(ids(IMAGE_STUDIO_SD_MODELS)).toEqual([
      "fastSdxl",
      "sdLora",
      "stableDiffusion35",
    ]);
  });
});

// ─── 影片工作室子分頁 ───────────────────────────────────────────────

test.describe("影片工作室子分頁 — AgentAction 契約", () => {
  test("i2v：setModel / fillPrompt / setParam / setImage 都先切 i2v 分頁", () => {
    const setModel = buildVideoStudioI2VSetModelActions(
      VIDEO_STUDIO_I2V_MODELS[0].id,
    );
    expect(setModel[0]).toEqual({ type: "setTab", tabId: "i2v" });
    expect(setModel[1]).toMatchObject({ type: "setModel" });

    const fill = buildVideoStudioI2VFillPromptActions("a calm sea");
    expect(fill[0]).toEqual({ type: "setTab", tabId: "i2v" });
    expect(fill[1]).toMatchObject({
      type: "fillPrompt",
      text: "a calm sea",
      append: false,
    });

    const param = buildVideoStudioI2VSetParamActions("duration", "5");
    expect(param[0]).toEqual({ type: "setTab", tabId: "i2v" });
    expect(param[1]).toEqual({
      type: "setParam",
      key: "duration",
      value: "5",
    });

    // i2v 的核心：把來源圖塞進 imageUrl 參數
    const img = buildVideoStudioI2VSetImageActions("http://x/a.png");
    expect(img[0]).toEqual({ type: "setTab", tabId: "i2v" });
    expect(img).toContainEqual({
      type: "setParam",
      key: "imageUrl",
      value: "http://x/a.png",
    });

    expect(ids(VIDEO_STUDIO_I2V_MODELS)).toEqual([
      "kling-i2v",
      "minimax-i2v",
      "pixverse-i2v",
      "runway-i2v",
      "wan-i2v",
    ]);
  });

  test("v2v：setModel / setParam 都先切 v2v 分頁 + 模型 union", () => {
    const setModel = buildVideoStudioV2VSetModelActions(
      VIDEO_STUDIO_V2V_MODELS[0].id,
    );
    expect(setModel[0]).toEqual({ type: "setTab", tabId: "v2v" });

    const param = buildVideoStudioV2VSetParamActions("strength", 0.6);
    expect(param[0]).toEqual({ type: "setTab", tabId: "v2v" });
    expect(param).toContainEqual({
      type: "setParam",
      key: "strength",
      value: 0.6,
    });

    expect(ids(VIDEO_STUDIO_V2V_MODELS)).toEqual([
      "kling-v2v",
      "ltx-v2v",
      "wan-v2v",
    ]);
  });

  test("enhance：setModel / setParam 都先切 enhance 分頁 + 模型 union", () => {
    const setModel = buildVideoStudioEnhanceSetModelActions(
      VIDEO_STUDIO_ENHANCE_MODELS[0].id,
    );
    expect(setModel[0]).toEqual({ type: "setTab", tabId: "enhance" });

    const param = buildVideoStudioEnhanceSetParamActions("scale", 2);
    expect(param[0]).toEqual({ type: "setTab", tabId: "enhance" });
    expect(param).toContainEqual({ type: "setParam", key: "scale", value: 2 });

    expect(ids(VIDEO_STUDIO_ENHANCE_MODELS)).toEqual([
      "frame-interp",
      "topaz-enhance",
      "video-upscale",
    ]);
  });

  test("control：setModel / cameraMotion / controlNet 都先切 control 分頁", () => {
    const setModel = buildVideoStudioControlSetModelActions(
      VIDEO_STUDIO_CONTROL_MODELS[0].id,
    );
    expect(setModel[0]).toEqual({ type: "setTab", tabId: "control" });

    // cameraMotion / controlNet 會連帶選對應模型，故只鎖「先切 control 分頁」
    // 與「帶到正確的 setParam」，不過度綁定自動選模（那合理會變）。
    const cam = buildVideoStudioControlSetCameraMotionActions("zoom-in");
    expect(cam[0]).toEqual({ type: "setTab", tabId: "control" });
    expect(cam).toContainEqual({
      type: "setParam",
      key: "cameraMotion",
      value: "zoom-in",
    });

    const cn = buildVideoStudioControlSetControlNetActions("depth");
    expect(cn[0]).toEqual({ type: "setTab", tabId: "control" });
    expect(cn).toContainEqual({
      type: "setParam",
      key: "controlNet",
      value: "depth",
    });

    expect(ids(VIDEO_STUDIO_CONTROL_MODELS)).toEqual([
      "animate-diff",
      "cam-master",
      "depth-crafter",
      "vidu-ref",
    ]);
  });
});
