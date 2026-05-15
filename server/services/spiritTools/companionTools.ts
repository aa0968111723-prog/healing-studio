/**
 * server/services/spiritTools/companionTools.ts
 *
 * 暖暖 (companion) 的真實工具集 — 把「開放對話陪聊」精靈從
 * 「system prompt 嘴砲」升級成「會結構化讀出使用者情緒 / 整理意圖 /
 * 自己決定要不要交棒」的 AI agent。
 *
 * 之前的問題：
 *   - shared/agent-skills.ts:165 寫 `tools: []` → 暖暖沒有任何工具
 *   - 「識別情緒詞 → 對應回應」只在 prompt 字面要求 LLM 自己抓
 *   - 「不主動執行動作；使用者透露具體目標 → 交棒給導導」沒有結構
 *     化判斷，模糊訊號常常掉回 companion 一片靜默
 *
 * 本檔提供四個工具，全部走純函式（不寫 DB、無 fal 呼叫，無扣點），只讀：
 *   - detectMood(text)            — 從訊息抽出情緒標籤 + 強度 (0..1)
 *   - clarifyIntent(text, ctx)    — 把模糊訊息結構化成 (目標 / 模態 / 急迫)
 *   - recommendNextSpirit(...)    — 依結構化意圖挑下一棒精靈 + 打招呼語
 *   - calmBreak(mood, history)    — 偵測到沮喪 / 卡關時給 3 步穩定方案
 *
 * 設計原則：
 *   - 純函式 → 可以單元測試到所有路徑；不寫 DB / 不打外部 API
 *   - 訊號是「強訊號 + 弱訊號 + neutral」分層，避免假陽性
 *   - recommendNextSpirit 用 SPIRIT_COLLAB_PROTOCOL companion 的 handoffs
 *     當白名單，跟既有路由協定對齊；不亂 ping 不在白名單的精靈
 *   - calmBreak 不執行動作（呼叫端用 LLM 把建議念出來）— 暖暖的人格守則
 *     是「不主動執行」，工具只是給結構化資料讓 LLM 在 prompt 框架內回應
 */

import type { AgentRole } from "../../../shared/orb-agent-roles";

// ─── 情緒偵測 ─────────────────────────────────────────────────────────────

/** 我們關心的 6 種情緒桶 — 跟 system prompt 寫的「累/卡住/沒靈感/開心」對齊
 *  + 補上「焦慮 / 中性」兩個常見落點。`neutral` 是預設，不會主動交棒。 */
export type MoodLabel =
  | "tired"        // 累 / 疲倦 / 沒力
  | "stuck"        // 卡住 / 弄不出來 / 不會
  | "uninspired"   // 沒靈感 / 不知道做什麼
  | "anxious"      // 焦慮 / 趕 / 壓力大
  | "happy"        // 開心 / 興奮 / 滿意
  | "neutral";     // 預設

interface MoodKeywordRule {
  label: MoodLabel;
  /** 字串小寫後比對；substring match */
  keywords: readonly string[];
}

// 中文 + 英文 + 簡單口語都進清單。順序不影響（每條都掃過）；強訊號用
// 短的明確詞（例如「累」），弱訊號 / 長相鄰詞放後面也沒差。
const MOOD_KEYWORDS: MoodKeywordRule[] = [
  {
    label: "tired",
    keywords: [
      "累",
      "好累",
      "疲倦",
      "沒力",
      "想休息",
      "睡不飽",
      "tired",
      "exhausted",
      "burnt out",
      "burned out",
    ],
  },
  {
    label: "stuck",
    keywords: [
      "卡住",
      "卡關",
      "弄不出來",
      "做不出來",
      "不會做",
      "搞不定",
      "搞不懂",
      "不知道怎麼弄",
      "stuck",
      "blocked",
      "can't figure",
      "cant figure",
      "no idea how",
    ],
  },
  {
    label: "uninspired",
    keywords: [
      "沒靈感",
      "沒想法",
      "想不出來",
      "不知道做什麼",
      "找不到方向",
      "blank",
      "no inspiration",
      "no ideas",
      "uninspired",
      "out of ideas",
    ],
  },
  {
    label: "anxious",
    keywords: [
      "焦慮",
      "緊張",
      "趕時間",
      "趕著要",
      "好急",
      "壓力大",
      "壓力好大",
      "deadline",
      "急著",
      "stressed",
      "anxious",
      "rushed",
      "panicked",
      "overwhelmed",
    ],
  },
  {
    label: "happy",
    keywords: [
      "開心",
      "好開心",
      "興奮",
      "超讚",
      "太棒了",
      "終於",
      "滿意",
      "happy",
      "excited",
      "love it",
      "awesome",
      "amazing",
      "stoked",
    ],
  },
];

