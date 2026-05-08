// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DIRECTOR_HANDOFF_STORAGE_KEY,
  buildDirectorHandoffPayload,
  readAndClearDirectorHandoff,
  writeDirectorHandoff,
} from "../../../client/src/lib/director-handoff";

describe("director-handoff helper", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useRealTimers();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  describe("buildDirectorHandoffPayload", () => {
    it("captures the latest user intent and orb reply", () => {
      const payload = buildDirectorHandoffPayload([
        { role: "user", text: "我想規劃一支冥想短片" },
        { role: "orb", text: "好的，我帶你過去導演 AI ✨" },
        { role: "user", text: "開始規劃腳本" },
      ]);

      expect(payload.source).toBe("agent_chat");
      expect(payload.userIntent).toBe("開始規劃腳本");
      expect(payload.orbReply).toBe("好的，我帶你過去導演 AI ✨");
      expect(payload.recentTurns).toHaveLength(3);
      expect(payload.recentTurns[0]).toEqual({
        role: "user",
        text: "我想規劃一支冥想短片",
      });
    });

    it("derives a topic from the first sentence of the user intent", () => {
      const payload = buildDirectorHandoffPayload([
        {
          role: "user",
          text: "我要拍一段森林冥想開場。背景是清晨，鳥聲。",
        },
      ]);
      expect(payload.topic).toBe("我要拍一段森林冥想開場");
    });

    it("falls back to a sliced topic when the intent has no sentence break", () => {
      const longIntent = "森林".repeat(60);
      const payload = buildDirectorHandoffPayload([
        { role: "user", text: longIntent },
      ]);
      expect(payload.topic?.length ?? 0).toBeLessThanOrEqual(80);
      expect(payload.topic).toBeTruthy();
    });

    it("ignores system messages and empty turns", () => {
      const payload = buildDirectorHandoffPayload([
        { role: "system", text: "你是導演 AI" },
        { role: "user", text: "" },
        { role: "user", text: "幫我寫腳本" },
      ]);
      expect(payload.userIntent).toBe("幫我寫腳本");
      expect(payload.recentTurns).toEqual([
        { role: "user", text: "幫我寫腳本" },
      ]);
    });

    it("clips overly long turns to keep the payload small", () => {
      const huge = "a".repeat(2000);
      const payload = buildDirectorHandoffPayload([
        { role: "user", text: huge },
      ]);
      expect(payload.userIntent.length).toBeLessThan(huge.length);
      expect(payload.userIntent.endsWith("…")).toBe(true);
    });

    it("keeps at most six recent turns", () => {
      const turns = Array.from({ length: 12 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "orb",
        text: `turn ${i}`,
      }));
      const payload = buildDirectorHandoffPayload(turns);
      expect(payload.recentTurns).toHaveLength(6);
      expect(payload.recentTurns[0].text).toBe("turn 6");
      expect(payload.recentTurns.at(-1)?.text).toBe("turn 11");
    });

    it("returns an empty userIntent when no user turn exists", () => {
      const payload = buildDirectorHandoffPayload([
        { role: "orb", text: "嗨 🌿" },
      ]);
      expect(payload.userIntent).toBe("");
      expect(payload.topic).toBeUndefined();
    });
  });

  describe("write/read round-trip", () => {
    it("writes to sessionStorage under the director handoff key", () => {
      const payload = buildDirectorHandoffPayload([
        { role: "user", text: "規劃腳本" },
      ]);
      writeDirectorHandoff(payload);
      const raw = sessionStorage.getItem(DIRECTOR_HANDOFF_STORAGE_KEY);
      expect(raw).toBeTruthy();
      expect(JSON.parse(raw!).userIntent).toBe("規劃腳本");
    });

    it("reads and clears the payload exactly once", () => {
      const payload = buildDirectorHandoffPayload([
        { role: "user", text: "規劃腳本" },
      ]);
      writeDirectorHandoff(payload);

      const first = readAndClearDirectorHandoff();
      expect(first?.userIntent).toBe("規劃腳本");
      expect(sessionStorage.getItem(DIRECTOR_HANDOFF_STORAGE_KEY)).toBeNull();

      const second = readAndClearDirectorHandoff();
      expect(second).toBeNull();
    });

    it("returns null when nothing has been written", () => {
      expect(readAndClearDirectorHandoff()).toBeNull();
    });

    it("ignores stale payloads older than 10 minutes", () => {
      const stale = buildDirectorHandoffPayload([
        { role: "user", text: "舊的請求" },
      ]);
      stale.at = Date.now() - 11 * 60 * 1000;
      sessionStorage.setItem(
        DIRECTOR_HANDOFF_STORAGE_KEY,
        JSON.stringify(stale),
      );
      expect(readAndClearDirectorHandoff()).toBeNull();
    });

    it("ignores payloads with the wrong source", () => {
      sessionStorage.setItem(
        DIRECTOR_HANDOFF_STORAGE_KEY,
        JSON.stringify({
          source: "image_studio",
          userIntent: "x",
          recentTurns: [],
          at: Date.now(),
        }),
      );
      expect(readAndClearDirectorHandoff()).toBeNull();
    });

    it("survives malformed JSON without throwing", () => {
      sessionStorage.setItem(DIRECTOR_HANDOFF_STORAGE_KEY, "{not json");
      expect(() => readAndClearDirectorHandoff()).not.toThrow();
      expect(readAndClearDirectorHandoff()).toBeNull();
    });
  });
});
