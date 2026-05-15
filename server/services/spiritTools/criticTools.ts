/**
 * server/services/spiritTools/criticTools.ts
 *
 * 品品 (critic) 的真實工具集 — 把「交付前看一輪 + 給 1-3 個改進」評審
 * 從「system prompt 嘴砲」升級成「會跑結構化 rubric / 改寫 / 比較 /
 * 交棒決策」的 AI agent。
 *
 * 之前的問題：
 *   - shared/agent-skills.ts:129 寫 `tools: []` → 品品沒有任何工具
 *   - 11+ 個其他精靈把「交付前看一輪 / 總評」交給品品，但品品只能 LLM 嘴砲
 *   - 沒有結構化的 modal-specific rubric → 評審內容不穩定、改進建議常常太抽象
 *   - 沒有版本比較 → 使用者跑了 V1/V2/V3 後品品說不清哪個進步、要不要再來
 *   - 沒有 prompt 改寫工具 → 「把 ___ 換成 ___」要靠 LLM 即興，常常不可貼
 *   - 沒有交棒決策 → critique 結束後不知道該丟給編編還是巧巧
 *
 * 本檔提供五個工具，全部走純函式（不寫 DB、不呼叫 LLM）：
 *   - reviewAsset(...)        — 結構化評審：highlights + improvements + rubric scores
 *   - scoreAsset(...)         — 純打分，給數字儀表板用
 *   - compareIterations(...)  — 比較多版本，回 winner + 下一步方向
 *   - suggestPromptRewrite(.) — 對 prompt 給可貼的 1-3 個改寫版本
 *   - planHandoff(...)        — critique 完該交棒給誰（編編 / 巧巧 / specialist）
 *
 * 所有工具都是 read-only / pure — 不會扣點數、不會觸發任何 fal job。
 * 品品的 LLM 層拿到 tool 回傳的結構後，用自己的話包裝成「品品」口吻
 * （兩個亮點 + 最多 3 個改進，最後問「想先改哪個？」）。
 */

import { logger } from "../../_core/logger";
import type { AgentRole } from "../../../shared/orb-agent-roles";

// ─── 模態與維度定義 ───────────────────────────────────────────────────────

export type CriticModality = "image" | "video" | "music" | "voice" | "text";

/**
 * 每個 modality 有自己的「該被評審的維度」與權重。權重總和不要求 = 100，
 * scoreAsset 會做 normalize。新增維度時也要在 DIMENSION_LABELS / GENERIC_FIXES
 * 補對應條目，否則 LLM 拿到 score 但不知道該維度叫什麼。
 */
const MODALITY_DIMENSIONS: Record<
  CriticModality,
  ReadonlyArray<{ key: string; weight: number }>
> = {
  image: [
    { key: "composition", weight: 25 },
    { key: "subject_clarity", weight: 25 },
    { key: "lighting", weight: 20 },
    { key: "style_consistency", weight: 15 },
    { key: "detail_quality", weight: 15 },
  ],
  video: [
    { key: "pacing", weight: 25 },
    { key: "camera_stability", weight: 20 },
    { key: "subject_motion", weight: 20 },
    { key: "hook_strength", weight: 20 },
    { key: "audio_sync", weight: 15 },
  ],
  music: [
    { key: "emotion_match", weight: 30 },
    { key: "dynamic_range", weight: 20 },
    { key: "loop_seamlessness", weight: 20 },
    { key: "mix_balance", weight: 15 },
    { key: "structure", weight: 15 },
  ],
  voice: [
    { key: "naturalness", weight: 30 },
    { key: "emotion_match", weight: 25 },
    { key: "pacing", weight: 20 },
    { key: "pronunciation", weight: 15 },
    { key: "audio_quality", weight: 10 },
  ],
  text: [
    { key: "hook", weight: 25 },
    { key: "pacing", weight: 20 },
    { key: "voice_consistency", weight: 20 },
    { key: "cta_clarity", weight: 20 },
    { key: "concision", weight: 15 },
  ],
};

/** 維度 key → 中文短標。給 LLM 包裝回覆時用「構圖」而不是「composition」。 */
const DIMENSION_LABELS: Record<string, string> = {
  // image
  composition: "構圖",
  subject_clarity: "主體清晰度",
  lighting: "光線/光影",
  style_consistency: "風格一致性",
  detail_quality: "細節質感",
  // video
  pacing: "節奏",
  camera_stability: "鏡頭穩定",
  subject_motion: "主體動態",
  hook_strength: "開場鉤子",
  audio_sync: "音畫對位",
  // music
  emotion_match: "情緒匹配",
  dynamic_range: "動態範圍",
  loop_seamlessness: "loop 銜接",
  mix_balance: "混音平衡",
  structure: "段落結構",
  // voice
  naturalness: "自然度",
  pronunciation: "發音準確",
  audio_quality: "錄音品質",
  // text
  hook: "開場鉤子",
  voice_consistency: "語氣一致",
  cta_clarity: "CTA 明確",
  concision: "精簡度",
};

/**
 * 通用 fix 模板。Key 是維度 key；value 是「issue + concrete fix +
 * promptPatch」三件套。一個維度可能有多個常見 fix；reviewAsset 會挑
 * 1 個對應使用者目前的弱點（依 prompt heuristics）。
 *
 * promptPatch 是可以「直接附加 / 替換到原 prompt 末端」的字串，
 * 設計成「能被 LLM 黏到 quality-coach 改寫版本」的零件。
 */
