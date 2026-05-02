import { describe, expect, it } from "vitest";
import { resolveImageGenRouting } from "./services/agentToolExecutor";

/**
 * Tests for studio.generateImage routing logic.
 *
 * Verifies that:
 * - Text-only args → text-to-image category
 * - image_url present → image-to-image category
 * - image_urls array present → image-to-image category
 * - image_url is auto-merged into image_urls for fal.ai edit endpoint compatibility
 * - Deduplication when image_url is also in image_urls
 */
describe("resolveImageGenRouting — category selection", () => {
  it("no image args → text-to-image", () => {
    const { category } = resolveImageGenRouting({ prompt: "a cat" });
    expect(category).toBe("text-to-image");
  });

  it("empty args → text-to-image", () => {
    const { category } = resolveImageGenRouting({});
    expect(category).toBe("text-to-image");
  });

  it("image_url string → image-to-image", () => {
    const { category } = resolveImageGenRouting({
      prompt: "edit this image",
      image_url: "https://cdn.example.com/ref.jpg",
    });
    expect(category).toBe("image-to-image");
  });

  it("empty image_url string → text-to-image (falsy)", () => {
    const { category } = resolveImageGenRouting({ image_url: "" });
    expect(category).toBe("text-to-image");
  });

  it("image_urls non-empty array → image-to-image", () => {
    const { category } = resolveImageGenRouting({
      prompt: "merge these images",
      image_urls: ["https://cdn.example.com/img1.jpg", "https://cdn.example.com/img2.jpg"],
    });
    expect(category).toBe("image-to-image");
  });

  it("image_urls empty array → text-to-image", () => {
    const { category } = resolveImageGenRouting({ image_urls: [] });
    expect(category).toBe("text-to-image");
  });

  it("both image_url and image_urls → image-to-image", () => {
    const { category } = resolveImageGenRouting({
      image_url: "https://cdn.example.com/primary.jpg",
      image_urls: ["https://cdn.example.com/ref2.jpg"],
    });
    expect(category).toBe("image-to-image");
  });
});

describe("resolveImageGenRouting — image_urls auto-population", () => {
  it("no image args → imageUrls is undefined", () => {
    const { imageUrls } = resolveImageGenRouting({ prompt: "a cat" });
    expect(imageUrls).toBeUndefined();
  });

  it("image_url only → imageUrls wraps it in array", () => {
    const url = "https://cdn.example.com/input.jpg";
    const { imageUrls } = resolveImageGenRouting({ image_url: url });
    expect(imageUrls).toEqual([url]);
  });

  it("image_urls only → imageUrls returns same array", () => {
    const urls = [
      "https://cdn.example.com/img1.jpg",
      "https://cdn.example.com/img2.jpg",
    ];
    const { imageUrls } = resolveImageGenRouting({ image_urls: urls });
    expect(imageUrls).toEqual(urls);
  });

  it("image_url + image_urls → merged deduplication", () => {
    const primary = "https://cdn.example.com/primary.jpg";
    const extra = "https://cdn.example.com/ref.jpg";
    const { imageUrls } = resolveImageGenRouting({
      image_url: primary,
      image_urls: [extra],
    });
    expect(imageUrls).toContain(primary);
    expect(imageUrls).toContain(extra);
    expect(imageUrls!.length).toBe(2);
  });

  it("deduplicates when image_url appears again in image_urls", () => {
    const url = "https://cdn.example.com/same.jpg";
    const { imageUrls } = resolveImageGenRouting({
      image_url: url,
      image_urls: [url],
    });
    expect(imageUrls).toEqual([url]);
    expect(imageUrls!.length).toBe(1);
  });
});

