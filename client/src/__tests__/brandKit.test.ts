// ============================================================================
// tests/brandKit.test.ts — 品牌鎖定狀態機 / 閘門 / Tier-0 block_combos round-trip
// ----------------------------------------------------------------------------
// 驗收設計 §2（brand-lock）與 §5.1（Tier-0 零新表）：
//   - 閘門旗標（missing_*/low_contrast）與 canBatch 判定。
//   - 狀態機 draft→defined→locked；unlock → version++（觸發下游 stale）。
//   - WCAG 對比計算正確（黑白＝21、同色＝1）。
//   - BrandKit ⇄ block_combos 序列化可 round-trip（real→blockCombos.* 接線時行為不變）。
// ============================================================================
import { describe, it, expect } from "vitest";
import {
  DEFAULT_BRAND_KIT, evaluateBrandGate, canLock, lockBrand, unlockBrand,
  contrastRatio, meetsAA, brandKitToBlockCombo, blockComboToBrandKit, isBrandCombo,
  type BrandKit,
} from "@/social/brandKit";

describe("brandKit · 閘門", () => {
  it("完整品牌 → ready，可鎖", () => {
    const gate = evaluateBrandGate(DEFAULT_BRAND_KIT);
    expect(gate.state).toBe("ready");
    expect(canLock(DEFAULT_BRAND_KIT)).toBe(true);
  });

  it("缺 logo → blocked，不可鎖", () => {
    const noLogo: BrandKit = { ...DEFAULT_BRAND_KIT, logoRefs: {} };
    const gate = evaluateBrandGate(noLogo);
    expect(gate.flags).toContain("missing_logo");
    expect(gate.state).toBe("blocked");
    expect(canLock(noLogo)).toBe(false);
  });

  it("色票不足 → missing_palette", () => {
    const onePalette: BrandKit = { ...DEFAULT_BRAND_KIT, palette: [{ role: "primary", hex: "#04122B" }] };
    expect(evaluateBrandGate(onePalette).flags).toContain("missing_palette");
  });

  it("canBatch 只有在 locked 且 ready 時為真", () => {
    expect(evaluateBrandGate(DEFAULT_BRAND_KIT).canBatch).toBe(false); // defined
    expect(evaluateBrandGate(lockBrand(DEFAULT_BRAND_KIT)).canBatch).toBe(true);
  });
});

describe("brandKit · 狀態機", () => {
  it("lock：defined → locked（version 不變）", () => {
    const locked = lockBrand(DEFAULT_BRAND_KIT);
    expect(locked.lockState).toBe("locked");
    expect(locked.version).toBe(DEFAULT_BRAND_KIT.version);
  });

  it("unlock：locked → defined 且 version++（觸發下游 stale）", () => {
    const locked = lockBrand(DEFAULT_BRAND_KIT);
    const unlocked = unlockBrand(locked);
    expect(unlocked.lockState).toBe("defined");
    expect(unlocked.version).toBe(locked.version + 1);
  });

  it("blocked 品牌 lock 為 no-op", () => {
    const noLogo: BrandKit = { ...DEFAULT_BRAND_KIT, logoRefs: {} };
    expect(lockBrand(noLogo).lockState).toBe(noLogo.lockState);
  });
});

describe("brandKit · WCAG 對比", () => {
  it("黑白對比 = 21", () => {
    expect(Math.round(contrastRatio("#000000", "#FFFFFF"))).toBe(21);
  });
  it("同色對比 = 1", () => {
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
  });
  it("meetsAA 門檻（一般 4.5 / 大字 3.0）", () => {
    expect(meetsAA(4.5)).toBe(true);
    expect(meetsAA(4.49)).toBe(false);
    expect(meetsAA(3.0, true)).toBe(true);
  });
  it("非法 hex → 0（視同最差）", () => {
    expect(contrastRatio("nope", "#fff")).toBe(0);
  });
});

describe("brandKit · Tier-0 block_combos round-trip", () => {
  it("BrandKit → block_combos → BrandKit 還原一致", () => {
    const pb = brandKitToBlockCombo(DEFAULT_BRAND_KIT);
    expect(isBrandCombo(pb)).toBe(true);
    const back = blockComboToBrandKit(pb);
    expect(back).toEqual(DEFAULT_BRAND_KIT);
  });

  it("非品牌 combo → null（風格庫項目被略過，不誤判為品牌）", () => {
    const styleCombo = { id: "c1", label: "青金漸層", text: "navy gold", kind: "combo" as const, uses: 3 };
    expect(blockComboToBrandKit(styleCombo)).toBeNull();
    expect(isBrandCombo(styleCombo)).toBe(false);
  });

  it("壞 JSON → null（不丟例外）", () => {
    const broken = { id: "x", label: "@brand-kit:v1 壞", text: "{not json", kind: "combo" as const, uses: 1 };
    expect(blockComboToBrandKit(broken)).toBeNull();
  });
});
