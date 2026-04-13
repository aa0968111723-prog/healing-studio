/**
 * Director AI Router
 * ────────────────────────────────────────────────────────────────────────────
 * CO-STAR 導演 AI 協作路由 — 雙引擎 RAG（事實研究 + 創意編排）
 *
 * 功能：
 *   - 人格化聊天（沉穩 / 創意 / 技術）
 *   - RAG 記憶注入（利用用戶歷史偏好）
 *   - 對話 session 持久化（localStorage 為主，server 端筆記備份）
 *   - 預設模板庫
 *   - 偏好設定 CRUD
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import * as db from "../db";
import { buildMemoryContext } from "../services/ragMemory";
import { buildDirectorSystemPrompt, GENERATION_MODALITIES_KNOWLEDGE, WORKFLOW_KNOWLEDGE } from "../services/siteKnowledge";
import type { DirectorTemplate } from "../../shared/types";

// ─── Timeout Utility ────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, label = "API"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} 回應超時（${Math.round(ms / 1000)}秒），請稍後再試`));
    }, ms);
    promise
      .then((val) => { clearTimeout(timer); resolve(val); })
      .catch((err) => { clearTimeout(timer); reject(err); });
  });
}

// ─── Personality System Prompts ──────────────────────────────────────────────

const PERSONALITY_PROMPTS: Record<string, { researchStyle: string; directorStyle: string; proactiveHint: string }> = {
  calm: {
    researchStyle: `你是一位沉穩而深思熟慮的研究助手。你重視邏輯、結構與可行性。
風格特點：
- 先分析可行性，再提供建議
- 用「我建議我們先...」「從結構上來看...」等引導式語氣
- 提供完整的利弊分析
- 使用繁體中文，語氣平穩而專業`,
    directorStyle: `你是「導演 AI」，一位沉穩型創意導演。你重視邏輯性與敘事結構。
風格：
- 先確認使用者的核心意圖，再展開創作
- 強調敘事的完整性與情緒弧線
- 用「我們可以這樣思考...」的引導方式
- 腳本結構嚴謹，每個元素都有明確目的`,
    proactiveHint: `

【主動介入規則】
當使用者的描述不夠具體時，你必須主動提問：
- 「您的目標觀眾是誰？這會影響我們的敘事節奏。」
- 「您希望傳達的核心情緒是什麼？平靜、振奮、或是思考？」
- 「從結構上看，我建議我們先確定 X，再處理 Y。」`,
  },
  creative: {
    researchStyle: `你是一位充滿靈感的創意研究助手。你重視氛圍、情緒與視覺衝擊力。
風格特點：
- 用豐富的意象和比喻來描述靈感
- 主動提供意想不到的角度和組合
- 用「想像一下...」「如果我們讓...」等啓發式語氣
- 使用繁體中文，語氣熱情而富有感染力`,
    directorStyle: `你是「導演 AI」，一位創意型藝術導演。你重視氛圍、情緒和視覺衝擊力。
風格：
- 用感性的語言描繪畫面，讓使用者「看見」最終成果
- 大膽提出意想不到的創意組合
- 用「想像一下這個畫面...」「如果我們加入...」
- 腳本充滿藝術性，強調視覺美感與情緒渡染`,
    proactiveHint: `

【主動介入規則】
當使用者的描述缺乏情緒或氛圍時，你必須主動引導：
- 「想像一下，如果我們加入 X 的元素，整個畫面會變得更有張力。」
- 「我覺得這裡缺少一個情緒高潮點——你希望觀眾在哪個瞬間屏住呼吸？」
- 「讓我用一個比喻來幫你精煉這個構想...」`,
  },
  technical: {
    researchStyle: `你是一位技術導向的研究助手。你重視參數精確度、技術可行性與最佳實踐。
風格特點：
- 提供具體的技術參數建議（解析度、幀率、編碼格式）
- 分析不同模型/工具的技術限制
- 用「建議使用 X 參數，因為...」等專業語氣
- 使用繁體中文，語氣精確而專業`,
    directorStyle: `你是「導演 AI」，一位技術型導演。你重視參數精確度與技術最佳實踐。
風格：
- 為每個創作決策提供技術理由
- 具體建議解析度、幀率、編碼格式、模型參數
- 用「技術上建議...」「根據模型特性...」等語氣
- 腳本包含具體的技術參數與模型配置建議`,
    proactiveHint: `

【主動介入規則】
當使用者缺少技術參數時，你必須主動提問：
- 「您希望的輸出解析度是多少？1080p 還是 4K？這會影響我們的模型選擇。」
- 「目前缺少鏡頭運動參數——建議加入 dolly zoom 或 tracking shot 來增強動態感。」
- 「技術上，您的描述適合使用 ControlNet depth + canny 雙層控制，要我幫您配置嗎？」`,
  },
};

// ─── Template Library ───────────────────────────────────────────────────────

const DIRECTOR_TEMPLATES: DirectorTemplate[] = [
  {
    id: "short-film-emotion",
    label: "情感短片",
    description: "一部 60 秒的情感故事短片，聚焦於角色的內心世界",
    category: "short-film",
    prompt: "幫我構思一部 60 秒的情感短片。主題是關於離別與重逢，我想要溫暖但帶有一點憂傷的氛圍。目標觀眾是 20-35 歲的年輕人。",
    personality: "creative",
  },
  {
    id: "meditation-guide",
    label: "冥想引導",
    description: "10 分鐘的冥想引導音頻，搭配視覺化場景",
    category: "meditation",
    prompt: "設計一段 10 分鐘的冥想引導，主題是「森林中的寧靜」。需要語音引導腳本和背景音樂風格建議。",
    personality: "calm",
  },
  {
    id: "brand-promo",
    label: "品牌宣傳",
    description: "30 秒品牌宣傳影片，強調品牌核心價值",
    category: "brand",
    prompt: "製作一支 30 秒的品牌宣傳影片。品牌核心是「科技與人文的交匯」，目標是讓觀眾感受到溫度與創新並存。",
    personality: "calm",
  },
  {
    id: "music-video-dream",
    label: "夢境 MV",
    description: "充滿夢幻意象的音樂影片概念",
    category: "music-video",
    prompt: "構思一支夢境風格的音樂影片。曲風是 dream pop / shoegaze，我想要大量的光影效果、慢動作和超現實元素。",
    personality: "creative",
  },
  {
    id: "tutorial-creative",
    label: "創意教學",
    description: "step-by-step 創意教學影片腳本",
    category: "tutorial",
    prompt: "設計一支 3 分鐘的創意教學影片，教觀眾如何用 AI 工具從零開始創作一張概念藝術圖。需要清晰的步驟分解。",
    personality: "technical",
  },
  {
    id: "ad-product",
    label: "產品廣告",
    description: "15 秒產品廣告，注重視覺衝擊力",
    category: "ad",
    prompt: "製作一支 15 秒的產品廣告。產品是一款智能音箱。需要強烈的視覺節奏、產品特寫和生活場景切換。",
    personality: "technical",
  },
];

// ─── Core Director AI Logic ─────────────────────────────────────────────────

async function runDirectorAI(
  messages: Array<{ role: string; content: string }>,
  saveToNotes: boolean,
  userId: number,
  personality: "calm" | "creative" | "technical" = "creative",
) {
  const persona = PERSONALITY_PROMPTS[personality] ?? PERSONALITY_PROMPTS.creative;
  const fullDirectorPrompt = buildDirectorSystemPrompt(personality);

  // Build RAG memory context for this user (gracefully degrade if unavailable)
  let memoryContext = "";
  try {
    const lastUserMsg = [...messages].reverse().find(m => m.role === "user")?.content ?? "";
    if (lastUserMsg) {
      memoryContext = await buildMemoryContext(userId, lastUserMsg);
    }
  } catch {
    // RAG unavailable — continue without memory
  }

  const memorySection = memoryContext
    ? `\n\n【用戶歷史偏好記憶】\n${memoryContext}\n請參考用戶的歷史偏好來調整建議。`
    : "";

  // Step 1: Factual grounding with personality-aware research style + full platform knowledge
  const researchResult = await withTimeout(invokeLLM({
    messages: [
      {
        role: "system",
        content: `${persona.researchStyle}

你深入了解 Healing Studio 平台所有生成模型和工具：
${GENERATION_MODALITIES_KNOWLEDGE}
${WORKFLOW_KNOWLEDGE}
${memorySection}`,
      },
      ...messages.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
    ],
  }), 30_000, "導演AI研究");
  const researchContent = typeof researchResult.choices[0]?.message?.content === "string"
    ? researchResult.choices[0].message.content : "";

  // Step 2: Creative orchestration with CO-STAR framework + full director knowledge
  const scriptResult = await withTimeout(invokeLLM({
    messages: [
      {
        role: "system",
        content: `${fullDirectorPrompt}

基於以下研究資料，創作一個結構化的 JSON 腳本：
${researchContent}
${persona.proactiveHint}

輸出 JSON 格式必須包含：
- context, situation, task, action, result（CO-STAR 各欄位）
- visualPrompt：視覺提示詞（英文，包含推薦模型名稱和正面解剖學約束）
- audioScript：語音腳本（繁體中文，標明推薦的 TTS 模型）
- musicVibe：音樂風格描述（英文，標明推薦的音樂模型）
- proactiveQuestion：主動向使用者提出的引導性問題（繁體中文，根據使用者描述中缺少的元素提問）`,
      },
      ...messages.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "costar_script",
        strict: true,
        schema: {
          type: "object",
          properties: {
            context: { type: "string" },
            situation: { type: "string" },
            task: { type: "string" },
            action: { type: "string" },
            result: { type: "string" },
            visualPrompt: { type: "string" },
            audioScript: { type: "string" },
            musicVibe: { type: "string" },
            proactiveQuestion: { type: "string" },
          },
          required: ["context", "situation", "task", "action", "result", "visualPrompt", "audioScript", "musicVibe", "proactiveQuestion"],
          additionalProperties: false,
        },
      },
    },
  }), 45_000, "導演AI創作");

  const scriptContent = scriptResult.choices[0]?.message?.content;
  let script;
  try {
    script = typeof scriptContent === "string" ? JSON.parse(scriptContent) : scriptContent;
  } catch {
    script = { context: "", situation: "", task: "", action: "", result: "", visualPrompt: "", audioScript: "", musicVibe: "", proactiveQuestion: "" };
  }

  // Save to project notes if requested
  if (saveToNotes && userId) {
    await db.createProjectNote({
      userId,
      title: `導演 AI 腳本 (${personality}) - ${new Date().toLocaleDateString("zh-TW")}`,
      content: researchContent,
      scriptJson: script,
      noteType: "script",
    });
  }

  return { research: researchContent, script, personality };
}

// ─── Router ─────────────────────────────────────────────────────────────────

export const directorRouter = router({
  /** Main chat endpoint — runs dual-engine Director AI */
  chat: protectedProcedure
    .input(z.object({
      messages: z.array(z.object({
        role: z.string(),
        content: z.string(),
      })),
      saveToNotes: z.boolean().default(false),
      personality: z.enum(["calm", "creative", "technical"]).default("creative"),
    }))
    .mutation(async ({ ctx, input }) => {
      return runDirectorAI(input.messages, input.saveToNotes, ctx.user.id, input.personality);
    }),

  /** Refine an existing script with follow-up instruction */
  refineScript: protectedProcedure
    .input(z.object({
      script: z.object({
        context: z.string(),
        situation: z.string(),
        task: z.string(),
        action: z.string(),
        result: z.string(),
        visualPrompt: z.string(),
        audioScript: z.string(),
        musicVibe: z.string(),
        proactiveQuestion: z.string().optional(),
      }),
      instruction: z.string().min(1),
      personality: z.enum(["calm", "creative", "technical"]).default("creative"),
    }))
    .mutation(async ({ input }) => {
      const fullPrompt = buildDirectorSystemPrompt(input.personality);

      const result = await withTimeout(invokeLLM({
        messages: [
          {
            role: "system",
            content: `${fullPrompt}

你收到一份已存在的 CO-STAR 腳本，以及使用者的修改指示。
請根據指示修改腳本，保留未被要求更動的部分。
輸出完整的 JSON 腳本。`,
          },
          {
            role: "user",
            content: `現有腳本：\n${JSON.stringify(input.script, null, 2)}\n\n修改指示：${input.instruction}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "costar_script",
            strict: true,
            schema: {
              type: "object",
              properties: {
                context: { type: "string" },
                situation: { type: "string" },
                task: { type: "string" },
                action: { type: "string" },
                result: { type: "string" },
                visualPrompt: { type: "string" },
                audioScript: { type: "string" },
                musicVibe: { type: "string" },
                proactiveQuestion: { type: "string" },
              },
              required: ["context", "situation", "task", "action", "result", "visualPrompt", "audioScript", "musicVibe", "proactiveQuestion"],
              additionalProperties: false,
            },
          },
        },
      }), 30_000, "腳本修改");

      const content = result.choices[0]?.message?.content;
      try {
        return typeof content === "string" ? JSON.parse(content) : content;
      } catch {
        return input.script;
      }
    }),

  /** Get available templates */
  templates: protectedProcedure.query(() => {
    return DIRECTOR_TEMPLATES;
  }),

  /** Save a session snapshot to project notes */
  saveSession: protectedProcedure
    .input(z.object({
      title: z.string().min(1).max(255),
      sessionData: z.string(), // JSON stringified session
      personality: z.enum(["calm", "creative", "technical"]).default("creative"),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = await db.createProjectNote({
        userId: ctx.user.id,
        title: `[導演對話] ${input.title}`,
        content: input.sessionData,
        noteType: "script",
        tags: ["director-session", input.personality],
      });
      return { id };
    }),

  /** List saved director sessions */
  listSessions: protectedProcedure.query(async ({ ctx }) => {
    const notes = await db.getProjectNotesByUser(ctx.user.id);
    return notes
      .filter(n => n.noteType === "script" && n.title.startsWith("[導演對話]"))
      .map(n => ({
        id: n.id,
        title: n.title.replace("[導演對話] ", ""),
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      }));
  }),

  /** Load a saved session */
  loadSession: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const note = await db.getProjectNote(input.id);
      if (!note || note.userId !== ctx.user.id) return null;
      return {
        id: note.id,
        title: note.title.replace("[導演對話] ", ""),
        sessionData: note.content,
        createdAt: note.createdAt,
      };
    }),

  /** Delete a saved session */
  deleteSession: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const note = await db.getProjectNote(input.id);
      if (!note || note.userId !== ctx.user.id) return { success: false };
      await db.deleteProjectNote(input.id);
      return { success: true };
    }),

  /** Preferences CRUD */
  preferences: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      return db.getDirectorPreferences(ctx.user.id);
    }),
    update: protectedProcedure
      .input(z.object({
        personality: z.enum(["calm", "creative", "technical"]).optional(),
        preferredFormat: z.enum(["co-star", "sslcm", "selcm", "free"]).optional(),
        customSystemPrompt: z.string().optional(),
        preferencesJson: z.record(z.string(), z.unknown()).optional(),
        onboardingSteps: z.array(z.string()).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const id = await db.upsertDirectorPreferences(ctx.user.id, input);
        return { id };
      }),
  }),
});
