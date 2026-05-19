/**
 * Worldbuilding Types — 導演 AI 的自訂世界觀架構器（動畫製作級）
 *
 * 結構是強型別 TypeScript schema，但實際儲存在 MySQL 的 JSON 欄位
 * （charactersJson / scenesJson / objectsJson / styleProfilesJson /
 *  musicThemesJson）。
 *
 * 任何欄位調整只需改這支檔案 + 對應的 zod schema，不必再改 SQL
 * migration。動畫腳本分鏡（storyboard）則因量級大、需要單獨 CRUD，
 * 改放在 `world_storyboards` 表，型別見 `shared/worldbuilding-animation.ts`。
 *
 * 為了符合「動畫製作」的條件，本檔提供以下擴充：
 *   - 角色：三視圖、表情包、穿衣集、口氣、語音檔、腳本定位、體型
 *   - 場景：時段鏡頭表、慣用風格鎖
 *   - 風格設定：色票、燈光、鏡頭、後製、參考圖
 *   - 配樂主題：情緒、樂器、節奏、適用場景
 */

import { z } from "zod";

// ─── Draft-tolerant field helpers ───────────────────────────────────────────
// UI 卡片常常先建立空白條目讓使用者編輯，因此必須容忍 label/name/url 暫時為空。
// 嚴格的 z.string().url() 會讓整份 patch 失敗（且原本沒掛 onError，使用者完全看不到錯誤）。
// 以下 helper 允許空字串或合法值，最大長度仍嚴控。
const draftLabel = (max: number) => z.string().max(max);
const draftUrl = (max = 2048) =>
  z.union([z.literal(""), z.string().url().max(max)]);

// ─── Character ──────────────────────────────────────────────────────────────

export type CharacterRole = "protagonist" | "supporting" | "antagonist" | "npc";

export const CHARACTER_ROLE_LABELS: Record<CharacterRole, string> = {
  protagonist: "主角",
  supporting: "配角",
  antagonist: "反派",
  npc: "路人 / NPC",
};

/**
 * 三視圖 —— 角色設計稿（front / side / back / 3-quarter）。
 * 用於：(1) 動畫師 / AI 一致性參考；(2) i2v / image-edit 的姿態錨點；
 *      (3) LoRA 訓練資料集的標準角度資料。
 */
export type CharacterThreeViewSheet = {
  /** 正面立繪 */
  frontImageUrl?: string;
  /** 側面立繪（通常左側） */
  sideImageUrl?: string;
  /** 背面立繪 */
  backImageUrl?: string;
  /** 3/4 視角（常用於片頭定鏡） */
  threeQuarterImageUrl?: string;
  /** 是否已生成 / 已上傳 */
  isComplete?: boolean;
  /** 額外的參考圖（特寫、手部、髮型細節等） */
  referenceImageUrls?: string[];
  /** 上一次生成所用 prompt（重生時可帶入） */
  generationPrompt?: string;
};

/**
 * 角色表情卡 —— 動畫常用的表情包，每個表情可繫結觸發詞 /
 * 強度（0-1）。在分鏡裡會指定某一格用哪個表情。
 */
export type CharacterExpression = {
  id: string;
  /** 表情名稱（如：喜悅、震驚、哭泣……） */
  name: string;
  /** 文字描述（嘴角上揚、眉毛揪起……） */
  description?: string;
  /** 預覽圖 URL */
  imageUrl?: string;
  /** AI 生成時用的關鍵字 */
  promptKeywords?: string[];
  /** 強度 0–1（0=微弱 / 1=極端） */
  intensity?: number;
  /** 在哪些情緒下會自動觸發 */
  triggers?: string[];
};

/**
 * 角色穿衣套裝 —— 多套服裝，每套可標註場合、季節、配色。
 * 動畫分鏡會在 timeline 上指定當前角色穿哪套（換裝銜接動畫）。
 */
export type CharacterOutfit = {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  /** 場合：日常 / 戰鬥 / 正式 / 居家 / 表演 ... */
  occasion?: string;
  /** 季節：春 / 夏 / 秋 / 冬 / 通用 */
  season?: string;
  /** 主要配色 hex 或描述（例如 ["#ffe1a8", "深綠絨布"]） */
  palette?: string[];
  /** 是否為當前預設套裝 */
  isDefault?: boolean;
  /** 對應的 LoRA trigger word（若有專屬服裝 LoRA） */
  triggerWord?: string;
};

/**
 * 角色說話口氣 —— 動畫對白、配音、AI 對話扮演時參考。
 */
export type CharacterSpeechTone = {
  /** 基本語氣：溫柔 / 高傲 / 怯懦 / 慵懶 / 熱血 / 機械 ... */
  baseTone?: string;
  /** 正式度（口語 ↔ 文言） */
  formality?: "casual" | "neutral" | "formal" | "archaic" | "slang";
  /** 語速（slow / normal / fast / varied） */
  pace?: "slow" | "normal" | "fast" | "varied";
  /** 慣性口頭禪（句尾「……呢」「就是說啊」） */
  catchphrases?: string[];
  /** 說話習慣（吞字尾、拉長音、結巴……） */
  mannerisms?: string[];
  /** 自我稱呼 + 對對方稱呼 */
  selfReferent?: string;
  thirdPartyReferent?: string;
  /** 禁用詞（不會說粗話、不會說特定詞……） */
  forbiddenWords?: string[];
};

/**
 * 角色語音檔 —— 給 TTS 系統用，能對應到 ProStudio 的語音模型清單。
 * 配音時直接用此設定。
 */
export type CharacterVoiceProfile = {
  /** 語音引擎：elevenlabs / gemini / fal / minimax / 自訓 */
  engine?: "elevenlabs" | "gemini" | "fal" | "minimax" | "custom";
  /** 引擎內的 voice id / model id */
  voiceId?: string;
  /** 預設語言（ja-JP / zh-TW / en-US ...） */
  languageCode?: string;
  /** 音高調整 -1.0 ~ 1.0 */
  pitch?: number;
  /** 語速 0.5 ~ 2.0 */
  speed?: number;
  /** 預設情緒（neutral / happy / sad / angry / whisper） */
  emotion?: string;
  /** 試聽片段 URL */
  sampleAudioUrl?: string;
  /** 是否使用 voice cloning（提供自訂樣本訓練） */
  useClone?: boolean;
  /** 自訂語音克隆樣本 URL */
  cloneSampleUrls?: string[];
  /** 該角色的 SSML / prompt prefix（情緒導引） */
  promptPrefix?: string;
};

/**
 * 角色在腳本中的定位 —— 動畫敘事結構需要的弧線資料。
 */
export type CharacterScriptRole = {
  /** 故事原型（hero / mentor / shadow / trickster / herald / ally） */
  archetype?: string;
  /** 角色弧線（成長 / 墮落 / 救贖 / 復仇 / 靜態） */
  arcType?: "growth" | "fall" | "redemption" | "revenge" | "flat" | "tragic";
  /** 預設出場位置：主舞台 / 旁白 / 過場 / 客串 / 對手 */
  defaultPosition?: "main_stage" | "narrator" | "transition" | "cameo" | "rival";
  /** 預計戲份占比（0–1） */
  avgScreenTimeRatio?: number;
  /** 與其他角色關係（id → relation） */
  relationships?: Array<{ targetCharacterId: string; relation: string; tension?: number }>;
  /** 招牌台詞 / 主題句 */
  signatureLines?: string[];
  /** 出現的橋段標籤（開場 / 高潮 / 結尾） */
  appearsInBeats?: string[];
};

/** 角色體型（影響三視圖與動畫骨架）。 */
export type CharacterBody = {
  /** cm */
  heightCm?: number;
  /** 體型：嬰 / 童 / 少年 / 青年 / 中年 / 老 */
  ageStage?: string;
  /** 身材：纖細 / 標準 / 壯碩 / 圓潤 / 怪物形態 */
  build?: string;
  /** 種族 / 形態（人類、獸人、機械……） */
  species?: string;
  /** 顯著生理特徵（雙馬尾、機械臂、貓耳……） */
  distinctiveFeatures?: string[];
};

export type WorldCharacter = {
  /** Local UUID-ish id（前端產生即可） */
  id: string;
  name: string;
  role: CharacterRole;
  /** 一句話描述 */
  tagline?: string;
  /** 個性、性格 */
  personality?: string;
  /** 喜好（食物、音樂、活動……） */
  likes?: string[];
  /** 興趣 / 嗜好 */
  interests?: string[];
  /** 預設穿著（舊欄位，向後相容）；新版用 `outfits` 列表 */
  outfit?: string;
  /** 外貌、樣貌（髮型、瞳色、身高、特徵……） */
  appearance?: string;
  /** 隨身物件（武器、寵物、配飾……） */
  signatureItems?: string[];
  /** 背景故事 */
  backstory?: string;
  /** 對應的 LoRA 模型 id（fine_tuned_models.id），可選 */
  linkedModelId?: number | null;
  /** AI 生成時要插入的 trigger word（與 LoRA 對應） */
  triggerWord?: string;
  /** 額外備註 */
  notes?: string;

  // ─── 動畫製作擴充（v2） ──────────────────────────────────────────────────
  /** 三視圖設計稿 */
  threeViewSheet?: CharacterThreeViewSheet;
  /** 表情包（動畫常用） */
  expressions?: CharacterExpression[];
  /** 穿衣集 */
  outfits?: CharacterOutfit[];
  /** 說話口氣（給對白生成 + 配音用） */
  speechTone?: CharacterSpeechTone;
  /** 語音檔（給 TTS / 配音用） */
  voiceProfile?: CharacterVoiceProfile;
  /** 在腳本中的定位（敘事結構） */
  scriptRole?: CharacterScriptRole;
  /** 體型 / 種族 */
  body?: CharacterBody;

  // ─── 動畫製作專業擴充（v3） ─────────────────────────────────────────────
  /** Rig 規格（影響動畫師工作流） */
  rigSpec?: CharacterRigSpec;
  /** 口型音素集（lip sync） */
  lipSyncSet?: CharacterLipSyncSet;
  /** 演技指導筆記（給動畫師、配音員、編劇看的） */
  actingNotes?: CharacterActingNotes;
  /** 年齡 / 階段變體（給回憶、未來等橋段用） */
  ageVariants?: CharacterAgeVariant[];
  /** 聲音檔資料庫（footsteps、呼吸、笑聲樣本） */
  soundProfile?: CharacterSoundProfile;
  /** 姿勢 / 動作參考圖庫（站姿、坐姿、跑、戰鬥、手部、面部特寫） */
  referenceLibrary?: CharacterReferenceItem[];

  // ─── 動畫製作專業擴充 v4：真實參考、上傳資產 ─────────────────────────
  /** 真實參考（歷史人物、原型、聲優、時尚參考、學術資料……） */
  realWorldRefs?: CharacterRealWorldRef[];
  /** 上傳到資產庫的素材清單（reference photos、聲音樣本、文件 PDF） */
  uploadedAssets?: WorldAssetRef[];
};

// ─── 角色：動畫製作專業欄位 v3 ─────────────────────────────────────────────

/** Rig 規格 —— 影響動畫師工作流，並驅動 prompt 是否啟用 control net / openpose。 */
export type CharacterRigSpec = {
  /** Rig 類型：2D 切片（Spine / Live2D）、3D（Maya / Blender）、Stop-Motion、純 AI（無 rig） */
  rigType?: "live2d" | "spine_2d" | "rigged_3d" | "stop_motion" | "ai_only";
  /** 骨骼數（若 rigged） */
  boneCount?: number;
  /** IK 鏈：手部、腳部、頭部、尾巴…… */
  ikChains?: string[];
  /** Blend shape / morph target 數量（臉部表情用） */
  blendShapeCount?: number;
  /** 是否含布料模擬 */
  hasClothSim?: boolean;
  /** 是否含頭髮物理 */
  hasHairPhysics?: boolean;
  /** 是否含眼球追蹤 */
  hasEyeTracking?: boolean;
  /** Rig 製作者 / 工作室 */
  rigger?: string;
  /** Rig 檔案存放位置（asset library 連結） */
  rigAssetUrl?: string;
  /** 動畫師備註（這 rig 已知的限制 / 注意事項） */
  riggerNotes?: string;
};

/** 口型音素集 —— 對 lip sync 工具（如 Rhubarb、Papagayo）的 mouth shape 對映表。 */
export type CharacterLipSyncSet = {
  /** 使用的音素系統：Preston Blair 9 mouth shapes 是動畫標準 */
  system?: "preston_blair" | "rhubarb" | "ipa" | "custom";
  /** 每個音素對應的嘴型預覽圖：A / E / I / O / U / M / F / L / Rest */
  shapes?: Record<string, string>;
  /** 啟用 lip sync 動畫 */
  enabled?: boolean;
  /** 語言主導（zh/ja/en），影響音素辨識器 */
  primaryLanguage?: string;
};

