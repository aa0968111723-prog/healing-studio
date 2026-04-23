import { describe, expect, it } from "vitest";
import { bootstrapAiAdapters } from "./services/ai-adapters/bootstrap";
import { getAdapter, listAdapters } from "./services/ai-adapters/registry";

describe("ai adapter registry", () => {
  it("registers built-in adapters", () => {
    bootstrapAiAdapters();
    const providers = listAdapters();
    expect(providers).toContain("fal_ai");
    expect(providers).toContain("gemini");
    expect(providers).toContain("elevenlabs");
    expect(providers).toContain("suno");
    expect(getAdapter("fal_ai").provider).toBe("fal_ai");
    expect(getAdapter("gemini").provider).toBe("gemini");
  });
});
