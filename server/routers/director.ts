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
 *   - 長腳本匯入、分鏡分析、逐段多模態討論
 *   - 腳本匯出（JSON / CSV / Markdown / FDX / SRT / 自訂格式）
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import * as db from "../db";
import { buildMemoryContext } from "../services/ragMemory";
import { buildDirectorSystemPrompt, GENERATION_MODALITIES_KNOWLEDGE, WORKFLOW_KNOWLEDGE } from "../services/siteKnowledge";
import { getAllPricingByCategory, estimatePoints, getModelPricing, checkModelAvailability, type ModelCategory } from "../services/modelPricing";
import type { DirectorTemplate, ScriptSegment, QuickAction } from "../../shared/types";

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

// ─── Quick Actions for Multi-Modal Discussion ───────────────────────────────

const QUICK_ACTIONS: QuickAction[] = [
  // Visual
  { id: "enhance-visual", label: "Enhance Visual", labelZh: "強化視覺", icon: "image", promptTemplate: "請針對這段分鏡的視覺描述進行強化，增加更豐富的畫面細節、光影描述、色調與構圖建議。", category: "visual" },
  { id: "add-camera", label: "Camera Direction", labelZh: "鏡頭運動", icon: "video", promptTemplate: "請為這段分鏡添加具體的鏡頭運動建議（如推拉搖移跟、特寫、中景、遠景等），並說明每個鏡頭選擇的理由。", category: "visual" },
  { id: "color-palette", label: "Color Palette", labelZh: "色彩設計", icon: "palette", promptTemplate: "請為這段分鏡設計一個完整的色彩方案，包含主色調、輔助色、點綴色，並說明這些顏色如何服務敘事情緒。", category: "visual" },
  { id: "reference-style", label: "Style Reference", labelZh: "風格參考", icon: "sparkles", promptTemplate: "請為這段分鏡推薦視覺風格參考（電影、攝影師、藝術家或藝術流派），並說明如何在 AI 生成時運用這些風格。", category: "visual" },
  // Audio
  { id: "sound-design", label: "Sound Design", labelZh: "音效設計", icon: "volume", promptTemplate: "請為這段分鏡設計完整的音效層次，包括環境音、音效、配樂風格、音量變化，並建議適合的 AI 音樂模型。", category: "audio" },
  { id: "dialogue-polish", label: "Dialogue Polish", labelZh: "對白優化", icon: "mic", promptTemplate: "請優化這段分鏡的對白，使語調更自然、更符合角色性格，並標注語氣和情緒提示。", category: "audio" },
  { id: "voiceover", label: "Voiceover Script", labelZh: "旁白腳本", icon: "headphones", promptTemplate: "請為這段分鏡撰寫旁白腳本，包含語氣標註、節奏控制、停頓位置，適合 TTS 生成。", category: "audio" },
  // Narrative
  { id: "pacing", label: "Pacing", labelZh: "節奏調整", icon: "timer", promptTemplate: "請分析並調整這段分鏡的敘事節奏，建議哪些地方需要加速或放慢，如何營造張力和釋放。", category: "narrative" },
  { id: "emotion-arc", label: "Emotion Arc", labelZh: "情緒弧線", icon: "heart", promptTemplate: "請分析這段分鏡的情緒走向，建議如何強化情緒弧線，讓觀眾在關鍵時刻產生共鳴。", category: "narrative" },
  { id: "transition", label: "Transition", labelZh: "轉場設計", icon: "shuffle", promptTemplate: "請設計這段分鏡與前後段之間的轉場方式，可以是視覺轉場、聲音轉場或概念轉場。", category: "narrative" },
  // Technical
  { id: "gen-params", label: "Gen Parameters", labelZh: "生成參數", icon: "settings", promptTemplate: "請為這段分鏡建議具體的 AI 生成參數，包括推薦模型、解析度、步數、CFG 值、種子碼策略等。", category: "technical" },
  { id: "prompt-optimize", label: "Optimize Prompt", labelZh: "提示詞優化", icon: "wand", promptTemplate: "請將這段分鏡的描述轉化為最佳化的英文 AI 生成提示詞（Prompt），包含正向與負向提示詞。", category: "technical" },
  // Mood
  { id: "mood-shift", label: "Mood Shift", labelZh: "氛圍轉換", icon: "sun", promptTemplate: "請嘗試將這段分鏡的氛圍往不同方向調整，提供 2-3 種氛圍變體供選擇。", category: "mood" },
  { id: "intensity", label: "Intensity", labelZh: "強度調整", icon: "zap", promptTemplate: "請調整這段分鏡的戲劇張力強度，提供「低張力」、「中張力」、「高張力」三個版本。", category: "mood" },
];

