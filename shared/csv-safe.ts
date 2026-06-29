/**
 * shared/csv-safe.ts — CSV / 試算表安全輸出工具（防公式注入 CWE-1236）
 *
 * 為什麼：使用者匯出的 .csv 在 Excel / Google Sheets 開啟時，若某格內容以
 * `=` `+` `-` `@`（或前導 TAB / CR）開頭，試算表會把它當「公式」執行。攻擊者
 * 只要把自己可控的欄位（角色名、對白、endpoint…）命名成
 * `=HYPERLINK("http://evil","x")` 或 `=cmd|'/c calc'!A1`，受害者一開檔就中招
 * （公式 / DDE / 巨集注入）。多個 CSV 產生器原本只做「引號跳脫」，沒中和公式前綴。
 *
 * 本工具做兩件事：
 *   1. 公式前綴中和：cell 第一字元為危險字元時前置單引號 `'` 強制當文字。
 *      —— 但「純數值」（如 -1.5、+3、1e5）豁免，避免破壞成本報表等數字欄。
 *   2. RFC-4180 引號跳脫：含 `"` `,` `\n` `\r` 時整格加雙引號、內部 `"` 加倍。
 *
 * 兩者皆為純字串運算、零 runtime 相依 → client / server 共用（@shared/csv-safe）。
 *
 * AIDV-562。
 */

/** 試算表公式起點字元。 */
const FORMULA_CHARS = new Set(["=", "+", "-", "@"]);

/**
 * 純數值（含正負號、小數、科學記號）。試算表會視為數字而非公式 →
 * 安全、不需中和（避免把 `-1.5`、`+3` 這類合法數字變成 `'-1.5` 文字而破壞分析）。
 * 注意：`-1+1`、`+HYPERLINK(...)` 這類「以正負號開頭但不是單純數字」者**不**匹配 →
 * 仍會被中和。
 */
const PURE_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** 前導空白（含 BOM / NBSP）— 部分試算表會先去除再判公式（CWE-1236 繞過）。 */
const LEADING_WHITESPACE = /^[\s﻿\xA0]+/;

/** 前導控制字元（TAB / CR / LF）本身即應中和，避免解析破壞。 */
const LEADING_CONTROL = /^[\t\r\n]/;

/** 需要 RFC-4180 引號包裹的字元。 */
const NEEDS_QUOTING = /[",\n\r]/;

/**
 * 將任一值轉成可安全寫入 CSV 的單格字串：先做公式前綴中和，再做 RFC-4180 引號跳脫。
 * `null` / `undefined` → 空字串。
 *
 * 公式判定看「去掉前導空白後」的第一字元，故 `" =cmd"`（前導空白繞過）也會被中和。
 */
export function sanitizeCsvCell(value: unknown): string {
  const raw = value == null ? "" : String(value);
  const stripped = raw.replace(LEADING_WHITESPACE, "");
  const isFormula =
    FORMULA_CHARS.has(stripped.charAt(0)) && !PURE_NUMBER.test(stripped);
  const guarded = isFormula || LEADING_CONTROL.test(raw) ? `'${raw}` : raw;
  if (NEEDS_QUOTING.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

/** 將一列 cells 連成一行安全 CSV（每格皆走 {@link sanitizeCsvCell}）。 */
export function toCsvRow(cells: readonly unknown[]): string {
  return cells.map(sanitizeCsvCell).join(",");
}
