/**
 * Unit tests for shared/composer-imperative-parser.ts
 *
 * 編編 (composer) 在對話框被 @ 時的「自然語言 → AgentAction[]」解析器。
 * Goal: each common imperative the user might type lands as a concrete
 * AgentAction that respects the current page's capability surface.
 */

import { describe, expect, it } from "vitest";
import {
  parseComposerImperatives,
  describeComposerActions,
  describeComposerMissing,
} from "../../../shared/composer-imperative-parser";
import type { PageAgentSnapshot } from "../../../shared/agent-actions";

const imageStudioSnapshot: PageAgentSnapshot = {
  pageId: "image-studio",
  pageLabel: "Image Studio",
  pagePath: "/image-studio",
  availableModels: [
    "fal-ai/flux-pro/v1.1",
    "fal-ai/flux/schnell",
    "fal-ai/bytedance/seedream/v4/text-to-image",
  ],
  capabilities: [
    { action: "fillPrompt", label: "提示詞" },
    {
      action: "setModel",
      label: "模型",
      options: [
        { id: "fal-ai/flux-pro/v1.1", label: "FLUX Pro 1.1" },
        { id: "fal-ai/flux/schnell", label: "Schnell" },
      ],
    },
    { action: "setParam", label: "參數" },
    { action: "submit", label: "送出" },
  ],
};

const videoStudioSnapshot: PageAgentSnapshot = {
  pageId: "video-studio",
  pageLabel: "Video Studio",
  pagePath: "/video-studio",
  availableModels: [
    "fal-ai/kling-video/v2.1/pro/image-to-video",
    "fal-ai/wan-i2v",
  ],
  capabilities: [
    { action: "fillPrompt", label: "提示詞" },
    { action: "setModel", label: "模型" },
    { action: "setParam", label: "參數" },
    { action: "submit", label: "送出" },
  ],
};

const emptySnapshot: PageAgentSnapshot = {
  pageId: "agent",
  pageLabel: "Agent",
  pagePath: "/agent",
  capabilities: [],
};

describe("parseComposerImperatives — empty input", () => {
  it("returns matched=false for empty / whitespace text", () => {
    expect(parseComposerImperatives("", imageStudioSnapshot).matched).toBe(false);
    expect(parseComposerImperatives("   ", imageStudioSnapshot).matched).toBe(false);
  });

  it("emits no actions when the page has no capabilities", () => {
    const r = parseComposerImperatives("用 flux pro 送出", emptySnapshot);
    expect(r.actions).toHaveLength(0);
    expect(r.matched).toBe(false);
  });
});

describe("parseComposerImperatives — setModel", () => {
  it("picks fal-ai/flux-pro/v1.1 from 'flux pro' alias", () => {
    const r = parseComposerImperatives("換成 flux pro", imageStudioSnapshot);
    const setModel = r.actions.find(a => a.type === "setModel");
    expect(setModel).toBeDefined();
    if (setModel?.type === "setModel") {
      expect(setModel.modelId).toBe("fal-ai/flux-pro/v1.1");
    }
  });

  it("accepts an explicit fal-ai/... model id verbatim", () => {
    const r = parseComposerImperatives(
      "用 fal-ai/flux/schnell 跑",
      imageStudioSnapshot,
    );
    const setModel = r.actions.find(a => a.type === "setModel");
    expect(setModel).toBeDefined();
    if (setModel?.type === "setModel") {
      expect(setModel.modelId).toBe("fal-ai/flux/schnell");
    }
  });

  it("rejects models that are not in availableModels", () => {
    // Kling alias only works on video-studio, not image-studio.
    const r = parseComposerImperatives("用 kling pro 跑", imageStudioSnapshot);
    expect(r.actions.find(a => a.type === "setModel")).toBeUndefined();
  });

  it("'schnell' on image-studio routes to flux/schnell", () => {
    const r = parseComposerImperatives("快草稿一張", imageStudioSnapshot);
    const setModel = r.actions.find(a => a.type === "setModel");
    expect(setModel).toBeDefined();
    if (setModel?.type === "setModel") {
      expect(setModel.modelId).toBe("fal-ai/flux/schnell");
    }
  });
});

describe("parseComposerImperatives — setParam aspect", () => {
  it("parses 9:16 / 16:9 / 1:1 explicit ratios", () => {
    for (const [text, expected] of [
      ["比例 9:16", "9:16"],
      ["比例 16:9", "16:9"],
      ["比例 1:1", "1:1"],
    ]) {
      const r = parseComposerImperatives(text, imageStudioSnapshot);
      const setParam = r.actions.find(
        a => a.type === "setParam" && a.key === "aspect",
      );
      expect(setParam, `for "${text}"`).toBeDefined();
      if (setParam?.type === "setParam") {
        expect(setParam.value).toBe(expected);
      }
    }
  });

  it("maps 'reels' / 'tiktok' to 9:16", () => {
    const r = parseComposerImperatives("做 reels 用", imageStudioSnapshot);
    const sp = r.actions.find(a => a.type === "setParam" && a.key === "aspect");
    expect(sp?.type).toBe("setParam");
    if (sp?.type === "setParam") expect(sp.value).toBe("9:16");
  });
});

