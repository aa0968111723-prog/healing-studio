/**
 * server/services/spiritTools/anatomySpecialistTools.ts
 *
 * Tools for the anatomy-specialist (體體) spirit — 專做人體解剖圖 /
 * 醫學插圖 / 骨骼肌肉示意。對應 orb-agent-roles.ts:1448-1458 的角色
 * 定位（之前這個檔內容是 templated 占位實作，跟「體體」的工作完全
 * 無關，且 header 誤寫為「解解」）。
 *
 * 設計：純函式 — 把使用者粗略需求 (部位 / 用途 / 風格 / 視角) 轉成
 * 寫實精準的英文提示詞，並回傳建議模型 / batch / 標註提示。實際的
 * 圖像生成仍由 imageSpecialist 或 spiritDispatcher 走 fal.ai；體體
 * 在這層只負責「組對 prompt + 篩模型 + 推薦標註重點」。
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
  /** 推薦的 fal model id */
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
 */
export function nextClarificationQuestion(
  partial: Partial<AnatomyPromptInput>,
): AnatomyClarificationQuestion | null {
  if (!partial.bodyPart) {
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
  if (!partial.view) {
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
  if (!partial.purpose) {
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
  if (!partial.style) {
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