// ─── Script Import & Analysis Functions ─────────────────────────────────────

/** Maximum characters sent to LLM for script analysis (LLM context window budget) */
const SCRIPT_ANALYSIS_MAX_CHARS = 15_000;

async function parseScriptIntoSegments(
  rawContent: string,
  sourceFormat: string,
  personality: "calm" | "creative" | "technical",
): Promise<Omit<ScriptSegment, "discussion" | "status">[]> {
  const persona = PERSONALITY_PROMPTS[personality] ?? PERSONALITY_PROMPTS.creative;
  const truncatedContent = rawContent.slice(0, SCRIPT_ANALYSIS_MAX_CHARS);

  const result = await withTimeout(invokeLLM({
    messages: [
      {
        role: "system",
        content: `${persona.directorStyle}

你是一位專業的腳本分析師。你的任務是將使用者匯入的長腳本拆分為獨立的分鏡段落。

來源格式：${sourceFormat}

請分析腳本內容，根據場景切換、敘事節點、情緒轉折等自然斷點，將內容拆分為多個分鏡段落。
每個段落需要包含：
- sceneHeading: 場景標題（如 INT. 咖啡廳 - 日）
- visualDescription: 視覺描述（畫面內容、光影、構圖）
- dialogue: 對白內容
- soundDesign: 音效/音樂描述
- cameraDirection: 鏡頭運動建議
- duration: 預估時長
- mood: 情緒氛圍

輸出 JSON 格式：一個段落陣列。`,
      },
      {
        role: "user",
        content: `請分析以下腳本並拆分為分鏡段落：\n\n${truncatedContent}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "script_segments",
        strict: true,
        schema: {
          type: "object",
          properties: {
            segments: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  sceneHeading: { type: "string" },
                  visualDescription: { type: "string" },
                  dialogue: { type: "string" },
                  soundDesign: { type: "string" },
                  cameraDirection: { type: "string" },
                  duration: { type: "string" },
                  mood: { type: "string" },
                  rawText: { type: "string" },
                },
                required: ["sceneHeading", "visualDescription", "dialogue", "soundDesign", "cameraDirection", "duration", "mood", "rawText"],
                additionalProperties: false,
              },
            },
          },
          required: ["segments"],
          additionalProperties: false,
        },
      },
    },
    maxTokens: 8192,
  }), 60_000, "腳本分析");

  const content = result.choices[0]?.message?.content;
  let parsed: { segments: Array<{
    sceneHeading: string; visualDescription: string; dialogue: string;
    soundDesign: string; cameraDirection: string; duration: string;
    mood: string; rawText: string;
  }> };
  try {
    parsed = typeof content === "string" ? JSON.parse(content) : content;
  } catch {
    parsed = { segments: [] };
  }

  const segments = parsed.segments ?? [];
  const segCount = segments.length || 1;
  // Split rawContent into roughly equal paragraph-aligned chunks as fallback
  const paragraphs = rawContent.split(/\n{2,}/);
  const chunkSize = Math.ceil(paragraphs.length / segCount);

  return segments.map((seg, idx) => ({
    id: `seg-${Date.now()}-${idx}`,
    index: idx,
    rawText: seg.rawText || paragraphs.slice(idx * chunkSize, (idx + 1) * chunkSize).join("\n\n"),
    storyboard: {
      sceneHeading: seg.sceneHeading,
      visualDescription: seg.visualDescription,
      dialogue: seg.dialogue,
      soundDesign: seg.soundDesign,
      cameraDirection: seg.cameraDirection,
      duration: seg.duration,
      mood: seg.mood,
    },
  }));
}

async function discussSegmentWithAI(
  segment: ScriptSegment,
  userMessage: string,
  personality: "calm" | "creative" | "technical",
  quickActionId?: string,
  imageUrl?: string,
): Promise<{ reply: string; updatedStoryboard?: ScriptSegment["storyboard"] }> {
  const persona = PERSONALITY_PROMPTS[personality] ?? PERSONALITY_PROMPTS.creative;
  const quickAction = quickActionId ? QUICK_ACTIONS.find(a => a.id === quickActionId) : undefined;

  const contextParts = [
    `【目前分鏡資訊】`,
    `場景：${segment.storyboard.sceneHeading}`,
    `視覺：${segment.storyboard.visualDescription}`,
    `對白：${segment.storyboard.dialogue}`,
    `音效：${segment.storyboard.soundDesign}`,
    `鏡頭：${segment.storyboard.cameraDirection}`,
    `時長：${segment.storyboard.duration}`,
    `氛圍：${segment.storyboard.mood}`,
  ];

  if (segment.rawText) {
    contextParts.push(`\n【原始腳本段落】\n${segment.rawText}`);
  }

  if (imageUrl) {
    contextParts.push(`\n【使用者附上了參考圖片】URL: ${imageUrl}\n請在回覆中參考這張圖片的風格、構圖或色調來調整建議。`);
  }

  const previousDiscussion = segment.discussion.slice(-6).map(d =>
    `${d.role === "user" ? "使用者" : "導演"}：${d.content}`
  ).join("\n");

  if (previousDiscussion) {
    contextParts.push(`\n【先前討論紀錄】\n${previousDiscussion}`);
  }

  const effectiveMessage = quickAction
    ? `${quickAction.promptTemplate}\n\n使用者補充：${userMessage || "（無額外補充）"}`
    : userMessage;

  const result = await withTimeout(invokeLLM({
    messages: [
      {
        role: "system",
        content: `${persona.directorStyle}

你正在與使用者逐段討論一份長腳本的分鏡。你的角色是專業的導演 AI，幫助使用者優化每個分鏡段落。

${contextParts.join("\n")}

請根據使用者的指示提供具體、可執行的建議。
如果你認為分鏡需要修改，請在回覆末尾附上修改後的分鏡 JSON（用 \`\`\`json 包裹）。
如果不需要修改分鏡結構，只需要提供文字回覆即可。`,
      },
      {
        role: "user",
        content: effectiveMessage,
      },
    ],
    maxTokens: 4096,
  }), 45_000, "分鏡討論");

  const replyText = typeof result.choices[0]?.message?.content === "string"
    ? result.choices[0].message.content : "";

  // Try to extract updated storyboard JSON from the reply
  let updatedStoryboard: ScriptSegment["storyboard"] | undefined;
  const jsonMatch = replyText.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed.sceneHeading || parsed.visualDescription) {
        updatedStoryboard = {
          sceneHeading: parsed.sceneHeading ?? segment.storyboard.sceneHeading,
          visualDescription: parsed.visualDescription ?? segment.storyboard.visualDescription,
          dialogue: parsed.dialogue ?? segment.storyboard.dialogue,
          soundDesign: parsed.soundDesign ?? segment.storyboard.soundDesign,
          cameraDirection: parsed.cameraDirection ?? segment.storyboard.cameraDirection,
          duration: parsed.duration ?? segment.storyboard.duration,
          mood: parsed.mood ?? segment.storyboard.mood,
        };
      }
    } catch {
      // JSON parse failed — just return text reply
    }
  }

  return { reply: replyText, updatedStoryboard };
}

