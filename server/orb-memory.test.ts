/**
 * orb-memory.test.ts — Phase 3c 光球長期記憶的純邏輯測試
 *
 * Phase 3c 把使用者對光球建議的反應寫進 `orb_feedback_events` table，
 * 下一次 `ai.chat` 呼叫時 server 會把 DB 歷史跟前端送來的 session 歷史
 * 合併成一份清單給 system prompt。這條合併邏輯在
 * `shared/agent-actions.ts` 的 `mergeFeedbackHistories` 裡，以下測試
 * 負責把它的行為鎖住。
 *
 * DB 真正的寫入/讀出（appendOrbFeedback / getRecentOrbFeedback）因為
 * vitest 沒接 MySQL，這邊不直接測；但合併 + 序列化行為全在純函式裡，
 * 可以 100% 涵蓋。
 */

import { describe, expect, it } from "vitest";
import {
  mergeFeedbackHistories,
  serializeFeedbackForPrompt,
  type AgentFeedbackEvent,
} from "../shared/agent-actions";

const mk = (
  at: number,
  actionType: string,
  status: AgentFeedbackEvent["status"] = "accepted",
  note?: string
): AgentFeedbackEvent => ({ at, status, actionType, note });

describe("mergeFeedbackHistories", () => {
  it("空 session + 空 DB → 回空陣列", () => {
    expect(mergeFeedbackHistories(undefined, undefined)).toEqual([]);
    expect(mergeFeedbackHistories([], [])).toEqual([]);
  });

  it("只有 session 時原樣回傳（依時間新到舊排序）", () => {
    const s = [mk(100, "setTab"), mk(300, "setModel"), mk(200, "fillPrompt")];
    const r = mergeFeedbackHistories(s, undefined);
    expect(r.map(e => e.actionType)).toEqual([
      "setModel",
      "fillPrompt",
      "setTab",
    ]);
  });

  it("只有 DB 時原樣回傳（依時間新到舊）", () => {
    const d = [
      mk(1_000, "applyPreset"),
      mk(500, "setModel"),
      mk(2_000, "submit"),
    ];
    const r = mergeFeedbackHistories(undefined, d);
    expect(r[0].actionType).toBe("submit");
    expect(r.at(-1)?.actionType).toBe("setModel");
  });

  it("session 最新 + DB 較舊 → 按 at 重新排序混在一起", () => {
    const session = [mk(1_700_000_050_000, "setTab", "accepted")];
    const dbEvents = [
      mk(1_700_000_000_000, "setModel", "completed"),
      mk(1_700_000_030_000, "submit", "cancelled"),
    ];
    const r = mergeFeedbackHistories(session, dbEvents);
    expect(r.map(e => e.actionType)).toEqual(["setTab", "submit", "setModel"]);
  });

  it("同一筆事件（at + actionType + status 完全相同）只留一次", () => {
    // session 已經回報過 completed，之後 DB 讀回同一筆也來；不應重覆
    const same = mk(1_700_000_000_000, "fillPrompt", "completed");
    const r = mergeFeedbackHistories([same], [{ ...same }]);
    expect(r).toHaveLength(1);
  });

  it("status 不同時視為不同事件（accepted → completed 兩個 row 都保留）", () => {
    const r = mergeFeedbackHistories(
      [mk(1_700_000_000_000, "submit", "accepted")],
      [mk(1_700_000_000_000, "submit", "completed")]
    );
    expect(r).toHaveLength(2);
    expect(r.map(e => e.status)).toEqual(["accepted", "completed"]);
  });

  it("超過 cap 會丟掉最舊的", () => {
    const mkMany = (count: number) =>
      Array.from({ length: count }, (_, i) =>
        mk(i + 1, `t${i}`, "accepted")
      );
    const r = mergeFeedbackHistories(mkMany(8), mkMany(8).map(e => ({
      ...e,
      at: e.at + 100, // 確保跟 session 不重覆
      actionType: `db-${e.actionType}`,
    })), 5);
    expect(r).toHaveLength(5);
    // 最舊（t0 / t1 / ...）應該被擠掉，剩下的 at 全部 >= 11
    expect(r.every(e => e.at >= 11)).toBe(true);
  });

  it("cap = 0 保守處理：不拋錯，直接回空", () => {
    expect(
      mergeFeedbackHistories([mk(1, "setTab")], [mk(2, "setModel")], 0)
    ).toEqual([]);
  });

  it("默認 cap=12，session 8 + DB 10 = 18 → 保留最新 12 筆", () => {
    const s = Array.from({ length: 8 }, (_, i) => mk(100 + i, `s${i}`));
    const d = Array.from({ length: 10 }, (_, i) => mk(200 + i, `d${i}`));
    const r = mergeFeedbackHistories(s, d);
    expect(r).toHaveLength(12);
    // DB 較新（200+）全部進榜；session 只留最新 2 筆（at=107, 106）
    expect(r[0].at).toBeGreaterThanOrEqual(200);
  });

  it("serializeFeedbackForPrompt 能消化合併結果（跨 session 連貫性）", () => {
    const now = 1_700_000_100_000;
    const merged = mergeFeedbackHistories(
      [mk(now - 30_000, "fillPrompt", "accepted", "好喔")],
      [
        mk(now - 600_000, "submit", "cancelled", "先不要"),
        mk(now - 300_000, "setModel", "completed"),
      ]
    );
    const prompt = serializeFeedbackForPrompt(merged, now);
    expect(prompt).toContain("fillPrompt");
    expect(prompt).toContain("submit");
    expect(prompt).toContain("setModel");
    expect(prompt).toContain("好喔");
    expect(prompt).toContain("先不要");
  });
});
