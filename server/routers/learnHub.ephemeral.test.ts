import { describe, it, expect } from "vitest";
import { learnHubRouter } from "./learnHub";

// AIDV-190：影片／測驗 CRUD 仍寫模組級記憶體陣列（無 DB 表），redeploy/重啟即丟失。
// DB 持久化落地前（待 Bruce 拍板表結構），videoList/quizList 以 `ephemeral: true`
// 讓 admin UI 誠實提示「重啟後遺失」。本測試鎖定該旗標存在，避免日後誤關提示。
// 對照組：doc 路徑（learnModules）已落 DB（AIDV-214），不在本旗標範圍。
function caller() {
  return learnHubRouter.createCaller({
    user: null,
    sessionId: null,
    isOrbTrace: false,
  } as any);
}

describe("AIDV-190 learnHub 未持久化提示旗標", () => {
  it("videoList 回傳 ephemeral=true（影片尚未寫 DB）", async () => {
    const result = await caller().videoList({ limit: 1 });
    expect(result.ephemeral).toBe(true);
    expect(Array.isArray(result.items)).toBe(true);
    expect(typeof result.total).toBe("number");
  });

  it("quizList 回傳 ephemeral=true（測驗尚未寫 DB）", async () => {
    const result = await caller().quizList({ limit: 1 });
    expect(result.ephemeral).toBe(true);
    expect(Array.isArray(result.items)).toBe(true);
    expect(typeof result.total).toBe("number");
  });
});
