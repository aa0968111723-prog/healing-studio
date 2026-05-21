import { describe, it, expect } from "vitest";
import { mapGenerationResultToWorldbuildingPatch } from "../../../shared/worldbuilding-result-mapping";

describe("worldbuilding result mapping", () => {
  it("maps urls", () => {
    const out = mapGenerationResultToWorldbuildingPatch({ id: "1", type: "shot_image", title: "x", recommendedModels: [], executionMode: "dry_run", status: "ready", blockers: [], requiresConfirmation: true, payload: {} } as any, { resultUrls: ["https://x"] });
    expect(out[0]?.assetUrl).toBe("https://x");
  });
});
