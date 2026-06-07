// ============================================================================
// tests/composeLayout.test.ts — composeLayout 確定性 / 安全 / 對比 驗收
// ----------------------------------------------------------------------------
// 證明 /social 唯一新增生成原語的關鍵性質（設計 §3.1）：
//   1) 確定性：相同輸入 → 逐字元相同 SVG + 相同 contentHash（不同 seed → 不同）。
//   2) 中文/XSS 安全：插槽文字經 escapeXml 逃逸，不破壞 SVG、不注入標籤。
//   3) 多尺寸：每個 preset 產生合法寬高、orientation 與寬高一致。
//   4) 對比：低對比輸入會吐 low_contrast 警告（不阻斷輸出）。
// 放 client/src/__tests__/，以 vitest 跑（與 P0 route-parity 同 runner）。
// ============================================================================
import { describe, it, expect } from "vitest";
import { composeLayout, escapeXml, wrapText, fnv1a } from "@/social/composeLayout";
import { SIZE_PRESETS, getPreset, presetOrientationConsistent } from "@/social/sizePresets";
import { DEFAULT_BRAND_KIT, type BrandKit } from "@/social/brandKit";

const baseReq = (over: Partial<Parameters<typeof composeLayout>[0]> = {}) => ({
  brandKit: DEFAULT_BRAND_KIT,
  slots: { headline: "放下，即是自在。", subhead: "本週開示", cta: "閱讀更多", badge: "溫暖療癒" },
  preset: getPreset("ig_square")!,
  seed: 7,
  ...over,
});

describe("composeLayout · 確定性", () => {
  it("相同輸入 → 逐字元相同 SVG 與 contentHash", () => {
    const a = composeLayout(baseReq());
    const b = composeLayout(baseReq());
    expect(a.svg).toBe(b.svg);
    expect(a.contentHash).toBe(b.contentHash);
  });

  it("不同 seed → 不同輸出（漸層角度確定性變化）", () => {
    const a = composeLayout(baseReq({ seed: 1 }));
    const b = composeLayout(baseReq({ seed: 2 }));
    expect(a.contentHash).not.toBe(b.contentHash);
  });

  it("不含任何非確定性來源（不依賴 Date/Math.random）：兩次連續呼叫穩定", () => {
    const runs = Array.from({ length: 5 }).map(() => composeLayout(baseReq()).svg);
    expect(new Set(runs).size).toBe(1);
  });

  it("fnv1a 為穩定雜湊", () => {
    expect(fnv1a("放下")).toBe(fnv1a("放下"));
    expect(fnv1a("放下")).not.toBe(fnv1a("自在"));
  });
});

describe("composeLayout · 中文/XSS 安全", () => {
  it("escapeXml 逃逸特殊字元", () => {
    expect(escapeXml(`<script>&"'`)).toBe("&lt;script&gt;&amp;&quot;&apos;");
  });

  it("惡意插槽不會把標籤注入 SVG", () => {
    const { svg } = composeLayout(baseReq({ slots: { headline: `</text><script>alert(1)</script>` } }));
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });

  it("輸出為合法 SVG 根標籤", () => {
    const { svg } = composeLayout(baseReq());
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.trim().endsWith("</svg>")).toBe(true);
  });
});

describe("composeLayout · 換行", () => {
  it("中文長句依寬度斷成多行", () => {
    const lines = wrapText("放下即是自在這是一句很長的測試金句需要換行", 6);
    expect(lines.length).toBeGreaterThan(1);
    lines.forEach((l) => expect(l.length).toBeGreaterThan(0));
  });
});

describe("composeLayout · 多尺寸", () => {
  it("每個 preset 都產生合法寬高與 orientation 一致", () => {
    for (const preset of SIZE_PRESETS) {
      const { width, height } = composeLayout(baseReq({ preset }));
      expect(width).toBe(preset.width);
      expect(height).toBe(preset.height);
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
      expect(presetOrientationConsistent(preset)).toBe(true);
    }
  });
});

describe("composeLayout · 對比警告", () => {
  it("低對比品牌（深字＋深底）吐 low_contrast", () => {
    const darkOnDark: BrandKit = {
      ...DEFAULT_BRAND_KIT,
      palette: [
        { role: "primary", hex: "#101010" },
        { role: "secondary", hex: "#1a1a1a" },
        { role: "accent", hex: "#222222" },
        { role: "neutral", hex: "#0a0a0a" },
      ],
    };
    const { warnings } = composeLayout(baseReq({ brandKit: darkOnDark }));
    expect(warnings).toContain("low_contrast");
  });

  it("高對比品牌（淺字＋深底）無 low_contrast", () => {
    const { warnings } = composeLayout(baseReq());
    expect(warnings).not.toContain("low_contrast");
  });
});
