import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("orb planner includes site-wide model usage context", () => {
  it("injects getSiteWideModelUsageSnapshot output into planner context", () => {
    const source = readFileSync(resolve(process.cwd(), "server/routers.ts"), "utf8");
    expect(source).toContain("getSiteWideModelUsageSnapshot");
    expect(source).toContain("站內模型使用快照（最近 14 天）");
    expect(source).toContain("siteModelUsagePromptBlock || undefined");
  });
});

