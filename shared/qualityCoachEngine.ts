/**
 * shared/qualityCoachEngine.ts
 *
 * 巧巧（quality-coach）的純函式引擎。
 *
 * 之前的問題：
 *   1. shared/agent-skills.ts 把 quality-coach 的 tools 設成 []，巧巧整個
 *      「改寫提示詞」能力只能靠 LLM 嘴砲，沒有 server 端事實後盾。
 *   2. client/src/lib/spiritWatchers.ts 的 detectStrugglingPrompt 只用字元
 *      Jaccard 相似度（對中文有偏誤 — 兩條完全不同的中文短句 set intersection
 *      還是會很高）+ 硬寫死的「午後光線, 35mm 淺景深」當改寫建議。
 *
 * 這個檔提供「巧巧腦袋」的核心邏輯：
 *   - detectModality(prompt)        — 用 keywords 推斷使用者在做哪一種模態
 *   - parseDimensions(prompt, modality) — 拆出 7 個維度命中情況（依模態）
 *   - scorePrompt(prompt, modality?) — 0-100 分 + 對應缺失維度清單
 *   - rewritePrompt(prompt, opts)   — 把缺的維度填好的可貼版本
 *   - comparePrompts(a, b)          — 兩條 prompt 哪條好 + 為什麼
 *   - getTemplates(modality, style?)— 該模態的 1-3 條照樣造句模板
 *   - jaccardWordSimilarity(a, b)   — 改良版相似度（n-gram word level）
 *
 * 全部 pure / sync / 無 I/O，client 與 server 都可 import：
 *   - server/services/spiritTools/qualityCoachTools.ts 把它包成 tool
 *   - client/src/lib/spiritWatchers.ts 用它做 struggling-prompt 偵測
 *
 * 設計原則：
 *   - 寧可保守不命中，也不要錯命中（false-positive 會讓巧巧講廢話）
 *   - 7 維度的關鍵字集合就是 server-side 事實，跟 LLM 講的「公式」對齊
 *   - rewrite 是 *確定性* 的填空 — 缺什麼補什麼，不亂改使用者原文
 */

// ─── Types ───────────────────────────────────────────────────────────────

/**
 * 巧巧目前處理 5 種模態。general 是「沒明顯訊號」時的 fallback（仍可給泛用
 * 建議：主題 / 受眾 / 平台），但分數權重會跟模態化情境不同。
 */
export type QualityModality = "image" | "video" | "music" | "voice" | "general";

/**
 * 每條 prompt 都會被檢查的 7 個維度。對不同模態，同一個維度可能對應不同
 * 關鍵字 — DIMENSION_KEYWORDS[modality][dimension] 是真實映射。
 *
 * 命名刻意短，方便寫到 system prompt 與 toast 文案。
 */
export type PromptDimension =
  | "subject"      // 主體（誰 / 什麼東西）
  | "action"       // 動作 / 姿態 / 運動
  | "scene"        // 場景 / 環境
  | "lighting"     // 光線（image / video）/ 氛圍（audio / voice）
  | "style"        // 風格 / 類型 / 流派
  | "camera"       // 鏡頭 / 構圖（image / video）/ BPM（music）/ 語速（voice）
  | "quality";     // 質感 / 細節詞（image / video）/ 段落（music）/ 場景（voice）

export interface DimensionHit {
  dimension: PromptDimension;
  /** 命中的關鍵字（取第一個用於回顯） */
  matchedKeyword: string | null;
  /** 維度當下對使用者顯示的標籤（依模態） */
  label: string;
  /** 是否命中 */
  present: boolean;
}

export interface PromptDiagnosis {
  /** 偵測到的模態（沒明顯訊號回 general） */
  modality: QualityModality;
  /** 各維度命中情況（順序固定） */
  dimensions: DimensionHit[];
  /** 0-100 分，未命中維度越多扣越多 */
  score: number;
  /** 缺哪些維度（依使用者顯示用優先序） */
  missingDimensions: PromptDimension[];
  /** 命中哪些維度 */
  presentDimensions: PromptDimension[];
  /** 主要可改進處（最多 3 條，每條一句白話） */
  issues: string[];
  /** 1 個可貼進去的下一步建議句 */
  nextStepSuggestion: string;
  /** 統計 */
  stats: {
    length: number;
    wordCount: number;
    /** 是否疑似中英混排 */
    hasMixedScript: boolean;
    /** 是否塞太多重複的「質感詞」（>4 個質感詞 → 過載扣分） */
    qualityWordOverload: boolean;
  };
}

export interface RewriteResult {
  original: string;
  rewritten: string;
  modality: QualityModality;
  /** 真的補了哪些維度（rewrite 不會亂改有的維度） */
  filledDimensions: PromptDimension[];
  /** 每個維度補了什麼字（拿來在 UI 上 highlight） */
  additions: Array<{
    dimension: PromptDimension;
    label: string;
    snippet: string;
  }>;
  /** 1 句話跟使用者解釋這次改了什麼 */
  explanation: string;
}

