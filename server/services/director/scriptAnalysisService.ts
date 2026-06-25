/**
 * Director script analysis services.
 *
 * Extracted from server/routers/director.ts. Contains:
 *   - parseScriptIntoSegments() — long-form script splitter into
 *     storyboard segments (json_schema output)
 *   - discussSegmentWithAI()    — segment-level chat with optional
 *     quick action prompt, image reference, and adjacent-segment
 *     continuity context
 *
 * Both take everything via args (no closure state on the router) so
 * the move is a literal cut.
 */

import { invokeLLM, extractMessageText } from "../../_core/llm";
import type { ScriptSegment } from "../../../shared/types";
import { DIRECTOR_PERSONALITY_PROMPTS } from "./personality";
import {
  withTimeout,
  extractMessageJson,
  QUICK_ACTIONS,
} from "./templates";

/** Maximum characters sent to LLM for script analysis (LLM context window budget) */
export const SCRIPT_ANALYSIS_MAX_CHARS = 15_000;

export async function parseScriptIntoSegments(
  rawContent: string,
  sourceFormat: string,
  personality: "calm" | "creative" | "technical",
  brainConfig?: {
    model: string;
    temperature: number;
    topP: number;
    systemPrompt: string | null;
  }
): Promise<Omit<ScriptSegment, "discussion" | "status">[]> {
  const persona =
    DIRECTOR_PERSONALITY_PROMPTS[personality] ??
    DIRECTOR_PERSONALITY_PROMPTS.creative;
  const truncatedContent = rawContent.slice(0, SCRIPT_ANALYSIS_MAX_CHARS);

  // Format-specific parsing hints for better AI analysis
  const formatHints: Record<string, string> = {
    srt: `來源是 SRT 字幕檔。請注意：
- 每組字幕有序號、時間碼（HH:MM:SS,mmm --> HH:MM:SS,mmm）和文字
- 連續的字幕組可能屬於同一場景，請根據內容和時間間隔判斷場景切換
- 利用時間碼計算每段的真實時長
- 字幕文字可能是對白、旁白或場景描述`,
    fdx: `來源是 Final Draft (.fdx) XML 格式。請注意：
- Scene Heading（場景標題）標記場景切換
- Action（動作描述）包含視覺描述
- Dialogue（對白）包含角色對話
- Parenthetical（括號說明）包含表演指示
- Transition（轉場）標記場景之間的轉換方式`,
    screenplay: `來源是劇本格式（Fountain 或標準劇本格式）。請注意：
- INT./EXT. 開頭的行是場景標題（含場景位置和時間）
- 全大寫的名字後接冒號是角色名和對白
- 縮排的行可能是動作描述或舞台指示
- FADE IN/FADE OUT/CUT TO 是轉場標記`,
    novel: `來源是小說或散文格式。請注意：
- 段落切換、章節標記作為自然分段點
- 對話用引號標記，需要從敘述中提取
- 場景描述融合在敘事中，需要你主動提煉視覺元素
- 注意情緒氛圍的文學描寫，轉化為具體的影像語言`,
    storyboard: `來源是分鏡表格式。請注意：
- 可能已有分段結構，保留原始分段邏輯
- 每段可能包含鏡號、畫面描述、對白、音效、時長等欄位
- 直接映射對應欄位，不需要重新分段`,
    plaintext: `來源是純文字。請根據內容特徵自動判斷格式類型，依據以下線索分段：
- 空行、分隔線、序號等作為分段標記
- 語義轉折、場景變換、時間跳轉作為邏輯分段點
- 如果內容偏敘事性，按情節節點分段
- 如果內容偏技術性，按步驟或主題分段`,
  };

  const formatInstruction = formatHints[sourceFormat] ?? formatHints.plaintext;

  const result = await withTimeout(
    invokeLLM({
      runName: "director-script-split",
      model: brainConfig?.model,
      temperature: brainConfig?.temperature,
      topP: brainConfig?.topP,
      systemPrompt: brainConfig?.systemPrompt,
      messages: [
        {
          role: "system",
          content: `${persona.directorStyle}

你是一位專業的腳本分析師。你的任務是將使用者匯入的長腳本拆分為獨立的分鏡段落。

${formatInstruction}

分段原則：
1. 根據場景切換、敘事節點、情緒轉折等自然斷點拆分
2. 每段應有獨立的視覺場景，避免將多個場景混在一段
3. 對白密集的段落可以按角色互動回合分段
4. 保持每段時長合理（通常 5-60 秒，特殊場景可更長）
5. 提取每段出現的角色名稱和場景地點

每個段落需要包含：
- sceneHeading: 場景標題（如 INT. 咖啡廳 - 日，或根據內容自擬精準的場景名）
- visualDescription: 詳細的視覺描述（畫面內容、光影、構圖、色調）
- dialogue: 對白內容（若有多角色，以「角色名：對白」格式呈現）
- soundDesign: 音效/音樂描述（環境音、音效層次、配樂風格）
- cameraDirection: 鏡頭運動建議（鏡頭角度、運動方式、景別）
- duration: 預估時長（如「15秒」「1分30秒」）
- mood: 情緒氛圍（用 2-3 個關鍵詞描述）
- rawText: 這段對應的原始腳本文字
- characters: 這段出現的角色名稱陣列
- locations: 這段的場景地點陣列

輸出 JSON 格式：一個段落陣列。確保所有欄位都填寫完整，即使需要從上下文推斷。`,
        },
        {
          role: "user",
          content: `請分析以下腳本並拆分為分鏡段落：\n\n<user_script>\n${truncatedContent}\n</user_script>`,
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
                    characters: { type: "array", items: { type: "string" } },
                    locations: { type: "array", items: { type: "string" } },
                  },
                  required: [
                    "sceneHeading",
                    "visualDescription",
                    "dialogue",
                    "soundDesign",
                    "cameraDirection",
                    "duration",
                    "mood",
                    "rawText",
                    "characters",
                    "locations",
                  ],
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
    }),
    90_000,
    "腳本分析"
  );

  // Fence-tolerant — Gemini json_object mode sometimes ships ```json fences.
  // 同時容忍 array 形式 content，避免被誤當成 parsed object 而吃空 segments。
  const extracted = extractMessageJson(result.choices[0]?.message?.content);
  const parsed: {
    segments: Array<{
      sceneHeading: string;
      visualDescription: string;
      dialogue: string;
      soundDesign: string;
      cameraDirection: string;
      duration: string;
      mood: string;
      rawText: string;
      characters: string[];
      locations: string[];
    }>;
  } =
    extracted && typeof extracted === "object"
      ? (extracted as never)
      : { segments: [] };

  const segments = parsed.segments ?? [];
  const segCount = segments.length || 1;
  // Split rawContent into roughly equal paragraph-aligned chunks as fallback
  const paragraphs = rawContent.split(/\n{2,}/);
  const chunkSize = Math.ceil(paragraphs.length / segCount);

  return segments.map((seg, idx) => ({
    id: `seg-${Date.now()}-${idx}`,
    index: idx,
    rawText:
      seg.rawText ||
      paragraphs.slice(idx * chunkSize, (idx + 1) * chunkSize).join("\n\n"),
    storyboard: {
      sceneHeading: seg.sceneHeading,
      visualDescription: seg.visualDescription,
      dialogue: seg.dialogue,
      soundDesign: seg.soundDesign,
      cameraDirection: seg.cameraDirection,
      duration: seg.duration,
      mood: seg.mood,
    },
    characters: seg.characters ?? [],
    locations: seg.locations ?? [],
  }));
}

export async function discussSegmentWithAI(
  segment: ScriptSegment,
  userMessage: string,
  personality: "calm" | "creative" | "technical",
  quickActionId?: string,
  imageUrl?: string,
  adjacentSegments?: { prev?: ScriptSegment; next?: ScriptSegment },
  brainConfig?: {
    model: string;
    temperature: number;
    topP: number;
    systemPrompt: string | null;
  }
): Promise<{ reply: string; updatedStoryboard?: ScriptSegment["storyboard"] }> {
  const persona =
    DIRECTOR_PERSONALITY_PROMPTS[personality] ??
    DIRECTOR_PERSONALITY_PROMPTS.creative;
  const quickAction = quickActionId
    ? QUICK_ACTIONS.find(a => a.id === quickActionId)
    : undefined;

  const contextParts = [
    `【目前分鏡 #${segment.index + 1} 資訊】`,
    `場景：${segment.storyboard.sceneHeading}`,
    `視覺：${segment.storyboard.visualDescription}`,
    `對白：${segment.storyboard.dialogue}`,
    `音效：${segment.storyboard.soundDesign}`,
    `鏡頭：${segment.storyboard.cameraDirection}`,
    `時長：${segment.storyboard.duration}`,
    `氛圍：${segment.storyboard.mood}`,
  ];

  // Include character and location info if available
  if (segment.characters?.length) {
    contextParts.push(`角色：${segment.characters.join("、")}`);
  }
  if (segment.locations?.length) {
    contextParts.push(`場景地點：${segment.locations.join("、")}`);
  }

  // Include CO-STAR data if already generated — gives AI richer context
  if (segment.costar) {
    contextParts.push(`\n【已生成的 CO-STAR 結構】`);
    contextParts.push(`背景：${segment.costar.context}`);
    contextParts.push(`情境：${segment.costar.situation}`);
    contextParts.push(`視覺提示詞：${segment.costar.visualPrompt}`);
    contextParts.push(`音樂風格：${segment.costar.musicVibe}`);
  }

  if (segment.rawText) {
    contextParts.push(`\n【原始腳本段落】\n${segment.rawText}`);
  }

  // Adjacent segment context for continuity awareness
  if (adjacentSegments?.prev) {
    const p = adjacentSegments.prev;
    contextParts.push(
      `\n【前一段分鏡 #${p.index + 1}】場景：${p.storyboard.sceneHeading} / 氛圍：${p.storyboard.mood} / 時長：${p.storyboard.duration}`
    );
    if (p.storyboard.cameraDirection)
      contextParts.push(`前段鏡頭：${p.storyboard.cameraDirection}`);
  }
  if (adjacentSegments?.next) {
    const n = adjacentSegments.next;
    contextParts.push(
      `\n【後一段分鏡 #${n.index + 1}】場景：${n.storyboard.sceneHeading} / 氛圍：${n.storyboard.mood} / 時長：${n.storyboard.duration}`
    );
  }

  if (imageUrl) {
    // 提示 LLM 注意附帶圖片；實際圖片本身會以 ImageContent block 形式接在
    // user message content array 上（見下方 effectiveContent），讓視覺能力
    // 模型（gemini-2.5-pro vision / claude-3.5 / gpt-4o）真的看到圖片，
    // 而不只是讀到一個 URL 字串。
    contextParts.push(
      `\n【使用者附上了參考圖片】請參考下方附帶的圖片風格、構圖或色調來調整建議。`
    );
  }

  // Increased from 6 to 10 for richer conversation context
  const previousDiscussion = segment.discussion
    .slice(-10)
    .map(d => `${d.role === "user" ? "使用者" : "導演"}：${d.content}`)
    .join("\n");

  if (previousDiscussion) {
    contextParts.push(`\n【先前討論紀錄】\n${previousDiscussion}`);
  }

  if (segment.notes) {
    contextParts.push(`\n【使用者筆記】\n${segment.notes}`);
  }

  const effectiveMessage = quickAction
    ? `${quickAction.promptTemplate}\n\n使用者補充：${userMessage || "（無額外補充）"}`
    : userMessage;

  // 多模態 user message：附參考圖時改送 [text, image_url] array，讓視覺
  // 能力模型真的能「看到」使用者的參考圖；無圖時保留純字串以與沒升級的
  // engine 路徑相容。
  const effectiveContent: string | Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = imageUrl
    ? [
        { type: "text", text: effectiveMessage || "（請參考附圖）" },
        { type: "image_url", image_url: { url: imageUrl } },
      ]
    : effectiveMessage;

  const result = await withTimeout(
    invokeLLM({
      runName: "director-segment-chat",
      model: brainConfig?.model,
      temperature: brainConfig?.temperature,
      topP: brainConfig?.topP,
      systemPrompt: brainConfig?.systemPrompt,
      messages: [
        {
          role: "system",
          content: `${persona.directorStyle}

你正在與使用者逐段討論一份長腳本的分鏡。你的角色是專業的導演 AI，幫助使用者優化每個分鏡段落。

<user_storyboard_context>
${contextParts.join("\n")}
</user_storyboard_context>

回覆規則：
1. 根據使用者的指示提供具體、可執行的建議
2. 如果涉及跨段落的連續性議題，參考前後段資訊作出建議
3. 如果你認為分鏡需要修改，請在回覆末尾附上修改後的分鏡 JSON（用 \`\`\`json 包裹），包含完整的 7 個欄位
4. 如果不需要修改分鏡結構，只需要提供文字回覆即可
5. 在建議中使用具體數值和專業術語（如鏡頭名稱、光線類型、色彩方案代碼）`,
        },
        {
          role: "user",
          content: effectiveContent,
        },
      ],
      maxTokens: 4096,
    }),
    45_000,
    "分鏡討論"
  );

  const replyText = extractMessageText(result.choices[0]?.message?.content);

  // Try to extract updated storyboard JSON from the reply
  let updatedStoryboard: ScriptSegment["storyboard"] | undefined;
  const jsonMatch = replyText.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed.sceneHeading || parsed.visualDescription) {
        updatedStoryboard = {
          sceneHeading: parsed.sceneHeading ?? segment.storyboard.sceneHeading,
          visualDescription:
            parsed.visualDescription ?? segment.storyboard.visualDescription,
          dialogue: parsed.dialogue ?? segment.storyboard.dialogue,
          soundDesign: parsed.soundDesign ?? segment.storyboard.soundDesign,
          cameraDirection:
            parsed.cameraDirection ?? segment.storyboard.cameraDirection,
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
