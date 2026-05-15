/**
 * server/services/spiritTools/anatomySpecialistTools.ts
 *
 * Tools for the anatomy-specialist (體體) spirit — 專做人體解剖圖 /
 * 醫學插圖 / 骨骼肌肉示意。對應 orb-agent-roles.ts:1454-1464 的角色定位。
 *
 * 本檔的歷史：之前是 templated 占位（header 還誤寫成「解解」），第一版
 * rewrite 把 buildAnatomyPrompt / nextClarification / labelChecklist 三件
 * 純函式接上，但仍偏「prompt 字串組合器」而非真正的 agent。
 *
 * 這次升級把體體從「prompt 組合器」變成「真正的 AI agent」：
 *
 *   1. parseAnatomyIntent       — 從中文 / 英文自然語句抽結構化欄位
 *      （bodyPart / view / style / purpose），讓編排端不用每次都先做
 *      4 輪 clarification。
 *   2. buildAnatomyPrompt       — （原有）結構化欄位 → 寫實精準 prompt
 *   3. nextClarificationQuestion — （改寫）只問還缺的欄位，並可接受已知
 *      free text 先預填，避免問已知答案。
 *   4. buildMultiViewBatch      — 教學 / 標註用途常需要 anterior + posterior +
 *      lateral（+ cross-section）一次出。回傳一組 prompts 給 dispatcher
 *      平行打。
 *   5. verifyAnatomyResult      — 給定圖檔（或上游 vision 模型偵測到的）
 *      標籤集，比對該部位的期望重點，回 score + 缺漏 + actionable advice。
 *      educational-content workflow 的 anatomy-check 步驟原本 tools:[]
 *      就是要接這個。
 *   6. recommendAnatomyModels   — 不只回單一推薦，回 2-3 個 ranked 替代
 *      （含 img2img / reference-image 場景的調整）。
 *   7. summarizeAnatomyRequest  — 把結構化請求壓成一行中文（chat UI 顯示）
 *   8. getLabelChecklistForPart — （原有）部位 → 期望標註重點清單
 *
 * 設計守則：
 *   - 全部純函式，**不寫 DB、不打 LLM、不打 fal.ai**。實際出圖仍交給
 *     studio.generateImage / spiritDispatcher 走 fal 端。
 *   - 中英雙語關鍵字 — 體體要能聽懂「骨骼」「skeleton」「骨架」「skeletal
 *     system」全部寫法。
 *   - 失敗模式可預期：parser 找不到欄位就回 partial（不丟 throw），
 *     verify 找不到偵測標籤就照樣比對（empty 標籤集 → score 0）。
 */

import { logger } from "../../_core/logger";

export type AnatomyBodyPart =
  | "full-body"
  | "head"
  | "skeleton"
  | "muscular"
  | "nervous"
  | "vascular"
  | "internal-organs"
  | "limbs";

export type AnatomyView =
  | "anterior"
  | "posterior"
  | "lateral"
  | "superior"
  | "inferior"
  | "cross-section";

export type AnatomyStyle =
  | "medical-textbook"
  | "3d-render"
  | "hand-drawn"
  | "simplified-diagram";

export type AnatomyPurpose =
  | "teaching"
  | "labeling"
  | "reference"
  | "artistic";

const BODY_PART_PROMPT: Record<AnatomyBodyPart, string> = {
  "full-body": "human full body",
  head: "human head",
  skeleton: "human skeletal system",
  muscular: "human muscular system",
  nervous: "human nervous system",
  vascular: "human vascular system",
  "internal-organs": "human internal organs",
  limbs: "human limbs",
};

const VIEW_PROMPT: Record<AnatomyView, string> = {
  anterior: "anterior view",
  posterior: "posterior view",
  lateral: "lateral view",
  superior: "superior view",
  inferior: "inferior view",
  "cross-section": "cross-sectional view",
};

