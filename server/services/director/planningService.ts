/**
 * Director long-script planning services.
 *
 * Extracted from server/routers/director.ts. Contains the 5-phase
 * planning loop helpers + emotional depth analyzer + their shared
 * prompt tables.
 *
 *   - discussPlanningPhase()  — phase-aware chat with cross-phase
 *     coherence and structured [反問] / [意圖卡] / json summary tail
 *   - analyzeEmotionalDepth() — per-scene emotional beat extraction +
 *     warmth score
 */

import { invokeLLM, extractMessageText } from "../../_core/llm";
import { buildMemoryContext } from "../ragMemory";
import { buildDirectorSystemPrompt } from "../siteKnowledge";
import { DIRECTOR_PERSONALITY_PROMPTS } from "./personality";
import { withTimeout, extractMessageJson } from "./templates";
import type {
  PlanningPhase,
  PlanningMessage,
  ScriptPlanningSession,
} from "../../../shared/types";

export const MAX_PLANNING_DISCUSSION_MESSAGES = 12;

export const PLANNING_PHASE_PROMPTS: Record<
  PlanningPhase,
  {
    systemGuide: string;
    warmthFocus: string;
  }
> = {
  concept: {
    systemGuide: `你正在幫助使用者進行「核心概念」階段的討論。
這是整個長腳本規劃的第一步，目標是釐清：
1. 核心主題 — 這個作品要傳達什麼？
2. 目標觀眾 — 誰最需要這個故事？
3. 核心情感 — 觀眾看完後應該帶走什麼感受？
4. 創作願景 — 你希望這個作品呈現什麼樣的風貌？

引導使用者慢慢思考，不要急著下結論。用溫暖的語氣探索他們內心真正想表達的東西。`,
    warmthFocus: `注意：在概念探索階段特別關注「溫度」— 這個故事背後有什麼個人經歷或感受？是什麼驅動了創作慾望？幫助使用者挖掘最真誠的動機。`,
  },
  outline: {
    systemGuide: `你正在幫助使用者進行「故事大綱」階段的討論。
在這個階段，需要建構：
1. 故事梗概 — 完整的故事弧線（開端→發展→高潮→結尾）
2. 情感弧線 — 觀眾的情緒旅程設計
3. 關鍵轉折點 — 讓故事有記憶點的轉折
4. 角色設計 — 每個角色的情感旅程

重點是讓故事有「呼吸感」，不要太密也不要太鬆。每個情節轉折都要有情感理由。`,
    warmthFocus: `注意：在大綱階段注重「深層敘事」— 每個角色行為背後的真實動機是什麼？觀眾什麼時候會產生共鳴？什麼場景能讓人「感同身受」？強調人性的溫柔面向。`,
  },
  "scene-planning": {
    systemGuide: `你正在幫助使用者進行「場景規劃」階段的討論。
逐場景深入設計：
1. 場景標題與描述
2. 情緒氛圍目標
3. 角色互動細節
4. 場景地點與時間
5. 預估時長
6. 特殊備註

每個場景都要服務於整體情感弧線。思考場景之間的過渡是否自然。`,
    warmthFocus: `注意：在場景規劃中特別關注「細節的溫度」— 一個角色的小動作、一束光線、一段沉默…這些微小的細節往往最能打動人心。鼓勵使用者思考每個場景中最「人性化」的一刻。`,
  },
  "emotional-depth": {
    systemGuide: `你正在幫助使用者進行「情感深度」分析與優化。
這是最重要的規劃階段，需要：
1. 情感節拍分析 — 每個場景的情感強度（1-10 分）
2. 溫度評估 — 故事整體的「溫暖感」是否足夠？
3. 深度洞察 — 哪些地方可以更深入？
4. 共鳴點識別 — 哪些場景最容易引起觀眾共鳴？
5. 療癒元素建議 — 如何加入更多療癒和撫慰的力量？

你的角色是一位富有同理心的戲劇顧問，幫助使用者讓作品更有溫度、更打動人心。`,
    warmthFocus: `核心任務：分析並增強「作品溫度」。溫度來自：
- 真實的情感表達（不是表面的煽情）
- 角色之間真誠的連結
- 給觀眾留下思考和感受的空間
- 不完美中的美好
- 安靜但有力量的時刻
提供具體、可執行的溫度提升建議。`,
  },
  schedule: {
    systemGuide: `你正在幫助使用者進行「排程整合」階段的規劃。
將前面所有的規劃成果轉化為可執行的製作排程：
1. 拆分製作里程碑
2. 估算每個階段所需時間
3. 識別優先順序和依賴關係
4. 建議團隊分工（如果適用）
5. 設定品質檢查點

排程應該留有充裕的創意調整空間，不要讓時間壓力犧牲作品品質。`,
    warmthFocus: `注意：排程規劃也要保持「療癒」精神 — 避免過度緊迫的時間安排，留出反思和調整的空間。好的作品需要沉澱的時間。建議加入「靈感休息日」。`,
  },
};

