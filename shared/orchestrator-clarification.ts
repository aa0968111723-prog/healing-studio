/**
 * shared/orchestrator-clarification.ts
 *
 * Intent clarification system specifically for chief-orchestrator (總總).
 * When total does not have enough information to properly delegate tasks,
 * this module generates context-aware clarification questions with options.
 *
 * 總總的職責：理解使用者意圖 → 規劃工作流 → 委派給適當的精靈
 * 但前提是「意圖要夠明確」— 這個模組負責在意圖模糊時，反問使用者。
 */

export interface IntentClarity {
  /** Overall clarity score (0-1). < 0.7 triggers clarification. */
  score: number;
  /** Which key dimensions are missing or ambiguous. */
  missingDimensions: IntentDimension[];
  /** Suggested clarification questions for each missing dimension. */
  suggestedQuestions: Array<{
    dimension: IntentDimension;
    question: string;
    options: string[];
  }>;
}

export type IntentDimension =
  | "goal" // 最終交付物是什麼？（影片/圖片/campaign/workflow）
  | "scope" // 單一資產還是多步驟專案？
  | "timeline" // 急件還是有規劃時間？
  | "budget" // 成本敏感還是品質優先？
  | "complexity"; // 一位精靈能處理還是需要編排？

export interface OrchestratorContext {
  /** User's original message */
  userMessage: string;
  /** Optional: previous clarifications in this conversation */
  previousAnswers?: Record<IntentDimension, string>;
  /** Optional: user's historical preferences */
  rememberedPreferences?: {
    preferredQuality?: "cost_sensitive" | "balanced" | "quality_first";
    usualProjectSize?: "single_asset" | "multi_step" | "campaign";
    typicalTimeline?: "urgent" | "planned" | "exploratory";
  };
}

/**
 * Analyze user intent clarity for chief-orchestrator.
 * Returns clarity score and missing dimensions.
 */
export function analyzeOrchestratorIntent(ctx: OrchestratorContext): IntentClarity {
  const { userMessage, rememberedPreferences = {} } = ctx;
  const previousAnswers: Partial<Record<IntentDimension, string>> =
    ctx.previousAnswers ?? {};
  const text = userMessage.toLowerCase();

  // Dimension detection logic
  const dimensions = {
    goal: detectGoal(text, previousAnswers.goal),
    scope: detectScope(text, previousAnswers.scope, rememberedPreferences.usualProjectSize),
    timeline: detectTimeline(text, previousAnswers.timeline, rememberedPreferences.typicalTimeline),
    budget: detectBudget(text, previousAnswers.budget, rememberedPreferences.preferredQuality),
    complexity: detectComplexity(text, previousAnswers.complexity),
  };

  // Calculate clarity score (weighted average)
  const weights = {
    goal: 0.35, // Most important - must know what to deliver
    scope: 0.25, // Second most important - affects orchestration strategy
    complexity: 0.20, // Third - determines if handoff needed
    timeline: 0.10, // Less critical - can default to "planned"
    budget: 0.10, // Least critical - can default to "balanced"
  };

  const score =
    dimensions.goal * weights.goal +
    dimensions.scope * weights.scope +
    dimensions.timeline * weights.timeline +
    dimensions.budget * weights.budget +
    dimensions.complexity * weights.complexity;

  // Identify missing dimensions (confidence < 0.7)
  const missingDimensions: IntentDimension[] = [];
  const suggestedQuestions: IntentClarity["suggestedQuestions"] = [];

  (Object.keys(dimensions) as IntentDimension[]).forEach(dim => {
    if (dimensions[dim] < 0.7) {
      missingDimensions.push(dim);
      const question = generateClarificationQuestion(dim, ctx);
      if (question) {
        suggestedQuestions.push(question);
      }
    }
  });

  return {
    score,
    missingDimensions,
    suggestedQuestions,
  };
}

/**
 * Detect if user specified a clear goal (deliverable type).
 * Returns confidence 0-1.
 */
