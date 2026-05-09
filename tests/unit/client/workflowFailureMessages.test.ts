/**
 * workflowFailureMessages.test.ts — 鎖住 panel + chat bubble 顯示用的友善
 * 訊息對照表。每加一條 mapping 就在這邊補一條測試，避免某天有人改回
 * 「unsupported action」那種裸 reason 還沒被人發現。
 */
import { describe, expect, it } from "vitest";
import {
  formatWorkflowActionTypeLabel,
  formatWorkflowFailure,
  formatWorkflowPhaseLabel,
  formatWorkflowTargetLabel,
} from "../../../client/src/lib/workflowFailureMessages";

describe("formatWorkflowActionTypeLabel", () => {
  it("把已知 actionType 翻成中文", () => {
    expect(formatWorkflowActionTypeLabel("fillPrompt")).toBe("填入提示詞");
    expect(formatWorkflowActionTypeLabel("setTab")).toBe("切換分頁");
    expect(formatWorkflowActionTypeLabel("setModality")).toBe("切換模態");
    expect(formatWorkflowActionTypeLabel("submit")).toBe("送出生成");
    expect(formatWorkflowActionTypeLabel("runWorkflow")).toBe("執行工作流");
  });

  it("沒對到 mapping 就回原 type，不會回 undefined", () => {
    expect(formatWorkflowActionTypeLabel("brandNewType")).toBe("brandNewType");
  });

  it("undefined → 「（未指定動作）」", () => {
    expect(formatWorkflowActionTypeLabel(undefined)).toBe("（未指定動作）");
  });
});

describe("formatWorkflowTargetLabel", () => {
  it("已知 path 回 label + raw + hasLabel=true", () => {
    const result = formatWorkflowTargetLabel("/director");
    expect(result.hasLabel).toBe(true);
    expect(result.display).toBe("導演 AI");
    expect(result.rawPath).toBe("/director");
  });

  it("未知 path 回 path 本身，hasLabel=false，沒有 rawPath", () => {
    const result = formatWorkflowTargetLabel("/totally-made-up");
    expect(result.hasLabel).toBe(false);
    expect(result.display).toBe("/totally-made-up");
    expect(result.rawPath).toBeUndefined();
  });

  it("undefined path 回「（未指定頁面）」", () => {
    const result = formatWorkflowTargetLabel(undefined);
    expect(result.hasLabel).toBe(false);
    expect(result.display).toBe("（未指定頁面）");
  });
});

describe("formatWorkflowFailure", () => {
  it("'unsupported action' 翻成「這頁不支援這個動作」並帶上頁面 + 動作 context", () => {
    const f = formatWorkflowFailure("unsupported action", {
      actionType: "fillPrompt",
      path: "/director",
    });
    expect(f.headline).toBe("這頁不支援這個動作");
    expect(f.summary).toContain("導演 AI");
    expect(f.summary).toContain("填入提示詞");
    expect(f.hint).toBeTruthy();
    expect(f.rawReason).toBe("unsupported action");
  });

  it("'<page>: unsupported action \"<type>\"' 抓出 type 並翻譯", () => {
    const f = formatWorkflowFailure(
      'admin: unsupported action "applyPreset"',
      { path: "/admin" }
    );
    expect(f.headline).toBe("這頁不支援這個動作");
    expect(f.summary).toContain("套用預設");
  });

  it("'unknown tabId: foo' 翻成『找不到分頁』並標出名稱", () => {
    const f = formatWorkflowFailure("unknown tabId: foo", {
      path: "/director",
    });
    expect(f.headline).toBe("找不到分頁");
    expect(f.summary).toContain("「foo」");
    expect(f.summary).toContain("導演 AI");
  });

  it("'unknown personality: zen' 翻成『找不到這位導演風格』", () => {
    const f = formatWorkflowFailure("unknown personality: zen");
    expect(f.headline).toBe("找不到這位導演風格");
    expect(f.summary).toContain("「zen」");
    expect(f.hint).toContain("calm");
  });

  it("'no matching page handler' 翻成『目標頁還沒準備好』", () => {
    const f = formatWorkflowFailure("no matching page handler", {
      actionType: "fillPrompt",
      path: "/director",
    });
    expect(f.headline).toBe("目標頁還沒準備好");
    expect(f.summary).toContain("導演 AI");
    expect(f.summary).toContain("填入提示詞");
  });

  it("'workflow disabled' 保留既有的人話", () => {
    const f = formatWorkflowFailure("workflow disabled");
    expect(f.headline).toBe("工作流功能暫時關閉");
    expect(f.hint).toBeTruthy();
  });

  it("'no route found' 保留既有的人話", () => {
    const f = formatWorkflowFailure("no route found");
    expect(f.headline).toBe("找不到對應頁面");
  });

  it("'empty text' 翻成『提示詞是空的』", () => {
    const f = formatWorkflowFailure("empty text", {
      actionType: "fillPrompt",
    });
    expect(f.headline).toBe("提示詞是空的");
    expect(f.summary).toContain("填入提示詞");
  });

  it("'callTool hook missing for tool studio.generateImage' 翻成『工具還沒接上』", () => {
    const f = formatWorkflowFailure(
      "callTool hook missing for tool studio.generateImage"
    );
    expect(f.headline).toBe("工具還沒接上");
    expect(f.summary).toContain("studio.generateImage");
  });

  it("'tool studio.generateImage failed' 翻成『工具呼叫失敗』", () => {
    const f = formatWorkflowFailure("tool studio.generateImage failed");
    expect(f.headline).toBe("工具呼叫失敗");
    expect(f.summary).toContain("studio.generateImage");
  });

  it("'step \"X\" has neither toolName nor action' 翻成『工作流定義缺欄位』", () => {
    const f = formatWorkflowFailure(
      'step "音樂配音創作室：切換到語音合成" has neither toolName nor action'
    );
    expect(f.headline).toBe("工作流定義缺欄位");
  });

  it("'aborted at step \"X\"' 翻成『你選擇中止這一步』", () => {
    const f = formatWorkflowFailure('aborted at step "圖像工作室：生成關鍵視覺"');
    expect(f.headline).toBe("你選擇中止這一步");
    expect(f.summary).toContain("圖像工作室：生成關鍵視覺");
  });

  it("'perception: no-effect' 翻成『光球觀察到結果不對』", () => {
    const f = formatWorkflowFailure("perception: no-effect");
    expect(f.headline).toBe("光球觀察到結果不對");
    expect(f.summary).toContain("no-effect");
  });

  it("'handler threw unknown error' 翻成『頁面執行時出錯』並帶上頁面 + 動作", () => {
    const f = formatWorkflowFailure("handler threw unknown error", {
      actionType: "submit",
      path: "/video-studio",
    });
    expect(f.headline).toBe("頁面執行時出錯");
    expect(f.summary).toContain("送出生成");
  });

  it("空 reason 仍然有友善 headline + summary", () => {
    const f = formatWorkflowFailure("", {
      actionType: "fillPrompt",
      path: "/director",
    });
    expect(f.headline).toBe("卡在這一步");
    expect(f.summary).toContain("導演 AI");
    expect(f.summary).toContain("填入提示詞");
    expect(f.rawReason).toBe("");
  });

  it("沒對到任何 mapping 就保留 raw reason 在 summary 尾巴", () => {
    const f = formatWorkflowFailure("some brand new failure mode", {
      actionType: "submit",
      path: "/studio",
    });
    expect(f.headline).toBe("卡在這一步");
    expect(f.summary).toContain("some brand new failure mode");
    expect(f.rawReason).toBe("some brand new failure mode");
  });

  it("呼叫端可以塞自訂的 label，覆蓋 path → label 的查表", () => {
    const f = formatWorkflowFailure("unsupported action", {
      actionType: "submit",
      path: "/director",
      label: "我自己手動命的名",
    });
    expect(f.summary).toContain("「我自己手動命的名」");
    expect(f.summary).not.toContain("導演 AI");
  });
});