/** 演技指導 —— 給動畫師、配音員、編劇對齊角色表演用。 */
export type CharacterActingNotes = {
  /** 情緒範圍（不會超出這些情緒） */
  emotionalRange?: string[];
  /** 招牌動作 / 慣性手勢 */
  signatureGestures?: string[];
  /** 走路方式：穩重、輕盈、跛行、漂浮、機械步 */
  walkCycleStyle?: string;
  /** 站姿：駝背、挺直、放鬆、警戒 */
  defaultPosture?: string;
  /** 視線習慣：閃躲、直視、低頭 */
  gazePattern?: string;
  /** 思考時的習慣（摸下巴、咬唇、轉筆） */
  thinkingTics?: string[];
  /** 緊張時的習慣 */
  stressTics?: string[];
  /** 鏡頭友善度：總是面對鏡頭 / 偏 3/4 / 偏側面 */
  cameraPreference?: "front" | "three_quarter" | "side" | "varied";
  /** 動畫原則參考（squash/stretch 強度 0–1） */
  squashStretch?: number;
  /** 配音指導：感情變化幅度、靜場喘息頻率、笑點處理 */
  vodirection?: string;
};

/** 年齡變體 —— 同一角色在不同年齡段的視覺（回憶、未來、平行宇宙）。 */
export type CharacterAgeVariant = {
  id: string;
  /** 變體名稱（童年、少年、青年、晚年） */
  name: string;
  /** 對應年齡 */
  approxAge?: string;
  /** 三視圖 + 參考圖 */
  imageUrls?: string[];
  /** 描述差異（髮型、身高、特徵） */
  description?: string;
  /** 對應 LoRA（若有專屬模型） */
  linkedModelId?: number | null;
  triggerWord?: string;
};

/** 聲音檔資料庫 —— 角色非語音的聲音（footsteps、breath、laugh、grunt）。 */
export type CharacterSoundProfile = {
  /** 腳步聲樣本：地面材質 → 音檔 URL */
  footsteps?: Record<string, string>;
  /** 呼吸聲樣本 */
  breathSample?: string;
  /** 笑聲樣本 */
  laughSample?: string;
  /** 哭聲樣本 */
  crySample?: string;
  /** 怒吼 / 咆哮 */
  shoutSample?: string;
  /** 受傷 / 痛 */
  hurtSample?: string;
  /** 嘆息 */
  sighSample?: string;
  /** 自訂其他樣本 */
  customSamples?: Array<{ label: string; url: string }>;
};

/** 參考圖庫項目 —— 帶 tag 的姿勢、表情、手部、特寫圖。 */
export type CharacterReferenceItem = {
  id: string;
  imageUrl: string;
  /** 類別：pose / hands / face / dynamic / interaction / props */
  category?: string;
  /** 自由標籤 */
  tags?: string[];
  /** 描述 */
  description?: string;
};

// ─── v4：真實參考 + 上傳資產 + 研究資料庫 + 音效庫 ──────────────────────────

/**
 * 角色真實參考 —— 歷史人物、原型、聲優、時尚參考、學術資料。
 * 給編劇 / 美術 / 配音導向使用，AI 代理可查詢此庫做交叉引用。
 */
export type CharacterRealWorldRef = {
  id: string;
  /** 顯示用標籤 */
  label: string;
  /** 類型：歷史人物 / 原型 / 聲優 / 時尚 / 名人 / 文學 / 運動員 / 其他 */
  refType?:
    | "historical_figure"
    | "archetype"
    | "voice_actor"
    | "fashion"
    | "athlete"
    | "celebrity"
    | "literature"
    | "other";
  /** 真實人物姓名 */
  personName?: string;
  /** 外部連結（Wikipedia、IMDB、社群） */
  externalUrl?: string;
  /** 參考圖 URL */
  imageUrls?: string[];
  /** 描述、與此角色的對應點 */
  description?: string;
  /** 學術引用格式：作者, 年, 來源 */
  citation?: string;
};

/**
 * 場景真實參考 —— 真實地點、地圖位置、建築、博物館館藏、檔案照片。
 * 給美術指導 / 製作管理 / AI 代理查詢使用。
 */
export type SceneRealWorldRef = {
  id: string;
  label: string;
  /** 類型：location 地點 / building 建築 / landmark 地標 / museum 博物館 /
   *   photo 檔案照片 / video 紀錄片 / wikipedia 百科 / archive 檔案 /
   *   academic 學術文獻 / other */
  refType?:
    | "location"
    | "building"
    | "landmark"
    | "museum_collection"
    | "photo"
    | "video"
    | "wikipedia"
    | "archive"
    | "academic"
    | "other";
  /** GPS 座標（lat, lon） */
  gpsCoords?: { lat: number; lon: number };
  /** 地圖預覽圖 URL */
  mapImageUrl?: string;
  /** 外部連結 */
  externalUrl?: string;
  /** 參考圖 URL */
  imageUrls?: string[];
  /** 描述 */
  description?: string;
  /** 引用格式 */
  citation?: string;
  /** 參考年份（古蹟、檔案資料） */
  yearOfReference?: string;
};

/** 通用：上傳到資產庫的素材引用 */
export type WorldAssetRef = {
  id: string;
  /** 顯示名稱（檔名或自訂） */
  label: string;
  /** 資產類型：image / audio / video / pdf / document / other */
  assetType?: "image" | "audio" | "video" | "pdf" | "document" | "other";
  /** 從 uploadFileToS3 拿到的 URL（CDN / S3） */
  url: string;
  /** 從 uploadFileToS3 拿到的 fileKey（給刪除用） */
  fileKey?: string;
  /** MIME type */
  mimeType?: string;
  /** 大小（位元組） */
  sizeBytes?: number;
  /** 用途 tag：reference / training / output / archive */
  purpose?: string;
  /** 描述 */
  description?: string;
  /** 上傳時間（ISO） */
  uploadedAt?: string;
};

/**
 * 世界研究資料庫條目 —— 寫世界設定的詳細研究筆記。
 * 適用：歷史、地理、文化、生物、技術、政治、宗教、語言、經濟。
 * AI 代理可查詢此庫獲取世界深度設定。
 */
export type WorldResearchEntry = {
  id: string;
  title: string;
  /** 分類：history / geography / culture / biology / technology /
   *      politics / religion / language / economy / other */
  category?: string;
  /** 主要內容（markdown 支援） */
  content?: string;
  /** 來源連結 */
  sourceUrls?: string[];
  /** 附件（PDF / 圖 / 影音） */
  attachments?: WorldAssetRef[];
  /** 引用格式 */
  citation?: string;
  /** 自由標籤 */
  tags?: string[];
  /** 是否標記為核心設定（AI 注入 prompt 時優先） */
  isCanon?: boolean;
};

/**
 * 世界音效 / 環境音庫 —— 全世界共用的音效資源池。
 * 場景的 soundDesign 可以引用這裡的 id，避免重複上傳。
 */
export type WorldSoundLibraryItem = {
  id: string;
  label: string;
  /** 分類：ambient 環境音 / sfx 音效 / ui 界面音 / music_stinger 音樂節拍 /
   *      footsteps 腳步 / voice_clip 語音片段 / weather 天氣 / nature 自然 */
  category?:
    | "ambient"
    | "sfx"
    | "ui"
    | "music_stinger"
    | "footsteps"
    | "voice_clip"
    | "weather"
    | "nature"
    | "other";
  /** 音檔 URL（CDN / S3 / 外部） */
  audioUrl: string;
  fileKey?: string;
  /** 時長（秒） */
  durationSec?: number;
  /** 自由標籤（雨、戰鬥、勝利、夜晚……） */
  tags?: string[];
  /** 描述 */
  description?: string;
  /** 觸發條件：什麼情境下適用 */
  triggers?: string[];
  /** 是否可無縫循環 */
  loopable?: boolean;
  /** 預設音量 0–1 */
  volumeDefault?: number;
  /** 來源（自製 / Freesound / 商業庫） */
  source?: string;
  /** 授權（CC0 / CC-BY / 自有版權 / 商業授權） */
  license?: string;
};

// ─── Scene ──────────────────────────────────────────────────────────────────

/** 場景時段表 —— 同一場景在不同時間的視覺狀態。 */
export type SceneTimeOfDay = {
  /** 時段標籤：黎明 / 早晨 / 正午 / 黃昏 / 入夜 / 深夜 / 不限 */
  label: string;
  /** 對應的光線描述 */
  lighting?: string;
  /** 對應的色票 */
  palette?: string[];
  /** 預覽圖 */
  imageUrl?: string;
};

export type WorldScene = {
  id: string;
  name: string;
  /** 一句話氛圍描述 */
  tagline?: string;
  /** 環境描述（地點、季節、天氣） */
  environment?: string;
  /** 植被（花草樹木） */
  flora?: string[];
  /** 動物 / 生物 */
  fauna?: string[];
  /** 場景內物件（家具、道具、招牌……） */
  props?: string[];
  /** 光線 / 配色 */
  lighting?: string;
  /** 氛圍 / 情緒 */
  mood?: string;
  /** 環境變化（晝夜、季節、突發事件……） */
  environmentChanges?: string[];
  /** 對應的場景 LoRA 模型 id */
  linkedModelId?: number | null;
  triggerWord?: string;
  notes?: string;

  // ─── 動畫製作擴充（v2） ──────────────────────────────────────────────────
  /** 場景概念圖 / establishing shot URL */
  establishingShotUrl?: string;
  /** 時段表（黎明 / 黃昏 / 夜晚……） */
  timeOfDay?: SceneTimeOfDay[];
  /** 鎖定的畫面風格 profile id（連結到 framework.styleProfiles） */
  styleProfileId?: string | null;
  /** 鎖定的配樂主題 id（連結到 framework.musicThemes） */
  musicThemeId?: string | null;
  /** 預設鏡頭運動 / 機位（靜態 / 推軌 / 跟拍 / 升降……） */
  defaultCameraMovement?: string;
  /** 預設長寬比（場景偏好的構圖比例） */
  preferredAspectRatio?: string;

  // ─── 動畫製作專業擴充（v3） ─────────────────────────────────────────────
  /** Layout（平面圖、blocking、進出點） */
  layout?: SceneLayoutSpec;
  /** Production design（年代、建築風格、建材） */
  productionDesign?: SceneProductionDesign;
  /** 大氣 / 粒子效果（霧、塵、光柱） */
  atmospherics?: SceneAtmospherics;
  /** Sound design（環境音床、room tone、reverb、signature sfx） */
  soundDesign?: SceneSoundDesign;

  // ─── v4：真實參考 + 上傳資產 ─────────────────────────────────────────
  /** 真實世界參考（地圖位置、地標、博物館館藏、檔案照片） */
  realWorldRefs?: SceneRealWorldRef[];
  /** 上傳到資產庫的素材 */
  uploadedAssets?: WorldAssetRef[];
  /** 此場景引用的全世界音效庫項目 id 陣列 */
  soundLibraryRefs?: string[];
};

/** 場景 Layout / Blocking —— 動畫師用來規劃角色站位與鏡頭走位。 */
export type SceneLayoutSpec = {
  /** 平面圖 URL（鳥瞰） */
  floorPlanUrl?: string;
  /** Blocking 示意圖（角色站位） */
  blockingDiagramUrl?: string;
  /** 角色進場點（描述：左側門、後方樓梯） */
  entryPoints?: string[];
  /** 角色出場點 */
  exitPoints?: string[];
  /** Hero shot 角度（這場最具代表性的鏡頭） */
  heroShotAngle?: string;
  /** Coverage shots：建議的補充鏡頭角度 */
  coverageAngles?: string[];
  /** 場地尺度（公尺） */
  approxDimensions?: { widthM?: number; depthM?: number; heightM?: number };
};

/** Production Design —— 美術指導關注的設計層面。 */
export type SceneProductionDesign = {
  /** 建築 / 環境風格：哥德、和風、未來主義、巴洛克…… */
  architecturalStyle?: string;
  /** 主要建材：木、石、金屬、玻璃、布料 */
  materials?: string[];
  /** 年代細節（與 world era 平行；場景內也可有古蹟、新建築混雜） */
  periodDetails?: string;
  /** Set pieces（互動道具：可坐、可開啟、可破壞） */
  setPieces?: string[];
  /** Color script：keyColor / midColor / shadowColor */
  colorScript?: {
    keyColor?: string;
    midColor?: string;
    shadowColor?: string;
  };
  /** 參考圖（concept art / 實景照） */
  referenceUrls?: string[];
};

