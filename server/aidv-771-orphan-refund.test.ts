/**
 * aidv-771-orphan-refund.test.ts — AIDV-771
 *
 * 缺口：deductUserPoints 成功扣點後，若 createBackgroundJob 拋錯（DB 約束/連線），
 * 就不會產生 jobId，依 job.id 退款的 refundJobIfBilled / pollGenerationTask 失敗
 * 路徑永遠無法觸發 → 點數成為無法回收的孤兒。
 *
 * 修法（純加性守衛）：把 createBackgroundJob 包進 try-catch，建立失敗時立即
 * refundUserPoints 再 rethrow。因尚未產生 jobId，此退款與 refundJobIfBilled
 * 失敗路徑互斥、不會雙退。
 *
 * 本測延續本 repo 對 router 計費不變量的「原始碼結構檢查」慣例
 * （見 points-billing-audit.test.ts / __tests__/director/auto-generation.test.ts）——
 * 驗證三個扣點站點的「deduct → try → createBackgroundJob → catch → refund → throw」
 * 順序不變量成立，鎖住回歸。
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GENERATE = resolve(process.cwd(), "server/routers/generate.ts");
const DIRECTOR = resolve(process.cwd(), "server/routers/director.ts");

/**
 * 在 region 內，斷言計費守衛的順序不變量：
 *   deductUserPoints  <  try {  <  createBackgroundJob(  <  catch  <  refundUserPoints  <  throw
 * 任一步缺失或順序錯亂都代表孤兒點數缺口尚未修補（或被改回）。
 */
function assertOrphanRefundGuard(region: string, label: string) {
  const idxDeduct = region.indexOf("deductUserPoints");
  const idxCreate = region.indexOf("createBackgroundJob(");
  const idxRefund = region.indexOf("refundUserPoints");

  expect(idxDeduct, `${label}: 應有 deductUserPoints 扣點`).toBeGreaterThanOrEqual(0);
  expect(idxCreate, `${label}: 應有 createBackgroundJob`).toBeGreaterThan(idxDeduct);
  expect(idxRefund, `${label}: createBackgroundJob 後應有 refundUserPoints 守衛`).toBeGreaterThan(idxCreate);

  // createBackgroundJob 必須位於 try 區塊內，且其後緊接 catch
  const idxTry = region.lastIndexOf("try {", idxCreate);
  expect(idxTry, `${label}: createBackgroundJob 必須包在 try 內`).toBeGreaterThan(idxDeduct);
  const idxCatch = region.indexOf("catch", idxCreate);
  expect(idxCatch, `${label}: createBackgroundJob 之後必須有 catch`).toBeGreaterThan(idxCreate);
  expect(idxCatch, `${label}: catch 必須在 refund 之前`).toBeLessThan(idxRefund);

  // refund 之後必須 rethrow，避免吞掉錯誤讓呼叫端誤以為成功
  const idxThrow = region.indexOf("throw", idxRefund);
  expect(idxThrow, `${label}: refund 後必須 rethrow`).toBeGreaterThan(idxRefund);
}

describe("AIDV-771: createBackgroundJob 失敗→孤兒點數退款守衛", () => {
  it("generate.ts 同步 multimodal mutation：扣點後 createBackgroundJob 失敗即退款", () => {
    const src = readFileSync(GENERATE, "utf8");
    // 同步路徑：Step 4 扣點 → Step 5 建任務
    const start = src.indexOf("// ── Step 4");
    const end = src.indexOf("// ── Step 6", start);
    expect(start, "找不到同步 multimodal 的 Step 4 區段").toBeGreaterThanOrEqual(0);
    expect(end, "找不到同步 multimodal 的 Step 6 邊界").toBeGreaterThan(start);
    const region = src.slice(start, end);

    assertOrphanRefundGuard(region, "generate.ts 同步路徑");
    expect(region).toContain("await db.refundUserPoints(userId, pointsCost)");
    expect(region).toContain("AIDV-771");
  });

  it("generate.ts 非同步 submitMultimodalAsync：扣點後 createBackgroundJob 失敗即退款（demo 跳過）", () => {
    const src = readFileSync(GENERATE, "utf8");
    // 非同步路徑：prepareJob 扣點 + 建記錄 → 「依引擎供應商送出任務」
    const start = src.indexOf("// ── 4. prepareJob");
    const end = src.indexOf("// ── 5. 依引擎供應商送出任務", start);
    expect(start, "找不到 submitMultimodalAsync 的 prepareJob 區段").toBeGreaterThanOrEqual(0);
    expect(end, "找不到 submitMultimodalAsync 的送出任務邊界").toBeGreaterThan(start);
    const region = src.slice(start, end);

    assertOrphanRefundGuard(region, "generate.ts 非同步路徑");
    // 非同步路徑 demo 模式仍會呼叫 createBackgroundJob 但未扣點 → 退款必須 demo 防呆
    expect(region).toContain("if (!isDemoMode()) await db.refundUserPoints(userId, points)");
    expect(region).toContain("AIDV-771");
  });

  it("director.ts 多代理鏈路（pollGenerationTask 同軌）：扣點後 createBackgroundJob 失敗即退款（demo 跳過）", () => {
    const src = readFileSync(DIRECTOR, "utf8");
    // 扣點（Deduct points）→ 建任務（Create background job）→ try（送 fal）
    const start = src.indexOf("// Deduct points");
    const end = src.indexOf("// Build fal input based on modality", start);
    expect(start, "找不到 director.ts 的 Deduct points 區段").toBeGreaterThanOrEqual(0);
    expect(end, "找不到 director.ts 的 fal 送出邊界").toBeGreaterThan(start);
    const region = src.slice(start, end);

    assertOrphanRefundGuard(region, "director.ts 多代理路徑");
    expect(region).toContain("if (!isDemoMode()) await db.refundUserPoints(userId, estimate.totalPoints)");
    expect(region).toContain("AIDV-771");
  });

  it("每個 deductUserPoints 後緊接的 createBackgroundJob 都有退款守衛（涵蓋所有計費站點，無漏網孤兒缺口）", () => {
    // 以 deductUserPoints 為錨點精準鎖定「計費路徑」——submitStudioJob 之類
    // 無扣點、只登錄既有 fal 任務的 createBackgroundJob 不在此列、不需守衛。
    let billingSitesChecked = 0;
    for (const file of [GENERATE, DIRECTOR]) {
      const src = readFileSync(file, "utf8");
      const re = /db\.deductUserPoints\(/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const idxDeduct = m.index;
        const idxCreate = src.indexOf("db.createBackgroundJob(", idxDeduct);
        // 該扣點後若沒有、或隔很遠才有 createBackgroundJob → 非「扣點即建任務」
        // 的計費站點，跳過（不誤判其他純扣點流程）。
        if (idxCreate < 0 || idxCreate - idxDeduct > 2500) continue;
        // 窗口須涵蓋 createBackgroundJob 的大型物件字面量（director 約 24 行）+
        // 緊接的 catch 退款守衛，故給足 2500 字元。
        const region = src.slice(idxDeduct, idxCreate + 2500);
        assertOrphanRefundGuard(region, `${file}@deduct:${idxDeduct}`);
        billingSitesChecked++;
      }
    }
    // 已知三個計費站點：generate 同步 + generate 非同步 + director 多代理
    expect(billingSitesChecked).toBe(3);
  });
});