export interface CompareResult {
  promptA: { text: string; diagnosis: PromptDiagnosis };
  promptB: { text: string; diagnosis: PromptDiagnosis };
  /** "A" / "B" / "tie" — 依 score 判斷 */
  winner: "A" | "B" | "tie";
  /** B 比 A 多覆蓋的維度 */
  gained: PromptDimension[];
  /** B 比 A 少覆蓋的維度 */
  lost: PromptDimension[];
  /** 1 句話總結 */
  summary: string;
}

export interface TemplateSpec {
  modality: QualityModality;
  styleHint: string;
  template: string;
  /** 用使用者主體填入後的範例（占位符 [主體] 已替換成 example subject） */
  example: string;
}

// ─── Modality detection ──────────────────────────────────────────────────

/**
 * 簡化的模態偵測 — 比 shared/agent-modality-keywords.ts 嚴格：那邊偵測
 * 「對話裡提到某模態」(寬鬆，用於路由)，這邊偵測「使用者正在寫的 prompt
 * 本身是哪一種模態」(嚴格，用於品質教練)。
 *
 * 規則：
 *   - 找專屬動詞先（畫 / 出圖 / 影片 / 配音 / 配樂…）
 *   - 沒命中再看名詞（角色立繪、BGM、旁白）
 *   - 都沒命中 → general（仍能給泛用建議）
 */
const MODALITY_HINTS: Record<Exclude<QualityModality, "general">, ReadonlyArray<string>> = {
  image: [
    "出圖", "畫一張", "畫個", "海報", "插畫", "立繪", "頭像", "角色設計",
    "封面", "logo", "圖片", "photo", "portrait", "poster", "illustration",
    "key visual", "concept art", "wallpaper",
    // 常見「描述一個人 / 角色」的中文句式 — 通常隱含「我在描述一張圖」
    "一位", "一隻", "一個女", "一個男", "一群",
    "女性", "男性", "少女", "少年", "女孩", "男孩",
  ],
  video: [
    "影片", "短片", "video", "teaser", "trailer", "reel", "shorts",
    "動畫", "animation", "motion graphic", "clip", "對嘴", "lipsync",
    "鏡頭", "分鏡",
  ],
  music: [
    "音樂", "bgm", "配樂", "soundtrack", "歌曲", "ost", "loop", "音效",
    "sfx", "ambient", "lo-fi", "lofi", "曲", "編曲",
  ],
  voice: [
    "配音", "旁白", "narration", "voiceover", "tts", "語音", "讀稿",
    "說話", "dubbing", "voice clone", "聲音克隆",
  ],
};

export function detectModality(prompt: string): QualityModality {
  const lower = prompt.toLowerCase();
  // 按優先序：音樂 / 配音先檢查，因為「音樂 + 影片」要落在 music 才不會被
  // video 的「鏡頭」搶走。
  const order: ReadonlyArray<Exclude<QualityModality, "general">> = [
    "voice",
    "music",
    "video",
    "image",
  ];
  for (const m of order) {
    if (MODALITY_HINTS[m].some(kw => lower.includes(kw))) return m;
  }
  return "general";
}

// ─── Dimension keyword catalog ───────────────────────────────────────────

interface DimensionCatalogEntry {
  label: string;
  keywords: ReadonlyArray<string>;
}

/**
 * 每模態 × 7 維度的關鍵字索引。命中規則：substring match（lower-cased）。
 * 關鍵字刻意「過於保守」— 寧可漏，不可錯命中：給使用者錯誤的「你已寫了
 * 風格」會比「你還沒寫風格」更傷信任。
 */
const DIMENSION_CATALOG: Record<
  QualityModality,
  Record<PromptDimension, DimensionCatalogEntry>