/** Atmospherics —— 大氣、粒子、光線效果（影響合成與後製）。 */
export type SceneAtmospherics = {
  /** 霧密度 0–1 */
  fogDensity?: number;
  /** 灰塵粒子（dust motes） */
  dustMotes?: boolean;
  /** 光柱（god rays） */
  lightShafts?: boolean;
  /** 雨 / 雪粒子 */
  precipitation?: "none" | "rain" | "snow" | "ash" | "petals" | "leaves";
  /** 雷電 */
  lightning?: boolean;
  /** 自訂粒子效果 */
  customParticles?: string[];
};

/** Sound Design —— 場景的聲音設計（給音效師、合成師看的）。 */
export type SceneSoundDesign = {
  /** 環境音床（ambient bed） URL */
  ambientBedUrl?: string;
  /** Room tone（靜場底噪） URL */
  roomToneUrl?: string;
  /** Reverb 特性：dry / room / hall / cathedral / outdoor */
  reverb?: "dry" | "room" | "hall" | "cathedral" | "outdoor" | "underwater";
  /** 招牌音效（觀眾聽到就知道是這個場景） */
  signatureSfx?: Array<{ label: string; url?: string; description?: string }>;
  /** 是否有具方向性的音源（如門外的腳步、遠處的鐘聲） */
  diegeticSources?: string[];
};

// ─── 畫面風格設定（World Style Profile） ────────────────────────────────────
//   為動畫定義一致的視覺語言：色票、燈光、鏡頭、後製、參考圖、繪風。
//   一個世界可有多個 profile（例：日常風 / 戰鬥風 / 夢境風），分鏡裡每場
//   指定要用哪個 profile。

export type WorldStyleProfile = {
  id: string;
  name: string;
  /** 繪風：日系賽璐璐 / 厚塗 / 水彩 / 像素 / 3D 卡通 / 寫實 / 漫畫線稿 / 紙偶 */
  artStyle?: string;
  /** 色票（hex 陣列或描述） */
  palette?: string[];
  /** 燈光設定（高調 / 低調 / 倫勃朗 / 邊緣光 / 體積光） */
  lighting?: string;
  /** 鏡頭規格（焦距、景深、寬高比、構圖偏好） */
  lensSpec?: {
    focalLengthMm?: number;
    aperture?: string;
    aspectRatio?: string;
    depthOfField?: "shallow" | "deep" | "rack";
  };
  /** 後製設定（顆粒、色調、漏光、暈影、邊緣銳化） */
  postProcessing?: string[];
  /** 影格率 / 幀數風格 */
  fps?: number;
  /** 參考圖 URL（concept art / colorscript） */
  referenceImageUrls?: string[];
  /** AI 生成時要注入的 trigger word / negative prompt */
  triggerWord?: string;
  negativePrompt?: string;
  /** 繫結的 LoRA 模型（風格 LoRA） */
  linkedModelId?: number | null;
  /** 簡述（給 LLM 看） */
  description?: string;

  // ─── 動畫製作專業擴充（v3） ─────────────────────────────────────────────
  /** Animation principles —— 拍幾格制 */
  shootOn?: 1 | 2 | 3 | 4;
  /** 流派參考：Disney 12 / Anime sakuga / Studio Ghibli / Kyoto Animation / Cartoon Saloon */
  schoolReference?: string;
  /** 線條：lineWeight (px 等效)、是否有外框、線條顏色 */
  lineSpec?: {
    weight?: number;
    hasOutline?: boolean;
    outlineColor?: string;
    lineColor?: string;
    lineStyle?: "clean" | "sketchy" | "boil" | "varied";
  };
  /** 著色模型：cel / painted / flat / gradient / 3d_toon */
  shadingModel?: "cel" | "painted" | "flat" | "gradient" | "3d_toon" | "watercolor";
  /** 合成 pass：DoF / lens flare / chromatic aberration / film grain / vignette / bloom */
  compositingPasses?: string[];
  /** 色彩空間：sRGB / Rec.709 / DCI-P3 / Rec.2020 */
  colorSpace?: "sRGB" | "Rec709" | "DCI_P3" | "Rec2020" | "ACES";
  /** Master 解析度 */
  masterResolution?: "720p" | "1080p" | "1440p" | "4K" | "8K";
  /** 容器格式 */
  masterCodec?: "ProRes" | "DNxHR" | "H264" | "H265" | "VP9" | "AV1";
  /** Letterboxing / pillarboxing 規則 */
  letterboxing?: string;
  /** 字幕字型 / 大小 */
  subtitleSpec?: {
    font?: string;
    sizePt?: number;
    color?: string;
    outlineColor?: string;
  };
  /** Title card 風格 */
  titleCardStyle?: string;
};

// ─── 配樂主題（World Music Theme） ──────────────────────────────────────────
//   一個世界可定義多個音樂主題（主角主題 / 戰鬥主題 / 反派主題 / 結尾主題），
//   分鏡每場可繫結一個主題，動畫渲染時自動套用配樂提示詞。

export type WorldMusicTheme = {
  id: string;
  name: string;
  /** 情緒：希望 / 哀傷 / 緊張 / 神祕 / 溫馨 / 史詩 / 詭異 */
  mood?: string;
  /** 樂器：管弦樂 / 鋼琴 / 電子 / 民族 / 合唱 / lofi ... */
  instruments?: string[];
  /** 節奏 BPM */
  bpm?: number;
  /** 拍號 4/4, 3/4, 6/8 ... */
  timeSignature?: string;
  /** 調性：大調 / 小調 / 五聲 / atonal */
  key?: string;
  /** 適用場景 id 陣列 */
  applicableSceneIds?: string[];
  /** 適用角色 id 陣列（角色主題） */
  applicableCharacterIds?: string[];
  /** 生成提示詞（給 ProStudio 音樂生成用） */
  promptKeywords?: string[];
  /** 試聽音檔 URL */
  sampleAudioUrl?: string;
  /** 簡述 */
  description?: string;

  // ─── 動畫製作專業擴充（v3） ─────────────────────────────────────────────
  /** Leitmotif（主題動機）—— 文字描述主要旋律動機，或 MIDI/musicXML 連結 */
  leitmotif?: {
    description?: string;
    melodicPhrase?: string;
    midiUrl?: string;
  };
  /** Cue 長度變體 —— 給剪輯師快速套用對應長度 */
  cueVariants?: Array<{
    label: string;
    durationSec: number;
    audioUrl?: string;
    loopable?: boolean;
  }>;
  /** Stems（分軌） —— 給混音 / 動態變化用 */
  stems?: {
    drums?: string;
    bass?: string;
    melody?: string;
    harmony?: string;
    pads?: string;
    fx?: string;
  };
  /** LUFS 響度目標（廣播 -23、串流 -14、電影 -27） */
  lufsTarget?: number;
  /** 與其他 cue 的轉接：crossfade / hard cut / sting / morphing */
  transitionStyle?: "crossfade" | "hard_cut" | "sting" | "morphing";
  /** 自訂 stinger / hit point（節奏命中點，給剪輯對齊用） */
  stingerPoints?: number[];
};

// ─── World Object（全域物件，可被多個場景引用） ─────────────────────────────

export type WorldObject = {
  id: string;
  name: string;
  /** 類型（道具、武器、植物、生物、車輛、建築……） */
  category?: string;
  description?: string;
  /** 視覺特徵 */
  visualTraits?: string;
  /** 連結到場景 id 陣列 */
  appearsInScenes?: string[];
  notes?: string;
};

// ─── Framework（整個世界） ──────────────────────────────────────────────────

export type WorldbuildingFrameworkData = {
  id?: number;
  name: string;
  description?: string;
  genre?: string;
  /** 時代背景：古代 / 中世紀 / 近代 / 現代 / 未來 / 架空 … */
  era?: string;
  characters: WorldCharacter[];
  scenes: WorldScene[];
  objects?: WorldObject[];
  linkedModelIds?: number[];
  tags?: string[];
  isActive?: boolean;

  // ─── 動畫製作擴充（v2） ──────────────────────────────────────────────────
  /** 畫面風格設定列表（多個風格可共存於同一世界） */
  styleProfiles?: WorldStyleProfile[];
  /** 配樂主題列表 */
  musicThemes?: WorldMusicTheme[];
  /** 預設使用的風格 profile id */
  defaultStyleProfileId?: string | null;
  /** 全世界共用的負面提示詞（套用於所有 AI 生成） */
  globalNegativePrompt?: string;

  // ─── v4：研究資料庫 + 音效庫 + 全世界上傳資產 ─────────────────────────
  /** 世界研究資料庫（歷史、地理、文化、生物、技術、政治、宗教、語言、經濟） */
  researchEntries?: WorldResearchEntry[];
  /** 世界共用的音效 / 環境音庫 */
  soundLibrary?: WorldSoundLibraryItem[];
  /** 世界共用的上傳資產（給角色 / 場景參考用） */
  uploadedAssets?: WorldAssetRef[];
  /** 製作目標：動畫類型 / 預期長度 / 受眾 / 製作管線 */
  productionTargets?: {
    /** 動畫類型：短片 / 番劇 / MV / 廣告 / 教學 / 純插畫集 */
    format?: string;
    /** 目標時長（秒） */
    targetDurationSec?: number;
    /** 受眾：兒童 / 全年齡 / 青少年 / 成人 */
    audience?: string;
    /** 平台：YouTube / TikTok / 影展 / 內部 */
    platform?: string;
    /** 製作階段 milestones（development → pre-prod → production → post-prod → delivery） */
    milestones?: ProductionMilestone[];
    /** 製作預算（USD） */
    budgetUsd?: number;
    /** 主要工作人員 / 製作團隊 credits */
    credits?: ProductionCredit[];
    /** Master 規格：解析度、影格率、色彩空間（補 styleProfile 不夠的） */
    masterSpec?: {
      resolution?: string;
      fps?: number;
      colorSpace?: string;
      hdr?: boolean;
      audioChannels?: "mono" | "stereo" | "5.1" | "7.1" | "atmos";
      audioBitrate?: string;
    };
    /** 交付清單（master + proxy + thumbnail + 預告等） */
    deliverables?: string[];
    /** 內容警告 / 分級：G / PG / PG-13 / R */
    rating?: string;
    /** 字幕語言清單 */
    subtitleLanguages?: string[];
    /** 配音語言清單 */
    dubLanguages?: string[];
  };
};

/** 製作里程碑（給 production manifest 用） */
export type ProductionMilestone = {
  id: string;
  /** 階段：development / pre-production / production / post-production / delivery */
  stage: string;
  /** 任務描述 */
  title: string;
  /** 預定完成日（ISO date） */
  dueDate?: string;
  /** 完成狀態 */
  status?: "pending" | "in_progress" | "completed" | "blocked";
  /** 負責人 */
  owner?: string;
  /** 備註 */
  notes?: string;
};

/** 製作 credits（給片尾工作人員字幕用） */
export type ProductionCredit = {
  id: string;
  /** 角色 / 職稱：導演、編劇、作畫監督、配音、配樂…… */
  role: string;
  /** 姓名 */
  name: string;
  /** 連結（IMDB、社群） */
  link?: string;
};

// ─── Quick-pick presets（前端快選 chip 用） ─────────────────────────────────

export const GENRE_PRESETS = [
  "療癒",
  "奇幻",
  "科幻",
  "賽博龐克",
  "蒸汽朋克",
  "武俠",
  "仙俠",
  "日常",
  "校園",
  "懸疑",
  "推理",
  "戀愛",
  "恐怖",
  "冒險",
  "歷史",
  "戰爭",
  "黑色幽默",
] as const;

export const ERA_PRESETS = [
  "史前",
  "古代",
  "中世紀",
  "近代",
  "民國",
  "現代",
  "近未來",
  "遠未來",
  "後末日",
  "蒸汽時代",
  "架空",
  "平行世界",
] as const;

export const PERSONALITY_TRAIT_PRESETS = [
  "溫柔",
  "果斷",
  "害羞",
  "傲嬌",
  "神秘",
  "開朗",
  "冷酷",
  "體貼",
  "調皮",
  "嚴肅",
  "天真",
  "腹黑",
  "理性",
  "感性",
  "正義感強",
  "懶散",
  "好奇",
  "完美主義",
  "悲觀",
  "樂觀",
] as const;

export const SCENE_MOOD_PRESETS = [
  "靜謐",
  "緊張",
  "神秘",
  "溫馨",
  "悲傷",
  "歡樂",
  "壓抑",
  "奇幻",
  "詭異",
  "莊嚴",
  "夢幻",
  "孤寂",
  "希望",
  "懷舊",
  "刺激",
] as const;

