/**
 * global-agent-core.test.ts — 全站 AI 代理核心純邏輯測試
 *
 * 覆蓋：
 *   - GlobalAgentRegistry：頁面註冊、能力查找、當頁優先、跨頁路由計畫
 *   - global-agent-workflows：runWorkflow 輕量步驟 → 嚴格 AgentAction
 *   - global-agent-orchestrator：workflow 逐步 navigate + dispatch
 *
 * 這些測試不依賴 React / DOM / API Key，可在 Vitest node 環境直接執行。
 */
import { describe, expect, it, beforeEach } from "vitest";
import { adaptAgentPlanToActions, type AgentAction, type PageAgentSnapshot } from "../shared/agent-actions";
import { GlobalAgentRegistry, globalAgentRegistry } from "../shared/global-agent-registry";
import {
  buildImageWorkflow,
  buildLongVideoWorkflow,
  buildMusicWorkflow,
  buildScriptOnlyWorkflow,
  buildSfxWorkflow,
  buildShortVideoWorkflow,
  buildVoiceWorkflow,
  detectCreationIntent,
  detectVideoIntent,
  expandWorkflowAction,
  inferLongVideoChapters,
  maybeCreateWorkflowFromUserText,
  workflowStepToAction,
} from "../shared/global-agent-workflows";
import {
  GLOBAL_AGENT_CAPABILITY_REGISTRY,
  hasCapabilityForPage,
} from "../shared/global-agent-capabilities";
import {
  executeGlobalAction,
  executeGlobalActions,
  executeGlobalWorkflow,
  findDangerousWorkflowSteps,
  shouldAskBeforeAct,
} from "../shared/global-agent-orchestrator";

function makePage(id: string, path: string, label: string, actions: AgentAction["type"][]): PageAgentSnapshot {
  return {
    pageId: id,
    pagePath: path,
    pageLabel: label,
    capabilities: actions.map(action => ({
      action,
      label: `${label}:${action}`,
      hint: `${label} can handle ${action}`,
    })),
  };
}

describe("GlobalAgentRegistry", () => {
  it("registers, lists, finds, and unregisters page snapshots", () => {
    const registry = new GlobalAgentRegistry();
    const imagePage = makePage("image-studio", "/studio", "創作工作室", ["fillPrompt", "submit"]);

    registry.register(imagePage);
    expect(registry.list()).toEqual([imagePage]);
    expect(registry.get("image-studio")).toBe(imagePage);
    expect(registry.findSupportingPages("fillPrompt")).toEqual([imagePage]);
    expect(registry.findSupportingPages("setModel")).toEqual([]);

    registry.unregister("image-studio");
    expect(registry.list()).toEqual([]);
  });

  it("prefers the current page when it supports the action", () => {
    const registry = new GlobalAgentRegistry();
    const imagePage = makePage("image-studio", "/studio", "圖像", ["fillPrompt"]);
    const videoPage = makePage("video-studio", "/video-studio", "影片", ["fillPrompt"]);
    registry.register(imagePage);
    registry.register(videoPage);

    const plan = registry.plan({ type: "fillPrompt", text: "cinematic cat" }, videoPage);
    expect(plan?.reason).toContain("Use current page");
    expect(plan?.steps[0]).toMatchObject({ targetPageId: "video-studio" });
  });

  it("routes to a supporting page when current page cannot handle the action", () => {
    const registry = new GlobalAgentRegistry();
    const director = makePage("director", "/director", "導演 AI", ["fillPrompt", "submit"]);
    const settings = makePage("settings", "/settings", "設定", ["toggleSetting"]);
    registry.register(director);
    registry.register(settings);

    const plan = registry.plan({ type: "submit" }, settings);
    expect(plan?.steps[0]).toMatchObject({
      path: "/director",
      targetPageId: "director",
      action: { type: "submit" },
    });
  });

  it("can find page snapshot by path", () => {
    const registry = new GlobalAgentRegistry();
    const director = makePage("director", "/director", "導演 AI", ["fillPrompt"]);
    registry.register(director);

    expect(registry.findByPath("/director")?.pageId).toBe("director");
    expect(registry.findByPath("/missing")).toBeUndefined();
  });

  it("creates direct navigation plans without requiring page registration", () => {
    const registry = new GlobalAgentRegistry();
    const plan = registry.plan({ type: "navigate", path: "/pro-studio" }, null);
    expect(plan).toMatchObject({
      reason: "Navigate directly to /pro-studio",
      steps: [{ path: "/pro-studio", action: { type: "navigate", path: "/pro-studio" } }],
    });
  });
});

