/**
 * server/services/spiritTools/inspirationSpecialistTools.ts
 *
 * Tools for the inspiration-specialist (靈靈) spirit — 真正的「找靈感」AI 代理。
 *
 * 設計重點（取代前一版的 mock-only 實作）：
 *   1. searchTrends 真接到 inspirationFetcher (Perplexity Sonar)，回傳真實
 *      網路趨勢；Sonar 不可用時退回到內建 STYLE_ATLAS 的策展靜態趨勢。
 *   2. getCreativeSuggestions 從 STYLE_ATLAS 動態挑選與使用者意圖最匹配的
 *      風格，組出 N 條可貼提示詞 + handoff 目標（圖圖 / 影影 / 音音 / 聲聲）。
 *   3. analyzeReference 把參考圖 URL 餵到 Sonar，請它描述視覺風格、色彩、
 *      構圖、氛圍，並回傳可直接送入下一棒的提示詞種子。Sonar 失敗時退回到
 *      高品質的「視覺檢核清單」。
 *   4. getStyleMixingSuggestions 從 atlas 中動態組出有效風格混搭（可指定
 *      seedStyle），不再寫死固定 3 組。
 *   5. 新增 buildMoodBoard / refinePromptVariants / rankStylesByIntent /
 *      getStyleAtlas — 讓 LLM 規劃端能呼叫具體工具，而不是要求 LLM 自己
 *      臨場生成所有結構化資料。
 *
 * 不直接生圖／生影／生音／生語音（那是各 specialist 的職責）— 靈靈只負責
 * 「找方向 + 推風格 + 寫範例提示詞」並列出建議交棒對象。
 */

import { logger } from "../../_core/logger";
import {
  fetchInspiration,
  type InspirationAngle,
  type InspirationCard,
  type InspirationFetchResult,
  type InspirationFormat,
  type InspirationModality,
} from "../inspirationFetcher";

// ─── 共用類型 ──────────────────────────────────────────────────────────────

export type CreativeModality = "image" | "video" | "audio" | "voice" | "3d" | "general";
export type TrendCategory = "image" | "video" | "music" | "general";

/** Spirit role that should typically pick up after 靈靈 hands off the prompt. */
export type HandoffSpirit =
  | "image-specialist"
  | "video-specialist"
  | "music-specialist"
  | "voice-specialist"
  | "training-specialist"
  | "anatomy-specialist"
  | "composer";

// ─── STYLE_ATLAS — 30+ 策展視覺風格 ──────────────────────────────────────
//
// 靈靈的靈感原料庫。每筆都含：
//   - styleId          英文短碼，可用於 logging / UI
//   - displayName      繁中顯示用
//   - englishKeywords  可直接塞進 Flux / Sora / SDXL prompt 的英文關鍵字
//   - palette          建議色調（給 mood board 用）
//   - lighting         典型打光描述（英文，給 prompt 用）
//   - composition      典型構圖（英文）
//   - moodTags         情緒 / 氛圍 tags（繁中，給使用者選）
//   - modalities       此風格適用的模態（image / video / general 等）
//   - popularity       0-100 的策展熱度分數（給 ranking 用，非即時數據）
//   - matchKeywords    使用者輸入中可能命中的關鍵字（繁中 + 英文）

export interface StyleAtlasEntry {
  styleId: string;
  displayName: string;
  englishKeywords: string;
  palette: string[];
  lighting: string;
  composition: string;
  moodTags: string[];
  modalities: ReadonlyArray<CreativeModality>;
  popularity: number;
  matchKeywords: string[];
}

