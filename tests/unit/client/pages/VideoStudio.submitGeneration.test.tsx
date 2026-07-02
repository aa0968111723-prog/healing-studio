// @vitest-environment jsdom
/**
 * AIDV-970: VideoStudio 提交骨架收斂到 useSubmitGeneration 後的關鍵路徑測試。
 *
 * VideoStudio 五個分頁（t2v/i2v/v2v/enhance/control）的 23 個 runX 原本各自
 * 重複「setAIState("generating") → mutateAsync → setResult → registerBgTask →
 * toast.success → reportSuccess / reportFailure → setAIState("idle")」骨架，
 * 收斂後改為：
 *   await submitGeneration({ mutate, onResult, taskType, taskLabel, taskPrompt });
 *
 * 本測試「錨定頁面真實原始碼」：直接解析 VideoStudio.tsx，
 *   1) 斷言 23 個 submitGeneration 呼叫點逐一存在且 taskType/taskLabel/taskPrompt
 *      與收斂前 registerBgTask 的實參字面值完全一致（突變即紅）；
 *   2) 斷言頁面不再殘留任何 inline 骨架（setAIState/registerBgTask/
 *      reportSuccess/reportFailure/提交成功 toast 字面值）——防止骨架回流造成雙軌；
 *   3) 斷言 hook 預設成功 toast 字面值 == 收斂前頁面字面值（文案不可變）。
 * （hook 本身的行為順序由 client/src/hooks/__tests__/useSubmitGeneration.test.ts 覆蓋。）
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SUBMIT_SUCCESS_TOAST_DEFAULT } from "../../../../client/src/hooks/useSubmitGeneration";

// vitest 以 repo root 為 cwd（vitest.config.ts 所在處）
const pageSource = readFileSync(
  resolve(process.cwd(), "client/src/pages/VideoStudio.tsx"),
  "utf-8"
);

interface CallSite {
  onResult: string;
  taskType: string;
  taskLabel: string;
  taskPrompt: string | null;
}

/** 解析頁面中每個 submitGeneration 呼叫點的 onResult / taskType / taskLabel / taskPrompt。 */
function extractCallSites(src: string): CallSite[] {
  const re =
    /await submitGeneration\(\{\s*mutate: \(\) =>\s*\w+\.mutateAsync\((?:\{[\s\S]*?\}|[^)]*)\),\s*onResult: (\w+),\s*taskType: "(\w+)",\s*taskLabel: "([^"]+)",(?:\s*taskPrompt: (\w+),)?\s*\}\);/g;
  const sites: CallSite[] = [];
  for (const m of src.matchAll(re)) {
    const [, onResult, taskType, taskLabel, taskPrompt] = m;
    sites.push({ onResult, taskType, taskLabel, taskPrompt: taskPrompt ?? null });
  }
  return sites;
}

const sites = extractCallSites(pageSource);

/**
 * 收斂前 23 個 runX 的 registerBgTask 實參（label → prompt 變數名 / null 表原本就無 prompt）。
 * 任何 label 改字、prompt 綁定變動都會使本表比對失敗。
 */
const expectedCalls: Array<[label: string, prompt: string | null]> = [
  // t2v
  ["Kling 文生影", "klingPrompt"],
  ["Wan 文生影", "wanPrompt"],
  ["MiniMax 文生影", "mmPrompt"],
  ["Veo 3 文生影", "veoPrompt"],
  ["Veo 3 Pro 文生影", "veoPrompt"],
  ["LTX 文生影", "ltxPrompt"],
  ["Sora 文生影", "soraPrompt"],
  // i2v
  ["Kling 圖生影", "klingPrompt"],
  ["Kling Pro 圖生影", "klingPrompt"],
  ["Wan 圖生影", "wanPrompt"],
  ["Runway 圖生影", "runwayPrompt"],
  ["Pixverse 圖生影", "pvPrompt"],
  ["MiniMax 圖生影", "mmPrompt"],
  // v2v
  ["Wan 影生影", "wanPrompt"],
  ["Kling 影生影", "klingPrompt"],
  ["LTX 關鍵幀生成", "ltxPrompt"],
  // enhance（原本就不帶 prompt）
  ["影片超解析度", null],
  ["RIFE v4.6 影片補幀", null],
  ["Topaz 畫質增強", null],
  // control
  ["CamMaster 鏡頭控制", "camPrompt"],
  ["AnimateDiff 動作控制", "adPrompt"],
  ["DepthCrafter 深度感知生成", null],
  ["Vidu Q1 角色一致性生成", "viduPrompt"],
];

describe("AIDV-970 VideoStudio useSubmitGeneration 採用點（錨定頁面原始碼）", () => {
  it("頁面恰有 23 個 submitGeneration 呼叫且全部可被解析", () => {
    const callCount = (pageSource.match(/await submitGeneration\(\{/g) ?? [])
      .length;
    expect(callCount).toBe(23);
    expect(sites).toHaveLength(23);
  });

  it("五個分頁各自透過 useSubmitGeneration() 取得骨架", () => {
    const hookCount = (
      pageSource.match(/const \{ submitGeneration \} = useSubmitGeneration\(\);/g) ??
      []
    ).length;
    expect(hookCount).toBe(5);
  });

  it.each(expectedCalls)(
    "呼叫點「%s」：taskType=video 且 taskPrompt 綁定 %s（與收斂前 registerBgTask 實參一致）",
    (label, prompt) => {
      const matched = sites.filter(s => s.taskLabel === label);
      expect(
        matched.length,
        `頁面找不到 taskLabel="${label}" 的 submitGeneration 呼叫點`
      ).toBeGreaterThan(0);
      for (const site of matched) {
        expect(site.taskType).toBe("video");
        expect(site.taskPrompt).toBe(prompt);
        expect(site.onResult).toMatch(/^set\w+Result$/);
      }
    }
  );

  it("taskLabel 全集 == 收斂前 registerBgTask label 全集（不多不少）", () => {
    const actual = sites.map(s => s.taskLabel).sort();
    const expected = expectedCalls.map(([label]) => label).sort();
    expect(actual).toEqual(expected);
  });

  it("頁面不再殘留 inline 提交骨架（防止雙軌回流）", () => {
    expect(pageSource).not.toContain('setAIState("generating")');
    expect(pageSource).not.toContain('setAIState("idle")');
    expect(pageSource).not.toContain("registerBgTask(");
    expect(pageSource).not.toContain("useRegisterBgTask");
    expect(pageSource).not.toContain("reportSuccess()");
    expect(pageSource).not.toContain("reportFailure()");
    // 提交成功 toast 只能由 hook 發出，頁面不得再硬編碼
    expect(pageSource).not.toContain("任務已提交");
  });

  it("hook 預設成功 toast 字面值與收斂前頁面字面值逐字相同（文案不可變）", () => {
    expect(SUBMIT_SUCCESS_TOAST_DEFAULT).toBe("📤 任務已提交！稍後自動更新結果...");
  });

  it("VideoStudio 頁面模組載入正常且維持 default export", async () => {
    const mod = await import("../../../../client/src/pages/VideoStudio");
    expect(typeof mod.default).toBe("function");
  });
});