interface FixTemplate {
  issue: string;
  fix: string;
  promptPatch?: string;
}

const FIX_LIBRARY: Record<string, ReadonlyArray<FixTemplate>> = {
  // image
  composition: [
    {
      issue: "主體置中沒有引導視線，畫面偏靜",
      fix: "把構圖改成三分法或對角線；主體放黃金分割點",
      promptPatch: "rule of thirds, dynamic composition, leading lines",
    },
    {
      issue: "畫面太擠 / 主體被切",
      fix: "拉遠鏡頭並留白，給主體呼吸空間",
      promptPatch: "wide shot, negative space, centered subject with breathing room",
    },
  ],
  subject_clarity: [
    {
      issue: "背景搶戲 / 主體模糊",
      fix: "加淺景深虛化背景，並用 medium close-up 強化主體",
      promptPatch: "shallow depth of field, f/1.8, medium close-up, sharp subject",
    },
  ],
  lighting: [
    {
      issue: "光線平淡沒層次",
      fix: "改成側逆光或 rim light，加 atmospheric haze",
      promptPatch: "cinematic rim light, golden hour, atmospheric haze, soft shadows",
    },
    {
      issue: "陰影過硬 / 對比過強",
      fix: "改成柔光 + 漫射光源描述",
      promptPatch: "soft diffused lighting, overcast, gentle shadows",
    },
  ],
  style_consistency: [
    {
      issue: "風格詞太雜，模型抓不到主調",
      fix: "保留 1-2 個核心風格詞，其餘移到 negative prompt",
      promptPatch: "single coherent art style, consistent color palette",
    },
  ],
  detail_quality: [
    {
      issue: "細節糊 / 紋理單薄",
      fix: "加質感詞 + 高解析提示，必要時改用 FLUX Pro 或升模型 tier",
      promptPatch: "ultra-detailed, intricate textures, 8k, high resolution",
    },
  ],
  // video
  pacing: [
    {
      issue: "節奏拖沓 / 沒切點",
      fix: "縮短到 5-7 秒並設定 1.5 秒切點",
      promptPatch: "fast-paced edit, 1.5 second cuts, high energy rhythm",
    },
    {
      issue: "資訊塞太密，觀眾來不及消化",
      fix: "拉到 10 秒並讓主體動作慢一點",
      promptPatch: "smooth slow motion, deliberate pacing, breathing pause",
    },
  ],
  camera_stability: [
    {
      issue: "鏡頭抖動 / 跟拍不穩",
      fix: "改成 locked-off shot 或 dolly track",
      promptPatch: "locked-off camera, smooth dolly movement, no handheld shake",
    },
  ],
  subject_motion: [
    {
      issue: "主體動作太機械 / 沒有 micro-expression",
      fix: "在 prompt 加微表情描述",
      promptPatch: "subtle micro-expressions, natural body language, organic motion",
    },
  ],
  hook_strength: [
    {
      issue: "前 1 秒沒抓住目光",
      fix: "改用反差畫面或極端 close-up 開場",
      promptPatch: "extreme close-up opening, sudden visual contrast in first frame",
    },
  ],
  audio_sync: [
    {
      issue: "對嘴沒對齊或無音軌",
      fix: "先用 voice-specialist 產出聲源再丟 lip-sync 模型",
      promptPatch: "precise lip-sync, audio-synchronized mouth movement",
    },
  ],
  // music
  emotion_match: [
    {
      issue: "情緒方向不夠強烈或跟畫面相反",
      fix: "用具體形容詞（uplifting / melancholic / suspenseful）+ 場景描述",
      promptPatch: "uplifting cinematic theme, healing piano, warm strings",
    },
  ],
  dynamic_range: [
    {
      issue: "整曲音量平坦沒高潮",
      fix: "請音音加 build-up + drop 結構",
      promptPatch: "dynamic build-up to climax at 0:20, soft outro",
    },
  ],
  loop_seamlessness: [
    {
      issue: "結尾沒淡出，loop 會有 click",
      fix: "明寫 seamless loop 並要求 BPM 對齊",
      promptPatch: "seamless loop, no fade out, BPM-locked",
    },
  ],
  mix_balance: [
    {
      issue: "低頻太重 / 高頻刺耳",
      fix: "請音音改 stable-audio + 加 EQ 描述",
      promptPatch: "balanced EQ, warm mids, controlled bass, smooth highs",
    },
  ],
  structure: [
    {
      issue: "缺少明確段落",
      fix: "在 prompt 標明 intro / verse / chorus 時間點",
      promptPatch: "intro 0-8s, verse 8-24s, chorus 24-40s, outro 40-60s",
    },
  ],
  // voice
  naturalness: [
    {
      issue: "聽起來像 TTS 機器人",
      fix: "改用 ElevenLabs v3 + 加情緒標籤、降低 stability",
      promptPatch: "natural conversational tone, slight breathiness, casual delivery",
    },
  ],
  pronunciation: [
    {
      issue: "專有名詞或外語發音錯",
      fix: "在 prompt 用音節拼出，或請聲聲切 multilingual 模型",
      promptPatch: "pronounce names phonetically, slow down for technical terms",
    },
  ],
  audio_quality: [
    {
      issue: "錄音底噪 / 雜訊明顯",
      fix: "用 ElevenLabs 高品質 voice，並避免 30 秒以下短 clip",
      promptPatch: "clean studio recording, no background noise, broadcast quality",
    },
  ],
  // text
  hook: [
    {
      issue: "開頭太平、沒有提問或反差",
      fix: "改用提問 / 反差陳述 / 數字震撼開場",
      promptPatch: "open with a provocative question, hook reader in first 8 words",
    },
  ],
  voice_consistency: [
    {
      issue: "口吻在「正式」與「口語」間漂移",
      fix: "鎖一種 persona（朋友 / 教練 / 主播）並貫穿全文",
      promptPatch: "consistent friendly mentor voice throughout, casual but warm",
    },
  ],
  cta_clarity: [
    {
      issue: "結尾沒有明確下一步",
      fix: "結尾加一句 CTA：「現在就 ___」",
      promptPatch: "end with clear single-action CTA in present imperative",
    },
  ],
  concision: [
    {
      issue: "贅字多，每句可再砍 20-30%",
      fix: "刪掉副詞和 hedge words，主動語態",
      promptPatch: "concise, active voice, no hedge words, every sentence earns its place",
    },
  ],
};

