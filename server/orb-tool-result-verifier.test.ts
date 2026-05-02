import { describe, expect, it } from "vitest";
import { verifyToolResult } from "../shared/orb-tool-result-verifier";

describe("orb-tool-result-verifier", () => {
  describe("happy paths", () => {
    it("passes a valid generateImage result", () => {
      const r = verifyToolResult({
        toolName: "studio.generateImage",
        data: { url: "https://cdn.fal.ai/x.png" },
      });
      expect(r.ok).toBe(true);
      expect(r.issues).toHaveLength(0);
    });

    it("passes a valid generateVideo result with positive duration", () => {
      const r = verifyToolResult({
        toolName: "studio.generateVideo",
        data: { video: { url: "https://cdn.fal.ai/x.mp4", duration: 8 } },
      });
      expect(r.ok).toBe(true);
    });

    it("passes a valid generateVoice result", () => {
      const r = verifyToolResult({
        toolName: "studio.generateVoice",
        data: { audio: { url: "https://cdn.elevenlabs.io/x.mp3" } },
      });
      expect(r.ok).toBe(true);
    });

    it("passes a valid transcribe result", () => {
      const r = verifyToolResult({
        toolName: "studio.transcribe",
        data: { text: "今天天氣很好" },
      });
      expect(r.ok).toBe(true);
    });

    it("ignores primitive payload (e.g. boolean ack)", () => {
      const r = verifyToolResult({ toolName: "studio.someAck", data: true });
      expect(r.ok).toBe(true);
    });
  });

  describe("failure paths", () => {
    it("flags missing payload", () => {
      const r = verifyToolResult({ toolName: "studio.generateImage", data: null });
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe("verifier:missing-payload");
    });

    it("flags missing image URL", () => {
      const r = verifyToolResult({
        toolName: "studio.generateImage",
        data: { meta: { provider: "fal" } },
      });
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe("verifier:missing-asset-url");
    });

    it("flags non-http image URL", () => {
      const r = verifyToolResult({
        toolName: "studio.generateImage",
        data: { url: "/local/tmp/x.png" },
      });
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe("verifier:asset-url-not-http");
    });

    it("flags zero-duration video", () => {
      const r = verifyToolResult({
        toolName: "studio.generateVideo",
        data: { url: "https://cdn.fal.ai/x.mp4", duration: 0 },
      });
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe("verifier:suspicious-zero-duration");
    });

    it("flags empty transcribe text", () => {
      const r = verifyToolResult({
        toolName: "studio.transcribe",
        data: { text: "   " },
      });
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe("verifier:empty-text");
    });

    it("flags model-reported error inside 200 body", () => {
      const r = verifyToolResult({
        toolName: "studio.generateImage",
        data: { url: "https://cdn.fal.ai/x.png", error: "NSFW filter triggered" },
      });
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe("verifier:model-reported-error");
    });
  });

  describe("PR #318 audio family inheritance", () => {
    it("animateSpeaker (Wan 2.2 / Stable Avatar) routes to video checks", () => {
      const r = verifyToolResult({
        toolName: "studio.animateSpeaker",
        data: { video: { url: "https://cdn.fal.ai/avatar.mp4", duration: 5 } },
      });
      expect(r.ok).toBe(true);
    });

    it("cloneVoice / designVoice route to audio checks", () => {
      const ok = verifyToolResult({
        toolName: "studio.cloneVoice",
        data: { audio: { url: "https://cdn.elevenlabs.io/x.mp3" } },
      });
      expect(ok.ok).toBe(true);

      const bad = verifyToolResult({
        toolName: "studio.designVoice",
        data: { meta: { tier: "fast" } },
      });
      expect(bad.ok).toBe(false);
      expect(bad.errorCode).toBe("verifier:missing-asset-url");
    });

    it("mergeAudios / separateStems / isolateAudio inherit audio checks", () => {
      for (const name of ["studio.mergeAudios", "studio.separateStems", "studio.isolateAudio"]) {
        const r = verifyToolResult({
          toolName: name,
          data: { audio: { url: "https://cdn.fal.ai/x.wav", duration: 12 } },
        });
        expect(r.ok).toBe(true);
      }
    });
  });
});
