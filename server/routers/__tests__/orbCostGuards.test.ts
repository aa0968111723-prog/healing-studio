/**
 * orbCostGuards.test.ts
 *
 * 守住兩條「全站光球的成本 / DoS 防護」不變式:
 *
 * H2: ai.chat 呼叫 runOrbWebResearch 時必須帶 userId,否則 Perplexity /
 *     Brave 節流退化為全站 bucket,單一惡意帳號能把全站額度燒光。
 *
 * H3: orbSchedulerRouter.scheduleJob 必須有 per-user job 上限(否則一
 *     個帳號可建上千條 1 分鐘 cron 把 Node main thread 跑滿)。
 *
 * 用 source-text 掃描而非 integration test 是因為 ai.chat 與 scheduler
 * 都掛在大量 DB / LLM / auth 依賴上,純 unit 環境跑不起來。invariant
 * 守住「重構別意外刪掉防護」就足夠。
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../..");

describe("H2: runOrbWebResearch 必須帶 userId", () => {
  const routersSrc = readFileSync(
    path.join(repoRoot, "server/routers.ts"),
    "utf8"
  );

  it("ai.chat 處 runOrbWebResearch 呼叫帶 userId: ctx.user.id", () => {
    // 抓 runOrbWebResearch( ... ) 整個 call expression(可能跨多行),
    // 確認裡面有 userId: ctx.user.id。
    const match = routersSrc.match(
      /runOrbWebResearch\s*\([\s\S]*?\}\s*\)/
    );
    expect(match).not.toBeNull();
    expect(match![0]).toMatch(/userId\s*:\s*ctx\.user\.id/);
  });
});

describe("H3: orbSchedulerRouter 必須有 per-user job 上限", () => {
  const routerSrc = readFileSync(
    path.join(repoRoot, "server/routers/orbSchedulerRouter.ts"),
    "utf8"
  );

  it("宣告 MAX_JOBS_PER_USER 常數", () => {
    expect(routerSrc).toMatch(/const\s+MAX_JOBS_PER_USER\s*=\s*\d+/);
  });

  it("scheduleJob 內檢查 listScheduledJobs(ctx.user.id).length", () => {
    expect(routerSrc).toMatch(
      /listScheduledJobs\s*\(\s*ctx\.user\.id\s*\)/
    );
    expect(routerSrc).toMatch(/MAX_JOBS_PER_USER/);
  });

  it("超過上限拋 TRPCError 且 code 是 TOO_MANY_REQUESTS", () => {
    // 找 MAX_JOBS_PER_USER 附近 80 字內必須有 TOO_MANY_REQUESTS。
    const capIdx = routerSrc.indexOf("MAX_JOBS_PER_USER");
    expect(capIdx).toBeGreaterThan(-1);
    // 跳過第一處(常數宣告),取 scheduleJob 內第二處附近。
    const secondIdx = routerSrc.indexOf("MAX_JOBS_PER_USER", capIdx + 1);
    expect(secondIdx).toBeGreaterThan(-1);
    const window = routerSrc.slice(secondIdx, secondIdx + 400);
    expect(window).toMatch(/TOO_MANY_REQUESTS/);
  });

  it("上限只在「新增」時擋,既有 job 的 update 不受影響", () => {
    // 守住「existing 為 undefined 才做 cap 檢查」,否則 disable→enable
    // 或改 cron 都會被卡住,違反使用者預期。
    const capCheckBlock = routerSrc.match(
      /if\s*\(\s*!existing\s*\)[\s\S]{0,300}MAX_JOBS_PER_USER/
    );
    expect(capCheckBlock).not.toBeNull();
  });
});