const STYLE_PROMPT: Record<AnatomyStyle, string> = {
  "medical-textbook":
    "medical textbook style, clean line art, white background, scientific accuracy",
  "3d-render":
    "high-detail 3D anatomical render, soft studio lighting, neutral background",
  "hand-drawn":
    "hand-drawn anatomical sketch, ink + watercolour, plate-style illustration",
  "simplified-diagram":
    "simplified educational diagram, flat colours, bold labels, infographic style",
};

const PURPOSE_PROMPT: Record<AnatomyPurpose, string> = {
  teaching: "educational purpose, clearly labeled, pedagogical layout",
  labeling: "labeled diagram with leader lines, anatomical terminology",
  reference: "high-fidelity anatomical reference, neutral pose",
  artistic: "stylised anatomical illustration suitable for artistic study",
};

const KEY_LABELS_BY_PART: Record<AnatomyBodyPart, string[]> = {
  "full-body": ["主要區段（頭/頸/軀幹/上肢/下肢）", "正中線", "比例尺"],
  head: ["顱骨主要骨骼", "面部肌群", "腦神經出口"],
  skeleton: ["顱骨", "脊柱（頸/胸/腰/薦）", "上肢骨", "下肢骨", "胸廓"],
  muscular: ["主要肌群（胸/背/上臂/下肢）", "起點 / 止點", "深淺層分層"],
  nervous: ["中樞（腦 + 脊髓）", "周邊神經幹", "神經叢"],
  vascular: ["主動脈與分支", "靜脈回流", "微血管網（如需要）"],
  "internal-organs": ["位置（上/中/下腔）", "毗鄰關係", "切面方向"],
  limbs: ["長骨", "關節", "主要肌腱", "神經血管走向"],
};

const RECOMMENDED_MODEL_BY_STYLE: Record<AnatomyStyle, string> = {
  // 寫實精度高 → FLUX Pro
  "medical-textbook": "fal-ai/flux-pro/v1.1",
  // 3D 質感 → SD3.5 + 醫學 LoRA（若無 LoRA 仍可用 SD3.5）
  "3d-render": "fal-ai/stable-diffusion-v35-large",
  // 手繪風 → SeeDream 對東方插畫敏感，但寫實線稿仍以 FLUX Pro 較穩
  "hand-drawn": "fal-ai/flux-pro/v1.1",
  // 簡化圖示 → Imagen 4 乾淨光感最適合品牌 / 教材
  "simplified-diagram": "fal-ai/imagen4/preview",
};

// 部位偵測：把使用者輸入的關鍵字（中 / 英 / 異名）映射回 AnatomyBodyPart。
// 順序意義：先匹配到的優先。複合關鍵字（例如「骨骼肌肉」）放在單詞前
// 不需要 — 在 parse 階段我們對整段文字逐 entry 掃描，命中第一個即可。
const BODY_PART_KEYWORDS: Array<readonly [AnatomyBodyPart, readonly string[]]> = [
  // 骨頭 / 骨骼相關 — 含異名「骨架」
  ["skeleton", ["骨骼", "骨架", "骨頭", "skeleton", "skeletal", "bone"] as const],
  // 肌肉相關
  ["muscular", ["肌肉", "肌群", "muscle", "muscular"] as const],
  // 神經
  ["nervous", ["神經", "nerve", "nervous", "spinal cord", "brain stem"] as const],
  // 血管 / 心血管（注意「心」單字會跟「內臟」打架 — 心血管走 vascular）
  ["vascular", ["血管", "心血管", "動脈", "靜脈", "vessel", "vascular", "artery", "vein"] as const],
  // 內臟（心、肝、腎、肺...）
  [
    "internal-organs",
    ["內臟", "臟器", "胸腔", "腹腔", "器官", "心臟", "肺", "肝", "腎", "胃", "腸", "organ", "viscera", "thoracic", "abdominal"] as const,
  ],
  // 四肢 / 手 / 腳
  ["limbs", ["四肢", "上肢", "下肢", "手臂", "腿", "limb", "arm", "leg"] as const],
  // 頭 / 顱
  ["head", ["頭部", "頭", "顱", "head", "skull", "cranial", "face"] as const],
  // 全身（放最後當 fallback；要寫得明顯才命中）
  ["full-body", ["全身", "整個人體", "whole body", "full body"] as const],
];