// ─── reviewAsset：結構化評審 ───────────────────────────────────────────────

export interface ReviewAssetInput {
  modality: CriticModality;
  /** 使用者一開始的 prompt — 用來抓 fix 對應的弱點 */
  prompt?: string;
  /** 負面提示詞 */
  negativePrompt?: string;
  /** 用的模型 ID（影響 model-level 建議） */
  modelId?: string;
  /** aspect 比例（image / video）— 用來檢查是否符合目標平台 */
  aspect?: string;
  /** 影片 / 音檔長度（秒） */
  durationSec?: number;
  /** 使用者想交付的目標（例如 "IG Reels 7 秒"）— 影響 rubric 偏好 */
  goal?: string;
  /** 使用者對結果的初步感受（"好像有點糊"、"沒感覺"）— 用來偏向某些 fix */
  userFeedback?: string;
  /** 第幾輪迭代（第 1 輪比較給鼓勵；第 4+ 輪就要催使用者結束循環） */
  iteration?: number;
}

export interface ReviewImprovement {
  /** 維度 key（看 MODALITY_DIMENSIONS） */
  dimension: string;
  /** 維度顯示名（中文） */
  dimensionLabel: string;
  issue: string;
  fix: string;
  /** 可貼到 prompt 的英文 patch — 編編 / 巧巧拿去拼接 */
  promptPatch?: string;
  priority: "high" | "medium" | "low";
}

export interface ReviewAssetResult {
  modality: CriticModality;
  /** 0-100 加權總分（不評時為 null） */
  overallScore: number;
  dimensionScores: Record<string, number>;
  /** 兩個具體亮點 — 從 prompt heuristics 萃取，避免空話 */
  highlights: string[];
  /** 最多 3 個改進建議，依 priority 排序 */
  improvements: ReviewImprovement[];
  /** 評審的維度框架（讓 LLM 知道我們是看哪幾個維度） */
  rubric: Array<{ key: string; label: string; weight: number }>;
  /** 一句話下一步建議：「想先改 ___ ？」 */
  nextStepSuggestion: string;
  /** 該往哪邊交棒（LLM 用來收尾「交棒給編編 / 巧巧」） */
  suggestedHandoff: {
    to: AgentRole;
    reason: string;
  };
}

/**
 * 主評審 API：給定一個 asset 的 metadata + modality，回傳結構化評審。
 *
 * 它故意「不去看實際 pixel/audio」 — 那要走 multimodal LLM (image-to-json /
 * video-to-text)，會花錢且不穩。這裡只看 metadata + prompt heuristics，
 * 給品品的 LLM 一份穩定骨架。multimodal 分析可以未來另外加個
 * `reviewAssetWithVision` tool 平行存在。
 */
export function reviewAsset(input: ReviewAssetInput): ReviewAssetResult {
  const dims = MODALITY_DIMENSIONS[input.modality];
  const rubric = dims.map(d => ({
    key: d.key,
    label: DIMENSION_LABELS[d.key] ?? d.key,
    weight: d.weight,
  }));

  // ── 1. 從 prompt heuristics 找出「應該被改」的維度 ──
  const weaknesses = detectWeaknesses(input);

  // ── 2. 給每個維度 0-100 分（弱點對應的維度扣分，其餘 75-85 區間隨機種子） ──
  const dimensionScores: Record<string, number> = {};
  for (const dim of dims) {
    const isWeak = weaknesses.some(w => w.dimension === dim.key);
    dimensionScores[dim.key] = isWeak
      ? 50 + scoreSeedFor(input, dim.key) * 15 // 50-65
      : 75 + scoreSeedFor(input, dim.key) * 15; // 75-90
  }

  // ── 3. 加權總分 ──
  const totalWeight = dims.reduce((a, b) => a + b.weight, 0);
  const overallScore = Math.round(
    dims.reduce((sum, d) => sum + dimensionScores[d.key] * d.weight, 0) / totalWeight
  );

  // ── 4. 亮點（具體；從強項維度 + prompt 內容萃取） ──
  const highlights = buildHighlights(input, dimensionScores);

  // ── 5. 改進建議（最多 3 個，priority 排序） ──
  const improvements = buildImprovements(input, weaknesses).slice(0, 3);

  // ── 6. 交棒決策（依 critique 性質） ──
  const suggestedHandoff = decideHandoffFromImprovements(input, improvements);

  // ── 7. 一句話 next step ──
  const nextStepSuggestion = buildNextStep(input, improvements);

  logger.debug("critic_review_built", {
    modality: input.modality,
    overallScore,
    improvementCount: improvements.length,
    weakDimensions: weaknesses.map(w => w.dimension),
    handoff: suggestedHandoff.to,
  });

  return {
    modality: input.modality,
    overallScore,
    dimensionScores,
    highlights,
    improvements,
    rubric,
    nextStepSuggestion,
    suggestedHandoff,
  };
}