> = {
  image: {
    subject: {
      label: "主體",
      keywords: [
        "人", "女性", "男性", "女孩", "男孩", "女人", "男人", "孩子",
        "少女", "少年", "一位", "一隻", "一群", "角色",
        "貓", "狗", "鳥", "兔", "龍", "怪物", "機器人",
        "建築", "城堡", "山", "森林", "海", "城市",
        "花", "樹", "杯子", "車", "船",
        "girl", "boy", "woman", "man", "child", "cat", "dog", "robot",
        "character", "creature", "building", "landscape", "object",
        "portrait", "subject",
      ],
    },
    action: {
      label: "動作/姿態",
      keywords: [
        "坐", "站", "走", "跑", "跳", "躺", "看著", "笑", "哭", "握", "舉起",
        "側臥", "回頭", "凝視", "奔跑", "飛", "墜落",
        "sitting", "standing", "walking", "running", "lying", "looking",
        "smiling", "holding", "flying", "pose", "posing", "gesture",
      ],
    },
    scene: {
      label: "場景",
      keywords: [
        "在", "窗台", "海邊", "山頂", "森林", "教室", "咖啡店", "街道",
        "夜市", "宇宙", "雲端", "雪地", "沙漠", "草原", "屋頂", "巷弄",
        "indoor", "outdoor", "street", "cafe", "forest", "beach", "mountain",
        "rooftop", "studio", "scene", "background", "setting", "in a",
      ],
    },
    lighting: {
      label: "光線",
      keywords: [
        "光", "逆光", "順光", "側光", "頂光", "陰天", "晨光", "夕陽",
        "黃昏", "正午", "霓虹", "燭光", "月光", "聚光", "氛圍光",
        "lighting", "light", "backlit", "rim light", "soft light",
        "golden hour", "sunset", "sunrise", "moonlight", "neon", "candle",
        "studio lighting", "natural light", "rembrandt",
      ],
    },
    style: {
      label: "風格",
      keywords: [
        "寫實", "卡通", "動漫", "水彩", "油畫", "賽博龐克", "蒸氣龐克",
        "極簡", "復古", "膠片", "fanart", "概念", "厚塗", "扁平", "印象",
        "東方", "工筆", "水墨",
        "photorealistic", "anime", "watercolor", "oil painting", "cyberpunk",
        "steampunk", "minimalist", "retro", "film", "concept art",
        "impressionist", "manga", "comic", "vector", "flat", "3d render",
      ],
    },
    camera: {
      label: "鏡頭/構圖",
      keywords: [
        "特寫", "中景", "遠景", "俯視", "仰視", "側面", "正面", "三分法",
        "對稱", "黃金分割", "廣角", "微距", "魚眼", "景深", "焦段",
        "35mm", "50mm", "85mm", "135mm",
        "close-up", "wide shot", "medium shot", "long shot", "top-down",
        "bird's eye", "low angle", "high angle", "rule of thirds",
        "symmetrical", "composition", "depth of field", "bokeh", "macro",
      ],
    },
    quality: {
      label: "質感詞",
      keywords: [
        "4k", "8k", "高清", "細節", "精緻", "電影感", "質感", "膚質",
        "材質", "毛髮", "皺褶", "顆粒", "顆粒感", "粒子",
        "highly detailed", "intricate", "cinematic", "ultra detailed",
        "sharp focus", "masterpiece", "high quality", "texture", "subsurface",
        "skin pores", "fabric detail", "render", "octane",
      ],
    },
  },

  video: {
    subject: {
      label: "主體",
      keywords: [
        "人物", "角色", "產品", "商品", "logo",
        "貓", "狗", "車", "機器人",
        "character", "person", "product", "object", "subject",
      ],
    },
    action: {
      label: "動作/運動",
      keywords: [
        "走", "跑", "跳", "轉身", "旋轉", "推進", "拉遠", "搖", "滑",
        "切鏡", "切點", "節奏",
        "walking", "running", "spinning", "rotating", "moving", "panning",
        "zooming", "dolly", "cut", "rhythm", "tempo",
      ],
    },
    scene: {
      label: "場景",
      keywords: [
        "在", "場景", "背景", "城市", "海邊", "公園", "森林", "辦公室",
        "舞台", "工作室",
        "indoor", "outdoor", "stage", "studio", "scene", "setting", "in a",
        "background", "location",
      ],
    },
    lighting: {
      label: "光線/氛圍",
      keywords: [
        "光", "霓虹", "夕陽", "夜景", "明亮", "陰暗", "暖色", "冷色",
        "藍調", "金調",
        "lighting", "neon", "bright", "dark", "warm", "cool", "tone",
        "mood", "atmosphere", "gloomy", "vibrant",
      ],
    },
    style: {
      label: "風格",
      keywords: [
        "電影感", "紀錄片", "廣告", "mv", "vlog", "蒙太奇",
        "賽博龐克", "復古", "膠片", "動漫", "3d",
        "cinematic", "documentary", "commercial", "vlog", "music video",
        "montage", "cyberpunk", "retro", "anime", "3d", "filmic",
      ],
    },
    camera: {
      label: "鏡頭運動",
      keywords: [
        "推鏡", "拉鏡", "搖鏡", "升降", "穩定器", "手持", "環繞", "跟拍",
        "靜止", "固定鏡頭",
        "dolly in", "dolly out", "pan", "tilt", "crane", "handheld",
        "orbit", "tracking", "static", "fixed camera", "drone", "fpv",
        "first person",
      ],
    },
    quality: {
      label: "長度/比例",
      keywords: [
        "秒", "分鐘", "9:16", "16:9", "1:1", "4:3", "21:9", "直式", "橫式",
        "短影音", "shorts", "reel",
        "second", "seconds", "minute", "duration", "vertical", "horizontal",
        "aspect", "1080p", "4k",
      ],
    },
  },

  music: {
    subject: {
      label: "用途",
      keywords: [
        "bgm", "配樂", "歌曲", "soundtrack", "片頭", "片尾", "廣告",
        "遊戲", "podcast", "tutorial", "trailer", "用途",
      ],
    },
    action: {
      label: "情緒",
      keywords: [
        "療癒", "輕快", "緊張", "悲傷", "激昂", "溫暖", "神祕", "陰暗",
        "夢幻", "希望", "懷舊",
        "calm", "uplifting", "tense", "sad", "epic", "warm", "mysterious",
        "dreamy", "hopeful", "nostalgic", "melancholic", "energetic",
      ],
    },
    scene: {
      label: "風格/類型",
      keywords: [
        "lo-fi", "lofi", "古典", "電子", "搖滾", "民謠", "嘻哈", "爵士",
        "trap", "house", "techno", "ambient", "city pop", "synthwave",
        "鋼琴", "弦樂", "管弦", "電音",
        "classical", "electronic", "rock", "folk", "hip hop", "jazz",
        "pop", "orchestral", "cinematic", "edm",
      ],
    },
    lighting: {
      label: "氛圍",
      keywords: [
        "深夜", "清晨", "雨", "宇宙", "海邊", "城市", "回憶", "靈感",
        "rainy", "midnight", "dawn", "cosmic", "underwater", "city",
        "memory", "introspective",
      ],
    },
    style: {
      label: "段落結構",
      keywords: [
        "前奏", "副歌", "主歌", "橋段", "尾段", "loop", "seamless",
        "intro", "verse", "chorus", "bridge", "outro", "build up", "drop",
        "transition", "无缝", "無縫",
      ],
    },
    camera: {
      label: "BPM/節拍",
      keywords: [
        "bpm", "節拍", "節奏", "拍", "拍子",
        "120bpm", "90bpm", "60bpm", "tempo", "slow tempo", "fast tempo",
      ],
    },
    quality: {
      label: "長度",
      keywords: [
        "秒", "分", "30 秒", "60 秒", "短", "長",
        "seconds", "minute", "duration", "short", "long", "loop",
      ],
    },
  },

  voice: {
    subject: {
      label: "內容/腳本",
      keywords: [
        "稿", "腳本", "台詞", "口白", "旁白", "唸",
        "script", "line", "narration text", "read", "say",
      ],
    },
    action: {
      label: "語氣",
      keywords: [
        "溫暖", "冷靜", "活潑", "嚴肅", "可愛", "性感", "權威", "親切",
        "急促", "悲傷", "興奮",
        "warm", "calm", "lively", "serious", "cute", "authoritative",
        "friendly", "urgent", "sad", "excited", "tone",
      ],
    },
    scene: {
      label: "用途/場景",
      keywords: [
        "podcast", "廣告", "教學", "audiobook", "遊戲", "客服", "ivr",
        "解說", "預告", "公告",
        "commercial", "tutorial", "explainer", "trailer", "announcement",
        "ivr", "audiobook",
      ],
    },
    lighting: {
      label: "性別/年齡",
      keywords: [
        "男聲", "女聲", "中性", "童聲", "老人", "少年", "少女",
        "男生", "女生", "中年",
        "male", "female", "neutral", "child", "young", "old", "teen",
        "adult", "senior",
      ],
    },
    style: {
      label: "語言",
      keywords: [
        "中文", "繁體", "簡體", "英文", "日文", "韓文", "粵語", "台語",
        "西語", "法文", "雙語",
        "chinese", "english", "japanese", "korean", "cantonese",
        "spanish", "french", "bilingual",
      ],
    },
    camera: {
      label: "語速",
      keywords: [
        "快", "慢", "中速", "急促", "從容",
        "fast", "slow", "moderate", "rapid", "leisurely", "pacing",
      ],
    },
    quality: {
      label: "情緒密度",
      keywords: [
        "起伏", "平穩", "情感豐富", "克制",
        "expressive", "monotone", "emotional", "restrained", "dynamic",
      ],
    },
  },

  general: {
    subject: {
      label: "主體/主題",
      keywords: [
        "我要", "做一個", "想做", "create", "make", "build",
        "關於", "about",
      ],
    },
    action: {
      label: "目的",
      keywords: [
        "目的", "目標", "用來", "為了", "purpose", "goal", "for",
      ],
    },
    scene: {
      label: "受眾",
      keywords: [
        "受眾", "目標客群", "粉絲", "讀者", "audience", "target",
        "用戶", "user", "viewer",
      ],
    },
    lighting: {
      label: "平台/載具",
      keywords: [
        "ig", "instagram", "tiktok", "抖音", "youtube", "yt", "fb",
        "facebook", "小紅書", "linkedin", "podcast", "playlist",
        "twitter", "x", "thread",
      ],
    },
    style: {
      label: "風格/語氣",
      keywords: [
        "輕快", "嚴肅", "幽默", "正式", "casual", "professional", "tone",
        "vibe", "風格",
      ],
    },
    camera: {
      label: "長度/規格",
      keywords: [
        "字", "秒", "分鐘", "句", "段", "word", "sentence", "paragraph",
        "duration", "length",
      ],
    },
    quality: {
      label: "結構/CTA",
      keywords: [
        "結尾", "開場", "鉤子", "cta", "call to action", "hook",
        "結構", "outline",
      ],
    },
  },
};

