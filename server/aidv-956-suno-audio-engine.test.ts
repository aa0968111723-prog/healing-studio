/**
 * aidv-956-suno-audio-engine.test.ts — AIDV-956
 *
 * 把 Suno V4 接成 audioEngine 可選引擎，premium 分層才能真正用上 Suno。
 *
 * 驗收（對照卡上 4 步）：
 *  1. MusicModelChoice 加入 "suno"
 *  2. audioEngineToMusicChoice() / resolveMusicModelChoice() 認得 suno-v4 / suno
 *  3. textToMusic（含 compiledTextToMusic 與 orb agent tool 呼叫鏈）選到 suno 時
 *     走既有 generateMusicSuno 的非同步＋webhook 流程（submitSunoMusicJob），
 *     並由 checkAudioStatus 橋接輪詢（前端契約零改動）；SUNO_API_KEY 缺失時
 *     失敗安全降級 ace-step（不靜默、有 console.warn）
 *  4. brainContext PREMIUM_GENERATION_ENGINES.audioEngine = "suno-v4"
 *     （premium 斷言見 server/brain-context.test.ts）
 *
 * 純函式部分直接 import 驗證；流程接線部分沿用本 repo 的 source-regex
 * 守衛模式（同 aidv-620 / refundStatus 測試），鎖住關鍵接點防回歸。
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  audioEngineToMusicChoice,
  resolveMusicModelChoice,
  sunoModelVersionFromEngine,
} from "./routers/proStudio";

const PRO_STUDIO = resolve(process.cwd(), "server/routers/proStudio.ts");
const AGENT_TOOL_EXECUTOR = resolve(
  process.cwd(),
  "server/services/agentToolExecutor.ts"
);

describe("AIDV-956: audioEngineToMusicChoice 認得 Suno", () => {
  it('suno-v4 / suno-v3.5 / suno → "suno"（不再靜默 fallback ace-step）', () => {
    expect(audioEngineToMusicChoice("suno-v4")).toBe("suno");
    expect(audioEngineToMusicChoice("suno-v3.5")).toBe("suno");
    expect(audioEngineToMusicChoice("suno")).toBe("suno");
    expect(audioEngineToMusicChoice("Suno-V4")).toBe("suno");
  });

  it("既有 4 個 fal 引擎映射不變（加性、預設不破既有行為）", () => {
    expect(audioEngineToMusicChoice("fal-ai/sonauto")).toBe("sonauto");
    expect(audioEngineToMusicChoice("fal-ai/stable-audio")).toBe("stable-audio");
    expect(audioEngineToMusicChoice("fal-ai/musicgen")).toBe("musicgen");
    expect(audioEngineToMusicChoice("fal-ai/ace-step")).toBe("ace-step");
    // sonauto 不含 "suno" 子字串 — 不會被誤判成 suno
    expect(audioEngineToMusicChoice("sonauto/v2/text-to-music")).toBe("sonauto");
  });

  it("未知引擎仍安全退回 ace-step", () => {
    expect(audioEngineToMusicChoice("gemini/lyria-2")).toBe("ace-step");
    expect(audioEngineToMusicChoice("")).toBe("ace-step");
  });
});

describe("AIDV-956: resolveMusicModelChoice（DEF-15 大腦接通）認得 Suno", () => {
  it('大腦 audioEngine=suno-v4（premium 分層預設）→ "suno"', () => {
    expect(resolveMusicModelChoice(undefined, "suno-v4")).toBe("suno");
    expect(resolveMusicModelChoice(undefined, "suno-v3.5")).toBe("suno");
    expect(resolveMusicModelChoice(undefined, "suno")).toBe("suno");
  });

  it("使用者顯式選擇優先於大腦組態", () => {
    expect(resolveMusicModelChoice("musicgen", "suno-v4")).toBe("musicgen");
    expect(resolveMusicModelChoice("suno", "fal-ai/ace-step")).toBe("suno");
  });

  it("既有 fal 引擎與未知值行為不變（最終安全預設 ace-step）", () => {
    expect(resolveMusicModelChoice(undefined, "fal-ai/sonauto")).toBe("sonauto");
    expect(resolveMusicModelChoice(undefined, "fal-ai/stable-audio")).toBe(
      "stable-audio"
    );
    expect(resolveMusicModelChoice(undefined, "gemini/lyria-2")).toBe("ace-step");
    expect(resolveMusicModelChoice(undefined, undefined)).toBe("ace-step");
  });
});

describe("AIDV-956: sunoModelVersionFromEngine 版本推導", () => {
  it("suno-v3.5（含 3_5 拼法）→ v3.5；其餘 → v4（對齊 AIDV-856 規格表）", () => {
    expect(sunoModelVersionFromEngine("suno-v3.5")).toBe("v3.5");
    expect(sunoModelVersionFromEngine("suno_v3_5")).toBe("v3.5");
    expect(sunoModelVersionFromEngine("suno-v4")).toBe("v4");
    expect(sunoModelVersionFromEngine("suno")).toBe("v4");
    expect(sunoModelVersionFromEngine(undefined)).toBe("v4");
  });
});

describe("AIDV-956: textToMusic / compiledTextToMusic 的 Suno 非同步接線（source 守衛）", () => {
  const src = readFileSync(PRO_STUDIO, "utf8");

  it('MusicModelChoice union 含 "suno"，兩個 mutation 的 model enum 也含 "suno"', () => {
    expect(src).toMatch(
      /type MusicModelChoice =[\s\S]{0,200}\| "suno";/
    );
    const enumCount = (
      src.match(
        /z\s*\.enum\(\["sonauto", "ace-step", "stable-audio", "musicgen", "suno"\]\)/g
      ) ?? []
    ).length;
    expect(
      enumCount,
      "textToMusic 與 compiledTextToMusic 的 model enum 都應含 suno"
    ).toBe(2);
  });

  it("選到 suno 時走共用 submitSunoMusicJob（generateMusicSuno 同款非同步＋webhook 流程）", () => {
    // helper 存在且帶 webhook callBackUrl 組裝
    const helperStart = src.indexOf("async function submitSunoMusicJob");
    expect(helperStart).toBeGreaterThanOrEqual(0);
    const helper = src.slice(
      helperStart,
      src.indexOf("checkSunoAudioStatusBridge", helperStart)
    );
    expect(helper).toContain("/api/webhook/suno?jobId=");
    expect(helper).toContain('signWebhookToken("suno", jobId)');
    expect(helper).toContain("await suno.generateMusic(");
    // 三個呼叫端：generateMusicSuno + textToMusic + compiledTextToMusic
    const callers = (src.match(/await submitSunoMusicJob\(/g) ?? []).length;
    expect(callers).toBe(3);
    // textToMusic / compiledTextToMusic 回傳 checkAudioStatus 可解析的
    // request_id（"suno:<jobId>:<taskId>"），維持既有輪詢契約（前端零改動）
    const bridgedIds = (
      src.match(/request_id: `suno:\$\{jobId \?\? 0\}:\$\{taskId\}`/g) ?? []
    ).length;
    expect(bridgedIds).toBe(2);
  });

  it("checkAudioStatus 對 suno 任務走 Suno 輪詢橋接（不打 fal queue）", () => {
    expect(src).toContain('input.requestId.startsWith("suno:")');
    expect(src).toContain(
      "checkSunoAudioStatusBridge(ctx.user.id, input.requestId)"
    );
    // 橋接完成/失敗行為：回寫 backgroundJob + runPostGenForJob（冪等）＋
    // 失敗走 refundJobIfBilled（claim-based，與 webhookSuno 不雙退）
    const bridgeStart = src.indexOf("async function checkSunoAudioStatusBridge");
    expect(bridgeStart).toBeGreaterThanOrEqual(0);
    const bridge = src.slice(bridgeStart, src.indexOf("// ─── Router", bridgeStart));
    expect(bridge).toContain("runPostGenForJob(jobId)");
    expect(bridge).toContain("refundJobIfBilled(jobId)");
    // 越權防護：jobId 屬他人時不得洩露狀態
    expect(bridge).toContain("job.userId !== userId");
  });

  it("大腦選 suno 但 SUNO_API_KEY 缺失 → 失敗安全降級 ace-step（非靜默：有 warn；顯式選 suno 則誠實報錯）", () => {
    const degradeWarns = (
      src.match(/SUNO_API_KEY 未設定，(textToMusic|compiledTextToMusic) 降級 ace-step/g) ??
      []
    ).length;
    expect(degradeWarns).toBe(2);
    // 顯式 input.model === "suno" 時維持 PRECONDITION_FAILED 誠實報錯
    expect(src).toContain('if (input.model === "suno")');
  });
});

describe("AIDV-956: orb agent tool 呼叫鏈（studio.generateAudio）接通大腦 Suno（source 守衛）", () => {
  const src = readFileSync(AGENT_TOOL_EXECUTOR, "utf8");

  it("brain audioEngine 解析必須先於 Suno 判斷（premium suno-v4 才會真的走 Suno 分支）", () => {
    const caseStart = src.indexOf('case "studio.generateAudio":');
    const caseEnd = src.indexOf('case "studio.generateSfx":', caseStart);
    expect(caseStart).toBeGreaterThanOrEqual(0);
    const region = src.slice(caseStart, caseEnd);
    const idxBrain = region.indexOf("buildBrainContext");
    const idxSunoCheck = region.indexOf(
      'modelId.toLowerCase().startsWith("suno")'
    );
    expect(idxBrain, "應有大腦 audioEngine 解析").toBeGreaterThanOrEqual(0);
    expect(
      idxSunoCheck,
      "Suno 判斷應以解析後的 modelId 為準"
    ).toBeGreaterThan(idxBrain);
    // 缺金鑰時：顯式指定 → 誠實報錯；大腦組態 → 降級 fal-ai/ace-step
    expect(region).toContain('error: "SUNO_API_KEY 未設定"');
    expect(region).toContain("降級 fal-ai/ace-step");
    // 版本推導：suno-v4 → V4（modelVersion 傳入 SunoClient）
    expect(region).toContain("modelVersion: sunoVersion");
  });
});