interface DetectedWeakness {
  dimension: string;
  /** 用了哪個 FIX_LIBRARY 條目的 index */
  fixIndex: number;
  priority: "high" | "medium" | "low";
}

/**
 * 從 prompt / metadata 猜出該被改的維度。純啟發式 —
 * 抓到「short prompt」「無 lighting 描述」「aspect 跟 goal 對不上」這類訊號。
 *
 * 注意：detect 不到任何弱點時也會 fallback 給「最少 1 個建議」，否則使用者
 * 永遠在第 5 輪迭代還收到「無建議」會很挫敗。
 */
function detectWeaknesses(input: ReviewAssetInput): DetectedWeakness[] {
  const out: DetectedWeakness[] = [];
  const prompt = (input.prompt ?? "").trim();
  const promptLower = prompt.toLowerCase();
  const feedback = (input.userFeedback ?? "").toLowerCase();

  // 使用者明說的不滿可以直接 map 到對應維度。每個 feedback pattern
  // 必須 gate 在「該維度真的存在於當前 modality 的 rubric」之下，
  // 否則 buildImprovements 會吐出不屬於當前 rubric 的維度（例如把
  // image 的 subject_clarity 套到 text/voice 上），造成評審不一致。
  // ── 「糊 / muddy / blurry」依模態映射到不同維度 ──
  if (/糊|模糊|不清楚|blurry|out of focus|muddy/.test(feedback)) {
    if (input.modality === "image" || input.modality === "video") {
      // 視覺模態：主體模糊 → subject_clarity；紋理糊 → detail_quality
      pushWeakness(out, "subject_clarity", "high");
      if (input.modality === "image") {
        pushWeakness(out, "detail_quality", "medium");
      }
    }
    if (input.modality === "music") {
      // 音樂「混在一起聽不清」→ mix balance
      pushWeakness(out, "mix_balance", "high");
    }
    if (input.modality === "voice") {
      // 語音「糊」通常是錄音底噪 / 壓縮
      pushWeakness(out, "audio_quality", "high");
    }
    if (input.modality === "text") {
      // 文字「糊」→ 不夠精簡 / 邏輯亂
      pushWeakness(out, "concision", "medium");
    }
  }
  if (/沒感覺|不夠|平|沒亮點|boring|flat/.test(feedback)) {
    if (input.modality === "image" || input.modality === "video") {
      pushWeakness(out, "composition", "high");
      pushWeakness(out, "lighting", "medium");
    }
    if (input.modality === "music" || input.modality === "voice") {
      pushWeakness(out, "emotion_match", "high");
    }
    if (input.modality === "text") {
      pushWeakness(out, "hook", "high");
    }
  }
  // pacing 只存在於 video / voice / text rubric — image / music 沒有此維度
  if (/節奏|太快|太慢|pacing|rhythm/.test(feedback)) {
    if (
      input.modality === "video" ||
      input.modality === "voice" ||
      input.modality === "text"
    ) {
      pushWeakness(out, "pacing", "high");
    } else if (input.modality === "music") {
      // 音樂節奏問題映射到 dynamic_range / structure（最接近的維度）
      pushWeakness(out, "dynamic_range", "high");
    }
    // image：沒有 pacing 概念，忽略
  }
  // loop seamlessness 只存在於 music rubric
  if (/loop|循環|接不起來/.test(feedback)) {
    if (input.modality === "music") {
      pushWeakness(out, "loop_seamlessness", "high");
    }
  }

  // Prompt 太短 → 細節維度往往不足
  if (prompt.length > 0 && prompt.length < 30) {
    if (input.modality === "image" || input.modality === "video") {
      pushWeakness(out, "detail_quality", "medium");
    }
    if (input.modality === "text") {
      pushWeakness(out, "concision", "low");
    }
  }

  // Prompt 沒有 lighting 描述
  if (
    (input.modality === "image" || input.modality === "video") &&
    prompt.length > 0 &&
    !/light|lighting|sun|shadow|golden|rim|backlit|光|逆光|側光|陰影/.test(promptLower)
  ) {
    pushWeakness(out, "lighting", "medium");
  }

  // Image 沒有指明風格 → style consistency
  if (
    input.modality === "image" &&
    prompt.length > 0 &&
    !/style|art|illustration|photograph|cinematic|anime|watercolor|寫實|插畫|風格/.test(
      promptLower
    )
  ) {
    pushWeakness(out, "style_consistency", "low");
  }

  // Video 沒指定 hook / opening
  if (
    input.modality === "video" &&
    prompt.length > 0 &&
    !/hook|opening|first|0:00|opening shot|開場|第一秒/.test(promptLower)
  ) {
    pushWeakness(out, "hook_strength", "medium");
  }

  // Music 沒指明情緒
  if (
    input.modality === "music" &&
    prompt.length > 0 &&
    !/uplifting|sad|happy|tense|calm|healing|epic|療癒|緊張|輕快|情緒|mood|emotion/.test(
      promptLower
    )
  ) {
    pushWeakness(out, "emotion_match", "high");
  }

  // Voice 沒提語氣
  if (
    input.modality === "voice" &&
    prompt.length > 0 &&
    !/warm|calm|excited|slow|fast|whisper|narrator|溫暖|冷靜|快節奏|語氣/.test(promptLower)
  ) {
    pushWeakness(out, "naturalness", "medium");
  }

  // Aspect ratio vs goal mismatch
  if (input.aspect && input.goal) {
    const goalLower = input.goal.toLowerCase();
    if (/reels|tiktok|抖音|限動|short|vertical/.test(goalLower) && input.aspect !== "9:16") {
      pushWeakness(out, "composition", "high");
    }
    if (/youtube|横式|landscape/.test(goalLower) && input.aspect !== "16:9") {
      pushWeakness(out, "composition", "high");
    }
  }

  // Text 沒 CTA
  if (
    input.modality === "text" &&
    prompt.length > 0 &&
    !/cta|call to action|action|現在|立刻|now|click|tap|加入|報名/.test(promptLower)
  ) {
    pushWeakness(out, "cta_clarity", "medium");
  }

  // 沒抓到任何弱點時 fallback 給 1 個建議（依 modality 給 most common 的維度）
  // 先 fallback 再做 iteration escalation — 否則 escalation 看到空陣列就不動，
  // 但 fallback 又會把 priority 設成 low，結果第 3+ 輪也只給「low」建議。
  if (out.length === 0) {
    const fallbackDim: Record<CriticModality, string> = {
      image: "lighting",
      video: "pacing",
      music: "emotion_match",
      voice: "naturalness",
      text: "hook",
    };
    pushWeakness(out, fallbackDim[input.modality], "low");
  }

  // Iteration ≥ 3 + 還沒給高 priority → 提升為 high，催使用者結束循環
  if ((input.iteration ?? 1) >= 3 && out.every(w => w.priority !== "high")) {
    if (out.length > 0) out[0].priority = "high";
  }

  return out;
}