export interface DetectMoodInput {
  text: string;
}

export interface DetectMoodResult {
  /** 最強訊號的情緒；沒命中時為 "neutral" */
  primary: MoodLabel;
  /** 強度 0..1：命中關鍵字數 / 該情緒 max(1, ceil(keywords.length / 3))。
   *  > 0.66 = 強，0.33-0.66 = 中，< 0.33 = 弱。neutral 永遠 0。 */
  intensity: number;
  /** 命中的所有情緒（含 primary），依命中關鍵字數遞減；neutral 為空陣列 */
  signals: Array<{ label: MoodLabel; matchedKeywords: string[] }>;
  /** Hint：true 時 system prompt 應建議交棒給穩定情緒流程（呼叫 calmBreak） */
  shouldOfferCalmBreak: boolean;
}

/**
 * 從一段文字抽出主導情緒 + 強度。純 substring + count 計分，沒有 ML，
 * 但對 LLM 的提示來說已經是「結構化訊號」遠勝過「請你自己猜」。
 *
 * `shouldOfferCalmBreak` 規則：anxious / stuck / tired 三種負向情緒，
 * 任一達到 intensity >= 0.5 → 應該主動關懷。happy / uninspired 不會觸發
 * （uninspired 走的是 recommendNextSpirit → inspiration-specialist）。
 */
export function detectMood(input: DetectMoodInput): DetectMoodResult {
  const text = (input.text ?? "").toLowerCase();
  if (!text.trim()) {
    return {
      primary: "neutral",
      intensity: 0,
      signals: [],
      shouldOfferCalmBreak: false,
    };
  }

  const hits: Array<{ label: MoodLabel; matchedKeywords: string[] }> = [];
  for (const rule of MOOD_KEYWORDS) {
    const matched: string[] = [];
    for (const kw of rule.keywords) {
      if (text.includes(kw.toLowerCase())) matched.push(kw);
    }
    if (matched.length > 0) hits.push({ label: rule.label, matchedKeywords: matched });
  }

  if (hits.length === 0) {
    return {
      primary: "neutral",
      intensity: 0,
      signals: [],
      shouldOfferCalmBreak: false,
    };
  }

  hits.sort((a, b) => b.matchedKeywords.length - a.matchedKeywords.length);
  const top = hits[0];
  const rule = MOOD_KEYWORDS.find(r => r.label === top.label)!;
  const denom = Math.max(1, Math.ceil(rule.keywords.length / 3));
  const intensity = Math.min(1, top.matchedKeywords.length / denom);

  const negative: MoodLabel[] = ["anxious", "stuck", "tired"];
  const shouldOfferCalmBreak = negative.includes(top.label) && intensity >= 0.5;

  return {
    primary: top.label,
    intensity,
    signals: hits,
    shouldOfferCalmBreak,
  };
}

// ─── 意圖梳理 ─────────────────────────────────────────────────────────────

/** 暖暖看到一句模糊話時要結構化的三件事 */
export type IntentModality =
  | "image"
  | "video"
  | "music"
  | "voice"
  | "text"
  | "learning"
  | "navigation"
  | "unknown";

export type IntentUrgency = "low" | "normal" | "high";

export interface ClarifyIntentInput {
  text: string;
  /** 使用者目前所在頁路徑（可選）— 影響預設模態 */
  pagePath?: string | null;
}

export interface ClarifyIntentResult {
  /** 推測的主要模態 */
  modality: IntentModality;
  /** 推測的目標一句話（可能是空字串：意圖太模糊） */
  goalSummary: string;
  /** 急迫度 */
  urgency: IntentUrgency;
  /** 信心 0..1。< 0.4 表示「不確定 — 應該再問一個問題」 */
  confidence: number;
  /** 給 LLM 用的 2-3 個下一步建議（每個都對應一個可走的方向）。
   *  注意：暖暖人格守則是「不執行動作」，這只是建議；最終由使用者選。 */
  suggestedNextSteps: Array<{
    label: string;
    /** 建議交棒給哪位精靈（若是「先觀望」則為 null） */
    handoffTo: AgentRole | null;
    reason: string;
  }>;
}

