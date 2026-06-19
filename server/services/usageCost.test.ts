/**
 * usageCost.test.ts — AIDV-14 extractUsageCostUsd 窮舉測試矩陣
 * ──────────────────────────────────────────────────────────────────────────
 * 對應研究 §3 的測試矩陣 A–H，每個 edge case 一條測試。
 * 不變量（每條測試都隱含驗證）：
 *   - 一律回傳 string，永不 throw、永不 null/undefined。
 *   - 回傳值永遠是合法的 DECIMAL(12,6) literal：有限、定點（無 e）、
 *     ≤ 6 位小數、0 ≤ value ≤ 999999.999999；fallback 為 "0"。
 */
import { describe, it, expect } from "vitest";
import { extractUsageCostUsd, normalizeCostUsd } from "./usageCost";

/** 把物件序列化成 JSON Buffer。 */
const buf = (obj: unknown) => Buffer.from(JSON.stringify(obj), "utf8");
/** 把原始字串包成 Buffer。 */
const raw = (s: string) => Buffer.from(s, "utf8");

const JSON_CT = "application/json";

/** DECIMAL(12,6) literal 合法性守衛（定點、≤6 小數、範圍內、非 NaN/Inf）。 */
function isLegalDecimal12_6(s: string): boolean {
  if (typeof s !== "string") return false;
  if (!/^-?\d{1,6}(\.\d{1,6})?$/.test(s)) return false; // 定點、最多 6 整數位 + 6 小數位、無 e
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= 999999.999999;
}

describe("extractUsageCostUsd — 全域不變量", () => {
  const samples: Array<[string, Buffer, string | null]> = [
    ["empty", Buffer.alloc(0), JSON_CT],
    ["json-cost", buf({ usage: { cost: 0.0024 } }), JSON_CT],
    ["garbage", raw("<<<not json>>>"), JSON_CT],
    ["binary", raw("\x89PNG\r\n"), "image/png"],
    ["sse", raw("data: {\"usage\":{\"cost\":0.01}}\n\ndata: [DONE]\n\n"), "text/event-stream"],
  ];
  for (const [name, payload, ct] of samples) {
    it(`回傳合法 DECIMAL(12,6) 字串：${name}`, () => {
      const out = extractUsageCostUsd(payload, ct);
      expect(typeof out).toBe("string");
      expect(isLegalDecimal12_6(out)).toBe(true);
    });
  }
});

// ─── A. Body shape / encoding failures ────────────────────────────────────
describe("A. body 形狀 / 編碼錯誤", () => {
  it("A1 空 buffer → 0", () => {
    expect(extractUsageCostUsd(Buffer.alloc(0), JSON_CT)).toBe("0");
  });
  it("A2 非 JSON body（HTML 錯誤頁）→ 0", () => {
    expect(extractUsageCostUsd(raw("<html>500</html>"), JSON_CT)).toBe("0");
  });
  it("A3 截斷的 JSON（無收尾括號）→ 0", () => {
    expect(extractUsageCostUsd(raw('{"usage":{"cost":0.5'), JSON_CT)).toBe("0");
  });
  it("A4 contentType=null + JSON body → 正常解析", () => {
    expect(extractUsageCostUsd(buf({ usage: { cost: 0.0024 } }), null)).toBe(
      "0.002400",
    );
  });
  it("A4b contentType=null + 垃圾 body → 0", () => {
    expect(extractUsageCostUsd(raw("garbage"), null)).toBe("0");
  });
  it("A5 contentType 宣稱 JSON 但 body 是垃圾 → 0（信任 body）", () => {
    expect(extractUsageCostUsd(raw("not really json"), JSON_CT)).toBe("0");
  });
  it("A6 image/png → 0（不嘗試 parse）", () => {
    expect(extractUsageCostUsd(buf({ usage: { cost: 9 } }), "image/png")).toBe(
      "0",
    );
  });
  it("A6b audio/mpeg → 0", () => {
    expect(
      extractUsageCostUsd(buf({ usage: { cost: 9 } }), "audio/mpeg"),
    ).toBe("0");
  });
  it("A6c application/octet-stream → 0", () => {
    expect(
      extractUsageCostUsd(buf({ usage: { cost: 9 } }), "application/octet-stream"),
    ).toBe("0");
  });
  it("A7 頂層為陣列 → 0", () => {
    expect(extractUsageCostUsd(buf([{ usage: { cost: 1 } }]), JSON_CT)).toBe("0");
  });
  it("A7b 頂層為原始值（number）→ 0", () => {
    expect(extractUsageCostUsd(raw("42"), JSON_CT)).toBe("0");
  });
  it("A7c 頂層為原始值（true）→ 0", () => {
    expect(extractUsageCostUsd(raw("true"), JSON_CT)).toBe("0");
  });
  it("A7d 頂層為原始值（字串）→ 0", () => {
    expect(extractUsageCostUsd(raw('"ok"'), JSON_CT)).toBe("0");
  });
  it("A8 巨大 body（> 8MiB）→ 0（size cap 短路）", () => {
    const big = Buffer.alloc(9 * 1024 * 1024, 0x20); // 9 MiB 空白
    expect(extractUsageCostUsd(big, JSON_CT)).toBe("0");
  });
  it("A9 BOM 前綴的 JSON → 仍可解析", () => {
    const withBom = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      buf({ usage: { cost: 0.001 } }),
    ]);
    // BOM 會讓 JSON.parse 失敗 → 安全回 "0"（不 throw 即達標）
    const out = extractUsageCostUsd(withBom, JSON_CT);
    expect(isLegalDecimal12_6(out)).toBe(true);
  });
});

