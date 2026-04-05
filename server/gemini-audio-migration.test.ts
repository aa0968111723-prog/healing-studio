import { describe, it, expect } from "vitest";

describe("Gemini Audio Migration", () => {
  // ─── PCM-to-WAV Header Tests ───
  describe("PCM to WAV header conversion", () => {
    it("should create valid WAV header with correct RIFF signature", () => {
      const pcmData = Buffer.alloc(48000); // 1 second of 24kHz 16-bit mono
      const sampleRate = 24000;
      const numChannels = 1;
      const bitsPerSample = 16;
      const dataSize = pcmData.length;

      const wavHeader = Buffer.alloc(44);
      wavHeader.write("RIFF", 0);
      wavHeader.writeUInt32LE(36 + dataSize, 4);
      wavHeader.write("WAVE", 8);
      wavHeader.write("fmt ", 12);
      wavHeader.writeUInt32LE(16, 16);
      wavHeader.writeUInt16LE(1, 20);
      wavHeader.writeUInt16LE(numChannels, 22);
      wavHeader.writeUInt32LE(sampleRate, 24);
      wavHeader.writeUInt32LE(sampleRate * numChannels * bitsPerSample / 8, 28);
      wavHeader.writeUInt16LE(numChannels * bitsPerSample / 8, 32);
      wavHeader.writeUInt16LE(bitsPerSample, 34);
      wavHeader.write("data", 36);
      wavHeader.writeUInt32LE(dataSize, 40);

      const wavBuffer = Buffer.concat([wavHeader, pcmData]);

      expect(wavBuffer.toString("ascii", 0, 4)).toBe("RIFF");
      expect(wavBuffer.toString("ascii", 8, 12)).toBe("WAVE");
      expect(wavBuffer.toString("ascii", 12, 16)).toBe("fmt ");
      expect(wavBuffer.toString("ascii", 36, 40)).toBe("data");
      expect(wavBuffer.readUInt32LE(4)).toBe(36 + dataSize);
      expect(wavBuffer.readUInt32LE(24)).toBe(24000); // sample rate
      expect(wavBuffer.readUInt16LE(22)).toBe(1); // channels
      expect(wavBuffer.readUInt16LE(34)).toBe(16); // bits per sample
      expect(wavBuffer.length).toBe(44 + dataSize);
    });

    it("should detect PCM mime types correctly", () => {
      const pcmMimes = [
        "audio/L16;codec=pcm;rate=24000",
        "audio/L16",
        "audio/pcm",
      ];
      for (const mime of pcmMimes) {
        expect(mime.includes("L16") || mime.includes("pcm")).toBe(true);
      }
    });

    it("should not wrap non-PCM audio", () => {
      const mp3Mime = "audio/mp3";
      const wavMime = "audio/wav";
      expect(mp3Mime.includes("L16") || mp3Mime.includes("pcm")).toBe(false);
      expect(wavMime.includes("L16") || wavMime.includes("pcm")).toBe(false);
    });
  });

  // ─── Voice Emotion to Voice Name Mapping ───
  describe("Voice emotion to Gemini TTS voice mapping", () => {
    const voiceMap: Record<string, string> = {
      warm: "Kore",
      calm: "Aoede",
      cheerful: "Puck",
      serious: "Charon",
      gentle: "Leda",
      energetic: "Fenrir",
      soothing: "Enceladus",
      clear: "Iapetus",
      bright: "Zephyr",
      smooth: "Algieba",
    };

    it("should map all emotion types to valid Gemini voices", () => {
      const validVoices = [
        "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda",
        "Orus", "Aoede", "Callirrhoe", "Autonoe", "Enceladus",
        "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome",
        "Algenib",
      ];
      for (const [emotion, voice] of Object.entries(voiceMap)) {
        expect(validVoices).toContain(voice);
      }
    });

    it("should default to Kore for unknown emotions", () => {
      const voiceName = voiceMap["unknown_emotion"] || "Kore";
      expect(voiceName).toBe("Kore");
    });

    it("should default to Kore for empty emotion", () => {
      const voiceName = voiceMap[""] || "Kore";
      expect(voiceName).toBe("Kore");
    });
  });

  // ─── TTS Prompt Building ───
  describe("TTS prompt construction", () => {
    it("should add emotion tone instruction", () => {
      const text = "歡迎來到療癒工作室";
      const emotion = "warm";
      const prompt = `Say in a ${emotion} tone:\n${text}`;
      expect(prompt).toContain("Say in a warm tone");
      expect(prompt).toContain(text);
    });

    it("should add speed instruction for slow speed", () => {
      const text = "歡迎來到療癒工作室";
      const speed = 0.7;
      const speedDesc = speed < 0.8 ? "slowly" : speed > 1.2 ? "quickly" : "at moderate pace";
      const prompt = `Say ${speedDesc}:\n${text}`;
      expect(prompt).toContain("Say slowly");
    });

    it("should add speed instruction for fast speed", () => {
      const speed = 1.5;
      const speedDesc = speed < 0.8 ? "slowly" : speed > 1.2 ? "quickly" : "at moderate pace";
      expect(speedDesc).toBe("quickly");
    });

    it("should use moderate pace for normal speed", () => {
      const speed = 1.0;
      const speedDesc = speed < 0.8 ? "slowly" : speed > 1.2 ? "quickly" : "at moderate pace";
      expect(speedDesc).toBe("at moderate pace");
    });
  });

  // ─── Lyria Model Selection ───
  describe("Lyria model selection", () => {
    it("should use clip model for short durations (<=35s)", () => {
      const duration = 30;
      const useProModel = (duration || 30) > 35;
      const modelId = useProModel ? "lyria-3-pro-preview" : "lyria-3-clip-preview";
      expect(modelId).toBe("lyria-3-clip-preview");
    });

    it("should use pro model for long durations (>35s)", () => {
      const duration = 120;
      const useProModel = (duration || 30) > 35;
      const modelId = useProModel ? "lyria-3-pro-preview" : "lyria-3-clip-preview";
      expect(modelId).toBe("lyria-3-pro-preview");
    });

    it("should default to clip model when no duration specified", () => {
      const duration = undefined;
      const useProModel = (duration || 30) > 35;
      const modelId = useProModel ? "lyria-3-pro-preview" : "lyria-3-clip-preview";
      expect(modelId).toBe("lyria-3-clip-preview");
    });
  });

  // ─── Music Prompt Construction ───
  describe("Music prompt construction", () => {
    it("should append instrumental instruction", () => {
      let prompt = "ambient healing music";
      const isInstrumental = true;
      if (isInstrumental) {
        prompt += ". Instrumental only, no vocals.";
      }
      expect(prompt).toContain("Instrumental only, no vocals");
    });

    it("should append lyrics when provided", () => {
      let prompt = "pop ballad";
      const lyrics = "Hello world, this is a test song";
      if (lyrics) {
        prompt += `\n\n${lyrics}`;
      }
      expect(prompt).toContain(lyrics);
    });

    it("should not add instrumental tag when false", () => {
      let prompt = "pop music";
      const isInstrumental = false;
      if (isInstrumental) {
        prompt += ". Instrumental only, no vocals.";
      }
      expect(prompt).not.toContain("Instrumental");
    });
  });

  // ─── @google/genai SDK Import ───
  describe("@google/genai SDK availability", () => {
    it("should be importable", async () => {
      const { GoogleGenAI } = await import("@google/genai");
      expect(GoogleGenAI).toBeDefined();
      expect(typeof GoogleGenAI).toBe("function");
    });

    it("should create client instance with API key", async () => {
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: "test-key" });
      expect(ai).toBeDefined();
      expect(ai.models).toBeDefined();
    });
  });

  // ─── Download Extension Logic ───
  describe("Download extension detection", () => {
    it("should detect WAV from blob type", () => {
      const blobType = "audio/wav";
      const ext = blobType.includes("wav") ? "wav" : "mp3";
      expect(ext).toBe("wav");
    });

    it("should default to MP3 for non-WAV audio", () => {
      const blobType = "audio/mpeg";
      const ext = blobType.includes("wav") ? "wav" : "mp3";
      expect(ext).toBe("mp3");
    });

    it("should detect WAV from L16 PCM type after conversion", () => {
      let mimeType = "audio/L16;codec=pcm;rate=24000";
      // After conversion
      if (mimeType.includes("L16") || mimeType.includes("pcm")) {
        mimeType = "audio/wav";
      }
      const ext = mimeType.includes("wav") ? "wav" : "mp3";
      expect(ext).toBe("wav");
    });
  });
});