// 弱訊號：純粹是把文字裡含「圖/影/音/聲/教/逛/趕」這些字眼提出來，
// 並沒有像 KEYWORD_RULES 那麼嚴格 — 因為暖暖場景就是「使用者還沒講清楚」。
const MODALITY_HINTS: ReadonlyArray<{
  modality: IntentModality;
  keywords: readonly string[];
}> = [
  { modality: "image", keywords: ["圖", "畫", "照片", "海報", "image", "picture", "photo", "draw"] },
  { modality: "video", keywords: ["影片", "影像", "短片", "動畫", "video", "clip", "animation"] },
  { modality: "music", keywords: ["音樂", "歌曲", "配樂", "bgm", "music", "song"] },
  { modality: "voice", keywords: ["配音", "旁白", "口播", "聲音", "voice", "narration"] },
  { modality: "text",  keywords: ["腳本", "文案", "標題", "稿", "script", "copy"] },
  { modality: "learning", keywords: ["教", "怎麼做", "怎麼用", "新手", "教學", "how to", "tutorial"] },
  { modality: "navigation", keywords: ["帶我", "去", "切到", "切換", "open", "go to", "navigate"] },
];

const URGENCY_HINTS = {
  high: ["趕", "急", "馬上", "今天就要", "等一下", "deadline", "asap", "urgent"],
  low:  ["再說", "之後", "有空", "改天", "慢慢來", "later", "someday"],
};

const PAGE_DEFAULT_MODALITY: Record<string, IntentModality> = {
  "/image-studio": "image",
  "/video-studio": "video",
  "/pro-studio": "music",
  "/models": "image",
  "/learn": "learning",
  "/learn-hub": "learning",
};

/** 從文字 + 當前頁面推測 modality / goal / urgency / confidence。 */
export function clarifyIntent(input: ClarifyIntentInput): ClarifyIntentResult {
  const text = (input.text ?? "").toLowerCase().trim();

  // 模態推測：先看文字命中，沒有再退到頁面預設。
  let modality: IntentModality = "unknown";
  let modalityHitCount = 0;
  for (const hint of MODALITY_HINTS) {
    let count = 0;
    for (const kw of hint.keywords) {
      if (text.includes(kw)) count++;
    }
    if (count > modalityHitCount) {
      modality = hint.modality;
      modalityHitCount = count;
    }
  }
  if (modality === "unknown" && input.pagePath) {
    modality = PAGE_DEFAULT_MODALITY[input.pagePath] ?? "unknown";
  }

  // 急迫度
  let urgency: IntentUrgency = "normal";
  if (URGENCY_HINTS.high.some(k => text.includes(k))) urgency = "high";
  else if (URGENCY_HINTS.low.some(k => text.includes(k))) urgency = "low";

  // 信心：文字長度 + 模態命中數 + 是否有動詞性詞語
  // 太短（< 6 字）通常是「嗨」「在嗎」這種純打招呼 → 低信心
  const charLen = text.length;
  let confidence: number;
  if (charLen < 6) confidence = 0.2;
  else if (modality === "unknown") confidence = 0.35;
  else if (modalityHitCount >= 2) confidence = 0.8;
  else confidence = 0.55;

  // 目標摘要：用文字本身的前 80 字（暖暖不重組句子，避免曲解）
  const goalSummary = text.length > 80 ? `${text.slice(0, 80)}…` : text;

  // 建議下一步
  const suggestedNextSteps = buildSuggestedNextSteps(modality, urgency, confidence);

  return {
    modality,
    goalSummary,
    urgency,
    confidence,
    suggestedNextSteps,
  };
}