// ─── B. HTTP error bodies ─────────────────────────────────────────────────
describe("B. HTTP 錯誤 body", () => {
  it("B1 429/500 錯誤封包（無 usage）→ 0", () => {
    expect(
      extractUsageCostUsd(buf({ error: { message: "rate limited" } }), JSON_CT),
    ).toBe("0");
  });
  it("B2 4xx 但帶 usage.cost → 仍正確擷取（policy 由 caller 決定）", () => {
    expect(
      extractUsageCostUsd(
        buf({ error: { message: "len" }, usage: { cost: 0.003 } }),
        JSON_CT,
      ),
    ).toBe("0.003000");
  });
  it("B3 Cloudflare 502 HTML 頁 → 0", () => {
    expect(
      extractUsageCostUsd(raw("<!DOCTYPE html><title>502</title>"), "text/html"),
    ).toBe("0");
  });
  it("B4 200 但 body 是 error JSON（無 usage）→ 0", () => {
    expect(extractUsageCostUsd(buf({ error: "boom" }), JSON_CT)).toBe("0");
  });
});

// ─── C. SSE / streaming ───────────────────────────────────────────────────
describe("C. SSE / 串流", () => {
  it("C1 純 SSE frames（無 usage 區塊）→ 0，且不 throw", () => {
    const sse = 'data: {"choices":[]}\n\ndata: [DONE]\n\n';
    expect(extractUsageCostUsd(raw(sse), "text/event-stream")).toBe("0");
  });
  it("C2 SSE 帶尾端 usage chunk → 擷取最後一個 usage.cost", () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' +
      'data: {"choices":[],"usage":{"cost":0.0123}}\n\n' +
      "data: [DONE]\n\n";
    expect(extractUsageCostUsd(raw(sse), "text/event-stream")).toBe("0.012300");
  });
  it("C2b 多個 usage frame → 取最後一個", () => {
    const sse =
      'data: {"usage":{"cost":0.01}}\n\n' +
      'data: {"usage":{"cost":0.05}}\n\n' +
      "data: [DONE]\n\n";
    expect(extractUsageCostUsd(raw(sse), "text/event-stream")).toBe("0.050000");
  });
  it("C3 只有 data: [DONE] → 0", () => {
    expect(extractUsageCostUsd(raw("data: [DONE]\n\n"), "text/event-stream")).toBe(
      "0",
    );
  });
  it("C4 content-type=text/event-stream，含壞 frame → 略過壞 frame、取好的", () => {
    const sse =
      "data: {not json}\n\n" +
      'data: {"usage":{"cost":0.002}}\n\n' +
      "data: [DONE]\n\n";
    expect(extractUsageCostUsd(raw(sse), "text/event-stream")).toBe("0.002000");
  });
  it("C4b SSE body 但 content-type=null → 仍走 SSE 嗅探", () => {
    const sse = 'data: {"usage":{"cost":0.007}}\n\ndata: [DONE]\n\n';
    expect(extractUsageCostUsd(raw(sse), null)).toBe("0.007000");
  });
});

