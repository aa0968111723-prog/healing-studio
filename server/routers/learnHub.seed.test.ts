import { describe, it, expect } from "vitest";
import { SEED_DOCS, SEED_VIDEOS, SEED_QUIZZES } from "./learnHub.seed";

// AIDV-71：learnHub.ts 抽出 SEED 資料＋型別至 learnHub.seed.ts。
// 此測試鎖定三組種子陣列的筆數，防未察覺的增刪（AIDV-71 抽出時 74 筆；
// AIDV-966 修補輪註冊 6 份 scenario-* 人格教材 → 80 筆，讓 /learn?docId=scenario-*
// 經 learnHub.getById 可解析）。
describe("learnHub.seed 種子資料筆數", () => {
  it("SEED_DOCS 維持 80 筆且 id 唯一", () => {
    expect(SEED_DOCS).toHaveLength(80);
    expect(new Set(SEED_DOCS.map(d => d.id)).size).toBe(80);
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