function detectGoal(text: string, previousAnswer?: string): number {
  if (previousAnswer) return 1.0;

  const goalKeywords = {
    video: /影片|短片|video|reel|vlog|mv|微電影|宣傳片|廣告片/,
    image: /圖片|圖像|海報|封面|插畫|主視覺|banner|image|poster|illustration/,
    music: /音樂|配樂|bgm|歌曲|主題曲|music|soundtrack/,
    voice: /配音|旁白|voice|narration|tts|口白/,
    script: /腳本|劇本|文案|script|copy/,
    campaign: /活動|campaign|企劃案|行銷方案|social campaign|系列|一整套/,
    workflow: /流程|工作流|workflow|多步驟|自動化|pipeline/,
  };

  for (const [, pattern] of Object.entries(goalKeywords)) {
    if (pattern.test(text)) return 0.9; // High confidence when explicit keyword found
  }

  // Check for action verbs that imply creation
  if (/做|製作|產生|生成|創作|設計|幫我/.test(text)) {
    return 0.4; // Medium-low confidence - knows user wants to create something
  }

  return 0.1; // Very unclear goal
}

/**
 * Detect scope (single asset vs multi-step project).
 * Returns confidence 0-1.
 */
function detectScope(
  text: string,
  previousAnswer?: string,
  remembered?: "single_asset" | "multi_step" | "campaign"
): number {
  if (previousAnswer) return 1.0;
  if (remembered) return 0.6; // Remembered preference gives medium confidence

  const singleAssetMarkers = /一張|一支|一段|一首|單一|just one|single/;
  const multiStepMarkers = /整套|系列|完整|一條龍|多個|多支|end.?to.?end|complete package|series/;
  const campaignMarkers = /活動|campaign|企劃|專案|project|完整方案/;

  if (campaignMarkers.test(text)) return 0.85;
  if (multiStepMarkers.test(text)) return 0.8;
  if (singleAssetMarkers.test(text)) return 0.75;

  // Long messages often imply complex multi-step needs
  if (text.length > 150) return 0.5;

  return 0.3; // Unclear scope
}

/**
 * Detect timeline urgency.
 * Returns confidence 0-1.
 */
function detectTimeline(
  text: string,
  previousAnswer?: string,
  remembered?: "urgent" | "planned" | "exploratory"
): number {
  if (previousAnswer) return 1.0;
  if (remembered) return 0.5;

  const urgentMarkers = /急|趕|馬上|立刻|今天|明天|urgent|asap|right now|immediately/;
  const plannedMarkers = /慢慢|不急|規劃|安排|預計|計畫|planned|schedule|later/;
  const exploratoryMarkers = /看看|試試|探索|研究|玩玩|just exploring|checking out|想了解/;

  if (urgentMarkers.test(text)) return 0.9;
  if (plannedMarkers.test(text)) return 0.85;
  if (exploratoryMarkers.test(text)) return 0.8;

  // Default to "planned" assumption with low confidence
  return 0.4;
}

/**
 * Detect budget sensitivity (cost vs quality preference).
 * Returns confidence 0-1.
 */
function detectBudget(
  text: string,
  previousAnswer?: string,
  remembered?: "cost_sensitive" | "balanced" | "quality_first"
): number {
  if (previousAnswer) return 1.0;
  if (remembered) return 0.5;

  const costSensitiveMarkers = /便宜|省|節省|經濟|free|cheap|save money|budget/;
  const qualityFirstMarkers = /頂級|最好|高品質|不計成本|premium|best quality|high.?end|top.?tier/;

  if (qualityFirstMarkers.test(text)) return 0.85;
  if (costSensitiveMarkers.test(text)) return 0.8;

  // Default to "balanced" with low confidence
  return 0.3;
}

/**
 * Detect task complexity (can single spirit handle it?).
 * Returns confidence 0-1.
 */
function detectComplexity(text: string, previousAnswer?: string): number {
  if (previousAnswer) return 1.0;

  const complexityIndicators = {
    simple: /一張圖|單純|簡單|just a|simple|quick/,
    moderate: /完整|整套|搭配|配上|with|complete|full/,
    complex: /工作流|自動化|系列|活動|campaign|workflow|pipeline|整個專案/,
  };

  if (complexityIndicators.complex.test(text)) return 0.9;
  if (complexityIndicators.moderate.test(text)) return 0.85;
  if (complexityIndicators.simple.test(text)) return 0.8;

  // Multiple creation keywords suggests complexity
  const creationCount = (text.match(/做|產生|生成|設計|製作/g) || []).length;
  if (creationCount >= 3) return 0.7;
  if (creationCount === 2) return 0.6;

  return 0.35; // Unclear complexity
}