const VIEW_KEYWORDS: Array<readonly [AnatomyView, readonly string[]]> = [
  ["cross-section", ["剖面", "切面", "斷面", "橫切", "縱切", "cross-section", "cross section", "sagittal", "coronal"] as const],
  ["anterior", ["前面", "正面", "前視", "anterior", "front"] as const],
  ["posterior", ["後面", "背面", "後視", "posterior", "back"] as const],
  ["lateral", ["側面", "側視", "lateral", "side"] as const],
  ["superior", ["上面", "頂視", "superior", "top"] as const],
  ["inferior", ["下面", "底視", "inferior", "bottom"] as const],
];

const STYLE_KEYWORDS: Array<readonly [AnatomyStyle, readonly string[]]> = [
  ["medical-textbook", ["教科書", "醫學教科書", "教材", "textbook", "medical textbook", "clinical"] as const],
  ["3d-render", ["3D", "三維", "立體", "3d render", "three-d"] as const],
  ["hand-drawn", ["手繪", "插畫", "水彩", "手稿", "hand-drawn", "watercolor", "sketch"] as const],
  ["simplified-diagram", ["簡化", "示意", "資訊圖", "infographic", "diagram", "simplified"] as const],
];

const PURPOSE_KEYWORDS: Array<readonly [AnatomyPurpose, readonly string[]]> = [
  ["teaching", ["教學", "教育", "上課", "課堂", "teach", "education", "lecture", "student"] as const],
  ["labeling", ["標註", "標籤", "label", "annotation", "annotated"] as const],
  ["reference", ["參考", "reference", "ref", "model sheet"] as const],
  ["artistic", ["藝術", "創作", "美學", "藝用解剖", "artistic", "art study"] as const],
];

export interface AnatomyPromptInput {
  bodyPart: AnatomyBodyPart;
  view: AnatomyView;
  style: AnatomyStyle;
  purpose: AnatomyPurpose;
  /** 額外語意修飾（e.g.「only female」「pediatric」） */
  extraDescriptors?: string[];
}

export interface AnatomyPromptResult {
  success: true;
  /** 可直接送到 studio.generateImage 的英文 prompt */
  prompt: string;
  /** 建議 negative prompt — 避免常見的非解剖式美化 */
  negativePrompt: string;
  /** 推薦的 fal model id（單一首選；要看 ranked 替代見 recommendAnatomyModels） */
  recommendedModel: string;
  /** 建議 batch 數，精確要求高的 case 多出幾張供使用者挑 */
  recommendedBatch: number;
  /** 該部位通常會標註的重點，供使用者檢查圖是否完整 */
  keyLabels: string[];
}

/**
 * 把粗略的「我要前面看的骨骼圖、教學用、textbook 風格」轉成
 * 一段可直接送進 fal.ai 的 medical-grade 提示詞。
 */
export function buildAnatomyPrompt(
  input: AnatomyPromptInput,
): AnatomyPromptResult {
  const segments = [
    "anatomical illustration",
    `of ${BODY_PART_PROMPT[input.bodyPart]}`,
    VIEW_PROMPT[input.view],
    STYLE_PROMPT[input.style],
    PURPOSE_PROMPT[input.purpose],
    "medical accuracy",
    ...(input.extraDescriptors ?? []),
  ];

  const prompt = segments.filter(s => s.trim().length > 0).join(", ");

  // 非解剖類的「美化」副作用是醫學插圖最常見的問題 — 例如過度光影、
  // 模特兒姿勢、戲劇感。寫進 negative 避免模型亂加。
  const negativePrompt = [
    "cartoonish",
    "anime style",
    "dramatic lighting",
    "model pose",
    "fashion shoot",
    "stylized proportions",
    "blurry",
    "text artifacts",
  ].join(", ");

  return {
    success: true,
    prompt,
    negativePrompt,
    recommendedModel: RECOMMENDED_MODEL_BY_STYLE[input.style],
    // 教學 / 標註用途精確度要求最高，多出幾張讓使用者挑最準的。
    recommendedBatch:
      input.purpose === "teaching" || input.purpose === "labeling" ? 4 : 2,
    keyLabels: KEY_LABELS_BY_PART[input.bodyPart],
  };
}

