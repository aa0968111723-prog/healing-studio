// @vitest-environment jsdom
/**
 * AIDV-899: ProStudio 模型選擇狀態收斂到 useGenerationTask 後的關鍵路徑測試。
 *
 * ProStudio 六個分頁（music/sfx/tts/clone/process/avatar）原本各自維護
 *   const [x, setX] = useState<Union>(initial)
 * 收斂後改為（照 ImageStudio 採用模式）：
 *   const { selectedModelId: raw, setSelectedModelId } =
 *     useGenerationTask({ initialModelId: initial });
 *   const x = (raw ?? initial) as Union;
 *
 * 因 hook 的 initialModelId 型別是 string、頁面用 `as Union` cast，
 * tsc 抓不到 initialModelId 打錯字或與 ?? fallback 不一致的錯誤。
 * 本測試因此「錨定頁面真實原始碼」：直接解析 ProStudio.tsx，
 * 對六個採用點逐一斷言 initialModelId 字面值與 ?? fallback 字面值
 * 相等且等於預期預設模型/引擎/工具，並用真實字面值驅動 hook 驗證初始行為。
 * （hook 本身的完整行為由 client/src/hooks/__tests__/useGenerationTask.test.ts 覆蓋。）
 */
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useGenerationTask } from "../../../../client/src/hooks/useGenerationTask";

// vitest 以 repo root 為 cwd（vitest.config.ts 所在處）
const pageSource = readFileSync(
  resolve(process.cwd(), "client/src/pages/ProStudio.tsx"),
  "utf-8"
);

interface AdoptionSite {
  rawVar: string;
  initialModelId: string;
  fallback: string | null;
}

/** 解析頁面中每個 useGenerationTask 採用點：raw 變數名、initialModelId、?? fallback。 */
function extractAdoptionSites(src: string): AdoptionSite[] {
  const hookRe =
    /selectedModelId:\s*(\w+),\s*setSelectedModelId:\s*\w+,\s*\}\s*=\s*useGenerationTask\(\{\s*initialModelId:\s*"([^"]+)"\s*\}\);/g;
  const sites: AdoptionSite[] = [];
  for (const m of src.matchAll(hookRe)) {
    const [, rawVar, initialModelId] = m;
    const fb = src.match(new RegExp(`\\(${rawVar}\\s*\\?\\?\\s*"([^"]+)"\\)`));
    sites.push({ rawVar, initialModelId, fallback: fb ? fb[1] : null });
  }
  return sites;
}

const sites = extractAdoptionSites(pageSource);

/** 六個分頁的預期預設模型/引擎/工具（與收斂前各分頁 useState 初始值一致）。 */
const expectedTabs: Array<[tab: string, rawVar: string, defaultModel: string]> = [
  ["music", "musicModelRaw", "ace-step"],
  ["sfx", "sfxModelRaw", "stable-audio"],
  ["tts", "engineRaw", "elevenlabs"],
  ["clone", "modeRaw", "qwen"],
  ["process", "toolRaw", "demucs"],
  ["avatar", "modelRaw", "echo"],
];

describe("AIDV-899 ProStudio useGenerationTask 採用點（錨定頁面原始碼）", () => {
  it("頁面恰有 6 個 useGenerationTask 呼叫且全部可被解析", () => {
    const callCount = (pageSource.match(/useGenerationTask\(/g) ?? []).length;
    expect(callCount).toBe(6);
    expect(sites).toHaveLength(6);
  });

  it.each(expectedTabs)(
    "%s 分頁：initialModelId 與 ?? fallback 相等且為預設 %s",
    (_tab, rawVar, defaultModel) => {
      const site = sites.find(s => s.rawVar === rawVar);
      expect(site, `頁面找不到 ${rawVar} 的 useGenerationTask 採用點`).toBeDefined();
      expect(site!.initialModelId).toBe(defaultModel);
      expect(site!.fallback).toBe(defaultModel);
    }
  );

  it("以頁面真實 initialModelId 字面值驅動 hook：初始 selectedModelId 等價原 useState 初始值", () => {
    for (const site of sites) {
      const { result } = renderHook(() =>
        useGenerationTask({ initialModelId: site.initialModelId })
      );
      expect(result.current.selectedModelId).toBe(site.initialModelId);
    }
  });

  it("ProStudio 頁面模組載入正常且維持 default export 與 validatePromptBeforeSubmit", async () => {
    const mod = await import("../../../../client/src/pages/ProStudio");
    expect(typeof mod.default).toBe("function");
    expect(typeof mod.validatePromptBeforeSubmit).toBe("function");
  });
});