export const SCENE_LIGHTING_PRESETS = [
  "晨光",
  "正午烈日",
  "夕陽",
  "黃昏",
  "夜晚",
  "月光",
  "霓虹",
  "燭光",
  "陰天",
  "雷雨",
  "雪光",
  "火光",
  "螢光",
  "晨霧",
  "聚光燈",
] as const;

export const ENVIRONMENT_CHANGE_PRESETS = [
  "黃昏起霧",
  "夜晚螢火蟲飛舞",
  "下雨",
  "下雪",
  "雷暴",
  "日蝕",
  "極光",
  "落葉",
  "花開",
  "潮汐漲落",
  "突發地震",
  "戰火蔓延",
] as const;

// ─── 動畫製作擴充用 presets ──────────────────────────────────────────────────

export const EXPRESSION_PRESETS = [
  "微笑",
  "大笑",
  "苦笑",
  "賊笑",
  "壞笑",
  "哭泣",
  "啜泣",
  "震驚",
  "錯愕",
  "生氣",
  "暴怒",
  "羞澀",
  "臉紅",
  "困惑",
  "傲嬌",
  "嚴肅",
  "冷漠",
  "心動",
  "崩潰",
  "白眼",
  "閉眼",
  "瞇眼",
  "張嘴大喊",
  "嘟嘴",
  "陶醉",
  "驚恐",
  "陰沉",
] as const;

export const OUTFIT_OCCASION_PRESETS = [
  "日常",
  "校服",
  "戰鬥",
  "正裝",
  "禮服",
  "睡衣",
  "居家",
  "運動",
  "泳裝",
  "巫術袍",
  "盔甲",
  "機甲",
  "祭典",
  "雨天",
  "雪天",
  "表演",
  "潛行",
  "工裝",
  "婚紗",
] as const;

export const VOICE_TONE_BASE_PRESETS = [
  "溫柔",
  "甜美",
  "知性",
  "高傲",
  "傲嬌",
  "病嬌",
  "中性",
  "沙啞",
  "童音",
  "御姊",
  "蘿莉",
  "正太",
  "少年",
  "青年",
  "中年",
  "老成",
  "機械",
  "夢幻",
  "嬌喘",
  "魔性",
  "權威",
  "悲傷",
  "活潑",
] as const;

export const VOICE_ENGINE_PRESETS = [
  { value: "elevenlabs", label: "ElevenLabs（情緒最自然）" },
  { value: "gemini", label: "Gemini TTS（多語言）" },
  { value: "fal", label: "FAL（CosyVoice / F5）" },
  { value: "minimax", label: "MiniMax（中文情緒）" },
  { value: "custom", label: "自訂 / 自訓語音" },
] as const;

export const ART_STYLE_PRESETS = [
  "日系賽璐璐",
  "厚塗插畫",
  "水彩",
  "水墨",
  "鉛筆素描",
  "漫畫線稿",
  "彩色漫畫",
  "像素藝術",
  "3D 卡通渲染",
  "寫實 CG",
  "紙偶定格",
  "黏土動畫",
  "皮影戲",
  "新海誠寫實光影",
  "吉卜力溫潤",
  "京阿尼明亮",
  "賽博龐克霓虹",
  "蒸氣朋克銅黃",
  "暗黑哥德",
  "兒童繪本扁平",
  "vaporwave",
  "lofi 復古",
] as const;

export const MUSIC_INSTRUMENT_PRESETS = [
  "管弦樂團",
  "獨奏鋼琴",
  "電子合成器",
  "弦樂四重奏",
  "民族樂器",
  "古箏",
  "尺八",
  "口琴",
  "吉他",
  "貝斯",
  "鼓組",
  "童聲合唱",
  "聖歌合唱",
  "lofi 節拍",
  "管風琴",
  "電吉他",
  "弦樂",
  "風笛",
  "Music Box 八音盒",
] as const;

export const MUSIC_MOOD_PRESETS = [
  "希望",
  "哀傷",
  "緊張",
  "驚悚",
  "神祕",
  "溫馨",
  "甜蜜",
  "史詩",
  "壯烈",
  "詭異",
  "夢幻",
  "輕快",
  "悠遠",
  "孤寂",
  "勝利",
  "失敗",
  "燃魂",
  "懸念",
] as const;

export const CAMERA_MOVEMENT_PRESETS = [
  "靜態鏡頭",
  "推軌（Dolly In）",
  "拉遠（Dolly Out）",
  "橫搖（Pan）",
  "垂直搖（Tilt）",
  "升降（Crane）",
  "跟拍（Tracking）",
  "環繞（Orbit）",
  "手持晃動",
  "Zoom In",
  "Zoom Out",
  "POV 主觀視角",
  "鳥瞰",
  "蟲視",
  "Dutch Angle 斜角",
] as const;

export const TRANSITION_PRESETS = [
  "直切（Cut）",
  "淡入淡出（Fade）",
  "交叉溶解（Dissolve）",
  "白閃",
  "黑閃",
  "Match Cut 動作銜接",
  "推鏡轉場",
  "划像（Wipe）",
  "蒙太奇拼接",
  "場景內接景（Whip Pan）",
] as const;

export const CHARACTER_ARCHETYPE_PRESETS = [
  "英雄（Hero）",
  "導師（Mentor）",
  "陰影（Shadow）",
  "守門人（Threshold Guardian）",
  "信使（Herald）",
  "盟友（Ally）",
  "搗蛋者（Trickster）",
  "變形者（Shapeshifter）",
] as const;

export const SCENE_TIME_OF_DAY_PRESETS = [
  "黎明",
  "清晨",
  "上午",
  "正午",
  "下午",
  "黃昏",
  "入夜",
  "深夜",
  "凌晨",
] as const;

export const PRODUCTION_FORMAT_PRESETS = [
  "短片動畫",
  "番劇單集",
  "電影預告",
  "MV 音樂錄影帶",
  "廣告片",
  "教學動畫",
  "繪本動畫",
  "片頭 OP",
  "片尾 ED",
] as const;

// ─── 動畫製作專業 v3 presets ────────────────────────────────────────────────

export const RIG_TYPE_PRESETS = [
  { value: "live2d", label: "Live2D（2D 切片）" },
  { value: "spine_2d", label: "Spine 2D" },
  { value: "rigged_3d", label: "3D Rig（Maya / Blender）" },
  { value: "stop_motion", label: "Stop Motion 定格" },
  { value: "ai_only", label: "純 AI（無 rig）" },
] as const;

export const LIP_SYNC_SYSTEM_PRESETS = [
  { value: "preston_blair", label: "Preston Blair 9 mouth shapes（動畫標準）" },
  { value: "rhubarb", label: "Rhubarb（A/B/C/D/E/F/G/X）" },
  { value: "ipa", label: "IPA 國際音標" },
  { value: "custom", label: "自訂" },
] as const;

export const PRESTON_BLAIR_PHONEMES = [
  "A",      // ah, father
  "E",      // bed, end
  "I",      // sit, see
  "O",      // go, home
  "U",      // you, blue
  "M",      // mm, bm
  "F",      // f, v
  "L",      // l
  "Rest",   // 閉嘴 / 休息
] as const;

export const WALK_CYCLE_STYLE_PRESETS = [
  "穩重",
  "輕盈",
  "雀躍",
  "拖步",
  "踮腳",
  "跛行",
  "漂浮",
  "機械步",
  "醉步",
  "急行",
  "潛行",
  "霸氣大步",
] as const;

export const ANIMATION_SCHOOL_PRESETS = [
  "Disney 12 原則",
  "日本動畫 sakuga",
  "Studio Ghibli",
  "京都動畫 KyoAni",
  "Pixar 3D",
  "Cartoon Saloon",
  "Studio Ponoc",
  "Genndy Tartakovsky",
  "Don Bluth",
  "Sylvain Chomet",
  "皮影戲 / 紙偶",
  "黏土定格 Aardman",
  "Rotoscoping",
] as const;

export const COMPOSITING_PASS_PRESETS = [
  "Depth of Field 景深",
  "Lens Flare 鏡頭眩光",
  "Chromatic Aberration 色差",
  "Film Grain 顆粒",
  "Vignette 暈影",
  "Bloom 光暈",
  "Motion Blur 運動模糊",
  "Light Wrap 光暈包覆",
  "Color Grading LUT",
  "Letterbox 黑邊",
  "Scanlines",
  "Halftone 半色調",
  "VHS Glitch",
] as const;

export const SHADING_MODEL_PRESETS = [
  { value: "cel", label: "Cel 賽璐璐（硬陰影）" },
  { value: "painted", label: "厚塗" },
  { value: "flat", label: "扁平無陰影" },
  { value: "gradient", label: "漸層柔陰影" },
  { value: "3d_toon", label: "3D Toon Shader" },
  { value: "watercolor", label: "水彩" },
] as const;

export const REVERB_PRESETS = [
  { value: "dry", label: "Dry（無殘響）" },
  { value: "room", label: "Room 小房間" },
  { value: "hall", label: "Hall 大廳" },
  { value: "cathedral", label: "Cathedral 教堂" },
  { value: "outdoor", label: "Outdoor 戶外" },
  { value: "underwater", label: "Underwater 水下" },
] as const;

export const PRECIPITATION_PRESETS = [
  { value: "none", label: "無" },
  { value: "rain", label: "雨" },
  { value: "snow", label: "雪" },
  { value: "ash", label: "灰燼" },
  { value: "petals", label: "花瓣" },
  { value: "leaves", label: "落葉" },
] as const;

export const TRANSITION_STYLE_MUSIC_PRESETS = [
  { value: "crossfade", label: "Crossfade 交叉淡入" },
  { value: "hard_cut", label: "Hard Cut 直切" },
  { value: "sting", label: "Sting 重音收束" },
  { value: "morphing", label: "Morphing 漸變" },
] as const;

export const MILESTONE_STAGE_PRESETS = [
  "Development 開發",
  "Pre-Production 前期",
  "Production 製作",
  "Post-Production 後期",
  "Delivery 交付",
] as const;

export const PRODUCTION_ROLE_PRESETS = [
  "導演",
  "編劇",
  "製作人",
  "作畫監督",
  "美術指導",
  "色彩指導",
  "演出",
  "分鏡",
  "原畫",
  "動畫",
  "上色",
  "背景",
  "攝影",
  "剪輯",
  "音響監督",
  "配樂",
  "音效",
  "配音",
  "主題曲演唱",
  "後期合成",
  "宣傳",
] as const;

export const COLOR_SPACE_PRESETS = [
  { value: "sRGB", label: "sRGB（網路、預設）" },
  { value: "Rec709", label: "Rec.709（HDTV）" },
  { value: "DCI_P3", label: "DCI-P3（電影院）" },
  { value: "Rec2020", label: "Rec.2020（4K HDR）" },
  { value: "ACES", label: "ACES（電影製片工作流）" },
] as const;

export const MASTER_RESOLUTION_PRESETS = [
  { value: "720p", label: "720p HD" },
  { value: "1080p", label: "1080p Full HD" },
  { value: "1440p", label: "1440p QHD" },
  { value: "4K", label: "4K UHD" },
  { value: "8K", label: "8K UHD" },
] as const;

export const MASTER_CODEC_PRESETS = [
  { value: "ProRes", label: "Apple ProRes（剪輯用）" },
  { value: "DNxHR", label: "Avid DNxHR" },
  { value: "H264", label: "H.264（通用）" },
  { value: "H265", label: "H.265 / HEVC（高效）" },
  { value: "VP9", label: "VP9（Web）" },
  { value: "AV1", label: "AV1（新世代）" },
] as const;

export const LUFS_TARGET_PRESETS = [
  { value: -23, label: "-23 LUFS（廣播 EBU R128）" },
  { value: -16, label: "-16 LUFS（YouTube）" },
  { value: -14, label: "-14 LUFS（Spotify）" },
  { value: -27, label: "-27 LUFS（電影院 Atmos）" },
  { value: -10, label: "-10 LUFS（高動態廣告）" },
] as const;

// ─── v4 真實參考 / 研究資料庫 / 音效庫 presets ─────────────────────────────

export const CHARACTER_REF_TYPE_PRESETS = [
  { value: "historical_figure", label: "歷史人物" },
  { value: "archetype", label: "故事原型" },
  { value: "voice_actor", label: "聲優 / 配音員" },
  { value: "fashion", label: "時尚 / 服裝參考" },
  { value: "athlete", label: "運動員" },
  { value: "celebrity", label: "名人" },
  { value: "literature", label: "文學角色" },
  { value: "other", label: "其他" },
] as const;

