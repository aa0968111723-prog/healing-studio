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

const routersSrc = readFileSync(
  path.join(repoRoot, "server/routers/ai.ts"),
  "utf8"
);

describe("H2: runOrbWebResearch 必須帶 userId", () => {

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

describe("H4 (AIDV-215): ai.chat 必須有 per-user 20 RPM 限流", () => {
  const limiterSrc = readFileSync(
    path.join(repoRoot, "server/_core/rateLimiter.ts"),
    "utf8"
  );

  it("rateLimiter.ts 匯出 tryConsumeChatToken 函式", () => {
    expect(limiterSrc).toMatch(/export\s+function\s+tryConsumeChatToken/);
  });

  it("CHAT_RATE_LIMIT_MAX 設為 20 RPM", () => {
    expect(limiterSrc).toMatch(/CHAT_RATE_LIMIT_MAX\s*=\s*20/);
  });

  it("ai.chat handler 呼叫 tryConsumeChatToken(ctx.user.id)", () => {
    expect(routersSrc).toMatch(/tryConsumeChatToken\s*\(\s*ctx\.user\.id\s*\)/);
  });

  it("rate limit 超限拋 TRPCError code: TOO_MANY_REQUESTS", () => {
    // 找 tryConsumeChatToken 呼叫後 300 字內有 TOO_MANY_REQUESTS。
    const idx = routersSrc.indexOf("tryConsumeChatToken(ctx.user.id)");
    expect(idx).toBeGreaterThan(-1);
    const window = routersSrc.slice(idx, idx + 300);
    expect(window).toMatch(/TOO_MANY_REQUESTS/);
  });
});

describe("H1: orbCapabilitiesRouter 必須 protected", () => {
  const routerSrc = readFileSync(
    path.join(repoRoot, "server/routers/orbCapabilitiesRouter.ts"),
    "utf8"
  );

  // 用 import + procedure 宣告做精確比對,避免抓到註解裡解釋歷史脈絡
  // 提到的「publicProcedure」字串。
  it("不從 trpc core import publicProcedure", () => {
    expect(routerSrc).not.toMatch(
      /import\s*\{[^}]*\bpublicProcedure\b[^}]*\}\s*from\s*["']\.\.\/_core\/trpc["']/
    );
  });

  it("沒有任何 procedure 宣告掛在 publicProcedure 上", () => {
    expect(routerSrc).not.toMatch(/:\s*publicProcedure\b/);
  });

  it("list 與 suggestImageEditModels 都用 protectedProcedure", () => {
    expect(routerSrc).toMatch(/list\s*:\s*protectedProcedure/);
    expect(routerSrc).toMatch(/suggestImageEditModels\s*:\s*protectedProcedure/);
  });
});

describe("H7: orbScheduler.runScheduledOrbJob 必須有 per-job in-flight lock", () => {
  const schedulerSrc = readFileSync(
    path.join(repoRoot, "server/services/orbScheduler.ts"),
    "utf8"
  );

  it("有 in-flight lock Map(避免 cron 撞長任務 double-fire)", () => {
    expect(schedulerSrc).toMatch(/inFlightScheduledJobs\s*=\s*new\s+Map/);
  });

  it("runScheduledOrbJob 入口先呼叫 tryAcquireScheduledJobLock", () => {
    expect(schedulerSrc).toMatch(
      /export\s+async\s+function\s+runScheduledOrbJob[\s\S]{0,300}tryAcquireScheduledJobLock/
    );
  });

  it("有 finally 釋放鎖(避免 throw 後永久鎖死)", () => {
    expect(schedulerSrc).toMatch(
      /finally\s*\{\s*releaseScheduledJobLock/
    );
  });

  it("被跳過時 lastRunStatus = 'skipped:in_flight'", () => {
    expect(schedulerSrc).toMatch(/lastRunStatus\s*:\s*"skipped:in_flight"/);
  });
});

describe("AIDV-896: orbTask.retry 必須有 retry-chain 成本守衛", () => {
  const costGuardSrc = readFileSync(
    path.join(repoRoot, "server/services/orbCostGuard.ts"),
    "utf8"
  );

  it("orbCostGuard 匯出 checkRetryChainCost 函式", () => {
    expect(costGuardSrc).toMatch(/export\s+function\s+checkRetryChainCost/);
  });

  it("checkRetryChainCost 呼叫 detectRetryChains", () => {
    expect(costGuardSrc).toMatch(/detectRetryChains\s*\(/);
  });

  it("ai.ts orbTask.retry 有呼叫 checkRetryChainCost", () => {
    expect(routersSrc).toMatch(/checkRetryChainCost\s*\(/);
  });

  it("ENABLE_RETRY_CHAIN_COST_GUARD 旗標控制開關", () => {
    expect(routersSrc).toMatch(/ENABLE_RETRY_CHAIN_COST_GUARD/);
  });

  it("超限拋 TRPCError code: TOO_MANY_REQUESTS", () => {
    const idx = routersSrc.indexOf("checkRetryChainCost(");
    expect(idx).toBeGreaterThan(-1);
    const window = routersSrc.slice(idx, idx + 400);
    expect(window).toMatch(/TOO_MANY_REQUESTS/);
  });

  it("DB 不可用時 fail-open（不擋重試）", () => {
    const idx = routersSrc.indexOf("checkRetryChainCost(");
    expect(idx).toBeGreaterThan(-1);
    const window = routersSrc.slice(idx, idx + 600);
    expect(window).toMatch(/catch/);
    expect(window).toMatch(/TRPCError.*throw|throw.*TRPCError/);
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
