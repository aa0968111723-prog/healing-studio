/**
 * orbAttributionGuards.test.ts
 *
 * 守住兩條使用者可見的「資料 / 數字誠實度」不變式:
 *
 * M8: orbConversations.list 必須在 SQL where 過濾 archivedAt(用 isNull),
 *     不能 LIMIT 後 JS filter。否則使用者有 30+ 條已封存對話時 LIMIT 取
 *     的全是 archived 列,過濾完變空陣列,UI 像「所有對話被刪了」。
 *
 * H4: falDispatcher 成功扣點時必須呼叫 recordSpecialistInteraction 把
 *     spirit + pointsDeducted 寫進 specialized_agent_interactions,財財
 *     才能回答「圖圖花了多少點」這類 attribution 問句。否則永遠 0。
 *
 * 都用 source-text 掃描而非 integration test,因為兩條路徑都依賴 DB +
 * fal SDK + LLM,純 unit 環境跑不起來。
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../..");

describe("M8: orbConversations.list 必須 SQL 過濾 archivedAt", () => {
  const routerSrc = readFileSync(
    path.join(repoRoot, "server/routers/orbConversationsRouter.ts"),
    "utf8"
  );

  it("import 了 isNull(drizzle SQL operator)", () => {
    expect(routerSrc).toMatch(
      /import\s*\{[^}]*\bisNull\b[^}]*\}\s*from\s*["']drizzle-orm["']/
    );
  });

  it("list 內用 isNull(orbConversations.archivedAt) 做 where", () => {
    expect(routerSrc).toMatch(
      /isNull\s*\(\s*orbConversations\.archivedAt\s*\)/
    );
  });

  it("不再用 rows.filter(r => !r.archivedAt) 這種 LIMIT 後 JS 過濾", () => {
    // 抓任意 .filter(_ => !_.archivedAt) 形式都擋掉。
    expect(routerSrc).not.toMatch(
      /\.filter\s*\(\s*\w+\s*=>\s*!\s*\w+\.archivedAt\s*\)/
    );
  });
});

describe("H4: falDispatcher 必須把成本歸給對應精靈", () => {
  const dispatcherSrc = readFileSync(
    path.join(repoRoot, "server/services/falDispatcher.ts"),
    "utf8"
  );

  it("import 了 recordSpecialistInteraction", () => {
    expect(dispatcherSrc).toMatch(
      /import\s*\{[^}]*\brecordSpecialistInteraction\b[^}]*\}/
    );
  });

  it("成功扣點後呼叫 recordSpecialistInteraction(主流程)", () => {
    // 抓 deductCredits 區塊附近 600 字內必須有 recordSpecialistInteraction。
    // 主流程的扣點點位旁邊。
    const deductIdx = dispatcherSrc.indexOf("await deductCredits(input.userId, actualCost)");
    expect(deductIdx).toBeGreaterThan(-1);
    const window = dispatcherSrc.slice(deductIdx, deductIdx + 800);
    expect(window).toMatch(/recordSpecialistInteraction/);
  });

  it("降級成功扣點後也呼叫 recordSpecialistInteraction(fallback 路徑)", () => {
    const retryDeductIdx = dispatcherSrc.indexOf(
      "await deductCredits(input.userId, retryActualCost)"
    );
    expect(retryDeductIdx).toBeGreaterThan(-1);
    const window = dispatcherSrc.slice(retryDeductIdx, retryDeductIdx + 800);
    expect(window).toMatch(/recordSpecialistInteraction/);
  });

  it("trackFalLangSmith 5 個呼叫點都傳 spirit", () => {
    // 抓所有 trackFalLangSmith({ ... }) call expression(可能跨多行)
    const calls = dispatcherSrc.match(
      /trackFalLangSmith\s*\(\s*\{[\s\S]*?\}\s*\)/g
    );
    expect(calls).not.toBeNull();
    // 應該有 5 處(line 348 / 460 / 513 / 580 / 625 附近)
    expect(calls!.length).toBeGreaterThanOrEqual(5);
    for (const call of calls!) {
      expect(call).toMatch(/spirit/);
    }
  });

  it("contextData 帶 pointsDeducted(財財需要的核心數字)", () => {
    // 兩個 recordSpecialistInteraction 呼叫都必須在 contextData 帶
    // pointsDeducted,否則「花了多少」永遠 0。
    const calls = dispatcherSrc.match(
      /recordSpecialistInteraction\s*\(\s*\{[\s\S]*?\}\s*\)/g
    );
    expect(calls).not.toBeNull();
    for (const call of calls!) {
      expect(call).toMatch(/pointsDeducted\s*:/);
      expect(call).toMatch(/agentId\s*:\s*spirit/);
    }
  });
});
