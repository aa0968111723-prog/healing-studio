/**
 * orb-modality-coherence.test.ts
 *
 * Verifies modality-coherence detection:
 *   - User says "影片" + planner picks /image-studio → mismatch.
 *   - User says "音樂" + planner picks /pro-studio → no mismatch.
 *   - No declared modality → no mismatch (avoid false positives).
 *   - setModality action takes precedence over navigate path.
 */

import { describe, expect, it } from "vitest";
import { checkModalityCoherence } from "../shared/orb-modality-coherence";

describe("checkModalityCoherence", () => {
  it("flags video-intent + image-studio plan as mismatch", () => {
    const result = checkModalityCoherence({
      userText: "幫我做一個 10 秒的短片，氛圍要溫暖。",
      steps: [
        { action: { type: "navigate", path: "/image-studio" } },
        { action: { type: "fillPrompt" } },
      ],
    });
    expect(result.mismatch).toBe(true);
    expect(result.declared).toBe("video");
    expect(result.selected).toBe("image");
    expect(result.message).toContain("video");
  });

  it("does not flag music-intent on /pro-studio", () => {
    const result = checkModalityCoherence({
      userText: "我想做一首背景音樂",
      steps: [{ action: { type: "navigate", path: "/pro-studio" } }],
    });
    expect(result.mismatch).toBe(false);
    expect(result.declared).toBe("audio");
    expect(result.selected).toBe("audio");
  });

  it("returns no mismatch when user gives no modality signal", () => {
    const result = checkModalityCoherence({
      userText: "嗨，幫我一下",
      steps: [{ action: { type: "navigate", path: "/studio" } }],
    });
    expect(result.mismatch).toBe(false);
    expect(result.declared).toBeNull();
  });

  it("setModality action wins over navigate path", () => {
    const result = checkModalityCoherence({
      userText: "我要做一張海報",
      steps: [
        { action: { type: "navigate", path: "/studio" } },
        { action: { type: "setModality", modality: "image" } },
      ],
    });
    expect(result.mismatch).toBe(false);
    expect(result.selected).toBe("image");
  });

  it("English video keyword triggers detection", () => {
    const result = checkModalityCoherence({
      userText: "make a short video clip",
      steps: [{ action: { type: "navigate", path: "/image-studio" } }],
    });
    expect(result.mismatch).toBe(true);
    expect(result.declared).toBe("video");
  });
});