export interface AnatomyClarificationQuestion {
  field: keyof AnatomyPromptInput;
  question: string;
  options: string[];
}

/**
 * 體體 system prompt 要求「主動問」而非讓使用者瞎猜選項。
 * 給定使用者目前已知的欄位，回傳下一個該問的問題與選項清單。
 * 全部欄位都填好則回 null（呼叫端就可以送 buildAnatomyPrompt）。
 *
 * 改進：如果呼叫端傳 freeText（例如使用者上一句話），先用
 * parseAnatomyIntent 萃出可推得的欄位，再決定要問什麼 —
 * 避免問「要哪個部位」當使用者剛才已經說「骨骼」。
 */
export function nextClarificationQuestion(
  partial: Partial<AnatomyPromptInput>,
  options?: { freeText?: string },
): AnatomyClarificationQuestion | null {
  // 若有 freeText，先補進 partial（已填欄位不覆寫）
  const merged: Partial<AnatomyPromptInput> = { ...partial };
  if (options?.freeText) {
    const inferred = parseAnatomyIntent(options.freeText);
    for (const key of ["bodyPart", "view", "style", "purpose"] as const) {
      if (merged[key] == null && inferred[key] != null) {
        // narrow assignment by key — TS can't infer cross-key, but inferred[key]
        // is exactly the right element type for merged[key].
        (merged as Record<string, unknown>)[key] = inferred[key];
      }
    }
  }

  if (!merged.bodyPart) {
    return {
      field: "bodyPart",
      question: "要哪個部位？",
      options: [
        "全身 (full-body)",
        "頭部 (head)",
        "骨骼 (skeleton)",
        "肌肉 (muscular)",
        "神經 (nervous)",
        "血管 (vascular)",
        "內臟 (internal-organs)",
        "四肢 (limbs)",
      ],
    };
  }
  if (!merged.view) {
    return {
      field: "view",
      question: "從哪個視角看？",
      options: [
        "前面 (anterior)",
        "後面 (posterior)",
        "側面 (lateral)",
        "上面 (superior)",
        "下面 (inferior)",
        "剖面 (cross-section)",
      ],
    };
  }
  if (!merged.purpose) {
    return {
      field: "purpose",
      question: "圖要做什麼用？",
      options: [
        "教學 (teaching)",
        "標註 (labeling)",
        "參考 (reference)",
        "藝術創作 (artistic)",
      ],
    };
  }
  if (!merged.style) {
    return {
      field: "style",
      question: "想要哪種風格？",
      options: [
        "醫學教科書風 (medical-textbook)",
        "3D 渲染 (3d-render)",
        "手繪插畫 (hand-drawn)",
        "簡化示意圖 (simplified-diagram)",
      ],
    };
  }
  return null;
}

/**
 * 回傳使用者上傳一張既有解剖圖時，體體可給的「標註重點檢查清單」。
 * 純文字 — 不打 LLM，給 UI 排成 checklist 用。
 */
export function getLabelChecklistForPart(part: AnatomyBodyPart): string[] {
  const labels = KEY_LABELS_BY_PART[part];
  logger.debug("anatomy_label_checklist_requested", { part });
  return labels;
}

// ─── parseAnatomyIntent — 從自然語句抽結構化欄位 ──────────────────────────

/**
 * 從中文 / 英文自由文本抽 AnatomyPromptInput 的可推得欄位。
 *
 * 不丟 throw — 找不到對應欄位就略過，呼叫端可把回傳的 partial 丟給
 * nextClarificationQuestion 繼續問。設計上 idempotent：把回傳值再丟回
 * 同一個函式得到相同結果。
 *
 * 規則：對每個欄位的 keyword 表，命中第一個對應 enum 即填入。view / style /
 * purpose 都可能在同句出現多個關鍵字（e.g.「教學用、簡化示意」），
 * 命中順序依 KEYWORDS 表內順序為主，避免不穩定的 set ordering。
 */
