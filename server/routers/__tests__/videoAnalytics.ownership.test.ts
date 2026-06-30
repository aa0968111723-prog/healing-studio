// @vitest-environment node
/**
 * AIDV-862: videoAnalyticsRouter.track 擁有權驗證（IDOR write 防護）。
 *
 * 透過真實 createCaller 跑「實際 procedure」，證明 owner-only 真接線（非模擬）：
 * 非擁有者對他人 videoProjectId 寫入 → FORBIDDEN 且不落庫；擁有者 → ok。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// 受測 procedure 透過 getDb 取得 DB；用 hoisted 可變物件控制 select 回傳的 project
// 與攔截 insert，驗證 ownership 不符時「完全不寫入」。
const projectRow = vi.hoisted(() => ({ value: { id: 1, userId: 100 } as { id: number; userId: number } }));
const inserted = vi.hoisted(() => ({ rows: [] as unknown[] }));

vi.mock("../../db", () => ({
  getDb: () =>
    Promise.resolve({
      select: () => ({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([projectRow.value]) }),
        }),
      }),
      insert: () => ({
        values: (row: unknown) => {
          inserted.rows.push(row);
          return Promise.resolve();
        },
      }),
    }),
}));

import { videoAnalyticsRouter } from "../videoAnalyticsRouter";

const TRACK_INPUT = { videoProjectId: 1, eventType: "play" as const, durationWatched: 0 };
const callerFor = (userId: number) =>
  videoAnalyticsRouter.createCaller({ user: { id: userId } } as never);

describe("videoAnalyticsRouter.track ownership (AIDV-862)", () => {
  beforeEach(() => {
    inserted.rows = [];
    projectRow.value = { id: 1, userId: 100 };
  });

  it("擁有者（userId 相符）→ 寫入成功 ok=true", async () => {
    const res = await callerFor(100).track(TRACK_INPUT);
    expect(res).toEqual({ ok: true });
    expect(inserted.rows.length).toBe(1);
  });

  it("非擁有者（userId 不符）→ FORBIDDEN 且不落庫（IDOR 防護）", async () => {
    await expect(callerFor(999).track(TRACK_INPUT)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(inserted.rows.length).toBe(0);
  });
});