export const SCENE_REF_TYPE_PRESETS = [
  { value: "location", label: "真實地點" },
  { value: "building", label: "建築" },
  { value: "landmark", label: "地標" },
  { value: "museum_collection", label: "博物館館藏" },
  { value: "photo", label: "檔案照片" },
  { value: "video", label: "紀錄片 / 影像" },
  { value: "wikipedia", label: "Wikipedia" },
  { value: "archive", label: "檔案 / 古地圖" },
  { value: "academic", label: "學術文獻" },
  { value: "other", label: "其他" },
] as const;

export const RESEARCH_CATEGORY_PRESETS = [
  { value: "history", label: "歷史" },
  { value: "geography", label: "地理" },
  { value: "culture", label: "文化" },
  { value: "biology", label: "生物" },
  { value: "technology", label: "技術" },
  { value: "politics", label: "政治" },
  { value: "religion", label: "宗教" },
  { value: "language", label: "語言" },
  { value: "economy", label: "經濟" },
  { value: "magic", label: "魔法 / 異能" },
  { value: "society", label: "社會結構" },
  { value: "other", label: "其他" },
] as const;

export const SOUND_LIBRARY_CATEGORY_PRESETS = [
  { value: "ambient", label: "環境音 Ambient（風、雨、市場、森林…）" },
  { value: "sfx", label: "音效 SFX（碰撞、爆炸、魔法…）" },
  { value: "ui", label: "界面音 UI（提示、選單、回饋）" },
  { value: "music_stinger", label: "音樂節拍 Stinger" },
  { value: "footsteps", label: "腳步聲" },
  { value: "voice_clip", label: "語音片段" },
  { value: "weather", label: "天氣音（雷、雨、雪、風暴）" },
  { value: "nature", label: "自然音（鳥、蟲、水）" },
  { value: "other", label: "其他" },
] as const;

export const SOUND_LICENSE_PRESETS = [
  "CC0 公眾領域",
  "CC-BY 標示",
  "CC-BY-SA 標示-相同方式分享",
  "自有版權",
  "商業授權（Pond5 / Epidemic Sound）",
  "免費庫（Freesound）",
  "AI 生成（站內）",
] as const;

export const ASSET_PURPOSE_PRESETS = [
  "reference 參考",
  "training 訓練資料",
  "output 產出物",
  "archive 存檔",
  "concept 概念稿",
  "final 成品",
] as const;

// ─── Zod schemas（router 用） ───────────────────────────────────────────────

export const characterRoleSchema = z.enum([
  "protagonist",
  "supporting",
  "antagonist",
  "npc",
]);

export const characterThreeViewSheetSchema = z.object({
  frontImageUrl: draftUrl().optional(),
  sideImageUrl: draftUrl().optional(),
  backImageUrl: draftUrl().optional(),
  threeQuarterImageUrl: draftUrl().optional(),
  isComplete: z.boolean().optional(),
  referenceImageUrls: z.array(draftUrl()).max(20).optional(),
  generationPrompt: z.string().max(2000).optional(),
});

export const characterExpressionSchema = z.object({
  id: z.string().min(1),
  name: draftLabel(64),
  description: z.string().max(500).optional(),
  imageUrl: draftUrl().optional(),
  promptKeywords: z.array(z.string().max(64)).max(20).optional(),
  intensity: z.number().min(0).max(1).optional(),
  triggers: z.array(z.string().max(64)).max(20).optional(),
});

export const characterOutfitSchema = z.object({
  id: z.string().min(1),
  name: draftLabel(128),
  description: z.string().max(1000).optional(),
  imageUrl: draftUrl().optional(),
  occasion: z.string().max(64).optional(),
  season: z.string().max(32).optional(),
  palette: z.array(z.string().max(64)).max(12).optional(),
  isDefault: z.boolean().optional(),
  triggerWord: z.string().max(128).optional(),
});

export const characterSpeechToneSchema = z.object({
  baseTone: z.string().max(64).optional(),
  formality: z
    .enum(["casual", "neutral", "formal", "archaic", "slang"])
    .optional(),
  pace: z.enum(["slow", "normal", "fast", "varied"]).optional(),
  catchphrases: z.array(z.string().max(64)).max(20).optional(),
  mannerisms: z.array(z.string().max(64)).max(20).optional(),
  selfReferent: z.string().max(32).optional(),
  thirdPartyReferent: z.string().max(32).optional(),
  forbiddenWords: z.array(z.string().max(64)).max(50).optional(),
});

export const characterVoiceProfileSchema = z.object({
  engine: z
    .enum(["elevenlabs", "gemini", "fal", "minimax", "custom"])
    .optional(),
  voiceId: z.string().max(255).optional(),
  languageCode: z.string().max(16).optional(),
  pitch: z.number().min(-1).max(1).optional(),
  speed: z.number().min(0.25).max(4).optional(),
  emotion: z.string().max(64).optional(),
  sampleAudioUrl: draftUrl().optional(),
  useClone: z.boolean().optional(),
  cloneSampleUrls: z.array(draftUrl()).max(10).optional(),
  promptPrefix: z.string().max(500).optional(),
});

export const characterScriptRoleSchema = z.object({
  archetype: z.string().max(64).optional(),
  arcType: z
    .enum(["growth", "fall", "redemption", "revenge", "flat", "tragic"])
    .optional(),
  defaultPosition: z
    .enum(["main_stage", "narrator", "transition", "cameo", "rival"])
    .optional(),
  avgScreenTimeRatio: z.number().min(0).max(1).optional(),
  relationships: z
    .array(
      z.object({
        targetCharacterId: z.string().min(1).max(64),
        relation: z.string().min(1).max(64),
        tension: z.number().min(0).max(1).optional(),
      })
    )
    .max(50)
    .optional(),
  signatureLines: z.array(z.string().max(255)).max(20).optional(),
  appearsInBeats: z.array(z.string().max(64)).max(20).optional(),
});

export const characterBodySchema = z.object({
  heightCm: z.number().min(0).max(1000).optional(),
  ageStage: z.string().max(32).optional(),
  build: z.string().max(64).optional(),
  species: z.string().max(64).optional(),
  distinctiveFeatures: z.array(z.string().max(64)).max(20).optional(),
});

export const worldCharacterSchema = z.object({
  id: z.string().min(1),
  name: draftLabel(128),
  role: characterRoleSchema,
  tagline: z.string().max(255).optional(),
  personality: z.string().max(2000).optional(),
  likes: z.array(z.string().max(128)).max(50).optional(),
  interests: z.array(z.string().max(128)).max(50).optional(),
  outfit: z.string().max(2000).optional(),
  appearance: z.string().max(2000).optional(),
  signatureItems: z.array(z.string().max(128)).max(50).optional(),
  backstory: z.string().max(5000).optional(),
  linkedModelId: z.number().int().positive().nullable().optional(),
  triggerWord: z.string().max(128).optional(),
  notes: z.string().max(2000).optional(),
  // 動畫擴充 v2
  threeViewSheet: characterThreeViewSheetSchema.optional(),
  expressions: z.array(characterExpressionSchema).max(50).optional(),
  outfits: z.array(characterOutfitSchema).max(30).optional(),
  speechTone: characterSpeechToneSchema.optional(),
  voiceProfile: characterVoiceProfileSchema.optional(),
  scriptRole: characterScriptRoleSchema.optional(),
  body: characterBodySchema.optional(),
  // 動畫製作專業擴充 v3
  rigSpec: z
    .object({
      rigType: z
        .enum(["live2d", "spine_2d", "rigged_3d", "stop_motion", "ai_only"])
        .optional(),
      boneCount: z.number().int().min(0).max(5000).optional(),
      ikChains: z.array(z.string().max(64)).max(30).optional(),
      blendShapeCount: z.number().int().min(0).max(1000).optional(),
      hasClothSim: z.boolean().optional(),
      hasHairPhysics: z.boolean().optional(),
      hasEyeTracking: z.boolean().optional(),
      rigger: z.string().max(128).optional(),
      rigAssetUrl: draftUrl().optional(),
      riggerNotes: z.string().max(2000).optional(),
    })
    .optional(),
  lipSyncSet: z
    .object({
      system: z
        .enum(["preston_blair", "rhubarb", "ipa", "custom"])
        .optional(),
      shapes: z.record(z.string().max(64), z.string().max(2048)).optional(),
      enabled: z.boolean().optional(),
      primaryLanguage: z.string().max(16).optional(),
    })
    .optional(),
  actingNotes: z
    .object({
      emotionalRange: z.array(z.string().max(64)).max(30).optional(),
      signatureGestures: z.array(z.string().max(128)).max(20).optional(),
      walkCycleStyle: z.string().max(128).optional(),
      defaultPosture: z.string().max(128).optional(),
      gazePattern: z.string().max(128).optional(),
      thinkingTics: z.array(z.string().max(128)).max(20).optional(),
      stressTics: z.array(z.string().max(128)).max(20).optional(),
      cameraPreference: z
        .enum(["front", "three_quarter", "side", "varied"])
        .optional(),
      squashStretch: z.number().min(0).max(1).optional(),
      vodirection: z.string().max(2000).optional(),
    })
    .optional(),
  ageVariants: z
    .array(
      z.object({
        id: z.string().min(1),
        name: draftLabel(64),
        approxAge: z.string().max(32).optional(),
        imageUrls: z.array(draftUrl()).max(20).optional(),
        description: z.string().max(2000).optional(),
        linkedModelId: z.number().int().positive().nullable().optional(),
        triggerWord: z.string().max(128).optional(),
      })
    )
    .max(20)
    .optional(),
  soundProfile: z
    .object({
      footsteps: z.record(z.string().max(64), z.string().max(2048)).optional(),
      breathSample: draftUrl().optional(),
      laughSample: draftUrl().optional(),
      crySample: draftUrl().optional(),
      shoutSample: draftUrl().optional(),
      hurtSample: draftUrl().optional(),
      sighSample: draftUrl().optional(),
      customSamples: z
        .array(
          z.object({
            label: z.string().max(64),
            url: draftUrl(),
          })
        )
        .max(50)
        .optional(),
    })
    .optional(),
  referenceLibrary: z
    .array(
      z.object({
        id: z.string().min(1),
        imageUrl: draftUrl(),
        category: z.string().max(32).optional(),
        tags: z.array(z.string().max(32)).max(20).optional(),
        description: z.string().max(500).optional(),
      })
    )
    .max(200)
    .optional(),
  // v4 真實參考 + 上傳資產
  realWorldRefs: z
    .array(
      z.object({
        id: z.string().min(1),
        label: draftLabel(255),
        refType: z
          .enum([
            "historical_figure",
            "archetype",
            "voice_actor",
            "fashion",
            "athlete",
            "celebrity",
            "literature",
            "other",
          ])
          .optional(),
        personName: z.string().max(128).optional(),
        externalUrl: draftUrl().optional(),
        imageUrls: z.array(draftUrl()).max(20).optional(),
        description: z.string().max(2000).optional(),
        citation: z.string().max(500).optional(),
      })
    )
    .max(50)
    .optional(),
  uploadedAssets: z
    .array(
      z.object({
        id: z.string().min(1),
        label: draftLabel(255),
        assetType: z
          .enum(["image", "audio", "video", "pdf", "document", "other"])
          .optional(),
        url: draftUrl(),
        fileKey: z.string().max(255).optional(),
        mimeType: z.string().max(128).optional(),
        sizeBytes: z.number().int().min(0).optional(),
        purpose: z.string().max(64).optional(),
        description: z.string().max(500).optional(),
        uploadedAt: z.string().max(32).optional(),
      })
    )
    .max(100)
    .optional(),
});

export const sceneTimeOfDaySchema = z.object({
  label: draftLabel(32),
  lighting: z.string().max(500).optional(),
  palette: z.array(z.string().max(64)).max(12).optional(),
  imageUrl: draftUrl().optional(),
});