export async function discussPlanningPhase(
  phase: PlanningPhase,
  messages: PlanningMessage[],
  userMessage: string,
  personality: "calm" | "creative" | "technical",
  sessionContext?: {
    concept?: ScriptPlanningSession["concept"];
    outline?: ScriptPlanningSession["outline"];
    scenes?: ScriptPlanningSession["scenes"];
    emotionalBeats?: ScriptPlanningSession["emotionalBeats"];
  },
  userId?: number,
  brainConfig?: {
    model: string;
    temperature: number;
    topP: number;
    systemPrompt: string | null;
  }
): Promise<{
  reply: string;
  phaseSummary?: string;
  proactiveQuestion?: string;
  intentCard?: {
    intent: string;
    whyAsk: string;
    options: string[];
  };
}> {
  const persona =
    DIRECTOR_PERSONALITY_PROMPTS[personality] ??
    DIRECTOR_PERSONALITY_PROMPTS.creative;
  const phaseConfig = PLANNING_PHASE_PROMPTS[phase];
  const fullDirectorPrompt = buildDirectorSystemPrompt(personality);

  // Build context from previous phases
  const contextParts: string[] = [];

  if (sessionContext?.concept) {
    const c = sessionContext.concept;
    contextParts.push(`【已確立的核心概念】
主題：${c.theme}
目標觀眾：${c.targetAudience}
核心情感：${c.coreEmotion}
創作願景：${c.vision}`);
  }

  if (sessionContext?.outline) {
    const o = sessionContext.outline;
    contextParts.push(`【已建構的故事大綱】
梗概：${o.synopsis}
情感弧線：${o.emotionalArc}
關鍵轉折：${o.keyTurningPoints.join("→")}
角色：${o.characters.map(ch => `${ch.name}（${ch.role}）`).join("、")}`);
  }

  if (sessionContext?.scenes && sessionContext.scenes.length > 0) {
    const sceneSummary = sessionContext.scenes
      .map(
        (s, i) =>
          `#${i + 1} ${s.title}（${s.mood}）— ${s.emotionalGoal}`
      )
      .join("\n");
    contextParts.push(`【已規劃的場景列表】\n${sceneSummary}`);
  }

  if (
    sessionContext?.emotionalBeats &&
    sessionContext.emotionalBeats.length > 0
  ) {
    const beatsSummary = sessionContext.emotionalBeats
      .map(
        b =>
          `${b.label}：${b.emotion}（強度 ${b.intensity}/10）— ${b.warmthNote}`
      )
      .join("\n");
    contextParts.push(`【情感節拍分析】\n${beatsSummary}`);
  }

  // Cross-phase coherence: split messages into "from a prior phase" vs "current phase".
  // Messages tagged with a prior phase (or untagged messages that arrived from an
  // older API call before phase tagging was added) are surfaced as a cross-phase
  // narrative thread so the AI can maintain coherent continuity across all 5 stages.
  const PHASE_ORDER: PlanningPhase[] = [
    "concept",
    "outline",
    "scene-planning",
    "emotional-depth",
    "schedule",
  ];
  const currentPhaseIdx = PHASE_ORDER.indexOf(phase);

  // Separate cross-phase messages from current-phase messages.
  const crossPhaseMessages = messages.filter(
    m => m.phase && PHASE_ORDER.indexOf(m.phase) < currentPhaseIdx
  );
  const currentPhaseMessages = messages.filter(
    m => !m.phase || m.phase === phase
  );

  // Show at most the last MAX_CROSS_PHASE_MESSAGES cross-phase messages, grouped
  // by phase so the AI can follow the phase-to-phase narrative thread.
  const MAX_CROSS_PHASE_MESSAGES = 4;
  if (crossPhaseMessages.length > 0) {
    const phaseLabels: Record<PlanningPhase, string> = {
      concept: "核心概念",
      outline: "故事大綱",
      "scene-planning": "場景規劃",
      "emotional-depth": "情感深度",
      schedule: "排程整合",
    };
    // Group by phase (preserving order) and take last N per phase.
    const byPhase = new Map<PlanningPhase, PlanningMessage[]>();
    for (const m of crossPhaseMessages) {
      if (!m.phase) continue;
      if (!byPhase.has(m.phase)) byPhase.set(m.phase, []);
      byPhase.get(m.phase)!.push(m);
    }
    const crossPhaseLines: string[] = [];
    for (const [ph, msgs] of byPhase) {
      const lastMsgs = msgs.slice(-MAX_CROSS_PHASE_MESSAGES);
      const lines = lastMsgs
        .map(d => `  ${d.role === "user" ? "使用者" : "導演"}：${d.content}`)
        .join("\n");
      crossPhaseLines.push(`▸【${phaseLabels[ph]}階段的關鍵對話】\n${lines}`);
    }
    if (crossPhaseLines.length > 0) {
      contextParts.push(
        `\n【前面規劃階段的對話摘要（維持連貫性）】\n${crossPhaseLines.join("\n\n")}`
      );
    }
  }

  // Previous discussion for this phase
  const previousDiscussion = currentPhaseMessages
    .slice(-MAX_PLANNING_DISCUSSION_MESSAGES)
    .map(d => `${d.role === "user" ? "使用者" : "導演"}：${d.content}`)
    .join("\n");

  if (previousDiscussion) {
    contextParts.push(`\n【本階段先前的討論紀錄】\n${previousDiscussion}`);
  }

  // RAG memory：把使用者過往偏好餵進規劃討論的 system prompt
  let memorySection = "";
  if (userId != null) {
    try {
      const mem = await buildMemoryContext(userId, userMessage);
      if (mem) {
        memorySection = `\n\n【用戶歷史偏好記憶】\n${mem}\n請參考用戶的歷史偏好來調整規劃建議。`;
      }
    } catch {
      // RAG 不可用就靜默
    }
  }

  const result = await withTimeout(
    invokeLLM({
      runName: "director-planning-discuss",
      model: brainConfig?.model,
      temperature: brainConfig?.temperature,
      topP: brainConfig?.topP,
      systemPrompt: brainConfig?.systemPrompt,
      messages: [
        {
          role: "system",
          content: `${fullDirectorPrompt}

【長腳本規劃模式 — ${phase} 階段】

${phaseConfig.systemGuide}

${phaseConfig.warmthFocus}

${contextParts.length > 0 ? contextParts.join("\n\n") : "（這是規劃的開始，尚無先前資訊）"}

${persona.proactiveHint}${memorySection}

回覆規則：
1. 用溫暖、鼓勵的語氣引導使用者深入思考
2. 提供具體、可執行的建議，不要空泛
3. 適時提出引導性問題，幫助使用者挖掘更深層的想法
4. 如果使用者的想法可以更深入，溫和地引導他們思考「為什麼」
5. 慶祝每一個靈感的誕生，每一個想法都值得被珍惜
6. 回覆末尾如果有適合生成的摘要結構（如核心概念、大綱等），用 \`\`\`json 包裹
7. 回覆最後一行**必須**獨立輸出一個反問句，格式為 \`[反問] <你的引導性問題>\`，
   問題必須針對當前階段缺少的、使用者可深入補充的元素（例如缺少的角色動機、
   情感轉折、視覺意象等），用繁體中文且具體可回答
8. 回覆末尾另外獨立輸出一行意圖卡，格式：
   \`[意圖卡] {"intent":"...","whyAsk":"...","options":["選項1","選項2","選項3"]}\`
   - intent：你理解的使用者當前核心意圖（20字內）
   - whyAsk：為什麼現在要先問這個問題（35字內）
   - options：提供 2-3 個可直接回覆的方向（短句）
9. 【連貫性要求】若上方有「前面規劃階段的對話摘要」，務必在適當時機呼應
   先前階段已確立的核心概念、角色設定或情感方向，讓每個階段的討論彼此銜接、
   形成一條清晰的創作脈絡，而不是獨立的對話片段`,
        },
        {
          role: "user",
          content: userMessage,
        },
      ],
      maxTokens: 4096,
    }),
    45_000,
    "規劃討論"
  );

  const rawReply = extractMessageText(result.choices[0]?.message?.content);

  // 抽出 [反問] 行，作為結構化 proactiveQuestion；同時從 reply 主體中移除
  let proactiveQuestion: string | undefined;
  let intentCard:
    | {
        intent: string;
        whyAsk: string;
        options: string[];
      }
    | undefined;
  let replyText = rawReply;
  const questionMatch = rawReply.match(/^\s*\[反問\]\s*(.+?)\s*$/m);
  if (questionMatch) {
    proactiveQuestion = questionMatch[1].trim();
    replyText = rawReply.replace(questionMatch[0], "").trimEnd();
  }
  const intentCardMatch = rawReply.match(/^\s*\[意圖卡\]\s*(\{.+\})\s*$/m);
  if (intentCardMatch) {
    try {
      const parsed = JSON.parse(intentCardMatch[1]);
      if (
        parsed &&
        typeof parsed.intent === "string" &&
        typeof parsed.whyAsk === "string" &&
        Array.isArray(parsed.options)
      ) {
        intentCard = {
          intent: parsed.intent.trim(),
          whyAsk: parsed.whyAsk.trim(),
          options: parsed.options
            .filter((v: unknown) => typeof v === "string")
            .map((v: string) => v.trim())
            .filter(Boolean)
            .slice(0, 3),
        };
      }
    } catch {
      // ignore invalid intent-card json
    }
    replyText = replyText.replace(intentCardMatch[0], "").trimEnd();
  }

  // Try to extract structured summary from the reply
  let phaseSummary: string | undefined;
  const jsonMatch = replyText.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    phaseSummary = jsonMatch[1];
  }

  return { reply: replyText, phaseSummary, proactiveQuestion, intentCard };
}

