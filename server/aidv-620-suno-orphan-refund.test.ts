/**
 * aidv-620-suno-orphan-refund.test.ts — AIDV-620
 *
 * 缺口：proStudio.ts 的 generateMusicSuno 在 chargeForFalTask 扣點後呼叫
 * createBackgroundJob 取得 jobId，但該呼叫原本不在 try-catch 內。若
 * createBackgroundJob 拋錯（DB 約束/連線），使用者已扣點但沒有 jobId——
 * 下方 suno.generateMusic 失敗時的 refundUserPoints（依 jobId 寫回任務）
 * 永遠不會被執行到，點數成為無法回收的孤兒。與 AIDV-771（generate.ts /
 * director.ts）同一缺口型態，但發生在 proStudio.ts 這個 AIDV-771 範疇外
 * 的呼叫點。
 *
 * 修法（純加性守衛，延續 AIDV-771 既定模式）：把 createBackgroundJob 包進
 * try-catch，建立失敗時立即 refundUserPoints 再 rethrow。因尚未產生
 * jobId，此退款與下方 suno.generateMusic 失敗的退款路徑互斥、不會雙退。
 *
 * proStudio.ts 內其餘 chargeForFalTask 呼叫點（30 處之中的另外 29 處）
 * 都是「chargeForFalTask → try { falQueueSubmit } catch { refundUserPoints }」
 * 的單步模式，本來就已受保護，不在本卡範圍。
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PRO_STUDIO = resolve(process.cwd(), "server/routers/proStudio.ts");

describe("AIDV-620: generateMusicSuno createBackgroundJob 失敗→孤兒點數退款守衛", () => {
  it("chargeForFalTask 後的 createBackgroundJob 必須包在 try 內，失敗即 refundUserPoints 再 throw", () => {
    const src = readFileSync(PRO_STUDIO, "utf8");
    // AIDV-956：Suno 提交流程自 generateMusicSuno 抽出為共用 helper
    // submitSunoMusicJob（textToMusic / compiledTextToMusic 的 Suno 分支同用），
    // AIDV-620 守衛程式碼隨之搬家 — 檢查區域改鎖定該 helper，守衛語義不變。
    const start = src.indexOf("async function submitSunoMusicJob");
    const end = src.indexOf("checkSunoAudioStatusBridge", start);
    expect(start, "找不到 submitSunoMusicJob helper").toBeGreaterThanOrEqual(0);
    expect(end, "找不到 checkSunoAudioStatusBridge 邊界").toBeGreaterThan(start);
    const region = src.slice(start, end);

    const idxCharge = region.indexOf("chargeForFalTask(ctx.user.id");
    const idxCreate = region.indexOf("createBackgroundJob(");
    expect(idxCharge, "應有 chargeForFalTask 扣點").toBeGreaterThanOrEqual(0);
    expect(idxCreate, "應有 createBackgroundJob").toBeGreaterThan(idxCharge);

    // createBackgroundJob 必須位於 try 區塊內，且其後緊接 catch + refundUserPoints + throw
    const idxTry = region.lastIndexOf("try {", idxCreate);
    expect(idxTry, "createBackgroundJob 必須包在 try 內").toBeGreaterThan(idxCharge);

    const idxCatch = region.indexOf("} catch (jobErr)", idxCreate);
    expect(idxCatch, "createBackgroundJob 之後必須有 catch (jobErr)").toBeGreaterThan(idxCreate);

    const idxRefund = region.indexOf("refundUserPoints(ctx.user.id, charged)", idxCatch);
    expect(idxRefund, "catch (jobErr) 內必須呼叫 refundUserPoints").toBeGreaterThan(idxCatch);

    const idxThrow = region.indexOf("throw jobErr", idxRefund);
    expect(idxThrow, "refund 後必須 rethrow jobErr").toBeGreaterThan(idxRefund);

    expect(region).toContain("AIDV-620");
  });

  it("proStudio.ts 僅此一處呼叫 createBackgroundJob（無其他漏網孤兒缺口）", () => {
    const src = readFileSync(PRO_STUDIO, "utf8");
    const count = (src.match(/[^.]createBackgroundJob\(/g) ?? []).length;
    expect(count, "若新增了其他 createBackgroundJob 呼叫點，須一併補上退款守衛").toBe(1);
  });
});
