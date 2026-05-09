/**
 * Unit tests for the ProactiveEventBus — used by 財財 / 巧巧 / 守守
 * 「主動關心」精靈。涵蓋 subscribe / publish / unsubscribe / dedupe。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProactiveEventBus } from "../../../client/src/lib/proactiveEventBus";

afterEach(() => {
  ProactiveEventBus.reset();
});

describe("ProactiveEventBus", () => {
  it("delivers payload to a subscribed listener", () => {
    const handler = vi.fn();
    ProactiveEventBus.subscribe("prompt_too_short", handler);
    ProactiveEventBus.publish("prompt_too_short", {
      prompt: "好",
      suggestedAddition: "場景",
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ prompt: "好", suggestedAddition: "場景" });
  });

  it("supports multiple listeners on the same event", () => {
    const a = vi.fn();
    const b = vi.fn();
    ProactiveEventBus.subscribe("site_error_detected", a);
    ProactiveEventBus.subscribe("site_error_detected", b);
    ProactiveEventBus.publish("site_error_detected", {
      endpoint: "ai.chat",
      errorCode: 500,
      workaround: "重試",
    });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe stops further deliveries", () => {
    const handler = vi.fn();
    const unsub = ProactiveEventBus.subscribe("prompt_too_short", handler);
    ProactiveEventBus.publish("prompt_too_short", { prompt: "a", suggestedAddition: "b" });
    unsub();
    ProactiveEventBus.publish(
      "prompt_too_short",
      { prompt: "c", suggestedAddition: "d" },
      { dedupeKey: "different" }
    );
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("dedupes identical events within window", () => {
    const handler = vi.fn();
    ProactiveEventBus.subscribe("prompt_too_short", handler);
    const first = ProactiveEventBus.publish(
      "prompt_too_short",
      { prompt: "好", suggestedAddition: "場景" },
      { dedupeKey: "abc", dedupeMs: 60_000 }
    );
    const second = ProactiveEventBus.publish(
      "prompt_too_short",
      { prompt: "好", suggestedAddition: "場景" },
      { dedupeKey: "abc", dedupeMs: 60_000 }
    );
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("different dedupeKeys do NOT collide", () => {
    const handler = vi.fn();
    ProactiveEventBus.subscribe("prompt_too_short", handler);
    ProactiveEventBus.publish(
      "prompt_too_short",
      { prompt: "a", suggestedAddition: "x" },
      { dedupeKey: "k1" }
    );
    ProactiveEventBus.publish(
      "prompt_too_short",
      { prompt: "b", suggestedAddition: "y" },
      { dedupeKey: "k2" }
    );
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("listener exception does not break other listeners", () => {
    const exploding = vi.fn(() => {
      throw new Error("boom");
    });
    const survivor = vi.fn();
    ProactiveEventBus.subscribe("monthly_spend_threshold", exploding);
    ProactiveEventBus.subscribe("monthly_spend_threshold", survivor);
    ProactiveEventBus.publish("monthly_spend_threshold", {
      usedPct: 95,
      remainingCredits: 10,
      topModel: "x",
    });
    expect(exploding).toHaveBeenCalledTimes(1);
    expect(survivor).toHaveBeenCalledTimes(1);
  });

  it("publish on event with no listeners is a no-op (returns true after dedupe gate)", () => {
    expect(
      ProactiveEventBus.publish("feature_not_used", { featureName: "x" })
    ).toBe(true);
  });
});