const DIMENSION_ORDER: ReadonlyArray<PromptDimension> = [
  "subject",
  "action",
  "scene",
  "lighting",
  "style",
  "camera",
  "quality",
];

// ─── Dimension parsing ───────────────────────────────────────────────────

export function parseDimensions(
  prompt: string,
  modality: QualityModality = detectModality(prompt),
): DimensionHit[] {
  const lower = prompt.toLowerCase();
  const catalog = DIMENSION_CATALOG[modality];
  return DIMENSION_ORDER.map(dim => {
    const entry = catalog[dim];
    const hit = entry.keywords.find(kw => lower.includes(kw.toLowerCase()));
    return {
      dimension: dim,
      matchedKeyword: hit ?? null,
      label: entry.label,
      present: Boolean(hit),
    };
  });
}

// ─── Scoring ─────────────────────────────────────────────────────────────

/**
 * 主體 / 動作 / 場景 / 風格是核心 4 維度 — 任一缺失對分數影響大；光線 /
 * 鏡頭 / 質感是加分項。權重總和保留 100 分滿分讓 LLM 容易解釋分數。
 */
const DIMENSION_WEIGHTS: Record<PromptDimension, number> = {
  subject: 20,
  action: 15,
  scene: 15,
  lighting: 12,
  style: 18,
  camera: 10,
  quality: 10,
};