const STYLE_ATLAS: ReadonlyArray<StyleAtlasEntry> = [
  {
    styleId: "cyberpunk-neon",
    displayName: "賽博龐克霓虹",
    englishKeywords: "cyberpunk city, neon lights, rain-slick streets, holographic signage, futuristic dystopia",
    palette: ["#0ff", "#f0f", "#1a0033", "#000814"],
    lighting: "neon rim light, wet asphalt reflections, volumetric haze",
    composition: "low angle, leading lines, deep three-point perspective",
    moodTags: ["未來感", "夜晚", "戲劇張力", "科技"],
    modalities: ["image", "video", "general"],
    popularity: 88,
    matchKeywords: ["賽博龐克", "霓虹", "未來", "科幻", "夜城", "cyberpunk", "neon"],
  },
  {
    styleId: "lofi-pastel-anime",
    displayName: "Lo-fi 粉彩動畫",
    englishKeywords: "lofi pastel anime, soft watercolor, dreamy slice-of-life, Studio Ghibli inspired",
    palette: ["#ffd6e0", "#c7ceea", "#fff5ba", "#b5ead7"],
    lighting: "soft window light, golden hour pastel, gentle ambient occlusion",
    composition: "mid shot, rule of thirds, cozy framing",
    moodTags: ["治癒", "溫柔", "懷舊", "日系"],
    modalities: ["image", "video", "general"],
    popularity: 82,
    matchKeywords: ["lofi", "粉彩", "治癒", "ghibli", "宮崎駿", "pastel", "anime", "動畫"],
  },
  {
    styleId: "minimalist-editorial",
    displayName: "極簡編輯風",
    englishKeywords: "minimalist editorial photography, generous negative space, single hero subject, swiss design",
    palette: ["#ffffff", "#0a0a0a", "#d4d4d4"],
    lighting: "diffuse softbox, even key light, low contrast",
    composition: "centered hero, large negative space, grid alignment",
    moodTags: ["乾淨", "高級", "現代", "品牌"],
    modalities: ["image", "general"],
    popularity: 78,
    matchKeywords: ["極簡", "簡潔", "minimal", "editorial", "雜誌", "品牌"],
  },
  {
    styleId: "brutalist-poster",
    displayName: "粗野主義海報",
    englishKeywords: "brutalist poster design, raw typography, harsh contrast, concrete textures, bauhaus inspired",
    palette: ["#1a1a1a", "#f5f5dc", "#cc0000"],
    lighting: "flat lighting, hard shadow",
    composition: "grid-broken layout, oversized type, intentional asymmetry",
    moodTags: ["強烈", "反叛", "前衛"],
    modalities: ["image", "general"],
    popularity: 71,
    matchKeywords: ["粗野", "海報", "brutalist", "bauhaus", "前衛", "poster"],
  },
  {
    styleId: "retro-vhs-80s",
    displayName: "復古 VHS 80s",
    englishKeywords: "80s VHS aesthetic, retro chromatic aberration, scanlines, magenta cyan grading, analog grain",
    palette: ["#ff006e", "#3a86ff", "#fb5607", "#ffbe0b"],
    lighting: "tube TV glow, mixed neon practicals, slight CRT haze",
    composition: "head-on framing, retro title card, deliberate imperfection",
    moodTags: ["懷舊", "復古", "玩味"],
    modalities: ["image", "video", "general"],
    popularity: 74,
    matchKeywords: ["復古", "80s", "vhs", "retro", "懷舊", "錄影帶"],
  },
  {
    styleId: "cinematic-noir",
    displayName: "電影黑色懸疑",
    englishKeywords: "cinematic film noir, anamorphic widescreen, high contrast monochrome with selective color, smoky atmosphere",
    palette: ["#0a0a0a", "#e0e0e0", "#8b0000"],
    lighting: "single hard key light, venetian blind shadows, deep blacks",
    composition: "Dutch angle, low-key, framed in shadows",
    moodTags: ["懸疑", "戲劇", "陰鬱"],
    modalities: ["image", "video", "general"],
    popularity: 73,
    matchKeywords: ["電影", "黑色", "noir", "懸疑", "cinematic"],
  },
  {
    styleId: "watercolor-illustration",
    displayName: "水彩插畫",
    englishKeywords: "loose watercolor illustration, wet-on-wet bleeding, paper texture visible, hand-drawn feel",
    palette: ["#a8dadc", "#f1faee", "#e63946", "#457b9d"],
    lighting: "natural daylight, no harsh shadows",
    composition: "centered subject, white border, organic edges",
    moodTags: ["柔和", "藝術", "手作"],
    modalities: ["image", "general"],
    popularity: 76,
    matchKeywords: ["水彩", "插畫", "watercolor", "手繪", "藝術"],
  },
  {
    styleId: "isometric-3d",
    displayName: "等距 3D",
    englishKeywords: "isometric 3D render, clean vector style, soft global illumination, tiny world",
    palette: ["#7209b7", "#4cc9f0", "#f72585", "#4361ee"],
    lighting: "soft three-point GI, ambient sky light",
    composition: "30-degree isometric angle, miniature world layout",
    moodTags: ["可愛", "資訊圖", "科技"],
    modalities: ["image", "3d", "general"],
    popularity: 70,
    matchKeywords: ["等距", "isometric", "3d", "向量", "vector"],
  },
  {
    styleId: "y2k-chrome",
    displayName: "Y2K 銀色金屬",
    englishKeywords: "Y2K chrome aesthetic, liquid metal text, holographic stickers, frutiger aero gradient",
    palette: ["#c0c0c0", "#ff66cc", "#66ccff", "#ffff99"],
    lighting: "studio HDRI, mirror reflections, candy gloss",
    composition: "front-facing hero object, gradient backdrop",
    moodTags: ["前衛", "千禧年", "未來"],
    modalities: ["image", "general"],
    popularity: 79,
    matchKeywords: ["y2k", "千禧", "chrome", "鉻金屬", "frutiger"],
  },
  {
    styleId: "ink-wash-chinese",
    displayName: "中國水墨",
    englishKeywords: "traditional chinese ink wash painting, sumi-e style, mountain landscape, calligraphy accents",
    palette: ["#1a1a1a", "#f5f0e8", "#7a3e3e"],
    lighting: "atmospheric perspective, misty layers",
    composition: "vertical scroll layout, generous emptiness, layered distance",
    moodTags: ["東方", "禪", "雅緻"],
    modalities: ["image", "general"],
    popularity: 68,
    matchKeywords: ["水墨", "東方", "ink wash", "中國風", "禪"],
  },
  {
    styleId: "brutal-flat-illustration",
    displayName: "扁平插畫",
    englishKeywords: "flat illustration, bold geometric shapes, limited palette, modern editorial vector",
    palette: ["#f94144", "#f8961e", "#f9c74f", "#90be6d", "#43aa8b"],
    lighting: "no realistic lighting, flat color planes",
    composition: "balanced asymmetry, focal contrast block",
    moodTags: ["現代", "編輯", "活潑"],
    modalities: ["image", "general"],
    popularity: 75,
    matchKeywords: ["扁平", "flat", "插畫", "editorial illustration"],
  },
  {
    styleId: "studio-product-clean",
    displayName: "棚拍純色產品",
    englishKeywords: "studio product photography, seamless backdrop, soft strip lighting, commercial gloss",
    palette: ["#ffffff", "#1a1a1a", "#e63946"],
    lighting: "softbox key + rim light, even fill, controlled reflections",
    composition: "centered product, slight three-quarter view, clean shadow",
    moodTags: ["商業", "乾淨", "高級"],
    modalities: ["image", "general"],
    popularity: 80,
    matchKeywords: ["產品", "product", "棚拍", "商業", "電商"],
  },
  {
    styleId: "documentary-portrait",
    displayName: "紀實人像",
    englishKeywords: "documentary portrait photography, available light, 50mm prime, candid expression, slight film grain",
    palette: ["#3a2e2a", "#d4b5a0", "#1a1a1a"],
    lighting: "natural window light, single source, soft shadow",
    composition: "mid-tight crop, eyes on upper third",
    moodTags: ["真實", "情感", "人物"],
    modalities: ["image", "video", "general"],
    popularity: 77,
    matchKeywords: ["紀實", "人像", "portrait", "documentary", "真實"],
  },
  {
    styleId: "fantasy-painterly",
    displayName: "奇幻畫感",
    englishKeywords: "fantasy painterly illustration, magical realism, volumetric god rays, glowing particles",
    palette: ["#3a86ff", "#ffbe0b", "#fb5607", "#8338ec"],
    lighting: "dramatic backlight, magical glow, atmospheric haze",
    composition: "hero shot, low angle, dynamic action",
    moodTags: ["奇幻", "史詩", "魔法"],
    modalities: ["image", "video", "general"],
    popularity: 81,
    matchKeywords: ["奇幻", "魔幻", "fantasy", "魔法", "史詩", "painterly"],
  },
  {
    styleId: "vaporwave-aesthetic",
    displayName: "蒸氣波美學",
    englishKeywords: "vaporwave aesthetic, roman bust statue, pink-purple gradient sky, palm trees in silhouette",
    palette: ["#ff71ce", "#01cdfe", "#05ffa1", "#b967ff"],
    lighting: "synth sunset gradient, neon glow",
    composition: "symmetric grid floor, single hero element, retro typography",
    moodTags: ["夢幻", "懷舊", "反烏托邦"],
    modalities: ["image", "general"],
    popularity: 66,
    matchKeywords: ["vaporwave", "蒸氣波", "synth", "夢幻"],
  },
  {
    styleId: "claymation-stop-motion",
    displayName: "黏土定格",
    englishKeywords: "claymation stop motion style, handmade clay textures, slight imperfection, warm studio light",
    palette: ["#e07a5f", "#f2cc8f", "#81b29a", "#3d405b"],
    lighting: "warm tungsten studio, soft shadow",
    composition: "small set diorama, eye-level shot",
    moodTags: ["手作", "可愛", "童趣"],
    modalities: ["image", "video", "3d", "general"],
    popularity: 64,
    matchKeywords: ["黏土", "定格", "claymation", "stop motion", "手作"],
  },
  {
    styleId: "japanese-ukiyo-e",
    displayName: "日本浮世繪",
    englishKeywords: "japanese ukiyo-e woodblock print, flat color planes, bold black outlines, mount fuji motifs",
    palette: ["#264653", "#2a9d8f", "#e76f51", "#f4a261"],
    lighting: "flat illustration, no realistic light",
    composition: "asymmetric balance, decorative borders",
    moodTags: ["東方", "傳統", "藝術"],
    modalities: ["image", "general"],
    popularity: 62,
    matchKeywords: ["浮世繪", "ukiyo-e", "和風", "日本"],
  },
  {
    styleId: "macro-product-food",
    displayName: "美食微距",
    englishKeywords: "macro food photography, steam visible, glistening texture, shallow depth of field",
    palette: ["#bc4749", "#a7c957", "#f2e8cf", "#386641"],
    lighting: "side window light, single reflector, dramatic falloff",
    composition: "tight macro crop, off-center focal point",
    moodTags: ["美味", "誘人", "精緻"],
    modalities: ["image", "general"],
    popularity: 73,
    matchKeywords: ["美食", "微距", "food", "macro", "料理"],
  },
  {
    styleId: "ambient-soundscape-lofi",
    displayName: "Lo-fi 環境氛圍音",
    englishKeywords: "lofi ambient soundscape, soft tape hiss, mellow jazz chord progression, rainfall texture",
    palette: ["#3d405b", "#81b29a", "#f2cc8f"],
    lighting: "n/a — audio",
    composition: "30-90 second loop, breathing dynamics",
    moodTags: ["放鬆", "讀書", "夜晚", "treyt:audio"],
    modalities: ["audio", "general"],
    popularity: 84,
    matchKeywords: ["lofi", "氛圍", "放鬆", "讀書", "ambient", "chill"],
  },
  {
    styleId: "cinematic-orchestral",
    displayName: "電影管弦",
    englishKeywords: "cinematic orchestral score, sweeping strings, hybrid percussion, hans zimmer inspired",
    palette: ["#1a1a1a", "#c9a96e", "#7d2828"],
    lighting: "n/a — audio",
    composition: "intro tension → build → emotional peak → resolution",
    moodTags: ["史詩", "壯闊", "情感"],
    modalities: ["audio", "general"],
    popularity: 79,
    matchKeywords: ["電影配樂", "管弦", "cinematic", "orchestral", "史詩"],
  },
  {
    styleId: "warm-narrator-voice",
    displayName: "溫暖敘事旁白",
    englishKeywords: "warm narrator voice, mid-low pitch, gentle pace 130wpm, slight breath, intimate close mic",
    palette: ["#3d2817", "#d4a574", "#f5e6d3"],
    lighting: "n/a — voice",
    composition: "close-mic, conversational pacing",
    moodTags: ["親切", "敘事", "podcast"],
    modalities: ["voice", "general"],
    popularity: 72,
    matchKeywords: ["旁白", "敘事", "narrator", "voice", "podcast"],
  },
  {
    styleId: "energetic-promo-voice",
    displayName: "活力廣告配音",
    englishKeywords: "energetic upbeat promo voice, bright timbre, dynamic pacing 160wpm, confident delivery",
    palette: ["#ff006e", "#ffbe0b", "#3a86ff"],
    lighting: "n/a — voice",
    composition: "punchy intro hook, accelerated mid, strong CTA close",
    moodTags: ["活力", "廣告", "促銷"],
    modalities: ["voice", "general"],
    popularity: 67,
    matchKeywords: ["廣告", "促銷", "活力", "promo"],
  },
  {
    styleId: "stylized-3d-character",
    displayName: "風格化 3D 角色",
    englishKeywords: "stylized 3D character, pixar-inspired proportions, subsurface scattering on skin, expressive eyes",
    palette: ["#f4a261", "#e76f51", "#2a9d8f", "#264653"],
    lighting: "three-point with rim, soft GI",
    composition: "hero pose, eye-level, three-quarter view",
    moodTags: ["可愛", "故事", "電影感"],
    modalities: ["image", "3d", "general"],
    popularity: 78,
    matchKeywords: ["3d", "角色", "character", "pixar", "風格化"],
  },
  {
    styleId: "architectural-visualization",
    displayName: "建築可視化",
    englishKeywords: "architectural visualization, golden hour lighting, photoreal materials, drone perspective",
    palette: ["#f4a261", "#264653", "#2a9d8f", "#e9c46a"],
    lighting: "golden hour sunlight, soft ambient occlusion",
    composition: "wide-angle drone view, leading lines, balanced sky",
    moodTags: ["專業", "建築", "空間"],
    modalities: ["image", "3d", "general"],
    popularity: 65,
    matchKeywords: ["建築", "archviz", "architectural", "空間", "可視化"],
  },
  {
    styleId: "kawaii-pastel-3d",
    displayName: "可愛粉彩 3D",
    englishKeywords: "kawaii pastel 3D, chubby proportions, glossy soft materials, big sparkly eyes",
    palette: ["#ffd6e0", "#bde0fe", "#cdb4db", "#ffc8dd"],
    lighting: "soft pink studio HDRI, no harsh shadows",
    composition: "centered hero plush, slight overhead angle",
    moodTags: ["可愛", "療癒", "甜美"],
    modalities: ["image", "3d", "general"],
    popularity: 81,
    matchKeywords: ["kawaii", "可愛", "粉彩", "療癒", "甜"],
  },
  {
    styleId: "dark-academia",
    displayName: "暗黑學院",
    englishKeywords: "dark academia, candle-lit library, leather-bound books, autumn wool textures, gothic windows",
    palette: ["#3d2817", "#7a5230", "#1a1a1a", "#d4a574"],
    lighting: "warm candlelight, single rim through window",
    composition: "intimate interior, layered foreground details",
    moodTags: ["復古", "學院", "神秘"],
    modalities: ["image", "video", "general"],
    popularity: 70,
    matchKeywords: ["dark academia", "暗黑學院", "復古", "圖書館", "gothic"],
  },
  {
    styleId: "solarpunk-utopia",
    displayName: "太陽龐克烏托邦",
    englishKeywords: "solarpunk utopia, lush vertical gardens, art nouveau curves, solar panels integrated, optimistic future",
    palette: ["#a7c957", "#386641", "#f2e8cf", "#bc4749"],
    lighting: "warm midday sun, dappled foliage shadow",
    composition: "human-scale view, organic flowing lines",
    moodTags: ["希望", "綠色", "未來"],
    modalities: ["image", "video", "general"],
    popularity: 72,
    matchKeywords: ["solarpunk", "太陽龐克", "綠色", "永續", "烏托邦"],
  },
  {
    styleId: "low-poly-game",
    displayName: "低多邊形遊戲",
    englishKeywords: "low poly game aesthetic, flat shaded triangles, vibrant gradient sky, miniature island",
    palette: ["#264653", "#2a9d8f", "#e9c46a", "#f4a261"],
    lighting: "directional sun, flat shading, no shadows",
    composition: "isometric island, diorama scale",
    moodTags: ["遊戲", "極簡", "可愛"],
    modalities: ["image", "3d", "general"],
    popularity: 67,
    matchKeywords: ["低多邊形", "low poly", "遊戲", "game"],
  },
  {
    styleId: "lofi-anime-night-city",
    displayName: "Lo-fi 動畫夜城",
    englishKeywords: "lofi anime night cityscape, makoto shinkai inspired, rain-slick reflections, single warm window light",
    palette: ["#1a1a2e", "#16213e", "#e94560", "#f5d491"],
    lighting: "single warm window glow, cool ambient blue, moon highlight",
    composition: "rooftop perspective, deep cityscape distance",
    moodTags: ["夜晚", "孤獨", "詩意"],
    modalities: ["image", "video", "general"],
    popularity: 83,
    matchKeywords: ["新海誠", "shinkai", "夜城", "夜晚", "lofi"],
  },
  {
    styleId: "split-tone-fashion-editorial",
    displayName: "雙色調時尚編輯",
    englishKeywords: "split tone fashion editorial, teal-orange grading, oversized garments, model in motion",
    palette: ["#0d3b66", "#faf0ca", "#f95738", "#ee964b"],
    lighting: "single strobe with grid, dark background, hard edge",
    composition: "full-length, exaggerated pose, asymmetric crop",
    moodTags: ["時尚", "雜誌", "前衛"],
    modalities: ["image", "general"],
    popularity: 69,
    matchKeywords: ["時尚", "fashion", "editorial", "雜誌", "雙色調"],
  },
];