function buildSuggestedNextSteps(
  modality: IntentModality,
  urgency: IntentUrgency,
  confidence: number
): ClarifyIntentResult["suggestedNextSteps"] {
  // 高急迫度即使信心不足也應主動把導導 / 靈靈推到最前面 —
  // 對方在喊「趕著要 deadline」時，繼續陪聊不是體貼是失職。
  if (urgency === "high" && modality === "unknown") {
    return [
      { label: "直接讓導導幫你拆 3 步搞定", handoffTo: "director", reason: "急 → 跳過陪聊直接動工" },
      { label: "看一個現成範例直接套", handoffTo: "inspiration-specialist", reason: "省時間用站內素材" },
    ];
  }

  // 信心不足時：給 3 個「探路型」選項，全部回到對話 — 不主動執行。
  if (confidence < 0.4) {
    return [
      {
        label: "陪你慢慢說想做什麼",
        handoffTo: null,
        reason: "對方還沒講清楚，暖暖留下繼續陪聊",
      },
      {
        label: "看看其他人都在做什麼",
        handoffTo: "inspiration-specialist",
        reason: "用站內靈感庫給方向",
      },
      {
        label: "從新手導覽開始",
        handoffTo: "learning-specialist",
        reason: "完全沒概念時先有個地圖",
      },
    ];
  }

  // 信心夠 → 對應模態給具體下一步。
  switch (modality) {
    case "image":
      return [
        { label: "馬上試一張", handoffTo: "image-specialist", reason: "圖圖直接出一張看效果" },
        { label: "先看 3 個風格參考", handoffTo: "inspiration-specialist", reason: "靈靈先丟靈感避免白做" },
        { label: "規劃一整套素材", handoffTo: "director", reason: "如果想要一系列 → 導導排計畫" },
      ];
    case "video":
      return [
        { label: "做一支短影片", handoffTo: "video-specialist", reason: "影影接手出 5-10 秒" },
        { label: "先寫腳本再拍", handoffTo: "director", reason: "影片要連貫先讓導導排" },
        { label: "看 1 個成品範例", handoffTo: "inspiration-specialist", reason: "靈靈丟參考更省力" },
      ];
    case "music":
      return [
        { label: "配一段 BGM", handoffTo: "music-specialist", reason: "音音直接配" },
        { label: "找風格參考", handoffTo: "inspiration-specialist", reason: "靈靈先給方向" },
      ];
    case "voice":
      return [
        { label: "錄一段試試", handoffTo: "voice-specialist", reason: "聲聲接手做 demo" },
        { label: "先寫稿", handoffTo: "director", reason: "稿要先有導導排" },
      ];
    case "text":
      return [
        { label: "讓導導幫你排腳本 / 大綱", handoffTo: "director", reason: "文字產出由導導擅長拆步驟" },
        { label: "先看寫法示範", handoffTo: "quality-coach", reason: "巧巧給可貼進去的改寫範例" },
      ];
    case "learning":
      return [
        { label: "帶你到教學中心", handoffTo: "learning-specialist", reason: "學學帶你看主題" },
        { label: "找新手導覽", handoffTo: "onboarding-coach", reason: "帶帶一步一步陪走" },
      ];
    case "navigation":
      return [
        { label: "直接帶你過去", handoffTo: "navigator", reason: "路路只負責帶路" },
      ];
    case "unknown":
    default:
      return [
        { label: "陪你想一想要做什麼", handoffTo: null, reason: "保留 companion，繼續探" },
        { label: "看看靈感庫", handoffTo: "inspiration-specialist", reason: "靈靈丟方向" },
        { label: "規劃一條完整工作流", handoffTo: "director", reason: "等你想清楚再開動" },
      ];
  }
}

// ─── 交棒推薦 ─────────────────────────────────────────────────────────────

export interface RecommendNextSpiritInput {
  text: string;
  /** 由 detectMood 輸出的 primary（可選；省略時暖暖只看意圖） */
  mood?: MoodLabel;
  /** 使用者所在頁面（可選） */
  pagePath?: string | null;
  /** 使用者已 mute 的精靈 — 不會被推薦 */
  mutedSpirits?: readonly AgentRole[];
}

export interface RecommendNextSpiritResult {
  /** null = 暖暖建議留著繼續陪聊（不交棒） */
  handoffTo: AgentRole | null;
  /** 給 LLM 的接手語句模板。`{nickname}` 在呼叫端被替換成精靈暱稱 */
  greetingTemplate: string;
  /** 信心 0..1 */
  confidence: number;
  /** 為什麼推這位 */
  reason: string;
}

// 跟 SPIRIT_COLLAB_PROTOCOL["companion"] 對齊的白名單。暖暖只能交棒給
// 這幾位（其他需要先經過導導 / 總總 中介）。重複放在這裡是為了讓本
// 工具不需要 import 整個 SPIRIT_COLLAB_PROTOCOL，保持純函式輕量。
const COMPANION_HANDOFF_WHITELIST: ReadonlySet<AgentRole> = new Set<AgentRole>([
  "director",
  "navigator",
  "inspiration-specialist",
  "learning-specialist",
  "onboarding-coach",
  "image-specialist",
  "video-specialist",
  "music-specialist",
  "voice-specialist",
  "quality-coach",
]);

