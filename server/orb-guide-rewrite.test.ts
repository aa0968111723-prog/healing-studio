/**
 * orb-guide-rewrite.test.ts — Phase 3d-hybrid 純邏輯測試
 *
 * OrbGuide 每走一題都會呼叫 `orbGuide.step`：
 *   - server 根據 context 組 system prompt → 丟給 MiniMax
 *   - LLM 回 JSON → server 用 `parseOrbGuideStepReply` sanitize
 * 這兩個函式都在 `shared/agent-actions.ts`，沒動 DB/網路，這裡把行為鎖住。
 */

import { describe, expect, it } from "vitest";
import {
  buildOrbGuideStepPrompt,
  parseOrbGuideStepReply,
  type OrbGuideStepContext,
} from "../shared/agent-actions";

const baseCtx = (over: Partial<OrbGuideStepContext> = {}): OrbGuideStepContext => ({
  intent: "image",
  intentLabel: "生成圖像",
  targetLabel: "圖像工作室",
  personality: "creative",
  answeredSoFar: [],
  currentQuestion: {
    id: "style",
    stockText: "你想要什麼風格的圖？",
    stockOptions: [
      { label: "寫實攝影", value: "photorealistic", emoji: "📷" },
      { label: "插畫漫畫", value: "illustration", emoji: "🎨" },
    ],
  },
  isFinalStep: false,
  ...over,
});

describe("buildOrbGuideStepPrompt", () => {
  it("把 intentLabel / targetLabel / 預設選項都放進 prompt", () => {
    const p = buildOrbGuideStepPrompt(baseCtx());
    expect(p).toContain("生成圖像");
    expect(p).toContain("圖像工作室");
    expect(p).toContain("寫實攝影");
    expect(p).toContain("插畫漫畫");
  });

  it("有已回答時列在「已收集到的答案」區塊，並用 label 顯示", () => {
    const p = buildOrbGuideStepPrompt(
      baseCtx({
        answeredSoFar: [
          { questionId: "style", value: "photorealistic", label: "寫實攝影" },
        ],
      })
    );
    expect(p).toContain("style = 寫實攝影");
  });

  it("沒回答時顯示提示，不會出現空行或 undefined", () => {
    const p = buildOrbGuideStepPrompt(baseCtx());
    expect(p).toContain("（還沒回答任何題目）");
    expect(p).not.toContain("undefined");
  });

  it("isFinalStep=true 時附上 stockOrbMessage / stockPromptHint 給 LLM 參考", () => {
    const p = buildOrbGuideStepPrompt(
      baseCtx({
        isFinalStep: true,
        stockOrbMessage: "帶你去圖像工作室 ✨",
        stockPromptHint: "photorealistic calm healing, high quality",
      })
    );
    expect(p).toContain("收尾");
    expect(p).toContain("帶你去圖像工作室");
    expect(p).toContain("photorealistic calm healing");
  });

  it("isFinalStep=false 時明確叫 LLM 把 final_overrides 留空", () => {
    const p = buildOrbGuideStepPrompt(baseCtx());
    expect(p).toContain("final_overrides 留空");
  });

  it("personality 不同會反映在語氣引導", () => {
    expect(buildOrbGuideStepPrompt(baseCtx({ personality: "calm" }))).toContain(
      "溫柔"
    );
    expect(
      buildOrbGuideStepPrompt(baseCtx({ personality: "technical" }))
    ).toContain("直接");
  });
});

