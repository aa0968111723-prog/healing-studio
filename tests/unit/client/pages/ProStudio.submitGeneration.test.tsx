// @vitest-environment jsdom
/**
 * AIDV-970: ProStudio 提交骨架收斂到 useSubmitGeneration 後的關鍵路徑測試。
 *
 * ProStudio 六個分頁中 14 個生成 mutation 原本各自重複
 *   onMutate: setAIState("generating") → onSuccess: setResult + registerBgTask
 *   + toast.success + reportSuccess → onError: toast.error(前綴＋message)
 *   + reportFailure → onSettled: setAIState("idle")
 * 收斂後改為：
 *   trpc.proStudio.x.useMutation(generationMutationCallbacks({ onResult,
 *     taskType, taskLabel, taskPrompt, successToast, errorToast }));
 *
 * 【刻意排除·卡上明文】Suno（獨立 taskId/jobId 輪詢、合成 registerBgTask 載荷）
 * 與 AvatarVideoTab 六個 mutation（fal request_id 流程）留在原地——本測試
 * 同時錨定「排除項仍為 inline 骨架」，防止未經評估的偷渡遷移。
 *
 * 本測試「錨定頁面真實原始碼」：解析 ProStudio.tsx 的 14 個採用點，逐一斷言
 * taskType / taskLabel / taskPrompt / successToast / errorToast 前綴與收斂前
 * 字面值完全一致（突變即紅）。
 * （hook 行為順序由 client/src/hooks/__tests__/useSubmitGeneration.test.ts 覆蓋。）
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SUBMIT_SUCCESS_TOAST_DEFAULT,
  SUBMIT_SUCCESS_TOAST_BG_NOTIFY,
} from "../../../../client/src/hooks/useSubmitGeneration";

// vitest 以 repo root 為 cwd（vitest.config.ts 所在處）
const pageSource = readFileSync(
  resolve(process.cwd(), "client/src/pages/ProStudio.tsx"),
  "utf-8"
);

interface CallSite {
  onResultSetter: string;
  taskType: string;
  taskLabel: string;
  taskPrompt: string | null;
  block: string;
  errorPrefix: string;
}

/** 解析頁面中每個 generationMutationCallbacks 採用點。 */
function extractCallSites(src: string): CallSite[] {
  const re =
    /generationMutationCallbacks\(\{\s*onResult: data => (\w+)\(data(?: as AudioResult)?\),\s*taskType: "(\w+)",\s*taskLabel: "([^"]+)",(?:\s*taskPrompt: (\w+),)?([\s\S]*?)errorToast: message => `([^`]*)\$\{message\}`,\s*\}\)/g;
  const sites: CallSite[] = [];
  for (const m of src.matchAll(re)) {
    const [, onResultSetter, taskType, taskLabel, taskPrompt, block, errorPrefix] = m;
    sites.push({
      onResultSetter,
      taskType,
      taskLabel,
      taskPrompt: taskPrompt ?? null,
      block,
      errorPrefix,
    });
  }
  return sites;
}

const sites = extractCallSites(pageSource);

/**
 * 收斂前 14 個 mutation 的實參（label → type / prompt 變數名 / 成功 toast 錨點 /
 * 錯誤 toast 前綴）。任何文案或綁定變動都會使本表比對失敗。
 */
const expectedCalls: Array<
  [label: string, type: string, prompt: string | null, successAnchor: string, errPrefix: string]
