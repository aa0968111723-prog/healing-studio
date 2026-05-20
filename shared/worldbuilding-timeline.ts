/**
 * shared/worldbuilding-timeline.ts
 *
 * Timeline Frame Upload & Consistency Checking Types
 *
 * 用於實現時間軸圖幀上傳與一致性檢查系統
 */

import { z } from "zod";

// ─── Timeline Frame Upload ──────────────────────────────────────────────────

/**
 * 時間軸上傳的圖幀
 * 用於與腳本分鏡同步，並進行一致性檢查
 */
export type TimelineFrame = {
  id?: number;
  /** 關聯的 storyboard ID */
  storyboardId: number;
  /** 關聯的 scene ID (from storyboard) */
  sceneId: string;
  /** 上傳者 ID */
  userId: number;
  /** 圖幀在場景中的時間點（秒） */
  timeOffsetSec: number;
  /** 上傳的圖像 URL */
  imageUrl: string;
  /** 圖像類型（關鍵幀、設定稿、參考圖等） */
  frameType: "keyframe" | "concept_art" | "reference" | "storyboard_sketch" | "final_render";
  /** 標題/描述 */
  title?: string;
  /** 詳細說明 */
  description?: string;
  /** 標籤 */
  tags?: string[];
  /** 一致性檢查結果 */
  consistencyCheck?: ConsistencyCheckResult;
  /** 上傳時間 */
  uploadedAt: Date;
  /** 更新時間 */
  updatedAt: Date;
};

/**
 * 一致性檢查結果
 */
export type ConsistencyCheckResult = {
  /** 檢查時間 */
  checkedAt: Date;
  /** 總體一致性分數 (0-100) */
  overallScore: number;
  /** 角色一致性 */
  characterConsistency: ConsistencyItem[];
  /** 場景一致性 */
  sceneConsistency: ConsistencyItem[];
  /** 風格一致性 */
  styleConsistency: ConsistencyItem[];
  /** 問題與建議 */
  issues: ConsistencyIssue[];
  /** AI 生成的建議 */
  suggestions?: string[];
};

/**
 * 單項一致性檢查
 */
export type ConsistencyItem = {
  /** 檢查項目名稱 */
  name: string;
  /** 得分 (0-100) */
  score: number;
  /** 詳細說明 */
  details: string;
  /** 參考圖像 URL（用於比對的參考圖） */
  referenceUrls?: string[];
};

/**
 * 一致性問題
 */
export type ConsistencyIssue = {
  /** 嚴重程度 */
  severity: "critical" | "warning" | "info";
  /** 問題類別 */
  category: "character" | "scene" | "style" | "technical";
  /** 問題描述 */
  message: string;
  /** 建議的修正方法 */
  suggestedFix?: string;
};

// ─── Zod Schemas ────────────────────────────────────────────────────────────

export const timelineFrameInputSchema = z.object({
  storyboardId: z.number().int().positive(),
  sceneId: z.string().min(1).max(64),
  timeOffsetSec: z.number().min(0),
  imageUrl: z.string().url().max(2048),
  frameType: z.enum(["keyframe", "concept_art", "reference", "storyboard_sketch", "final_render"]),
  title: z.string().max(255).optional(),
  description: z.string().max(2000).optional(),
  tags: z.array(z.string().max(64)).max(20).optional(),
});

export type TimelineFrameInput = z.infer<typeof timelineFrameInputSchema>;

export const consistencyCheckRequestSchema = z.object({
  timelineFrameId: z.number().int().positive(),
  checkTypes: z.array(z.enum(["character", "scene", "style"])).optional(),
});

export type ConsistencyCheckRequest = z.infer<typeof consistencyCheckRequestSchema>;

// ─── Multi-Character/Scene Composition ─────────────────────────────────────

/**
 * 多角色多場景合成配置
 */
export type SceneComposition = {
  id?: number;
  /** 關聯的 worldbuilding framework ID */
  worldId: number;
  /** 關聯的 storyboard ID (optional) */
  storyboardId?: number;
  /** 合成名稱 */
  name: string;
  /** 合成描述 */
  description?: string;
  /** Canvas 寬度 */
  canvasWidth: number;
  /** Canvas 高度 */
  canvasHeight: number;
  /** 背景場景 ID */
  backgroundSceneId?: string;
  /** 背景圖像 URL */
  backgroundImageUrl?: string;
  /** 合成元素（角色、道具等） */
  elements: CompositionElement[];
  /** AI 生成的構圖建議 */
  aiSuggestions?: CompositionSuggestion[];
  /** 創建者 ID */
  userId: number;
  /** 創建時間 */
  createdAt: Date;
  /** 更新時間 */
  updatedAt: Date;
};

/**
 * 合成元素（角色、道具等）
 */
export type CompositionElement = {
  id: string;
  /** 元素類型 */
  type: "character" | "object" | "effect" | "text";
  /** 角色 ID (when type=character) */
  characterId?: string;
  /** 物件 ID (when type=object) */
  objectId?: string;
  /** 圖像 URL */
  imageUrl?: string;
  /** 位置 */
  position: { x: number; y: number };
  /** 大小 */
  size: { width: number; height: number };
  /** 旋轉角度（度數） */
  rotation?: number;
  /** 不透明度 (0-1) */
  opacity?: number;
  /** z-index (層級) */
  zIndex: number;
  /** 角色表情 ID */
  expressionId?: string;
  /** 角色服裝 ID */
  outfitId?: string;
  /** 姿勢描述 */
  pose?: string;
  /** 額外樣式 */
  style?: Record<string, unknown>;
};

/**
 * AI 構圖建議
 */
export type CompositionSuggestion = {
  /** 建議類型 */
  type: "layout" | "balance" | "focus" | "depth" | "color_harmony";
  /** 建議標題 */
  title: string;
  /** 建議內容 */
  content: string;
  /** 建議的修改（可選，JSON path + value） */
  suggestedChanges?: Array<{
    elementId: string;
    property: string;
    value: unknown;
  }>;
  /** 參考圖例 URL */
  referenceUrls?: string[];
};

// ─── Zod Schemas ────────────────────────────────────────────────────────────

export const compositionElementSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["character", "object", "effect", "text"]),
  characterId: z.string().max(64).optional(),
  objectId: z.string().max(64).optional(),
  imageUrl: z.string().url().max(2048).optional(),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  size: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
  }),
  rotation: z.number().optional(),
  opacity: z.number().min(0).max(1).optional(),
  zIndex: z.number().int(),
  expressionId: z.string().max(64).optional(),
  outfitId: z.string().max(64).optional(),
  pose: z.string().max(500).optional(),
  style: z.record(z.unknown()).optional(),
});

export const sceneCompositionInputSchema = z.object({
  worldId: z.number().int().positive(),
  storyboardId: z.number().int().positive().optional(),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  canvasWidth: z.number().int().positive().max(8192),
  canvasHeight: z.number().int().positive().max(8192),
  backgroundSceneId: z.string().max(64).optional(),
  backgroundImageUrl: z.string().url().max(2048).optional(),
  elements: z.array(compositionElementSchema).max(50),
});

export type SceneCompositionInput = z.infer<typeof sceneCompositionInputSchema>;

export const compositionSuggestionRequestSchema = z.object({
  compositionId: z.number().int().positive().optional(),
  worldId: z.number().int().positive(),
  elements: z.array(compositionElementSchema).max(50),
  backgroundSceneId: z.string().max(64).optional(),
  focusGoal: z.enum(["balance", "depth", "drama", "harmony", "dynamic"]).optional(),
});

export type CompositionSuggestionRequest = z.infer<typeof compositionSuggestionRequestSchema>;