const QUALITY_OVERLOAD_THRESHOLD = 5;

function countQualityWords(prompt: string, modality: QualityModality): number {
  const lower = prompt.toLowerCase();
  const catalog = DIMENSION_CATALOG[modality];
  const qualityKws = catalog.quality.keywords;
  let count = 0;
  for (const kw of qualityKws) {
    // 用 split 計次以避免「detail」與「detailed」重複算 — substring match 的
    // 寬鬆換取程式簡單，反正只是用於 overload 判斷。
    if (lower.includes(kw.toLowerCase())) count++;
  }
  return count;
}

export function scorePrompt(
  prompt: string,
  modality: QualityModality = detectModality(prompt),
): PromptDiagnosis {
  const trimmed = prompt.trim();
  const hits = parseDimensions(trimmed, modality);

  // 滿分 100，每缺一個維度扣對應權重；質感詞過載再扣 8。
  let score = 100;
  const missingDimensions: PromptDimension[] = [];
  const presentDimensions: PromptDimension[] = [];
  for (const h of hits) {
    if (!h.present) {
      score -= DIMENSION_WEIGHTS[h.dimension];
      missingDimensions.push(h.dimension);
    } else {
      presentDimensions.push(h.dimension);
    }
  }

  const qualityCount = countQualityWords(trimmed, modality);
  const qualityWordOverload = qualityCount >= QUALITY_OVERLOAD_THRESHOLD;
  if (qualityWordOverload) score -= 8;

  // 太短的 prompt 額外扣分（避免「一隻貓」拿到 30 分卻被當「還可以」）
  if (trimmed.length < 6) score = Math.min(score, 25);
  else if (trimmed.length < 12) score = Math.min(score, 55);

  score = Math.max(0, Math.min(100, Math.round(score)));

  const issues: string[] = [];
  if (missingDimensions.length > 0) {
    const labels = missingDimensions
      .slice(0, 3)
      .map(d => hits.find(h => h.dimension === d)!.label);
    issues.push(`缺少「${labels.join(" / ")}」這幾個維度`);
  }
  if (qualityWordOverload) {
    issues.push(`質感詞塞太多 (${qualityCount} 個)，模型容易抓不到重點`);
  }
  if (trimmed.length < 12 && trimmed.length > 0) {
    issues.push("整段 prompt 太短，模型自由發揮空間太大");
  }

  const hasMixedScript =
    /[一-鿿]/.test(trimmed) && /[A-Za-z]{3,}/.test(trimmed);

  // 給最重要那個缺的維度一句具體建議（用 SUGGESTION_SNIPPETS 抓真實字串）。
  const firstMissing = missingDimensions[0];
  const nextStepSuggestion = firstMissing
    ? buildNextStepSuggestion(modality, firstMissing)
    : qualityWordOverload
    ? "試著刪掉重複的質感詞（例如同時寫 4k / 8k / ultra detailed 只保留一個）"
    : "整體覆蓋面已經很好，可以送出試試了。";

  return {
    modality,
    dimensions: hits,
    score,
    missingDimensions,
    presentDimensions,
    issues,
    nextStepSuggestion,
    stats: {
      length: trimmed.length,
      wordCount: trimmed.split(/\s+/).filter(Boolean).length,
      hasMixedScript,
      qualityWordOverload,
    },
  };
}

// ─── Suggestion snippets ─────────────────────────────────────────────────

/**
 * 每模態 × 維度的「可貼進去」補丁字串。rewritePrompt 缺哪補哪。
 * 不寫死「午後光線, 35mm 淺景深」對所有情境 — 影片 / 音樂 / 配音都有自己
 * 該補的東西。
 */
const SUGGESTION_SNIPPETS: Record<
  QualityModality,
  Record<PromptDimension, string>
> = {
  image: {
    subject: "一位主角（例如：一位年輕女性 / 一隻橘貓）",
    action: "明確的動作或姿態（例如：側臥窗台凝視窗外）",
    scene: "具體場景（例如：午後咖啡店窗邊）",
    lighting: "柔和午後逆光",
    style: "水彩插畫風",
    camera: "35mm 淺景深，三分法構圖",
    quality: "細節清晰，電影感",
  },
  video: {
    subject: "明確主體（例如：產品近景 / 角色全身）",
    action: "動作節奏（例如：1.5 秒一個切點）",
    scene: "場景（例如：霓虹夜街）",
    lighting: "霓虹光感，冷暖對比",
    style: "電影感運鏡",
    camera: "穩定器跟拍，慢推鏡",
    quality: "9:16 / 5 秒，1080p",
  },
  music: {
    subject: "用途（30 秒社群短片 BGM）",
    action: "情緒（療癒、輕快）",
    scene: "風格（lo-fi 鋼琴 + 弦樂）",
    lighting: "氛圍（雨後午後）",
    style: "段落（intro 4 秒 → main → outro 淡出）",
    camera: "90 BPM",
    quality: "30 秒，seamless loop",
  },
  voice: {
    subject: "腳本內容（請唸：「XXX」）",
    action: "語氣（溫暖、親切）",
    scene: "用途（產品 30 秒廣告）",
    lighting: "女聲，25-30 歲",
    style: "繁體中文（台灣腔）",
    camera: "中速、自然停頓",
    quality: "情感有起伏但不過度",
  },
  general: {
    subject: "主題或主角（例如：給新手媽媽的療癒系副品牌）",
    action: "明確目的（例如：建立月訂閱會員）",
    scene: "目標受眾（例如：25-35 歲都市職業女性）",
    lighting: "平台（IG Reels / 小紅書圖文）",
    style: "語氣（溫暖陪伴、不說教）",
    camera: "規格（單篇 200 字內）",
    quality: "收尾的 CTA（例如：留言 +1 領取試用）",
  },
};

