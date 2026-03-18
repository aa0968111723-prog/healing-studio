import { describe, it, expect, beforeAll } from "vitest";
import { appRouter } from "./routers";

// ─── Custom Blocks & Block Combos Tests ──────────────────────────────────

describe("Custom Blocks API", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeAll(() => {
    caller = appRouter.createCaller({
      user: { id: 1, name: "Test User", openId: "test-open-id", role: "user" },
    } as any);
  });

  it("should create a custom block", async () => {
    const result = await caller.customBlocks.create({
      modality: "image",
      category: "subject",
      label: "測試積木",
      prompt: "test block prompt",
      emoji: "🎨",
    });
    expect(result).toHaveProperty("id");
    expect(typeof result.id).toBe("number");
  });

  it("should list custom blocks for user", async () => {
    const blocks = await caller.customBlocks.list({ modality: "image" });
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    const found = blocks.find((b: any) => b.label === "測試積木");
    expect(found).toBeDefined();
    expect(found?.prompt).toBe("test block prompt");
    expect(found?.category).toBe("subject");
  });

  it("should list custom blocks without modality filter", async () => {
    const blocks = await caller.customBlocks.list();
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks.length).toBeGreaterThanOrEqual(1);
  });

  it("should create blocks for different modalities", async () => {
    const result = await caller.customBlocks.create({
      modality: "audio",
      category: "instrument",
      label: "古箏",
      prompt: "guzheng, Chinese zither",
    });
    expect(result).toHaveProperty("id");

    const audioBlocks = await caller.customBlocks.list({ modality: "audio" });
    const found = audioBlocks.find((b: any) => b.label === "古箏");
    expect(found).toBeDefined();

    // Should not appear in image blocks
    const imageBlocks = await caller.customBlocks.list({ modality: "image" });
    const notFound = imageBlocks.find((b: any) => b.label === "古箏");
    expect(notFound).toBeUndefined();
  });

  it("should delete a custom block", async () => {
    const created = await caller.customBlocks.create({
      modality: "video",
      category: "style",
      label: "待刪除",
      prompt: "to be deleted",
    });
    const result = await caller.customBlocks.delete({ id: created.id });
    expect(result).toEqual({ success: true });

    const blocks = await caller.customBlocks.list({ modality: "video" });
    const found = blocks.find((b: any) => b.id === created.id);
    expect(found).toBeUndefined();
  });
});

describe("Block Combos API", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeAll(() => {
    caller = appRouter.createCaller({
      user: { id: 1, name: "Test User", openId: "test-open-id", role: "user" },
    } as any);
  });

  it("should create a block combo", async () => {
    const result = await caller.blockCombos.create({
      name: "賽博龐克城市",
      modality: "image",
      blockIds: ["s4", "st1", "sc2", "l2"],
      customBlockIds: [],
      vibeCardIds: ["mystical"],
    });
    expect(result).toHaveProperty("id");
    expect(typeof result.id).toBe("number");
  });

  it("should list block combos for user", async () => {
    const combos = await caller.blockCombos.list({ modality: "image" });
    expect(Array.isArray(combos)).toBe(true);
    expect(combos.length).toBeGreaterThanOrEqual(1);
    const found = combos.find((c: any) => c.name === "賽博龐克城市");
    expect(found).toBeDefined();
    expect(found?.blockIds).toEqual(["s4", "st1", "sc2", "l2"]);
    expect(found?.vibeCardIds).toEqual(["mystical"]);
  });

  it("should list combos without modality filter", async () => {
    const combos = await caller.blockCombos.list();
    expect(Array.isArray(combos)).toBe(true);
    expect(combos.length).toBeGreaterThanOrEqual(1);
  });

  it("should rename a block combo", async () => {
    const created = await caller.blockCombos.create({
      name: "原始名稱",
      modality: "video",
      blockIds: ["s1"],
    });
    const result = await caller.blockCombos.rename({
      id: created.id,
      name: "新名稱",
    });
    expect(result).toEqual({ success: true });

    const combos = await caller.blockCombos.list({ modality: "video" });
    const found = combos.find((c: any) => c.id === created.id);
    expect(found?.name).toBe("新名稱");
  });

  it("should delete a block combo", async () => {
    const created = await caller.blockCombos.create({
      name: "待刪除組合",
      modality: "audio",
      blockIds: ["ai1", "ag2"],
    });
    const result = await caller.blockCombos.delete({ id: created.id });
    expect(result).toEqual({ success: true });

    const combos = await caller.blockCombos.list({ modality: "audio" });
    const found = combos.find((c: any) => c.id === created.id);
    expect(found).toBeUndefined();
  });

  it("should create combo with custom block IDs", async () => {
    const result = await caller.blockCombos.create({
      name: "混合組合",
      modality: "image",
      blockIds: ["s1", "st2"],
      customBlockIds: [1, 2],
      vibeCardIds: ["serene", "warm"],
    });
    expect(result).toHaveProperty("id");

    const combos = await caller.blockCombos.list({ modality: "image" });
    const found = combos.find((c: any) => c.id === result.id);
    expect(found?.customBlockIds).toEqual([1, 2]);
    expect(found?.vibeCardIds).toEqual(["serene", "warm"]);
  });
});