/**
 * 用使用者的意圖文字對 STYLE_ATLAS 進行加權打分。
 * 分數來源：modality 匹配 + 關鍵字命中數 + 基礎熱度。
 * 純函式 — 不打外部 API，可被 LLM agent 多次呼叫做評估。
 */
function scoreStyleForIntent(
  entry: StyleAtlasEntry,
  opts: { intent: string; modality?: CreativeModality }
): number {
  const intentLower = opts.intent.toLowerCase();
  const modality = opts.modality ?? "general";

  // modality fit: 完全匹配 +30；general 在所有 modality 下都拿 +10
  let score = 0;
  if (entry.modalities.includes(modality)) score += 30;
  else if (entry.modalities.includes("general")) score += 10;
  else score -= 15;

  // 關鍵字命中：每命中一個 +12
  for (const kw of entry.matchKeywords) {
    if (!kw) continue;
    if (intentLower.includes(kw.toLowerCase())) score += 12;
  }

  // 熱度作為次要因子（最多 +20）
  score += Math.round(entry.popularity * 0.2);

  // 情緒 tag 命中（只算繁中 tag，避免假陽性）
  for (const tag of entry.moodTags) {
    if (intentLower.includes(tag)) score += 6;
  }

  return score;
}

function pickTopStyles(
  intent: string,
  modality: CreativeModality | undefined,
  limit: number
): StyleAtlasEntry[] {
  const scored = STYLE_ATLAS.map(entry => ({
    entry,
    score: scoreStyleForIntent(entry, { intent, modality }),
  }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.entry.popularity - a.entry.popularity;
  });
  return scored.slice(0, Math.max(1, limit)).map(s => s.entry);
}