function pushWeakness(
  out: DetectedWeakness[],
  dimension: string,
  priority: "high" | "medium" | "low"
): void {
  // 同維度只記一次，但 priority 可向上升
  const existing = out.find(w => w.dimension === dimension);
  if (existing) {
    const order: Record<typeof priority, number> = { high: 3, medium: 2, low: 1 };
    if (order[priority] > order[existing.priority]) existing.priority = priority;
    return;
  }
  out.push({ dimension, fixIndex: 0, priority });
}

/**
 * 從強項維度與 prompt 內容構出兩個 highlight 句。盡量避免「整體不錯」這種
 * 空話 — 抓 prompt 裡確實出現的詞回拋（例如 prompt 含 "golden hour" 就給
 * 「金時光線運用得當」這種 grounded 評價）。
 */
function buildHighlights(
  input: ReviewAssetInput,
  scores: Record<string, number>
): string[] {
  const out: string[] = [];
  const prompt = (input.prompt ?? "").toLowerCase();

  // Prompt-grounded highlights
  if (input.modality === "image" || input.modality === "video") {
    if (/golden hour|sunset|逆光|side light|rim/.test(prompt)) {
      out.push("光線方向交代清楚，氛圍有立體感");
    }
    if (/close[- ]?up|特寫|微距/.test(prompt)) {
      out.push("特寫鏡頭讓主體聚焦明確");
    }
    if (/wide shot|landscape|遠景|全景/.test(prompt)) {
      out.push("廣角構圖把場景空間感拉開");
    }
  }
  if (input.modality === "music") {
    if (/healing|療癒|cinematic|epic|uplifting/.test(prompt)) {
      out.push("情緒方向給得很明確，模型抓得到主調");
    }
    if (/bpm|loop|seamless/.test(prompt)) {
      out.push("技術參數（BPM/loop）有寫進去，可控性高");
    }
  }
  if (input.modality === "voice") {
    if (/warm|溫暖|calm|冷靜|narrator/.test(prompt)) {
      out.push("語氣設定具體，配出來不會像 TTS 機器人");
    }
  }
  if (input.modality === "text") {
    if (/cta|現在|now|action|加入/.test(prompt)) {
      out.push("結尾有 CTA，能引導讀者下一步動作");
    }
  }

  // Score-based highlights (取最高分的維度)
  if (out.length < 2) {
    const sortedDims = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    for (const [dim, score] of sortedDims) {
      if (score >= 80 && out.length < 2) {
        const label = DIMENSION_LABELS[dim] ?? dim;
        out.push(`${label} 抓得不錯`);
      }
    }
  }

  // Fallback：iteration 心理建設
  if (out.length === 0) {
    if ((input.iteration ?? 1) === 1) {
      out.push("第一輪整體方向是對的，再迭代一輪就更穩");
    } else {
      out.push(`已經跑到第 ${input.iteration ?? 1} 輪，方向有持續收斂`);
    }
  }
  if (out.length === 1) {
    out.push("整體完成度可以交付，只是還有 1-2 處能再優化");
  }

  return out.slice(0, 2);
}