export function parseAnatomyIntent(text: string): Partial<AnatomyPromptInput> {
  const lower = text.toLowerCase();
  const result: Partial<AnatomyPromptInput> = {};

  for (const [part, keys] of BODY_PART_KEYWORDS) {
    if (keys.some(k => lower.includes(k.toLowerCase()))) {
      result.bodyPart = part;
      break;
    }
  }
  for (const [view, keys] of VIEW_KEYWORDS) {
    if (keys.some(k => lower.includes(k.toLowerCase()))) {
      result.view = view;
      break;
    }
  }
  for (const [style, keys] of STYLE_KEYWORDS) {
    if (keys.some(k => lower.includes(k.toLowerCase()))) {
      result.style = style;
      break;
    }
  }
  for (const [purpose, keys] of PURPOSE_KEYWORDS) {
    if (keys.some(k => lower.includes(k.toLowerCase()))) {
      result.purpose = purpose;
      break;
    }
  }
  return result;
}

// ─── buildMultiViewBatch — 一次出多視角（教學 / 標註常用） ────────────────

export interface AnatomyMultiViewInput {
  bodyPart: AnatomyBodyPart;
  style: AnatomyStyle;
  purpose: AnatomyPurpose;
  /** 要包含哪些視角；省略則用該部位的合理預設組合 */
  views?: AnatomyView[];
  extraDescriptors?: string[];
}

export interface AnatomyMultiViewResult {
  success: true;
  /** 該部位的標籤檢查清單（共用） */
  keyLabels: string[];
  /** 推薦的 fal model id（整批用同一個維持風格一致） */
  recommendedModel: string;
  /** 一批 prompts，每個 view 對應一筆，呼叫端可平行送 studio.generateImage */
  batch: Array<{
    view: AnatomyView;
    prompt: string;
    negativePrompt: string;
  }>;
}

/**
 * 對應的合理視角組合：
 *   - skeleton / muscular / full-body / head：anterior + posterior + lateral
 *   - internal-organs：anterior + cross-section（內臟看剖面才有意義）
 *   - vascular / nervous：anterior + posterior（這兩系統正背就涵蓋大部份）
 *   - limbs：anterior + lateral（四肢長軸看正側為主）
 */
const DEFAULT_VIEWS_BY_PART: Record<AnatomyBodyPart, AnatomyView[]> = {
  "full-body": ["anterior", "posterior", "lateral"],
  head: ["anterior", "lateral", "superior"],
  skeleton: ["anterior", "posterior", "lateral"],
  muscular: ["anterior", "posterior", "lateral"],
  nervous: ["anterior", "posterior"],
  vascular: ["anterior", "posterior"],
  "internal-organs": ["anterior", "cross-section"],
  limbs: ["anterior", "lateral"],
};

export function buildMultiViewBatch(
  input: AnatomyMultiViewInput,
): AnatomyMultiViewResult {
  const views =
    input.views && input.views.length > 0
      ? input.views
      : DEFAULT_VIEWS_BY_PART[input.bodyPart];

  // 去重 — 若呼叫端誤傳重複視角，避免重複扣點。
  const uniqueViews = Array.from(new Set(views));

  const batch = uniqueViews.map(view => {
    const r = buildAnatomyPrompt({
      bodyPart: input.bodyPart,
      view,
      style: input.style,
      purpose: input.purpose,
      extraDescriptors: input.extraDescriptors,
    });
    return {
      view,
      prompt: r.prompt,
      negativePrompt: r.negativePrompt,
    };
  });

  return {
    success: true,
    keyLabels: KEY_LABELS_BY_PART[input.bodyPart],
    recommendedModel: RECOMMENDED_MODEL_BY_STYLE[input.style],
    batch,
  };
}

// ─── verifyAnatomyResult — 比對偵測到的標籤 vs 期望重點 ───────────────────

