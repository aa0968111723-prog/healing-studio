/**
 * Real Earth Information System Types
 *
 * 真實地球資訊系統 —— 提供真實歷史、文化、人文、環境資料查驗
 * 特別深化台灣相關資訊，方便使用者研究與撰寫腳本
 *
 * 用途：
 * 1. 劇本創作時查證真實背景
 * 2. 美術設計時參考真實地點、建築、服飾
 * 3. 配音時參考真實口音、方言
 * 4. AI 代理查詢真實世界資訊
 * 5. 世界觀系統引用真實參考資料
 */

import { z } from "zod";

// ─── 地理區域分類 ───────────────────────────────────────────────────────────

export const TAIWAN_REGIONS = [
  "台北市",
  "新北市",
  "桃園市",
  "台中市",
  "台南市",
  "高雄市",
  "基隆市",
  "新竹市",
  "新竹縣",
  "苗栗縣",
  "彰化縣",
  "南投縣",
  "雲林縣",
  "嘉義市",
  "嘉義縣",
  "屏東縣",
  "宜蘭縣",
  "花蓮縣",
  "台東縣",
  "澎湖縣",
  "金門縣",
  "連江縣",
] as const;

export const GLOBAL_REGIONS = [
  "東亞",
  "東南亞",
  "南亞",
  "中亞",
  "西亞",
  "歐洲",
  "北美洲",
  "南美洲",
  "非洲",
  "大洋洲",
  "極地",
] as const;

export type TaiwanRegion = typeof TAIWAN_REGIONS[number];
export type GlobalRegion = typeof GLOBAL_REGIONS[number];

// ─── 歷史時期分類 ───────────────────────────────────────────────────────────

export const TAIWAN_HISTORICAL_PERIODS = [
  "史前時期",
  "荷西時期（1624-1662）",
  "鄭氏時期（1662-1683）",
  "清治時期（1683-1895）",
  "日治時期（1895-1945）",
  "戰後時期（1945-1987）",
  "解嚴後（1987-2000）",
  "現代（2000-至今）",
] as const;

export const GLOBAL_HISTORICAL_PERIODS = [
  "史前時代",
  "古代文明（前3000-前500）",
  "古典時期（前500-500）",
  "中世紀（500-1500）",
  "文藝復興（1400-1600）",
  "啟蒙時代（1600-1800）",
  "工業革命（1760-1840）",
  "現代早期（1800-1945）",
  "當代（1945-至今）",
] as const;

export type TaiwanHistoricalPeriod = typeof TAIWAN_HISTORICAL_PERIODS[number];
export type GlobalHistoricalPeriod = typeof GLOBAL_HISTORICAL_PERIODS[number];

// ─── 資料類別 ───────────────────────────────────────────────────────────────

export type RealEarthCategory =
  | "history"          // 歷史事件、人物、文獻
  | "culture"          // 文化習俗、節慶、傳統
  | "geography"        // 地理位置、地形、氣候
  | "architecture"     // 建築、地標、遺跡
  | "language"         // 語言、方言、文字
  | "cuisine"          // 飲食、料理、食材
  | "clothing"         // 服飾、配飾、織品
  | "art"             // 藝術、工藝、表演
  | "religion"         // 宗教、信仰、儀式
  | "society"          // 社會結構、制度、習慣
  | "economy"          // 經濟、產業、貿易
  | "politics"         // 政治、法律、制度
  | "military"         // 軍事、武器、戰爭
  | "technology"       // 科技、發明、工具
  | "nature"           // 自然環境、生態、物種
  | "folklore"         // 民俗、傳說、故事
  | "education"        // 教育、學術、文獻
  | "entertainment"    // 娛樂、遊戲、運動
  | "transportation"   // 交通、運輸、道路
  | "people"           // 人物、族群、社群
;

