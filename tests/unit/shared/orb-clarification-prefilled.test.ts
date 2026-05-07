/**
 * tests/unit/shared/orb-clarification-prefilled.test.ts
 *
 * Verifies the new `prefilled` parameter on the wizard helpers — long-script
 * extraction can now stamp covered dimensions so the wizard skips them. Also
 * verifies that `buildContextualClarificationOptions` no longer defaults to
 * "format" when the modality is already known (the user complaint: when you
 * say 影片, the orb should ask 主題/長度/風格 — not "社群短片 vs 廣告片").
 */
import { describe, expect, it } from "vitest";
import {
  buildContextualClarificationOptions,
  buildMultiDimWizardClarification,
  buildWizardClarification,
  countMissingHighSignalDimensions,
  inferConversationDimensions,
  nextMissingDimension,
} from "../../../shared/orb-clarification-options";

describe("inferConversationDimensions — prefilled merge", () => {
  it("ORs prefilled signals over regex hits", () => {
    const sig = inferConversationDimensions(
      "幫我做一支影片",
      "video",
      undefined,
      { hasLength: true, hasSubject: true, hasStyle: true }
    );
    expect(sig.hasLength).toBe(true);
    expect(sig.hasSubject).toBe(true);
    expect(sig.hasStyle).toBe(true);
  });

  it("regex hits stay authoritative when prefilled is undefined", () => {
    // Use the "短片" length keyword the underlying regex actually catches —
    // \b boundaries after CJK chars are unreliable in JS, so the regex
    // checks for explicit length-format words instead.
    const sig = inferConversationDimensions("幫我做一支短片", "video");
    expect(sig.hasLength).toBe(true);
  });

  it("returns merged remembered + prefilled even on empty text", () => {
    const sig = inferConversationDimensions(
      "",
      "video",
      { hasStyle: true },
      { hasLength: true }
    );
    expect(sig.hasStyle).toBe(true);
    expect(sig.hasLength).toBe(true);
  });
});

describe("nextMissingDimension — prefilled skip", () => {
  it("skips length when prefilled hasLength=true on a video brief", () => {
    // Without prefill the wizard would ask "duration" first for video.
    expect(nextMissingDimension("做支影片", "video")).toBe("duration");
    // With prefill, duration is skipped — the wizard moves on to whatever
    // dimension is still missing.
    const next = nextMissingDimension("做支影片", "video", undefined, {
      hasLength: true,
    });
    expect(next).not.toBe("duration");
    expect(next).not.toBeNull();
  });

  it("skips multiple dimensions when prefilled covers them all", () => {
    expect(
      nextMissingDimension("做支影片", "video", undefined, {
        hasLength: true,
        hasSubject: true,
        hasStyle: true,
        hasPlatform: true,
      })
    ).toBeNull();
  });
});

describe("buildWizardClarification — prefilled passthrough", () => {
  it("returns null (wizard satisfied) when prefilled covers everything", () => {
    const result = buildWizardClarification("做支影片", "video", undefined, {
      hasLength: true,
      hasSubject: true,
      hasStyle: true,
      hasPlatform: true,
    });
    expect(result).toBeNull();
  });

  it("does not ask duration when length is prefilled", () => {
    const result = buildWizardClarification("做支影片", "video", undefined, {
      hasLength: true,
    });
    expect(result?.dimension).not.toBe("duration");
  });
});

describe("buildMultiDimWizardClarification — prefilled passthrough", () => {
  it("returns null when prefilled brings missing count below 3", () => {
    // Fresh "想做一支影片" misses subject/style/platform/purpose → 4 missing.
    // After prefill of subject + style, only platform + purpose remain (2).
    const result = buildMultiDimWizardClarification(
      "想做一支影片",
      "video",
      undefined,
      { hasLength: true, hasSubject: true, hasStyle: true }
    );
    expect(result).toBeNull();
  });
});

describe("countMissingHighSignalDimensions — prefilled affects count", () => {
  it("reduces the count when prefilled satisfies dimensions", () => {
    const baseline = countMissingHighSignalDimensions("想做支影片", "video");
    const withPrefill = countMissingHighSignalDimensions(
      "想做支影片",
      "video",
      undefined,
      { hasSubject: true, hasStyle: true }
    );
    expect(withPrefill).toBeLessThan(baseline);
  });
});

describe("buildContextualClarificationOptions — modality-aware default dimension", () => {
  it("does NOT default to 'format' when the user already said 影片", () => {
    // The user complaint: saying 影片 used to trigger format-bucket options
    // ("社群短片 vs 廣告 vs 紀錄"). Now we walk to the next missing dim.
    const out = buildContextualClarificationOptions({
      userText: "幫我做一支影片",
    });
    expect(out.modality).toBe("video");
    expect(out.dimension).not.toBe("format");
  });

  it("does default to 'format' when modality is genuinely unknown", () => {
    const out = buildContextualClarificationOptions({
      userText: "幫我",
    });
    expect(out.modality).toBe("unknown");
    expect(out.dimension).toBe("format");
  });

  it("respects an explicit dimension override", () => {
    const out = buildContextualClarificationOptions({
      userText: "幫我做一支影片",
      dimension: "format",
    });
    expect(out.dimension).toBe("format");
  });
});
