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
  /** 製作目標：動畫類型 / 預期長度 / 受眾 */
  productionTargets?: {
    /** 動畫類型：短片 / 番劇 / MV / 廣告 / 教學 / 純插畫集 */
    format?: string;
    /** 目標時長（秒） */
    targetDurationSec?: number;
    /** 受眾：兒童 / 全年齡 / 青少年 / 成人 */
    audience?: string;
    /** 平台：YouTube / TikTok / 影展 / 內部 */
    platform?: string;
  };
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

// ─── Zod schemas（router 用） ───────────────────────────────────────────────

export const characterRoleSchema = z.enum([
  "protagonist",
  "supporting",
  "antagonist",
  "npc",
]);

export const characterThreeViewSheetSchema = z.object({
  frontImageUrl: z.string().url().max(2048).optional(),
  sideImageUrl: z.string().url().max(2048).optional(),
  backImageUrl: z.string().url().max(2048).optional(),
  threeQuarterImageUrl: z.string().url().max(2048).optional(),
  isComplete: z.boolean().optional(),
  referenceImageUrls: z.array(z.string().url().max(2048)).max(20).optional(),
  generationPrompt: z.string().max(2000).optional(),
});

export const characterExpressionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(64),
  description: z.string().max(500).optional(),
  imageUrl: z.string().url().max(2048).optional(),
  promptKeywords: z.array(z.string().max(64)).max(20).optional(),
  intensity: z.number().min(0).max(1).optional(),
  triggers: z.array(z.string().max(64)).max(20).optional(),
});

export const characterOutfitSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(128),
  description: z.string().max(1000).optional(),
  imageUrl: z.string().url().max(2048).optional(),
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
  sampleAudioUrl: z.string().url().max(2048).optional(),
  useClone: z.boolean().optional(),
  cloneSampleUrls: z.array(z.string().url().max(2048)).max(10).optional(),
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
  name: z.string().min(1).max(128),
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
  // 動畫擴充
  threeViewSheet: characterThreeViewSheetSchema.optional(),
  expressions: z.array(characterExpressionSchema).max(50).optional(),
  outfits: z.array(characterOutfitSchema).max(30).optional(),
  speechTone: characterSpeechToneSchema.optional(),
  voiceProfile: characterVoiceProfileSchema.optional(),
  scriptRole: characterScriptRoleSchema.optional(),
  body: characterBodySchema.optional(),
});

export const sceneTimeOfDaySchema = z.object({
  label: z.string().min(1).max(32),
  lighting: z.string().max(500).optional(),
  palette: z.array(z.string().max(64)).max(12).optional(),
  imageUrl: z.string().url().max(2048).optional(),
});

export const worldSceneSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(128),
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
  // 動畫擴充
  establishingShotUrl: z.string().url().max(2048).optional(),
  timeOfDay: z.array(sceneTimeOfDaySchema).max(12).optional(),
  styleProfileId: z.string().max(64).nullable().optional(),
  musicThemeId: z.string().max(64).nullable().optional(),
  defaultCameraMovement: z.string().max(64).optional(),
  preferredAspectRatio: z.string().max(16).optional(),
});

export const worldStyleProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(128),
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
  referenceImageUrls: z.array(z.string().url().max(2048)).max(20).optional(),
  triggerWord: z.string().max(128).optional(),
  negativePrompt: z.string().max(1000).optional(),
  linkedModelId: z.number().int().positive().nullable().optional(),
  description: z.string().max(2000).optional(),
});

export const worldMusicThemeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(128),
  mood: z.string().max(64).optional(),
  instruments: z.array(z.string().max(64)).max(20).optional(),
  bpm: z.number().int().min(20).max(400).optional(),
  timeSignature: z.string().max(16).optional(),
  key: z.string().max(64).optional(),
  applicableSceneIds: z.array(z.string().max(64)).max(100).optional(),
  applicableCharacterIds: z.array(z.string().max(64)).max(100).optional(),
  promptKeywords: z.array(z.string().max(64)).max(20).optional(),
  sampleAudioUrl: z.string().url().max(2048).optional(),
  description: z.string().max(1000).optional(),
});

export const worldObjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(128),
  category: z.string().max(64).optional(),
  description: z.string().max(2000).optional(),
  visualTraits: z.string().max(1000).optional(),
  appearsInScenes: z.array(z.string()).max(100).optional(),
  notes: z.string().max(1000).optional(),
});

export const worldbuildingFrameworkInputSchema = z.object({
  name: z.string().min(1).max(255),
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
  productionTargets: z
    .object({
      format: z.string().max(64).optional(),
      targetDurationSec: z.number().int().min(1).max(60 * 60 * 6).optional(),
      audience: z.string().max(64).optional(),
      platform: z.string().max(64).optional(),
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
    if (tparts.length) lines.push(`製作目標：${tparts.join(" · ")}`);
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
