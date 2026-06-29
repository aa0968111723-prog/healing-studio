/**
 * AIDV-196: orbClarificationEngine.getStats 真實聚合測試
 *
 * 背景：getStats 原為恆回零的樁，但 orbClarificationHistory / orbUserAnswerPatterns
 * 已由 identifyIntent/generateClarification/recordAnswer 實際寫入，導致光球回報的
 * 「已澄清次數／作答率／學習進度」造假。本測試鎖定純聚合 computeClarificationStats，
 * 以及無 DB 時 getStats 的優雅回退。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// 隔離 DB：避免 import 連到真實連線；個別測試以 mockReturnValue 控制。
const mockGetDb = vi.fn();
vi.mock("./db", () => ({
  getDb: (...args: unknown[]) => mockGetDb(...args),
}));

import {
  computeClarificationStats,
  orbClarificationEngine,
  type QuestionType,
} from "./services/orbClarificationEngine";

type Clarif = {
  questionType: QuestionType;
  userAnswer: string | null;
  createdAt: Date;
  answeredAt: Date | null;
};

const at = (iso: string) => new Date(iso);

describe("computeClarificationStats（純聚合）", () => {
  it("空輸入 → 全零、六種題型皆 0", () => {
    const s = computeClarificationStats([], []);
    expect(s.totalClarifications).toBe(0);
    expect(s.answerRate).toBe(0);
    expect(s.avgResponseTime).toBe(0);
    expect(s.learningProgress).toBe(0);
    expect(s.byQuestionType).toEqual({
      choice: 0,
      confirm: 0,
      parameter: 0,
      constraint: 0,
      preference: 0,
      context: 0,
    });
  });

  it("總數與題型分布正確計數", () => {
    const rows: Clarif[] = [
      { questionType: "choice", userAnswer: null, createdAt: at("2026-06-29T00:00:00Z"), answeredAt: null },
      { questionType: "choice", userAnswer: null, createdAt: at("2026-06-29T00:00:00Z"), answeredAt: null },
      { questionType: "confirm", userAnswer: null, createdAt: at("2026-06-29T00:00:00Z"), answeredAt: null },
      { questionType: "context", userAnswer: null, createdAt: at("2026-06-29T00:00:00Z"), answeredAt: null },
    ];
    const s = computeClarificationStats(rows, []);
    expect(s.totalClarifications).toBe(4);
    expect(s.byQuestionType.choice).toBe(2);
    expect(s.byQuestionType.confirm).toBe(1);
    expect(s.byQuestionType.context).toBe(1);
    expect(s.byQuestionType.parameter).toBe(0);
  });

  it("answerRate = 已作答 / 總數（兩位小數）", () => {
    const rows: Clarif[] = [
      { questionType: "choice", userAnswer: "a", createdAt: at("2026-06-29T00:00:00Z"), answeredAt: at("2026-06-29T00:00:10Z") },
      { questionType: "choice", userAnswer: null, createdAt: at("2026-06-29T00:00:00Z"), answeredAt: null },
      { questionType: "choice", userAnswer: "c", createdAt: at("2026-06-29T00:00:00Z"), answeredAt: at("2026-06-29T00:00:20Z") },
    ];
    const s = computeClarificationStats(rows, []);
    expect(s.answerRate).toBe(0.67); // 2/3 → 0.67
  });

  it("空字串 userAnswer 視為未作答", () => {
    const rows: Clarif[] = [
      { questionType: "choice", userAnswer: "", createdAt: at("2026-06-29T00:00:00Z"), answeredAt: at("2026-06-29T00:00:10Z") },
      { questionType: "choice", userAnswer: "x", createdAt: at("2026-06-29T00:00:00Z"), answeredAt: at("2026-06-29T00:00:10Z") },
    ];
    const s = computeClarificationStats(rows, []);
    expect(s.answerRate).toBe(0.5);
  });

  it("avgResponseTime = 已作答平均秒數，未作答／負時差排除", () => {
    const rows: Clarif[] = [
      // 10 秒
      { questionType: "choice", userAnswer: "a", createdAt: at("2026-06-29T00:00:00Z"), answeredAt: at("2026-06-29T00:00:10Z") },
      // 30 秒
      { questionType: "choice", userAnswer: "b", createdAt: at("2026-06-29T00:00:00Z"), answeredAt: at("2026-06-29T00:00:30Z") },
      // 未作答 → 排除
      { questionType: "choice", userAnswer: null, createdAt: at("2026-06-29T00:00:00Z"), answeredAt: null },
      // 負時差（時鐘倒退）→ 排除
      { questionType: "choice", userAnswer: "c", createdAt: at("2026-06-29T00:00:30Z"), answeredAt: at("2026-06-29T00:00:10Z") },
    ];
    const s = computeClarificationStats(rows, []);
    expect(s.avgResponseTime).toBe(20); // (10+30)/2
  });

  it("learningProgress = 回答模式平均信心度 ×100（四捨五入、夾在 0–100）", () => {
    const s = computeClarificationStats(
      [],
      [
        { confidenceScore: 0.8, sampleCount: 8 },
        { confidenceScore: 0.6, sampleCount: 6 },
      ],
    );
    expect(s.learningProgress).toBe(70); // (0.8+0.6)/2 = 0.7 → 70
  });

  it("無模式 → learningProgress = 0；信心度上限夾 100", () => {
    expect(computeClarificationStats([], []).learningProgress).toBe(0);
    expect(
      computeClarificationStats([], [{ confidenceScore: 1.5, sampleCount: 99 }]).learningProgress,
    ).toBe(100);
  });
});

describe("orbClarificationEngine.getStats（無 DB 優雅回退）", () => {
  beforeEach(() => mockGetDb.mockReset());

  it("getDb() 回 null 時回零統計、不 throw", async () => {
    mockGetDb.mockResolvedValue(null);
    const s = await orbClarificationEngine.getStats(123);
    expect(s.totalClarifications).toBe(0);
    expect(s.learningProgress).toBe(0);
  });

  it("DB 查詢拋錯時回零統計、不 throw（光球統計工具不中斷）", async () => {
    mockGetDb.mockResolvedValue({
      select: () => {
        throw new Error("db boom");
      },
    });
    const s = await orbClarificationEngine.getStats(123);
    expect(s).toEqual(computeClarificationStats([], []));
  });
});