/**
 * 根據意圖 + 情緒 + 頁面挑下一棒精靈。暖暖自己不執行動作 — 這個工具
 * 只回「建議交給誰」+ 一句現成的招呼，呼叫端用 LLM 把它念出來。
 *
 * 邏輯順序：
 *   1. 情緒沮喪 / 焦慮 → 暖暖自己留下（return null），不交棒
 *   2. 顯式 modality → 對應 specialist（先濾掉 muted）
 *   3. 學習語意 → learning-specialist or onboarding-coach
 *   4. 都不命中 → null（留在 companion）
 */
export function recommendNextSpirit(
  input: RecommendNextSpiritInput
): RecommendNextSpiritResult {
  const muted = new Set<AgentRole>(input.mutedSpirits ?? []);
  const allow = (role: AgentRole): role is AgentRole =>
    COMPANION_HANDOFF_WHITELIST.has(role) && !muted.has(role);

  // Step 1：負向情緒 → 留下陪
  if (input.mood === "anxious" || input.mood === "tired") {
    return {
      handoffTo: null,
      greetingTemplate: "暖暖陪你慢一點 🌿 不用急著決定。",
      confidence: 0.7,
      reason: `mood=${input.mood} → keep companion, offer calmBreak`,
    };
  }

  const intent = clarifyIntent({ text: input.text, pagePath: input.pagePath });

  // Step 2：信心夠的明確模態
  if (intent.confidence >= 0.55) {
    const firstStep = intent.suggestedNextSteps.find(
      s => s.handoffTo !== null && allow(s.handoffTo)
    );
    if (firstStep && firstStep.handoffTo) {
      return {
        handoffTo: firstStep.handoffTo,
        greetingTemplate: greetingFor(firstStep.handoffTo),
        confidence: intent.confidence,
        reason: firstStep.reason,
      };
    }
  }

  // Step 3：學習語意 (uninspired mood 也走這條 — 沒靈感先給靈感庫)
  if (input.mood === "uninspired") {
    if (allow("inspiration-specialist")) {
      return {
        handoffTo: "inspiration-specialist",
        greetingTemplate: greetingFor("inspiration-specialist"),
        confidence: 0.6,
        reason: "mood=uninspired → 先讓靈靈丟方向",
      };
    }
  }

  // Step 4：留下繼續陪聊
  return {
    handoffTo: null,
    greetingTemplate: "暖暖在這 🌿 想做東西、想先逛逛、還是只是來透氣？哪一個都可以。",
    confidence: 0.3,
    reason: "no clear signal — stay on companion",
  };
}

function greetingFor(role: AgentRole): string {
  switch (role) {
    case "image-specialist": return "暖暖陪你開好了 — 圖圖接手 🎨 我幫你叫他過來。";
    case "video-specialist": return "暖暖陪你開好了 — 影影接手 🎬 我幫你叫他過來。";
    case "music-specialist": return "暖暖陪你開好了 — 音音接手 🎵 我幫你叫他過來。";
    case "voice-specialist": return "暖暖陪你開好了 — 聲聲接手 🎙️ 我幫你叫他過來。";
    case "director":          return "暖暖陪你想完了 — 導導接手 🎯 我幫你叫他來排計畫。";
    case "navigator":         return "暖暖知道你想去哪了 — 路路接手 🧳 帶你過去。";
    case "inspiration-specialist": return "暖暖建議先看一下靈感 — 靈靈接手 💡 我幫你叫他來。";
    case "learning-specialist":    return "暖暖陪你看入門 — 學學接手 📚 我幫你叫他過來。";
    case "onboarding-coach":       return "暖暖知道有點卡 — 帶帶接手 🤝 一步一步來。";
    case "quality-coach":          return "暖暖請巧巧來看一下 — 巧巧接手 ✨";
    default: return "暖暖在這 🌿 慢慢說就好。";
  }
}

// ─── 穩定情緒 ─────────────────────────────────────────────────────────────

export interface CalmBreakInput {
  mood: MoodLabel;
  /** 對話輪次（>= 6 時暖暖會建議「換個對話房間」） */
  turnCount?: number;
}

export interface CalmBreakStep {
  title: string;
  body: string;
}

