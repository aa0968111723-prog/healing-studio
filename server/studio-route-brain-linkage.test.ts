import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Studio API route wiring and AI brain linkage", () => {
  it("exposes generate.submitMultimodalAsync route used by Studio page", () => {
    const serverSource = readFileSync(
      resolve(process.cwd(), "server/routers.ts"),
      "utf8"
    );
    const clientSource = readFileSync(
      resolve(process.cwd(), "client/src/pages/Studio.tsx"),
      "utf8"
    );

    expect(serverSource).toContain("submitMultimodalAsync: protectedProcedure");
    expect(clientSource).toContain(
      "trpc.generate.submitMultimodalAsync.useMutation"
    );
  });

  it("multimodal and async studio routes both read AI brain config for Fal engine resolution", () => {
    const source = readFileSync(resolve(process.cwd(), "server/routers.ts"), "utf8");

    const multimodalSection = source.substring(
      source.indexOf("multimodal: brainProcedure"),
      source.indexOf("submitMultimodalAsync: protectedProcedure")
    );
    expect(multimodalSection).toContain(".from(userAiBrain)");
    expect(multimodalSection).toContain("resolveFalEnginesFromRow(brainRow)");
    expect(multimodalSection).toContain("getBrainSelectedEngine(brainRow, \"imageEngine\")");

    const asyncSection = source.substring(
      source.indexOf("submitMultimodalAsync: protectedProcedure"),
      source.indexOf("submitStudioJob: protectedProcedure")
    );
    expect(asyncSection).toContain(".from(userAiBrain)");
    expect(asyncSection).toContain("resolveFalEnginesFromRow(brainRow)");
    expect(asyncSection).toContain("getBrainSelectedEngine(brainRow, \"imageEngine\")");
  });

  it("supports provider switching between Gemini and Fal.ai in studio routes", () => {
    const source = readFileSync(resolve(process.cwd(), "server/routers.ts"), "utf8");
    const multimodalSection = source.substring(
      source.indexOf("multimodal: brainProcedure"),
      source.indexOf("submitMultimodalAsync: protectedProcedure")
    );
    const asyncSection = source.substring(
      source.indexOf("submitMultimodalAsync: protectedProcedure"),
      source.indexOf("submitStudioJob: protectedProcedure")
    );

    expect(multimodalSection).toContain("if (isGeminiEngine(_genModelId))");
    expect(multimodalSection).toContain("getGeminiMediaClient()");
    expect(multimodalSection).toContain("dispatchImageGeneration");

    expect(asyncSection).toContain("if (isGeminiEngine(modelId))");
    expect(asyncSection).toContain("const gemini = getGeminiMediaClient()");
    expect(asyncSection).toContain("submitToFalQueue(modelId, falInput)");
  });

  it("normalizes brain engine IDs before routing so AI brain selection is real", () => {
    const source = readFileSync(resolve(process.cwd(), "server/routers.ts"), "utf8");
    expect(source).toContain("function getBrainSelectedEngine(");
    expect(source).toContain("return normalizeEngineModelId(value.trim())");
  });
});
