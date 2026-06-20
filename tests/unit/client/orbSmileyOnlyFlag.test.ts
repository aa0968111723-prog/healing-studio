/**
 * orbSmileyOnlyFlag.test.ts
 *
 * 「光球只留笑臉光球」旗標 ORB_SMILEY_ONLY 的預設契約：
 *   - 沒有任何 env 覆寫（VITE_ORB_SMILEY_ONLY 未設）、沒有 ?orbsmileyonly run-time
 *     覆寫時，**預設 ON＝true**＝線上預設就是「只留笑臉光球」。
 *   - 旗標被收進 FEATURE_FLAGS 匯出，方便偵錯面板一次讀。
 *
 * 預設 ON 是回滾退路的相反：設 VITE_ORB_SMILEY_ONLY=0（建置）或 ?orbsmileyonly=0
 * （單瀏覽器）即可關閉本功能、還原主動精靈卡片＋第二顆光球泡泡。
 */
import { describe, expect, it } from "vitest";

import { ORB_SMILEY_ONLY, FEATURE_FLAGS } from "../../../client/src/config/featureFlags";

describe("ORB_SMILEY_ONLY — 預設旗標契約", () => {
  it("無任何覆寫時預設為 true（只留笑臉光球）", () => {
    // 測試環境沒有設 VITE_ORB_SMILEY_ONLY、沒有 ?orbsmileyonly query → fallback=true
    expect(ORB_SMILEY_ONLY).toBe(true);
  });

  it("被收進 FEATURE_FLAGS 匯出", () => {
    expect(FEATURE_FLAGS.ORB_SMILEY_ONLY).toBe(ORB_SMILEY_ONLY);
  });
});