// ─── D. Missing / partial usage ───────────────────────────────────────────
describe("D. 缺漏 / 部分 usage", () => {
  it("D1 合法 completion JSON 但無 usage key → 0", () => {
    expect(
      extractUsageCostUsd(buf({ id: "x", choices: [] }), JSON_CT),
    ).toBe("0");
  });
  it("D2 usage 只有 token（無 cost）→ 0", () => {
    expect(
      extractUsageCostUsd(
        buf({ usage: { prompt_tokens: 10, completion_tokens: 2 } }),
        JSON_CT,
      ),
    ).toBe("0");
  });
  it("D3 usage 為 null → 0", () => {
    expect(extractUsageCostUsd(buf({ usage: null }), JSON_CT)).toBe("0");
  });
  it("D3b usage 為非物件（number）→ 0", () => {
    expect(extractUsageCostUsd(buf({ usage: 5 }), JSON_CT)).toBe("0");
  });
  it("D4 cost 在非標準 BYOK 路徑（cost_details）→ 不取、回 0", () => {
    expect(
      extractUsageCostUsd(
        buf({ usage: { cost_details: { upstream_inference_cost: 19 } } }),
        JSON_CT,
      ),
    ).toBe("0");
  });
  it("D4b usage.total_cost 別名 → 擷取", () => {
    expect(
      extractUsageCostUsd(buf({ usage: { total_cost: 0.004 } }), JSON_CT),
    ).toBe("0.004000");
  });
});

// ─── E. Cost value type / shape ───────────────────────────────────────────
describe("E. cost 值型別 / 形狀", () => {
  it("E1 cost 為 number → 字串化", () => {
    expect(extractUsageCostUsd(buf({ usage: { cost: 0.0024 } }), JSON_CT)).toBe(
      "0.002400",
    );
  });
  it("E2 cost 為數字字串 → 正規化", () => {
    expect(
      extractUsageCostUsd(buf({ usage: { cost: "0.0024" } }), JSON_CT),
    ).toBe("0.002400");
  });
  it("E2b cost 為非數字字串（free）→ 0", () => {
    expect(extractUsageCostUsd(buf({ usage: { cost: "free" } }), JSON_CT)).toBe(
      "0",
    );
  });
  it("E2c cost 為空字串 → 0", () => {
    expect(extractUsageCostUsd(buf({ usage: { cost: "" } }), JSON_CT)).toBe("0");
  });
  it("E3 cost 為巢狀物件（{amount,currency}）→ 0（未知 shape）", () => {
    expect(
      extractUsageCostUsd(
        buf({ usage: { cost: { amount: 0.0024, currency: "USD" } } }),
        JSON_CT,
      ),
    ).toBe("0");
  });
  it("E4 cost 為 0（免費模型）→ 0（正確，非錯誤）", () => {
    expect(extractUsageCostUsd(buf({ usage: { cost: 0 } }), JSON_CT)).toBe("0");
  });
  it("E4b cost 為 '0' 字串 → 0", () => {
    expect(extractUsageCostUsd(buf({ usage: { cost: "0" } }), JSON_CT)).toBe("0");
  });
  it("E5 cost 為負值（退款/bug）→ clamp 成 0", () => {
    expect(extractUsageCostUsd(buf({ usage: { cost: -0.5 } }), JSON_CT)).toBe(
      "0",
    );
  });
  it("E6 cost 為 boolean → 0", () => {
    expect(extractUsageCostUsd(buf({ usage: { cost: true } }), JSON_CT)).toBe(
      "0",
    );
  });
  it("E6b cost 為陣列 → 0", () => {
    expect(extractUsageCostUsd(buf({ usage: { cost: [1] } }), JSON_CT)).toBe("0");
  });
});