export interface VerifyAnatomyInput {
  bodyPart: AnatomyBodyPart;
  /**
   * 上游（vision LLM / OCR / 使用者）偵測到的標籤集。可以是英文 /
   * 中文 / 帶位置數字 — 我們只看是否「包含」期望標籤的關鍵字。
   */
  detectedLabels: string[];
}

export interface VerifyAnatomyResult {
  success: true;
  /** 0.0–1.0 — 命中的期望標籤 ÷ 全部期望標籤 */
  score: number;
  /** 已命中的期望標籤 */
  matched: string[];
  /** 還沒看到的期望標籤（給使用者 / 後續精靈當補圖建議） */
  missing: string[];
  /** 偵測到但不屬於期望集的標籤（純資訊，不視為錯誤） */
  extra: string[];
  /** 中文一句話建議 — 接下來該怎麼補 */
  advice: string;
}

/**
 * 比對「偵測到的標籤」與「該部位的期望重點」。
 *
 * 期望重點本身是中文片語（KEY_LABELS_BY_PART），匹配時：
 *   - 把期望片語拆成多個 token（用 / 跟「，」「 」分），detectedLabels 中任
 *     一條包含 token 中至少一個就算命中。
 *   - 不打 LLM，純字串比對 — 給 educational-content workflow 的 anatomy-check
 *     當預設驗證器，要更嚴謹的視覺 verify 由 vision LLM 在上游做完再送進來。
 */
export function verifyAnatomyResult(
  input: VerifyAnatomyInput,
): VerifyAnatomyResult {
  const expected = KEY_LABELS_BY_PART[input.bodyPart];
  const detectedLower = input.detectedLabels.map(s => s.toLowerCase());

  // 從期望標籤抽 token：去掉括號補充、用 / ， 、 空白切。
  const tokensOf = (label: string): string[] =>
    label
      .replace(/[（）()]/g, " ")
      .split(/[\/,，、\s]+/)
      .map(t => t.trim().toLowerCase())
      .filter(t => t.length > 0);

  const matched: string[] = [];
  const missing: string[] = [];

  for (const exp of expected) {
    const tokens = tokensOf(exp);
    const hit = detectedLower.some(d => tokens.some(t => d.includes(t)));
    if (hit) {
      matched.push(exp);
    } else {
      missing.push(exp);
    }
  }

  // 額外標籤：偵測到但任何期望 token 都不包含
  const expectedAllTokens = expected.flatMap(tokensOf);
  const extra = input.detectedLabels.filter(d => {
    const dl = d.toLowerCase();
    return !expectedAllTokens.some(t => dl.includes(t));
  });

  const score = expected.length === 0 ? 1 : matched.length / expected.length;

  let advice: string;
  if (score >= 0.9) {
    advice = "標註覆蓋很完整，可直接拿去當教材。";
  } else if (score >= 0.6) {
    advice = `主要重點齊全，建議補上：${missing.slice(0, 3).join("、")}。`;
  } else if (score > 0) {
    advice = `重點覆蓋不夠（缺：${missing.slice(0, 3).join("、")}…）。建議換視角或加 reference image 重畫一張。`;
  } else {
    advice = "完全沒命中該部位的期望重點，可能是視角錯誤或部位選錯，建議讓體體重新組 prompt。";
  }

  logger.debug("anatomy_verify_result", {
    bodyPart: input.bodyPart,
    score,
    matchedCount: matched.length,
    missingCount: missing.length,
  });

  return {
    success: true,
    score,
    matched,
    missing,
    extra,
    advice,
  };
}

// ─── recommendAnatomyModels — 多模型 ranked 替代 ─────────────────────────

export interface RecommendAnatomyModelsInput {
  style: AnatomyStyle;
  purpose: AnatomyPurpose;
  /** 是否帶參考圖（會偏好 image-to-image 能力較好的模型） */
  hasReferenceImage?: boolean;
}

export interface AnatomyModelRecommendation {
  modelId: string;
  /** 為什麼推薦這個（一句中文 rationale，會出現在 UI） */
  rationale: string;
  /** 相對排名 — 0 為首選 */
  rank: number;
}

