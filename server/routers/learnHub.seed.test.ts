import { describe, it, expect } from "vitest";
import { SEED_DOCS, SEED_VIDEOS, SEED_QUIZZES } from "./learnHub.seed";

// AIDV-71：learnHub.ts 抽出 SEED 資料＋型別至 learnHub.seed.ts。
// 此測試鎖定抽出後三組種子陣列的筆數與既有 main 版完全一致（純機械搬移、零資料變更）。
describe("learnHub.seed 種子資料筆數（byte-identical 抽出）", () => {
  it("SEED_DOCS 維持 74 筆且 id 唯一", () => {
    expect(SEED_DOCS).toHaveLength(74);
    expect(new Set(SEED_DOCS.map(d => d.id)).size).toBe(74);
  });

  it("SEED_VIDEOS 維持 6 筆且 id 唯一", () => {
    expect(SEED_VIDEOS).toHaveLength(6);
    expect(new Set(SEED_VIDEOS.map(v => v.id)).size).toBe(6);
  });

  it("SEED_QUIZZES 維持 22 筆且 id 唯一", () => {
    expect(SEED_QUIZZES).toHaveLength(22);
    expect(new Set(SEED_QUIZZES.map(q => q.id)).size).toBe(22);
  });
});