function buildNextStepSuggestion(
  modality: QualityModality,
  dim: PromptDimension,
): string {
  const label = DIMENSION_CATALOG[modality][dim].label;
  const snippet = SUGGESTION_SNIPPETS[modality][dim];
  return `先補「${label}」這個維度：例如「${snippet}」。`;
}

// ─── Rewrite ─────────────────────────────────────────────────────────────

export interface RewriteOptions {
  modality?: QualityModality;
  /** 強制只補這些維度（否則補全部缺的） */
  onlyFillDimensions?: ReadonlyArray<PromptDimension>;
  /** 樣式提示（風格主題詞） — 影響 SUGGESTION_SNIPPETS.style 的選擇（保留欄位，目前
   *  只在 explanation 中回顯給使用者，未來可擴展真實樣式分支） */
  style?: string;
}

export function rewritePrompt(prompt: string, opts: RewriteOptions = {}): RewriteResult {
  const trimmed = prompt.trim();
  const modality = opts.modality ?? detectModality(trimmed);
  const diagnosis = scorePrompt(trimmed, modality);

  const targets = opts.onlyFillDimensions
    ? diagnosis.missingDimensions.filter(d => opts.onlyFillDimensions!.includes(d))
    : diagnosis.missingDimensions;

  const additions: Array<{
    dimension: PromptDimension;
    label: string;
    snippet: string;
  }> = [];
  const extras: string[] = [];

  for (const dim of targets) {
    const label = DIMENSION_CATALOG[modality][dim].label;
    const snippet = SUGGESTION_SNIPPETS[modality][dim];
    additions.push({ dimension: dim, label, snippet });
    extras.push(snippet);
  }

  // Rewriter 規則：把使用者原文當第一段（不亂改），補的字串用「，」逗號接尾。
  // 這跟巧巧 system prompt 講的「每次只動 1-2 個維度」一致 — 如果使用者要
  // 全補，傳 onlyFillDimensions 限制。
  const rewritten = extras.length === 0
    ? trimmed
    : trimmed + (trimmed.endsWith("，") || trimmed.endsWith(",") || trimmed.endsWith("。") ? "" : "，") + extras.join("，");

  const filledLabels = additions.map(a => a.label).join(" / ");
  const explanation = additions.length === 0
    ? `這條 prompt 已經涵蓋 7 個維度（${diagnosis.score} 分），可以直接送了。`
    : `補了「${filledLabels}」這幾個維度（原本 ${diagnosis.score} 分）。`;

  return {
    original: trimmed,
    rewritten,
    modality,
    filledDimensions: additions.map(a => a.dimension),
    additions,
    explanation,
  };
}

// ─── Compare ─────────────────────────────────────────────────────────────

export function comparePrompts(
  promptA: string,
  promptB: string,
  modality?: QualityModality,
): CompareResult {
  const m = modality
    ?? (detectModality(promptA + "\n" + promptB));
  const da = scorePrompt(promptA, m);
  const db = scorePrompt(promptB, m);
  const presentA = new Set(da.presentDimensions);
  const presentB = new Set(db.presentDimensions);
  const gained: PromptDimension[] = [];
  const lost: PromptDimension[] = [];
  for (const dim of DIMENSION_ORDER) {
    if (presentB.has(dim) && !presentA.has(dim)) gained.push(dim);
    if (presentA.has(dim) && !presentB.has(dim)) lost.push(dim);
  }
  const winner: CompareResult["winner"] =
    db.score - da.score > 2 ? "B" : da.score - db.score > 2 ? "A" : "tie";

  const summary = (() => {
    if (winner === "tie") return `兩條差不多（A=${da.score} / B=${db.score}）— 看你比較喜歡哪個方向。`;
    const winnerLabel = winner === "A" ? "A" : "B";
    const winnerScore = winner === "A" ? da.score : db.score;
    const loserScore = winner === "A" ? db.score : da.score;
    const diff = winnerScore - loserScore;
    const gainSrc = winner === "B" ? gained : lost;
    const gainLabels = gainSrc
      .slice(0, 2)
      .map(d => DIMENSION_CATALOG[m][d].label);
    if (gainLabels.length === 0) return `${winnerLabel} 比較好（${winnerScore} vs ${loserScore}，差 ${diff} 分）。`;
    return `${winnerLabel} 比較好（${winnerScore} vs ${loserScore}），主要多覆蓋了「${gainLabels.join(" / ")}」。`;
  })();

  return {
    promptA: { text: promptA, diagnosis: da },
    promptB: { text: promptB, diagnosis: db },
    winner,
    gained,
    lost,
    summary,
  };
}