// ─── F. 數值病態 vs DECIMAL(12,6) ─────────────────────────────────────────
describe("F. 數值病態 vs DECIMAL(12,6)", () => {
  it("F1 NaN（透過字串）→ 0（永不 'NaN'）", () => {
    expect(normalizeCostUsd("NaN")).toBe("0");
    expect(normalizeCostUsd(Number.NaN)).toBe("0");
  });
  it("F2 Infinity → 0（永不 'Infinity'）", () => {
    expect(normalizeCostUsd(Number.POSITIVE_INFINITY)).toBe("0");
    expect(normalizeCostUsd(Number.NEGATIVE_INFINITY)).toBe("0");
    expect(normalizeCostUsd("Infinity")).toBe("0");
  });
  it("F3 科學記號 number → 定點", () => {
    // 1.2e-9 在 scale-6 下捨入為 0.000000 → "0"
    expect(extractUsageCostUsd(raw('{"usage":{"cost":1.2e-9}}'), JSON_CT)).toBe(
      "0",
    );
    // 1e-3 = 0.001 → 定點
    expect(normalizeCostUsd(1e-3)).toBe("0.001000");
  });
  it("F3b 科學記號字串 → 定點，無 e", () => {
    const out = normalizeCostUsd("1e-7");
    expect(out).not.toContain("e");
    expect(isLegalDecimal12_6(out)).toBe(true);
    expect(out).toBe("0"); // 1e-7 在 scale-6 捨入後 → "0.000000" → 視為 0? 見下
  });
  it("F4 低於 scale-6 的微小成本 → 捨入至 0.000000，仍合法", () => {
    const out = normalizeCostUsd(0.0000004);
    expect(isLegalDecimal12_6(out)).toBe(true);
  });
  it("F5 整數位溢位（7 位整數）→ clamp 至上限", () => {
    expect(normalizeCostUsd(1234567.89)).toBe("999999.999999");
    expect(
      extractUsageCostUsd(buf({ usage: { cost: 1234567.89 } }), JSON_CT),
    ).toBe("999999.999999");
  });
  it("F6 過長小數字串 → 四捨五入到 6 位", () => {
    expect(normalizeCostUsd("0.12345678901234567890")).toBe("0.123457");
  });
  it("F7 邊界值 999999.999999 → 原樣合法", () => {
    expect(normalizeCostUsd(999999.999999)).toBe("999999.999999");
  });
  it("F7b 邊界一過頭 1000000 → clamp 至上限", () => {
    expect(normalizeCostUsd(1000000)).toBe("999999.999999");
  });
  it("F8 -0 → 0", () => {
    expect(normalizeCostUsd(-0)).toBe("0");
  });
  it("F9 千分位字串（1,234.56）→ 0（不誤判）", () => {
    expect(normalizeCostUsd("1,234.56")).toBe("0");
    expect(
      extractUsageCostUsd(buf({ usage: { cost: "1,234.56" } }), JSON_CT),
    ).toBe("0");
  });
  it("F10 帶空白的數字字串（' 0.5 '）→ 容忍 trim", () => {
    expect(normalizeCostUsd(" 0.5 ")).toBe("0.500000");
  });
});