function buildImprovements(
  input: ReviewAssetInput,
  weaknesses: DetectedWeakness[]
): ReviewImprovement[] {
  const out: ReviewImprovement[] = [];
  // 依 priority high → medium → low 排序
  const order: Record<"high" | "medium" | "low", number> = { high: 3, medium: 2, low: 1 };
  const sorted = [...weaknesses].sort((a, b) => order[b.priority] - order[a.priority]);

  for (const w of sorted) {
    const fixes = FIX_LIBRARY[w.dimension];
    if (!fixes || fixes.length === 0) continue;
    const fix = fixes[Math.min(w.fixIndex, fixes.length - 1)];
    out.push({
      dimension: w.dimension,
      dimensionLabel: DIMENSION_LABELS[w.dimension] ?? w.dimension,
      issue: fix.issue,
      fix: fix.fix,
      promptPatch: fix.promptPatch,
      priority: w.priority,
    });
  }

  return out;
}

/**
 * 依 improvements 性質決定交棒對象：
 *   - 大多是 prompt-level 改寫（promptPatch 都有）→ 巧巧（quality-coach）
 *   - 是要切模型 / aspect / settings → 編編（composer）
 *   - 沒有改進，純亮點 → 直接讓使用者選 composer / next iteration
 */
function decideHandoffFromImprovements(
  input: ReviewAssetInput,
  improvements: ReviewImprovement[]
): { to: AgentRole; reason: string } {
  if (improvements.length === 0) {
    return { to: "composer", reason: "沒有需要再改，交給編編收尾或送出最終版" };
  }
  const promptPatchCount = improvements.filter(i => i.promptPatch).length;
  if (promptPatchCount >= 2) {
    return {
      to: "quality-coach",
      reason: "多數改進是 prompt 寫法層面，交給巧巧改寫成可直接複製的版本",
    };
  }
  // settings/aspect 類改進 → 編編
  return {
    to: "composer",
    reason: "改進偏 settings/aspect 調整，交給編編在當頁直接套上",
  };
}

function buildNextStep(input: ReviewAssetInput, improvements: ReviewImprovement[]): string {
  if (improvements.length === 0) {
    return "整體沒明顯短板，要直接送這版交付，還是再來一輪冒險？";
  }
  if (improvements.length === 1) {
    const i = improvements[0];
    return `想先改「${i.dimensionLabel}」嗎？我給的 patch 可以直接貼到 prompt。`;
  }
  const dims = improvements.map(i => i.dimensionLabel).join(" / ");
  return `想先改「${dims}」哪一個？挑一個我就交給對應同事接手。`;
}

/**
 * 平凡的「種子」，給每個 (input, dimension) 一個穩定的 0-1 浮點。
 * 避免相同輸入下分數隨機跳動 — 同樣 prompt 跑兩次品品要給一樣分數。
 */
function scoreSeedFor(input: ReviewAssetInput, dimensionKey: string): number {
  const src = `${input.modality}::${input.prompt ?? ""}::${input.modelId ?? ""}::${dimensionKey}`;
  let hash = 5381;
  for (let i = 0; i < src.length; i++) {
    hash = ((hash << 5) + hash + src.charCodeAt(i)) | 0;
  }
  return Math.abs(hash % 1000) / 1000;
}

// ─── scoreAsset：純打分（給儀表板 / proactive trigger 用） ──────────────

export interface ScoreAssetInput extends ReviewAssetInput {}

export interface ScoreAssetResult {
  modality: CriticModality;
  overallScore: number;
  dimensionScores: Record<string, number>;
  /** 分數低於 60 的維度（適合 proactive 觸發 quality-coach 介入） */
  weakDimensions: string[];
}

/**
 * 只跑 scoring 不跑 narrative — 適合 proactive 觸發判斷
 * （例如 "low_quality_generation" 事件要不要叫巧巧）。
 */
export function scoreAsset(input: ScoreAssetInput): ScoreAssetResult {
  const review = reviewAsset(input);
  const weakDimensions = Object.entries(review.dimensionScores)
    .filter(([, s]) => s < 60)
    .map(([k]) => k);
  return {
    modality: review.modality,
    overallScore: review.overallScore,
    dimensionScores: review.dimensionScores,
    weakDimensions,
  };
}

// ─── compareIterations：版本比較 ───────────────────────────────────────

export interface IterationInput {
  id: string;
  modality: CriticModality;
  prompt?: string;
  modelId?: string;
  aspect?: string;
  durationSec?: number;
  userFeedback?: string;
  /** 第幾輪 — 用來判斷誰是 baseline、誰是 latest */
  iteration?: number;
}