describe("global-agent-workflows", () => {
  it("converts lightweight workflow steps into strict AgentAction objects", () => {
    expect(workflowStepToAction({ actionType: "fillPrompt", payload: "一隻貓", label: "填提示詞" }))
      .toEqual({ type: "fillPrompt", text: "一隻貓" });
    expect(workflowStepToAction({ actionType: "appendPrompt", payload: "電影感", label: "補提示詞" }))
      .toEqual({ type: "fillPrompt", text: "電影感", append: true });
    expect(workflowStepToAction({ actionType: "fillNegativePrompt", payload: "低清晰度", label: "負面" }))
      .toEqual({ type: "fillPrompt", text: "低清晰度", slot: "negativePrompt" });
    expect(workflowStepToAction({ actionType: "setParam", payload: "duration: 6", label: "長度" }))
      .toEqual({ type: "setParam", key: "duration", value: 6 });
    expect(workflowStepToAction({ actionType: "setModality", payload: "video", label: "影片" }))
      .toEqual({ type: "setModality", modality: "video" });
  });

  it("rejects invalid or underspecified workflow steps", () => {
    expect(workflowStepToAction({ actionType: "setModality", payload: "hologram", label: "錯誤模態" }))
      .toBeNull();
    expect(workflowStepToAction({ actionType: "setModel", payload: "", label: "缺模型" }))
      .toBeNull();
    expect(workflowStepToAction({ actionType: "unknownAction", payload: "x", label: "未知" }))
      .toBeNull();
  });

  it("expands runWorkflow and drops non-executable steps", () => {
    const expanded = expandWorkflowAction({
      type: "runWorkflow",
      name: "測試流程",
      steps: [
        { path: "/director", actionType: "fillPrompt", payload: "企劃", label: "填企劃" },
        { path: "/director", actionType: "badAction", payload: "", label: "壞步驟" },
        { path: "/director", actionType: "submit", payload: "", label: "送出" },
      ],
    });

    expect(expanded).toHaveLength(2);
    expect(expanded[0]).toMatchObject({ path: "/director", label: "填企劃", action: { type: "fillPrompt", text: "企劃" } });
    expect(expanded[1]).toMatchObject({ path: "/director", label: "送出", action: { type: "submit" } });
  });

  it("builds deterministic short-video workflows from Chinese and English user text", () => {
    const zh = maybeCreateWorkflowFromUserText("幫我做一支 30 秒廣告短片");
    const en = maybeCreateWorkflowFromUserText("create a reel for my product");
    const noWorkflow = maybeCreateWorkflowFromUserText("今天天氣如何？");

    expect(zh?.type).toBe("runWorkflow");
    expect(zh?.name).toContain("短片生成流程");
    expect(zh?.steps.map(step => step.path)).toEqual(
      expect.arrayContaining(["/director", "/studio", "/video-studio", "/pro-studio"])
    );
    expect(en?.type).toBe("runWorkflow");
    expect(noWorkflow).toBeNull();
  });

  it("short-video workflow includes planning, image, video, and voice phases", () => {
    const workflow = buildShortVideoWorkflow("療癒森林品牌短片");
    expect(workflow.steps.map(step => step.label).join("\n")).toContain("導演 AI");
    expect(workflow.steps.map(step => step.label).join("\n")).toContain("圖像工作室");
    expect(workflow.steps.map(step => step.label).join("\n")).toContain("影片工作室");
    expect(workflow.steps.map(step => step.label).join("\n")).toContain("配音");
  });

  it("short-video workflow no longer dispatches a standalone /director submit", () => {
    const workflow = buildShortVideoWorkflow("療癒森林品牌短片");
    const directorSubmitSteps = workflow.steps.filter(
      step => step.path === "/director" && step.actionType === "submit"
    );
    expect(directorSubmitSteps).toHaveLength(0);
  });

  it("detectVideoIntent asks for clarification when user wants a long video", () => {
    const detection = detectVideoIntent("我想做一個長影片你可以幫我做嗎？");
    expect(detection.kind).toBe("needs-clarification");
    if (detection.kind === "needs-clarification") {
      expect(detection.message).toContain("長影片");
      expect(detection.options.length).toBeGreaterThan(0);
    }
  });

  it("detectVideoIntent asks for clarification when video request lacks length and subject", () => {
    const detection = detectVideoIntent("幫我做影片");
    expect(detection.kind).toBe("needs-clarification");
  });

  it("detectVideoIntent skips clarification when user provides explicit short-form details", () => {
    const detection = detectVideoIntent("幫我做一支 30 秒廣告短片");
    expect(detection.kind).toBe("ready");
  });

  it("detectVideoIntent returns none for off-topic chatter", () => {
    expect(detectVideoIntent("今天天氣如何？").kind).toBe("none");
  });

  it("short-video workflow uses setTab for /pro-studio (setModality is unsupported there)", () => {
    const workflow = buildShortVideoWorkflow("療癒森林品牌短片");
    const proStudioSteps = workflow.steps.filter(step => step.path === "/pro-studio");
    expect(proStudioSteps.length).toBeGreaterThan(0);
    for (const step of proStudioSteps) {
      expect(step.actionType).not.toBe("setModality");
    }
  });

  it("setTab is registered as a capability so workflow steps don't get blocked", () => {
    const allowed = GLOBAL_AGENT_CAPABILITY_REGISTRY.some(c => c.actionType === "setTab" && c.enabled);
    expect(allowed).toBe(true);
    expect(hasCapabilityForPage("/pro-studio", "setTab")).toBe(true);
    expect(hasCapabilityForPage("/image-studio", "setTab")).toBe(true);
  });

  it("detectCreationIntent picks the image workflow for image requests", () => {
    const detection = detectCreationIntent("幫我做一張電影感海報");
    expect(detection.kind).toBe("ready");
    if (detection.kind === "ready") {
      expect(detection.workflow.name).toBe("圖片生成流程");
      expect(detection.workflow.steps[0]?.path).toBe("/image-studio");
    }
  });

  it("detectCreationIntent picks the music workflow for music requests", () => {
    const detection = detectCreationIntent("幫我做一首放鬆的背景音樂");
    expect(detection.kind).toBe("ready");
    if (detection.kind === "ready") {
      expect(detection.workflow.name).toBe("音樂生成流程");
      expect(detection.workflow.steps[0]?.path).toBe("/pro-studio");
    }
  });

  it("detectCreationIntent picks the voice workflow for narration requests", () => {
    const detection = detectCreationIntent("幫我做一段冥想引導旁白");
    expect(detection.kind).toBe("ready");
    if (detection.kind === "ready") {
      expect(detection.workflow.name).toBe("語音合成流程");
    }
  });

  it("detectCreationIntent picks the sfx workflow for sound-effect requests", () => {
    const detection = detectCreationIntent("幫我做雨聲音效");
    expect(detection.kind).toBe("ready");
    if (detection.kind === "ready") {
      expect(detection.workflow.name).toBe("音效生成流程");
    }
  });

  it("detectCreationIntent picks the script-only workflow for planning requests", () => {
    const detection = detectCreationIntent("幫我寫一個短片腳本");
    expect(detection.kind).toBe("ready");
    if (detection.kind === "ready") {
      expect(detection.workflow.name).toBe("腳本規劃流程");
      expect(detection.workflow.steps[0]?.path).toBe("/director");
    }
  });

  it("detectCreationIntent asks which audio modality when multiple are mentioned", () => {
    const detection = detectCreationIntent("幫我做背景音樂和旁白");
    expect(detection.kind).toBe("needs-clarification");
    if (detection.kind === "needs-clarification") {
      expect(detection.options.length).toBeGreaterThan(1);
    }
  });

  it("detectCreationIntent defers to video intent when video keyword present", () => {
    const detection = detectCreationIntent("我想做一個長影片你可以幫我做嗎？");
    expect(detection.kind).toBe("needs-clarification");
  });

  it("detectCreationIntent ignores plain chatter", () => {
    expect(detectCreationIntent("你好").kind).toBe("none");
    expect(detectCreationIntent("今天我想看書").kind).toBe("none");
  });

  it("each non-video workflow only uses actions that pass the capability gate", () => {
    const workflows = [
      buildImageWorkflow("test"),
      buildMusicWorkflow("test"),
      buildVoiceWorkflow("test"),
      buildSfxWorkflow("test"),
      buildScriptOnlyWorkflow("test"),
    ];
    for (const workflow of workflows) {
      for (const step of workflow.steps) {
        expect(hasCapabilityForPage(step.path, step.actionType)).toBe(true);
      }
    }
  });

  it("inferLongVideoChapters scales with explicit minutes", () => {
    expect(inferLongVideoChapters("我想做 1 分鐘長片，主題：森林")).toBe(2);
    expect(inferLongVideoChapters("我想做 3 分鐘長片，主題：森林")).toBe(3);
    expect(inferLongVideoChapters("我想做 5 分鐘長片，主題：森林")).toBe(4);
    expect(inferLongVideoChapters("我想做 10 分鐘長片，主題：森林")).toBe(5);
    expect(inferLongVideoChapters("我想做 30 分鐘長片，主題：森林")).toBe(6);
  });

  it("inferLongVideoChapters honours explicit chapter counts", () => {
    expect(inferLongVideoChapters("做一支 4 章節長片")).toBe(4);
    expect(inferLongVideoChapters("做一支 99 章長片")).toBe(6); // capped
    expect(inferLongVideoChapters("做一支 1 章長片")).toBe(2); // floor
  });

  it("buildLongVideoWorkflow scales steps with chapter count", () => {
    const w3 = buildLongVideoWorkflow("療癒森林品牌故事", { chapters: 3 });
    const w5 = buildLongVideoWorkflow("療癒森林品牌故事", { chapters: 5 });
    expect(w3.steps.length).toBeLessThan(w5.steps.length);
    expect(w3.name).toContain("3 章節");
    expect(w5.name).toContain("5 章節");
  });

  it("buildLongVideoWorkflow only uses actions that pass the capability gate", () => {
    const workflow = buildLongVideoWorkflow("療癒森林品牌故事", { chapters: 4 });
    for (const step of workflow.steps) {
      expect(hasCapabilityForPage(step.path, step.actionType)).toBe(true);
    }
  });

  it("detectVideoIntent returns a long workflow when long+subject are explicit", () => {
    const detection = detectVideoIntent(
      "我想做 5 分鐘的長片，主題：療癒森林品牌故事"
    );
    expect(detection.kind).toBe("ready");
    if (detection.kind === "ready") {
      expect(detection.workflow.name).toContain("章節長片");
    }
  });

  it("detectVideoIntent still asks when long is mentioned without subject", () => {
    const detection = detectVideoIntent("我想做一個長影片你可以幫我做嗎？");
    expect(detection.kind).toBe("needs-clarification");
    if (detection.kind === "needs-clarification") {
      expect(detection.message).toContain("主題");
    }
  });

  it("detectCreationIntent embeds remembered style/platform hints into the workflow", () => {
    const detection = detectCreationIntent("幫我做一張海報", {
      styles: ["電影感", "療癒"],
      platforms: ["Instagram"],
    });
    expect(detection.kind).toBe("ready");
    if (detection.kind === "ready") {
      const firstStep = detection.workflow.steps[0];
      expect(firstStep?.payload).toContain("電影感");
      expect(firstStep?.payload).toContain("Instagram");
    }
  });

  it("detectVideoIntent uses remembered videoLengthHint=long to trigger long-video workflow", () => {
    const detection = detectVideoIntent(
      "幫我做一支主題：療癒森林品牌故事的影片",
      { videoLengthHint: "long" }
    );
    expect(detection.kind).toBe("ready");
    if (detection.kind === "ready") {
      expect(detection.workflow.name).toContain("章節長片");
    }
  });

  it("adapts schema-first planner output into runWorkflow action", () => {
    const adapted = adaptAgentPlanToActions({
      name: "Schema Plan",
      steps: [
        { path: "/director", actionType: "fillPrompt", payload: "企劃", label: "填企劃" },
        { path: "/director", actionType: "submit", payload: "", label: "送出" },
      ],
    });

    expect(adapted).toHaveLength(1);
    expect(adapted[0]).toMatchObject({
      type: "runWorkflow",
      name: "Schema Plan",
      steps: [
        { path: "/director", actionType: "fillPrompt", payload: "企劃", label: "填企劃" },
        { path: "/director", actionType: "submit", payload: "", label: "送出" },
      ],
    });
  });
});