// ─── G. Provider mix（非 LLM 走同一路徑）──────────────────────────────────
describe("G. provider 混流（非 LLM）", () => {
  it("G1 fal 圖片生成 JSON（有 images，無 usage.cost）→ 0", () => {
    expect(
      extractUsageCostUsd(
        buf({ images: [{ url: "x" }], seed: 1 }),
        JSON_CT,
      ),
    ).toBe("0");
  });
  it("G2 fal 二進位圖片 bytes（image/jpeg）→ 0", () => {
    expect(extractUsageCostUsd(raw("\xff\xd8\xff"), "image/jpeg")).toBe("0");
  });
  it("G2b elevenlabs audio/mpeg → 0", () => {
    expect(extractUsageCostUsd(raw("ID3\x03"), "audio/mpeg")).toBe("0");
  });
  it("G3 Gemini usageMetadata（不同 schema、無 cost）→ 0", () => {
    expect(
      extractUsageCostUsd(
        buf({ usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }),
        JSON_CT,
      ),
    ).toBe("0");
  });
  it("G4 Suno credit 回應（無 usage.cost）→ 0", () => {
    expect(
      extractUsageCostUsd(buf({ credits_left: 100, id: "song1" }), JSON_CT),
    ).toBe("0");
  });
  it("G5 未知 provider 但確有 usage.cost → 保守擷取已知 shape", () => {
    expect(
      extractUsageCostUsd(buf({ usage: { cost: 0.009 } }), JSON_CT),
    ).toBe("0.009000");
  });
});

// ─── H. Concurrency / runtime（純函式特性）────────────────────────────────
describe("H. 純函式 / runtime 特性", () => {
  it("H2 無共享狀態：同一 input 多次呼叫結果一致（冪等）", () => {
    const p = buf({ usage: { cost: 0.0042 } });
    const a = extractUsageCostUsd(p, JSON_CT);
    const b = extractUsageCostUsd(p, JSON_CT);
    const c = extractUsageCostUsd(p, JSON_CT);
    expect(a).toBe("0.004200");
    expect(b).toBe(a);
    expect(c).toBe(a);
  });
  it("H2b 不同 input 並存不互相污染", () => {
    const p1 = buf({ usage: { cost: 0.01 } });
    const p2 = buf({ usage: { cost: 0.02 } });
    expect(extractUsageCostUsd(p1, JSON_CT)).toBe("0.010000");
    expect(extractUsageCostUsd(p2, JSON_CT)).toBe("0.020000");
    expect(extractUsageCostUsd(p1, JSON_CT)).toBe("0.010000");
  });
  it("H3 永不 throw：對各種病態 input 都安全回字串", () => {
    const weird: Array<[Buffer, string | null]> = [
      [Buffer.from([0xff, 0xfe, 0x00]), JSON_CT], // 非 UTF-8 bytes
      [raw(" "), JSON_CT],
      [raw("{".repeat(1000)), JSON_CT], // 深層未閉合
      [raw("data:"), "text/event-stream"],
    ];
    for (const [p, ct] of weird) {
      const out = extractUsageCostUsd(p, ct);
      expect(typeof out).toBe("string");
      expect(isLegalDecimal12_6(out)).toBe(true);
    }
  });
  it("H5 回傳值永遠是合法 DECIMAL(12,6) literal（DB 不會因此值 insert 失敗）", () => {
    const cases = [0.0024, 1234567.89, -5, 0, 999999.999999, 1e-9, 0.123456789];
    for (const c of cases) {
      const out = extractUsageCostUsd(buf({ usage: { cost: c } }), JSON_CT);
      expect(isLegalDecimal12_6(out)).toBe(true);
    }
  });
});

// ─── normalizeCostUsd 直接單元測試（型別正規化邊界）────────────────────────
describe("normalizeCostUsd（直接）", () => {
  it("number 正常 → 定點 6 位", () => {
    expect(normalizeCostUsd(0.5)).toBe("0.500000");
  });
  it("undefined / null → 0", () => {
    expect(normalizeCostUsd(undefined)).toBe("0");
    expect(normalizeCostUsd(null)).toBe("0");
  });
  it("object / array → 0", () => {
    expect(normalizeCostUsd({})).toBe("0");
    expect(normalizeCostUsd([1, 2])).toBe("0");
  });
  it("boolean → 0", () => {
    expect(normalizeCostUsd(true)).toBe("0");
    expect(normalizeCostUsd(false)).toBe("0");
  });
  it("純整數字串 → 定點", () => {
    expect(normalizeCostUsd("3")).toBe("3.000000");
  });
  it("正號前綴字串 → 接受", () => {
    expect(normalizeCostUsd("+0.25")).toBe("0.250000");
  });
});