export interface CalmBreakResult {
  /** 三步穩定方案 */
  steps: CalmBreakStep[];
  /** 是否該建議使用者開新對話（對話太長、上下文塞滿時 = true） */
  shouldSuggestNewConversation: boolean;
  /** 給 LLM 用的開場一句話 */
  opening: string;
}

const CALM_PRESETS: Record<MoodLabel, { opening: string; steps: CalmBreakStep[] }> = {
  anxious: {
    opening: "我感覺到你有點趕、有點緊 — 暖暖陪你先把節奏放慢三十秒。",
    steps: [
      {
        title: "1. 把這 30 秒當成休息",
        body: "閉上眼或看遠方一下，吸氣四秒、停一秒、吐氣六秒，連三次。深呼吸不會耽誤事情。",
      },
      {
        title: "2. 只挑「最小可交付」",
        body: "把這次任務拆成「現在 30 分內能完成的最小版本」— 不是完美版。暖暖可以叫導導幫你列。",
      },
      {
        title: "3. 截止前我每 10 分提醒一次",
        body: "如果你急到不行，告訴我 deadline，我安排記記每 10 分鐘 nudge 一下進度。",
      },
    ],
  },
  stuck: {
    opening: "卡住了不是你的問題 — 暖暖陪你拆三步看看。",
    steps: [
      {
        title: "1. 講出來卡哪裡",
        body: "用一句話告訴我「你想做的」+「目前卡在哪一步」。光講出來常常就半解了。",
      },
      {
        title: "2. 看一個成功範例",
        body: "我請靈靈丟 2 個類似情境的成品給你 — 通常一看到就知道差在哪。",
      },
      {
        title: "3. 換一個小目標",
        body: "如果還是過不去，先換 30 秒可完成的小任務（一張草稿圖、一句旁白）暖身。",
      },
    ],
  },
  tired: {
    opening: "好像有點累了 — 暖暖建議今天先放一下。",
    steps: [
      {
        title: "1. 存起來明天再說",
        body: "我請記記把現在的進度存成草稿；明天打開就接得回來，不會白費。",
      },
      {
        title: "2. 只做一件小事",
        body: "如果還是想做，挑「一鍵就出來」的：例如靈靈丟 3 張靈感給你看，不用動腦。",
      },
      {
        title: "3. 起身 5 分再回來",
        body: "離開椅子走一走、喝點水；5 分鐘後再決定要繼續還是收工。",
      },
    ],
  },
  uninspired: {
    opening: "沒靈感很正常 — 暖暖叫靈靈丟方向給你看。",
    steps: [
      {
        title: "1. 看 5 張別人做的",
        body: "我叫靈靈端 5 張不同風格給你 — 不用喜歡，只是讓眼睛醒過來。",
      },
      {
        title: "2. 從一個小元素出發",
        body: "挑一張裡你喜歡的「一個小元素」（一個顏色、一個姿勢、一個鏡頭）— 從這個開始。",
      },
      {
        title: "3. 寫一句『我想做的不是 ___』",
        body: "倒著想往往比正著想快；告訴我你不想做的，我幫你框出你想做的。",
      },
    ],
  },
  happy: {
    opening: "聽起來狀態很好 — 暖暖建議趁勢往下做。",
    steps: [
      {
        title: "1. 趁手感乘勝追擊",
        body: "趁狀態好馬上做下一個小目標：再出一張、再寫一段、再剪一秒。",
      },
      {
        title: "2. 記下這個感覺",
        body: "請記記把這個狀態下的提示詞 / 設定存成筆記；下次卡住可以倒帶。",
      },
    ],
  },
  neutral: {
    opening: "暖暖在這 🌿 慢慢來。",
    steps: [
      {
        title: "1. 告訴我你今天想幹嘛",
        body: "想做東西、先逛逛、還是只是來透氣？哪一個都可以。",
      },
    ],
  },
};

/**
 * 給定情緒 + 對話長度，回 3 步穩定方案。內容不會直接送 LLM —
 * 呼叫端會把這份結構化輸出包進 system prompt slice，讓 LLM 念出來。
 */
export function calmBreak(input: CalmBreakInput): CalmBreakResult {
  const preset = CALM_PRESETS[input.mood] ?? CALM_PRESETS.neutral;
  const shouldSuggestNewConversation = (input.turnCount ?? 0) >= 6;
  return {
    opening: preset.opening,
    steps: preset.steps,
    shouldSuggestNewConversation,
  };
}
