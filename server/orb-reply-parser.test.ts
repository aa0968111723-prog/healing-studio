/**
 * orb-reply-parser.test.ts — Phase 3a
 *
 * 測試 `parseOrbReply`：把 LLM 原始字串裡的 `[ACTION:...]`、
 * `[INTENT:...]`、`[CONFIRM:...]`、`[SUGGEST:...]` marker 拆解成前端
 * 能直接吃的 `{ reply, actions, intent, askBeforeAct, suggestions }`。
 */

import { describe, expect, it } from "vitest";
import {
  ORB_ALLOWED_ACTIONS,
  ORB_DESTRUCTIVE_ACTIONS,
  parseOrbReply,
} from "./services/orbReplyParser";

describe("parseOrbReply", () => {
  it("回傳空物件當 LLM 給空字串", () => {
    const r = parseOrbReply("");
    expect(r.reply).toBe("");
    expect(r.actions).toEqual([]);
    expect(r.intent).toBeNull();
    expect(r.askBeforeAct).toBe(false);
    expect(r.suggestions).toEqual([]);
  });

  it("純文字回覆不帶任何 marker 時原樣保留", () => {
    const r = parseOrbReply("你好呀～今天想創作什麼？");
    expect(r.reply).toBe("你好呀～今天想創作什麼？");
    expect(r.actions).toEqual([]);
  });

  it("抽取合法的 ACTION marker 並從 reply 去除", () => {
    const raw =
      "好呀，我先幫你把提示詞調整好 [ACTION:fillPrompt:溫暖的早晨陽光] 要繼續嗎？";
    const r = parseOrbReply(raw);
    expect(r.actions).toEqual([
      { type: "fillPrompt", payload: "溫暖的早晨陽光" },
    ]);
    expect(r.reply).not.toContain("[ACTION:");
    expect(r.reply).toContain("好呀");
  });

  it("未在白名單的 ACTION 會被丟棄", () => {
    const r = parseOrbReply("[ACTION:deleteAccount:now]");
    expect(r.actions).toEqual([]);
    // marker 文字仍被移除，不會污染 reply
    expect(r.reply).toBe("");
  });

  it("ACTION 依原始順序保留多個", () => {
    const raw =
      "[ACTION:setTab:t2i] 切過去之後 [ACTION:setModel:seedreamV4] 最後 [ACTION:fillPrompt:竹林中的旗袍女孩]";
    const r = parseOrbReply(raw);
    expect(r.actions.map(a => a.type)).toEqual([
      "setTab",
      "setModel",
      "fillPrompt",
    ]);
    expect(r.actions[1].payload).toBe("seedreamV4");
  });

  it("解析 INTENT marker", () => {
    const r = parseOrbReply(
      "幫你準備好了！ [INTENT:把模型切到 SeeDream 並填入你指定的提示詞]"
    );
    expect(r.intent).toBe("把模型切到 SeeDream 並填入你指定的提示詞");
    expect(r.reply).not.toContain("[INTENT:");
  });

  it("INTENT 缺省時為 null", () => {
    const r = parseOrbReply("好的");
    expect(r.intent).toBeNull();
  });

  it("CONFIRM:true 會設 askBeforeAct=true", () => {
    const r = parseOrbReply("[ACTION:fillPrompt:abc] [CONFIRM:true]");
    expect(r.askBeforeAct).toBe(true);
  });

  it("CONFIRM:false 顯式蓋過破壞性動作的自動要確認", () => {
    const r = parseOrbReply("[ACTION:submit:] [CONFIRM:false]");
    expect(r.askBeforeAct).toBe(false);
  });

  it("CONFIRM 支援大小寫不敏感", () => {
    const r = parseOrbReply("[CONFIRM:TRUE]");
    expect(r.askBeforeAct).toBe(true);
  });

  it("破壞性動作沒標 CONFIRM 時自動 askBeforeAct=true", () => {
    for (const type of ORB_DESTRUCTIVE_ACTIONS) {
      const r = parseOrbReply(`[ACTION:${type}:]`);
      expect(r.askBeforeAct, `destructive=${type}`).toBe(true);
    }
  });

  it("非破壞性動作預設 askBeforeAct=false", () => {
    const r = parseOrbReply("[ACTION:setTab:t2i]");
    expect(r.askBeforeAct).toBe(false);
  });

  it("alwaysConfirm=true 且有動作時強制要確認", () => {
    const r = parseOrbReply("[ACTION:setTab:t2i]", { alwaysConfirm: true });
    expect(r.askBeforeAct).toBe(true);
  });

  it("alwaysConfirm=true 但沒有動作時不會虛假要求確認", () => {
    const r = parseOrbReply("純聊天不做事", { alwaysConfirm: true });
    expect(r.askBeforeAct).toBe(false);
  });

  it("SUGGEST 用 | 分隔，最多留 4 條", () => {
    const r = parseOrbReply("[SUGGEST:好啊|再想想|換個模型|快一點|太多了]");
    expect(r.suggestions).toEqual(["好啊", "再想想", "換個模型", "快一點"]);
  });

  it("SUGGEST 過長或空字串會被過濾", () => {
    const r = parseOrbReply(
      "[SUGGEST:這是一個超過二十個字符限制的建議會被丟掉喔|正常|]"
    );
    expect(r.suggestions).toEqual(["正常"]);
  });

  it("會把所有 marker 從 reply 裡清乾淨", () => {
    const raw =
      "要不要試試？[ACTION:setModel:nanoBananaPro] [INTENT:換成品質更高的 Pro 模型] [CONFIRM:false] [SUGGEST:好|換別的]";
    const r = parseOrbReply(raw);
    expect(r.reply).toBe("要不要試試？");
    expect(r.reply).not.toMatch(/\[/);
  });

  it("白名單至少包含 PageAgent bus 的 10 種動作", () => {
    const expected = [
      "fillPrompt",
      "setModel",
      "setTab",
      "setMode",
      "setModality",
      "setParam",
      "applyPreset",
      "submit",
      "reset",
      "focusElement",
    ];
    for (const t of expected) {
      expect(ORB_ALLOWED_ACTIONS.has(t), `missing action: ${t}`).toBe(true);
    }
  });

  it("典型一問一答的完整解析（快樂路徑）", () => {
    const raw = [
      "我幫你切到圖片創作室、把模型換成 SeeDream v4，然後放入中文提示詞。",
      "[ACTION:navigate:/image-studio]",
      "[ACTION:setTab:t2i]",
      "[ACTION:setModel:seedreamV4]",
      "[ACTION:fillPrompt:一位穿旗袍的女孩站在竹林中]",
      "[INTENT:帶你去圖片創作室，用支援中文的 SeeDream 模型生成你要的畫面]",
      "[CONFIRM:true]",
      "[SUGGEST:好啊|先不要|換別的模型]",
    ].join(" ");
    const r = parseOrbReply(raw);
    expect(r.reply.startsWith("我幫你切到")).toBe(true);
    expect(r.actions.length).toBe(4);
    expect(r.actions.map(a => a.type)).toEqual([
      "navigate",
      "setTab",
      "setModel",
      "fillPrompt",
    ]);
    expect(r.intent).toBe(
      "帶你去圖片創作室，用支援中文的 SeeDream 模型生成你要的畫面"
    );
    expect(r.askBeforeAct).toBe(true);
    expect(r.suggestions).toEqual(["好啊", "先不要", "換別的模型"]);
  });

  it("可解析 TOOL marker（payload 為 encodeURIComponent JSON）", () => {
    const payload = encodeURIComponent(JSON.stringify({ city: "Taipei" }));
    const r = parseOrbReply(`我幫你查天氣 [TOOL:weather.lookup:${payload}]`);
    expect(r.reply).toBe("我幫你查天氣");
    expect(r.toolCalls).toEqual([
      { name: "weather.lookup", args: { city: "Taipei" } },
    ]);
  });

  it("可解析 schema-first JSON 回覆並保留 plannerOutput", () => {
    const raw = JSON.stringify({
      reply: "我整理好計畫了",
      intent: "幫你完成短片",
      plannerOutput: {
        name: "Schema Plan",
        steps: [
          { path: "/director", actionType: "fillPrompt", payload: "企劃", label: "填企劃" },
        ],
      },
      askBeforeAct: true,
      suggestions: ["好啊", "再想想"],
    });
    const r = parseOrbReply(raw);
    expect(r.reply).toBe("我整理好計畫了");
    expect(r.intent).toBe("幫你完成短片");
    expect(r.askBeforeAct).toBe(true);
    expect(r.actions).toEqual([]);
    expect(r.plannerOutput).toMatchObject({
      name: "Schema Plan",
      steps: [{ path: "/director", actionType: "fillPrompt" }],
    });
    expect(r.suggestions).toEqual(["好啊", "再想想"]);
  });

  it("schema-first JSON 若帶 actions，會保留 actions 並套用破壞性確認規則", () => {
    const raw = JSON.stringify({
      reply: "我先幫你送出",
      actions: [
        { type: "fillPrompt", text: "晨霧森林" },
        { type: "submit" },
      ],
    });
    const r = parseOrbReply(raw);
    expect(r.actions).toEqual([
      expect.objectContaining({ type: "fillPrompt", payload: "晨霧森林", text: "晨霧森林" }),
      expect.objectContaining({ type: "submit", payload: "" }),
    ]);
    expect(r.askBeforeAct).toBe(true);
  });

  it("schema-first JSON 會保留 action 額外欄位（例如 setParam 的 key/value）", () => {
    const raw = JSON.stringify({
      reply: "已設定參數",
      actions: [
        { action: "setParam", key: "duration", value: 8 },
      ],
    });
    const r = parseOrbReply(raw);
    expect(r.actions).toEqual([
      expect.objectContaining({
        action: "setParam",
        type: "setParam",
        key: "duration",
        value: 8,
        payload: "",
      }),
    ]);
  });
});

describe("executeActionWithAutoRetry", () => {
  it("retries up to 3 and switches fallback models", async () => {
    const { executeActionWithAutoRetry } = await import("./services/orbReplyParser");
    const calls: string[] = [];
    const result = await executeActionWithAutoRetry({
      action: { type: "submit", payload: "" },
      primaryModel: "model-a",
      fallbackModels: ["model-b", "model-c"],
      maxRetries: 3,
      execute: async ({ model }) => {
        calls.push(model);
        if (calls.length < 3) throw new Error("temporary");
        return { ok: true };
      },
    });
    expect(result.ok).toBe(true);
    expect(calls).toEqual(["model-a", "model-b", "model-c"]);
  });

  it("stops immediately on non-retryable errors", async () => {
    const { executeActionWithAutoRetry } = await import("./services/orbReplyParser");
    const result = await executeActionWithAutoRetry({
      action: { type: "submit", payload: "" },
      primaryModel: "model-a",
      fallbackModels: ["model-b"],
      execute: async () => {
        throw new Error("bad_request");
      },
      isRetryableError: (err) => !String((err as Error).message).includes("bad_request"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.attempts).toBe(1);
      expect(result.triedModels).toEqual(["model-a"]);
    }
  });
});