// ─── Templates ───────────────────────────────────────────────────────────

const TEMPLATE_LIBRARY: Record<QualityModality, ReadonlyArray<TemplateSpec>> = {
  image: [
    {
      modality: "image",
      styleHint: "寫實人像",
      template: "[主體]，[動作姿態]，[場景]，[光線]，[鏡頭/構圖]，[風格]，[質感詞]",
      example: "一位 25 歲女性，側臥窗台凝視遠方，午後咖啡店窗邊，柔和逆光，35mm 淺景深，寫實攝影，細節清晰電影感",
    },
    {
      modality: "image",
      styleHint: "東方插畫",
      template: "[主體]，[動作姿態]，[場景]，[氛圍]，工筆水墨風格，[質感詞]",
      example: "一位古裝少女，憑欄遠望，江南雨後園林，朦朧霧氣，工筆水墨風格，細膩線條",
    },
    {
      modality: "image",
      styleHint: "商業海報",
      template: "[產品]，[佈景]，[光線]，[構圖]，極簡商業攝影，乾淨背景",
      example: "一杯熱拿鐵咖啡，木桌上俯視角度，溫暖晨光側光，三分法構圖，極簡商業攝影，乾淨米色背景",
    },
  ],
  video: [
    {
      modality: "video",
      styleHint: "短影音 teaser",
      template: "[主體]，[動作]，[場景]，[鏡頭運動]，[光線]，9:16 / [秒數] 秒，[風格]",
      example: "新品咖啡杯特寫，緩慢旋轉，霓虹夜街櫥窗，穩定器跟拍慢推鏡，霓虹冷暖對比光，9:16 / 7 秒，電影感",
    },
    {
      modality: "video",
      styleHint: "對嘴 / 角色",
      template: "[角色]，[表情]，[場景]，[鏡頭]，[長度]，[風格]",
      example: "動漫少女說話，眨眼微笑，黃昏教室窗邊，固定胸上鏡頭，5 秒，柔和賽璐璐動畫",
    },
  ],
  music: [
    {
      modality: "music",
      styleHint: "療癒系 BGM",
      template: "[用途]，[情緒]，[風格與樂器]，[BPM]，[段落結構]，[長度]，[氛圍]",
      example: "30 秒社群短片 BGM，療癒輕快，lo-fi 鋼琴 + 弦樂，90 BPM，intro 4 秒 → main → outro 淡出，30 秒，雨後午後咖啡店氛圍",
    },
    {
      modality: "music",
      styleHint: "電影預告配樂",
      template: "[用途]，[情緒升降]，[管弦 / 電子]，[BPM 變化]，[段落]，[長度]",
      example: "30 秒預告配樂，從神祕到激昂，管弦樂 + 電子鼓組，從 80 BPM 推到 140 BPM，緩起 → 鋪陳 → drop，30 秒",
    },
  ],
  voice: [
    {
      modality: "voice",
      styleHint: "廣告旁白",
      template: "請唸：「[腳本]」，[語言]，[性別/年齡]，[語氣]，[語速]，[情緒密度]",
      example: '請唸：「在每個忙碌的清晨，給自己一杯溫暖。」，繁體中文（台灣腔），女聲 25-30 歲，溫暖親切，中速自然停頓，情感有起伏但不過度',
    },
    {
      modality: "voice",
      styleHint: "Podcast 開場",
      template: "請唸：「[開場]」，[語言]，[性別]，[語氣]，[語速]",
      example: '請唸：「歡迎來到本週的城市故事。」，繁體中文，中性聲線 30-35 歲，從容沉穩，慢速',
    },
  ],
  general: [
    {
      modality: "general",
      styleHint: "全案需求",
      template: "[主題]，[目的]，[受眾]，[平台]，[語氣]，[規格]，[CTA]",
      example: "新品咖啡上市，提升 IG 認知度，25-35 歲都市職業女性，IG Reels，溫暖陪伴不說教，9:16 7 秒影片 + 200 字貼文，CTA：留言 +1 領試用包",
    },
  ],
};

export function getTemplates(
  modality: QualityModality,
  styleHint?: string,
): ReadonlyArray<TemplateSpec> {
  const all = TEMPLATE_LIBRARY[modality];
  if (!styleHint) return all;
  const hint = styleHint.toLowerCase();
  const filtered = all.filter(t => t.styleHint.toLowerCase().includes(hint));
  return filtered.length > 0 ? filtered : all;
}

// ─── Similarity (struggling detection) ───────────────────────────────────