describe("formatWorkflowPhaseLabel", () => {
  it("navigating → 「正在跳到…」並用 detail / path 解析頁面 label", () => {
    expect(
      formatWorkflowPhaseLabel("navigating", { detail: "/director" })
    ).toBe("正在跳到「導演 AI」…");
    expect(
      formatWorkflowPhaseLabel("navigating", { path: "/studio" })
    ).toBe("正在跳到「創作工作室」…");
  });

  it("settling → 「等頁面切換完成…」", () => {
    expect(formatWorkflowPhaseLabel("settling")).toBe("等頁面切換完成…");
  });

  it("awaiting_handler → 「等「<page>」載入中…」", () => {
    expect(
      formatWorkflowPhaseLabel("awaiting_handler", { detail: "/director" })
    ).toBe("等「導演 AI」載入中…");
  });

  it("dispatching → 用 detail / actionType 翻成『正在執行：填入提示詞…』", () => {
    expect(
      formatWorkflowPhaseLabel("dispatching", { detail: "fillPrompt" })
    ).toBe("正在執行：填入提示詞…");
    expect(
      formatWorkflowPhaseLabel("dispatching", { actionType: "setTab" })
    ).toBe("正在執行：切換分頁…");
  });

  it("dispatching detail='tool:<name>' → 「呼叫工具「<name>」…」", () => {
    expect(
      formatWorkflowPhaseLabel("dispatching", { detail: "tool:studio.generateImage" })
    ).toBe("呼叫工具「studio.generateImage」…");
  });

  it("observing → 「光球在檢查結果…」", () => {
    expect(formatWorkflowPhaseLabel("observing")).toBe("光球在檢查結果…");
  });

  it("retrying → 直接用 detail（已是「第 N 次嘗試」），沒給就 fallback", () => {
    expect(
      formatWorkflowPhaseLabel("retrying", { detail: "第 3 次嘗試" })
    ).toBe("第 3 次嘗試");
    expect(formatWorkflowPhaseLabel("retrying")).toBe("重新嘗試這一步…");
  });

  it("null / undefined / 空字串 phase → 回 null（UI 整塊不渲染）", () => {
    expect(formatWorkflowPhaseLabel(null)).toBeNull();
    expect(formatWorkflowPhaseLabel(undefined)).toBeNull();
    expect(formatWorkflowPhaseLabel("")).toBeNull();
  });

  it("沒對到的 phase 名稱直接回原字串，不會回 null（forward-compat）", () => {
    expect(formatWorkflowPhaseLabel("future-phase-xyz")).toBe(
      "future-phase-xyz"
    );
  });
});
