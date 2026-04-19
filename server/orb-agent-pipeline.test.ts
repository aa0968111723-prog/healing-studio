/**
 * orb-agent-pipeline.test.ts — Phase 3a 端到端（pure-logic）整合測試
 *
 * 目的：把 LLM 原始字串一路走到「可以給前端 dispatch 的動作 + 回饋事件」的
 *      整條純邏輯管線接起來測，避免單元測試各自綠但合在一起卻斷掉。
 *
 * 串接路徑：
 *   rawLLMReply
 *     → parseOrbReply           (server/services/orbReplyParser)
 *     → coerceAgentAction       (shared/agent-actions)  // marker → typed action
 *     → isDestructiveAction     (shared/agent-actions)  // confirm gate
 *     → summarizeAction         (shared/agent-actions)  // 給確認卡片的摘要
 *     → pushFeedback            (shared/agent-actions)  // 使用者回應回流 LLM
 *
 * 不引入 React / tRPC / DB，整條都是 node 環境可直接測試的純函式。
 */

import { describe, expect, it } from "vitest";
import { parseOrbReply } from "./services/orbReplyParser";
import {
  AGENT_FEEDBACK_HISTORY_CAP,
  coerceAgentAction,
  isDestructiveAction,
  pushFeedback,
  serializeFeedbackForPrompt,
  summarizeAction,
  type AgentAction,
  type AgentFeedbackEvent,
} from "../shared/agent-actions";

/**
 * 把 parseOrbReply 吐出的 `{ type, payload }` 餵給 coerceAgentAction，
 * 取得型別安全的 AgentAction 陣列。前端就是吃這個給 bus dispatch。
 */
function pipeToTypedActions(
  rawReply: string,
  opts?: { alwaysConfirm?: boolean }
) {
  const parsed = parseOrbReply(rawReply, opts);
  const typed: AgentAction[] = [];
  for (const a of parsed.actions) {
    const ca = coerceAgentAction(a);
    if (ca) typed.push(ca);
  }
  return { parsed, typed };
}

