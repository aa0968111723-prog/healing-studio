/**
 * usageCost.ts — AIDV-14 真實 USD 成本擷取
 * ──────────────────────────────────────────────────────────────────────────
 * 純函式：從「已完整緩衝」的上游回應 body 解析 OpenRouter 風格的
 * `usage.cost`（USD-pegged credits，1 credit = 1 USD），轉成可安全寫入
 * `aiUsageEvents.costUsd`（MySQL DECIMAL(12,6)）的字串。
 *
 * 契約（每個輸入都必須成立）：
 *   1. 一律回傳 string，永不 throw、永不回 null/undefined。
 *   2. 回傳值必為合法的 DECIMAL(12,6) literal：有限、定點（無科學記號 e）、
 *      最多 6 位小數、0 ≤ value ≤ 999999.999999。fallback 一律為 "0"。
 *   3. 成本 ≠ token 估算：只有 body 明確帶有 cost 欄位時才回非零值；
 *      只有 token 數（無 cost）→ "0"（token 計價交給 modelPricing.ts）。
 *   4. 非 LLM / 二進位 / 非 JSON / 錯誤 body → "0"，且不會對無法承載 usage 的
 *      bytes 嘗試 JSON.parse。
 *   5. 串流（SSE）政策明確且可測：掃描最後一個帶 usage 的 data 區塊；
 *      無法解析則 "0"，永不因此 throw。
 *
 * 此函式在 aiProxy.ts 的 setImmediate（res.send 之後、請求熱路徑之外）被呼叫，
 * 因此它本身擁有 try/catch 並在任何不確定時回 "0"。
 */

/** DECIMAL(12,6) 上限：6 位整數 + 6 位小數。 */
const MAX_DECIMAL_12_6 = 999999.999999;
/** scale = 6。 */
const SCALE = 6;
/** 避免對病態巨大 body 做昂貴 parse 的硬上限（bytes）。 */
const MAX_PARSE_BYTES = 8 * 1024 * 1024; // 8 MiB

/**
 * 把任意候選值正規化成合法的 DECIMAL(12,6) 定點字串，否則回 "0"。
 * - 數字：直接驗證。
 * - 字串：必須是「純數字」字串（不接受千分位、單位、空白等），否則 "0"。
 * - 其餘型別（boolean/array/object/null/undefined）：一律 "0"。
 * - 負值（退款 / 供應商 bug）：clamp 成 "0"（usage 事件不記負成本）。
 * - NaN / Infinity：→ "0"。
 * - 溢位（> 999999.999999）：clamp 成上限，永不讓非法值進到 insert。
 * - 科學記號 / 過長小數：以 toFixed(6) 正規化成定點、四捨五入到 6 位。
 */
export function normalizeCostUsd(value: unknown): string {
  let n: number;

  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string") {
    const s = value.trim();
    // 只接受純十進位數字字串（可帶正負號與小數點，可帶科學記號）。
    // 拒絕千分位 "1,234.56"、單位 "free"、空字串等。
    if (s.length === 0 || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) {
      return "0";
    }
    n = Number(s);
  } else {
    return "0";
  }

  if (!Number.isFinite(n)) return "0";
  // 負值（含 -0）clamp 成 0。
  if (n <= 0) return "0";
  // 溢位 clamp 成上限。
  if (n > MAX_DECIMAL_12_6) n = MAX_DECIMAL_12_6;

  // toFixed(6) 強制定點（消除科學記號）、四捨五入到 scale-6。
  const fixed = n.toFixed(SCALE);
  // 若捨入後實為零（例如 1e-7 在 scale-6 下），回標準 "0"。
  if (Number(fixed) === 0) return "0";
  return fixed;
}

/**
 * 從一個已解析的 usage 物件取出 cost 候選值。
 * 已知路徑（依研究優先序）：
 *   - usage.cost            ← 主要：OpenRouter 每次請求的 USD-pegged 計費
 *   - usage.total_cost      ← 同義別名（部分 shape）
 * 刻意「不」取 usage.cost_details.upstream_inference_cost（那是 BYOK 上游成本，
 * 非標準請求的我方計費）。未知 shape → null。
 */
function extractCostFromUsage(usage: unknown): unknown | null {
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  if (u.cost !== undefined && u.cost !== null) return u.cost;
  if (u.total_cost !== undefined && u.total_cost !== null) return u.total_cost;
  return null;
}