describe("global-agent-orchestrator", () => {
  beforeEach(() => {
    globalAgentRegistry.clear();
  });

  it("navigates and dispatches a single action through the registry plan", async () => {
    const director = makePage("director", "/director", "導演 AI", ["fillPrompt"]);
    globalAgentRegistry.register(director);
    const calls: string[] = [];

    const result = await executeGlobalAction({ type: "fillPrompt", text: "寫企劃" }, {
      currentPage: null,
      navigate: async path => {
        calls.push(`navigate:${path}`);
      },
      dispatch: async (action, opts) => {
        calls.push(`dispatch:${action.type}:${opts?.targetPageId}`);
        return { ok: true };
      },
      waitAfterNavigateMs: 0,
    });

    expect(result.ok).toBe(true);
    expect(calls).toEqual(["navigate:/director", "dispatch:fillPrompt:director"]);
  });

  it("executes expanded workflow steps in order", async () => {
    globalAgentRegistry.register(makePage("director", "/director", "導演 AI", ["fillPrompt", "submit"]));
    globalAgentRegistry.register(makePage("studio", "/studio", "創作工作室", ["setModality", "fillPrompt"]));

    const calls: string[] = [];
    const result = await executeGlobalWorkflow({
      type: "runWorkflow",
      name: "測試跨頁流程",
      steps: [
        { path: "/director", actionType: "fillPrompt", payload: "企劃", label: "填企劃" },
        { path: "/director", actionType: "submit", payload: "", label: "送出" },
        { path: "/studio", actionType: "setModality", payload: "image", label: "切圖像" },
        { path: "/studio", actionType: "fillPrompt", payload: "關鍵視覺", label: "填圖像" },
      ],
    }, {
      currentPage: null,
      navigate: async path => calls.push(`nav:${path}`),
      dispatch: async (action, opts) => {
        calls.push(`act:${action.type}:${opts?.targetPageId ?? "none"}`);
        return { ok: true };
      },
      waitAfterNavigateMs: 0,
      onWorkflowStep: step => calls.push(`step:${step.index + 1}:${step.label}`),
    });

    expect(result.ok).toBe(true);
    expect(result.workflowName).toBe("測試跨頁流程");
    expect(calls).toEqual([
      "step:1:填企劃",
      "nav:/director",
      "act:fillPrompt:director",
      "step:2:送出",
      "nav:/director",
      "act:submit:director",
      "step:3:切圖像",
      "nav:/studio",
      "act:setModality:studio",
      "step:4:填圖像",
      "nav:/studio",
      "act:fillPrompt:studio",
    ]);
  });

  it("stops workflow execution on first failed step", async () => {
    globalAgentRegistry.register(makePage("director", "/director", "導演 AI", ["fillPrompt", "submit"]));
    const result = await executeGlobalWorkflow({
      type: "runWorkflow",
      name: "失敗流程",
      steps: [
        { path: "/director", actionType: "fillPrompt", payload: "企劃", label: "填企劃" },
        { path: "/director", actionType: "submit", payload: "", label: "送出" },
      ],
    }, {
      currentPage: null,
      navigate: async () => undefined,
      dispatch: async action => action.type === "submit"
        ? { ok: false, reason: "missing API key" }
        : { ok: true },
      waitAfterNavigateMs: 0,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("missing API key");
    expect(result.results).toHaveLength(2);
  });

  it("executes multiple actions sequentially (not in parallel)", async () => {
    globalAgentRegistry.register(makePage("director", "/director", "導演 AI", ["fillPrompt", "setTab"]));
    const calls: string[] = [];

    await executeGlobalActions([
      { type: "fillPrompt", text: "first" },
      { type: "setTab", tabId: "second" },
    ], {
      currentPage: null,
      navigate: async path => calls.push(`nav:${path}`),
      dispatch: async action => {
        calls.push(`act:${action.type}`);
        return { ok: true };
      },
      waitAfterNavigateMs: 0,
    });

    expect(calls).toEqual([
      "nav:/director",
      "act:fillPrompt",
      "nav:/director",
      "act:setTab",
    ]);
  });

  it("stops batch execution after the first failed action", async () => {
    globalAgentRegistry.register(makePage("director", "/director", "導演 AI", ["fillPrompt", "setTab"]));
    const calls: string[] = [];

    const result = await executeGlobalActions([
      { type: "fillPrompt", text: "first" },
      { type: "setTab", tabId: "second" },
    ], {
      currentPage: null,
      navigate: async path => calls.push(`nav:${path}`),
      dispatch: async action => {
        calls.push(`act:${action.type}`);
        if (action.type === "fillPrompt") return { ok: false, reason: "blocked" };
        return { ok: true };
      },
      waitAfterNavigateMs: 0,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.ok).toBe(false);
    expect(calls).toEqual(["nav:/director", "act:fillPrompt"]);
  });

  it("returns validation failure when workflow has no executable steps", async () => {
    const result = await executeGlobalWorkflow({
      type: "runWorkflow",
      name: "空流程",
      steps: [{ path: "/director", actionType: "unknownAction", payload: "", label: "壞步驟" }],
    }, {
      currentPage: null,
      navigate: async () => undefined,
      dispatch: async () => ({ ok: true }),
      waitAfterNavigateMs: 0,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("workflow has no executable steps");
    expect(result.results[0]).toEqual({ ok: false, reason: "workflow has no executable steps" });
  });

  it("does not re-dispatch a navigate action after navigating (orb owns nav)", async () => {
    // Regression: previously executeGlobalAction would call ctx.navigate() and
    // then ALSO dispatch the navigate action through pageAgent.dispatch, which
    // returned { ok: false, reason: "navigate handled by orb layer" } and
    // surfaced a fake failure to the user ("我找到要做的事，但執行時遇到問題").
    const calls: string[] = [];
    const result = await executeGlobalAction({ type: "navigate", path: "/studio" }, {
      currentPage: null,
      navigate: async path => {
        calls.push(`nav:${path}`);
      },
      dispatch: async action => {
        calls.push(`dispatch:${action.type}`);
        // Simulate the page-agent layer's navigate rejection so we catch any
        // regression where the orchestrator forwards navigate to dispatch.
        if (action.type === "navigate") {
          return { ok: false, reason: "navigate handled by orb layer" };
        }
        return { ok: true };
      },
      waitAfterNavigateMs: 0,
    });

    expect(result.ok).toBe(true);
    expect(calls).toEqual(["nav:/studio"]);
  });

  it("does not re-dispatch navigate steps inside a workflow", async () => {
    globalAgentRegistry.register(makePage("studio", "/studio", "創作工作室", ["fillPrompt"]));
    const calls: string[] = [];

    const result = await executeGlobalWorkflow({
      type: "runWorkflow",
      name: "navigate-then-fill",
      steps: [
        { path: "/studio", actionType: "navigate", payload: "/studio", label: "去工作室" },
        { path: "/studio", actionType: "fillPrompt", payload: "夕陽", label: "填提示詞" },
      ],
    }, {
      currentPage: null,
      navigate: async path => calls.push(`nav:${path}`),
      dispatch: async action => {
        calls.push(`act:${action.type}`);
        if (action.type === "navigate") {
          return { ok: false, reason: "navigate handled by orb layer" };
        }
        return { ok: true };
      },
      waitAfterNavigateMs: 0,
    });

    expect(result.ok).toBe(true);
    // ctx.currentPage stays null in the test, so each step's s.path triggers
    // ctx.navigate. The navigate ACTION itself must not be dispatched —
    // otherwise the page-agent's "navigate handled by orb layer" rejection
    // would fail the workflow.
    expect(calls).toEqual(["nav:/studio", "nav:/studio", "act:fillPrompt"]);
    expect(calls).not.toContain("act:navigate");
  });

  it("passes source and intentSummary through workflow step dispatch options", async () => {
    globalAgentRegistry.register(makePage("director", "/director", "導演 AI", ["fillPrompt"]));
    const seenOpts: Array<{ source?: string; intentSummary?: string }> = [];

    const result = await executeGlobalWorkflow({
      type: "runWorkflow",
      name: "來源驗證",
      steps: [{ path: "/director", actionType: "fillPrompt", payload: "企劃", label: "填企劃" }],
    }, {
      currentPage: null,
      navigate: async () => undefined,
      dispatch: async (_action, opts) => {
        seenOpts.push({ source: opts?.source, intentSummary: opts?.intentSummary });
        return { ok: true };
      },
      source: "ai-chat",
      intentSummary: "幫我做影片企劃",
      waitAfterNavigateMs: 0,
    });

    expect(result.ok).toBe(true);
    expect(seenOpts).toEqual([{ source: "ai-chat", intentSummary: "幫我做影片企劃" }]);
  });
});

describe("orchestrator safety helpers", () => {
  it("detects dangerous workflow steps by index", () => {
    const indexes = findDangerousWorkflowSteps({
      type: "runWorkflow",
      name: "測試",
      steps: [
        { path: "/director", actionType: "fillPrompt", payload: "x", label: "填寫" },
        { path: "/director", actionType: "submit", payload: "", label: "送出" },
        { path: "/studio", actionType: "reset", payload: "", label: "重設" },
      ],
    });
    expect(indexes).toEqual([1, 2]);
  });

  it("infers ask-before-act for dangerous actions and multi-step workflows", () => {
    expect(shouldAskBeforeAct([{ type: "submit" }])).toBe(true);
    expect(shouldAskBeforeAct([{
      type: "runWorkflow",
      name: "兩步流程",
      steps: [
        { path: "/director", actionType: "fillPrompt", payload: "x", label: "填寫" },
        { path: "/director", actionType: "setParam", payload: "duration: 6", label: "設定" },
      ],
    }])).toBe(true);
    expect(shouldAskBeforeAct([{ type: "fillPrompt", text: "hello" }])).toBe(false);
  });
});
