import { describe, it, expect } from "vitest";
import { humanizeError, GENERIC_FALLBACK } from "./humanizeError";

/** 造一個近似 TRPCClientError 的物件（有 data.code）。 */
function trpcErr(code: string, message = "some server detail"): unknown {
  return { name: "TRPCClientError", message, data: { code } };
}

describe("humanizeError", () => {
  it("從不外露原始工程字串給使用者（未知錯誤回通用白話）", () => {
    const out = humanizeError(new Error("ETIMEDOUT at line 42 {stack}"));
    // 落到 timeout 分類，但無論如何不得包含原始堆疊
    expect(out).not.toContain("{stack}");
    expect(out).not.toContain("line 42");
  });

  it("完全認不得的錯誤 → 通用 fallback", () => {
    expect(humanizeError(new Error("zxcvbnm qwerty"))).toBe(GENERIC_FALLBACK);
    expect(humanizeError(null)).toBe(GENERIC_FALLBACK);
    expect(humanizeError(undefined)).toBe(GENERIC_FALLBACK);
    expect(humanizeError({})).toBe(GENERIC_FALLBACK);
  });

  it("context 字串捷徑 → 組成「<context>：<白話>」", () => {
    const out = humanizeError(new Error("totally unknown"), "生成失敗");
    expect(out).toBe(`生成失敗：${GENERIC_FALLBACK}`);
  });

  it("context/fallback 物件形式可自訂 fallback", () => {
    const out = humanizeError(new Error("???"), {
      context: "上傳失敗",
      fallback: "檔案上傳沒成功，請再試一次。",
    });
    expect(out).toBe("上傳失敗：檔案上傳沒成功，請再試一次。");
  });

  it("後端已給乾淨繁中短句 → 原樣保留（不蓋掉好訊息）", () => {
    expect(humanizeError(trpcErr("BAD_REQUEST", "點數不足"))).toBe("點數不足");
    expect(humanizeError(new Error("這個名稱已經有人用了"))).toBe(
      "這個名稱已經有人用了"
    );
  });

  it("含技術雜訊的繁中訊息不算乾淨人話 → 走分類/fallback", () => {
    // 帶括號 JSON 味，不該被當乾淨人話原樣外露
    const out = humanizeError(new Error("錯誤 {code: 500}"));
    expect(out).not.toContain("{code: 500}");
  });

  it("依 tRPC code 歸類（UNAUTHORIZED/FORBIDDEN/NOT_FOUND/429/BAD_REQUEST）", () => {
    expect(humanizeError(trpcErr("UNAUTHORIZED"))).toContain("重新登入");
    expect(humanizeError(trpcErr("FORBIDDEN"))).toContain("權限");
    expect(humanizeError(trpcErr("NOT_FOUND"))).toContain("找不到");
    expect(humanizeError(trpcErr("TOO_MANY_REQUESTS"))).toContain("太頻繁");
    expect(humanizeError(trpcErr("BAD_REQUEST", "Invalid input: expected string"))).toContain(
      "資料有點問題"
    );
    expect(humanizeError(trpcErr("INTERNAL_SERVER_ERROR"))).toContain("伺服器");
  });

  it("依 HTTP 數字狀態碼歸類", () => {
    expect(humanizeError({ message: "x", status: 403 })).toContain("權限");
    expect(humanizeError({ message: "x", data: { httpStatus: 429 } })).toContain(
      "太頻繁"
    );
  });

  it("依英文 message 特徵歸類（網路 / 逾時 / 額度 / 驗證）", () => {
    expect(humanizeError(new Error("fetch failed"))).toContain("網路");
    expect(humanizeError(new Error("The operation was aborted"))).toContain(
      "逾時"
    );
    expect(humanizeError(new Error("Insufficient credits"))).toContain(
      "額度不足"
    );
    expect(
      humanizeError(new Error('Required at "title"; Invalid input'))
    ).toContain("資料有點問題");
  });

  it("吃字串型錯誤", () => {
    expect(humanizeError("fetch failed")).toContain("網路");
  });

  it("輸出永遠是非空白話字串", () => {
    for (const e of [
      null,
      undefined,
      "",
      new Error(""),
      {},
      trpcErr("WEIRD_CODE"),
    ]) {
      const out = humanizeError(e, "操作失敗");
      expect(out.startsWith("操作失敗：")).toBe(true);
      expect(out.length).toBeGreaterThan("操作失敗：".length);
    }
  });
});
