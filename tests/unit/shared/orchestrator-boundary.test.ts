/**
 * tests/unit/shared/orchestrator-boundary.test.ts
 *
 * 鎖住兩個 orchestrator 的 client/server 邊界:
 *   - shared/global-agent-orchestrator.ts: 跑在 client,只能 import shared
 *     與相對路徑(client/...),禁止任何 server/... import
 *   - server/services/orbTaskOrchestrator.ts: 跑在 server,禁止任何
 *     client/... 或 vite-only 模組 import
 *
 * 兩個檔案在 doc comment 已經宣告 scope;這個測試把它升級成不變式。
 * 違反時 throws,提示維護者改掉新加的 import 或在 doc comment 解釋為何
 * 這條規則該改。
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../..");

function readSource(rel: string): string {
  return readFileSync(path.join(repoRoot, rel), "utf8");
}

function extractImportSources(source: string): string[] {
  const sources: string[] = [];
  // 抓 `import ... from "X"` 與 `import "X"`、`export ... from "X"`
  const importPattern = /(?:^|\s)(?:import|export)\b[^;]*?from\s+["']([^"']+)["']/g;
  for (const match of source.matchAll(importPattern)) {
    sources.push(match[1]);
  }
  const sideEffectPattern = /(?:^|\s)import\s+["']([^"']+)["']/g;
  for (const match of source.matchAll(sideEffectPattern)) {
    sources.push(match[1]);
  }
  return sources;
}

describe("orchestrator client/server 邊界", () => {
  it("shared/global-agent-orchestrator.ts 不可 import 任何 server/* 模組", () => {
    const src = readSource("shared/global-agent-orchestrator.ts");
    const offenders = extractImportSources(src).filter(s =>
      /(^|\/)server\//.test(s) || s.startsWith("../server/") || s.startsWith("../../server/")
    );
    expect(offenders).toEqual([]);
  });

  it("server/services/orbTaskOrchestrator.ts 不可 import 任何 client/* 模組", () => {
    const src = readSource("server/services/orbTaskOrchestrator.ts");
    const offenders = extractImportSources(src).filter(s =>
      /(^|\/)client\//.test(s) || s.startsWith("../client/") || s.startsWith("../../client/")
    );
    expect(offenders).toEqual([]);
  });

  it("server/services/orbTaskOrchestrator.ts 不可 import shared/global-agent-orchestrator(避免重新混血)", () => {
    const src = readSource("server/services/orbTaskOrchestrator.ts");
    const offenders = extractImportSources(src).filter(s =>
      s.endsWith("/global-agent-orchestrator") ||
      s.endsWith("/global-agent-orchestrator.ts")
    );
    expect(offenders).toEqual([]);
  });
});
