/**
 * Site Code Scanner — Vitest tests
 * ────────────────────────────────────────────────────────────────────────────
 * 對 server/services/siteCodeScanner.ts 的純啟發式邏輯做 hermetic 測試：
 *   - 規則命中（eval、dangerouslySetInnerHTML、TODO、console.log…）
 *   - dedupKey 穩定（同檔同行同規則 → 同 key）
 *   - rankFindings 依嚴重度排序
 *   - 排除規則（.test.ts / node_modules / pathExcludes）
 *
 * 測試使用 os.tmpdir() 建立臨時專案結構，避免動到真實 repo。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import {
  scanSiteCode,
  rankFindings,
  findingToMarkdown,
  getRuleIds,
  type CodeFinding,
} from "./services/siteCodeScanner";

let tmpRoot = "";

async function writeFile(rel: string, content: string): Promise<void> {
  const full = path.join(tmpRoot, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf8");
}

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "scan-test-"));

  await writeFile(
    "server/foo.ts",
    [
      'console.log("hello world")',
      "// TODO: refactor this",
      "function run(input: string) {",
      "  return eval(input);",
      "}",
      'const sql = "SELECT * FROM users";',
      "",
    ].join("\n")
  );

  await writeFile(
    "client/src/UnsafeComponent.tsx",
    [
      "export function Unsafe({ html }: { html: string }) {",
      '  return <div dangerouslySetInnerHTML={{ __html: html }} />;',
      "}",
      "",
    ].join("\n")
  );

  await writeFile(
    "server/secret.ts",
    [
      'const KEY = "sk-proj-abc1234567890abcdef1234567890";',
      "export default KEY;",
      "",
    ].join("\n")
  );

  // Test files should be excluded
  await writeFile(
    "server/__tests__/excluded.test.ts",
    [
      'console.log("should-not-appear");',
      "",
    ].join("\n")
  );
});

afterAll(async () => {
  if (tmpRoot) {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

describe("scanSiteCode", () => {
  it("detects eval, console.log, TODO, dangerouslySetInnerHTML, and hardcoded keys", async () => {
    const result = await scanSiteCode({
      rootDir: tmpRoot,
      includeDirs: ["server", "client/src"],
    });

    expect(result.filesScanned).toBeGreaterThan(0);
    const ruleIds = new Set(result.findings.map(f => f.rule));

    // Must include these rules
    expect(ruleIds.has("eval-usage")).toBe(true);
    expect(ruleIds.has("todo-comment")).toBe(true);
    expect(ruleIds.has("console-log-prod")).toBe(true);
    expect(ruleIds.has("dangerous-html")).toBe(true);
    expect(ruleIds.has("hardcoded-openai-key")).toBe(true);
  });

  it("skips test files", async () => {
    const result = await scanSiteCode({
      rootDir: tmpRoot,
      includeDirs: ["server"],
    });
    const consoleHits = result.findings.filter(
      f => f.rule === "console-log-prod"
    );
    // Only foo.ts should hit, not excluded.test.ts
    expect(consoleHits.length).toBeGreaterThanOrEqual(1);
    expect(
      consoleHits.every(f => !f.filePath.includes("excluded.test.ts"))
    ).toBe(true);
  });

  it("produces deterministic dedupKeys (file + rule + line)", async () => {
    const a = await scanSiteCode({
      rootDir: tmpRoot,
      includeDirs: ["server"],
    });
    const b = await scanSiteCode({
      rootDir: tmpRoot,
      includeDirs: ["server"],
    });
    const aKeys = a.findings.map(f => f.dedupKey).sort();
    const bKeys = b.findings.map(f => f.dedupKey).sort();
    expect(aKeys).toEqual(bKeys);
  });

  it("returns severity & category counts", async () => {
    const result = await scanSiteCode({
      rootDir: tmpRoot,
      includeDirs: ["server", "client/src"],
    });
    const totalSeverity = Object.values(result.severityCounts).reduce(
      (s, n) => s + n,
      0
    );
    expect(totalSeverity).toBe(result.findings.length);
    const totalCategory = Object.values(result.categoryCounts).reduce(
      (s, n) => s + n,
      0
    );
    expect(totalCategory).toBe(result.findings.length);
    expect(result.severityCounts.critical).toBeGreaterThanOrEqual(1); // hardcoded-openai-key
    expect(result.severityCounts.high).toBeGreaterThanOrEqual(2); // eval-usage + dangerous-html
  });
});

describe("rankFindings", () => {
  it("sorts critical > high > medium > low > info", () => {
    const findings: CodeFinding[] = [
      {
        dedupKey: "a",
        rule: "r1",
        category: "quality",
        severity: "low",
        filePath: "a.ts",
        line: 1,
        snippet: "",
        message: "",
        suggestion: "",
      },
      {
        dedupKey: "b",
        rule: "r2",
        category: "security",
        severity: "critical",
        filePath: "b.ts",
        line: 2,
        snippet: "",
        message: "",
        suggestion: "",
      },
      {
        dedupKey: "c",
        rule: "r3",
        category: "performance",
        severity: "medium",
        filePath: "c.ts",
        line: 3,
        snippet: "",
        message: "",
        suggestion: "",
      },
    ];
    const ranked = rankFindings(findings);
    expect(ranked.map(f => f.severity)).toEqual(["critical", "medium", "low"]);
  });

  it("respects topN", () => {
    const finding: CodeFinding = {
      dedupKey: "k",
      rule: "r",
      category: "quality",
      severity: "low",
      filePath: "a.ts",
      line: 1,
      snippet: "",
      message: "",
      suggestion: "",
    };
    const ranked = rankFindings(
      [finding, finding, finding, finding, finding],
      2
    );
    expect(ranked.length).toBe(2);
  });
});

describe("findingToMarkdown", () => {
  it("renders required fields", () => {
    const md = findingToMarkdown({
      dedupKey: "k",
      rule: "eval-usage",
      category: "security",
      severity: "high",
      filePath: "server/foo.ts",
      line: 4,
      snippet: "return eval(input);",
      message: "eval risk",
      suggestion: "use JSON.parse",
    });
    expect(md).toContain("HIGH");
    expect(md).toContain("eval-usage");
    expect(md).toContain("server/foo.ts:4");
    expect(md).toContain("return eval(input);");
    expect(md).toContain("use JSON.parse");
  });
});

describe("getRuleIds", () => {
  it("exposes a non-empty set of stable rule ids", () => {
    const ids = getRuleIds();
    expect(ids.length).toBeGreaterThan(5);
    expect(new Set(ids).size).toBe(ids.length); // unique
  });
});
