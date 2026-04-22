import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("auto credit policy wiring", () => {
  it("admin router exposes auto credit policy endpoints", async () => {
    const routersPath = path.resolve(process.cwd(), "server/routers.ts");
    const source = await fs.readFile(routersPath, "utf8");

    expect(source).toContain("updateAutoCreditPolicy: adminProcedure");
    expect(source).toContain("runAutoCreditNow: adminProcedure.mutation");
  });

  it("server boot registers user auto credit cron job", async () => {
    const indexPath = path.resolve(process.cwd(), "server/_core/index.ts");
    const source = await fs.readFile(indexPath, "utf8");

    expect(source).toContain("initUserAutoCreditCron");
    expect(source).toContain("name: \"userAutoCreditJob\"");
  });

  it("auto credit scheduling defaults and catch-up logic are present", async () => {
    const dbPath = path.resolve(process.cwd(), "server/db.ts");
    const source = await fs.readFile(dbPath, "utf8");

    expect(source).toContain("defaultNextAt");
    expect(source).toContain("while (nextTs <= now)");
    expect(source).toContain("autoCreditNextAt = ${nextAt}");
  });
});