export const CATEGORY_LABELS: Record<RealEarthCategory, string> = {
  history: "歷史",
  culture: "文化",
  geography: "地理",
  architecture: "建築",
  language: "語言",
  cuisine: "飲食",
  clothing: "服飾",
  art: "藝術",
  religion: "宗教",
  society: "社會",
  economy: "經濟",
  politics: "政治",
  military: "軍事",
  technology: "科技",
  nature: "自然",
  folklore: "民俗傳說",
  education: "教育",
  entertainment: "娛樂",
  transportation: "交通",
  people: "人物",
};

// ─── 真實地球資料條目 ──────────────────────────────────────────────────────

/**
 * 真實地球資料條目 —— 可查證的真實世界資訊
 */
export type RealEarthEntry = {
  id: string;
  /** 條目標題 */
  title: string;
  /** 資料類別 */
  category: RealEarthCategory;
  /** 簡短描述（1-2 句話） */
  summary: string;
  /** 詳細內容（支援 markdown） */
  content: string;

  /** 地理位置 */
  location?: {
    /** 台灣區域或全球區域 */
    region?: TaiwanRegion | GlobalRegion | string;
    /** GPS 座標 */
    gpsCoords?: { lat: number; lon: number };
    /** 地址 */
    address?: string;
  };

  /** 歷史時期 */
  historicalPeriod?: TaiwanHistoricalPeriod | GlobalHistoricalPeriod | string;

  /** 年份或年代範圍 */
  yearRange?: {
    start?: number;  // 可為負數（BCE）
    end?: number;
  };

  /** 參考圖片 URL 列表 */
  imageUrls?: string[];

  /** 外部連結 */
  externalLinks?: Array<{
    label: string;
    url: string;
    type?: "wikipedia" | "official" | "museum" | "academic" | "video" | "other";
  }>;

  /** 學術引用 */
  citations?: Array<{
    author?: string;
    title: string;
    source: string;
    year?: number;
    url?: string;
  }>;

  /** 標籤 */
  tags?: string[];

  /** 相關條目 ID */
  relatedEntryIds?: string[];

  /** 資料品質標記 */
  quality?: {
    /** 可信度：low / medium / high / verified */
    credibility: "low" | "medium" | "high" | "verified";
    /** 資料來源類型 */
    sourceType?: "academic" | "government" | "museum" | "encyclopedia" | "community" | "other";
    /** 最後驗證日期 */
    lastVerified?: string;
  };

  /** 是否為台灣重點資料 */
  isTaiwanFocused?: boolean;

  /** 資料語言 */
  language?: "zh-TW" | "zh-CN" | "en" | "ja" | "other";

  /** 額外後設資料（JSON） */
  metadata?: Record<string, any>;

  /** 建立者 ID */
  createdBy?: number;

  /** 建立時間 */
  createdAt?: Date;

  /** 更新時間 */
  updatedAt?: Date;
};

// ─── Zod Schemas ────────────────────────────────────────────────────────────

const gpsCoordinatesSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

const locationSchema = z.object({
  region: z.string().optional(),
  gpsCoords: gpsCoordinatesSchema.optional(),
  address: z.string().max(500).optional(),
}).optional();

const yearRangeSchema = z.object({
  start: z.number().int().optional(),
  end: z.number().int().optional(),
}).optional();

const externalLinkSchema = z.object({
  label: z.string().max(200),
  url: z.string().url().max(2048),
  type: z.enum(["wikipedia", "official", "museum", "academic", "video", "other"]).optional(),
});

const citationSchema = z.object({
  author: z.string().max(200).optional(),
  title: z.string().max(500),
  source: z.string().max(500),
  year: z.number().int().min(0).max(9999).optional(),
  url: z.string().url().max(2048).optional(),
});

const qualitySchema = z.object({
  credibility: z.enum(["low", "medium", "high", "verified"]),
  sourceType: z.enum(["academic", "government", "museum", "encyclopedia", "community", "other"]).optional(),
  lastVerified: z.string().optional(),
}).optional();