describe("resolveImageGenRouting — edit models by model type", () => {
  // Nano Banana Pro Edit — image_urls array
  it("Nano Banana Pro Edit: image_urls → image-to-image", () => {
    const { category, imageUrls } = resolveImageGenRouting({
      modelId: "fal-ai/nano-banana-pro/edit",
      prompt: "remove background",
      image_url: "https://cdn.example.com/photo.jpg",
    });
    expect(category).toBe("image-to-image");
    expect(imageUrls).toEqual(["https://cdn.example.com/photo.jpg"]);
  });

  // SeeDream v4.5 Edit
  it("SeeDream v4.5 Edit: single image_url → image-to-image", () => {
    const { category } = resolveImageGenRouting({
      modelId: "fal-ai/bytedance/seedream/v4.5/edit",
      prompt: "make it more vibrant",
      image_url: "https://cdn.example.com/input.jpg",
    });
    expect(category).toBe("image-to-image");
  });

  // SeeDream v5 Lite Edit
  it("SeeDream v5 Lite Edit: single image_url → image-to-image", () => {
    const { category } = resolveImageGenRouting({
      modelId: "fal-ai/bytedance/seedream/v5/lite/edit",
      prompt: "change the sky",
      image_url: "https://cdn.example.com/landscape.jpg",
    });
    expect(category).toBe("image-to-image");
  });

  // FLUX.1 Kontext Pro
  it("FLUX Kontext: image_url → image-to-image", () => {
    const { category } = resolveImageGenRouting({
      modelId: "fal-ai/flux-pro/kontext",
      prompt: "add a hat to the person",
      image_url: "https://cdn.example.com/portrait.jpg",
    });
    expect(category).toBe("image-to-image");
  });

  // GPT Image 1.5 Edit
  it("GPT Image 1.5 Edit: image_url → image-to-image", () => {
    const { category } = resolveImageGenRouting({
      modelId: "fal-ai/gpt-image-1.5/edit",
      prompt: "replace the background",
      image_url: "https://cdn.example.com/subject.jpg",
    });
    expect(category).toBe("image-to-image");
  });

  // FLUX 2 Pro Edit
  it("FLUX 2 Pro Edit: image_urls array → image-to-image", () => {
    const { category, imageUrls } = resolveImageGenRouting({
      modelId: "fal-ai/flux-2-pro/edit",
      prompt: "combine the styles",
      image_urls: [
        "https://cdn.example.com/style1.jpg",
        "https://cdn.example.com/style2.jpg",
      ],
    });
    expect(category).toBe("image-to-image");
    expect(imageUrls!.length).toBe(2);
  });

  // Nano Banana 2 Edit
  it("Nano Banana 2 Edit: image_url → image-to-image with image_urls populated", () => {
    const url = "https://cdn.example.com/gemini-edit.jpg";
    const { category, imageUrls } = resolveImageGenRouting({
      modelId: "fal-ai/nano-banana-2/edit",
      prompt: "make it look like a painting",
      image_url: url,
    });
    expect(category).toBe("image-to-image");
    expect(imageUrls).toEqual([url]);
  });

  // Grok Edit
  it("Grok Edit: image_url → image-to-image", () => {
    const { category } = resolveImageGenRouting({
      modelId: "xai/grok-imagine-image/edit",
      prompt: "add text to image",
      image_url: "https://cdn.example.com/base.jpg",
    });
    expect(category).toBe("image-to-image");
  });

  // Text-to-image (no image source)
  it("SeeDream v4 text-to-image: no image → text-to-image", () => {
    const { category, imageUrls } = resolveImageGenRouting({
      modelId: "fal-ai/bytedance/seedream/v4/text-to-image",
      prompt: "a futuristic cityscape",
    });
    expect(category).toBe("text-to-image");
    expect(imageUrls).toBeUndefined();
  });

  it("Imagen 4 text-to-image: no image → text-to-image", () => {
    const { category } = resolveImageGenRouting({
      modelId: "fal-ai/imagen4/preview",
      prompt: "a serene mountain lake at sunset",
    });
    expect(category).toBe("text-to-image");
  });

  it("Nano Banana 2 text-to-image: no image → text-to-image", () => {
    const { category } = resolveImageGenRouting({
      modelId: "fal-ai/nano-banana-2",
      prompt: "a cute robot",
    });
    expect(category).toBe("text-to-image");
  });

  it("Nano Banana Pro text-to-image: no image → text-to-image", () => {
    const { category } = resolveImageGenRouting({
      modelId: "fal-ai/nano-banana-pro",
      prompt: "crystal formations in a cave",
    });
    expect(category).toBe("text-to-image");
  });
});

describe("resolveImageGenRouting — multi-image reference (Nano Banana / img2img)", () => {
  it("Nano Banana 2 with multiple references: image_url + image_urls → merged", () => {
    const primary = "https://cdn.example.com/main.jpg";
    const ref1 = "https://cdn.example.com/ref1.jpg";
    const ref2 = "https://cdn.example.com/ref2.jpg";
    const { category, imageUrls } = resolveImageGenRouting({
      modelId: "fal-ai/nano-banana-2",
      prompt: "blend these styles",
      image_url: primary,
      image_urls: [ref1, ref2],
    });
    expect(category).toBe("image-to-image");
    expect(imageUrls).toContain(primary);
    expect(imageUrls).toContain(ref1);
    expect(imageUrls).toContain(ref2);
    expect(imageUrls!.length).toBe(3);
  });
});
