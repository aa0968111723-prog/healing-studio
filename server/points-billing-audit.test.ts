import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("site-wide points billing audit", () => {
  it("multimodal flow stores actual estimated points in generation history", async () => {
    const routersPath = path.resolve(process.cwd(), "server/routers.ts");
    const source = await fs.readFile(routersPath, "utf8");

    expect(source).toContain("const _genEstimate = estimatePoints");
    expect(source).toContain("costCredits: _genEstimate.totalPoints");
  });

  it("image studio history uses model-based estimate instead of flat 1 credit", async () => {
    const imageStudioPath = path.resolve(
      process.cwd(),
      "server/routers/imageStudio.ts"
    );
    const source = await fs.readFile(imageStudioPath, "utf8");

    expect(source).toContain('import { estimatePoints } from "../services/modelPricing"');
    expect(source).toContain("const estimate = estimatePoints(input.modelId)");
    expect(source).toContain("costCredits: estimate.totalPoints");
    expect(source).not.toContain("costCredits: 1");
  });
});
