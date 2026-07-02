/**
 * Brain Context Middleware — Vitest Tests
 * ────────────────────────────────────────────────────────────────────────────
 * 測試範圍：
 *   1. 預設值建構（無 DB 記錄時）
 *   2. Health Ping 快取機制
 *   3. Graceful Degradation 降級邏輯
 *   4. BrainAuditLogger 日誌輸出
 *   5. 外部故障報告 API
 *   6. BrainContext helper 方法
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock DB before importing the module ─────────────────────────────────────

vi.mock("../drizzle/schema", () => ({
  userAiBrain: { userId: "userId" },
}));

let mockDbResult: unknown[] = [];
let mockDbAvailable = true;

vi.mock("./db", () => ({
  getDb: vi.fn(async () => {
    if (!mockDbAvailable) return null;
    return {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(mockDbResult),
          }),
        }),
      }),
    };
  }),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => ({})),
}));

// Now import the module under test
import {
  buildBrainContext,
  getHealthStatus,
  reportEngineFailure,
  reportEngineRecovery,
  getHealthSnapshot,
  BrainAuditLogger,
  DEFAULT_REASONING_BRAINS,
  DEFAULT_GENERATION_ENGINES,
  getActiveDefaultBrains,
  getActiveDefaultEngines,
  type BrainContext,
  type ReasoningBrainSlot,
  type GenerationEngineSlot,
} from "./middleware/brainContext";

// ═══════════════════════════════════════════════════════════════════════════

describe("Brain Context Middleware", () => {
  beforeEach(() => {
    mockDbResult = [];
    mockDbAvailable = true;
    vi.restoreAllMocks();
  });

  // ─── Default Configuration ──────────────────────────────────────────────

  describe("Default Configuration (no DB record)", () => {
    it("should return default brain config when user has no custom config", async () => {
      const brain = await buildBrainContext(999);

      expect(brain.hasCustomConfig).toBe(false);

      // 5 reasoning brains
      const brainSlots: ReasoningBrainSlot[] = [
        "director",
        "analyst",
        "storyteller",
        "technician",
        "curator",
      ];
      const activeReasoningDefaults = getActiveDefaultBrains();
      const activeEngineDefaults = getActiveDefaultEngines();
      for (const slot of brainSlots) {
        const config = brain.getBrain(slot);
        expect(config.slot).toBe(slot);
        expect(config.model).toBe(activeReasoningDefaults[slot].model);
        expect(config.temperature).toBe(
          activeReasoningDefaults[slot].temperature
        );
        expect(config.topP).toBe(activeReasoningDefaults[slot].topP);
        expect(config.enabled).toBe(true);
        expect(config.systemPrompt).toBeNull();
      }

      // 4 generation engines
      const engineSlots: GenerationEngineSlot[] = [
        "imageEngine",
        "videoEngine",
        "audioEngine",
        "voiceEngine",
      ];
      for (const slot of engineSlots) {
        const config = brain.getEngine(slot);
        expect(config.slot).toBe(slot);
        expect(config.engine).toBe(activeEngineDefaults[slot].engine);
        expect(config.enabled).toBe(true);
      }
    });

    it("should return all 5 healthy brains and 4 healthy engines by default", async () => {
      const brain = await buildBrainContext(999);

      expect(brain.getHealthyBrains().length).toBe(5);
      expect(brain.getHealthyEngines().length).toBe(4);
    });

    it("should have empty degradation summary when all healthy", async () => {
      const brain = await buildBrainContext(999);
      expect(brain.degradationSummary).toHaveLength(0);
    });
  });

  // ─── DB Fallback ────────────────────────────────────────────────────────

  describe("DB Fallback", () => {
    it("should gracefully fall back to defaults when DB is unavailable", async () => {
      mockDbAvailable = false;
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const brain = await buildBrainContext(123);

      expect(brain.hasCustomConfig).toBe(false);
      // economy 分層（PREFER_CHEAP_MODELS=economy 預設）
      const activeB = getActiveDefaultBrains();
      const activeE = getActiveDefaultEngines();
      expect(brain.getBrain("director").model).toBe(activeB.director.model);
      expect(brain.getBrain("analyst").model).toBe(activeB.analyst.model);
      expect(brain.getEngine("imageEngine").engine).toBe(activeE.imageEngine.engine);

      warnSpy.mockRestore();
    });
  });

  // ─── Custom Configuration from DB ───────────────────────────────────────

  describe("Custom Configuration from DB", () => {
    it("should read custom brain config from DB row", async () => {
      mockDbResult = [
        {
          id: 1,
          userId: 42,
          directorModel: "claude-3.5-sonnet",
          directorTemperature: "0.5",
          directorTopP: "0.85",
          directorSystemPrompt: "You are a film director.",
          directorEnabled: true,
          analystModel: "gpt-4o",
          analystTemperature: "0.3",
          analystTopP: "0.8",
          analystSystemPrompt: null,
          analystEnabled: true,
          storytellerModel: "gpt-4o",
          storytellerTemperature: "0.9",
          storytellerTopP: "0.95",
          storytellerSystemPrompt: null,
          storytellerEnabled: false,
          technicianModel: "gpt-4o",
          technicianTemperature: "0.2",
          technicianTopP: "0.7",
          technicianSystemPrompt: null,
          technicianEnabled: true,
          curatorModel: "gpt-4o",
          curatorTemperature: "0.8",
          curatorTopP: "0.9",
          curatorSystemPrompt: null,
          curatorEnabled: true,
          imageEngine: "dall-e-3",
          imageEngineParams: { steps: 50 },
          imageEngineEnabled: true,
          videoEngine: "kling-v1",
          videoEngineParams: null,
          videoEngineEnabled: true,
          audioEngine: "suno-v4",
          audioEngineParams: null,
          audioEngineEnabled: true,
          voiceEngine: "elevenlabs-v2",
          voiceEngineParams: null,
          voiceEngineEnabled: true,
          globalPreferences: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const brain = await buildBrainContext(42);

      expect(brain.hasCustomConfig).toBe(true);
      expect(brain.getBrain("director").model).toBe("claude-3.5-sonnet");
      expect(brain.getBrain("director").temperature).toBe(0.5);
      expect(brain.getBrain("director").topP).toBe(0.85);
      expect(brain.getBrain("director").systemPrompt).toBe(
        "You are a film director."
      );
      expect(brain.getBrain("storyteller").enabled).toBe(false);
      expect(brain.getEngine("imageEngine").engine).toBe("dall-e-3");
      expect(brain.getEngine("imageEngine").params).toEqual({ steps: 50 });
    });
  });

  // ─── Health Ping ────────────────────────────────────────────────────────

  describe("Health Ping", () => {
    it("should return true for known models", () => {
      expect(getHealthStatus("gpt-4o")).toBe(true);
      expect(getHealthStatus("flux-pro")).toBe(true);
      expect(getHealthStatus("suno-v4")).toBe(true);
    });

    it("should optimistically return true for unknown models on first check", () => {
      // First check with no cache → optimistic true
      expect(getHealthStatus("totally-unknown-model-xyz")).toBe(true);
    });
  });

  // ─── Engine Failure / Recovery Reporting ────────────────────────────────

  describe("Engine Failure / Recovery Reporting", () => {
    it("should mark engine as unhealthy after MAX_CONSECUTIVE_FAILURES", () => {
      const model = "test-engine-failure";
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Report 3 consecutive failures (MAX_CONSECUTIVE_FAILURES = 3)
      reportEngineFailure(model, "Connection refused");
      reportEngineFailure(model, "Connection refused");
      reportEngineFailure(model, "Connection refused");

      const snapshot = getHealthSnapshot();
      expect(snapshot[model]).toBeDefined();
      expect(snapshot[model].healthy).toBe(false);
      expect(snapshot[model].consecutiveFailures).toBe(3);

      errorSpy.mockRestore();
    });

    it("should restore health after reportEngineRecovery", () => {
      const model = "test-engine-recovery";
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      reportEngineFailure(model, "Timeout");
      reportEngineFailure(model, "Timeout");
      reportEngineFailure(model, "Timeout");

      expect(getHealthSnapshot()[model].healthy).toBe(false);

      reportEngineRecovery(model);

      expect(getHealthSnapshot()[model].healthy).toBe(true);
      expect(getHealthSnapshot()[model].consecutiveFailures).toBe(0);

      errorSpy.mockRestore();
      logSpy.mockRestore();
    });
  });

  // ─── Graceful Degradation ───────────────────────────────────────────────

  describe("Graceful Degradation", () => {
    it("should degrade to fallback when primary engine is unhealthy", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      // Make "fal-ai/flux/dev" unhealthy
      reportEngineFailure("fal-ai/flux/dev", "API 503");
      reportEngineFailure("fal-ai/flux/dev", "API 503");
      reportEngineFailure("fal-ai/flux/dev", "API 503");

      // Set user config with fal-ai/flux/dev as image engine
      mockDbResult = [
        {
          id: 1,
          userId: 50,
          directorModel: "gpt-4o",
          directorTemperature: "0.7",
          directorTopP: "0.9",
          directorSystemPrompt: null,
          directorEnabled: true,
          analystModel: "gpt-4o",
          analystTemperature: "0.3",
          analystTopP: "0.8",
          analystSystemPrompt: null,
          analystEnabled: true,
          storytellerModel: "gpt-4o",
          storytellerTemperature: "0.9",
          storytellerTopP: "0.95",
          storytellerSystemPrompt: null,
          storytellerEnabled: true,
          technicianModel: "gpt-4o",
          technicianTemperature: "0.2",
          technicianTopP: "0.7",
          technicianSystemPrompt: null,
          technicianEnabled: true,
          curatorModel: "gpt-4o",
          curatorTemperature: "0.8",
          curatorTopP: "0.9",
          curatorSystemPrompt: null,
          curatorEnabled: true,
          imageEngine: "fal-ai/flux/dev",
          imageEngineParams: null,
          imageEngineEnabled: true,
          videoEngine: "fal-ai/kling-video/v2.1/pro/text-to-video",
          videoEngineParams: null,
          videoEngineEnabled: true,
          audioEngine: "fal-ai/stable-audio",
          audioEngineParams: null,
          audioEngineEnabled: true,
          voiceEngine: "fal-ai/metavoice-v1",
          voiceEngineParams: null,
          voiceEngineEnabled: true,
          globalPreferences: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const brain = await buildBrainContext(50);

      // Image engine should be degraded since fal-ai/flux/dev is unhealthy
      const imgEngine = brain.getEngine("imageEngine");
      expect(imgEngine.degraded).toBe(true);
      expect(imgEngine.originalEngine).toBe("fal-ai/flux/dev");
      // Should fall back to fal-ai/flux-pro/v1.1 (first in fal-ai/flux/dev's fallback chain)
      expect(imgEngine.engine).toBe("fal-ai/flux-pro/v1.1");

      // Degradation summary should have 1 event
      expect(brain.degradationSummary.length).toBeGreaterThanOrEqual(1);
      const imgDeg = brain.degradationSummary.find(
        d => d.slot === "imageEngine"
      );
      expect(imgDeg).toBeDefined();
      expect(imgDeg!.originalModel).toBe("fal-ai/flux/dev");
      expect(imgDeg!.fallbackModel).toBe("fal-ai/flux-pro/v1.1");

      errorSpy.mockRestore();
      warnSpy.mockRestore();
      logSpy.mockRestore();
    });
  });

  // ─── BrainAuditLogger ──────────────────────────────────────────────────

  describe("BrainAuditLogger", () => {
    it("should log config loaded event", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      BrainAuditLogger.configLoaded(42, true);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("[BrainContext]")
      );
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("userId=42"));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("custom"));
      logSpy.mockRestore();
    });

    it("should log degradation event", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      BrainAuditLogger.degradation({
        slot: "imageEngine",
        originalModel: "dall-e-3",
        fallbackModel: "flux-pro",
        reason: "API 503",
        timestamp: Date.now(),
      });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("DEGRADATION")
      );
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("dall-e-3"));
      warnSpy.mockRestore();
    });

    it("should log engine failure event", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      BrainAuditLogger.engineFailure("suno-v4", "Rate limited", 2);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("ENGINE_FAILURE")
      );
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("suno-v4"));
      errorSpy.mockRestore();
    });

    it("should log engine recovery event", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      BrainAuditLogger.engineRecovery("suno-v4");
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("ENGINE_RECOVERY")
      );
      logSpy.mockRestore();
    });

    it("should log DB fallback event", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      BrainAuditLogger.dbFallback(42, "ECONNREFUSED");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("DB_FALLBACK")
      );
      warnSpy.mockRestore();
    });

    it("should log request summary", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      BrainAuditLogger.requestSummary(42, 0, 5, 4);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("ALL_HEALTHY")
      );
      logSpy.mockRestore();
    });

    it("should log degraded request summary", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      BrainAuditLogger.requestSummary(42, 2, 3, 3);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("DEGRADED(2)")
      );
      logSpy.mockRestore();
    });
  });

  // ─── BrainContext Helper Methods ────────────────────────────────────────

  describe("BrainContext Helper Methods", () => {
    it("getBrain should return correct slot config", async () => {
      const brain = await buildBrainContext(999);
      const director = brain.getBrain("director");
      expect(director.slot).toBe("director");
      // economy 分層（PREFER_CHEAP_MODELS=economy 預設）：director 使用 gemini-2.5-pro
      // 省成本；設 PREFER_CHEAP_MODELS=balanced 回現狀 claude-opus-4.7。
      expect(director.model).toBe(getActiveDefaultBrains().director.model);
    });

    it("getEngine should return correct slot config", async () => {
      const brain = await buildBrainContext(999);
      const imgEngine = brain.getEngine("imageEngine");
      expect(imgEngine.slot).toBe("imageEngine");
      // economy 分層預設：flux/schnell（省成本）；balanced = flux-pro/v1.1。
      expect(imgEngine.engine).toBe(getActiveDefaultEngines().imageEngine.engine);
    });

    it("getHealthyBrains should filter disabled brains", async () => {
      mockDbResult = [
        {
          id: 1,
          userId: 60,
          directorModel: "gpt-4o",
          directorTemperature: "0.7",
          directorTopP: "0.9",
          directorSystemPrompt: null,
          directorEnabled: false, // disabled
          analystModel: "gpt-4o",
          analystTemperature: "0.3",
          analystTopP: "0.8",
          analystSystemPrompt: null,
          analystEnabled: true,
          storytellerModel: "gpt-4o",
          storytellerTemperature: "0.9",
          storytellerTopP: "0.95",
          storytellerSystemPrompt: null,
          storytellerEnabled: true,
          technicianModel: "gpt-4o",
          technicianTemperature: "0.2",
          technicianTopP: "0.7",
          technicianSystemPrompt: null,
          technicianEnabled: true,
          curatorModel: "gpt-4o",
          curatorTemperature: "0.8",
          curatorTopP: "0.9",
          curatorSystemPrompt: null,
          curatorEnabled: true,
          imageEngine: "flux-pro",
          imageEngineParams: null,
          imageEngineEnabled: true,
          videoEngine: "kling-v1",
          videoEngineParams: null,
          videoEngineEnabled: false, // disabled
          audioEngine: "suno-v4",
          audioEngineParams: null,
          audioEngineEnabled: true,
          voiceEngine: "elevenlabs-v2",
          voiceEngineParams: null,
          voiceEngineEnabled: true,
          globalPreferences: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const brain = await buildBrainContext(60);

      // Director disabled → 4 healthy brains
      expect(brain.getHealthyBrains().length).toBe(4);
      // Video disabled → 3 healthy engines
      expect(brain.getHealthyEngines().length).toBe(3);
    });
  });

  // ─── Health Snapshot ────────────────────────────────────────────────────

  describe("Health Snapshot", () => {
    it("should return a snapshot of all cached health states", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      reportEngineFailure("snapshot-test-model", "Test error");
      const snapshot = getHealthSnapshot();

      expect(snapshot["snapshot-test-model"]).toBeDefined();
      expect(snapshot["snapshot-test-model"].lastError).toBe("Test error");

      errorSpy.mockRestore();
      logSpy.mockRestore();
    });
  });

  // ─── PREFER_CHEAP_MODELS tiers (AIDV-938) ───────────────────────────────

  describe("PREFER_CHEAP_MODELS tiers", () => {
    const ORIGINAL = process.env.PREFER_CHEAP_MODELS;

    afterEach(() => {
      if (ORIGINAL === undefined) delete process.env.PREFER_CHEAP_MODELS;
      else process.env.PREFER_CHEAP_MODELS = ORIGINAL;
    });

    it("premium tier reasoning brains equal balanced (AIDV-856 規格：同 balanced)", () => {
      process.env.PREFER_CHEAP_MODELS = "premium";
      expect(getActiveDefaultBrains()).toEqual(DEFAULT_REASONING_BRAINS);
    });

    it("premium tier upgrades videoEngine to Kling Pro t2v, voiceEngine to ElevenLabs Multilingual v2, and audioEngine to Suno V4 (AIDV-956)", () => {
      process.env.PREFER_CHEAP_MODELS = "premium";
      const engines = getActiveDefaultEngines();
      expect(engines.videoEngine.engine).toBe(
        "fal-ai/kling-video/v2.1/pro/text-to-video"
      );
      expect(engines.voiceEngine.engine).toBe(
        "fal-ai/elevenlabs/tts/multilingual-v2"
      );
      // AIDV-956：audioEngine 依 AIDV-856 規格表升級 suno-v4（Suno 已接成
      // MusicModelChoice 選項，非「宣稱 X 實際 Y」）
      expect(engines.audioEngine.engine).toBe("suno-v4");
      // imageEngine 同 balanced（flux-pro/v1.1 已是最高階圖像選項）
      expect(engines.imageEngine.engine).toBe(
        DEFAULT_GENERATION_ENGINES.imageEngine.engine
      );
    });

    it("premium tier never silently downgrades reasoning brains to the economy (gemini) models", () => {
      process.env.PREFER_CHEAP_MODELS = "premium";
      const brains = getActiveDefaultBrains();
      for (const slot of Object.keys(brains) as ReasoningBrainSlot[]) {
        expect(brains[slot].model).not.toContain("gemini");
      }
    });

    it("unknown PREFER_CHEAP_MODELS value falls back to economy and warns exactly once per value (not once per getActiveDefault* call)", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      process.env.PREFER_CHEAP_MODELS = "ultra-aidv938";

      const brains = getActiveDefaultBrains();
      const engines = getActiveDefaultEngines();

      expect(brains.director.model).toBe("google/gemini-2.5-pro");
      expect(engines.imageEngine.engine).toBe("fal-ai/flux/schnell");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unknown PREFER_CHEAP_MODELS="ultra-aidv938"')
      );
      // getActiveDefaultBrains() + getActiveDefaultEngines() both resolve the
      // tier internally — must dedup to 1 warn, not 2, per request.
      expect(warnSpy).toHaveBeenCalledTimes(1);

      // Calling again with the same unknown value must not re-warn.
      getActiveDefaultBrains();
      expect(warnSpy).toHaveBeenCalledTimes(1);

      // A *different* unknown value must warn again.
      process.env.PREFER_CHEAP_MODELS = "ultra-aidv938-v2";
      getActiveDefaultBrains();
      expect(warnSpy).toHaveBeenCalledTimes(2);

      warnSpy.mockRestore();
    });

    it("unset PREFER_CHEAP_MODELS still defaults to economy without warning", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      delete process.env.PREFER_CHEAP_MODELS;

      expect(getActiveDefaultBrains().director.model).toBe("google/gemini-2.5-pro");
      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  // ─── Default Constants ──────────────────────────────────────────────────

  describe("Default Constants", () => {
    it("should have 5 default reasoning brains", () => {
      expect(Object.keys(DEFAULT_REASONING_BRAINS)).toHaveLength(5);
    });

    it("should have 4 default generation engines", () => {
      expect(Object.keys(DEFAULT_GENERATION_ENGINES)).toHaveLength(4);
    });

    it("default reasoning brains should have valid temperature ranges", () => {
      for (const [, config] of Object.entries(DEFAULT_REASONING_BRAINS)) {
        expect(config.temperature).toBeGreaterThanOrEqual(0);
        expect(config.temperature).toBeLessThanOrEqual(1);
        expect(config.topP).toBeGreaterThanOrEqual(0);
        expect(config.topP).toBeLessThanOrEqual(1);
      }
    });
  });
});