export const worldSceneSchema = z.object({
  id: z.string().min(1),
  name: draftLabel(128),
  tagline: z.string().max(255).optional(),
  environment: z.string().max(2000).optional(),
  flora: z.array(z.string().max(128)).max(50).optional(),
  fauna: z.array(z.string().max(128)).max(50).optional(),
  props: z.array(z.string().max(128)).max(50).optional(),
  lighting: z.string().max(500).optional(),
  mood: z.string().max(500).optional(),
  environmentChanges: z.array(z.string().max(255)).max(50).optional(),
  linkedModelId: z.number().int().positive().nullable().optional(),
  triggerWord: z.string().max(128).optional(),
  notes: z.string().max(2000).optional(),
  // 動畫擴充 v2
  establishingShotUrl: draftUrl().optional(),
  timeOfDay: z.array(sceneTimeOfDaySchema).max(12).optional(),
  styleProfileId: z.string().max(64).nullable().optional(),
  musicThemeId: z.string().max(64).nullable().optional(),
  defaultCameraMovement: z.string().max(64).optional(),
  preferredAspectRatio: z.string().max(16).optional(),
  // 動畫製作專業擴充 v3
  layout: z
    .object({
      floorPlanUrl: draftUrl().optional(),
      blockingDiagramUrl: draftUrl().optional(),
      entryPoints: z.array(z.string().max(128)).max(20).optional(),
      exitPoints: z.array(z.string().max(128)).max(20).optional(),
      heroShotAngle: z.string().max(128).optional(),
      coverageAngles: z.array(z.string().max(128)).max(20).optional(),
      approxDimensions: z
        .object({
          widthM: z.number().min(0).max(10000).optional(),
          depthM: z.number().min(0).max(10000).optional(),
          heightM: z.number().min(0).max(10000).optional(),
        })
        .optional(),
    })
    .optional(),
  productionDesign: z
    .object({
      architecturalStyle: z.string().max(128).optional(),
      materials: z.array(z.string().max(64)).max(30).optional(),
      periodDetails: z.string().max(2000).optional(),
      setPieces: z.array(z.string().max(128)).max(50).optional(),
      colorScript: z
        .object({
          keyColor: z.string().max(64).optional(),
          midColor: z.string().max(64).optional(),
          shadowColor: z.string().max(64).optional(),
        })
        .optional(),
      referenceUrls: z.array(draftUrl()).max(30).optional(),
    })
    .optional(),
  atmospherics: z
    .object({
      fogDensity: z.number().min(0).max(1).optional(),
      dustMotes: z.boolean().optional(),
      lightShafts: z.boolean().optional(),
      precipitation: z
        .enum(["none", "rain", "snow", "ash", "petals", "leaves"])
        .optional(),
      lightning: z.boolean().optional(),
      customParticles: z.array(z.string().max(128)).max(20).optional(),
    })
    .optional(),
  soundDesign: z
    .object({
      ambientBedUrl: draftUrl().optional(),
      roomToneUrl: draftUrl().optional(),
      reverb: z
        .enum(["dry", "room", "hall", "cathedral", "outdoor", "underwater"])
        .optional(),
      signatureSfx: z
        .array(
          z.object({
            label: z.string().max(128),
            url: draftUrl().optional(),
            description: z.string().max(500).optional(),
          })
        )
        .max(30)
        .optional(),
      diegeticSources: z.array(z.string().max(128)).max(20).optional(),
    })
    .optional(),
  // v4 真實參考 + 上傳資產
  realWorldRefs: z
    .array(
      z.object({
        id: z.string().min(1),
        label: draftLabel(255),
        refType: z
          .enum([
            "location",
            "building",
            "landmark",
            "museum_collection",
            "photo",
            "video",
            "wikipedia",
            "archive",
            "academic",
            "other",
          ])
          .optional(),
        gpsCoords: z
          .object({
            lat: z.number().min(-90).max(90),
            lon: z.number().min(-180).max(180),
          })
          .optional(),
        mapImageUrl: draftUrl().optional(),
        externalUrl: draftUrl().optional(),
        imageUrls: z.array(draftUrl()).max(20).optional(),
        description: z.string().max(2000).optional(),
        citation: z.string().max(500).optional(),
        yearOfReference: z.string().max(32).optional(),
      })
    )
    .max(50)
    .optional(),
  uploadedAssets: z
    .array(
      z.object({
        id: z.string().min(1),
        label: draftLabel(255),
        assetType: z
          .enum(["image", "audio", "video", "pdf", "document", "other"])
          .optional(),
        url: draftUrl(),
        fileKey: z.string().max(255).optional(),
        mimeType: z.string().max(128).optional(),
        sizeBytes: z.number().int().min(0).optional(),
        purpose: z.string().max(64).optional(),
        description: z.string().max(500).optional(),
        uploadedAt: z.string().max(32).optional(),
      })
    )
    .max(100)
    .optional(),
  soundLibraryRefs: z.array(z.string().max(64)).max(100).optional(),
});

export const worldStyleProfileSchema = z.object({
  id: z.string().min(1),
  name: draftLabel(128),
  artStyle: z.string().max(128).optional(),
  palette: z.array(z.string().max(64)).max(24).optional(),
  lighting: z.string().max(500).optional(),
  lensSpec: z
    .object({
      focalLengthMm: z.number().min(1).max(2000).optional(),
      aperture: z.string().max(16).optional(),
      aspectRatio: z.string().max(16).optional(),
      depthOfField: z.enum(["shallow", "deep", "rack"]).optional(),
    })
    .optional(),
  postProcessing: z.array(z.string().max(64)).max(20).optional(),
  fps: z.number().int().min(1).max(120).optional(),
  referenceImageUrls: z.array(draftUrl()).max(20).optional(),
  triggerWord: z.string().max(128).optional(),
  negativePrompt: z.string().max(1000).optional(),
  linkedModelId: z.number().int().positive().nullable().optional(),
  description: z.string().max(2000).optional(),
  // 動畫製作專業擴充 v3
  shootOn: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  schoolReference: z.string().max(128).optional(),
  lineSpec: z
    .object({
      weight: z.number().min(0).max(20).optional(),
      hasOutline: z.boolean().optional(),
      outlineColor: z.string().max(32).optional(),
      lineColor: z.string().max(32).optional(),
      lineStyle: z.enum(["clean", "sketchy", "boil", "varied"]).optional(),
    })
    .optional(),
  shadingModel: z
    .enum(["cel", "painted", "flat", "gradient", "3d_toon", "watercolor"])
    .optional(),
  compositingPasses: z.array(z.string().max(64)).max(20).optional(),
  colorSpace: z
    .enum(["sRGB", "Rec709", "DCI_P3", "Rec2020", "ACES"])
    .optional(),
  masterResolution: z
    .enum(["720p", "1080p", "1440p", "4K", "8K"])
    .optional(),
  masterCodec: z
    .enum(["ProRes", "DNxHR", "H264", "H265", "VP9", "AV1"])
    .optional(),
  letterboxing: z.string().max(128).optional(),
  subtitleSpec: z
    .object({
      font: z.string().max(64).optional(),
      sizePt: z.number().int().min(8).max(200).optional(),
      color: z.string().max(32).optional(),
      outlineColor: z.string().max(32).optional(),
    })
    .optional(),
  titleCardStyle: z.string().max(500).optional(),
});

export const worldMusicThemeSchema = z.object({
  id: z.string().min(1),
  name: draftLabel(128),
  mood: z.string().max(64).optional(),
  instruments: z.array(z.string().max(64)).max(20).optional(),
  bpm: z.number().int().min(20).max(400).optional(),
  timeSignature: z.string().max(16).optional(),
  key: z.string().max(64).optional(),
  applicableSceneIds: z.array(z.string().max(64)).max(100).optional(),
  applicableCharacterIds: z.array(z.string().max(64)).max(100).optional(),
  promptKeywords: z.array(z.string().max(64)).max(20).optional(),
  sampleAudioUrl: draftUrl().optional(),
  description: z.string().max(1000).optional(),
  // 動畫製作專業擴充 v3
  leitmotif: z
    .object({
      description: z.string().max(1000).optional(),
      melodicPhrase: z.string().max(500).optional(),
      midiUrl: draftUrl().optional(),
    })
    .optional(),
  cueVariants: z
    .array(
      z.object({
        label: z.string().max(64),
        durationSec: z.number().min(0).max(60 * 60),
        audioUrl: draftUrl().optional(),
        loopable: z.boolean().optional(),
      })
    )
    .max(20)
    .optional(),
  stems: z
    .object({
      drums: draftUrl().optional(),
      bass: draftUrl().optional(),
      melody: draftUrl().optional(),
      harmony: draftUrl().optional(),
      pads: draftUrl().optional(),
      fx: draftUrl().optional(),
    })
    .optional(),
  lufsTarget: z.number().min(-50).max(0).optional(),
  transitionStyle: z
    .enum(["crossfade", "hard_cut", "sting", "morphing"])
    .optional(),
  stingerPoints: z.array(z.number().min(0).max(60 * 60)).max(50).optional(),
});

export const worldObjectSchema = z.object({
  id: z.string().min(1),
  name: draftLabel(128),
  category: z.string().max(64).optional(),
  description: z.string().max(2000).optional(),
  visualTraits: z.string().max(1000).optional(),
  appearsInScenes: z.array(z.string()).max(100).optional(),
  notes: z.string().max(1000).optional(),
});

export const worldbuildingFrameworkInputSchema = z.object({
  name: draftLabel(255),
  description: z.string().max(5000).optional(),
  genre: z.string().max(128).optional(),
  era: z.string().max(128).optional(),
  characters: z.array(worldCharacterSchema).max(100),
  scenes: z.array(worldSceneSchema).max(100),
  objects: z.array(worldObjectSchema).max(200).optional(),
  linkedModelIds: z.array(z.number().int().positive()).max(50).optional(),
  tags: z.array(z.string().max(64)).max(30).optional(),
  isActive: z.boolean().optional(),
  // 動畫擴充
  styleProfiles: z.array(worldStyleProfileSchema).max(30).optional(),
  musicThemes: z.array(worldMusicThemeSchema).max(30).optional(),
  defaultStyleProfileId: z.string().max(64).nullable().optional(),
  globalNegativePrompt: z.string().max(2000).optional(),
  // v4
  researchEntries: z
    .array(
      z.object({
        id: z.string().min(1),
        title: draftLabel(255),
        category: z.string().max(32).optional(),
        content: z.string().max(50000).optional(),
        sourceUrls: z.array(draftUrl()).max(30).optional(),
        attachments: z
          .array(
            z.object({
              id: z.string().min(1),
              label: draftLabel(255),
              assetType: z
                .enum(["image", "audio", "video", "pdf", "document", "other"])
                .optional(),
              url: draftUrl(),
              fileKey: z.string().max(255).optional(),
              mimeType: z.string().max(128).optional(),
              sizeBytes: z.number().int().min(0).optional(),
              purpose: z.string().max(64).optional(),
              description: z.string().max(500).optional(),
              uploadedAt: z.string().max(32).optional(),
            })
          )
          .max(50)
          .optional(),
        citation: z.string().max(500).optional(),
        tags: z.array(z.string().max(32)).max(20).optional(),
        isCanon: z.boolean().optional(),
      })
    )
    .max(200)
    .optional(),
  soundLibrary: z
    .array(
      z.object({
        id: z.string().min(1),
        label: draftLabel(255),
        category: z
          .enum([
            "ambient",
            "sfx",
            "ui",
            "music_stinger",
            "footsteps",
            "voice_clip",
            "weather",
            "nature",
            "other",
          ])
          .optional(),
        audioUrl: draftUrl(),
        fileKey: z.string().max(255).optional(),
        durationSec: z.number().min(0).max(60 * 60).optional(),
        tags: z.array(z.string().max(32)).max(20).optional(),
        description: z.string().max(500).optional(),
        triggers: z.array(z.string().max(64)).max(20).optional(),
        loopable: z.boolean().optional(),
        volumeDefault: z.number().min(0).max(1).optional(),
        source: z.string().max(128).optional(),
        license: z.string().max(128).optional(),
      })
    )
    .max(300)
    .optional(),
  uploadedAssets: z
    .array(
      z.object({
        id: z.string().min(1),
        label: draftLabel(255),
        assetType: z
          .enum(["image", "audio", "video", "pdf", "document", "other"])
          .optional(),
        url: draftUrl(),
        fileKey: z.string().max(255).optional(),
        mimeType: z.string().max(128).optional(),
        sizeBytes: z.number().int().min(0).optional(),
        purpose: z.string().max(64).optional(),
        description: z.string().max(500).optional(),
        uploadedAt: z.string().max(32).optional(),
      })
    )
    .max(500)
    .optional(),
  productionTargets: z
    .object({
      format: z.string().max(64).optional(),
      targetDurationSec: z.number().int().min(1).max(60 * 60 * 6).optional(),
      audience: z.string().max(64).optional(),
      platform: z.string().max(64).optional(),
      // 製作專業擴充 v3
      milestones: z
        .array(
          z.object({
            id: z.string().min(1),
            stage: draftLabel(64),
            title: draftLabel(255),
            dueDate: z.string().max(32).optional(),
            status: z
              .enum(["pending", "in_progress", "completed", "blocked"])
              .optional(),
            owner: z.string().max(128).optional(),
            notes: z.string().max(2000).optional(),
          })
        )
        .max(100)
        .optional(),
      budgetUsd: z.number().min(0).max(1e9).optional(),
      credits: z
        .array(
          z.object({
            id: z.string().min(1),
            role: draftLabel(64),
            name: draftLabel(128),
            link: draftUrl().optional(),
          })
        )
        .max(200)
        .optional(),
      masterSpec: z
        .object({
          resolution: z.string().max(16).optional(),
          fps: z.number().int().min(1).max(120).optional(),
          colorSpace: z.string().max(32).optional(),
          hdr: z.boolean().optional(),
          audioChannels: z
            .enum(["mono", "stereo", "5.1", "7.1", "atmos"])
            .optional(),
          audioBitrate: z.string().max(16).optional(),
        })
        .optional(),
      deliverables: z.array(z.string().max(128)).max(30).optional(),
      rating: z.string().max(16).optional(),
      subtitleLanguages: z.array(z.string().max(16)).max(30).optional(),
      dubLanguages: z.array(z.string().max(16)).max(30).optional(),
    })
    .optional(),
});