export async function analyzeEmotionalDepth(
  scenes: ScriptPlanningSession["scenes"],
  concept: ScriptPlanningSession["concept"],
  outline: ScriptPlanningSession["outline"],
  personality: "calm" | "creative" | "technical",
  brainConfig?: {
    model: string;
    temperature: number;
    topP: number;
    systemPrompt: string | null;
  }
): Promise<{
  emotionalBeats: ScriptPlanningSession["emotionalBeats"];
  warmthScore: number;
  depthAnalysis: string;
}> {
  const persona =
    DIRECTOR_PERSONALITY_PROMPTS[personality] ??
    DIRECTOR_PERSONALITY_PROMPTS.creative;

  const sceneSummary = scenes
    .map(
      (s, i) =>
        `#${i + 1} 「${s.title}」\n描述：${s.description}\n氛圍：${s.mood}\n情感目標：${s.emotionalGoal}\n角色：${s.characters.join("、")}\n地點：${s.location}`
    )
    .join("\n\n");

  const conceptStr = concept
    ? `主題：${concept.theme}，核心情感：${concept.coreEmotion}，目標觀眾：${concept.targetAudience}`
    : "尚未定義";

  const outlineStr = outline
    ? `梗概：${outline.synopsis}\n情感弧線：${outline.emotionalArc}`
    : "尚未定義";

  const result = await withTimeout(
    invokeLLM({
      runName: "director-emotional-analysis",
      model: brainConfig?.model,
      temperature: brainConfig?.temperature,
      topP: brainConfig?.topP,
      systemPrompt: brainConfig?.systemPrompt,
      messages: [
        {
          role: "system",
          content: `${persona.directorStyle}

你是一位專精於「情感深度分析」的戲劇顧問。你的任務是分析一個長腳本規劃案的情感結構，評估其「溫度」和「深度」。

【核心概念】${conceptStr}
【故事大綱】${outlineStr}

【場景列表】
${sceneSummary}

請分析：
1. 每個場景的情感節拍（emotion、intensity 1-10、warmthNote 溫度建議）
2. 整體 warmthScore（1-10，10 是最溫暖）
3. 深度分析報告（哪些地方可以更深入、更有溫度）`,
        },
        {
          role: "user",
          content: "請為這個作品進行完整的情感深度分析。",
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "emotional_depth_analysis",
          strict: true,
          schema: {
            type: "object",
            properties: {
              emotionalBeats: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    sceneIndex: { type: "number" },
                    label: { type: "string" },
                    emotion: { type: "string" },
                    intensity: { type: "number" },
                    warmthNote: { type: "string" },
                  },
                  required: [
                    "label",
                    "emotion",
                    "intensity",
                    "warmthNote",
                  ],
                  additionalProperties: false,
                },
              },
              warmthScore: { type: "number" },
              depthAnalysis: { type: "string" },
            },
            required: ["emotionalBeats", "warmthScore", "depthAnalysis"],
            additionalProperties: false,
          },
        },
      },
    }),
    45_000,
    "情感深度分析"
  );

  const parsed = extractMessageJson(result.choices[0]?.message?.content) as
    | {
        emotionalBeats?: unknown;
        warmthScore?: unknown;
        depthAnalysis?: unknown;
      }
    | null;
  return {
    emotionalBeats: Array.isArray(parsed?.emotionalBeats)
      ? (parsed!.emotionalBeats as never[])
      : [],
    warmthScore:
      typeof parsed?.warmthScore === "number" ? parsed!.warmthScore : 5,
    depthAnalysis:
      typeof parsed?.depthAnalysis === "string" ? parsed!.depthAnalysis : "",
  };
}
