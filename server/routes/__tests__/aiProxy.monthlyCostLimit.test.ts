/**
 * aiProxy.monthlyCostLimit.test.ts — AIDV-286（G-2 成本與額度政策）
 *
 * rate_limit_rules.monthlyCostLimitUsd 欄位早於本卡就存在於 schema，但
 * checkRateLimit() 從未查詢過它——設定了也不會真的擋人，等同死欄位。
 * 本測試守住「per_user 規則的月度成本上限查詢確實存在且會擋門」這條不變式，
 * 比照 orbCostGuards.test.ts 對「DB 重依賴、純 unit 環境跑不起來」程式碼採用
 * 的 source-text 掃描慣例（真實行為已用本機 MySQL 實跑驗證，見 PR 描述）。
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../..");
const proxySrc = readFileSync(
  path.join(repoRoot, "server/routes/aiProxy.ts"),
  "utf8"
);

describe("AIDV-286: checkRateLimit 月度成本上限（monthlyCostLimitUsd）", () => {
  it("checkRateLimit 已 export（供測試與其他模組引用）", () => {
    expect(proxySrc).toMatch(/export\s+async\s+function\s+checkRateLimit/);
  });

  it("per_user 分支查詢 rule.monthlyCostLimitUsd", () => {
    const perUserStart = proxySrc.indexOf('ruleType === "per_user"');
    const globalStart = proxySrc.indexOf('ruleType === "global"');
    expect(perUserStart).toBeGreaterThan(-1);
    expect(globalStart).toBeGreaterThan(perUserStart);
    const perUserBlock = proxySrc.slice(perUserStart, globalStart);
    expect(perUserBlock).toMatch(/rule\.monthlyCostLimitUsd/);
  });

  it("月度查詢窗口用當月 1 號（monthStart），不是 today", () => {
    expect(proxySrc).toMatch(
      /monthStart\s*=\s*new Date\(today\.getFullYear\(\), today\.getMonth\(\), 1\)/
    );
    // monthlyCostLimitUsd 區塊必須用 monthStart 當下界，不能誤用 today（否則會退化成
    // 跟 dailyCostLimitUsd 同一個窗口，當月上限形同虛設）。
    const block = proxySrc.match(
      /if \(rule\.monthlyCostLimitUsd\) \{[\s\S]*?\n {8}\}/
    );
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(/gte\(aiUsageEvents\.createdAt, monthStart\)/);
  });

  it("超過月度上限回傳 allowed:false 且訊息含 Monthly cost limit exceeded", () => {
    const block = proxySrc.match(
      /if \(rule\.monthlyCostLimitUsd\) \{[\s\S]*?\n {8}\}/
    );
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(/allowed:\s*false/);
    expect(block![0]).toMatch(/Monthly cost limit exceeded/);
  });
});