describe("orb agent pipeline — parse → coerce → gate → feedback", () => {
  it("LLM 原始字串 → 型別安全的 AgentAction 陣列（順序與數量一致）", () => {
    const raw =
      "我幫你準備好了。" +
      " [ACTION:setTab:t2i]" +
      " [ACTION:setModel:seedreamV4]" +
      " [ACTION:fillPrompt:一隻在竹林裡的貓]";
    const { parsed, typed } = pipeToTypedActions(raw);

    expect(parsed.actions.length).toBe(3);
    expect(typed.length).toBe(3);
    expect(typed[0]).toEqual({ type: "setTab", tabId: "t2i" });
    expect(typed[1]).toEqual({ type: "setModel", modelId: "seedreamV4" });
    expect(typed[2]).toMatchObject({
      type: "fillPrompt",
      text: "一隻在竹林裡的貓",
    });
  });

  it("破壞性動作（submit）自動觸發 confirm gate 且摘要為繁中", () => {
    const raw = "幫你生成了喔～ [ACTION:submit:]";
    const { parsed, typed } = pipeToTypedActions(raw);

    expect(parsed.askBeforeAct).toBe(true);
    expect(typed).toHaveLength(1);
    expect(typed[0].type).toBe("submit");
    expect(isDestructiveAction(typed[0])).toBe(true);

    const summary = summarizeAction(typed[0]);
    expect(summary).toContain("送出");
  });

  it("LLM 顯式 [CONFIRM:false] 會覆寫掉 submit 的自動 confirm", () => {
    const raw = "[ACTION:submit:] [CONFIRM:false]";
    const { parsed, typed } = pipeToTypedActions(raw);

    expect(typed[0].type).toBe("submit");
    // parseOrbReply 的 explicit confirm=false 應該蓋過自動破壞性偵測
    expect(parsed.askBeforeAct).toBe(false);
    // 但底層 isDestructiveAction 仍該回 true —— 這是給前端額外兜底用的
    expect(isDestructiveAction(typed[0])).toBe(true);
  });

  it("alwaysConfirm=true 下，連 setTab 這種非破壞性動作都要確認", () => {
    const raw = "[ACTION:setTab:t2i]";
    const { parsed, typed } = pipeToTypedActions(raw, { alwaysConfirm: true });

    expect(typed[0].type).toBe("setTab");
    expect(isDestructiveAction(typed[0])).toBe(false);
    expect(parsed.askBeforeAct).toBe(true);
  });

  it("intent 會被抽出、reply 不含任何 marker", () => {
    const raw =
      "我先幫你切模型喔 [ACTION:setModel:seedreamV4]" +
      " [INTENT:換成支援中文的 SeeDream]" +
      " [CONFIRM:false]" +
      " [SUGGEST:好啊|換別的]";
    const { parsed, typed } = pipeToTypedActions(raw);

    expect(parsed.intent).toBe("換成支援中文的 SeeDream");
    expect(parsed.reply).not.toMatch(/\[/);
    expect(parsed.suggestions).toEqual(["好啊", "換別的"]);
    expect(typed[0]).toEqual({ type: "setModel", modelId: "seedreamV4" });
  });

  it("未在白名單的 ACTION 在 parse 階段就被丟掉，coerce 收到空陣列", () => {
    const raw = "[ACTION:deleteAccount:now] [ACTION:shutdown:] 呼～";
    const { parsed, typed } = pipeToTypedActions(raw);

    expect(parsed.actions).toEqual([]);
    expect(typed).toEqual([]);
    // reply 也該乾淨
    expect(parsed.reply).not.toContain("[ACTION");
  });

  it("legacy marker（preset / generate / focus）會被轉成新命名的 AgentAction", () => {
    const raw =
      "[ACTION:preset:creative:standard]" +
      " [ACTION:generate:]" +
      " [ACTION:focus:promptInput]";
    const { parsed, typed } = pipeToTypedActions(raw);

    expect(parsed.actions.map(a => a.type)).toEqual([
      "preset",
      "generate",
      "focus",
    ]);
    // coerceAgentAction 把這些都轉成正式形狀
    expect(typed[0]).toEqual({
      type: "applyPreset",
      presetId: "creative:standard",
    });
    expect(typed[1]).toMatchObject({ type: "submit" });
    expect(typed[2]).toMatchObject({
      type: "focusElement",
      elementId: "promptInput",
    });
  });

  it("使用者接受後 pushFeedback 寫入回饋，serializeFeedbackForPrompt 可讀", () => {
    const raw = "[ACTION:setModel:nanoBananaPro]";
    const { typed } = pipeToTypedActions(raw);

    const now = 1_700_000_000_000;
    let feedback: AgentFeedbackEvent[] = [];
    feedback = pushFeedback(feedback, {
      at: now,
      status: "accepted",
      actionType: typed[0].type,
      pageId: "image-studio",
    });
    feedback = pushFeedback(feedback, {
      at: now + 5_000,
      status: "completed",
      actionType: typed[0].type,
      pageId: "image-studio",
    });

    expect(feedback).toHaveLength(2);
    const prompt = serializeFeedbackForPrompt(feedback, now + 10_000);
    expect(prompt).toContain("setModel");
    expect(prompt).toContain("accepted");
    expect(prompt).toContain("completed");
  });

  it("使用者取消破壞性動作時，feedback.status=cancelled 正確記錄", () => {
    const raw = "[ACTION:submit:]";
    const { parsed, typed } = pipeToTypedActions(raw);

    expect(parsed.askBeforeAct).toBe(true);

    const feedback = pushFeedback([], {
      at: Date.now(),
      status: "cancelled",
      actionType: typed[0].type,
      note: "先不要啦",
    });
    expect(feedback[0].status).toBe("cancelled");
    expect(feedback[0].note).toBe("先不要啦");

    const promptLine = serializeFeedbackForPrompt(feedback);
    expect(promptLine).toContain("submit");
    expect(promptLine).toContain("cancelled");
    expect(promptLine).toContain("先不要啦");
  });

  it("feedback 歷史超過 cap 時最舊的會被丟掉（防止汙染 LLM prompt）", () => {
    let list: AgentFeedbackEvent[] = [];
    for (let i = 0; i < AGENT_FEEDBACK_HISTORY_CAP + 3; i++) {
      list = pushFeedback(list, {
        at: 1_000 + i,
        status: "accepted",
        actionType: "setTab",
        note: `n${i}`,
      });
    }
    expect(list).toHaveLength(AGENT_FEEDBACK_HISTORY_CAP);
    // 最舊的三筆（n0 / n1 / n2）應已被擠掉
    expect(list[0].note).toBe("n3");
    expect(list.at(-1)?.note).toBe(`n${AGENT_FEEDBACK_HISTORY_CAP + 2}`);
  });

  it("典型快樂路徑：navigate + setTab + setModel + fillPrompt + CONFIRM:true", () => {
    const raw = [
      "好，我這樣幫你：",
      "[ACTION:navigate:/image-studio]",
      "[ACTION:setTab:t2i]",
      "[ACTION:setModel:seedreamV4]",
      "[ACTION:fillPrompt:一位穿旗袍的女孩站在竹林中]",
      "[INTENT:去圖片創作室用 SeeDream 生這張畫]",
      "[CONFIRM:true]",
      "[SUGGEST:好啊|先不要|換別的模型]",
    ].join(" ");

    const { parsed, typed } = pipeToTypedActions(raw);

    // 1) 全部 4 個 action 都被保留（順序也對）
    expect(typed.map(a => a.type)).toEqual([
      "navigate",
      "setTab",
      "setModel",
      "fillPrompt",
    ]);

    // 2) intent / suggestions / confirm 都正確解出
    expect(parsed.intent).toBe("去圖片創作室用 SeeDream 生這張畫");
    expect(parsed.suggestions).toEqual(["好啊", "先不要", "換別的模型"]);
    expect(parsed.askBeforeAct).toBe(true);

    // 3) 每個動作都能被 summarizeAction 講出一句繁中（非空）
    for (const a of typed) {
      const s = summarizeAction(a);
      expect(typeof s).toBe("string");
      expect(s.length).toBeGreaterThan(0);
    }

    // 4) 使用者按確認 → feedback 可以正確推進
    const now = Date.now();
    let feedback: AgentFeedbackEvent[] = [];
    for (const a of typed) {
      feedback = pushFeedback(feedback, {
        at: now,
        status: "accepted",
        actionType: a.type,
        pageId: "image-studio",
      });
    }
    expect(feedback).toHaveLength(4);
    expect(feedback.map(f => f.actionType)).toEqual([
      "navigate",
      "setTab",
      "setModel",
      "fillPrompt",
    ]);
  });
});