describe("parseOrbGuideStepReply", () => {
  it("空字串 / null / 壞 JSON → 回空物件", () => {
    expect(parseOrbGuideStepReply("", baseCtx())).toEqual({});
    expect(parseOrbGuideStepReply("not json", baseCtx())).toEqual({});
    expect(parseOrbGuideStepReply(null, baseCtx())).toEqual({});
  });

  it("能解析正常 JSON", () => {
    const r = parseOrbGuideStepReply(
      JSON.stringify({
        softened_question: "欸，你今天比較想要哪一種畫面？",
        extra_options: [
          { label: "黑白紀實", value: "bw documentary", emoji: "🖤" },
        ],
      }),
      baseCtx()
    );
    expect(r.softenedQuestion).toBe("欸，你今天比較想要哪一種畫面？");
    expect(r.extraOptions).toHaveLength(1);
    expect(r.extraOptions?.[0]?.value).toBe("bw documentary");
  });

  it("剝掉 ```json``` 包裝", () => {
    const raw = "```json\n" + JSON.stringify({
      softened_question: "試試看？",
    }) + "\n```";
    const r = parseOrbGuideStepReply(raw, baseCtx());
    expect(r.softenedQuestion).toBe("試試看？");
  });

  it("softenedQuestion 太長會被截到 80 字", () => {
    const long = "好".repeat(200);
    const r = parseOrbGuideStepReply(
      JSON.stringify({ softened_question: long }),
      baseCtx()
    );
    expect(r.softenedQuestion?.length).toBe(80);
  });

  it("extraOptions 去掉與 stockOptions value 重覆的", () => {
    const r = parseOrbGuideStepReply(
      JSON.stringify({
        extra_options: [
          { label: "寫實", value: "photorealistic", emoji: "📷" }, // 撞 stock
          { label: "像素風", value: "pixel art", emoji: "👾" },
        ],
      }),
      baseCtx()
    );
    expect(r.extraOptions).toHaveLength(1);
    expect(r.extraOptions?.[0]?.value).toBe("pixel art");
  });

  it("extraOptions 最多只留 2 個（超過丟掉）", () => {
    const r = parseOrbGuideStepReply(
      JSON.stringify({
        extra_options: [
          { label: "像素", value: "pixel", emoji: "👾" },
          { label: "膠片", value: "film", emoji: "🎞" },
          { label: "低多邊形", value: "low poly", emoji: "🔷" },
          { label: "蒸汽波", value: "vaporwave", emoji: "🌐" },
        ],
      }),
      baseCtx()
    );
    expect(r.extraOptions).toHaveLength(2);
  });

  it("缺 label/value/emoji 的選項會被略過，不拋錯", () => {
    const r = parseOrbGuideStepReply(
      JSON.stringify({
        extra_options: [
          { label: "", value: "x", emoji: "x" },
          { label: "ok", value: "", emoji: "🙂" },
          { label: "ok", value: "ok", emoji: "" },
          { label: "合格", value: "valid", emoji: "✅" },
        ],
      }),
      baseCtx()
    );
    expect(r.extraOptions).toEqual([
      { label: "合格", value: "valid", emoji: "✅" },
    ]);
  });

  it("skip_next 只在 answeredSoFar 非空且非 final 才採納", () => {
    // 沒答過 → 不給跳
    expect(
      parseOrbGuideStepReply(
        JSON.stringify({ skip_next: true }),
        baseCtx({ answeredSoFar: [] })
      ).skipNext
    ).toBeUndefined();

    // 有答 + 非 final → 可跳
    expect(
      parseOrbGuideStepReply(
        JSON.stringify({ skip_next: true }),
        baseCtx({
          answeredSoFar: [{ questionId: "style", value: "photorealistic" }],
        })
      ).skipNext
    ).toBe(true);

    // final 步驟不允許「再跳一題」
    expect(
      parseOrbGuideStepReply(
        JSON.stringify({ skip_next: true }),
        baseCtx({
          answeredSoFar: [{ questionId: "style", value: "photorealistic" }],
          isFinalStep: true,
        })
      ).skipNext
    ).toBeUndefined();
  });

  it("final_overrides 只在 isFinalStep=true 才接；非 final 直接丟棄", () => {
    const payload = JSON.stringify({
      final_overrides: {
        orb_message: "好喔，幫你準備好了 ✨",
        prompt_hint: "photorealistic calm healing, cinematic",
      },
    });
    expect(parseOrbGuideStepReply(payload, baseCtx()).orbMessageOverride).toBeUndefined();

    const final = parseOrbGuideStepReply(
      payload,
      baseCtx({ isFinalStep: true, currentQuestion: undefined })
    );
    expect(final.orbMessageOverride).toBe("好喔，幫你準備好了 ✨");
    expect(final.promptHintOverride).toBe("photorealistic calm healing, cinematic");
  });

  it("任何欄位缺失都不會拋錯，只填它有的", () => {
    const r = parseOrbGuideStepReply(
      JSON.stringify({ softened_question: "嘿" }),
      baseCtx()
    );
    expect(r).toEqual({ softenedQuestion: "嘿" });
  });

  it("接受 camelCase 作為 fallback（若 LLM 沒照 snake_case）", () => {
    const r = parseOrbGuideStepReply(
      JSON.stringify({ softenedQuestion: "ok", extraOptions: [] }),
      baseCtx()
    );
    expect(r.softenedQuestion).toBe("ok");
  });

  it("softenedQuestion 全空白/控制字元 → 當作空，不填", () => {
    const r = parseOrbGuideStepReply(
      JSON.stringify({ softened_question: "   \u0000\u0001  " }),
      baseCtx()
    );
    expect(r.softenedQuestion).toBeUndefined();
  });
});