export const realEarthEntryInputSchema = z.object({
  title: z.string().min(1).max(500),
  category: z.enum([
    "history", "culture", "geography", "architecture", "language",
    "cuisine", "clothing", "art", "religion", "society",
    "economy", "politics", "military", "technology", "nature",
    "folklore", "education", "entertainment", "transportation", "people",
  ]),
  summary: z.string().min(1).max(1000),
  content: z.string().min(1).max(50000),
  location: locationSchema,
  historicalPeriod: z.string().max(200).optional(),
  yearRange: yearRangeSchema,
  imageUrls: z.array(z.string().url().max(2048)).optional(),
  externalLinks: z.array(externalLinkSchema).optional(),
  citations: z.array(citationSchema).optional(),
  tags: z.array(z.string().max(100)).max(50).optional(),
  relatedEntryIds: z.array(z.string().max(100)).optional(),
  quality: qualitySchema,
  isTaiwanFocused: z.boolean().optional(),
  language: z.enum(["zh-TW", "zh-CN", "en", "ja", "other"]).optional(),
  metadata: z.record(z.any()).optional(),
});

export type RealEarthEntryInput = z.infer<typeof realEarthEntryInputSchema>;

// ─── 搜尋與查詢 ─────────────────────────────────────────────────────────────

export const realEarthSearchSchema = z.object({
  /** 搜尋關鍵字 */
  query: z.string().max(500).optional(),
  /** 資料類別篩選 */
  categories: z.array(z.string()).optional(),
  /** 地理區域篩選 */
  regions: z.array(z.string()).optional(),
  /** 歷史時期篩選 */
  historicalPeriods: z.array(z.string()).optional(),
  /** 年份範圍篩選 */
  yearRange: yearRangeSchema,
  /** 標籤篩選 */
  tags: z.array(z.string()).optional(),
  /** 只顯示台灣重點資料 */
  taiwanOnly: z.boolean().optional(),
  /** 可信度門檻 */
  minCredibility: z.enum(["low", "medium", "high", "verified"]).optional(),
  /** 排序方式 */
  sortBy: z.enum(["relevance", "date_desc", "date_asc", "title", "credibility"]).optional(),
  /** 分頁：頁碼 */
  page: z.number().int().min(1).optional(),
  /** 分頁：每頁筆數 */
  perPage: z.number().int().min(1).max(100).optional(),
});

export type RealEarthSearchParams = z.infer<typeof realEarthSearchSchema>;