/**
 * 從一個已解析的 JSON 物件取出 cost 候選值。
 * 支援頂層 `usage`（非串流）。陣列 / 原始型別 → null。
 */
function extractCostFromJson(obj: unknown): unknown | null {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const root = obj as Record<string, unknown>;
  return extractCostFromUsage(root.usage);
}

/**
 * 串流（SSE）path：掃描所有 `data:` frame，從最後一個帶有 usage.cost 的
 * frame 取值（OpenRouter 串流只在最後一個 SSE message 帶 usage）。
 * 任何 frame 解析失敗就略過該 frame，永不 throw。
 */
function extractCostFromSse(text: string): unknown | null {
  let found: unknown | null = null;
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data.length === 0 || data === "[DONE]") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      continue; // 略過無法解析的 frame
    }
    const candidate = extractCostFromJson(parsed);
    if (candidate !== null) found = candidate; // 取「最後一個」帶 usage 的 frame
  }
  return found;
}

/**
 * 解讀 content-type：
 *   - binary: 明確二進位 / 影音 / 圖片，不可能帶 usage → 直接短路 "0"。
 *   - sse:    明確 text/event-stream → 走串流 path。
 *   - json:   其餘（含 null）→ 嘗試 JSON path（仍以 body 嗅探把關）。
 * 注意：content-type 為 null 時「不」強制 SSE，僅留待 body 嗅探判斷。
 */
function classifyContentType(contentType: string | null): {
  json: boolean;
  sse: boolean;
  binary: boolean;
} {
  if (!contentType) return { json: true, sse: false, binary: false };
  const ct = contentType.toLowerCase();
  const sse = ct.includes("text/event-stream");
  const binary =
    ct.includes("image/") ||
    ct.includes("audio/") ||
    ct.includes("video/") ||
    ct.includes("application/octet-stream") ||
    ct.includes("application/pdf") ||
    ct.includes("multipart/");
  const json = !binary && !sse;
  return { json, sse, binary };
}

/** body bytes 是否「看起來」像 JSON（首個非空白字元為 { 或 [）。 */
function looksLikeJson(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith("{") || t.startsWith("[");
}

/** body bytes 是否「看起來」像 SSE（含 data: frame）。 */
function looksLikeSse(text: string): boolean {
  return /(^|\n)\s*data:/.test(text);
}

/**
 * 主要 export：從已緩衝的回應 payload 擷取真實 USD 成本字串。
 *
 * 安全 fallback chain（研究 §4 主路徑；不修改 outbound request）：
 *   1. 非串流 JSON body → 讀 `usage.cost`（或 `usage.total_cost`）。
 *   2. 串流 SSE body    → 讀最後一個帶 usage 的 data frame 的 `usage.cost`。
 *   3. 缺 cost / 解析失敗 / 非 LLM / 二進位 / 錯誤 body → "0"。
 *
 * 永不 throw；永遠回合法的 DECIMAL(12,6) literal 或 "0"。
 */
export function extractUsageCostUsd(
  payload: Buffer,
  contentType: string | null,
): string {
  try {
    if (!payload || payload.length === 0) return "0";
    if (payload.length > MAX_PARSE_BYTES) return "0";

    const { sse: ctSse, binary: ctBinary } = classifyContentType(contentType);
    if (ctBinary) return "0"; // 明確二進位 → 不嘗試 parse

    const text = payload.toString("utf8");

    // 串流：content-type 明確標 SSE，或 body 嗅探像 SSE 但不像 JSON。
    if (ctSse || (looksLikeSse(text) && !looksLikeJson(text))) {
      const candidate = extractCostFromSse(text);
      return normalizeCostUsd(candidate);
    }

    // 非串流 JSON：body 必須看起來像 JSON 才嘗試 parse。
    if (!looksLikeJson(text)) {
      // content-type 為 null 但 body 像 SSE 的最後保險。
      if (looksLikeSse(text)) return normalizeCostUsd(extractCostFromSse(text));
      return "0";
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return "0";
    }
    const candidate = extractCostFromJson(parsed);
    return normalizeCostUsd(candidate);
  } catch {
    // 任何意外（OOM 等）→ 安全 fallback。
    return "0";
  }
}