function generateExport(
  segments: ScriptSegment[],
  format: string,
  options: {
    customColumns?: Array<{ header: string; field: string }>;
    includeDiscussion?: boolean;
    includeCostar?: boolean;
    customTemplate?: string;
  },
): string {
  switch (format) {
    case "json":
      return JSON.stringify(segments.map(seg => ({
        index: seg.index,
        ...seg.storyboard,
        rawText: seg.rawText,
        status: seg.status,
        ...(options.includeCostar && seg.costar ? { costar: seg.costar } : {}),
        ...(options.includeDiscussion ? { discussion: seg.discussion } : {}),
      })), null, 2);

    case "csv": {
      const cols = options.customColumns ?? [
        { header: "序號", field: "index" },
        { header: "場景", field: "sceneHeading" },
        { header: "視覺描述", field: "visualDescription" },
        { header: "對白", field: "dialogue" },
        { header: "音效", field: "soundDesign" },
        { header: "鏡頭", field: "cameraDirection" },
        { header: "時長", field: "duration" },
        { header: "氛圍", field: "mood" },
        { header: "狀態", field: "status" },
      ];
      const escapeCSV = (val: string) => {
        const s = (val ?? "").replace(/"/g, '""');
        // Wrap in quotes if contains comma, newline, or double-quote per RFC 4180
        return /[",\n\r]/.test(s) ? `"${s}"` : `"${s}"`;
      };      const header = cols.map(c => escapeCSV(c.header)).join(",");
      const rows = segments.map(seg => {
        const flat: Record<string, string> = {
          index: String(seg.index + 1),
          ...seg.storyboard,
          rawText: seg.rawText,
          status: seg.status,
        };
        return cols.map(c => escapeCSV(flat[c.field] ?? "")).join(",");
      });
      return [header, ...rows].join("\n");
    }

    case "markdown": {
      return segments.map((seg, i) => {
        const lines = [
          `## 分鏡 ${i + 1}：${seg.storyboard.sceneHeading}`,
          "",
          `**視覺描述：** ${seg.storyboard.visualDescription}`,
          "",
          seg.storyboard.dialogue ? `**對白：**\n> ${seg.storyboard.dialogue.replace(/\n/g, "\n> ")}` : "",
          "",
          `**音效設計：** ${seg.storyboard.soundDesign}`,
          `**鏡頭運動：** ${seg.storyboard.cameraDirection}`,
          `**預估時長：** ${seg.storyboard.duration}`,
          `**情緒氛圍：** ${seg.storyboard.mood}`,
          `**狀態：** ${seg.status}`,
        ];
        if (options.includeDiscussion && seg.discussion.length > 0) {
          lines.push("", "### 討論紀錄", "");
          seg.discussion.forEach(d => {
            lines.push(`- **${d.role === "user" ? "使用者" : "導演"}**：${d.content}`);
          });
        }
        return lines.filter(Boolean).join("\n");
      }).join("\n\n---\n\n");
    }

    case "srt": {
      let timeOffset = 0;
      return segments.map((seg, i) => {
        const durationSec = parseDurationToSeconds(seg.storyboard.duration);
        const start = formatSrtTime(timeOffset);
        const end = formatSrtTime(timeOffset + durationSec);
        timeOffset += durationSec;
        const text = seg.storyboard.dialogue || seg.storyboard.visualDescription;
        return `${i + 1}\n${start} --> ${end}\n${text}`;
      }).join("\n\n");
    }

    case "fdx": {
      const elements = segments.map(seg => {
        const parts: string[] = [];
        if (seg.storyboard.sceneHeading) {
          parts.push(`    <Paragraph Type="Scene Heading"><Text>${escapeXml(seg.storyboard.sceneHeading)}</Text></Paragraph>`);
        }
        if (seg.storyboard.visualDescription) {
          parts.push(`    <Paragraph Type="Action"><Text>${escapeXml(seg.storyboard.visualDescription)}</Text></Paragraph>`);
        }
        if (seg.storyboard.dialogue) {
          parts.push(`    <Paragraph Type="Dialogue"><Text>${escapeXml(seg.storyboard.dialogue)}</Text></Paragraph>`);
        }
        return parts.join("\n");
      }).join("\n");
      return `<?xml version="1.0" encoding="UTF-8"?>\n<FinalDraft DocumentType="Script" Template="No">\n  <Content>\n${elements}\n  </Content>\n</FinalDraft>`;
    }

    case "custom": {
      if (!options.customTemplate) return JSON.stringify(segments, null, 2);
      return segments.map((seg, i) => {
        let out = options.customTemplate!;
        out = out.replace(/\{\{index\}\}/g, String(i + 1));
        out = out.replace(/\{\{sceneHeading\}\}/g, seg.storyboard.sceneHeading);
        out = out.replace(/\{\{visualDescription\}\}/g, seg.storyboard.visualDescription);
        out = out.replace(/\{\{dialogue\}\}/g, seg.storyboard.dialogue);
        out = out.replace(/\{\{soundDesign\}\}/g, seg.storyboard.soundDesign);
        out = out.replace(/\{\{cameraDirection\}\}/g, seg.storyboard.cameraDirection);
        out = out.replace(/\{\{duration\}\}/g, seg.storyboard.duration);
        out = out.replace(/\{\{mood\}\}/g, seg.storyboard.mood);
        out = out.replace(/\{\{status\}\}/g, seg.status);
        out = out.replace(/\{\{rawText\}\}/g, seg.rawText);
        return out;
      }).join("\n\n");
    }

    default:
      return JSON.stringify(segments, null, 2);
  }
}

function parseDurationToSeconds(duration: string): number {
  const minMatch = duration.match(/(\d+)\s*分/);
  const secMatch = duration.match(/(\d+)\s*秒/);
  const numMatch = duration.match(/^(\d+(?:\.\d+)?)$/);
  let total = 0;
  if (minMatch) total += parseInt(minMatch[1], 10) * 60;
  if (secMatch) total += parseInt(secMatch[1], 10);
  if (!minMatch && !secMatch && numMatch) total = parseFloat(numMatch[1]);
  return total || 5;
}

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

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

  // ─── Script Analysis & Discussion System ──────────────────────────────────

  /** Import and parse a long script into storyboard segments */
  importScript: protectedProcedure
    .input(z.object({
      rawContent: z.string().min(1).max(100000),
      title: z.string().min(1).max(255),
      sourceFormat: z.string().default("plaintext"),
      personality: z.enum(["calm", "creative", "technical"]).default("creative"),
    }))
    .mutation(async ({ input }) => {
      const segments = await parseScriptIntoSegments(
        input.rawContent,
        input.sourceFormat,
        input.personality,
      );
      const fullSegments: ScriptSegment[] = segments.map(seg => ({
        ...seg,
        discussion: [],
        status: "draft" as const,
      }));
      return {
        id: `script-${Date.now()}`,
        title: input.title,
        rawContent: input.rawContent,
        sourceFormat: input.sourceFormat,
        segments: fullSegments,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }),

  /** Discuss a specific segment with AI — supports quick actions and image references */
  discussSegment: protectedProcedure
    .input(z.object({
      segment: z.object({
        id: z.string(),
        index: z.number(),
        rawText: z.string(),
        storyboard: z.object({
          sceneHeading: z.string(),
          visualDescription: z.string(),
          dialogue: z.string(),
          soundDesign: z.string(),
          cameraDirection: z.string(),
          duration: z.string(),
          mood: z.string(),
        }),
        discussion: z.array(z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string(),
          imageUrl: z.string().optional(),
          quickAction: z.string().optional(),
          timestamp: z.string(),
        })),
        status: z.enum(["pending", "draft", "refined", "approved"]),
      }),
      message: z.string().min(1),
      personality: z.enum(["calm", "creative", "technical"]).default("creative"),
      quickActionId: z.string().optional(),
      imageUrl: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const result = await discussSegmentWithAI(
        input.segment as ScriptSegment,
        input.message,
        input.personality,
        input.quickActionId,
        input.imageUrl,
      );
      return result;
    }),

  /** Get available quick actions for multi-modal discussion */
  quickActions: protectedProcedure.query(() => {
    return QUICK_ACTIONS;
  }),

  /** Export segments in various formats */
  exportScript: protectedProcedure
    .input(z.object({
      segments: z.array(z.object({
        id: z.string(),
        index: z.number(),
        rawText: z.string(),
        storyboard: z.object({
          sceneHeading: z.string(),
          visualDescription: z.string(),
          dialogue: z.string(),
          soundDesign: z.string(),
          cameraDirection: z.string(),
          duration: z.string(),
          mood: z.string(),
        }),
        costar: z.object({
          context: z.string(),
          situation: z.string(),
          task: z.string(),
          action: z.string(),
          result: z.string(),
          visualPrompt: z.string(),
          audioScript: z.string(),
          musicVibe: z.string(),
          proactiveQuestion: z.string().optional(),
        }).optional(),
        discussion: z.array(z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string(),
          imageUrl: z.string().optional(),
          quickAction: z.string().optional(),
          timestamp: z.string(),
        })),
        status: z.enum(["pending", "draft", "refined", "approved"]),
      })),
      format: z.enum(["json", "csv", "markdown", "fdx", "srt", "custom"]),
      customColumns: z.array(z.object({
        header: z.string(),
        field: z.string(),
      })).optional(),
      includeDiscussion: z.boolean().default(false),
      includeCostar: z.boolean().default(false),
      customTemplate: z.string().optional(),
    }))
    .mutation(({ input }) => {
      const content = generateExport(
        input.segments as ScriptSegment[],
        input.format,
        {
          customColumns: input.customColumns,
          includeDiscussion: input.includeDiscussion,
          includeCostar: input.includeCostar,
          customTemplate: input.customTemplate,
        },
      );
      return { content, format: input.format };
    }),

  /** Generate CO-STAR storyboard for a specific segment */
  generateSegmentCostar: protectedProcedure
    .input(z.object({
      segment: z.object({
        id: z.string(),
        index: z.number(),
        rawText: z.string(),
        storyboard: z.object({
          sceneHeading: z.string(),
          visualDescription: z.string(),
          dialogue: z.string(),
          soundDesign: z.string(),
          cameraDirection: z.string(),
          duration: z.string(),
          mood: z.string(),
        }),
      }),
      personality: z.enum(["calm", "creative", "technical"]).default("creative"),
    }))
    .mutation(async ({ input }) => {
      const persona = PERSONALITY_PROMPTS[input.personality] ?? PERSONALITY_PROMPTS.creative;
      const fullPrompt = buildDirectorSystemPrompt(input.personality);

      const result = await withTimeout(invokeLLM({
        messages: [
          {
            role: "system",
            content: `${fullPrompt}

根據以下分鏡段落資訊，生成完整的 CO-STAR 腳本結構。

分鏡資訊：
- 場景：${input.segment.storyboard.sceneHeading}
- 視覺：${input.segment.storyboard.visualDescription}
- 對白：${input.segment.storyboard.dialogue}
- 音效：${input.segment.storyboard.soundDesign}
- 鏡頭：${input.segment.storyboard.cameraDirection}
- 時長：${input.segment.storyboard.duration}
- 氛圍：${input.segment.storyboard.mood}

原始文本：${input.segment.rawText}

${persona.proactiveHint}`,
          },
          {
            role: "user",
            content: "請為這段分鏡生成完整的 CO-STAR 腳本。",
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
      }), 30_000, "分鏡 CO-STAR 生成");

      const content = result.choices[0]?.message?.content;
      try {
        return typeof content === "string" ? JSON.parse(content) : content;
      } catch {
        return { context: "", situation: "", task: "", action: "", result: "", visualPrompt: "", audioScript: "", musicVibe: "", proactiveQuestion: "" };
      }
    }),

  // ─── Quick Generation Pipeline ──────────────────────────────────────────

  /** Get available generation models grouped by modality for the model picker */
  generationModels: protectedProcedure.query(() => {
    const byCategory = getAllPricingByCategory();
    const relevantCategories: ModelCategory[] = [
      "text-to-image", "text-to-video", "text-to-audio", "text-to-speech",
    ];
    const result: Record<string, Array<{
      modelId: string;
      label: string;
      provider: string;
      tier: string;
      basePoints: number;
      unit: string;
      minPoints: number;
      maxPoints: number;
      pointsPerSecond?: number;
      pointsPer1kChars?: number;
      available: boolean;
    }>> = {};
    for (const cat of relevantCategories) {
      const models = byCategory[cat] ?? [];
      result[cat] = models.map(m => {
        const avail = checkModelAvailability(m.modelId);
        return {
          modelId: m.modelId,
          label: m.label,
          provider: m.provider,
          tier: m.tier,
          basePoints: m.basePoints,
          unit: m.unit,
          minPoints: m.minPoints,
          maxPoints: m.maxPoints,
          pointsPerSecond: m.pointsPerSecond,
          pointsPer1kChars: m.pointsPer1kChars,
          available: avail.available,
        };
      });
    }
    return result;
  }),

  /** Estimate generation cost for a segment with user-selected models */
  estimateSegmentCost: protectedProcedure
    .input(z.object({
      tasks: z.array(z.object({
        modality: z.enum(["image", "video", "audio", "voice"]),
        modelId: z.string(),
        durationSec: z.number().optional(),
        charCount: z.number().optional(),
      })),
    }))
    .query(({ input }) => {
      return input.tasks.map(task => {
        const estimate = estimatePoints(task.modelId, {
          durationSec: task.durationSec,
          charCount: task.charCount,
        });
        const pricing = getModelPricing(task.modelId);
        const avail = checkModelAvailability(task.modelId);
        return {
          modality: task.modality,
          modelId: task.modelId,
          modelLabel: pricing?.label ?? task.modelId,
          points: estimate.totalPoints,
          breakdown: estimate.breakdown,
          available: avail.available,
          availabilityNote: avail.reason,
        };
      });
    }),
});
