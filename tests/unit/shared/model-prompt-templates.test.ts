import { describe, expect, it } from "vitest";
import {
  injectModelPrompt,
  summarizeModelPromptTemplates,
  MODEL_PROMPT_TEMPLATES,
} from "../../../shared/modelPromptTemplates";

describe("modelPromptTemplates.injectModelPrompt", () => {
  it("appends FLUX Pro cinematic suffix without altering the user's intent", () => {
    const out = injectModelPrompt(
      "a calm forest at dawn",
      "fal-ai/flux-pro/v1.1"
    );
    expect(out.template?.modelIdPrefix).toBe("fal-ai/flux-pro");
    expect(out.prompt).toBe(
      "a calm forest at dawn, cinematic lighting, sharp focus, ultra-detailed"
    );
    expect(out.defaultNegativePrompt).toBeUndefined(); // FLUX has no default negative
  });

  it("prepends SD quality tags AND injects negative prompt when user did not supply one", () => {
    const out = injectModelPrompt(
      "an astronaut riding a horse",
      "fal-ai/stable-diffusion-v35-large"
    );
    expect(out.prompt.startsWith("masterpiece, best quality, ")).toBe(true);
    expect(out.defaultNegativePrompt).toMatch(/lowres/);
  });

  it("never overrides a user-supplied negative_prompt", () => {
    const out = injectModelPrompt(
      "an astronaut riding a horse",
      "fal-ai/stable-diffusion-v35-large",
      { userNegativePrompt: "no horses" }
    );
    expect(out.defaultNegativePrompt).toBeUndefined();
  });

  it("longest matching prefix wins (flux-pro must not pick the bare flux/dev rule)", () => {
    const out = injectModelPrompt("x", "fal-ai/flux-pro/v1.1");
    expect(out.template?.modelIdPrefix).toBe("fal-ai/flux-pro");
    expect(out.prompt).toContain("cinematic lighting");
    // Make sure flux/dev's lighter suffix didn't sneak in
    expect(out.prompt).not.toContain(", high quality, detailed");
  });

  it("Kling video gets cinematic motion suffix", () => {
    const out = injectModelPrompt(
      "a cat walks across the room",
      "fal-ai/kling-video/v2.1/pro/text-to-video"
    );
    expect(out.template?.style).toBe("cinematic");
    expect(out.prompt).toContain("smooth camera movement");
  });

  it("returns the input unchanged when no template matches the modelId", () => {
    const out = injectModelPrompt("hello world", "completely-unknown/model-x");
    expect(out.template).toBeNull();
    expect(out.prompt).toBe("hello world");
  });

  it("handles empty / whitespace-only prompts as no-ops", () => {
    const out = injectModelPrompt("   ", "fal-ai/flux-pro/v1.1");
    expect(out.prompt).toBe("   ");
    expect(out.template).toBeNull();
  });
});

describe("modelPromptTemplates.summarizeModelPromptTemplates", () => {
  it("includes every registered template", () => {
    const summary = summarizeModelPromptTemplates();
    const parsed = JSON.parse(summary) as {
      items: Array<{ modelIdPrefix: string }>;
    };
    expect(parsed.items.length).toBe(MODEL_PROMPT_TEMPLATES.length);
    expect(parsed.items.map(i => i.modelIdPrefix)).toContain("fal-ai/flux-pro");
  });
});