/**
 * Modality → 該模態完成最後一棒的精靈。靈靈交棒時用這張表決定下一棒。
 */
function handoffSpiritFor(modality: CreativeModality): HandoffSpirit {
  switch (modality) {
    case "image":
      return "image-specialist";
    case "video":
      return "video-specialist";
    case "audio":
      return "music-specialist";
    case "voice":
      return "voice-specialist";
    case "3d":
      return "image-specialist";
    case "general":
    default:
      return "composer";
  }
}

function mapTrendCategoryToInspirationModality(
  category: TrendCategory
): InspirationModality {
  switch (category) {
    case "image":
      return "image";
    case "video":
      return "video";
    case "music":
      return "audio";
    case "general":
    default:
      return "general";
  }
}

// ─── 1. searchTrends ────────────────────────────────────────────────────────

export interface SearchTrendsResult {
  success: boolean;
  /** 真實 Sonar 提供的趨勢卡片（卡片 = title + promptKeywords + rationale + sourceUrl）。 */
  trends: Array<{
    topic: string;
    description: string;
    popularity: number;
    promptKeywords?: string;
    sourceUrl?: string;
    sourceTitle?: string;
    examples?: string[];
  }>;
  /** Sonar 給的整體摘要（沒打到時為空字串） */
  summary: string;
  /** 引用來源（Sonar 失敗時為空陣列） */
  sources: Array<{ title: string; url: string }>;
  /** 真實呼叫成功時為 "perplexity-native" / "openrouter-sonar"；fallback 時為 "atlas-fallback" */
  provider: InspirationFetchResult["provider"] | "atlas-fallback";
  /** Sonar 失敗 / 節流時的提示 */
  warning?: string;
}

/**
 * 搜尋指定類別目前在網路上的真實趨勢。優先打 Perplexity Sonar（透過
 * inspirationFetcher）；Sonar 因 key / 配額不可用時，降級回 STYLE_ATLAS 中
 * 依模態 + 熱度排序的策展靜態趨勢，永遠不空手。
 */
