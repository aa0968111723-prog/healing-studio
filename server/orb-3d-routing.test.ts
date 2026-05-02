/**
 * orb-3d-routing.test.ts
 *
 * 鎖定 orb 代理 studio.generate3D 工具的路由：5 個 3D 模型
 * (trellis-2 / sam-3/3d-objects / hunyuan3d-v3 / hyper3d/rodin /
 * hunyuan_world) 共用一個工具,executor 必須:
 *   1. 把 5 個模型各自的專屬欄位透傳到 fal.ai input
 *   2. 根據 image 是否存在自動選 image-to-3d / text-to-3d category
 *   3. HunYuan3D v3 用 input_image_url + 多視角；Rodin 純文字用 prompt
 *
 * 沒有這層鎖定,光球規劃出來的 3D 步驟會因 input 缺欄位而 422,
 * 或因 category 錯掉而觸發到錯的 fallback 池。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./services/falDispatcher", () => ({
  dispatchFalQueueTask: vi.fn(),
}));
vi.mock("./services/orbCostGuard", () => ({
  checkOrbCostBudget: vi.fn(async () => ({ ok: true })),
  enforceGenerationQuota: vi.fn(async () => ({ ok: true })),
}));
vi.mock("./services/falQueueAwaiter", () => ({
  awaitFalForOrb: vi.fn(async () => ({
    status: "completed",
    image_url: "https://cdn.fal.ai/out.glb",
  })),
}));
vi.mock("../shared/global-agent-tools", () => ({
  getGlobalAgentTool: () => ({
    name: "studio.generate3D",
    risk: "medium",
    requireHuman: false,
    description: "3D model generation",
  }),
  isKnownGlobalAgentTool: () => true,
}));

import { dispatchFalQueueTask } from "./services/falDispatcher";

async function dispatchStudio3D(args: Record<string, unknown>) {
  const mod = await import("./services/agentToolExecutor");
  process.env.ORB_TOOL_ALLOWED_ORIGINS = "https://example.com";
  return mod.executeOrbToolCalls({
    tools: [],
    calls: [{ name: "studio.generate3D", args }],
    userId: 1,
    userRole: "user",
    approved: true,
  });
}

describe("orb studio.generate3D routing", () => {
  beforeEach(() => {
    vi.mocked(dispatchFalQueueTask).mockReset();
    vi.mocked(dispatchFalQueueTask).mockResolvedValue({
      request_id: "req-3d-test",
      modelId: "fal-ai/trellis-2",
      degraded: false,
    } as any);
  });

  it("Trellis 2 (image-to-3d): resolution / texture_size / remesh / seed 透傳", async () => {
    await dispatchStudio3D({
      modelId: "fal-ai/trellis-2",
      image_url: "https://cdn.example.com/object.png",
      resolution: "1024",
      texture_size: "2048",
      remesh: true,
      seed: 42,
    });
    const call = vi.mocked(dispatchFalQueueTask).mock.calls[0]![0];
    expect(call.modelId).toBe("fal-ai/trellis-2");
    expect(call.category).toBe("image-to-3d");
    expect(call.input).toMatchObject({
      image_url: "https://cdn.example.com/object.png",
      resolution: "1024",
      texture_size: "2048",
      remesh: true,
      seed: 42,
    });
  });

  it("SAM 3D Objects: prompt + export_textured_glb + detection_threshold 透傳", async () => {
    await dispatchStudio3D({
      modelId: "fal-ai/sam-3/3d-objects",
      image_url: "https://cdn.example.com/scene.png",
      prompt: "cars",
      export_textured_glb: false,
      detection_threshold: 0.6,
    });
    const call = vi.mocked(dispatchFalQueueTask).mock.calls[0]![0];
    expect(call.modelId).toBe("fal-ai/sam-3/3d-objects");
    expect(call.category).toBe("image-to-3d");
    expect(call.input).toMatchObject({
      image_url: "https://cdn.example.com/scene.png",
      prompt: "cars",
      export_textured_glb: false,
      detection_threshold: 0.6,
    });
  });

  it("HunYuan3D v3: input_image_url + 多視角 + face_count + polygon_type + generate_type 透傳", async () => {
    await dispatchStudio3D({
      modelId: "fal-ai/hunyuan3d-v3/image-to-3d",
      input_image_url: "https://cdn.example.com/front.png",
      back_image_url: "https://cdn.example.com/back.png",
      left_image_url: "https://cdn.example.com/left.png",
      right_image_url: "https://cdn.example.com/right.png",
      enable_pbr: true,
      face_count: 800000,
      generate_type: "LowPoly",
      polygon_type: "quadrilateral",
    });
    const call = vi.mocked(dispatchFalQueueTask).mock.calls[0]![0];
    expect(call.modelId).toBe("fal-ai/hunyuan3d-v3/image-to-3d");
    expect(call.category).toBe("image-to-3d");
    expect(call.input).toMatchObject({
      input_image_url: "https://cdn.example.com/front.png",
      back_image_url: "https://cdn.example.com/back.png",
      left_image_url: "https://cdn.example.com/left.png",
      right_image_url: "https://cdn.example.com/right.png",
      enable_pbr: true,
      face_count: 800000,
      generate_type: "LowPoly",
      polygon_type: "quadrilateral",
    });
  });

  it("Rodin 純文字 (text-to-3d): 沒 image_url 時 category 切到 text-to-3d", async () => {
    await dispatchStudio3D({
      modelId: "fal-ai/hyper3d/rodin",
      prompt: "a low-poly fox",
      material: "PBR",
      quality: "high",
      geometry_file_format: "fbx",
      use_hyper: true,
    });
    const call = vi.mocked(dispatchFalQueueTask).mock.calls[0]![0];
    expect(call.modelId).toBe("fal-ai/hyper3d/rodin");
    expect(call.category).toBe("text-to-3d");
    expect(call.input).toMatchObject({
      prompt: "a low-poly fox",
      material: "PBR",
      quality: "high",
      geometry_file_format: "fbx",
      use_hyper: true,
    });
    expect(call.input).not.toHaveProperty("image_url");
  });

  it("Rodin 雙輸入 (image-to-3d): image_urls + prompt + condition_mode 透傳", async () => {
    await dispatchStudio3D({
      modelId: "fal-ai/hyper3d/rodin",
      prompt: "stylized cat",
      image_urls: ["https://cdn.example.com/cat-ref.png"],
      condition_mode: "fuse",
      material: "Shaded",
      quality: "medium",
    });
    const call = vi.mocked(dispatchFalQueueTask).mock.calls[0]![0];
    // 有 image_urls 視同有 image,走 image-to-3d
    expect(call.category).toBe("image-to-3d");
    expect(call.input).toMatchObject({
      prompt: "stylized cat",
      image_urls: ["https://cdn.example.com/cat-ref.png"],
      condition_mode: "fuse",
      material: "Shaded",
      quality: "medium",
    });
  });

  it("HunYuan World: 場景 labels + export_drc 透傳", async () => {
    await dispatchStudio3D({
      modelId: "fal-ai/hunyuan_world/image-to-world",
      image_url: "https://cdn.example.com/cityscape.png",
      labels_fg1: "people, cars",
      labels_fg2: "buildings, trees",
      classes: "urban street",
      export_drc: true,
    });
    const call = vi.mocked(dispatchFalQueueTask).mock.calls[0]![0];
    expect(call.modelId).toBe("fal-ai/hunyuan_world/image-to-world");
    expect(call.category).toBe("image-to-3d");
    expect(call.input).toMatchObject({
      image_url: "https://cdn.example.com/cityscape.png",
      labels_fg1: "people, cars",
      labels_fg2: "buildings, trees",
      classes: "urban street",
      export_drc: true,
    });
  });

  it("缺 modelId 時 fallback 到 trellis-2 預設", async () => {
    await dispatchStudio3D({
      image_url: "https://cdn.example.com/x.png",
    });
    const call = vi.mocked(dispatchFalQueueTask).mock.calls[0]![0];
    expect(call.modelId).toBe("fal-ai/trellis-2");
    expect(call.category).toBe("image-to-3d");
  });
});
