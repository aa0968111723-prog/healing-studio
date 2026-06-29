/**
 * db.transfer-ownership-tx.test.ts — AIDV-186
 *
 * Pin the **atomicity** of `runTransferOwnershipAndWipeShares`: 移轉擁有權與清掉
 * 全部共享必須在同一 DB transaction 內完成，任一步失敗整筆 rollback，杜絕「擁有權
 * 已轉、舊 owner 共享殘留」的部分失敗（舊 owner 對已不屬於他的資源殘餘存取）。
 *
 * 用注入式 fake db/tx 直接驗證交易接線（兩步都在同一 tx 回呼內、delete 失敗會把
 * 整筆交易拋出 → 真 DB 由 mysql2/Drizzle 保證 rollback）。不需真連線。
 * 真 DB 端到端的 rollback 由 Drizzle/MySQL 交易語意保證，於 Docker MySQL 另驗。
 */

import { describe, expect, it } from "vitest";
import { runTransferOwnershipAndWipeShares } from "./db";

/**
 * 建一個記錄操作順序的 fake db。`transaction(cb)` 以 fake tx 執行回呼，模擬
 * commit/rollback 語意：回呼 throw → 記 "tx-rollback" 並把錯誤往外拋（如真 DB）。
 */
function makeFakeDb(opts: { failDelete?: boolean } = {}) {
  const ops: string[] = [];
  const tx = {
    update: (_table: unknown) => ({
      set: (_vals: unknown) => ({
        where: async (_cond: unknown) => {
          ops.push("update");
        },
      }),
    }),
    delete: (_table: unknown) => ({
      where: async (_cond: unknown) => {
        if (opts.failDelete) {
          ops.push("delete-throw");
          throw new Error("simulated delete failure");
        }
        ops.push("delete");
      },
    }),
  };
  const db = {
    transaction: async (cb: (tx: unknown) => Promise<void>) => {
      ops.push("tx-begin");
      try {
        await cb(tx);
        ops.push("tx-commit");
      } catch (e) {
        ops.push("tx-rollback");
        throw e;
      }
    },
  };
  return { db, ops };
}

describe("AIDV-186 runTransferOwnershipAndWipeShares 原子性", () => {
  it("成功路徑：同一交易內先移轉 owner、再清全部共享，最後 commit", async () => {
    const { db, ops } = makeFakeDb();
    await runTransferOwnershipAndWipeShares(db as never, "asset", 3, 200);
    // 兩步都發生在 tx-begin / tx-commit 之間（＝同一原子單元），順序：更新→清共享。
    expect(ops).toEqual(["tx-begin", "update", "delete", "tx-commit"]);
  });

  it("清共享失敗：整筆 rollback、拋錯，不 commit（擁有權變更一併回滾）", async () => {
    const { db, ops } = makeFakeDb({ failDelete: true });
    await expect(
      runTransferOwnershipAndWipeShares(db as never, "asset", 3, 200)
    ).rejects.toThrow("simulated delete failure");
    // 擁有權更新與清共享在同一交易內：delete throw → tx-rollback，無 tx-commit。
    // 真 DB 因此回滾 owner 變更，不會留下「已轉擁有權＋殘餘舊共享」的不一致。
    expect(ops).toContain("tx-begin");
    expect(ops).toContain("update");
    expect(ops).toContain("delete-throw");
    expect(ops).toContain("tx-rollback");
    expect(ops).not.toContain("tx-commit");
  });

  it("各資源型別都走交易（project/prompt/material）", async () => {
    for (const rt of ["project", "prompt", "material"] as const) {
      const { db, ops } = makeFakeDb();
      await runTransferOwnershipAndWipeShares(db as never, rt, 1, 200);
      expect(ops).toEqual(["tx-begin", "update", "delete", "tx-commit"]);
    }
  });

  it("未知資源型別：在交易內拋錯 → rollback，不 commit", async () => {
    const { db, ops } = makeFakeDb();
    await expect(
      runTransferOwnershipAndWipeShares(db as never, "bogus" as never, 1, 200)
    ).rejects.toThrow(/未知資源型別/);
    expect(ops).toEqual(["tx-begin", "tx-rollback"]);
  });
});
