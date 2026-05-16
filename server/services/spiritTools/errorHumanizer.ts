/**
 * spiritTools/errorHumanizer.ts
 *
 * 把工具呼叫(fal / openai / axios / fetch)拋出的英文 / 技術錯誤訊息
 * 翻譯成使用者看得懂的中文,並順手把原始 error 記到 console 給工程師
 * 後續除錯。
 *
 * 原本各精靈工具 catch 區塊都是 `message: 生成失敗:${error.message}`,
 * 直接把「Request failed with status 422」「ECONNRESET」「Unable to
 * validate schema: input.aspect_ratio must be one of [1:1, 16:9...]」
 * 這種底層訊息丟給使用者。對非工程師使用者完全看不懂,也可能洩漏內部
 * endpoint 與 model 名稱。
 *
 * 此 helper 不嘗試枚舉所有錯誤 — 只 mapping 最常見的幾類,其餘走通用
 * 文案。所有原始錯誤都會被 `console.warn` 記下 + 帶 context,方便比對
 * 真實案發現場。
 */

// 順序敏感:先掃 401/403/404/429 等具體碼,再掃通用 400/422,避免「404 Not
// Found」被通用 400 group 搶走。
const HTTP_STATUS_PATTERNS: Array<{ test: RegExp; label: string }> = [
  // 401/403: 認證 / 權限
  {
    test: /status\s*(code\s*)?40[13]|HTTP 40[13]|\b40[13]\b|Unauthorized|Forbidden|API key/i,
    label: "服務認證失敗,請聯絡管理員。",
  },
  // 404: 資源找不到
  {
    test: /status\s*(code\s*)?404|HTTP 404|\b404\b|Not Found/i,
    label: "找不到指定的素材或模型,請確認後再試。",
  },
  // 429 / rate limit / quota
  {
    test: /status\s*(code\s*)?429|HTTP 429|\b429\b|Too Many Requests|rate.?limit|quota|throttle/i,
    label: "服務忙線中或額度已用完,請稍後再試。",
  },
  // 400 / 422 / generic 4xx: 參數 / schema 不符
  {
    test: /status\s*(code\s*)?4\d{2}|HTTP 4\d{2}|\b4\d{2}\b|Bad Request|Unprocessable/i,
    label: "參數設定不符,請調整輸入內容後再試。",
  },
  // 5xx: 服務端錯誤
  {
    test: /status\s*(code\s*)?5\d{2}|HTTP 5\d{2}|\b5\d{2}\b|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout/i,
    label: "外部服務暫時不可用,請稍後再試。",
  },
];

const NETWORK_PATTERNS: Array<{ test: RegExp; label: string }> = [
  {
    test: /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network.?error|fetch failed/i,
    label: "網路連線中斷,請確認網路後再試。",
  },
  {
    test: /timeout|timed out/i,
    label: "請求逾時,服務可能正在繁忙,請稍後再試。",
  },
];

const VALIDATION_PATTERNS: Array<{ test: RegExp; label: string }> = [
  {
    test: /Unable to validate schema|schema validation|invalid input|invalid.+parameter|must be one of/i,
    label: "輸入參數不符規格,請檢查輸入內容後再試。",
  },
  {
    test: /file too large|payload too large|exceeds.+size|size.+exceed/i,
    label: "檔案過大,請壓縮後再試。",
  },
  {
    test: /unsupported.+(format|type|file)/i,
    label: "不支援的檔案格式。",
  },
];

const CONTENT_POLICY_PATTERNS: Array<{ test: RegExp; label: string }> = [
  {
    test: /content.?policy|safety|prohibited|moderation|nsfw|inappropriate/i,
    label: "內容未通過安全檢查,請改寫描述後再試。",
  },
];

const PATTERN_GROUPS = [
  CONTENT_POLICY_PATTERNS, // 優先,避免被「Bad Request」搶走
  NETWORK_PATTERNS,
  VALIDATION_PATTERNS,
  HTTP_STATUS_PATTERNS,
];

/** Fallback when no pattern matches. Generic + actionable. */
const GENERIC_FALLBACK = "工具暫時無法完成請求,請稍後再試。";

export interface HumanizeToolErrorOptions {
  /** 內部 context,只進 console 不出現給使用者。例: "imageSpecialist.generateImage" */
  context?: string;
}

export function humanizeToolError(
  error: unknown,
  options: HumanizeToolErrorOptions = {}
): string {
  const raw = error instanceof Error ? error.message : String(error);
  // 工程師面:永遠記原文 + stack 才查得出來源。
  if (options.context) {
    // eslint-disable-next-line no-console
    console.warn(`[spiritTools:${options.context}]`, error);
  } else {
    // eslint-disable-next-line no-console
    console.warn(`[spiritTools]`, error);
  }
  // 使用者面:依優先級掃 pattern 群組,第一個 hit 就用。
  for (const group of PATTERN_GROUPS) {
    for (const { test, label } of group) {
      if (test.test(raw)) return label;
    }
  }
  return GENERIC_FALLBACK;
}