export interface CompareIterationsInput {
  iterations: ReadonlyArray<IterationInput>;
  goal?: string;
}

export interface IterationComparison {
  id: string;
  overallScore: number;
  dimensionScores: Record<string, number>;
}

export interface CompareIterationsResult {
  /** 哪一輪整體分數最高 */
  winnerId: string;
  /** 依分數高到低排序的所有迭代 */
  rankings: IterationComparison[];
  /** 從 baseline 到 latest，各維度進步 / 退步 — 給 LLM 講「___ 有進步」 */
  improvedDimensions: string[];
  regressedDimensions: string[];
  /** 一句話下一步：再來、收尾、回頭挑 winner */
  recommendation: string;
}

/**
 * 比較同一個任務的 2+ 輪迭代結果，回 winner + 哪些維度進步 / 退步 +
 * 下一步建議。給品品在「使用者跑了 V1/V2/V3 之後說『哪一版比較好？』」
 * 的場景用。
 */
export function compareIterations(input: CompareIterationsInput): CompareIterationsResult {
  if (input.iterations.length === 0) {
    return {
      winnerId: "",
      rankings: [],
      improvedDimensions: [],
      regressedDimensions: [],
      recommendation: "沒有可比較的迭代",
    };
  }

  const scored = input.iterations.map(it => {
    const r = reviewAsset({
      modality: it.modality,
      prompt: it.prompt,
      modelId: it.modelId,
      aspect: it.aspect,
      durationSec: it.durationSec,
      userFeedback: it.userFeedback,
      goal: input.goal,
      iteration: it.iteration,
    });
    return {
      id: it.id,
      overallScore: r.overallScore,
      dimensionScores: r.dimensionScores,
    };
  });

  // 依 overallScore 高到低
  const rankings = [...scored].sort((a, b) => b.overallScore - a.overallScore);
  const winner = rankings[0];

  // Baseline = iteration 1（或第一筆）；latest = iteration 最大（或最後一筆）
  const sortedByIter = [...input.iterations].sort(
    (a, b) => (a.iteration ?? 1) - (b.iteration ?? 1)
  );
  const baseline = scored.find(s => s.id === sortedByIter[0]?.id);
  const latest = scored.find(s => s.id === sortedByIter[sortedByIter.length - 1]?.id);

  const improvedDimensions: string[] = [];
  const regressedDimensions: string[] = [];
  if (baseline && latest && baseline.id !== latest.id) {
    for (const dim of Object.keys(latest.dimensionScores)) {
      const baseScore = baseline.dimensionScores[dim] ?? 0;
      const latestScore = latest.dimensionScores[dim] ?? 0;
      const delta = latestScore - baseScore;
      if (delta >= 5) {
        improvedDimensions.push(DIMENSION_LABELS[dim] ?? dim);
      } else if (delta <= -5) {
        regressedDimensions.push(DIMENSION_LABELS[dim] ?? dim);
      }
    }
  }

  // 建議：winner 是否就是 latest？退步太多就建議回頭
  let recommendation: string;
  if (latest && latest.id === winner.id) {
    if (latest.overallScore >= 80) {
      recommendation = "最新這輪是最好的，可以收尾交付了";
    } else {
      recommendation = "最新這輪雖然是最好的，但分數還沒到 80 — 再迭代一次或換模型試試";
    }
  } else {
    const winnerIter = input.iterations.find(it => it.id === winner.id);
    recommendation = `第 ${winnerIter?.iteration ?? "?"} 輪比最新版好，建議回頭用那一版`;
  }

  logger.debug("critic_compare_iterations", {
    iterations: input.iterations.length,
    winnerId: winner.id,
    winnerScore: winner.overallScore,
    improvedCount: improvedDimensions.length,
    regressedCount: regressedDimensions.length,
  });

  return {
    winnerId: winner.id,
    rankings,
    improvedDimensions,
    regressedDimensions,
    recommendation,
  };
}

// ─── suggestPromptRewrite：給可貼的改寫版本 ─────────────────────────────

export interface SuggestPromptRewriteInput {
  modality: CriticModality;
  originalPrompt: string;
  /** 想針對哪些維度改（從 review 拿）— 沒提供就用 detectWeaknesses */
  targetDimensions?: ReadonlyArray<string>;
  goal?: string;
  /** 最多回幾個改寫版（預設 2，最多 3） */
  limit?: number;
}

export interface RewriteOption {
  /** 改寫後的完整 prompt — 可以直接送出 */
  rewrittenPrompt: string;
  /** 動到哪些維度（中文 label） */
  touchedDimensions: string[];
  /** 給使用者看的一句話：「這版比較強調 ___」 */
  rationale: string;
}

export interface SuggestPromptRewriteResult {
  original: string;
  options: RewriteOption[];
}

/**
 * 對使用者的 prompt 給 1-3 個可直接複製貼上的改寫版本，每版只動 1-2 個
 * 維度（不要一次大改，使用者會分不清哪個 patch 起的作用）。
 *
 * 改寫策略：FIX_LIBRARY[dimension].promptPatch 直接 append 到原 prompt 末端，
 * 用半形逗號接。如果 prompt 已含 patch 的關鍵詞就跳過，避免重複。
 */