/**
 * Generate a specific clarification question with options for a dimension.
 */
function generateClarificationQuestion(
  dimension: IntentDimension,
  ctx: OrchestratorContext
): IntentClarity["suggestedQuestions"][0] | null {
  const topic = extractSimpleTopic(ctx.userMessage);

  switch (dimension) {
    case "goal":
      return {
        dimension: "goal",
        question: "想做什麼類型的成品？這決定我該找哪位精靈幫你。",
        options: topic
          ? [
              `${topic}的影片（15-60 秒）`,
              `${topic}的圖片或海報`,
              `${topic}的完整企劃案（圖+影+文案）`,
              `${topic}的配樂或旁白`,
            ]
          : [
              "一支短影片（15-60 秒）",
              "一張圖片或海報",
              "一整套企劃（圖+影+文案）",
              "配樂或配音",
            ],
      };

    case "scope":
      return {
        dimension: "scope",
        question: "這是單一資產，還是需要跨頁串起來的多步驟專案？",
        options: [
          "單一成品（一張圖 / 一支影片）",
          "2-3 個資產（如：海報+短影音）",
          "完整 campaign（圖+影+文案+排程）",
          "自訂工作流程（我說幾步就幾步）",
        ],
      };

    case "timeline":
      return {
        dimension: "timeline",
        question: "時間上有急迫性嗎？這影響我會用快速模型還是精細模型。",
        options: [
          "急件（1 小時內要看到初稿）",
          "今天或明天完成即可",
          "有規劃時間（這週內）",
          "只是先探索靈感，不急著產出",
        ],
      };

    case "budget":
      return {
        dimension: "budget",
        question: "預算考量？成本敏感的話我會優先推薦省點數的模型。",
        options: [
          "成本優先（用最省點數的模型）",
          "平衡品質與成本",
          "品質優先（用最好的模型，點數其次）",
          "先給建議，我再決定",
        ],
      };

    case "complexity":
      return {
        dimension: "complexity",
        question: "需要多位精靈協作，還是單一精靈就能搞定？",
        options: [
          "單一精靈處理（如：只要圖圖出一張圖）",
          "2-3 位精靈接力（如：圖圖→品品→編編）",
          "我來統籌整個團隊（需要總總編排）",
          "不確定，總總你判斷",
        ],
      };

    default:
      return null;
  }
}

/**
 * Extract a simple 1-2 word topic from user message for question templating.
 */
function extractSimpleTopic(text: string): string | null {
  // Remove common filler words
  let cleaned = text.replace(/幫我|請|我想|我要|做|製作|生成|產生/g, " ").trim();

  // Extract first meaningful noun phrase (CJK)
  const match = cleaned.match(/[一-鿿]{1,6}/);
  if (match && match[0].length >= 2) {
    return match[0];
  }

  // Fallback: English noun
  const enMatch = cleaned.match(/[a-zA-Z]{3,12}/);
  return enMatch ? enMatch[0] : null;
}

/**
 * Format clarification as IntentCardOptions-compatible structure.
 * Used by chat router to render clarification cards.
 *
 * 單維度策略：每次只問一個維度 (2-4 chip)，而不是把 top 3 維度疊成
 * 最多 12 chip 的密牆。維度優先序依 weights 排（goal > scope > complexity
 * > timeline > budget），最高權重 missing 的維度先問。後續維度等使用者
 * 回完這題下一輪再追問——這跟多步驟代理 wizard 的「ONE question per turn」
 * 一致，避免使用者面對手機 UI 上 12 顆 chip 不知從何選起。
 */
export function formatOrchestratorClarificationOptions(
  clarity: IntentClarity
): Array<{ key: string; title: string; description: string; pick: string }> {
  if (clarity.suggestedQuestions.length === 0) return [];

  // Priority by intent-clarity weights (matches analyzeOrchestratorIntent).
  const DIMENSION_PRIORITY: Record<IntentDimension, number> = {
    goal: 5,
    scope: 4,
    complexity: 3,
    timeline: 2,
    budget: 1,
  };

  // Pick the single highest-priority missing dimension.
  const sorted = [...clarity.suggestedQuestions].sort(
    (a, b) => (DIMENSION_PRIORITY[b.dimension] ?? 0) - (DIMENSION_PRIORITY[a.dimension] ?? 0)
  );
  const q = sorted[0];
  if (!q) return [];

  return q.options.slice(0, 4).map((option, optIndex) => ({
    key: `1${String.fromCharCode(65 + optIndex)}`, // 1A / 1B / 1C / 1D
    title: option,
    description: q.question,
    pick: `[總總澄清/${q.dimension}]: ${option}`,
  }));
}

