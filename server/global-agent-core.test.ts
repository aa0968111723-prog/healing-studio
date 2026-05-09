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
  buildFeatureSummaryReply,
  buildNavigateWorkflow,
  buildScriptOnlyWorkflow,
  buildSfxWorkflow,
  buildShortVideoWorkflow,
  buildVoiceWorkflow,
  detectChatIntent,
  detectCreationIntent,
  detectNavIntent,
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
import { APP_PAGE_REGISTRY } from "../shared/appRegistry";

const APP_PAGE_REGISTRY_PATHS = APP_PAGE_REGISTRY.map(page => page.path);
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
    // Prompts must be fully-specified (length + subject + style + platform/aspect)
    // so the multi-round wizard committed by detectVideoIntent doesn't ask for
    // more clarification before returning a ready workflow. Cf. the wizard
    // tests below (`detectVideoIntent walks the wizard for partially-specified
    // video requests`) which assert the inverse for partial prompts.
    const zh = maybeCreateWorkflowFromUserText(
      "幫我做一支 30 秒 IG Reel 9:16 電影感的茶道體驗廣告短片"
    );
    const en = maybeCreateWorkflowFromUserText(
      "create a 30 second cinematic IG Reel 9:16 ad for my matcha product"
    );
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

  it("detectVideoIntent asks follow-up when user only provides length", () => {
    const detection = detectVideoIntent("幫我做一支 30 秒短片");
    expect(detection.kind).toBe("needs-clarification");
    if (detection.kind === "needs-clarification") {
      expect(detection.options.length).toBeGreaterThan(0);
    }
  });

  it("detectVideoIntent walks the wizard for partially-specified video requests", () => {
    // "幫我做一支 30 秒廣告短片" gives length + subject + style (廣告) but no
    // platform/aspect ratio — the wizard should still ask one more round
    // before committing to the workflow, since "30 秒廣告" reads very
    // different on IG Reel (9:16) vs YouTube (16:9) vs TV (16:9 broadcast).
    const partial = detectVideoIntent("幫我做一支 30 秒廣告短片");
    expect(partial.kind).toBe("needs-clarification");
  });

  it("detectVideoIntent skips clarification when user provides full details", () => {
    // Length + subject + style + platform all explicit — wizard is
    // satisfied and commits to the runWorkflow.
    const detection = detectVideoIntent(
      "幫我做一支 30 秒 IG Reel 9:16 電影感的茶道體驗品牌廣告短片"
    );
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

  it("detectVideoIntent returns clarification for long requests missing style/usecase", () => {
    const detection = detectVideoIntent(
      "我想做 5 分鐘的長片，主題：療癒森林品牌故事"
    );
    expect(detection.kind).toBe("needs-clarification");
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
  });

  it("detectNavIntent recognises non-creative requests", () => {
    expect(detectNavIntent("我想訓練自己的 LoRA")?.path).toBe("/models");
    expect(detectNavIntent("怎麼開始？有新手教學嗎")?.path).toBe("/tutorial-overview");
    expect(detectNavIntent("我想看學習文件")?.path).toBe("/learn");
    expect(detectNavIntent("打開個人設定")?.path).toBe("/settings");
    expect(detectNavIntent("帶我去素材庫")?.path).toBe("/assets");
    expect(detectNavIntent("查看背景任務")?.path).toBe("/assets?section=tasks");
    expect(detectNavIntent("查我的點數")?.path).toBe("/dashboard?section=credits");
    expect(detectNavIntent("打開專注流")?.path).toBe("/focus-flow");
  });

  it("detectNavIntent returns null for off-topic chatter", () => {
    expect(detectNavIntent("今天天氣如何")).toBeNull();
    expect(detectNavIntent("你好")).toBeNull();
  });

  it("buildNavigateWorkflow produces a single navigate step that passes the capability gate", () => {
    const wf = buildNavigateWorkflow("前往模型訓練中心", "/models");
    expect(wf.steps).toHaveLength(1);
    expect(wf.steps[0].actionType).toBe("navigate");
    expect(hasCapabilityForPage(wf.steps[0].path, wf.steps[0].actionType)).toBe(true);
  });

  // ─── 「功能詢問」 mode renders this reply client-side without an LLM hop,
  //     so we lock its shape: every line must point at a real APP_PAGE_REGISTRY
  //     path so the user can't read about a feature that doesn't exist.
  it("buildFeatureSummaryReply only advertises real registry paths and skips the /agent host", () => {
    const reply = buildFeatureSummaryReply();
    expect(reply).toContain("功能");
    // Extract advertised paths after "路徑：" markers.
    const refs = Array.from(reply.matchAll(/路徑：(\S+)/g)).map(m => m[1]);
    expect(refs.length).toBeGreaterThan(0);
    // None of the advertised entries should be the orb's own host page (we
    // never want the orb telling the user to navigate to itself).
    expect(refs).not.toContain("/agent");
    // Every advertised path must exist in APP_PAGE_REGISTRY so the orb can't
    // hallucinate a feature that's not actually wired up.
    const knownPaths = new Set(APP_PAGE_REGISTRY_PATHS);
    for (const ref of refs) {
      expect(knownPaths.has(ref)).toBe(true);
    }
  });

  it("detectChatIntent picks creative intent when both creative and nav keywords match", () => {
    const detection = detectChatIntent("幫我做一張海報，順便看一下素材庫");
    expect(detection.kind).toBe("ready");
    if (detection.kind === "ready") {
      expect(detection.workflow.name).toBe("圖片生成流程");
    }
  });

  it("detectChatIntent falls back to navigate when no creative intent is present", () => {
    const detection = detectChatIntent("我想看看新手教學");
    expect(detection.kind).toBe("ready");
    if (detection.kind === "ready") {
      expect(detection.workflow.name).toContain("教學");
      expect(detection.workflow.steps[0].actionType).toBe("navigate");
    }
  });

  it("detectChatIntent returns none for plain greetings", () => {
    expect(detectChatIntent("你好").kind).toBe("none");
    expect(detectChatIntent("今天天氣如何？").kind).toBe("none");
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
    // Precision policy: same-page consecutive steps must NOT re-navigate
    // (currentPath tracked locally), and onWorkflowStep fires AFTER the
    // navigate completes so the progress UI never claims a step is running
    // before its destination is reached.
    expect(calls).toEqual([
      "nav:/director",
      "step:1:填企劃",
      "act:fillPrompt:director",
      "step:2:送出",
      "act:submit:director",
      "nav:/studio",
      "step:3:切圖像",
      "act:setModality:studio",
      "step:4:填圖像",
      "act:fillPrompt:studio",
    ]);
  });

  it("onStepProgress fires sub-phase events (navigating → settling → awaiting_handler → dispatching) so the panel can show what each step is doing internally", async () => {
    globalAgentRegistry.register(
      makePage("director", "/director", "導演 AI", ["fillPrompt"])
    );
    const events: string[] = [];

    await executeGlobalWorkflow(
      {
        type: "runWorkflow",
        name: "phase-event-trace",
        steps: [
          { path: "/director", actionType: "fillPrompt", payload: "企劃", label: "填企劃" },
        ],
      },
      {
        currentPage: null,
        navigate: async () => undefined,
        dispatch: async () => ({ ok: true }),
        // Force every settle / await branch on so we cover the full phase
        // surface area in one run.
        waitAfterNavigateMs: 1,
        awaitPageReady: async () => true,
        pageReadyTimeoutMs: 50,
        onStepProgress: event =>
          events.push(`${event.index}:${event.phase}:${event.detail ?? ""}`),
      }
    );

    // Order matters: nav → settle → await → dispatch.  A regression that fires
    // dispatch before navigate would show up here as a swap.
    expect(events).toEqual([
      "0:navigating:/director",
      "0:settling:/director",
      "0:awaiting_handler:/director",
      "0:dispatching:fillPrompt",
    ]);
  });

  it("onStepProgress emits 'retrying' on attempt > 1 — the backoff wait is otherwise a silent gap", async () => {
    globalAgentRegistry.register(
      makePage("director", "/director", "導演 AI", ["fillPrompt"])
    );
    let dispatchCount = 0;
    const events: string[] = [];

    await executeGlobalWorkflow(
      {
        type: "runWorkflow",
        name: "phase-retry-trace",
        steps: [
          {
            path: "/director",
            actionType: "fillPrompt",
            payload: "企劃",
            label: "填企劃",
            retryPolicy: { maxAttempts: 3, backoffMs: 0 },
          },
        ],
      },
      {
        currentPage: null,
        navigate: async () => undefined,
        dispatch: async () => {
          dispatchCount++;
          // First two attempts fail, third succeeds — exercises the retry loop.
          return dispatchCount < 3
            ? { ok: false, reason: "transient" }
            : { ok: true };
        },
        waitAfterNavigateMs: 0,
        onStepProgress: event => {
          if (event.phase === "retrying") {
            events.push(`retry:${event.detail ?? ""}`);
          }
        },
      }
    );

    expect(events).toEqual(["retry:第 2 次嘗試", "retry:第 3 次嘗試"]);
  });

  it("onStepProgress emits 'settling' when the previous step mutated same-page state (setTab → fillPrompt sequence)", async () => {
    globalAgentRegistry.register(
      makePage("pro", "/pro-studio", "專業創作室", ["setTab", "fillPrompt"])
    );
    const settles: number[] = [];

    await executeGlobalWorkflow(
      {
        type: "runWorkflow",
        name: "phase-settle-trace",
        steps: [
          { path: "/pro-studio", actionType: "setTab", payload: "music", label: "切音樂" },
          { path: "/pro-studio", actionType: "fillPrompt", payload: "BGM", label: "填 BGM" },
        ],
      },
      {
        currentPage: null,
        navigate: async () => undefined,
        dispatch: async () => ({ ok: true }),
        waitAfterNavigateMs: 0,
        // Force the same-page settle path on (default would otherwise be 80ms).
        samePageStateMutationSettleMs: 1,
        onStepProgress: event => {
          if (event.phase === "settling") settles.push(event.index);
        },
      }
    );

    // The post-setTab settle wait must surface for step index 1 — without it,
    // users see the panel freeze for ~80ms with no hint that React is waiting
    // for the tab swap to commit.
    expect(settles).toEqual([1]);
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

    // Precision policy: cross-action path threading. The second action targets
    // the same page the first one landed on, so we must NOT navigate again —
    // doing so would burn a fresh settle wait and (in production) trigger
    // wouter's no-op route change which still costs a render.
    expect(calls).toEqual([
      "nav:/director",
      "act:fillPrompt",
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
    // currentPath tracking means the second step (already on /studio) skips
    // the redundant navigate. The navigate ACTION itself must still NOT be
    // dispatched — otherwise the page-agent's "navigate handled by orb layer"
    // rejection would fail the workflow.
    expect(calls).toEqual(["nav:/studio", "act:fillPrompt"]);
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

describe("orchestrator precision policy", () => {
  beforeEach(() => {
    globalAgentRegistry.clear();
  });

  it("awaits page readiness after every navigate when awaitPageReady is provided", async () => {
    globalAgentRegistry.register(makePage("director", "/director", "導演 AI", ["fillPrompt", "submit"]));
    globalAgentRegistry.register(makePage("studio", "/studio", "創作工作室", ["fillPrompt"]));
    const readinessProbes: Array<{ path: string; timeoutMs: number }> = [];

    const result = await executeGlobalWorkflow({
      type: "runWorkflow",
      name: "等頁面就緒",
      steps: [
        { path: "/director", actionType: "fillPrompt", payload: "x", label: "a" },
        { path: "/director", actionType: "submit", payload: "", label: "b" },
        { path: "/studio", actionType: "fillPrompt", payload: "y", label: "c" },
      ],
    }, {
      currentPage: null,
      navigate: async () => undefined,
      dispatch: async () => ({ ok: true }),
      waitAfterNavigateMs: 0,
      pageReadyTimeoutMs: 1000,
      awaitPageReady: async (path, opts) => {
        readinessProbes.push({ path, timeoutMs: opts.timeoutMs });
        return true;
      },
    });

    expect(result.ok).toBe(true);
    // One probe per actual navigate. Same-page consecutive steps must not
    // re-probe — that's wasted time and a false guarantee.
    expect(readinessProbes).toEqual([
      { path: "/director", timeoutMs: 1000 },
      { path: "/studio", timeoutMs: 1000 },
    ]);
  });

  it("continues even when awaitPageReady reports timeout (dispatch's enqueue path covers it)", async () => {
    globalAgentRegistry.register(makePage("director", "/director", "導演 AI", ["fillPrompt"]));
    const dispatched: string[] = [];

    const result = await executeGlobalWorkflow({
      type: "runWorkflow",
      name: "就緒逾時",
      steps: [{ path: "/director", actionType: "fillPrompt", payload: "x", label: "a" }],
    }, {
      currentPage: null,
      navigate: async () => undefined,
      dispatch: async action => {
        dispatched.push(action.type);
        return { ok: true };
      },
      waitAfterNavigateMs: 0,
      pageReadyTimeoutMs: 50,
      awaitPageReady: async () => false,
    });

    expect(result.ok).toBe(true);
    expect(dispatched).toEqual(["fillPrompt"]);
  });

  it("threads the just-landed path forward across executeGlobalActions", async () => {
    // No registry — actions get planned via current page hint. We pass a
    // currentPage on /home so the FIRST action navigates, but the SECOND
    // (which the planner routes to the same page the first ended on) must
    // skip the redundant navigate via the new endingPath threading.
    globalAgentRegistry.register(makePage("director", "/director", "導演 AI", ["fillPrompt", "setTab", "submit"]));
    const calls: string[] = [];

    const results = await executeGlobalActions(
      [
        { type: "fillPrompt", text: "a" },
        { type: "setTab", tabId: "main" },
        { type: "submit" },
      ],
      {
        currentPage: null,
        navigate: async path => calls.push(`nav:${path}`),
        dispatch: async action => {
          calls.push(`act:${action.type}`);
          return { ok: true };
        },
        waitAfterNavigateMs: 0,
      }
    );

    expect(results.every(r => r.ok)).toBe(true);
    // Only ONE navigate even though there are 3 actions all routed to /director.
    expect(calls).toEqual([
      "nav:/director",
      "act:fillPrompt",
      "act:setTab",
      "act:submit",
    ]);
    expect(results[0]?.endingPath).toBe("/director");
    expect(results[2]?.endingPath).toBe("/director");
  });

  it("workflowSequential exposes endingPath on success and on failure", async () => {
    globalAgentRegistry.register(makePage("director", "/director", "導演 AI", ["fillPrompt", "submit"]));

    const okResult = await executeGlobalWorkflow({
      type: "runWorkflow",
      name: "成功",
      steps: [{ path: "/director", actionType: "fillPrompt", payload: "x", label: "a" }],
    }, {
      currentPage: null,
      navigate: async () => undefined,
      dispatch: async () => ({ ok: true }),
      waitAfterNavigateMs: 0,
    });
    expect(okResult.endingPath).toBe("/director");

    const failResult = await executeGlobalWorkflow({
      type: "runWorkflow",
      name: "失敗",
      steps: [
        { path: "/director", actionType: "fillPrompt", payload: "x", label: "a" },
        { path: "/director", actionType: "submit", payload: "", label: "b" },
      ],
    }, {
      currentPage: null,
      navigate: async () => undefined,
      dispatch: async action => action.type === "submit" ? { ok: false, reason: "x" } : { ok: true },
      waitAfterNavigateMs: 0,
    });
    expect(failResult.endingPath).toBe("/director");
  });

  it("respects ctx.currentPath override when provided", async () => {
    globalAgentRegistry.register(makePage("studio", "/studio", "創作工作室", ["fillPrompt"]));
    const calls: string[] = [];

    const result = await executeGlobalWorkflow({
      type: "runWorkflow",
      name: "已在工作室",
      steps: [{ path: "/studio", actionType: "fillPrompt", payload: "x", label: "a" }],
    }, {
      currentPage: null,
      currentPath: "/studio",
      navigate: async path => calls.push(`nav:${path}`),
      dispatch: async action => {
        calls.push(`act:${action.type}`);
        return { ok: true };
      },
      waitAfterNavigateMs: 0,
    });

    expect(result.ok).toBe(true);
    expect(calls).toEqual(["act:fillPrompt"]);
  });

  it("onWorkflowStep fires AFTER navigate so the UI never claims a step is running before its destination is reached", async () => {
    globalAgentRegistry.register(makePage("director", "/director", "導演 AI", ["fillPrompt"]));
    const order: string[] = [];

    await executeGlobalWorkflow({
      type: "runWorkflow",
      name: "順序",
      steps: [{ path: "/director", actionType: "fillPrompt", payload: "x", label: "填" }],
    }, {
      currentPage: null,
      navigate: async path => order.push(`nav:${path}`),
      dispatch: async () => {
        order.push("dispatch");
        return { ok: true };
      },
      waitAfterNavigateMs: 0,
      onWorkflowStep: step => order.push(`step:${step.label}`),
    });

    expect(order).toEqual(["nav:/director", "step:填", "dispatch"]);
  });

  // ─── Static-fallback regression: "no route found" should NOT happen when
  //     the live registry only knows the orb host page. The orchestrator must
  //     consult GLOBAL_AGENT_CAPABILITY_REGISTRY, navigate to a known-good
  //     page, and let the page-agent enqueue+drain finish the dispatch.
  it("falls back to the static capability registry when no live page handles the action", async () => {
    // Only the agent-chat host page is registered — same as production when
    // the orb is opened on /agent. The user asks for an image fillPrompt;
    // the live registry has zero candidates, so without the static fallback
    // this used to surface as "no route found".
    globalAgentRegistry.register(makePage("agent-chat", "/agent", "全站光球代理", []));
    const calls: string[] = [];

    const result = await executeGlobalAction(
      { type: "fillPrompt", text: "做一張電影感的療癒圖片" },
      {
        currentPage: null,
        navigate: async path => calls.push(`nav:${path}`),
        dispatch: async (action, opts) => {
          calls.push(`dispatch:${action.type}:${opts?.targetPageId}`);
          return { ok: true };
        },
        waitAfterNavigateMs: 0,
      }
    );

    expect(result.ok).toBe(true);
    // The static fallback must pick a page that supports fillPrompt — the
    // alias "圖片" should bias the ranker to the image-focused studio.
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatch(/^nav:\//);
    expect(calls[1]).toMatch(/^dispatch:fillPrompt:/);
  });

  it("setModality always routes to /studio (the only page that handles modality switching)", async () => {
    // Audit: only Studio.tsx has a `case "setModality"` block. The static
    // fallback used to pick the modality-named studio (image-studio for
    // modality=image, video-studio for modality=video, …) which silently
    // failed because those pages don't implement setModality. With
    // supportedActions on AppPageRegistryItem, only Studio is eligible.
    for (const modality of ["image", "video", "audio", "voice"] as const) {
      globalAgentRegistry.clear();
      globalAgentRegistry.register(makePage("agent-chat", "/agent", "全站光球代理", []));
      const calls: string[] = [];
      const result = await executeGlobalAction(
        { type: "setModality", modality },
        {
          currentPage: null,
          navigate: async path => calls.push(`nav:${path}`),
          dispatch: async (action, opts) => {
            calls.push(`dispatch:${action.type}:${opts?.targetPageId}`);
            return { ok: true };
          },
          waitAfterNavigateMs: 0,
        }
      );
      expect(result.ok).toBe(true);
      expect(calls[0]).toBe("nav:/studio");
      expect(calls[1]).toBe("dispatch:setModality:studio");
    }
  });

  it("the four modalities each have a complete fillPrompt + setParam + submit pipeline through /studio", async () => {
    // End-to-end: with /studio live-registered (mirrors what useRegisterPageAgent
    // does after navigate completes in production), the orb chains
    // setModality → fillPrompt → setParam → submit on the same page in one
    // navigate, for each of the four modalities. This is the contract the
    // user described: "全站光球代理 與 創作工作室的四模態連結 都要通".
    for (const modality of ["image", "video", "audio", "voice"] as const) {
      globalAgentRegistry.clear();
      globalAgentRegistry.register(
        makePage("studio", "/studio", "創作工作室", [
          "setModality",
          "fillPrompt",
          "setParam",
          "submit",
        ])
      );
      const calls: string[] = [];
      const result = await executeGlobalActions(
        [
          { type: "setModality", modality },
          { type: "fillPrompt", text: `生成一個 ${modality} 作品` },
          { type: "setParam", key: "temperature", value: 0.7 },
          { type: "submit" },
        ],
        {
          currentPage: null,
          navigate: async path => calls.push(`nav:${path}`),
          dispatch: async (action, opts) => {
            calls.push(`act:${action.type}:${opts?.targetPageId}`);
            return { ok: true };
          },
          waitAfterNavigateMs: 0,
        }
      );
      expect(result.every(r => r.ok)).toBe(true);
      // Path-threading: navigate to /studio once, dispatch four actions there.
      expect(calls.filter(c => c.startsWith("nav:"))).toEqual(["nav:/studio"]);
      expect(calls.filter(c => c.startsWith("act:"))).toEqual([
        "act:setModality:studio",
        "act:fillPrompt:studio",
        "act:setParam:studio",
        "act:submit:studio",
      ]);
    }
  });

  it("Studio is the only page that declares setModality in its supportedActions audit", () => {
    // Locks in the invariant: any future page that wants to handle
    // setModality must add it to its `supportedActions` array AND register
    // a `case "setModality"` block. The orb's static-fallback router only
    // routes to declared handlers, so missing this declaration will silently
    // make the page invisible to the orb's modality switching.
    const studios = APP_PAGE_REGISTRY.filter(p =>
      p.supportedActions.includes("setModality")
    );
    expect(studios.map(p => p.id)).toEqual(["studio"]);
  });

  it("empty live registry resolves a route via static fallback (was: no route found)", async () => {
    // No live page registered at all. The static fallback must still pick a
    // page from GLOBAL_AGENT_CAPABILITY_REGISTRY so the action can land on a
    // real handler after the navigate + readiness wait. Pre-fix this surfaced
    // as the user-visible "我找到要做的事，但執行時遇到問題：no route found".
    const calls: string[] = [];
    const result = await executeGlobalAction(
      { type: "fillPrompt", text: "做一張電影感的圖片" },
      {
        currentPage: null,
        navigate: async path => calls.push(`nav:${path}`),
        dispatch: async () => ({ ok: true }),
        waitAfterNavigateMs: 0,
      }
    );
    expect(result.ok).toBe(true);
    expect(calls[0]).toMatch(/^nav:\//);
  });

  it("workflow step without explicit path still navigates via static fallback", async () => {
    // Simulates a planner that emits a workflow step for fillPrompt but
    // forgot to attach `path`. Pre-fix the orchestrator dispatched on the
    // current page (which couldn't handle it) and surfaced a failure.
    const calls: string[] = [];
    const result = await executeGlobalWorkflow(
      {
        type: "runWorkflow",
        name: "缺路徑步驟",
        steps: [
          // No `path` field — orchestrator must resolve it via static fallback.
          { actionType: "fillPrompt", payload: "做一張電影感的圖片", label: "填提示詞" },
        ],
      },
      {
        currentPage: null,
        navigate: async path => calls.push(`nav:${path}`),
        dispatch: async (action, opts) => {
          calls.push(`act:${action.type}:${opts?.targetPageId ?? "none"}`);
          return { ok: true };
        },
        waitAfterNavigateMs: 0,
      }
    );

    expect(result.ok).toBe(true);
    // Must have navigated to *some* page first, then dispatched.
    expect(calls.find(c => c.startsWith("nav:"))).toBeTruthy();
    expect(calls.find(c => c.startsWith("act:fillPrompt:"))).toBeTruthy();
  });

  // ─── 全站光球代理 ↔ /image-studio (照片工作室) connection audit ─────────
  // /image-studio is the orb's destination for image-specific creation work
  // (t2i / edit / upscale / pose / sd / 3D). These tests pin the contract
  // so future refactors can't silently break the orb→照片工作室 routing.

  it("/image-studio supportedActions matches the page's actual handler switch", () => {
    // Audit ImageStudio.tsx's `case "..."` blocks one by one. If a future
    // change adds or removes a case, the supportedActions audit must be
    // updated in lockstep — otherwise the static-fallback router either
    // sends the orb to a page that can't handle the action (silent fail)
    // or refuses to send it at all (fake "no route found").
    const imageStudio = APP_PAGE_REGISTRY.find(p => p.id === "image-studio");
    expect(imageStudio).toBeTruthy();
    expect(new Set(imageStudio!.supportedActions)).toEqual(
      new Set([
        "setTab",
        "setModel",
        "fillPrompt",
        "applyPreset",
        "submit",
        "reset",
        "openDialog",
        "setParam",
        "focusElement",
      ])
    );
  });

  it("buildImageWorkflow's steps match /image-studio's declared supportedActions", () => {
    // Workflow safety net: every step the keyword fallback emits for an
    // image build must point at an action the destination page can handle.
    // Otherwise the dispatch silently no-ops and the user sees a half-done
    // workflow ("filled but never submitted").
    const wf = buildImageWorkflow("一張電影感的療癒風景");
    const imageStudio = APP_PAGE_REGISTRY.find(p => p.id === "image-studio");
    expect(imageStudio).toBeTruthy();
    for (const step of wf.steps) {
      expect(step.path).toBe("/image-studio");
      expect(imageStudio!.supportedActions).toContain(step.actionType);
    }
  });

  it("orb-emitted image actions from /agent route to /image-studio via static fallback", async () => {
    // From /agent (only the chat host is live-registered), each image-
    // studio-only action (setTab / openDialog) must resolve to
    // /image-studio. /studio doesn't declare setTab / openDialog so the
    // ranker can't accidentally route there.
    const cases: Array<{ action: AgentAction; expectPath: string }> = [
      { action: { type: "setTab", tabId: "edit" }, expectPath: "/image-studio" },
      { action: { type: "openDialog", dialogId: "image-history" }, expectPath: "/image-studio" },
      { action: { type: "fillPrompt", text: "電影感療癒圖片" }, expectPath: "/image-studio" },
    ];
    for (const { action, expectPath } of cases) {
      globalAgentRegistry.clear();
      globalAgentRegistry.register(makePage("agent-chat", "/agent", "全站光球代理", []));
      const calls: string[] = [];
      const result = await executeGlobalAction(action, {
        currentPage: null,
        navigate: async path => calls.push(`nav:${path}`),
        dispatch: async () => ({ ok: true }),
        waitAfterNavigateMs: 0,
      });
      expect(result.ok).toBe(true);
      expect(calls[0]).toBe(`nav:${expectPath}`);
    }
  });

  it("a chained image workflow (setTab → fillPrompt → setParam → submit) stays on /image-studio", async () => {
    // /image-studio gets live-registered (mirrors what useRegisterPageAgent
    // does after navigateAndSettle in production). The orb threads four
    // actions through it without re-navigating — this is the contract for
    // 全站光球代理 driving the photo studio's t2i flow end to end.
    globalAgentRegistry.clear();
    globalAgentRegistry.register(
      makePage("image-studio", "/image-studio", "圖片創作室", [
        "setTab",
        "fillPrompt",
        "setParam",
        "submit",
      ])
    );
    const calls: string[] = [];
    const result = await executeGlobalActions(
      [
        { type: "setTab", tabId: "t2i" },
        { type: "fillPrompt", text: "夜晚電影感咖啡廳，雨後街道，霓虹反光" },
        { type: "setParam", key: "aspectRatio", value: "16:9" },
        { type: "submit" },
      ],
      {
        currentPage: null,
        navigate: async path => calls.push(`nav:${path}`),
        dispatch: async (action, opts) => {
          calls.push(`act:${action.type}:${opts?.targetPageId}`);
          return { ok: true };
        },
        waitAfterNavigateMs: 0,
      }
    );
    expect(result.every(r => r.ok)).toBe(true);
    expect(calls.filter(c => c.startsWith("nav:"))).toEqual(["nav:/image-studio"]);
    expect(calls.filter(c => c.startsWith("act:"))).toEqual([
      "act:setTab:image-studio",
      "act:fillPrompt:image-studio",
      "act:setParam:image-studio",
      "act:submit:image-studio",
    ]);
  });

  it("detectChatIntent for image keywords lands the workflow exclusively on /image-studio", () => {
    // The keyword fallback must never split an image build between
    // /image-studio and other studios — every step's path is /image-studio
    // so we know exactly where the orb is taking the user.
    const detection = detectChatIntent("幫我做一張寫實風格的圖片");
    expect(detection.kind).toBe("ready");
    if (detection.kind === "ready") {
      const paths = new Set(detection.workflow.steps.map(s => s.path));
      expect(paths).toEqual(new Set(["/image-studio"]));
    }
  });

  // ─── 多步驟執行 (multi-step / runWorkflow) end-to-end coverage ─────────
  // Above tests cover individual actions and ad-hoc executeGlobalActions
  // chains. These tests exercise the *real* tasked-execution path: a
  // single runWorkflow action with N steps going through
  // executeGlobalWorkflow. This is what the orb actually dispatches when
  // the planner returns a tasked plan that lands on /image-studio.

  it("buildImageWorkflow runs end-to-end through executeGlobalWorkflow", async () => {
    // The keyword fallback's image build (buildImageWorkflow) is a real
    // RunWorkflowAction — verify the orchestrator can drive every step
    // with /image-studio live-registered.
    globalAgentRegistry.clear();
    globalAgentRegistry.register(
      makePage("image-studio", "/image-studio", "圖片創作室", [
        "fillPrompt",
        "submit",
      ])
    );
    const calls: string[] = [];
    const wf = buildImageWorkflow("夜晚電影感咖啡廳，雨後街道，霓虹反光");
    const result = await executeGlobalWorkflow(wf, {
      currentPage: null,
      navigate: async path => calls.push(`nav:${path}`),
      dispatch: async (action, opts) => {
        calls.push(`act:${action.type}:${opts?.targetPageId ?? "none"}`);
        return { ok: true };
      },
      waitAfterNavigateMs: 0,
      onWorkflowStep: step => calls.push(`step:${step.index + 1}/${step.total}`),
    });
    expect(result.ok).toBe(true);
    expect(result.workflowName).toBe("圖片生成流程");
    // Single navigate (path-threading), every step dispatched on
    // /image-studio, onWorkflowStep fires once per declared step.
    expect(calls.filter(c => c.startsWith("nav:"))).toEqual(["nav:/image-studio"]);
    expect(calls.filter(c => c.startsWith("act:"))).toEqual([
      "act:fillPrompt:image-studio",
      "act:submit:image-studio",
    ]);
    expect(calls.filter(c => c.startsWith("step:"))).toEqual([
      "step:1/2",
      "step:2/2",
    ]);
  });

  it("a six-step image runWorkflow (setTab → setModel → applyPreset → fillPrompt → setParam → submit) all dispatches on /image-studio", async () => {
    // Simulates what the orb's planner emits for a "deep-dive image
    // creation" tasked plan: configure the tab + model + vibe, fill the
    // prompt, set the aspect ratio, then submit. Pre-supportedActions,
    // setModel could leak to /studio or /video-studio because the static
    // fallback was permissive; with the audit it stays on /image-studio.
    globalAgentRegistry.clear();
    globalAgentRegistry.register(
      makePage("image-studio", "/image-studio", "圖片創作室", [
        "setTab",
        "setModel",
        "applyPreset",
        "fillPrompt",
        "setParam",
        "submit",
      ])
    );
    const calls: string[] = [];
    const result = await executeGlobalWorkflow(
      {
        type: "runWorkflow",
        name: "深度圖片創作",
        steps: [
          { path: "/image-studio", actionType: "setTab", payload: "t2i", label: "切到 t2i" },
          { path: "/image-studio", actionType: "setModel", payload: "imagen", label: "選 imagen 模型" },
          { path: "/image-studio", actionType: "applyPreset", payload: "cinematic", label: "套用電影感" },
          { path: "/image-studio", actionType: "fillPrompt", payload: "城市夜雨", label: "填入提示詞" },
          { path: "/image-studio", actionType: "setParam", payload: "aspectRatio:16:9", label: "設定寬螢幕" },
          { path: "/image-studio", actionType: "submit", payload: "", label: "送出生成" },
        ],
      },
      {
        currentPage: null,
        navigate: async path => calls.push(`nav:${path}`),
        dispatch: async (action, opts) => {
          calls.push(`act:${action.type}:${opts?.targetPageId ?? "none"}`);
          return { ok: true };
        },
        waitAfterNavigateMs: 0,
      }
    );
    expect(result.ok).toBe(true);
    // Single nav, six dispatches, all on image-studio.
    expect(calls.filter(c => c.startsWith("nav:"))).toEqual(["nav:/image-studio"]);
    expect(calls.filter(c => c.startsWith("act:"))).toEqual([
      "act:setTab:image-studio",
      "act:setModel:image-studio",
      "act:applyPreset:image-studio",
      "act:fillPrompt:image-studio",
      "act:setParam:image-studio",
      "act:submit:image-studio",
    ]);
  });

  it("a multi-step runWorkflow with NO step.path still lands every dispatch on /image-studio via fallback", async () => {
    // Defensive: when the LLM forgets to attach pagePath to each step
    // (happens occasionally with smaller models), the orchestrator's
    // per-step static fallback must resolve every step to /image-studio
    // because the audited supportedActions filter eliminates other
    // candidates. Pre-fix this used to dispatch on the current page (or
    // worst, fail with "no route found").
    globalAgentRegistry.clear();
    globalAgentRegistry.register(
      makePage("image-studio", "/image-studio", "圖片創作室", [
        "setTab",
        "fillPrompt",
        "submit",
      ])
    );
    const calls: string[] = [];
    const result = await executeGlobalWorkflow(
      {
        type: "runWorkflow",
        name: "缺路徑的圖片流程",
        steps: [
          // setTab is uniquely owned by image/video/pro studio + director +
          // lora-trainer. With image-studio live-registered, the fallback's
          // tiebreaker (priority + token in haystack) lands here.
          { actionType: "setTab", payload: "t2i", label: "切分頁" },
          { actionType: "fillPrompt", payload: "電影感的療癒圖片", label: "填提示詞" },
          { actionType: "submit", payload: "", label: "送出" },
        ],
      },
      {
        currentPage: null,
        navigate: async path => calls.push(`nav:${path}`),
        dispatch: async (action, opts) => {
          calls.push(`act:${action.type}:${opts?.targetPageId ?? "none"}`);
          return { ok: true };
        },
        waitAfterNavigateMs: 0,
      }
    );
    expect(result.ok).toBe(true);
    // Path threading: only ONE navigate even with no path declared per step.
    expect(calls.filter(c => c.startsWith("nav:"))).toEqual(["nav:/image-studio"]);
    expect(calls.filter(c => c.startsWith("act:"))).toEqual([
      "act:setTab:image-studio",
      "act:fillPrompt:image-studio",
      "act:submit:image-studio",
    ]);
  });

  it("multi-step image workflow with a failing dispatch surfaces a clear failure (no silent skip)", async () => {
    // Failure semantics: a multi-step plan must abort on first failure
    // and surface the reason, not pretend the workflow succeeded just
    // because some steps ran. /image-studio's submit gate frequently
    // fails (missing prompt, generation in progress, missing API key) —
    // the orb's UI must see the real reason.
    globalAgentRegistry.clear();
    globalAgentRegistry.register(
      makePage("image-studio", "/image-studio", "圖片創作室", [
        "fillPrompt",
        "submit",
      ])
    );
    const calls: string[] = [];
    const result = await executeGlobalWorkflow(
      {
        type: "runWorkflow",
        name: "圖片流程含失敗",
        steps: [
          { path: "/image-studio", actionType: "fillPrompt", payload: "x", label: "a" },
          { path: "/image-studio", actionType: "submit", payload: "", label: "b" },
        ],
      },
      {
        currentPage: null,
        navigate: async path => calls.push(`nav:${path}`),
        dispatch: async action => {
          calls.push(`act:${action.type}`);
          return action.type === "submit"
            ? { ok: false, reason: "image-studio: missing API key" }
            : { ok: true };
        },
        waitAfterNavigateMs: 0,
      }
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("missing API key");
    // The failed step's outcome must be in the results array — the orb's
    // failure card relies on this to tell the user where the workflow
    // stopped.
    expect(result.results).toHaveLength(2);
    expect(result.results[1]?.ok).toBe(false);
    // endingPath is /image-studio so the user lands on the right page to
    // fix the issue manually.
    expect(result.endingPath).toBe("/image-studio");
  });

  // ─── 全站光球代理 ↔ /video-studio (影片工作室) multi-step coverage ─────
  // VideoStudio.tsx's handler switch covers fillPrompt / focusElement /
  // reset / setModel / setParam / setTab / submit. Notably NO applyPreset
  // and NO openDialog (unlike /image-studio) and NO setModality (unlike
  // /studio). The supportedActions audit must enforce this so the orb's
  // ranker doesn't silently dispatch unsupported actions to /video-studio.

  it("/video-studio supportedActions matches VideoStudio.tsx's actual handler switch", () => {
    // setTab/setModel/fillPrompt/submit/reset/setParam are the six non-
    // universal actions VideoStudio actually implements. focusElement is
    // universally handled by PageAgentContext. Crucially: applyPreset and
    // openDialog are NOT here — VideoStudio doesn't handle them.
    const videoStudio = APP_PAGE_REGISTRY.find(p => p.id === "video-studio");
    expect(videoStudio).toBeTruthy();
    expect(new Set(videoStudio!.supportedActions)).toEqual(
      new Set([
        "setTab",
        "setModel",
        "fillPrompt",
        "submit",
        "reset",
        "setParam",
        "focusElement",
      ])
    );
    expect(videoStudio!.supportedActions).not.toContain("applyPreset");
    expect(videoStudio!.supportedActions).not.toContain("openDialog");
    expect(videoStudio!.supportedActions).not.toContain("setModality");
  });

  it("buildShortVideoWorkflow's /video-studio steps only use actions VideoStudio handles", () => {
    // The cross-page short-video workflow (director → studio →
    // video-studio → pro-studio) must not hand /video-studio an action
    // it can't process. Filter to /video-studio steps and assert each
    // actionType is in supportedActions.
    const wf = buildShortVideoWorkflow("夜晚電影感咖啡廳");
    const videoStudio = APP_PAGE_REGISTRY.find(p => p.id === "video-studio");
    expect(videoStudio).toBeTruthy();
    const videoSteps = wf.steps.filter(s => s.path === "/video-studio");
    expect(videoSteps.length).toBeGreaterThan(0);
    for (const step of videoSteps) {
      expect(videoStudio!.supportedActions).toContain(step.actionType);
    }
  });

  it("buildLongVideoWorkflow's /video-studio steps (every chapter) only use actions VideoStudio handles", () => {
    // The long-video workflow scales /video-studio steps with chapter
    // count. Even with 6 chapters (12 video-studio steps), every step
    // must hit a VideoStudio-handled action.
    const wf = buildLongVideoWorkflow("六章節旅行紀錄片", { chapters: 6 });
    const videoStudio = APP_PAGE_REGISTRY.find(p => p.id === "video-studio");
    expect(videoStudio).toBeTruthy();
    const videoSteps = wf.steps.filter(s => s.path === "/video-studio");
    expect(videoSteps.length).toBe(12); // 2 steps × 6 chapters
    for (const step of videoSteps) {
      expect(videoStudio!.supportedActions).toContain(step.actionType);
    }
  });

  it("a multi-step video runWorkflow (setTab → setModel → fillPrompt → setParam → submit) all dispatches on /video-studio", async () => {
    // Five-step deep-dive video creation: configure tab + model, fill
    // prompt, set duration, submit. Notably: no applyPreset because
    // VideoStudio doesn't handle it — orb must respect that.
    globalAgentRegistry.clear();
    globalAgentRegistry.register(
      makePage("video-studio", "/video-studio", "影片創作室", [
        "setTab",
        "setModel",
        "fillPrompt",
        "setParam",
        "submit",
      ])
    );
    const calls: string[] = [];
    const result = await executeGlobalWorkflow(
      {
        type: "runWorkflow",
        name: "深度影片創作",
        steps: [
          { path: "/video-studio", actionType: "setTab", payload: "t2v", label: "切到 t2v" },
          { path: "/video-studio", actionType: "setModel", payload: "kling-2.0", label: "選 kling 模型" },
          { path: "/video-studio", actionType: "fillPrompt", payload: "城市夜雨運鏡", label: "填提示詞" },
          { path: "/video-studio", actionType: "setParam", payload: "duration:8", label: "設定 8 秒" },
          { path: "/video-studio", actionType: "submit", payload: "", label: "送出生成" },
        ],
      },
      {
        currentPage: null,
        navigate: async path => calls.push(`nav:${path}`),
        dispatch: async (action, opts) => {
          calls.push(`act:${action.type}:${opts?.targetPageId ?? "none"}`);
          return { ok: true };
        },
        waitAfterNavigateMs: 0,
      }
    );
    expect(result.ok).toBe(true);
    expect(calls.filter(c => c.startsWith("nav:"))).toEqual(["nav:/video-studio"]);
    expect(calls.filter(c => c.startsWith("act:"))).toEqual([
      "act:setTab:video-studio",
      "act:setModel:video-studio",
      "act:fillPrompt:video-studio",
      "act:setParam:video-studio",
      "act:submit:video-studio",
    ]);
  });

  it("a video runWorkflow with NO step.path still lands every dispatch on /video-studio via fallback", async () => {
    // Same defensive contract as the image-studio version: when a smaller
    // LLM forgets pagePath, the per-step static fallback must resolve
    // each step to /video-studio. We register /video-studio live to
    // mirror the post-navigate state in production.
    globalAgentRegistry.clear();
    globalAgentRegistry.register(
      makePage("video-studio", "/video-studio", "影片創作室", [
        "setTab",
        "fillPrompt",
        "submit",
      ])
    );
    const calls: string[] = [];
    const result = await executeGlobalWorkflow(
      {
        type: "runWorkflow",
        name: "缺路徑的影片流程",
        steps: [
          { actionType: "setTab", payload: "t2v", label: "切分頁" },
          { actionType: "fillPrompt", payload: "電影感的夜雨運鏡影片", label: "填提示詞" },
          { actionType: "submit", payload: "", label: "送出" },
        ],
      },
      {
        currentPage: null,
        navigate: async path => calls.push(`nav:${path}`),
        dispatch: async (action, opts) => {
          calls.push(`act:${action.type}:${opts?.targetPageId ?? "none"}`);
          return { ok: true };
        },
        waitAfterNavigateMs: 0,
      }
    );
    expect(result.ok).toBe(true);
    expect(calls.filter(c => c.startsWith("nav:"))).toEqual(["nav:/video-studio"]);
    expect(calls.filter(c => c.startsWith("act:"))).toEqual([
      "act:setTab:video-studio",
      "act:fillPrompt:video-studio",
      "act:submit:video-studio",
    ]);
  });

  it("the cross-page short-video workflow drives /video-studio (fillPrompt + submit) end to end", async () => {
    // buildShortVideoWorkflow spans /director → /studio → /video-studio →
    // /pro-studio. With every studio live-registered (mirrors post-
    // navigate state), executeGlobalWorkflow must navigate exactly once
    // per page boundary, dispatch every step on its declared page, and
    // every /video-studio step lands on /video-studio's handler.
    globalAgentRegistry.clear();
    globalAgentRegistry.register(makePage("director", "/director", "導演 AI", ["fillPrompt"]));
    globalAgentRegistry.register(
      makePage("studio", "/studio", "創作工作室", [
        "setModality",
        "fillPrompt",
        "submit",
      ])
    );
    globalAgentRegistry.register(
      makePage("video-studio", "/video-studio", "影片創作室", [
        "fillPrompt",
        "submit",
      ])
    );
    globalAgentRegistry.register(
      makePage("pro-studio", "/pro-studio", "音樂配音創作室", [
        "setTab",
        "fillPrompt",
        "submit",
      ])
    );
    const calls: string[] = [];
    const wf = { ...buildShortVideoWorkflow("城市夜雨咖啡廳的療癒短片"), steps: buildShortVideoWorkflow("城市夜雨咖啡廳的療癒短片").steps.filter(step => !step.toolName) };
    const result = await executeGlobalWorkflow(wf, {
      currentPage: null,
      navigate: async path => calls.push(`nav:${path}`),
      dispatch: async (action, opts) => {
        calls.push(`act:${action.type}@${opts?.targetPageId ?? "none"}`);
        return { ok: true };
      },
      waitAfterNavigateMs: 0,
    });
    expect(result.ok).toBe(true);
    // Every /video-studio step in the cross-page chain dispatched on
    // /video-studio — that's the contract for the orb→影片工作室 multi-
    // step connection.
    const videoSteps = wf.steps.filter(s => s.path === "/video-studio");
    expect(videoSteps.length).toBeGreaterThanOrEqual(2);
    const videoDispatches = calls.filter(c => c.endsWith("@video-studio"));
    expect(videoDispatches.length).toBe(videoSteps.length);
    // /video-studio gets navigated to exactly once across the workflow.
    expect(calls.filter(c => c === "nav:/video-studio")).toHaveLength(1);
  });

  it("multi-step video workflow surfaces a clear failure on submit (no silent skip)", async () => {
    // Same failure-semantics contract as the image-studio version:
    // /video-studio submit fails frequently (missing API key, video
    // generation timeout). The orb's failure card needs the real reason
    // and the right endingPath to drop the user back on /video-studio.
    globalAgentRegistry.clear();
    globalAgentRegistry.register(
      makePage("video-studio", "/video-studio", "影片創作室", [
        "fillPrompt",
        "submit",
      ])
    );
    const result = await executeGlobalWorkflow(
      {
        type: "runWorkflow",
        name: "影片流程含失敗",
        steps: [
          { path: "/video-studio", actionType: "fillPrompt", payload: "x", label: "a" },
          { path: "/video-studio", actionType: "submit", payload: "", label: "b" },
        ],
      },
      {
        currentPage: null,
        navigate: async () => undefined,
        dispatch: async action =>
          action.type === "submit"
            ? { ok: false, reason: "video-studio: kling API timeout" }
            : { ok: true },
        waitAfterNavigateMs: 0,
      }
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("kling API timeout");
    expect(result.results[1]?.ok).toBe(false);
    expect(result.endingPath).toBe("/video-studio");
  });

  // ─── /studio narrow-handler routing defect (multi-step bug fix) ────────
  // /studio's `case "applyPreset"` handler only accepts ids starting with
  // "creative:" (creative-mode levels). Its `case "setModel"` only accepts
  // positive integer LoRA fine-tune IDs. Both are nominally in /studio's
  // supportedActions because the case blocks exist — but the static
  // fallback's priority tiebreak (Studio = priority 2) used to make
  // /studio win over /image-studio (priority 3) for `applyPreset:
  // vibe-cinematic` and `setModel:imagen`, dispatching to a guaranteed-
  // fail target and stalling the orb's multi-step plan one step in.
  // resolveStaticFallback now skips /studio for these payload shapes.

  it("static fallback skips /studio for non-creative applyPreset (routes to a vibe-aware studio)", async () => {
    globalAgentRegistry.clear();
    globalAgentRegistry.register(makePage("agent-chat", "/agent", "全站光球代理", []));
    const calls: string[] = [];
    const result = await executeGlobalAction(
      { type: "applyPreset", presetId: "vibe-cinematic" },
      {
        currentPage: null,
        navigate: async path => calls.push(`nav:${path}`),
        dispatch: async (action, opts) => {
          calls.push(`act:${action.type}:${opts?.targetPageId}`);
          return { ok: true };
        },
        waitAfterNavigateMs: 0,
      }
    );
    expect(result.ok).toBe(true);
    // /image-studio / /pro-studio / /director are vibe-aware and accept
    // arbitrary preset IDs. Either is acceptable — what we MUST never see
    // is /studio winning, because /studio rejects non-creative presets.
    expect(calls[0]).not.toBe("nav:/studio");
    expect(calls[0]).toMatch(/^nav:\/(image-studio|pro-studio|director|lora-trainer)$/);
  });

  it("static fallback still picks /studio for creative-mode applyPreset (creative:simple/standard/pro)", async () => {
    // The flip side of the narrow-handler gate: /studio is the ONLY page
    // that handles creative:* presets. It must still win for those payloads.
    globalAgentRegistry.clear();
    globalAgentRegistry.register(makePage("agent-chat", "/agent", "全站光球代理", []));
    const calls: string[] = [];
    const result = await executeGlobalAction(
      { type: "applyPreset", presetId: "creative:simple" },
      {
        currentPage: null,
        navigate: async path => calls.push(`nav:${path}`),
        dispatch: async () => ({ ok: true }),
        waitAfterNavigateMs: 0,
      }
    );
    expect(result.ok).toBe(true);
    expect(calls[0]).toBe("nav:/studio");
  });

  it("static fallback skips /studio for non-numeric setModel (routes to a string-model studio)", async () => {
    globalAgentRegistry.clear();
    globalAgentRegistry.register(makePage("agent-chat", "/agent", "全站光球代理", []));
    const calls: string[] = [];
    const result = await executeGlobalAction(
      { type: "setModel", modelId: "imagen-image-3" },
      {
        currentPage: null,
        navigate: async path => calls.push(`nav:${path}`),
        dispatch: async () => ({ ok: true }),
        waitAfterNavigateMs: 0,
      }
    );
    expect(result.ok).toBe(true);
    // /image-studio / /video-studio / /pro-studio accept string model IDs.
    // /studio's setModel rejects anything non-numeric (it's a LoRA-only
    // handler) so it must never win this fallback.
    expect(calls[0]).not.toBe("nav:/studio");
    expect(calls[0]).toMatch(/^nav:\/(image-studio|video-studio|pro-studio)$/);
  });

  it("static fallback still picks /studio for numeric setModel (LoRA fine-tune ID)", async () => {
    globalAgentRegistry.clear();
    globalAgentRegistry.register(makePage("agent-chat", "/agent", "全站光球代理", []));
    const calls: string[] = [];
    const result = await executeGlobalAction(
      { type: "setModel", modelId: "42" },
      {
        currentPage: null,
        navigate: async path => calls.push(`nav:${path}`),
        dispatch: async () => ({ ok: true }),
        waitAfterNavigateMs: 0,
      }
    );
    expect(result.ok).toBe(true);
    // For a numeric model ID /studio is a valid candidate (it sets the
    // fineTunedModelId for LoRA injection). Priority breaks the tie.
    expect(calls[0]).toBe("nav:/studio");
  });

  it("multi-step plan with vibe applyPreset + image fillPrompt + submit lands every step on /image-studio (no /studio detour)", async () => {
    // End-to-end regression for the "multi-step stalls one step in"
    // defect. Pre-fix: the applyPreset step routed to /studio (which
    // failed with "unknown presetId"), the workflow aborted, and the
    // user never got their image. Post-fix: every step stays on
    // /image-studio.
    globalAgentRegistry.clear();
    globalAgentRegistry.register(
      makePage("image-studio", "/image-studio", "圖片創作室", [
        "applyPreset",
        "fillPrompt",
        "submit",
      ])
    );
    const calls: string[] = [];
    const result = await executeGlobalActions(
      [
        { type: "applyPreset", presetId: "vibe-cinematic" },
        { type: "fillPrompt", text: "城市夜雨咖啡廳" },
        { type: "submit" },
      ],
      {
        currentPage: null,
        navigate: async path => calls.push(`nav:${path}`),
        dispatch: async (action, opts) => {
          calls.push(`act:${action.type}:${opts?.targetPageId}`);
          return { ok: true };
        },
        waitAfterNavigateMs: 0,
      }
    );
    expect(result.every(r => r.ok)).toBe(true);
    expect(calls.filter(c => c.startsWith("nav:"))).toEqual(["nav:/image-studio"]);
    expect(calls.filter(c => c.startsWith("act:"))).toEqual([
      "act:applyPreset:image-studio",
      "act:fillPrompt:image-studio",
      "act:submit:image-studio",
    ]);
  });
});

describe("orchestrator same-page state-mutation settle", () => {
  // Regression for the multi-step orb bug where setTab → fillPrompt on the
  // same page raced against the React re-mount and ended up writing the
  // prompt into the previous child's bridge (so the user lands on the new
  // tab and sees an empty input). The orchestrator now waits a short window
  // between consecutive same-page state-mutating steps so the destination
  // bridge has time to register.
  it("inserts a settle between setTab and fillPrompt on the same page", async () => {
    globalAgentRegistry.clear();
    globalAgentRegistry.register(
      makePage("pro-studio", "/pro-studio", "音樂配音創作室", [
        "setTab",
        "fillPrompt",
        "submit",
      ])
    );
    const events: Array<{ type: string; at: number }> = [];
    const start = Date.now();
    const result = await executeGlobalWorkflow(
      {
        type: "runWorkflow",
        name: "TTS 配音流程",
        steps: [
          { path: "/pro-studio", actionType: "setTab", payload: "tts", label: "切到 TTS" },
          { path: "/pro-studio", actionType: "fillPrompt", payload: "請朗讀這段旁白", label: "填入旁白" },
          { path: "/pro-studio", actionType: "submit", payload: "", label: "送出生成" },
        ],
      },
      {
        currentPage: null,
        navigate: async () => {},
        dispatch: async action => {
          events.push({ type: action.type, at: Date.now() - start });
          return { ok: true };
        },
        waitAfterNavigateMs: 0,
        samePageStateMutationSettleMs: 50,
      }
    );
    expect(result.ok).toBe(true);
    const setTabEvent = events.find(e => e.type === "setTab")!;
    const fillPromptEvent = events.find(e => e.type === "fillPrompt")!;
    const submitEvent = events.find(e => e.type === "submit")!;
    expect(setTabEvent).toBeDefined();
    expect(fillPromptEvent).toBeDefined();
    expect(submitEvent).toBeDefined();
    // setTab → fillPrompt must wait the configured settle.
    expect(fillPromptEvent.at - setTabEvent.at).toBeGreaterThanOrEqual(45);
    // fillPrompt → submit is not a state-mutating sequence, so no settle.
    expect(submitEvent.at - fillPromptEvent.at).toBeLessThan(45);
  });

  it("skips the settle when samePageStateMutationSettleMs is zero", async () => {
    globalAgentRegistry.clear();
    globalAgentRegistry.register(
      makePage("pro-studio", "/pro-studio", "音樂配音創作室", [
        "setTab",
        "fillPrompt",
        "submit",
      ])
    );
    const events: Array<{ type: string; at: number }> = [];
    const start = Date.now();
    const result = await executeGlobalWorkflow(
      {
        type: "runWorkflow",
        name: "TTS 配音流程（測試）",
        steps: [
          { path: "/pro-studio", actionType: "setTab", payload: "tts", label: "切到 TTS" },
          { path: "/pro-studio", actionType: "fillPrompt", payload: "x", label: "填入" },
        ],
      },
      {
        currentPage: null,
        navigate: async () => {},
        dispatch: async action => {
          events.push({ type: action.type, at: Date.now() - start });
          return { ok: true };
        },
        waitAfterNavigateMs: 0,
        samePageStateMutationSettleMs: 0,
      }
    );
    expect(result.ok).toBe(true);
    const setTabEvent = events.find(e => e.type === "setTab")!;
    const fillPromptEvent = events.find(e => e.type === "fillPrompt")!;
    expect(fillPromptEvent.at - setTabEvent.at).toBeLessThan(30);
  });

  it("does NOT settle when prev and next steps are on different pages", async () => {
    globalAgentRegistry.clear();
    globalAgentRegistry.register(
      makePage("studio", "/studio", "創作工作室", ["setModality"])
    );
    globalAgentRegistry.register(
      makePage("pro-studio", "/pro-studio", "音樂配音創作室", ["fillPrompt"])
    );
    const events: Array<{ type: string; path: string | undefined; at: number }> = [];
    const start = Date.now();
    const result = await executeGlobalWorkflow(
      {
        type: "runWorkflow",
        name: "跨頁流程",
        steps: [
          { path: "/studio", actionType: "setModality", payload: "image", label: "切圖像" },
          { path: "/pro-studio", actionType: "fillPrompt", payload: "x", label: "填入" },
        ],
      },
      {
        currentPage: null,
        navigate: async () => {},
        dispatch: async (action, opts) => {
          events.push({ type: action.type, path: opts?.targetPageId, at: Date.now() - start });
          return { ok: true };
        },
        waitAfterNavigateMs: 0,
        samePageStateMutationSettleMs: 50,
      }
    );
    expect(result.ok).toBe(true);
    const setModalityEvent = events.find(e => e.type === "setModality")!;
    const fillPromptEvent = events.find(e => e.type === "fillPrompt")!;
    // Cross-page: navigate's own settle (waitAfterNavigateMs=0 here) covers
    // it. The same-page state-mutation settle should NOT fire.
    expect(fillPromptEvent.at - setModalityEvent.at).toBeLessThan(30);
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
