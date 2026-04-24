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
  buildShortVideoWorkflow,
  expandWorkflowAction,
  maybeCreateWorkflowFromUserText,
  workflowStepToAction,
} from "../shared/global-agent-workflows";
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