export async function searchTrends(input: {
  category: TrendCategory;
  region?: string;
  /** Throttle 計費對象 — 從 spirit chat 流程傳入使用者 ID */
  userId?: number | null;
  /** 額外語意修飾（如「春天婚紗」、「賽博龐克」），預設依 category 取 generic 主題 */
  topic?: string;
  maxResults?: number;
}): Promise<SearchTrendsResult> {
  const modality = mapTrendCategoryToInspirationModality(input.category);
  const region = input.region?.trim();
  const topicHint = input.topic?.trim();
  const topic = topicHint
    ? topicHint
    : input.category === "image"
      ? "AI 圖像生成 2025-2026 視覺風格"
      : input.category === "video"
        ? "AI 短影片 2025-2026 流行剪輯"
        : input.category === "music"
          ? "AI 音樂與環境氛圍音 2025-2026"
          : "AI 創作 2025-2026 跨模態趨勢";
  const composedTopic = region ? `${topic}（${region}）` : topic;
  const maxResults = Math.min(8, Math.max(3, input.maxResults ?? 5));

  try {
    const result = await fetchInspiration({
      userId: input.userId ?? null,
      topic: composedTopic,
      modality,
      angle: "trending",
      format: "visual_styles",
      maxResults,
    });

    if (result.ok && result.cards.length > 0) {
      const trends = result.cards.map(card => ({
        topic: card.title,
        description: card.rationale,
        // Sonar 沒提供 popularity 數字；用 atlas 平均熱度替代避免 0 顯示
        popularity: 80,
        promptKeywords: card.promptKeywords,
        sourceUrl: card.sourceUrl,
        sourceTitle: card.sourceTitle,
        examples: card.promptKeywords ? [card.promptKeywords] : undefined,
      }));
      logger.info("trends_searched_sonar", {
        category: input.category,
        provider: result.provider,
        trendCount: trends.length,
        region: region ?? null,
      });
      return {
        success: true,
        trends,
        summary: result.summary,
        sources: result.sources,
        provider: result.provider,
      };
    }

    // Sonar 失敗 / 空回 → 用 atlas 降級
    logger.warn("trends_search_fallback_to_atlas", {
      category: input.category,
      error: result.error ?? "empty",
    });
    return atlasTrendsFallback({
      category: input.category,
      modality,
      maxResults,
      warning: result.error,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("trend_search_failed", { category: input.category, error: msg });
    return atlasTrendsFallback({
      category: input.category,
      modality,
      maxResults,
      warning: msg,
    });
  }
}

function atlasTrendsFallback(opts: {
  category: TrendCategory;
  modality: InspirationModality;
  maxResults: number;
  warning?: string;
}): SearchTrendsResult {
  const eligible = STYLE_ATLAS.filter(s => {
    if (opts.modality === "general") return true;
    return s.modalities.includes(opts.modality as CreativeModality);
  });
  const sorted = [...eligible].sort((a, b) => b.popularity - a.popularity);
  const trends = sorted.slice(0, opts.maxResults).map(entry => ({
    topic: entry.displayName,
    description: entry.moodTags.join("、"),
    popularity: entry.popularity,
    promptKeywords: entry.englishKeywords,
    examples: [entry.englishKeywords],
  }));
  return {
    success: true,
    trends,
    summary: "（外部即時情報不可用，回傳策展庫排序）",
    sources: [],
    provider: "atlas-fallback",
    warning: opts.warning,
  };
}

// ─── 2. getCreativeSuggestions ──────────────────────────────────────────────

export interface CreativeSuggestion {
  title: string;
  description: string;
  prompt: string;
  tags: string[];
  /** 風格庫對應的 styleId — 方便 UI 連到 atlas 詳情 */
  styleId: string;
  /** 完成這條 prompt 應該交棒給哪個精靈執行（image / video / music / voice / composer） */
  handoffSpirit: HandoffSpirit;
  /** 熱度提示（atlas curated score） */
  popularity: number;
}

export interface CreativeSuggestionsResult {
  success: boolean;
  suggestions: CreativeSuggestion[];
  /** 給靈靈在對話框結尾接話用的「下一棒」提示 */
  followUp: string;
}

/**
 * 根據使用者意圖 + 模態 + 可選風格，從 STYLE_ATLAS 動態組出多條可貼提示詞建議。
 * 不再 mock — 每次呼叫都會依輸入產生不同的排序、不同的 handoff 建議。
 */
export function getCreativeSuggestions(input: {
  intent: string;
  style?: string;
  modality?: CreativeModality;
  /** 想要多少條建議（預設 3，上限 5） */
  count?: number;
}): CreativeSuggestionsResult {
  const intent = (input.intent ?? "").trim();
  if (!intent) {
    return {
      success: false,
      suggestions: [],
      followUp: "請先告訴靈靈你想做什麼方向（例如「我想做一張森林氛圍的圖」）。",
    };
  }
  const modality: CreativeModality = input.modality ?? "general";
  const count = Math.min(5, Math.max(1, input.count ?? 3));
  const handoff = handoffSpiritFor(modality);

  // 把 style hint 先綁進 intent 一起打分（保證 user 指定的風格優先進前 N）
  const composedIntent = input.style ? `${intent} ${input.style}` : intent;
  const top = pickTopStyles(composedIntent, modality, count);

  const suggestions: CreativeSuggestion[] = top.map(entry => {
    const promptParts = [
      entry.englishKeywords,
      entry.lighting,
      entry.composition,
      "high quality, cohesive composition",
    ].filter(s => s && s !== "n/a — audio" && s !== "n/a — voice");
    const promptHead = (modality === "audio" || modality === "voice")
      ? `${entry.englishKeywords}, ${entry.composition}`
      : promptParts.join(", ");
    return {
      title: entry.displayName,
      description: `${entry.moodTags.join("、")} — ${describeModalityFit(entry, modality)}`,
      prompt: `${intent}, ${promptHead}`,
      tags: entry.moodTags,
      styleId: entry.styleId,
      handoffSpirit: handoff,
      popularity: entry.popularity,
    };
  });

  return {
    success: true,
    suggestions,
    followUp: `要先試哪個方向？選定後我把提示詞交給${handoffSpiritLabel(handoff)}幫你產出。`,
  };
}

function describeModalityFit(
  entry: StyleAtlasEntry,
  modality: CreativeModality
): string {
  if (entry.modalities.includes(modality)) return `適合做${modalityLabel(modality)}`;
  if (entry.modalities.includes("general")) return "跨模態通用";
  return `（原本給${entry.modalities.map(modalityLabel).join("/")}用，跨用要小心）`;
}

function modalityLabel(modality: CreativeModality): string {
  return ({
    image: "圖",
    video: "影片",
    audio: "音樂",
    voice: "語音",
    "3d": "3D",
    general: "通用",
  } as Record<CreativeModality, string>)[modality];
}

function handoffSpiritLabel(s: HandoffSpirit): string {
  return ({
    "image-specialist": "圖圖",
    "video-specialist": "影影",
    "music-specialist": "音音",
    "voice-specialist": "聲聲",
    "training-specialist": "練練",
    "anatomy-specialist": "體體",
    composer: "編編",
  } as Record<HandoffSpirit, string>)[s];
}

// ─── 3. analyzeReference ────────────────────────────────────────────────────

export interface ReferenceAnalysis {
  style: string[];
  colors: string[];
  composition: string;
  mood: string;
  suggestedPrompts: string[];
  /** 由 Sonar 推測的相似 atlas 風格（最多 3 個 styleId） */
  similarStyles: string[];
}

export interface AnalyzeReferenceResult {
  success: boolean;
  analysis?: ReferenceAnalysis;
  /** 真實呼叫成功時為 "perplexity-native" / "openrouter-sonar"；deterministic 時為 "atlas-checklist" */
  provider:
    | InspirationFetchResult["provider"]
    | "atlas-checklist"
    | "none";
  sources?: Array<{ title: string; url: string }>;
  message: string;
  warning?: string;
}

/**
 * 接收一張參考圖 URL，用 Perplexity Sonar 嘗試解析其視覺風格、色調、構圖、
 * 氛圍，並從 STYLE_ATLAS 找出最接近的 1-3 個風格。
 *
 * 注意：Sonar 是文字 web search 引擎，並非真實 vision model。靈靈會把 URL
 * 當作搜尋上下文請 Sonar 描述（適用於公開可索引的圖片）；遇到 private URL
 * 或 Sonar 不可用時，退回到「視覺檢核清單」並請使用者口頭描述。
 */
export async function analyzeReference(input: {
  imageUrl: string;
  userId?: number | null;
  /** 若使用者已先口頭描述這張參考圖，附過來提高分析準確度 */
  userHint?: string;
}): Promise<AnalyzeReferenceResult> {
  const imageUrl = input.imageUrl?.trim();
  if (!imageUrl) {
    return {
      success: false,
      provider: "none",
      message: "imageUrl 必填",
    };
  }

  const hint = input.userHint?.trim();
  const topic = hint
    ? `分析這張參考圖的視覺風格 / 色調 / 構圖 / 氛圍：${imageUrl} — 使用者補充：${hint}`
    : `分析這張參考圖的視覺風格 / 色調 / 構圖 / 氛圍：${imageUrl}`;

  try {
    const result = await fetchInspiration({
      userId: input.userId ?? null,
      topic,
      modality: "image",
      angle: "trending",
      format: "visual_styles",
      maxResults: 4,
    });

    if (result.ok && result.cards.length > 0) {
      const analysis = sonarCardsToReferenceAnalysis(result.cards, hint);
      logger.info("reference_analyzed_sonar", {
        imageUrl,
        provider: result.provider,
        styleHits: analysis.style.length,
      });
      return {
        success: true,
        analysis,
        provider: result.provider,
        sources: result.sources,
        message: "已根據 Sonar 搜尋結果整理風格、色調、構圖、氛圍。",
      };
    }

    // Sonar 失敗 → 給結構化「檢核清單」並請使用者口頭描述
    logger.warn("reference_analysis_fallback_checklist", {
      imageUrl,
      error: result.error ?? "empty",
    });
    return {
      success: true,
      analysis: deterministicReferenceChecklist(hint),
      provider: "atlas-checklist",
      message:
        "外部視覺分析不可用，靈靈先給你一份檢核清單；你能用一句話描述這張圖嗎？（例如「夜晚街景、霓虹色調、低角度」）",
      warning: result.error,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("reference_analysis_failed", { imageUrl, error: msg });
    return {
      success: true,
      analysis: deterministicReferenceChecklist(hint),
      provider: "atlas-checklist",
      message: "解析時遇到問題，先給你檢核清單；可以用一句話描述這張圖嗎？",
      warning: msg,
    };
  }
}

function sonarCardsToReferenceAnalysis(
  cards: InspirationCard[],
  hint: string | undefined
): ReferenceAnalysis {
  const styleSet = new Set<string>();
  const colorSet = new Set<string>();
  const compositionParts: string[] = [];
  const moodParts: string[] = [];
  const promptSeeds: string[] = [];

  for (const card of cards) {
    // promptKeywords 通常含風格 + 色 + 構圖 + 光線；切片塞到對應 set
    if (card.promptKeywords) {
      promptSeeds.push(card.promptKeywords);
      const tokens = card.promptKeywords
        .split(/[,;]+/)
        .map(t => t.trim())
        .filter(Boolean);
      for (const tok of tokens) {
        const lower = tok.toLowerCase();
        if (/(color|tone|palette|gradient|saturat)/.test(lower)) colorSet.add(tok);
        else if (/(angle|shot|compos|framing|crop|perspective)/.test(lower))
          compositionParts.push(tok);
        else if (/(mood|atmosphere|vibe|feeling)/.test(lower)) moodParts.push(tok);
        else styleSet.add(tok);
      }
    }
  }

  // 從 atlas 找相似 styleId
  const aggregated = [hint ?? "", ...promptSeeds].join(" ");
  const similar = pickTopStyles(aggregated, "image", 3).map(s => s.styleId);

  return {
    style: Array.from(styleSet).slice(0, 6),
    colors: Array.from(colorSet).slice(0, 5),
    composition: compositionParts.length > 0 ? compositionParts.slice(0, 3).join(", ") : "未檢出 — 請描述",
    mood: moodParts.length > 0 ? moodParts.slice(0, 3).join(", ") : "未檢出 — 請描述",
    suggestedPrompts: promptSeeds.slice(0, 3),
    similarStyles: similar,
  };
}

function deterministicReferenceChecklist(hint: string | undefined): ReferenceAnalysis {
  // 純 deterministic：給使用者一份「請對著參考圖打勾的」結構化清單。
  // 不再回固定 mock 結果，而是顯式標示「等候使用者描述」。
  const seedFromHint = hint ?? "";
  const similar = seedFromHint
    ? pickTopStyles(seedFromHint, "image", 3).map(s => s.styleId)
    : [];
  return {
    style: [],
    colors: [],
    composition: "（等候使用者描述：視角 / 焦距 / 構圖法）",
    mood: "（等候使用者描述：1-2 個情緒 tag）",
    suggestedPrompts: [],
    similarStyles: similar,
  };
}

// ─── 4. getStyleMixingSuggestions ──────────────────────────────────────────

export interface StyleMix {
  name: string;
  styles: string[];
  description: string;
  example: string;
  /** 對應 atlas styleId 陣列，方便 UI 連結 */
  styleIds: string[];
}

export interface StyleMixingResult {
  success: boolean;
  combinations: StyleMix[];
}

/**
 * 動態組出風格混搭。傳 seedStyle（自然語或 styleId）會與該風格互補；
 * 不傳則回傳依熱度與多模態通用性排序的前 N 組混搭。
 */
export function getStyleMixingSuggestions(input?: {
  seedStyle?: string;
  modality?: CreativeModality;
  count?: number;
}): StyleMixingResult {
  const count = Math.min(6, Math.max(2, input?.count ?? 3));
  const modality: CreativeModality = input?.modality ?? "general";

  let seedEntry: StyleAtlasEntry | undefined;
  if (input?.seedStyle?.trim()) {
    const seedKey = input.seedStyle.trim().toLowerCase();
    seedEntry = STYLE_ATLAS.find(
      s => s.styleId === seedKey || s.matchKeywords.some(k => k.toLowerCase() === seedKey)
    );
    if (!seedEntry) {
      // fallback：把 seedStyle 當 intent 對 atlas 打分，取最高
      seedEntry = pickTopStyles(input.seedStyle, modality, 1)[0];
    }
  }

  const eligible = STYLE_ATLAS.filter(s => {
    if (seedEntry && s.styleId === seedEntry.styleId) return false;
    if (modality === "general") return true;
    return s.modalities.includes(modality) || s.modalities.includes("general");
  });

  let pairs: Array<{ a: StyleAtlasEntry; b: StyleAtlasEntry; affinity: number }> = [];
  if (seedEntry) {
    for (const other of eligible) {
      pairs.push({
        a: seedEntry,
        b: other,
        affinity: pairAffinity(seedEntry, other),
      });
    }
  } else {
    const sortedByPop = [...eligible].sort((a, b) => b.popularity - a.popularity);
    for (let i = 0; i < sortedByPop.length && pairs.length < count * 4; i++) {
      for (let j = i + 1; j < sortedByPop.length && pairs.length < count * 4; j++) {
        pairs.push({
          a: sortedByPop[i],
          b: sortedByPop[j],
          affinity: pairAffinity(sortedByPop[i], sortedByPop[j]),
        });
      }
    }
  }
  pairs.sort((p, q) => q.affinity - p.affinity);

  const combinations: StyleMix[] = pairs.slice(0, count).map(pair => ({
    name: `${pair.a.displayName} × ${pair.b.displayName}`,
    styles: [pair.a.englishKeywords, pair.b.englishKeywords],
    description: `${pair.a.moodTags.slice(0, 2).join("、")} 融合 ${pair.b.moodTags.slice(0, 2).join("、")}`,
    example: `${pair.a.englishKeywords}, blended with ${pair.b.englishKeywords}, ${pair.a.lighting}`,
    styleIds: [pair.a.styleId, pair.b.styleId],
  }));

  return { success: true, combinations };
}

/**
 * 兩個風格的「混搭親和度」— 共同 modality 越多越親，共同情緒 tag 加分，
 * 對立情緒（如「乾淨」vs「強烈」）也加分（反差有效），熱度差距大會輕微扣分。
 */
function pairAffinity(a: StyleAtlasEntry, b: StyleAtlasEntry): number {
  const sharedModalities = a.modalities.filter(m => b.modalities.includes(m)).length;
  const sharedMoods = a.moodTags.filter(t => b.moodTags.includes(t)).length;
  const popDelta = Math.abs(a.popularity - b.popularity);
  const contrastBonus =
    a.moodTags.some(t => CONTRAST_PAIRS.includes(t)) &&
    b.moodTags.some(t => CONTRAST_PAIRS.includes(t))
      ? 8
      : 0;
  return sharedModalities * 10 + sharedMoods * 4 + contrastBonus - Math.round(popDelta / 5);
}

const CONTRAST_PAIRS = ["乾淨", "強烈", "夜晚", "活力", "懷舊", "未來"];

// ─── 5. buildMoodBoard（新工具） ────────────────────────────────────────────

export interface MoodBoardCard {
  title: string;
  promptKeywords: string;
  palette: string[];
  rationale: string;
  styleId?: string;
  sourceUrl?: string;
}

export interface MoodBoardResult {
  success: boolean;
  topic: string;
  summary: string;
  palette: string[];
  cards: MoodBoardCard[];
  /** 真實 Sonar 命中時為其網路來源；空 Sonar 時為空陣列 */
  sources: Array<{ title: string; url: string }>;
  /** 給直接交棒的下一棒精靈 + 一條可貼提示詞種子 */
  handoff: {
    spirit: HandoffSpirit;
    promptSeed: string;
  };
  provider: SearchTrendsResult["provider"] | "atlas-only";
  warning?: string;
}

/**
 * 把 searchTrends + STYLE_ATLAS + 風格混搭整合成一張完整 mood board。
 * 設計：先打 Sonar 拿 2-3 張即時卡片，再用 atlas 補滿 4-5 張策展卡片，
 * 最後抽出共同的 palette + 給定 handoff spirit。
 */
export async function buildMoodBoard(input: {
  topic: string;
  modality?: CreativeModality;
  userId?: number | null;
  /** 想要幾張卡片（預設 5，上限 8） */
  size?: number;
}): Promise<MoodBoardResult> {
  const topic = (input.topic ?? "").trim();
  if (!topic) {
    return {
      success: false,
      topic: "",
      summary: "topic 必填",
      palette: [],
      cards: [],
      sources: [],
      handoff: { spirit: "composer", promptSeed: "" },
      provider: "atlas-only",
    };
  }
  const modality: CreativeModality = input.modality ?? "general";
  const size = Math.min(8, Math.max(3, input.size ?? 5));

  // 1. 嘗試打 Sonar 拿即時趨勢
  const trendCategory: TrendCategory =
    modality === "image" || modality === "video" || modality === "general"
      ? (modality === "general" ? "general" : modality)
      : modality === "audio" || modality === "voice"
        ? "music"
        : "general";

  const trends = await searchTrends({
    category: trendCategory,
    topic,
    userId: input.userId,
    maxResults: Math.min(5, size),
  });

  const sonarCards: MoodBoardCard[] = trends.trends.slice(0, Math.ceil(size / 2)).map(t => ({
    title: t.topic,
    promptKeywords: t.promptKeywords ?? t.description,
    palette: [],
    rationale: t.description,
    sourceUrl: t.sourceUrl,
  }));

  // 2. 從 atlas 取 top 風格補滿剩下卡片
  const remaining = Math.max(0, size - sonarCards.length);
  const atlasPicks = pickTopStyles(topic, modality, remaining);
  const atlasCards: MoodBoardCard[] = atlasPicks.map(entry => ({
    title: entry.displayName,
    promptKeywords: entry.englishKeywords,
    palette: entry.palette,
    rationale: `${entry.moodTags.join("、")} — ${describeModalityFit(entry, modality)}`,
    styleId: entry.styleId,
  }));

  const cards = [...sonarCards, ...atlasCards].slice(0, size);

  // 3. 聚合 palette
  const paletteSet = new Set<string>();
  for (const c of cards) for (const p of c.palette) paletteSet.add(p);
  if (paletteSet.size === 0) {
    for (const entry of atlasPicks) for (const p of entry.palette) paletteSet.add(p);
  }
  const palette = Array.from(paletteSet).slice(0, 6);

  // 4. handoff
  const handoffSpirit = handoffSpiritFor(modality);
  const seedEntry = atlasPicks[0] ?? null;
  const promptSeed = seedEntry
    ? `${topic}, ${seedEntry.englishKeywords}, ${seedEntry.lighting}, ${seedEntry.composition}, high quality`
    : `${topic}, cinematic high quality`;

  return {
    success: true,
    topic,
    summary:
      trends.summary && trends.summary.trim().length > 0
        ? trends.summary
        : `策展 ${cards.length} 張卡片給「${topic}」（${modalityLabel(modality)}）。`,
    palette,
    cards,
    sources: trends.sources,
    handoff: {
      spirit: handoffSpirit,
      promptSeed,
    },
    provider: trends.provider,
    warning: trends.warning,
  };
}

// ─── 6. refinePromptVariants（新工具） ─────────────────────────────────────

export interface PromptVariant {
  prompt: string;
  rationale: string;
  styleId: string;
  styleName: string;
  handoffSpirit: HandoffSpirit;
}

export interface RefinePromptVariantsResult {
  success: boolean;
  original: string;
  variants: PromptVariant[];
}

/**
 * 把使用者的草稿提示詞用 3 種不同風格角度強化 — 每條都附 rationale 與
 * 建議交棒精靈，方便使用者點哪一條就直接送給對應 specialist。
 */
export function refinePromptVariants(input: {
  draftPrompt: string;
  modality?: CreativeModality;
  count?: number;
  /** 想避免的風格（styleId 或自然語） */
  excludeStyles?: string[];
}): RefinePromptVariantsResult {
  const draft = (input.draftPrompt ?? "").trim();
  if (!draft) {
    return { success: false, original: "", variants: [] };
  }
  const modality = input.modality ?? "general";
  const count = Math.min(5, Math.max(1, input.count ?? 3));
  const handoff = handoffSpiritFor(modality);
  const excludeIds = new Set(
    (input.excludeStyles ?? [])
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
  );

  const candidates = pickTopStyles(draft, modality, count + excludeIds.size + 2).filter(
    entry => {
      if (excludeIds.has(entry.styleId.toLowerCase())) return false;
      if (excludeIds.has(entry.displayName.toLowerCase())) return false;
      return true;
    }
  );

  const variants: PromptVariant[] = candidates.slice(0, count).map(entry => ({
    prompt: composeRefinedPrompt(draft, entry, modality),
    rationale: `${entry.moodTags.join("、")}（${describeModalityFit(entry, modality)}），${entry.composition} + ${entry.lighting}`,
    styleId: entry.styleId,
    styleName: entry.displayName,
    handoffSpirit: handoff,
  }));

  return {
    success: true,
    original: draft,
    variants,
  };
}

function composeRefinedPrompt(
  draft: string,
  entry: StyleAtlasEntry,
  modality: CreativeModality
): string {
  if (modality === "audio" || modality === "voice") {
    return `${draft}, ${entry.englishKeywords}, ${entry.composition}`;
  }
  return `${draft}, ${entry.englishKeywords}, ${entry.lighting}, ${entry.composition}, high quality, coherent composition`;
}

// ─── 7. rankStylesByIntent（新工具） ───────────────────────────────────────

export interface StyleRanking {
  styleId: string;
  displayName: string;
  score: number;
  reasons: string[];
  popularity: number;
  modalities: ReadonlyArray<CreativeModality>;
}

export interface RankStylesByIntentResult {
  success: boolean;
  rankings: StyleRanking[];
}

export function rankStylesByIntent(input: {
  intent: string;
  modality?: CreativeModality;
  limit?: number;
}): RankStylesByIntentResult {
  const intent = (input.intent ?? "").trim();
  if (!intent) return { success: false, rankings: [] };
  const modality = input.modality ?? "general";
  const limit = Math.min(15, Math.max(1, input.limit ?? 8));

  const scored = STYLE_ATLAS.map(entry => {
    const score = scoreStyleForIntent(entry, { intent, modality });
    const reasons: string[] = [];
    if (entry.modalities.includes(modality)) reasons.push(`命中模態「${modalityLabel(modality)}」`);
    const hits = entry.matchKeywords.filter(k =>
      intent.toLowerCase().includes(k.toLowerCase())
    );
    if (hits.length > 0) reasons.push(`關鍵字命中：${hits.slice(0, 3).join(" / ")}`);
    if (entry.popularity >= 75) reasons.push(`策展熱度 ${entry.popularity}`);
    return { entry, score, reasons };
  });

  scored.sort((a, b) => b.score - a.score || b.entry.popularity - a.entry.popularity);

  return {
    success: true,
    rankings: scored.slice(0, limit).map(s => ({
      styleId: s.entry.styleId,
      displayName: s.entry.displayName,
      score: s.score,
      reasons: s.reasons,
      popularity: s.entry.popularity,
      modalities: s.entry.modalities,
    })),
  };
}

// ─── 8. getStyleAtlas（新工具） ────────────────────────────────────────────

export interface StyleAtlasResult {
  success: boolean;
  totalCount: number;
  entries: ReadonlyArray<StyleAtlasEntry>;
}

/**
 * 暴露完整 atlas 給 UI picker / LLM 規劃端使用。
 * 可選 modality 過濾。
 */
export function getStyleAtlas(input?: {
  modality?: CreativeModality;
}): StyleAtlasResult {
  const modality = input?.modality;
  const entries = modality
    ? STYLE_ATLAS.filter(s => s.modalities.includes(modality) || s.modalities.includes("general"))
    : STYLE_ATLAS;
  return {
    success: true,
    totalCount: entries.length,
    entries,
  };
}

// ─── 內部 helper export — 供測試使用 ───────────────────────────────────────

export const __internals = {
  STYLE_ATLAS,
  scoreStyleForIntent,
  pickTopStyles,
  handoffSpiritFor,
  pairAffinity,
};