export type WorldbuildingFrameworkInput = z.infer<
  typeof worldbuildingFrameworkInputSchema
>;

// ─── Prompt helpers ─────────────────────────────────────────────────────────

/**
 * 把一個世界觀架構壓縮成可以塞進 LLM system prompt 的純文字。
 * 導演 AI / Studio / 動畫管線生成時呼叫此函式取得完整世界觀脈絡。
 *
 * 包含：角色（含三視圖、表情、穿衣、口氣、語音、腳本定位）、場景、
 * 全域物件、畫面風格設定、配樂主題、製作目標。
 */
export function summarizeFrameworkForPrompt(
  framework: WorldbuildingFrameworkData
): string {
  const lines: string[] = [];
  lines.push(`# 世界觀：${framework.name}`);
  if (framework.genre) lines.push(`類型風格：${framework.genre}`);
  if (framework.era) lines.push(`時代背景：${framework.era}`);
  if (framework.description) lines.push(framework.description);

  if (framework.productionTargets) {
    const t = framework.productionTargets;
    const tparts: string[] = [];
    if (t.format) tparts.push(`格式：${t.format}`);
    if (t.targetDurationSec) tparts.push(`目標時長：${t.targetDurationSec}s`);
    if (t.audience) tparts.push(`受眾：${t.audience}`);
    if (t.platform) tparts.push(`平台：${t.platform}`);
    if (t.rating) tparts.push(`分級：${t.rating}`);
    if (t.budgetUsd) tparts.push(`預算：$${t.budgetUsd}`);
    if (tparts.length) lines.push(`製作目標：${tparts.join(" · ")}`);

    if (t.masterSpec) {
      const m = t.masterSpec;
      const mparts: string[] = [];
      if (m.resolution) mparts.push(m.resolution);
      if (m.fps) mparts.push(`${m.fps}fps`);
      if (m.colorSpace) mparts.push(m.colorSpace);
      if (m.hdr) mparts.push("HDR");
      if (m.audioChannels) mparts.push(`音訊 ${m.audioChannels}`);
      if (mparts.length) lines.push(`Master：${mparts.join(" / ")}`);
    }
    if (t.subtitleLanguages?.length)
      lines.push(`字幕語言：${t.subtitleLanguages.join("、")}`);
    if (t.dubLanguages?.length)
      lines.push(`配音語言：${t.dubLanguages.join("、")}`);
    if (t.deliverables?.length)
      lines.push(`交付：${t.deliverables.join("、")}`);

    if (t.milestones?.length) {
      lines.push("\n## 製作里程碑");
      for (const m of t.milestones) {
        const meta: string[] = [m.stage];
        if (m.status) meta.push(m.status);
        if (m.dueDate) meta.push(m.dueDate);
        if (m.owner) meta.push(`負責 ${m.owner}`);
        lines.push(`- [${meta.join(" · ")}] ${m.title}`);
      }
    }
    if (t.credits?.length) {
      lines.push("\n## Credits");
      for (const c of t.credits) {
        lines.push(`- ${c.role}：${c.name}`);
      }
    }
  }

  if (framework.globalNegativePrompt)
    lines.push(`全域負面詞：${framework.globalNegativePrompt}`);

  // ─── 畫面風格設定 ─────────────────────────────────────────────────────────
  if (framework.styleProfiles && framework.styleProfiles.length > 0) {
    lines.push("\n## 畫面風格設定（Style Profiles）");
    for (const sp of framework.styleProfiles) {
      const head = `- ${sp.name}${
        framework.defaultStyleProfileId === sp.id ? "（預設）" : ""
      }`;
      lines.push(head);
      if (sp.artStyle) lines.push(`  · 繪風：${sp.artStyle}`);
      if (sp.lighting) lines.push(`  · 燈光：${sp.lighting}`);
      if (sp.palette?.length)
        lines.push(`  · 色票：${sp.palette.join("、")}`);
      if (sp.lensSpec) {
        const l = sp.lensSpec;
        const parts: string[] = [];
        if (l.focalLengthMm) parts.push(`${l.focalLengthMm}mm`);
        if (l.aperture) parts.push(`光圈 ${l.aperture}`);
        if (l.aspectRatio) parts.push(`比例 ${l.aspectRatio}`);
        if (l.depthOfField) parts.push(`景深 ${l.depthOfField}`);
        if (parts.length) lines.push(`  · 鏡頭：${parts.join(" / ")}`);
      }
      if (sp.postProcessing?.length)
        lines.push(`  · 後製：${sp.postProcessing.join("、")}`);
      if (sp.fps) lines.push(`  · 影格率：${sp.fps}fps`);
      if (sp.triggerWord) lines.push(`  · 風格 LoRA trigger：${sp.triggerWord}`);
      if (sp.negativePrompt)
        lines.push(`  · 風格負面詞：${sp.negativePrompt}`);
      if (sp.description) lines.push(`  · 說明：${sp.description}`);
      // v3 專業
      const techParts: string[] = [];
      if (sp.shootOn) techParts.push(`shoot on ${sp.shootOn}s`);
      if (sp.schoolReference) techParts.push(sp.schoolReference);
      if (sp.shadingModel) techParts.push(`shading ${sp.shadingModel}`);
      if (sp.colorSpace) techParts.push(sp.colorSpace);
      if (sp.masterResolution) techParts.push(sp.masterResolution);
      if (sp.masterCodec) techParts.push(sp.masterCodec);
      if (techParts.length)
        lines.push(`  · 技術：${techParts.join(" / ")}`);
      if (sp.compositingPasses?.length)
        lines.push(`  · 合成 pass：${sp.compositingPasses.join("、")}`);
      if (sp.lineSpec?.lineStyle)
        lines.push(`  · 線條：${sp.lineSpec.lineStyle}`);
    }
  }

  // ─── 配樂主題 ────────────────────────────────────────────────────────────
  if (framework.musicThemes && framework.musicThemes.length > 0) {
    lines.push("\n## 配樂主題（Music Themes）");
    for (const mt of framework.musicThemes) {
      lines.push(`- ${mt.name}`);
      if (mt.mood) lines.push(`  · 情緒：${mt.mood}`);
      if (mt.instruments?.length)
        lines.push(`  · 樂器：${mt.instruments.join("、")}`);
      const meter: string[] = [];
      if (mt.bpm) meter.push(`BPM ${mt.bpm}`);
      if (mt.timeSignature) meter.push(`拍號 ${mt.timeSignature}`);
      if (mt.key) meter.push(`調性 ${mt.key}`);
      if (meter.length) lines.push(`  · 節奏：${meter.join(" / ")}`);
      if (mt.promptKeywords?.length)
        lines.push(`  · 生成關鍵字：${mt.promptKeywords.join("、")}`);
      if (mt.description) lines.push(`  · 說明：${mt.description}`);
      // v3 專業
      if (mt.leitmotif?.description)
        lines.push(`  · 主題動機：${mt.leitmotif.description}`);
      if (mt.cueVariants?.length)
        lines.push(
          `  · Cue 變體：${mt.cueVariants
            .map(v => `${v.label}(${v.durationSec}s${v.loopable ? "·loop" : ""})`)
            .join("、")}`
        );
      const audioTech: string[] = [];
      if (mt.lufsTarget != null) audioTech.push(`${mt.lufsTarget} LUFS`);
      if (mt.transitionStyle) audioTech.push(mt.transitionStyle);
      if (audioTech.length) lines.push(`  · 技術：${audioTech.join(" / ")}`);
      const stemsList: string[] = [];
      if (mt.stems) {
        for (const [k, v] of Object.entries(mt.stems))
          if (v) stemsList.push(k);
        if (stemsList.length)
          lines.push(`  · Stems：${stemsList.join("、")}`);
      }
      if (mt.stingerPoints?.length)
        lines.push(`  · Stingers @ ${mt.stingerPoints.join("s, ")}s`);
    }
  }

  // ─── 角色 ────────────────────────────────────────────────────────────────
  if (framework.characters.length > 0) {
    lines.push("\n## 角色");
    for (const c of framework.characters) {
      const role = CHARACTER_ROLE_LABELS[c.role] ?? c.role;
      const parts: string[] = [`- [${role}] ${c.name}`];
      if (c.tagline) parts.push(`（${c.tagline}）`);
      lines.push(parts.join(""));
      if (c.appearance) lines.push(`  · 樣貌：${c.appearance}`);

      // 體型
      if (c.body) {
        const b = c.body;
        const bparts: string[] = [];
        if (b.species) bparts.push(b.species);
        if (b.ageStage) bparts.push(b.ageStage);
        if (b.build) bparts.push(b.build);
        if (b.heightCm) bparts.push(`${b.heightCm}cm`);
        if (b.distinctiveFeatures?.length)
          bparts.push(`特徵：${b.distinctiveFeatures.join("、")}`);
        if (bparts.length) lines.push(`  · 體型：${bparts.join(" / ")}`);
      }

      // 三視圖
      if (c.threeViewSheet) {
        const ts = c.threeViewSheet;
        const has = [
          ts.frontImageUrl && "正",
          ts.sideImageUrl && "側",
          ts.backImageUrl && "背",
          ts.threeQuarterImageUrl && "3/4",
        ].filter(Boolean);
        if (has.length)
          lines.push(`  · 三視圖：已備齊 ${has.join("/")} 視角`);
      }

      // 穿衣
      if (c.outfits?.length) {
        const def = c.outfits.find(o => o.isDefault) ?? c.outfits[0];
        const others = c.outfits.filter(o => o.id !== def?.id);
        lines.push(
          `  · 預設穿著：${def?.name}${
            def?.description ? `（${def.description}）` : ""
          }`
        );
        if (others.length)
          lines.push(`  · 其他套裝：${others.map(o => o.name).join("、")}`);
      } else if (c.outfit) {
        lines.push(`  · 穿著：${c.outfit}`);
      }

      // 表情
      if (c.expressions?.length)
        lines.push(
          `  · 表情包：${c.expressions.map(e => e.name).join("、")}`
        );

      if (c.personality) lines.push(`  · 個性：${c.personality}`);

      // 口氣
      if (c.speechTone) {
        const st = c.speechTone;
        const stparts: string[] = [];
        if (st.baseTone) stparts.push(st.baseTone);
        if (st.formality) stparts.push(`正式度 ${st.formality}`);
        if (st.pace) stparts.push(`語速 ${st.pace}`);
        if (st.selfReferent) stparts.push(`自稱「${st.selfReferent}」`);
        if (stparts.length) lines.push(`  · 口氣：${stparts.join(" / ")}`);
        if (st.catchphrases?.length)
          lines.push(`  · 口頭禪：${st.catchphrases.join("、")}`);
        if (st.mannerisms?.length)
          lines.push(`  · 說話習慣：${st.mannerisms.join("、")}`);
        if (st.forbiddenWords?.length)
          lines.push(`  · 禁用詞：${st.forbiddenWords.join("、")}`);
      }

      // 語音
      if (c.voiceProfile) {
        const vp = c.voiceProfile;
        const vparts: string[] = [];
        if (vp.engine) vparts.push(vp.engine);
        if (vp.voiceId) vparts.push(`id=${vp.voiceId}`);
        if (vp.languageCode) vparts.push(vp.languageCode);
        if (vp.emotion) vparts.push(`情緒 ${vp.emotion}`);
        if (vp.pitch !== undefined) vparts.push(`pitch ${vp.pitch}`);
        if (vp.speed !== undefined) vparts.push(`speed ${vp.speed}`);
        if (vparts.length) lines.push(`  · 配音設定：${vparts.join(" / ")}`);
        if (vp.useClone) lines.push(`  · 啟用語音克隆`);
      }

      // 腳本定位
      if (c.scriptRole) {
        const sr = c.scriptRole;
        const srparts: string[] = [];
        if (sr.archetype) srparts.push(`原型 ${sr.archetype}`);
        if (sr.arcType) srparts.push(`弧線 ${sr.arcType}`);
        if (sr.defaultPosition) srparts.push(`定位 ${sr.defaultPosition}`);
        if (sr.avgScreenTimeRatio !== undefined)
          srparts.push(`戲份 ${(sr.avgScreenTimeRatio * 100).toFixed(0)}%`);
        if (srparts.length) lines.push(`  · 腳本定位：${srparts.join(" / ")}`);
        if (sr.signatureLines?.length)
          lines.push(`  · 招牌台詞：${sr.signatureLines.join(" | ")}`);
        if (sr.appearsInBeats?.length)
          lines.push(`  · 出場橋段：${sr.appearsInBeats.join("、")}`);
      }

      if (c.likes?.length) lines.push(`  · 喜好：${c.likes.join("、")}`);
      if (c.interests?.length) lines.push(`  · 興趣：${c.interests.join("、")}`);
      if (c.signatureItems?.length)
        lines.push(`  · 隨身物件：${c.signatureItems.join("、")}`);
      if (c.triggerWord) lines.push(`  · LoRA trigger：${c.triggerWord}`);

      // ─── v3 專業欄位 ──────────────────────────────────────────────────
      if (c.rigSpec) {
        const r = c.rigSpec;
        const rparts: string[] = [];
        if (r.rigType) rparts.push(r.rigType);
        if (r.boneCount) rparts.push(`${r.boneCount} 骨`);
        if (r.blendShapeCount) rparts.push(`${r.blendShapeCount} blend shapes`);
        if (r.ikChains?.length) rparts.push(`IK: ${r.ikChains.join("、")}`);
        const flags: string[] = [];
        if (r.hasClothSim) flags.push("布料");
        if (r.hasHairPhysics) flags.push("頭髮物理");
        if (r.hasEyeTracking) flags.push("眼追蹤");
        if (flags.length) rparts.push(`含：${flags.join("、")}`);
        if (rparts.length) lines.push(`  · Rig：${rparts.join(" / ")}`);
      }
      if (c.actingNotes) {
        const a = c.actingNotes;
        const aparts: string[] = [];
        if (a.walkCycleStyle) aparts.push(`走路 ${a.walkCycleStyle}`);
        if (a.defaultPosture) aparts.push(`站姿 ${a.defaultPosture}`);
        if (a.cameraPreference) aparts.push(`鏡頭偏好 ${a.cameraPreference}`);
        if (a.squashStretch != null)
          aparts.push(`squash/stretch ${a.squashStretch}`);
        if (aparts.length) lines.push(`  · 演技：${aparts.join(" / ")}`);
        if (a.signatureGestures?.length)
          lines.push(`  · 招牌動作：${a.signatureGestures.join("、")}`);
        if (a.emotionalRange?.length)
          lines.push(`  · 情緒範圍：${a.emotionalRange.join("、")}`);
        if (a.vodirection) lines.push(`  · 配音指導：${a.vodirection}`);
      }
      if (c.lipSyncSet?.enabled) {
        lines.push(
          `  · 口型：${c.lipSyncSet.system ?? "preston_blair"} (${c.lipSyncSet.primaryLanguage ?? "—"})`
        );
      }
      if (c.ageVariants?.length) {
        lines.push(
          `  · 年齡變體：${c.ageVariants.map(v => v.name).join("、")}`
        );
      }
      if (c.soundProfile) {
        const sp = c.soundProfile;
        const has: string[] = [];
        if (sp.footsteps && Object.keys(sp.footsteps).length)
          has.push(`腳步聲(${Object.keys(sp.footsteps).length})`);
        if (sp.breathSample) has.push("呼吸");
        if (sp.laughSample) has.push("笑聲");
        if (sp.crySample) has.push("哭聲");
        if (sp.shoutSample) has.push("怒吼");
        if (sp.hurtSample) has.push("痛");
        if (has.length) lines.push(`  · 聲音檔：${has.join("、")}`);
      }
      if (c.referenceLibrary?.length)
        lines.push(`  · 參考圖：${c.referenceLibrary.length} 張`);
    }
  }

  // ─── 場景 ────────────────────────────────────────────────────────────────
  if (framework.scenes.length > 0) {
    lines.push("\n## 場景");
    for (const s of framework.scenes) {
      lines.push(`- ${s.name}${s.tagline ? `（${s.tagline}）` : ""}`);
      if (s.environment) lines.push(`  · 環境：${s.environment}`);
      if (s.lighting) lines.push(`  · 光線：${s.lighting}`);
      if (s.mood) lines.push(`  · 氛圍：${s.mood}`);
      if (s.flora?.length) lines.push(`  · 花草樹木：${s.flora.join("、")}`);
      if (s.fauna?.length) lines.push(`  · 生物：${s.fauna.join("、")}`);
      if (s.props?.length) lines.push(`  · 物件：${s.props.join("、")}`);
      if (s.environmentChanges?.length)
        lines.push(`  · 環境變化：${s.environmentChanges.join("；")}`);
      if (s.timeOfDay?.length)
        lines.push(
          `  · 時段表：${s.timeOfDay.map(t => t.label).join("、")}`
        );
      if (s.defaultCameraMovement)
        lines.push(`  · 預設運鏡：${s.defaultCameraMovement}`);
      if (s.preferredAspectRatio)
        lines.push(`  · 偏好構圖：${s.preferredAspectRatio}`);
      if (s.styleProfileId) {
        const sp = framework.styleProfiles?.find(
          p => p.id === s.styleProfileId
        );
        if (sp) lines.push(`  · 風格鎖：${sp.name}`);
      }
      if (s.musicThemeId) {
        const mt = framework.musicThemes?.find(
          p => p.id === s.musicThemeId
        );
        if (mt) lines.push(`  · 配樂鎖：${mt.name}`);
      }
      if (s.triggerWord) lines.push(`  · LoRA trigger：${s.triggerWord}`);

      // v3 專業欄位
      if (s.layout) {
        const l = s.layout;
        const lparts: string[] = [];
        if (l.heroShotAngle) lparts.push(`hero shot ${l.heroShotAngle}`);
        if (l.entryPoints?.length)
          lparts.push(`入口 ${l.entryPoints.join("、")}`);
        if (l.exitPoints?.length)
          lparts.push(`出口 ${l.exitPoints.join("、")}`);
        if (l.approxDimensions) {
          const d = l.approxDimensions;
          if (d.widthM || d.depthM || d.heightM)
            lparts.push(
              `尺度 ${d.widthM ?? "?"}×${d.depthM ?? "?"}×${d.heightM ?? "?"}m`
            );
        }
        if (lparts.length) lines.push(`  · Layout：${lparts.join(" / ")}`);
      }
      if (s.productionDesign) {
        const pd = s.productionDesign;
        const pdparts: string[] = [];
        if (pd.architecturalStyle) pdparts.push(pd.architecturalStyle);
        if (pd.materials?.length) pdparts.push(pd.materials.join("、"));
        if (pd.periodDetails) pdparts.push(pd.periodDetails);
        if (pdparts.length)
          lines.push(`  · Production design：${pdparts.join(" / ")}`);
        if (pd.colorScript) {
          const cs = pd.colorScript;
          const csparts: string[] = [];
          if (cs.keyColor) csparts.push(`key ${cs.keyColor}`);
          if (cs.midColor) csparts.push(`mid ${cs.midColor}`);
          if (cs.shadowColor) csparts.push(`shadow ${cs.shadowColor}`);
          if (csparts.length)
            lines.push(`  · Color script：${csparts.join(" / ")}`);
        }
      }
      if (s.atmospherics) {
        const at = s.atmospherics;
        const aparts: string[] = [];
        if (at.fogDensity != null) aparts.push(`霧 ${at.fogDensity}`);
        if (at.dustMotes) aparts.push("塵埃");
        if (at.lightShafts) aparts.push("光柱");
        if (at.precipitation && at.precipitation !== "none")
          aparts.push(at.precipitation);
        if (at.lightning) aparts.push("雷電");
        if (aparts.length) lines.push(`  · 大氣：${aparts.join("、")}`);
      }
      if (s.soundDesign) {
        const sd = s.soundDesign;
        const sdparts: string[] = [];
        if (sd.reverb) sdparts.push(`reverb ${sd.reverb}`);
        if (sd.ambientBedUrl) sdparts.push("環境音床");
        if (sd.signatureSfx?.length)
          sdparts.push(`signature sfx ×${sd.signatureSfx.length}`);
        if (sdparts.length) lines.push(`  · 音效：${sdparts.join(" / ")}`);
      }
    }
  }

  // ─── 全域物件 ────────────────────────────────────────────────────────────
  if (framework.objects && framework.objects.length > 0) {
    lines.push("\n## 全域物件");
    for (const o of framework.objects) {
      lines.push(`- ${o.name}${o.category ? `（${o.category}）` : ""}`);
      if (o.description) lines.push(`  · ${o.description}`);
    }
  }

  return lines.join("\n");
}

