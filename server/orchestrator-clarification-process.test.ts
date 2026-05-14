/**
 * orchestrator-clarification-process.test.ts
 *
 * Pins the semantics of `processClarificationResponse` after the bridge
 * cleanup: only `format → goal` carries over to 總總's vocabulary; every
 * other wizard dimension stays under its own key so downstream prompt
 * assembly reads the user's precise pick instead of a lossy alias.
 */

import { describe, expect, it } from "vitest";

import { processClarificationResponse } from "./services/spiritTools/orchestratorTools";

describe("processClarificationResponse", () => {
  it("parses 總總 layer answers into orchestrator vocab", () => {
    const out = processClarificationResponse(
      "[總總澄清/goal]: 一支短影片（15-60 秒）"
    );
    expect(out).toEqual({ goal: "一支短影片（15-60 秒）" });
  });

  it("preserves wizard dimensions under their own key", () => {
    const out = processClarificationResponse(
      "[使用者澄清/style]: 電影感"
    );
    expect(out).toEqual({ style: "電影感" });
    // style must NOT silently land in 'complexity' — the old code did that
    // and made the orchestrator think it had clarified complexity.
    expect(out.complexity).toBeUndefined();
  });

  it("does not bridge platform → scope (semantic mismatch)", () => {
    const out = processClarificationResponse(
      "[使用者澄清/platform]: IG Reel 9:16"
    );
    expect(out).toEqual({ platform: "IG Reel 9:16" });
    expect(out.scope).toBeUndefined();
  });

  it("bridges format → goal because the two are semantically aligned", () => {
    const out = processClarificationResponse(
      "[使用者澄清/format]: 一張海報"
    );
    expect(out.format).toBe("一張海報");
    expect(out.goal).toBe("一張海報");
  });

  it("lets a more authoritative 總總/goal answer win over a wizard/format bridge", () => {
    const out = processClarificationResponse(
      "[總總澄清/goal]: 整套 campaign\n[使用者澄清/format]: 一張海報"
    );
    expect(out.goal).toBe("整套 campaign");
    // The wizard answer is still preserved under its own key for prompt
    // assembly — we only suppress the bridge.
    expect(out.format).toBe("一張海報");
  });

  it("ignores empty values and unknown markers", () => {
    const out = processClarificationResponse(
      "[總總澄清/scope]:   \n[使用者澄清/audience]: 品牌客戶"
    );
    expect(out.scope).toBeUndefined();
    expect(out.audience).toBe("品牌客戶");
  });

  it("returns {} for input with no clarification markers", () => {
    expect(processClarificationResponse("這只是一般的訊息")).toEqual({});
    expect(processClarificationResponse("")).toEqual({});
  });
});
