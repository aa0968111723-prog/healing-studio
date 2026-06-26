/**
 * videoIdorConvergence.test.ts — AIDV-244 收斂驗證
 *
 * 驗收條件：
 *   1. SSE /api/generation-events/:jobId 已有 ownership 守門（AIDV-236）
 *   2. videoStudio.checkVideoStatus 有 IDOR 防護（AIDV-243 / AIDV-244 核心修復）
 *   3. videoStudio.jobStatus 有 IDOR 防護
 *   4. db.getBackgroundJobByRequestId 已匯出（任意狀態 requestId 反查）
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const SERVER_SRC = resolve(__dirname, "..");

function readFile(relPath: string): string {
  return readFileSync(resolve(SERVER_SRC, relPath), "utf8");
}

// ── 1. SSE 擁有權守門審查（AIDV-236）──────────────────────────────────────────
describe("SSE IDOR 防護審查 (AIDV-236 / AIDV-244)", () => {
  const sseSrc = readFile("sseRoute.ts");

  it("sseRoute.ts 啟動串流前驗證登入（未登入 → 401）", () => {
    expect(sseSrc).toContain("401");
    expect(sseSrc).toContain("Unauthorized");
  });

  it("sseRoute.ts 有 ownership lockdown guard（job.userId !== user.id）", () => {
    expect(sseSrc).toContain("job.userId !== user.id");
    expect(sseSrc).toContain("403");
  });

  it("sseRoute.ts lockdown 預設開啟（SSE_OWNERSHIP_LOCKDOWN 非 true 以外值才關）", () => {
    expect(sseSrc).toContain("isOwnershipLockdownEnabled");
    // 預設 ON — 只有 false/0/off/no 才關
    expect(sseSrc).toContain('"false"');
    expect(sseSrc).toContain('"0"');
  });

  it("sseRoute.ts 有 parseId 驗證防止非正整數 jobId 進入 DB", () => {
    expect(sseSrc).toContain("parseId");
    expect(sseSrc).toContain("MAX_SIGNED_INT");
  });

  it("model-training-events 也有 ownership 守門", () => {
    expect(sseSrc).toContain("model-training-events");
    // 同一路由模式：userId 比對
    const modelOwnershipMatch = /model.*userId.*user\.id|user\.id.*model.*userId/s.test(sseSrc);
    expect(modelOwnershipMatch).toBe(true);
  });
});

// ── 2. videoStudio checkVideoStatus IDOR 防護（AIDV-244 核心修復）────────────
describe("checkVideoStatus IDOR 防護 (AIDV-244)", () => {
  const videoStudioSrc = readFile("routers/videoStudio.ts");

  it("checkVideoStatus 呼叫 getBackgroundJobByRequestId 做 ownership 查驗", () => {
    expect(videoStudioSrc).toContain("getBackgroundJobByRequestId");
  });

  it("checkVideoStatus 在 job 存在且 userId 不符時拋 FORBIDDEN", () => {
    // 確認有 FORBIDDEN throw 且條件含 userId 比對
    expect(videoStudioSrc).toContain('"FORBIDDEN"');
    expect(videoStudioSrc).toContain("existingJob.userId !== ctx.user.id");
  });

  it("checkVideoStatus FORBIDDEN 在 doPostGenComplete 呼叫之前（防止資產歸錯帳戶）", () => {
    // 找 guard 訊息的位置（第 2 次出現，第 1 次在 jobStatus）
    const guard1 = videoStudioSrc.indexOf("無此任務存取權限");
    const guard2 = videoStudioSrc.indexOf("無此任務存取權限", guard1 + 1);
    // 找 void doPostGenComplete( 的呼叫位置（非 import）
    const postGenCallIdx = videoStudioSrc.indexOf("void doPostGenComplete(");
    // checkVideoStatus 的 FORBIDDEN guard（第 2 次）必須在 doPostGenComplete 呼叫之前
    expect(guard2).toBeGreaterThan(-1);
    expect(postGenCallIdx).toBeGreaterThan(-1);
    expect(guard2).toBeLessThan(postGenCallIdx);
  });
});

// ── 3. videoStudio jobStatus IDOR 防護 ────────────────────────────────────────
describe("jobStatus IDOR 防護 (AIDV-244)", () => {
  const videoStudioSrc = readFile("routers/videoStudio.ts");

  it("jobStatus 也有 getBackgroundJobByRequestId + FORBIDDEN guard", () => {
    // jobStatus 的實作在 checkVideoStatus 之前（兩者相近），確認兩個 guard 都在
    const allForbiddenMatches = [...videoStudioSrc.matchAll(/無此任務存取權限/g)];
    expect(allForbiddenMatches.length).toBeGreaterThanOrEqual(2);
  });
});

// ── 4. db.getBackgroundJobByRequestId 存在並匯出 ─────────────────────────────
describe("getBackgroundJobByRequestId DB helper (AIDV-244)", () => {
  it("db.ts 匯出 getBackgroundJobByRequestId（任意狀態反查）", async () => {
    const dbModule = await import("../db");
    expect(typeof dbModule.getBackgroundJobByRequestId).toBe("function");
  });

  it("db.ts getBackgroundJobByRequestId 使用 JSON_EXTRACT 查詢 resultJson.requestId", () => {
    const dbSrc = readFile("db.ts");
    expect(dbSrc).toContain("getBackgroundJobByRequestId");
    expect(dbSrc).toContain("JSON_EXTRACT");
    expect(dbSrc).toContain("resultJson");
  });
});

// ── 5. videoProject router 不存在（AIDV-243 已確認無此 router 故無 IDOR 面）──
describe("videoProject router 不存在（AIDV-243 範圍確認）", () => {
  it("routers/ 目錄沒有獨立 videoProject router 檔案", () => {
    const { readdirSync } = require("fs");
    const routerFiles = readdirSync(resolve(SERVER_SRC, "routers")) as string[];
    const hasVideoProject = routerFiles.some(
      (f: string) => f.toLowerCase().includes("videoproject")
    );
    expect(hasVideoProject).toBe(false);
  });

  it("worldStoryboard router 有 ownership 守門（world-based 資源同等效果）", () => {
    const storyboardSrc = readFile("routers/worldStoryboard.ts");
    expect(storyboardSrc).toContain("w.userId !== ctxUserId");
    expect(storyboardSrc).toContain("NOT_FOUND");
  });
});
