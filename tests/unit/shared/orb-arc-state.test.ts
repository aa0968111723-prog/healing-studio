/**
 * orb-arc-state.test.ts
 *
 * Regression coverage for the brainstorming-arc state machine. The arc
 * decides which of 6 steps the planner commits to, so subtle regressions
 * in the gate regex (TOPIC_ACK_HINTS_RE) or signal extraction cause the
 * orb to skip steps or re-ask answered dimensions. These cases are
 * derived from the bugs the post-shipping audit caught.
 */

import { describe, expect, it } from "vitest";
import { deriveOrbArcState } from "../../../shared/orb-arc-state";

describe("deriveOrbArcState", () => {
  const baseMessages = (userText: string) => [
    { role: "user" as const, content: userText },
  ];

  it("step 1 when context block present and orb has not acknowledged yet", () => {
    const state = deriveOrbArcState({
      messages: baseMessages("可以帶著我發想淡大禪學社的期末社大影片嗎？"),
      modality: "video",
      hasContextBlock: true,
    });
    expect(state.currentStep).toBe(1);
    expect(state.topicAcknowledged).toBe(false);
  });

  it("step 2 when topic acknowledged via 「我聽到」phrasing", () => {
    const state = deriveOrbArcState({
      messages: [
        { role: "user" as const, content: "可以幫我做淡大禪學社的期末影片嗎？" },
        {
          role: "assistant" as const,
          content: "我聽到這是淡江大學禪學社的期末成果片。先確認一下方向。",
        },
        { role: "user" as const, content: "好" },
      ],
      modality: "video",
      hasContextBlock: true,
    });
    expect(state.topicAcknowledged).toBe(true);
    expect(state.currentStep).toBe(2);
  });

  it("step 2 also recognises 「了解」 acknowledgement", () => {
    const state = deriveOrbArcState({
      messages: [
        { role: "user" as const, content: "幫我構思一支影片" },
        { role: "assistant" as const, content: "了解，這是你想要的方向…" },
        { role: "user" as const, content: "繼續" },
      ],
      modality: "video",
      hasContextBlock: true,
    });
    expect(state.topicAcknowledged).toBe(true);
  });

  it("step 3 once purpose answered but bundle unconfirmed", () => {
    const state = deriveOrbArcState({
      messages: [
        {
          role: "user" as const,
          content: "我要做招生宣傳影片，用途是給高中生看",
        },
      ],
      modality: "video",
      hasContextBlock: false,
    });
    expect(state.purposeAnswered).toBe(true);
    expect(state.modalityBundleAnswered).toBe(false);
    expect(state.currentStep).toBe(3);
  });

  it("step 4 once bundle answered via 「影片+海報+配樂」", () => {
    const state = deriveOrbArcState({
      messages: [
        {
          role: "user" as const,
          content: "招生宣傳影片，要影片+海報+配樂",
        },
      ],
      modality: "video",
      hasContextBlock: false,
    });
    expect(state.purposeAnswered).toBe(true);
    expect(state.modalityBundleAnswered).toBe(true);
    expect(state.currentStep).toBe(4);
  });

  it("recognises 「影片跟海報」 connector (跟)", () => {
    const state = deriveOrbArcState({
      messages: [
        {
          role: "user" as const,
          content: "做給粉絲看的招生影片跟海報",
        },
      ],
      modality: "video",
      hasContextBlock: false,
    });
    expect(state.modalityBundleAnswered).toBe(true);
  });

  it("recognises 「影片加配樂」 connector (加)", () => {
    const state = deriveOrbArcState({
      messages: [
        {
          role: "user" as const,
          content: "目的是招生宣傳，影片加配樂",
        },
      ],
      modality: "video",
      hasContextBlock: false,
    });
    expect(state.modalityBundleAnswered).toBe(true);
  });

  it("recognises 「只要影片」 exclusive bundle", () => {
    const state = deriveOrbArcState({
      messages: [
        {
          role: "user" as const,
          content: "招生用途，這次只要影片就好",
        },
      ],
      modality: "video",
      hasContextBlock: false,
    });
    expect(state.modalityBundleAnswered).toBe(true);
  });

  it("does NOT false-positive on 「影片跟我說」", () => {
    const state = deriveOrbArcState({
      messages: [
        {
          role: "user" as const,
          content: "想做品牌宣傳影片跟我說的故事有關",
        },
      ],
      modality: "video",
      hasContextBlock: false,
    });
    // "影片跟我說" has 跟 but no bundle noun after it — must not fire.
    expect(state.modalityBundleAnswered).toBe(false);
  });

  it("step 4 walks wizard dimensions in order — first missing is duration", () => {
    const state = deriveOrbArcState({
      messages: [
        {
          role: "user" as const,
          content: "招生宣傳，要影片+海報",
        },
      ],
      modality: "video",
      hasContextBlock: false,
    });
    expect(state.currentStep).toBe(4);
    expect(state.dimensions.duration).toBe(false);
  });

  it("step 5 once all wizard dimensions answered", () => {
    const state = deriveOrbArcState({
      messages: [
        {
          role: "user" as const,
          content:
            "招生宣傳影片+海報，30 秒，主題是禪學社年度回顧，電影感運鏡，投放 IG Reel 9:16",
        },
      ],
      modality: "video",
      hasContextBlock: false,
    });
    expect(state.currentStep).toBe(5);
    expect(state.dimensions.duration).toBe(true);
    expect(state.dimensions.style).toBe(true);
    expect(state.dimensions.platform).toBe(true);
  });
});
