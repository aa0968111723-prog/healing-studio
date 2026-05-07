/**
 * server/services/__tests__/orbAssetPipeline.test.ts
 *
 * Tests for Gap #P0: Asset Pipeline
 *
 * Verifies that URLs and data from earlier steps correctly flow to
 * downstream steps via the step reference resolver.
 */

import { describe, it, expect } from "vitest";
import { resolveStepRefsInArgs } from "../../../shared/orb-step-ref-resolver";
import type { ResolveStepRefsInput } from "../../../shared/orb-step-ref-resolver";

describe("Asset Pipeline: Step Reference Resolution", () => {
  it("should resolve ${stepId.field} references in tool args", () => {
    const input: ResolveStepRefsInput = {
      args: {
        prompt: "animate this image",
        image_url: "${step1.image_url}",
        duration: 5,
      },
      perStepToolResults: [
        {
          stepId: "step1",
          toolResults: [
            {
              ok: true,
              data: {
                image_url: "https://cdn.example.com/generated_image.png",
                request_id: "req_12345",
              },
            },
          ],
        },
      ],
    };

    const resolved = resolveStepRefsInArgs(input);

    expect(resolved).toEqual({
      prompt: "animate this image",
      image_url: "https://cdn.example.com/generated_image.png",
      duration: 5,
    });
  });

  it("should resolve ${stepId.output.field} references", () => {
    const input: ResolveStepRefsInput = {
      args: {
        video_url: "${step_video.output.url}",
      },
      perStepToolResults: [
        {
          stepId: "step_video",
          toolResults: [
            {
              ok: true,
              data: {
                output: {
                  url: "https://cdn.example.com/video.mp4",
                },
              },
            },
          ],
        },
      ],
    };

    const resolved = resolveStepRefsInArgs(input);

    expect(resolved).toEqual({
      video_url: "https://cdn.example.com/video.mp4",
    });
  });

  it("should preserve unresolved references when step data is missing", () => {
    const input: ResolveStepRefsInput = {
      args: {
        image_url: "${step_missing.image_url}",
      },
      perStepToolResults: [],
    };

    const resolved = resolveStepRefsInArgs(input);

    expect(resolved).toEqual({
      image_url: "${step_missing.image_url}",
    });
  });

  it("should handle nested references in objects", () => {
    const input: ResolveStepRefsInput = {
      args: {
        config: {
          source: "${step1.video_url}",
          overlay: "${step2.image_url}",
        },
      },
      perStepToolResults: [
        {
          stepId: "step1",
          toolResults: [{ ok: true, data: { video_url: "https://video.mp4" } }],
        },
        {
          stepId: "step2",
          toolResults: [{ ok: true, data: { image_url: "https://image.png" } }],
        },
      ],
    };

    const resolved = resolveStepRefsInArgs(input);

    expect(resolved).toEqual({
      config: {
        source: "https://video.mp4",
        overlay: "https://image.png",
      },
    });
  });

  it("should handle references in arrays", () => {
    const input: ResolveStepRefsInput = {
      args: {
        images: [
          "${step1.image_url}",
          "${step2.image_url}",
          "https://static.example.com/image.png",
        ],
      },
      perStepToolResults: [
        {
          stepId: "step1",
          toolResults: [{ ok: true, data: { image_url: "https://img1.png" } }],
        },
        {
          stepId: "step2",
          toolResults: [{ ok: true, data: { image_url: "https://img2.png" } }],
        },
      ],
    };

    const resolved = resolveStepRefsInArgs(input);

    expect(resolved).toEqual({
      images: [
        "https://img1.png",
        "https://img2.png",
        "https://static.example.com/image.png",
      ],
    });
  });

  it("should use first successful result when step has multiple results", () => {
    const input: ResolveStepRefsInput = {
      args: {
        image_url: "${step1.image_url}",
      },
      perStepToolResults: [
        {
          stepId: "step1",
          toolResults: [
            { ok: false }, // First attempt failed
            { ok: true, data: { image_url: "https://success.png" } }, // Second succeeded
            { ok: true, data: { image_url: "https://third.png" } }, // Third also succeeded
          ],
        },
      ],
    };

    const resolved = resolveStepRefsInArgs(input);

    // Should use the first successful result
    expect(resolved).toEqual({
      image_url: "https://success.png",
    });
  });

  it("should preserve original type for non-string references", () => {
    const input: ResolveStepRefsInput = {
      args: {
        count: "${step1.count}",
        enabled: "${step1.enabled}",
        items: "${step1.items}",
      },
      perStepToolResults: [
        {
          stepId: "step1",
          toolResults: [
            {
              ok: true,
              data: {
                count: 42,
                enabled: true,
                items: ["a", "b", "c"],
              },
            },
          ],
        },
      ],
    };

    const resolved = resolveStepRefsInArgs(input);

    expect(resolved).toEqual({
      count: 42,
      enabled: true,
      items: ["a", "b", "c"],
    });
  });

  it("should handle complex multi-step video workflow", () => {
    // Simulates: image generation → video generation → upscale
    const input: ResolveStepRefsInput = {
      args: {
        prompt: "upscale this video",
        video_url: "${step_video.video_url}",
        target_resolution: "4k",
      },
      perStepToolResults: [
        {
          stepId: "step_image",
          toolResults: [
            {
              ok: true,
              data: {
                image_url: "https://cdn.example.com/image.png",
                request_id: "img_123",
              },
            },
          ],
        },
        {
          stepId: "step_video",
          toolResults: [
            {
              ok: true,
              data: {
                video_url: "https://cdn.example.com/video.mp4",
                request_id: "vid_456",
                duration: 5,
              },
            },
          ],
        },
      ],
    };

    const resolved = resolveStepRefsInArgs(input);

    expect(resolved).toEqual({
      prompt: "upscale this video",
      video_url: "https://cdn.example.com/video.mp4",
      target_resolution: "4k",
    });
  });

  it("should handle buildShortVideoWorkflow reference pattern", () => {
    // Tests the specific pattern used in buildShortVideoWorkflow
    const input: ResolveStepRefsInput = {
      args: {
        prompt: "30 second video with cinematic feel",
        image_url: "${step_image_keyvisual.image_url}",
      },
      perStepToolResults: [
        {
          stepId: "step_image_keyvisual",
          toolResults: [
            {
              ok: true,
              data: {
                image_url: "https://fal.ai/files/generated_image.png",
                images: [
                  {
                    url: "https://fal.ai/files/generated_image.png",
                    width: 1024,
                    height: 1024,
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const resolved = resolveStepRefsInArgs(input);

    expect(resolved?.image_url).toBe("https://fal.ai/files/generated_image.png");
  });
});

describe("Asset Pipeline: buildShortVideoWorkflow Integration", () => {
  it("should have correct step IDs and dependencies in workflow", () => {
    // This is a structural test to ensure the workflow is set up correctly
    // We'll import and check the actual workflow structure
    const { buildShortVideoWorkflow } = require("../../../shared/global-agent-workflows");

    const workflow = buildShortVideoWorkflow("test brief");

    // Find the image generation step
    const imageStep = workflow.steps.find(
      (s: { id?: string }) => s.id === "step_image_keyvisual"
    );
    expect(imageStep).toBeDefined();
    expect(imageStep?.toolName).toBe("studio.generateImage");

    // Find the video generation step
    const videoStep = workflow.steps.find(
      (s: { toolName?: string; dependsOn?: string[] }) =>
        s.toolName === "studio.generateVideo"
    );
    expect(videoStep).toBeDefined();
    expect(videoStep?.dependsOn).toContain("step_image_keyvisual");

    // Verify the reference pattern in toolArgs
    expect(videoStep?.toolArgs).toHaveProperty("image_url");
    expect(videoStep?.toolArgs?.image_url).toContain("${step_image_keyvisual.image_url}");
  });
});