export type RealEarthSearchResult = {
  entries: RealEarthEntry[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
};

// ─── 預設台灣重點資料範本 ───────────────────────────────────────────────────

/**
 * 台灣重點資料範本 —— 方便快速建立常用的台灣相關條目
 */
export const TAIWAN_TEMPLATE_CATEGORIES = [
  "原住民族",
  "台灣歷史",
  "傳統建築",
  "台灣小吃",
  "節慶習俗",
  "地方方言",
  "台灣地理",
  "傳統工藝",
  "民間信仰",
  "歷史人物",
] as const;

export type TaiwanTemplateCategory = typeof TAIWAN_TEMPLATE_CATEGORIES[number];

/**
 * 預設台灣資料模板
 */
export type TaiwanDataTemplate = {
  category: TaiwanTemplateCategory;
  suggestedTags: string[];
  contentTemplate: string;
  exampleEntries: string[];
};

export const TAIWAN_DATA_TEMPLATES: Record<TaiwanTemplateCategory, TaiwanDataTemplate> = {
  "原住民族": {
    category: "原住民族",
    suggestedTags: ["原住民", "族群", "文化", "語言", "傳統"],
    contentTemplate: "## 族群概述\n\n## 歷史\n\n## 文化特色\n\n## 語言\n\n## 傳統習俗\n\n## 當代發展",
    exampleEntries: ["阿美族", "泰雅族", "排灣族", "布農族", "卑南族", "魯凱族"],
  },
  "台灣歷史": {
    category: "台灣歷史",
    suggestedTags: ["歷史", "事件", "時期", "發展"],
    contentTemplate: "## 事件概述\n\n## 背景\n\n## 經過\n\n## 影響\n\n## 相關人物\n\n## 歷史意義",
    exampleEntries: ["霧社事件", "二二八事件", "美麗島事件", "解嚴"],
  },
  "傳統建築": {
    category: "傳統建築",
    suggestedTags: ["建築", "古蹟", "傳統", "文化資產"],
    contentTemplate: "## 建築概述\n\n## 歷史背景\n\n## 建築特色\n\n## 空間配置\n\n## 裝飾藝術\n\n## 保存現況",
    exampleEntries: ["三合院", "閩南建築", "客家圍屋", "原住民石板屋"],
  },
  "台灣小吃": {
    category: "台灣小吃",
    suggestedTags: ["美食", "小吃", "料理", "飲食文化"],
    contentTemplate: "## 料理介紹\n\n## 起源與歷史\n\n## 製作方式\n\n## 食材特色\n\n## 地方變化\n\n## 文化意義",
    exampleEntries: ["牛肉麵", "珍珠奶茶", "臭豆腐", "滷肉飯", "蚵仔煎"],
  },
  "節慶習俗": {
    category: "節慶習俗",
    suggestedTags: ["節慶", "習俗", "傳統", "慶典"],
    contentTemplate: "## 節慶概述\n\n## 起源與歷史\n\n## 慶祝方式\n\n## 相關習俗\n\n## 地方特色\n\n## 現代演變",
    exampleEntries: ["媽祖遶境", "中元普渡", "端午龍舟", "元宵燈會"],
  },
  "地方方言": {
    category: "地方方言",
    suggestedTags: ["語言", "方言", "閩南語", "客語", "原住民語"],
    contentTemplate: "## 語言概述\n\n## 使用區域\n\n## 語音特色\n\n## 詞彙特點\n\n## 常用語句\n\n## 保存現況",
    exampleEntries: ["台灣閩南語", "客家話", "台灣原住民語"],
  },
  "台灣地理": {
    category: "台灣地理",
    suggestedTags: ["地理", "地形", "自然", "景觀"],
    contentTemplate: "## 地理概述\n\n## 地形特色\n\n## 氣候環境\n\n## 生態系統\n\n## 人文地理\n\n## 觀光價值",
    exampleEntries: ["中央山脈", "日月潭", "太魯閣", "阿里山", "墾丁"],
  },
  "傳統工藝": {
    category: "傳統工藝",
    suggestedTags: ["工藝", "技藝", "傳統", "文化"],
    contentTemplate: "## 工藝介紹\n\n## 歷史源流\n\n## 製作技法\n\n## 材料工具\n\n## 代表作品\n\n## 傳承現況",
    exampleEntries: ["陶瓷工藝", "竹編", "木雕", "刺繡", "漆器"],
  },
  "民間信仰": {
    category: "民間信仰",
    suggestedTags: ["信仰", "宗教", "廟宇", "民俗"],
    contentTemplate: "## 信仰概述\n\n## 歷史淵源\n\n## 信仰內涵\n\n## 祭祀儀式\n\n## 重要廟宇\n\n## 文化影響",
    exampleEntries: ["媽祖信仰", "城隍爺", "土地公", "王爺信仰"],
  },
  "歷史人物": {
    category: "歷史人物",
    suggestedTags: ["人物", "歷史", "名人"],
    contentTemplate: "## 人物簡介\n\n## 生平事蹟\n\n## 重要貢獻\n\n## 歷史評價\n\n## 相關遺跡\n\n## 文化影響",
    exampleEntries: ["鄭成功", "劉銘傳", "蔣渭水", "賴和"],
  },
};
