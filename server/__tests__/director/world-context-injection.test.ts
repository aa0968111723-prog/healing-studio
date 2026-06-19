/**
 * world-context-injection.test.ts — AIDV-152
 *
 * Director chat 自動載入 worldFramework 並注入 system prompt 的測試。
 *
 * 兩個 seam：
 *  A) costarService.runDirectorAI —— 注入語意（直接測，mock invokeLLM）：
 *       · 傳 worldContext → 研究階段與創作階段 system prompt 都含【世界框架一致性】
 *       · 不傳 worldContext → system prompt 與既往位元相同（不含任何世界框架段落）
 *  B) directorRouter.chat —— 旗標 gate ＋ best-effort（透過 createCaller，
 *     mock buildBrainContext / runDirectorAI / db）：
 *       · 旗標 OFF（預設）即使帶 projectId → 不載入、worldContext = undefined
 *       · 旗標 ON ＋ 不帶 projectId → worldContext = undefined
 *       · 旗標 ON ＋ 帶 projectId ＋ 擁有者 ＋ 有世界觀 → 注入摘要字串
 *       · 旗標 ON ＋ 專案查無 → 不 throw、worldContext = undefined（chat 照常）
 *       · 旗標 ON ＋ 非擁有者 → 不注入
 *       · 旗標 ON ＋ db 拋錯 → 吞錯、不 throw、worldContext = undefined
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

// 攔 invokeLLM：記下每次呼叫的 messages，讓我們檢查 system prompt 內容。
const invokeCalls: Array<{ runName?: string; systemContent: string }> = [];
vi.mock("../../_core/llm", async () => {
  const actual =
    await vi.importActual<typeof import("../../_core/llm")>("../../_core/llm");
  return {
    ...actual,
    invokeLLM: vi.fn(async (params: any) => {
      const sys =
        (params.messages ?? []).find((m: any) => m.role === "system")
          ?.content ?? "";
      invokeCalls.push({ runName: params.runName, systemContent: String(sys) });
      // 研究階段回純文字、創作階段回合法 CO-STAR JSON，兩者都不影響 prompt 斷言。
      if (params.runName === "director-costar-generate") {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  context: "c",
                  situation: "s",
                  task: "t",
                  action: "a",
                  result: "r",
                  visualPrompt: "v",
                  audioScript: "au",
                  musicVibe: "m",
                  proactiveQuestion: "q",
                }),
              },
            },
          ],
        };
      }
      return { choices: [{ message: { content: "research text" } }] };
    }),
  };
});

// RAG 記憶：固定回空字串，避免外部依賴并讓 prompt 斷言乾淨。
vi.mock("../../services/ragMemory", () => ({
  buildMemoryContext: vi.fn(async () => ""),
}));

// perplexityThrottle 由 runDirectorAI 動態 import；強制 sonar 不可用走 brainConfig。
vi.mock("../../services/perplexityThrottle", () => ({
  checkAndConsumePerplexity: vi.fn(() => ({ allowed: false as const })),
}));

import { runDirectorAI } from "../../services/director/costarService";

const BRAIN = {
  model: "test-model",
  temperature: 0.7,
  topP: 0.9,
  systemPrompt: null,
};

const WORLD_SUMMARY = "# 世界觀：靈境試煉\n類型風格：奇幻\n時代背景：近未來";

beforeEach(() => {
  invokeCalls.length = 0;
  delete process.env.PERPLEXITY_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
});

// ─── A) runDirectorAI 注入語意 ─────────────────────────────────────────────────

describe("AIDV-152 / runDirectorAI worldContext 注入", () => {
  it("傳入 worldContext → 研究與創作階段 system prompt 都含世界框架段落", async () => {
    await runDirectorAI(
      [{ role: "user", content: "幫我想個開場" }],
      false,
      1,
      "creative",
      BRAIN,
      WORLD_SUMMARY
    );

    expect(invokeCalls.length).toBe(2);
    for (const call of invokeCalls) {
      expect(call.systemContent).toContain("【世界框架一致性】");
      expect(call.systemContent).toContain(WORLD_SUMMARY);
    }
  });

  it("不傳 worldContext → system prompt 不含任何世界框架段落（位元相同基準）", async () => {
    await runDirectorAI(
      [{ role: "user", content: "幫我想個開場" }],
      false,
      1,
      "creative",
      BRAIN
      // 第 6 參數 worldContext 省略
    );

    expect(invokeCalls.length).toBe(2);
    for (const call of invokeCalls) {
      expect(call.systemContent).not.toContain("【世界框架一致性】");
      expect(call.systemContent).not.toContain(WORLD_SUMMARY);
    }
  });

  it("傳入空白 worldContext → 視同未傳，不注入（trim 後為空）", async () => {
    await runDirectorAI(
      [{ role: "user", content: "x" }],
      false,
      1,
      "creative",
      BRAIN,
      "   \n  "
    );
    for (const call of invokeCalls) {
      expect(call.systemContent).not.toContain("【世界框架一致性】");
    }
  });

  it("傳 vs 不傳 worldContext，system prompt 差異僅為注入段落（其餘位元相同）", async () => {
    await runDirectorAI([{ role: "user", content: "x" }], false, 1, "creative", BRAIN);
    const baseline = invokeCalls.map(c => c.systemContent);
    invokeCalls.length = 0;

    await runDirectorAI(
      [{ role: "user", content: "x" }],
      false,
      1,
      "creative",
      BRAIN,
      WORLD_SUMMARY
    );
    const injected = invokeCalls.map(c => c.systemContent);

    expect(injected.length).toBe(baseline.length);
    for (let i = 0; i < baseline.length; i++) {
      // 移除注入段落後應與基準逐字相同。
      const stripped = injected[i].replace(
        `\n\n【世界框架一致性】\n${WORLD_SUMMARY}\n請讓所有建議與上述世界框架（角色／場景／風格／時代）保持一致。`,
        ""
      );
      expect(stripped).toBe(baseline[i]);
    }
  });
});
