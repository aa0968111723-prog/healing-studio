import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Studio API route wiring and AI brain linkage", () => {
  // generate router was extracted to server/routers/generate.ts;
  // helpers live in server/routers/_generateHelpers.ts.
  const generateSrc = readFileSync(
    resolve(process.cwd(), "server/routers/generate.ts"),
    "utf8"
  );
  const helpersSrc = readFileSync(
    resolve(process.cwd(), "server/routers/_generateHelpers.ts"),
    "utf8"
  );

  it("exposes generate.submitMultimodalAsync route used by Studio page", () => {
    const clientSource = readFileSync(
      resolve(process.cwd(), "client/src/pages/Studio.tsx"),
      "utf8"
    );

    expect(generateSrc).toContain("submitMultimodalAsync: protectedProcedure");
    expect(clientSource).toContain(
      "trpc.generate.submitMultimodalAsync.useMutation"
    );
  });

  it("multimodal and async studio routes both read AI brain config for Fal engine resolution", () => {
    const multimodalSection = generateSrc.substring(
      generateSrc.indexOf("multimodal: brainProcedure"),
      generateSrc.indexOf("submitMultimodalAsync: protectedProcedure")
    );
    expect(multimodalSection).toContain(".from(userAiBrain)");
    expect(multimodalSection).toContain("resolveFalEnginesFromRow(brainRow)");
    expect(multimodalSection).toContain("getBrainSelectedEngine(brainRow, \"imageEngine\")");

    const asyncSection = generateSrc.substring(
      generateSrc.indexOf("submitMultimodalAsync: protectedProcedure"),
      generateSrc.indexOf("submitStudioJob: protectedProcedure")
    );
    expect(asyncSection).toContain(".from(userAiBrain)");
    expect(asyncSection).toContain("resolveFalEnginesFromRow(brainRow)");
    expect(asyncSection).toContain("getBrainSelectedEngine(brainRow, \"imageEngine\")");
  });

  it("supports provider switching between Gemini and Fal.ai in studio routes", () => {
    const multimodalSection = generateSrc.substring(
      generateSrc.indexOf("multimodal: brainProcedure"),
      generateSrc.indexOf("submitMultimodalAsync: protectedProcedure")
    );
    const asyncSection = generateSrc.substring(
      generateSrc.indexOf("submitMultimodalAsync: protectedProcedure"),
      generateSrc.indexOf("submitStudioJob: protectedProcedure")
    );

    expect(multimodalSection).toContain("if (isGeminiEngine(_genModelId))");
    expect(multimodalSection).toContain("getGeminiMediaClient()");
    expect(multimodalSection).toContain("dispatchImageGeneration");

    expect(asyncSection).toContain("if (isGeminiEngine(modelId))");
    expect(asyncSection).toContain("const gemini = getGeminiMediaClient()");
    // Async path now goes through dispatchFalQueueTask so we get the
    // category-based fallback chain when a stale modelId is selected.
    expect(asyncSection).toContain("dispatchFalQueueTask({");
    expect(asyncSection).toMatch(/category: queueCategory/);
  });

  it("normalizes brain engine IDs before routing so AI brain selection is real", () => {
    expect(helpersSrc).toContain("function getBrainSelectedEngine(");
    expect(helpersSrc).toContain("return normalizeEngineModelId(value.trim())");
  });
});
