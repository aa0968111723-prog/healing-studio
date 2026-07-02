import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("site-wide points billing audit", () => {
  it("multimodal flow stores actual estimated points in generation history", async () => {
    // generate router was extracted to server/routers/generate.ts
    const routersPath = path.resolve(process.cwd(), "server/routers/generate.ts");
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

  it("pro-studio router charges credits for every fal-queue audio mutation", async () => {
    const proStudioPath = path.resolve(
      process.cwd(),
      "server/routers/proStudio.ts"
    );
    const source = await fs.readFile(proStudioPath, "utf8");

    // chargeForFalTask helper 必須存在且接到 deductUserPoints + estimatePoints
    expect(source).toContain('import { estimatePoints } from "../services/modelPricing"');
    // AIDV-254 修復既有紅測（origin/main 即紅）：AIDV-793 在同一行 db import 加入
    // getCustomBlock 後，原字面量斷言過時。改為錨定「deductUserPoints 與
    // refundUserPoints 皆自 ../db 匯入」而不綁死同行的其他匯入項。
    expect(source).toMatch(/import \{[^}]*\bdeductUserPoints\b[^}]*\brefundUserPoints\b[^}]*\} from "\.\.\/db"/);
    expect(source).toContain("async function chargeForFalTask");
    expect(source).toContain("await deductUserPoints(userId, estimate.totalPoints)");

    // 每個 mutation 走 falQueueSubmit 都要先 chargeForFalTask + 失敗 refundUserPoints
    const submitCount = (source.match(/await falQueueSubmit\(/g) ?? []).length;
    const chargeCount = (source.match(/chargeForFalTask\(ctx\.user\.id/g) ?? [])
      .length;
    const refundCount = (source.match(/refundUserPoints\(ctx\.user\.id/g) ?? [])
      .length;

    // 容許 falQueueRun 等內部 helper 多用一次 falQueueSubmit
    expect(chargeCount).toBeGreaterThanOrEqual(submitCount - 1);
    expect(refundCount).toBeGreaterThanOrEqual(chargeCount);
  });
});
