import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Director override wiring", () => {
  it("prepareJob should normalize overrideEngine before model selection", () => {
    const source = readFileSync(resolve(process.cwd(), "server/routers.ts"), "utf8");
    const prepareSection = source.substring(
      source.indexOf("prepareJob: protectedProcedure"),
      source.indexOf("submitMultimodalAsync: protectedProcedure")
    );
    expect(prepareSection).toContain("const overrideEngine = input.overrideEngine");
    expect(prepareSection).toContain("normalizeEngineModelId(input.overrideEngine)");
    expect(prepareSection).toContain("overrideEngine ??");
  });

  it("submitMultimodalAsync should support overrideModelId and normalize it", () => {
    const source = readFileSync(resolve(process.cwd(), "server/routers.ts"), "utf8");
    const asyncSection = source.substring(
      source.indexOf("submitMultimodalAsync: protectedProcedure")
    );
    expect(asyncSection).toContain("overrideModelId: z.string().optional()");
    expect(asyncSection).toContain("const overrideModelId = input.overrideModelId");
    expect(asyncSection).toContain("normalizeEngineModelId(input.overrideModelId)");
    expect(asyncSection).toContain("overrideModelId ??");
  });
});