export interface RecommendAnatomyModelsResult {
  success: true;
  recommendations: AnatomyModelRecommendation[];
}

/**
 * 不只回單一推薦，回 2-3 個 ranked 替代。
 *
 * 規則：
 *   - 首選永遠是 RECOMMENDED_MODEL_BY_STYLE 對應風格的選擇（除非 hasReferenceImage）。
 *   - hasReferenceImage=true → 首選改成 flux/dev/image-to-image（站內已驗證的
 *     img2img 路徑），原 style 推薦降為備選。
 *   - teaching / labeling 用途 → 多加一個 imagen4 當備選（乾淨光感最適合教材）。
 *   - 都避免重複 modelId。
 */
export function recommendAnatomyModels(
  input: RecommendAnatomyModelsInput,
): RecommendAnatomyModelsResult {
  const recommendations: AnatomyModelRecommendation[] = [];
  const seen = new Set<string>();
  const push = (modelId: string, rationale: string) => {
    if (seen.has(modelId)) return;
    seen.add(modelId);
    recommendations.push({ modelId, rationale, rank: recommendations.length });
  };

  const stylePick = RECOMMENDED_MODEL_BY_STYLE[input.style];

  if (input.hasReferenceImage) {
    push(
      "fal-ai/flux/dev/image-to-image",
      "有參考圖 → 走 img2img 才能保留你給的姿勢 / 構圖",
    );
    push(stylePick, `風格首選（${input.style}）— 沒參考圖時用這個出新圖`);
  } else {
    push(stylePick, `風格首選（${input.style}）— 寫實 / 教科書線條最穩`);
  }

  // 教學 / 標註用途多給一個乾淨光感的備案
  if (input.purpose === "teaching" || input.purpose === "labeling") {
    push("fal-ai/imagen4/preview", "教學用的乾淨光感與簡潔背景做得不錯");
  }

  // 3D / 寫實風格再多備一個 SD3.5
  if (input.style === "3d-render" || input.style === "medical-textbook") {
    push(
      "fal-ai/stable-diffusion-v35-large",
      "搭醫學 LoRA 時可調性最高（沒 LoRA 也可用）",
    );
  }

  return { success: true, recommendations };
}

// ─── summarizeAnatomyRequest — 中文一行摘要 ──────────────────────────────

const BODY_PART_ZH: Record<AnatomyBodyPart, string> = {
  "full-body": "全身",
  head: "頭部",
  skeleton: "骨骼",
  muscular: "肌肉",
  nervous: "神經",
  vascular: "血管",
  "internal-organs": "內臟",
  limbs: "四肢",
};

const VIEW_ZH: Record<AnatomyView, string> = {
  anterior: "前面",
  posterior: "後面",
  lateral: "側面",
  superior: "上視",
  inferior: "下視",
  "cross-section": "剖面",
};

const STYLE_ZH: Record<AnatomyStyle, string> = {
  "medical-textbook": "醫學教科書風",
  "3d-render": "3D 渲染",
  "hand-drawn": "手繪",
  "simplified-diagram": "簡化示意",
};

const PURPOSE_ZH: Record<AnatomyPurpose, string> = {
  teaching: "教學用",
  labeling: "標註用",
  reference: "參考用",
  artistic: "藝術創作",
};

/**
 * 把結構化 AnatomyPromptInput（或 partial）壓成一行中文，供 chat UI
 * 顯示「體體準備幫你出：___」這種確認訊息用。
 */
export function summarizeAnatomyRequest(
  input: Partial<AnatomyPromptInput>,
): string {
  const parts: string[] = [];
  if (input.bodyPart) parts.push(BODY_PART_ZH[input.bodyPart]);
  if (input.view) parts.push(VIEW_ZH[input.view]);
  if (input.style) parts.push(STYLE_ZH[input.style]);
  if (input.purpose) parts.push(PURPOSE_ZH[input.purpose]);
  if (parts.length === 0) return "尚未指定任何條件";
  return parts.join("／");
}
