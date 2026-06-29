import { describe, it, expect } from "vitest";
import {
  clampOutputSpecToPlan,
  outputSpecForGeneration,
  isSameOutputSpec,
  OUTPUT_SPEC_DEFAULT,
  type OutputSpecValue,
} from "./OutputSpecSelector";

/**
 * AIDV-255：clampOutputSpecToPlan 是「使用者方案 → 安全輸出規格」的單一真實來源，
 * VideoStudio（生成入口）與 VideoProjectCreateDialog（建專案）共用它把選擇收斂成
 * 實際送往後端的值。這條測試守住端到端鏈路「UI 選擇 → 真正送出的 outputSpec」的客端段：
 * 非付費選 4K 必被退回 1080p（對齊後端 fail-closed 守門），其餘維度原樣保留。
 */
describe("clampOutputSpecToPlan（AIDV-255 方案守門單一真實來源）", () => {
  const spec4K: OutputSpecValue = { resolution: "4K", fps: 60, codec: "h265" };

  it("非付費方案選 4K → 退回 1080p，fps/codec 原樣保留", () => {
    expect(clampOutputSpecToPlan(spec4K, false)).toEqual({
      resolution: "1080p",
      fps: 60,
      codec: "h265",
    });
  });

  it("付費方案選 4K → 原樣放行（4K 保留）", () => {
    expect(clampOutputSpecToPlan(spec4K, true)).toEqual(spec4K);
  });

  it("非付費但非 4K（720p/1080p）→ 完全不變（不誤降級）", () => {
    const s720: OutputSpecValue = { resolution: "720p", fps: 24, codec: "h264" };
    expect(clampOutputSpecToPlan(s720, false)).toEqual(s720);
    expect(clampOutputSpecToPlan(OUTPUT_SPEC_DEFAULT, false)).toEqual(OUTPUT_SPEC_DEFAULT);
  });

  it("預設值（1080p/30/h264）對任何方案皆原樣 → 對齊後端零行為變化路徑", () => {
    expect(clampOutputSpecToPlan(OUTPUT_SPEC_DEFAULT, false)).toEqual(OUTPUT_SPEC_DEFAULT);
    expect(clampOutputSpecToPlan(OUTPUT_SPEC_DEFAULT, true)).toEqual(OUTPUT_SPEC_DEFAULT);
  });

  it("不變更輸入物件（純函式，回傳新物件或原參照皆不可 mutate 輸入）", () => {
    const input: OutputSpecValue = { resolution: "4K", fps: 30, codec: "h264" };
    const snapshot = { ...input };
    clampOutputSpecToPlan(input, false);
    expect(input).toEqual(snapshot);
  });
});

describe("outputSpecForGeneration（AIDV-255 生成路徑零行為變化守門）", () => {
  it("等於預設（1080p/30/h264）→ 回 undefined（讓後端走零變化、不對 Veo3 注入 resolution）", () => {
    expect(outputSpecForGeneration(OUTPUT_SPEC_DEFAULT, false)).toBeUndefined();
    expect(outputSpecForGeneration(OUTPUT_SPEC_DEFAULT, true)).toBeUndefined();
  });

  it("非付費選 4K → 守門退回 1080p，恰等於預設 → 回 undefined（不送、不觸發守門）", () => {
    const s: OutputSpecValue = { resolution: "4K", fps: 30, codec: "h264" };
    expect(outputSpecForGeneration(s, false)).toBeUndefined();
  });

  it("使用者真正改成 720p → 帶上規格（resolution=720p）", () => {
    const s: OutputSpecValue = { resolution: "720p", fps: 30, codec: "h264" };
    expect(outputSpecForGeneration(s, false)).toEqual(s);
  });

  it("付費選 4K → 帶上 4K（交由後端守門放行）", () => {
    const s: OutputSpecValue = { resolution: "4K", fps: 30, codec: "h264" };
    expect(outputSpecForGeneration(s, true)).toEqual(s);
  });

  it("僅改 fps（非預設）→ 帶上規格（即使解析度仍為預設）", () => {
    const s: OutputSpecValue = { resolution: "1080p", fps: 60, codec: "h264" };
    expect(outputSpecForGeneration(s, true)).toEqual(s);
  });
});

describe("isSameOutputSpec", () => {
  it("三欄全同 → true；任一不同 → false", () => {
    const a: OutputSpecValue = { resolution: "1080p", fps: 30, codec: "h264" };
    expect(isSameOutputSpec(a, { ...a })).toBe(true);
    expect(isSameOutputSpec(a, { ...a, resolution: "720p" })).toBe(false);
    expect(isSameOutputSpec(a, { ...a, fps: 24 })).toBe(false);
    expect(isSameOutputSpec(a, { ...a, codec: "vp9" })).toBe(false);
  });
});