/**
 * Compute the clarification threshold for a given user — adapts to their
 * remembered preferences so熟練 power-users don't get badgered with
 * questions for routine tasks, while first-time / campaign-scale users
 * still get the structured wizard treatment.
 *
 * Base threshold is 0.7 (clarify when intent clarity < 0.7). Each signal
 * nudges it by ±0.05–0.10, clamped to [0.50, 0.85] so we never disable
 * clarification entirely nor force it for every message.
 *
 *   • usualProjectSize='single_asset'     → -0.10  (single-shot users can dispatch faster)
 *   • usualProjectSize='campaign'         → +0.10  (large projects deserve more questions)
 *   • typicalTimeline='urgent'            → -0.10  (急件 users hate being asked)
 *   • typicalTimeline='exploratory'       → +0.05  (探索心態 — extra structure helps)
 *   • preferredQuality='quality_first'    → +0.05  (品質優先 — confirm details)
 *   • preferredQuality='cost_sensitive'   → -0.05  (省點數 — fewer LLM hops)
 */
export function clarificationThresholdFor(ctx: OrchestratorContext): number {
  const prefs = ctx.rememberedPreferences ?? {};
  let threshold = 0.7;
  if (prefs.usualProjectSize === "single_asset") threshold -= 0.10;
  else if (prefs.usualProjectSize === "campaign") threshold += 0.10;
  if (prefs.typicalTimeline === "urgent") threshold -= 0.10;
  else if (prefs.typicalTimeline === "exploratory") threshold += 0.05;
  if (prefs.preferredQuality === "quality_first") threshold += 0.05;
  else if (prefs.preferredQuality === "cost_sensitive") threshold -= 0.05;
  return Math.max(0.5, Math.min(0.85, threshold));
}

/**
 * Check if user message should trigger chief-orchestrator's clarification.
 * Returns true if message is too vague for confident delegation.
 *
 * Threshold is adaptive — see clarificationThresholdFor. Power-users with
 * a history of single-asset urgent dispatches get a lower bar; new /
 * campaign-scale users get a higher one.
 */
export function shouldChiefOrchestratorClarify(ctx: OrchestratorContext): boolean {
  const clarity = analyzeOrchestratorIntent(ctx);
  return clarity.score < clarificationThresholdFor(ctx);
}

/**
 * Build a conversational clarification message from chief-orchestrator.
 * Returns the question text + options that should be shown to user.
 */
export function buildOrchestratorClarificationMessage(
  clarity: IntentClarity
): { message: string; options: ReturnType<typeof formatOrchestratorClarificationOptions> } {
  const dimensionNames: Record<IntentDimension, string> = {
    goal: "交付物類型",
    scope: "專案範圍",
    timeline: "時間安排",
    budget: "預算考量",
    complexity: "協作需求",
  };

  const options = formatOrchestratorClarificationOptions(clarity);
  // 單維度模式：只提這一輪在問的維度，下一輪會再追問下一個。讓使用者一次
  // 看一個重點，而不是「目前不太確定 A、B、C」這種讓人一進來就被五題包圍的開場。
  const askingPick = options[0]?.pick.match(/\[總總澄清\/([\w]+)\]/);
  const askingDim = (askingPick?.[1] as IntentDimension | undefined) ?? clarity.missingDimensions[0];
  const askingName = askingDim ? dimensionNames[askingDim] : null;
  const remainingCount = Math.max(0, clarity.missingDimensions.length - 1);
  const tail = remainingCount > 0
    ? `回完這題我會再追問剩 ${remainingCount} 個重點——一次一題比較好決定。`
    : `回完這題就能直接開跑了。`;

  const message = askingName
    ? `我是總總 🎩 聽到你的需求了。先確認一個重點：**${askingName}**。${tail}`
    : `我是總總 🎩 聽到你的需求了。挑一個最接近的選項就好。`;

  return { message, options };
}