export function suggestPromptRewrite(
  input: SuggestPromptRewriteInput
): SuggestPromptRewriteResult {
  const limit = Math.max(1, Math.min(3, Math.trunc(input.limit ?? 2)));
  const orig = input.originalPrompt.trim();

  // 決定要動哪些維度
  let dims: string[];
  if (input.targetDimensions && input.targetDimensions.length > 0) {
    dims = [...input.targetDimensions];
  } else {
    const weaknesses = detectWeaknesses({
      modality: input.modality,
      prompt: orig,
      goal: input.goal,
    });
    dims = weaknesses.map(w => w.dimension);
  }

  // 每個維度產生一個改寫版（最多 limit 個）
  const options: RewriteOption[] = [];
  const seenDims = new Set<string>();
  for (const dim of dims) {
    if (options.length >= limit) break;
    if (seenDims.has(dim)) continue;
    seenDims.add(dim);

    const fixes = FIX_LIBRARY[dim];
    if (!fixes || fixes.length === 0) continue;
    const patch = fixes[0].promptPatch;
    if (!patch) continue;

    // 如果 prompt 已含 patch 的某些 token 就改成下一個 fix
    let chosenPatch = patch;
    if (containsAnyToken(orig, patch)) {
      const alt = fixes[1]?.promptPatch;
      if (alt && !containsAnyToken(orig, alt)) {
        chosenPatch = alt;
      } else {
        continue; // 真的沒得改了
      }
    }

    const rewritten = orig.length === 0 ? chosenPatch : `${orig}, ${chosenPatch}`;
    const label = DIMENSION_LABELS[dim] ?? dim;
    options.push({
      rewrittenPrompt: rewritten,
      touchedDimensions: [label],
      rationale: `這版強化「${label}」維度，其餘保留原句`,
    });
  }

  // 如果一個都沒生出來（極端罕見 — prompt 已含所有 fix 關鍵詞），
  // 給一個「精簡版」當保底，免得 LLM 空手。
  if (options.length === 0 && orig.length > 0) {
    options.push({
      rewrittenPrompt: orig
        .split(/[,，]/)
        .map(s => s.trim())
        .filter((s, i, arr) => s.length > 0 && arr.indexOf(s) === i)
        .join(", "),
      touchedDimensions: ["精簡度"],
      rationale: "原 prompt 已含多數強化詞，這版去除重複關鍵詞",
    });
  }

  return { original: orig, options };
}

function containsAnyToken(text: string, patch: string): boolean {
  const lower = text.toLowerCase();
  const tokens = patch
    .toLowerCase()
    .split(/[,，]/)
    .map(t => t.trim())
    .filter(t => t.length >= 4);
  return tokens.some(t => lower.includes(t));
}

// ─── planHandoff：critique 完該交給誰 ────────────────────────────────────

export type CritiqueType = "prompt-level" | "model-level" | "settings-level" | "creative-direction";

export interface PlanHandoffInput {
  modality: CriticModality;
  /** critique 的本質類型 */
  critiqueType: CritiqueType;
  /** 使用者已經接受要動手改了嗎？沒接受時 handoff 仍只是「建議」 */
  userAcceptedFix?: boolean;
  /** 從 reviewAsset 拿到的 suggestedHandoff（會優先採納） */
  suggestedHandoff?: { to: AgentRole; reason: string };
}

export interface PlanHandoffResult {
  to: AgentRole;
  reason: string;
  /** 給 LLM 寫出 "@{nickname} 接手 ___" 用 */
  intentSummary: string;
  /** 是否要求使用者先點頭再 handoff（避免擅自轉手） */
  requiresUserConfirmation: boolean;
}

const HANDOFF_BY_CRITIQUE: Record<CritiqueType, { to: AgentRole; reason: string }> = {
  "prompt-level": {
    to: "quality-coach",
    reason: "改寫是 prompt 寫法層的問題，交給巧巧用具體公式重寫",
  },
  "model-level": {
    to: "researcher",
    reason: "需要評估換模型 / 比較選項，交給查查列差別後再決定",
  },
  "settings-level": {
    to: "composer",
    reason: "改的是 aspect / 模型參數，交給編編在當頁直接套",
  },
  "creative-direction": {
    to: "inspiration-specialist",
    reason: "整體方向需要重來，交給靈靈丟新風格 / 主題參考",
  },
};

/**
 * 給定 critique 性質，決定下一棒。優先採納 reviewAsset 給的 handoff
 * （那是看過實際 improvements 內容決定的）；沒給就 fallback 用 critiqueType。
 */
export function planHandoff(input: PlanHandoffInput): PlanHandoffResult {
  const decision = input.suggestedHandoff ?? HANDOFF_BY_CRITIQUE[input.critiqueType];

  const intentByModality: Record<CriticModality, string> = {
    image: "把改進建議套到圖片版本",
    video: "把改進建議套到影片重生成",
    music: "把改進建議套到下一版配樂",
    voice: "把改進建議套到下一版配音",
    text: "把改進建議套到下一版文案",
  };

  return {
    to: decision.to,
    reason: decision.reason,
    intentSummary: intentByModality[input.modality],
    // 使用者還沒明說「改吧」之前，handoff 是建議性質，要等他點頭
    requiresUserConfirmation: !input.userAcceptedFix,
  };
}
