import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("creative_projects migration", () => {
  it("contains required columns", () => {
    const sql = readFileSync(resolve(__dirname, "../drizzle/0068_creative_projects_bootstrap.sql"), "utf8");
    for (const key of ["id", "userId", "title", "description", "status", "directorSessionId", "worldFrameworkId", "worldStoryboardId", "createdAt", "updatedAt"]) {
      expect(sql).toContain("`" + key + "`");
    }
  });
});
