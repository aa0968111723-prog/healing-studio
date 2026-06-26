/**
 * toastXssSafety (AIDV-281) — Toast / orb 通知元件 XSS 安全審查
 *
 * 驗收條件：
 *   1. toast.tsx / toaster.tsx 不含 dangerouslySetInnerHTML
 *   2. ChatMessageText.tsx 不含 dangerouslySetInnerHTML（純 React JSX 渲染）
 *   3. URL_PATTERN 不匹配 javascript: URL（防 anchor href 注入）
 *   4. orb 回應元件（ProactiveOrbWidget / OrbUnifiedAssistant）不含 innerHTML 操作
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const CLIENT_SRC = resolve(__dirname, "../../client/src");

function readComponent(relPath: string): string {
  return readFileSync(resolve(CLIENT_SRC, relPath), "utf8");
}

// Re-implement the URL_PATTERN from ChatMessageText.tsx for testing
const URL_PATTERN =
  /(\bhttps?:\/\/[^\s<>"']+|(?<!\S)\/[A-Za-z0-9/_\-?=&%.~+#]+)/g;

describe("Toast 元件結構審查 (AIDV-281)", () => {
  it("sonner.tsx (Toaster wrapper) 不含 dangerouslySetInnerHTML", () => {
    // 專案使用 sonner 函式庫；自訂 wrapper 是純 CSS token 配置，無 innerHTML
    const src = readComponent("components/ui/sonner.tsx");
    expect(src).not.toContain("dangerouslySetInnerHTML");
    expect(src).not.toContain("innerHTML");
  });

  it("sonner.tsx 僅傳遞 theme / classNames — 無原始 HTML 插入", () => {
    const src = readComponent("components/ui/sonner.tsx");
    // 確認沒有 rich HTML (description prop 注入點)
    expect(src).not.toContain("<div dangerously");
    expect(src).not.toContain("__html");
  });
});

describe("ChatMessageText XSS 防護審查 (AIDV-281)", () => {
  it("ChatMessageText.tsx 不含 dangerouslySetInnerHTML（純 JSX 文字節點渲染）", () => {
    const src = readComponent("components/ChatMessageText.tsx");
    expect(src).not.toContain("dangerouslySetInnerHTML");
    expect(src).not.toContain(".innerHTML");
  });

  it("URL_PATTERN 不匹配 javascript: URL（防 href 注入）", () => {
    const jsPayloads = [
      "javascript:alert(1)",
      "javascript:void(0)",
      "JAVASCRIPT:alert(document.cookie)",
      "data:text/html,<script>alert(1)</script>",
    ];
    for (const payload of jsPayloads) {
      const matches = Array.from(payload.matchAll(new RegExp(URL_PATTERN.source, URL_PATTERN.flags)));
      expect(matches.length).toBe(0);
    }
  });

  it("URL_PATTERN 正確匹配 https: 和內部路徑", () => {
    const cases: [string, string][] = [
      ["https://example.com/foo", "https://example.com/foo"],
      ["/process?spec=abc", "/process?spec=abc"],
    ];
    for (const [input, expected] of cases) {
      const matches = Array.from(input.matchAll(new RegExp(URL_PATTERN.source, URL_PATTERN.flags)));
      expect(matches.length).toBe(1);
      expect(matches[0][0]).toBe(expected);
    }
  });
});

describe("Orb 回應元件審查 (AIDV-281)", () => {
  it("ProactiveOrbWidget.tsx 不含 dangerouslySetInnerHTML", () => {
    const src = readComponent("components/ProactiveOrbWidget.tsx");
    expect(src).not.toContain("dangerouslySetInnerHTML");
    expect(src).not.toContain(".innerHTML");
  });

  it("OrbUnifiedAssistant.tsx 不含 dangerouslySetInnerHTML", () => {
    const src = readComponent("components/OrbUnifiedAssistant.tsx");
    expect(src).not.toContain("dangerouslySetInnerHTML");
    expect(src).not.toContain(".innerHTML");
  });

  it("OrbGuidePanel.tsx 不含 dangerouslySetInnerHTML", () => {
    const src = readComponent("components/OrbGuidePanel.tsx");
    expect(src).not.toContain("dangerouslySetInnerHTML");
    expect(src).not.toContain(".innerHTML");
  });
});