/**
 * 改良版的 prompt 相似度：用 word n-gram (n=2) 比較。
 *
 * 為什麼不用 client/src/lib/spiritWatchers.ts 的字元 Jaccard：
 *   - 中文 prompt 兩條完全不同需求的字元集合 intersection 動輒 0.5+
 *     （都用了「的」「是」「在」「我」「想」），結果是「永遠誤判為相似」。
 *   - 改用 normalize(去標點 / 轉小寫 / 折空白) + word bigram 後，差不多
 *     主體的兩條才能拿到 ≥0.6。
 *
 * 對純英文 prompt 仍能正確判斷（word bigram 更穩）。
 * 對純中文 prompt fallback 到 char bigram 以避免中文沒空白分詞被當成單一 token。
 */
function ngrams(tokens: ReadonlyArray<string>, n: number): string[] {
  if (tokens.length < n) return tokens.slice();
  const out: string[] = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    out.push(tokens.slice(i, i + n).join(""));
  }
  return out;
}

function tokenize(text: string): { tokens: string[]; usedCharNgram: boolean } {
  const normalized = text
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return { tokens: [], usedCharNgram: false };
  const words = normalized.split(" ").filter(Boolean);
  // 中文 prompt 通常一段 normalized 後仍是一個或兩個長 token（沒分詞）—
  // 我們改用 char bigram 抓「相鄰兩字」相似度，比字元 Jaccard 嚴格得多。
  const hasMostlyCjk = /^[一-鿿\s]+$/.test(normalized);
  if (hasMostlyCjk) {
    const chars = normalized.replace(/\s+/g, "").split("");
    return { tokens: chars, usedCharNgram: true };
  }
  return { tokens: words, usedCharNgram: false };
}

export function jaccardWordSimilarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.tokens.length === 0 || tb.tokens.length === 0) return 0;
  // 兩邊都拿不到 bigram（極短句）→ 退化成 unigram 比較
  const n = ta.tokens.length < 2 || tb.tokens.length < 2 ? 1 : 2;
  const ga = new Set(ngrams(ta.tokens, n));
  const gb = new Set(ngrams(tb.tokens, n));
  let inter = 0;
  for (const t of ga) if (gb.has(t)) inter++;
  const union = ga.size + gb.size - inter;
  return union === 0 ? 0 : inter / union;
}

// ─── Struggling detection (used by client + tests) ───────────────────────

export interface PromptHistoryEntry {
  text: string;
  at: number;
}

export interface StruggleDiagnosis {
  /** 給使用者看的一句話 issue */
  issue: string;
  /** 看了幾條歷史 prompt */
  sampleCount: number;
  /** 真正診斷出來該補的維度 */
  missingDimensions: PromptDimension[];
  /** 模態 */
  modality: QualityModality;
  /** 一條可貼進去的改寫 */
  rewrittenPrompt: string;
  /** 0-100 分（最後一條的分數） */
  lastScore: number;
}

/**
 * 偵測「使用者短時間內反覆送很相似的 prompt」— 上次 detectStrugglingPrompt
 * 的取代版本：
 *   - 用 jaccardWordSimilarity 替代字元 Jaccard（對中文穩 10×）
 *   - 用 scorePrompt + rewritePrompt 給「真的有依據」的建議
 *
 * 觸發條件：
 *   - 60 秒視窗內 ≥3 條 prompt
 *   - 最後 3 條兩兩 word/bigram 相似度 ≥0.55（比舊的 0.6 略放寬，因為新
 *     演算法本身嚴格很多）
 *   - 最後一條分數 ≤70（如果使用者只是同條改錯字、分數很高，不算掙扎）
 */
export function detectStruggle(
  history: ReadonlyArray<PromptHistoryEntry>,
  now: number,
): StruggleDiagnosis | null {
  const WINDOW_MS = 60_000;
  const SIMILARITY_THRESHOLD = 0.55;
  const recent = history.filter(h => now - h.at <= WINDOW_MS);
  if (recent.length < 3) return null;
  const last3 = recent.slice(-3);
  const sim1 = jaccardWordSimilarity(last3[0].text, last3[1].text);
  const sim2 = jaccardWordSimilarity(last3[1].text, last3[2].text);
  if (sim1 < SIMILARITY_THRESHOLD || sim2 < SIMILARITY_THRESHOLD) return null;

  const sample = last3[last3.length - 1].text;
  const modality = detectModality(sample);
  const diag = scorePrompt(sample, modality);
  if (diag.score > 70 && diag.missingDimensions.length === 0) return null;

  const rw = rewritePrompt(sample, { modality });
  const missingLabels = diag.missingDimensions
    .slice(0, 2)
    .map(d => DIMENSION_CATALOG[modality][d].label);
  const issue = missingLabels.length > 0
    ? `你連改了 ${last3.length} 次都很像 — 主要缺「${missingLabels.join(" / ")}」這${missingLabels.length === 1 ? "個" : "兩個"}維度`
    : `你連改了 ${last3.length} 次都很接近 — 可能要換個方向試試`;

  return {
    issue,
    sampleCount: last3.length,
    missingDimensions: diag.missingDimensions,
    modality,
    rewrittenPrompt: rw.rewritten,
    lastScore: diag.score,
  };
}

// ─── 公開常數 ────────────────────────────────────────────────────────────

export const PROMPT_DIMENSIONS = DIMENSION_ORDER;

export function getDimensionLabel(
  dim: PromptDimension,
  modality: QualityModality = "image",
): string {
  return DIMENSION_CATALOG[modality][dim].label;
}