describe("parseComposerImperatives — duration", () => {
  it("captures '5 秒' / '10s' / '30 second'", () => {
    for (const [text, expected] of [
      ["5 秒", 5],
      ["跑 10s", 10],
      ["30 second teaser", 30],
    ] as const) {
      const r = parseComposerImperatives(text, videoStudioSnapshot);
      const sp = r.actions.find(
        a => a.type === "setParam" && a.key === "durationSec",
      );
      expect(sp, `for "${text}"`).toBeDefined();
      if (sp?.type === "setParam") expect(sp.value).toBe(expected);
    }
  });

  it("captures '2 分鐘' as 120 seconds", () => {
    const r = parseComposerImperatives("跑 2 分鐘", videoStudioSnapshot);
    const sp = r.actions.find(
      a => a.type === "setParam" && a.key === "durationSec",
    );
    expect(sp?.type).toBe("setParam");
    if (sp?.type === "setParam") expect(sp.value).toBe(120);
  });
});

describe("parseComposerImperatives — fillPrompt", () => {
  it("captures '提示詞改成 …' content", () => {
    const r = parseComposerImperatives(
      "提示詞改成 一隻橘貓在窗台逆光",
      imageStudioSnapshot,
    );
    const fp = r.actions.find(a => a.type === "fillPrompt");
    expect(fp).toBeDefined();
    if (fp?.type === "fillPrompt") {
      expect(fp.text).toContain("橘貓");
    }
  });

  it("captures 'prompt: …' content", () => {
    const r = parseComposerImperatives(
      "prompt: a hand-painted poster of mountains",
      imageStudioSnapshot,
    );
    const fp = r.actions.find(a => a.type === "fillPrompt");
    expect(fp).toBeDefined();
    if (fp?.type === "fillPrompt") {
      expect(fp.text).toContain("poster");
    }
  });
});

describe("parseComposerImperatives — submit", () => {
  it("pure '送出' submits when page has currentPrompt", () => {
    const r = parseComposerImperatives("送出", {
      ...imageStudioSnapshot,
      currentPrompt: "a cat",
    });
    expect(r.actions.find(a => a.type === "submit")).toBeDefined();
  });

  it("pure '送出' without any prompt → missing.prompt instead of submit", () => {
    const r = parseComposerImperatives("送出", imageStudioSnapshot);
    expect(r.actions.find(a => a.type === "submit")).toBeUndefined();
    expect(r.missing).toContain("prompt");
    expect(r.matched).toBe(true);
  });

  it("'換 flux pro 然後送出' chains setModel + submit", () => {
    const r = parseComposerImperatives(
      "換成 flux pro 然後送出",
      imageStudioSnapshot,
    );
    const types = r.actions.map(a => a.type);
    expect(types).toContain("setModel");
    expect(types).toContain("submit");
    // submit should come last so the model is set before the call goes out.
    expect(types.indexOf("submit")).toBeGreaterThan(types.indexOf("setModel"));
  });

  it("does not emit submit if the page has no submit capability", () => {
    const noSubmit: PageAgentSnapshot = {
      ...imageStudioSnapshot,
      capabilities: imageStudioSnapshot.capabilities.filter(
        c => c.action !== "submit",
      ),
    };
    const r = parseComposerImperatives("換 flux pro 然後送出", noSubmit);
    expect(r.actions.find(a => a.type === "submit")).toBeUndefined();
  });
});

describe("parseComposerImperatives — combined", () => {
  it("'用 flux pro 比例 9:16 提示詞改成 一隻貓 然後送出' → 4 actions in SOP order", () => {
    const r = parseComposerImperatives(
      "用 flux pro 比例 9:16 提示詞改成 一隻貓 然後送出",
      imageStudioSnapshot,
    );
    const types = r.actions.map(a => a.type);
    // SOP order: setModel → setParam → fillPrompt → submit
    expect(types).toEqual(["setModel", "setParam", "fillPrompt", "submit"]);
    expect(r.matched).toBe(true);
  });
});

describe("describeComposerActions", () => {
  it("returns a short bullet-summary for each action", () => {
    const text = describeComposerActions([
      { type: "setModel", modelId: "fal-ai/flux-pro/v1.1" },
      { type: "fillPrompt", text: "a cat" },
      { type: "submit" },
    ]);
    expect(text).toContain("模型切到");
    expect(text).toContain("提示詞已填");
    expect(text).toContain("送出");
  });

  it("returns empty string for empty input", () => {
    expect(describeComposerActions([])).toBe("");
  });
});

describe("describeComposerMissing", () => {
  it("describes a missing prompt", () => {
    const text = describeComposerMissing(["prompt"]);
    expect(text).toContain("提示詞");
  });

  it("returns empty string for empty input", () => {
    expect(describeComposerMissing([])).toBe("");
  });
});