// ─── 動畫一致性 helpers ─────────────────────────────────────────────────────

/**
 * 為某個角色組合 AI 生成 prompt 的 "consistency prefix" —
 * 把三視圖、預設穿著、體型、LoRA trigger 等可控元素串成一段固定前綴，
 * 讓 t2i / i2v 生成時保持角色一致性。
 */
export function buildCharacterConsistencyPrompt(
  character: WorldCharacter,
  options?: { expressionId?: string; outfitId?: string }
): string {
  const parts: string[] = [];

  if (character.triggerWord) parts.push(character.triggerWord);
  if (character.name) parts.push(character.name);

  if (character.body) {
    const b = character.body;
    if (b.species) parts.push(b.species);
    if (b.ageStage) parts.push(b.ageStage);
    if (b.build) parts.push(b.build);
    if (b.distinctiveFeatures?.length)
      parts.push(...b.distinctiveFeatures);
  }
  if (character.appearance) parts.push(character.appearance);

  // 穿著（指定或預設）
  const outfit =
    (options?.outfitId &&
      character.outfits?.find(o => o.id === options.outfitId)) ||
    character.outfits?.find(o => o.isDefault) ||
    character.outfits?.[0];
  if (outfit) {
    if (outfit.triggerWord) parts.push(outfit.triggerWord);
    if (outfit.description) parts.push(outfit.description);
    if (outfit.palette?.length) parts.push(`配色 ${outfit.palette.join("/")}`);
  } else if (character.outfit) {
    parts.push(character.outfit);
  }

  // 表情
  if (options?.expressionId) {
    const expr = character.expressions?.find(
      e => e.id === options.expressionId
    );
    if (expr) {
      parts.push(`表情：${expr.name}`);
      if (expr.promptKeywords?.length) parts.push(...expr.promptKeywords);
    }
  }

  return parts.filter(Boolean).join(", ");
}

/**
 * 為某個場景組合 AI 生成 prompt 的 "consistency prefix" —
 * 含環境、光線、氛圍、風格鎖 trigger、運鏡。
 */
export function buildSceneConsistencyPrompt(
  scene: WorldScene,
  styleProfile?: WorldStyleProfile
): string {
  const parts: string[] = [];
  if (scene.triggerWord) parts.push(scene.triggerWord);
  if (scene.environment) parts.push(scene.environment);
  if (scene.lighting) parts.push(`光線：${scene.lighting}`);
  if (scene.mood) parts.push(`氛圍：${scene.mood}`);
  if (scene.props?.length) parts.push(`物件：${scene.props.join("、")}`);
  if (scene.defaultCameraMovement)
    parts.push(`運鏡：${scene.defaultCameraMovement}`);

  if (styleProfile) {
    if (styleProfile.triggerWord) parts.push(styleProfile.triggerWord);
    if (styleProfile.artStyle) parts.push(styleProfile.artStyle);
    if (styleProfile.lighting) parts.push(styleProfile.lighting);
    if (styleProfile.lensSpec?.aspectRatio)
      parts.push(`寬高比 ${styleProfile.lensSpec.aspectRatio}`);
  }

  return parts.filter(Boolean).join(", ");
}

/**
 * 把整個 framework 變成 negativePrompt 集合：
 * global + 預設 style profile 的 negative prompt。
 */
export function buildGlobalNegativePrompt(
  framework: WorldbuildingFrameworkData
): string {
  const parts: string[] = [];
  if (framework.globalNegativePrompt)
    parts.push(framework.globalNegativePrompt);
  const defaultProfile = framework.styleProfiles?.find(
    sp => sp.id === framework.defaultStyleProfileId
  );
  if (defaultProfile?.negativePrompt)
    parts.push(defaultProfile.negativePrompt);
  return parts.join(", ");
}
