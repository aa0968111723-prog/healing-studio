/**
 * like-wildcard-escape.test.ts — AIDV-635：使用者可控搜尋字串的 LIKE 萬用字元跳脫
 *
 * 背景：repo 已有 SSOT sanitizer `escapeLikePattern`（db.ts，AIDV-307 引入，
 * 跳脫 `\ % _`），但多條「使用者／LLM 可控 search」的 LIKE 查詢路徑未套用，
 * 直接把原字串塞進 `%${search}%`。後果（非跨租戶外洩，皆 owner-scoped）：
 *   (a) 搜尋語意失準——送 `%` 命中自己全部資料、`_` 命中任意單字元；
 *   (b) 輕量 DoS——病態 pattern（`%a%b%c%...`）逼 DB 全表/全欄掃描放大成本。
 *
 * 本卡把跳脫補滿到下列檔案的所有使用者搜尋 LIKE 路徑。此測試用兩道防線守住：
 *   1. 行為：escapeLikePattern 把 `% _ \` 轉為字面（已是 SSOT，這裡再固定一次）。
 *   2. 來源守門（無需 DB）：掃描這些檔案，確保不再殘留「未經 escapeLikePattern
 *      包裹的 `%${...}%` LIKE 內插」——防止未來新增路徑時回歸。
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { escapeLikePattern } from "./db";

// 補滿跳脫的使用者搜尋 LIKE 路徑所在檔案（相對 server/）。
const GUARDED_FILES = [
  "db.ts",
  "routers/promptLibrary.ts",
  "routers/promptCollection.ts",
  "services/orbDatabaseTools.ts",
  "services/orbLongTermMemory.ts",
  "services/spiritTools/notesCuratorTools.ts",
];

/**
 * 各使用者／LLM 可控搜尋字串「未經 escapeLikePattern 包裹」時會出現的原始內插
 * 字面。修補後這些原樣 token 不應再出現於任何被守門檔案（皆改為
 * `${escapeLikePattern(...)}` 或先存入已跳脫的區域變數）。
 *
 * 注意：只比對「原始變數直送」形式；`${escaped}` / `${searchTerm}` / `${like}`
 * 這類「值本身已是跳脫結果」的區域變數不在此列（它們是正解，非殘留）。
 */
const RAW_USER_LIKE_TOKENS = [
  "`%${search}%`",
  "`%${searchQuery}%`",
  "`%${opts.search}%`",
  "`%${params.query}%`",
  "`%${filters.search}%`",
  "`%${input.query}%`",
  '`%"${input.tag}"%`',
];

describe("AIDV-635 escapeLikePattern 行為（SSOT 再固定）", () => {
  it("把 LIKE 萬用字元 % / _ 與跳脫字元 \\ 轉為字面", () => {
    expect(escapeLikePattern("%")).toBe("\\%");
    expect(escapeLikePattern("_")).toBe("\\_");
    expect(escapeLikePattern("\\")).toBe("\\\\");
    expect(escapeLikePattern("a%b_c")).toBe("a\\%b\\_c");
  });

  it("一般文字（含中文）原樣通過，不誤傷", () => {
    expect(escapeLikePattern("品牌影片")).toBe("品牌影片");
    expect(escapeLikePattern("brand video")).toBe("brand video");
  });

  it("使用者送 `%` 經跳脫後，組成的 LIKE pattern 命中字面百分號而非全表", () => {
    // 修補前：`%${"%"}%` = "%%%" → 萬用字元，命中該使用者全部資料。
    // 修補後：`%${escapeLikePattern("%")}%` = "%\\%%" → 命中「字面含 %」者。
    const pattern = `%${escapeLikePattern("%")}%`;
    expect(pattern).toBe("%\\%%");
    expect(pattern).not.toBe("%%%");
  });
});

describe("AIDV-635 來源守門：使用者搜尋 LIKE 路徑不得殘留未跳脫內插", () => {
  for (const rel of GUARDED_FILES) {
    it(`${rel} 的 LIKE 內插皆經 escapeLikePattern 包裹`, () => {
      const src = readFileSync(resolve(__dirname, rel), "utf8");
      const offenders = RAW_USER_LIKE_TOKENS.filter(tok => src.includes(tok));
      expect(
        offenders,
        `發現未跳脫的使用者搜尋 LIKE 內插（請改用 escapeLikePattern）：\n${offenders.join("\n")}`
      ).toEqual([]);
    });

    it(`${rel} 確實 import/使用 escapeLikePattern`, () => {
      const src = readFileSync(resolve(__dirname, rel), "utf8");
      expect(src.includes("escapeLikePattern")).toBe(true);
    });
  }
});
