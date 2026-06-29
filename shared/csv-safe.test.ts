import { describe, it, expect } from "vitest";
import { sanitizeCsvCell, toCsvRow } from "./csv-safe";

describe("sanitizeCsvCell — 公式前綴中和（CWE-1236）", () => {
  it("中和以 = 開頭的公式", () => {
    expect(sanitizeCsvCell("=cmd")).toBe("'=cmd");
    expect(sanitizeCsvCell("=1+1")).toBe("'=1+1");
  });

  it("中和以 @ 開頭（Lotus / DDE）", () => {
    expect(sanitizeCsvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("中和以 + / - 開頭但非純數字者（formula）", () => {
    expect(sanitizeCsvCell("+1+1")).toBe("'+1+1");
    expect(sanitizeCsvCell("-1+1")).toBe("'-1+1");
    expect(sanitizeCsvCell("-2-3-cmd")).toBe("'-2-3-cmd");
  });

  it("中和前導 TAB / CR（會被引號包裹因 \\r 屬 RFC-4180 觸發）", () => {
    expect(sanitizeCsvCell("\tx")).toBe("'\tx"); // TAB 非引號觸發字元
    expect(sanitizeCsvCell("\rx")).toBe('"\'\rx"'); // 前置 ' 後仍含 \r → 引號包裹
  });

  it("惡意 HYPERLINK（同時含逗號與引號）→ 中和 + 引號加倍包裹", () => {
    expect(sanitizeCsvCell('=HYPERLINK("http://evil","x")')).toBe(
      '"\'=HYPERLINK(""http://evil"",""x"")"'
    );
  });
});

describe("sanitizeCsvCell — 純數值豁免（不破壞成本/數字欄）", () => {
  it("正負整數與小數原樣保留（不前置撇號）", () => {
    expect(sanitizeCsvCell("-5")).toBe("-5");
    expect(sanitizeCsvCell("+3")).toBe("+3");
    expect(sanitizeCsvCell("-1.5")).toBe("-1.5");
    expect(sanitizeCsvCell(".5")).toBe(".5");
    expect(sanitizeCsvCell("42")).toBe("42");
  });

  it("科學記號數字原樣保留", () => {
    expect(sanitizeCsvCell("-1.5e3")).toBe("-1.5e3");
    expect(sanitizeCsvCell("1E-10")).toBe("1E-10");
  });

  it("數字型別輸入原樣（成本欄常見）", () => {
    expect(sanitizeCsvCell(-0.123456)).toBe("-0.123456");
    expect(sanitizeCsvCell(0)).toBe("0");
  });
});

describe("sanitizeCsvCell — RFC-4180 引號跳脫", () => {
  it("含逗號 → 引號包裹（修 provider 欄未引號的結構破壞）", () => {
    expect(sanitizeCsvCell("a,b")).toBe('"a,b"');
  });

  it("含雙引號 → 內部加倍 + 包裹", () => {
    expect(sanitizeCsvCell('a"b')).toBe('"a""b"');
  });

  it("含換行 → 引號包裹", () => {
    expect(sanitizeCsvCell("a\nb")).toBe('"a\nb"');
    expect(sanitizeCsvCell("a\rb")).toBe('"a\rb"');
  });

  it("一般文字原樣", () => {
    expect(sanitizeCsvCell("hello world")).toBe("hello world");
  });
});

describe("sanitizeCsvCell — 邊界", () => {
  it("null / undefined → 空字串", () => {
    expect(sanitizeCsvCell(null)).toBe("");
    expect(sanitizeCsvCell(undefined)).toBe("");
  });

  it("空字串 → 空字串", () => {
    expect(sanitizeCsvCell("")).toBe("");
  });
});

describe("toCsvRow", () => {
  it("混合列：文字 / 數字 / 惡意公式 / 含逗號", () => {
    expect(
      toCsvRow(["角色名", -1.5, "=cmd", "a,b"])
    ).toBe('角色名,-1.5,\'=cmd,"a,b"');
  });

  it("空列", () => {
    expect(toCsvRow([])).toBe("");
  });
});