> = [
  // music（successToast 為條件式函式：同步拿到音檔顯示完成文案，否則預設提交文案）
  ["🎵 音樂生成", "audio", "prompt", "🎵 音樂生成完成！", "生成失敗："],
  // sfx
  ["🔊 音效生成", "audio", "text", "SUBMIT_SUCCESS_TOAST_BG_NOTIFY", "生成失敗："],
  // tts
  ["🎤 ElevenLabs 語音", "voice", "text", "SUBMIT_SUCCESS_TOAST_BG_NOTIFY", "合成失敗："],
  ["🎤 Qwen 語音", "voice", "text", "SUBMIT_SUCCESS_TOAST_BG_NOTIFY", "合成失敗："],
  // clone
  ["🎭 Qwen 聲音克隆", "voice", "text", "SUBMIT_SUCCESS_TOAST_BG_NOTIFY", "克隆失敗："],
  ["🎭 Dia 聲音克隆", "voice", "text", "SUBMIT_SUCCESS_TOAST_BG_NOTIFY", "克隆失敗："],
  ["🎨 語音設計", "voice", "voiceDesc", "SUBMIT_SUCCESS_TOAST_BG_NOTIFY", "設計失敗："],
  ["✅ Kling 語音建立", "voice", null, "SUBMIT_SUCCESS_TOAST_BG_NOTIFY", "Kling 建立失敗："],
  [
    "✅ ElevenLabs 聲音克隆",
    "voice",
    null,
    "📤 任務已提交！voice_id 完成後可在 TTS 分頁直接使用",
    "ElevenLabs 克隆失敗：",
  ],
  // process
  ["🎸 音幹分離", "audio", null, "SUBMIT_SUCCESS_TOAST_BG_NOTIFY", "失敗："],
  ["🔇 音訊隔離", "audio", null, "SUBMIT_SUCCESS_TOAST_BG_NOTIFY", "失敗："],
  ["🔗 音訊合併", "audio", null, "SUBMIT_SUCCESS_TOAST_BG_NOTIFY", "失敗："],
  ["🔁 聲音變換", "voice", null, "SUBMIT_SUCCESS_TOAST_BG_NOTIFY", "失敗："],
  // asr
  ["📝 語音識別", "audio", null, "SUBMIT_SUCCESS_TOAST_BG_NOTIFY", "失敗："],
];

describe("AIDV-970 ProStudio generationMutationCallbacks 採用點（錨定頁面原始碼）", () => {
  it("頁面恰有 14 個 generationMutationCallbacks 呼叫且全部可被解析", () => {
    const callCount = (pageSource.match(/generationMutationCallbacks\(\{/g) ?? [])
      .length;
    expect(callCount).toBe(14);
    expect(sites).toHaveLength(14);
  });

  it("六個分頁中有 6 個 useSubmitGeneration() 取得點（music＋sfx/tts/clone/process/asr）", () => {
    const hookCount = (
      pageSource.match(
        /const \{ generationMutationCallbacks \} = useSubmitGeneration\(\);/g
      ) ?? []
    ).length;
    expect(hookCount).toBe(6);
  });

  it.each(expectedCalls)(
    "呼叫點「%s」：taskType=%s、taskPrompt=%s、成功/錯誤 toast 與收斂前字面值一致",
    (label, type, prompt, successAnchor, errPrefix) => {
      const site = sites.find(s => s.taskLabel === label);
      expect(site, `頁面找不到 taskLabel="${label}" 的採用點`).toBeDefined();
      expect(site!.taskType).toBe(type);
      expect(site!.taskPrompt).toBe(prompt);
      expect(site!.block).toContain(successAnchor);
      expect(site!.errorPrefix).toBe(errPrefix);
    }
  );

  it("taskLabel 全集 == 收斂前 registerBgTask label 全集（不多不少）", () => {
    const actual = sites.map(s => s.taskLabel).sort();
    const expected = expectedCalls.map(([label]) => label).sort();
    expect(actual).toEqual(expected);
  });

  it("hook 共用 toast 常數與收斂前頁面字面值逐字相同（文案不可變）", () => {
    expect(SUBMIT_SUCCESS_TOAST_DEFAULT).toBe("📤 任務已提交！稍後自動更新結果...");
    expect(SUBMIT_SUCCESS_TOAST_BG_NOTIFY).toBe(
      "📤 任務已提交！背景生成中，完成後會自動通知你"
    );
  });

  it("刻意排除項仍為 inline 骨架：Suno（1）＋ AvatarVideoTab（6）共 7 處", () => {
    const inlineCount = (
      pageSource.match(/onMutate: \(\) => setAIState\("generating"\)/g) ?? []
    ).length;
    expect(inlineCount).toBe(7);
    // Suno：合成 registerBgTask 載荷（taskId → request_id）仍在原地
    expect(pageSource).toContain("generateMusicSuno.useMutation({");
    expect(pageSource).toContain("request_id: data.taskId");
    // AvatarVideoTab：fal request_id 流程 mutation 未被偷渡遷移
    expect(pageSource).toContain('registerBgTask(d, "video", "🎬 Wan 說話人", prompt)');
    expect(pageSource).toContain('registerBgTask(d, "video", "🎬 EchoMimic")');
  });

  it("ProStudio 頁面模組載入正常且維持 default export 與 validatePromptBeforeSubmit", async () => {
    const mod = await import("../../../../client/src/pages/ProStudio");
    expect(typeof mod.default).toBe("function");
    expect(typeof mod.validatePromptBeforeSubmit).toBe("function");
  });
});
