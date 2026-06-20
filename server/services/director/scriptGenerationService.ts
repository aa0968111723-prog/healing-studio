/**
 * Video Script Generation Service — Phase 2 of Creative Project Integration
 * ────────────────────────────────────────────────────────────────────────────
 * Generates a structured video script (segments) from a brief description
 * instead of parsing an existing long-form script. The output shape is
 * identical to parseScriptIntoSegments() so downstream consumers (segment
 * editor, CO-STAR generator, animation pipeline) can treat both flows
 * interchangeably.
 *
 * Video type drives:
 *   - target segment count / duration ranges
 *   - tone / pacing guidance
 *   - whether dialogue or narration is primary
 *
 * Worldbuilding context, when supplied, is inserted as the FIRST system
 * message block so character names, scene constraints, and global style
 * cues land before the per-type instructions.
 */

import { invokeLLM } from "../../_core/llm";
import type { ScriptSegment } from "../../../shared/types";
import {
  guardRetrievedContext,
  isRagInjectionGuardEnabled,
} from "../security/ragInjectionGuard";
import { DIRECTOR_PERSONALITY_PROMPTS } from "./personality";
import { withTimeout, extractMessageJson } from "./templates";

export const VIDEO_SCRIPT_TYPES = [
  "short_video",
  "long_video",
  "social",
  "animation",
  "deep_discussion",
] as const;

export type VideoScriptType = (typeof VIDEO_SCRIPT_TYPES)[number];

interface VideoTypeProfile {
  /** Display label for UI */
  label: string;
  /** Inline guidance injected into the LLM prompt */
  guidance: string;
  /** Default target segment count */
  defaultSegmentCount: number;
  /** Default total duration in seconds */
  defaultTotalDurationSec: number;
}

export const VIDEO_TYPE_PROFILES: Record<VideoScriptType, VideoTypeProfile> = {
  short_video: {
    label: "短影片",
    guidance: `針對 30-60 秒短影片 (TikTok / Reels / YouTube Shorts) 優化：
- 開頭 3 秒必須抓住注意力（hook 強烈、視覺衝擊）
- 節奏緊湊，每段 5-15 秒，避免拖戲
- 1-2 個明確的轉折或反差
- 結尾留 CTA 或意外感
- 對白簡短直接，旁白優先用第二人稱`,
    defaultSegmentCount: 4,
    defaultTotalDurationSec: 45,
  },
  long_video: {
    label: "長影片",
    guidance: `針對 3-15 分鐘長影片 (YouTube 主頻道) 優化：
- 完整的開場-發展-高潮-結尾結構
- 每段 30-90 秒，允許場景與情緒鋪陳
- 包含 b-roll、過場、章節標記
- 適合教學、紀錄片、深度故事`,
    defaultSegmentCount: 8,
    defaultTotalDurationSec: 360,
  },
  social: {
    label: "社群影片",
    guidance: `針對社群平台分享 (Instagram / Facebook / Threads) 優化：
- 9:16 直式為主，可考慮 1:1
- 前 5 秒必須在無聲狀態下也能理解（字幕 / 視覺語言）
- 段落短促，3-5 段為主
- 情緒主導，視覺先於文字
- 結尾留互動鉤子（提問 / 共鳴）`,
    defaultSegmentCount: 5,
    defaultTotalDurationSec: 60,
  },
  animation: {
    label: "動畫世界觀",
    guidance: `針對動畫短片 / 世界觀建構 (MV / 預告 / 番劇短篇) 優化：
- 場景與角色一致性是首要——每段必須明確標註出現的角色與場景
- 鏡頭運動需具體（推 / 拉 / 環繞 / 跟拍 / dolly zoom）
- 氛圍主導，音樂與環境音是敘事一部分
- 允許 8-15 段的多場景過渡
- 對白可選；旁白 / 內心獨白優先`,
    defaultSegmentCount: 10,
    defaultTotalDurationSec: 180,
  },
  deep_discussion: {
    label: "深度討論",
    guidance: `針對深度討論 / 訪談 / 知識內容 (Podcast 視覺化 / 講座) 優化：
- 結構清晰：論點 → 例證 → 反例 → 結論
- 段落較長（60-180 秒），允許論述發展
- 視覺以人物特寫 + 動態圖表為主
- 對白為主，每段需有清晰的論述要點
- 留適合插入字幕 / 動畫圖解的段落`,
    defaultSegmentCount: 6,
    defaultTotalDurationSec: 600,
  },
};

export interface GenerateVideoScriptInput {
  brief: string;
  type: VideoScriptType;
  /** Target total duration override (seconds) */
  targetDurationSec?: number;
  /** Target segment count override */
  targetSegmentCount?: number;
  /** Optional worldbuilding summary (from worldbuilding.summarizeForPrompt) */
  worldContext?: string;
  /** Optional reference media URLs (image / video) for style anchoring */
  referenceMediaUrls?: string[];
  /** Personality preset */
  personality: "calm" | "creative" | "technical";
  brainConfig?: {
    model: string;
    temperature: number;
    topP: number;
    systemPrompt: string | null;
  };
}

export async function generateVideoScriptFromBrief(
  input: GenerateVideoScriptInput
): Promise<Omit<ScriptSegment, "discussion" | "status">[]> {
  const profile = VIDEO_TYPE_PROFILES[input.type];
  const persona =
    DIRECTOR_PERSONALITY_PROMPTS[input.personality] ??
    DIRECTOR_PERSONALITY_PROMPTS.creative;

  const targetCount =
    input.targetSegmentCount ?? profile.defaultSegmentCount;
  const targetDuration =
    input.targetDurationSec ?? profile.defaultTotalDurationSec;
  const avgSegmentSec = Math.max(2, Math.round(targetDuration / targetCount));

  // AIDV-69：world context（使用者自填世界觀、untrusted）旗標 ON 時先過
  // guard 包裹；旗標 OFF＝注入內容與現狀位元相同。
  const trimmedWorld = input.worldContext?.trim();
  const guardedWorld = trimmedWorld
    ? isRagInjectionGuardEnabled()
      ? guardRetrievedContext(trimmedWorld, { label: "世界觀資料" })
      : trimmedWorld
    : undefined;
  const worldBlock = guardedWorld
    ? `\n\n【當前世界觀（請優先遵循其角色 / 場景 / 風格設定）】\n${guardedWorld}`
    : "";

  const referenceBlock =
    input.referenceMediaUrls && input.referenceMediaUrls.length > 0
      ? `\n\n【參考素材】使用者附上了 ${input.referenceMediaUrls.length} 則視覺參考，請從以下 URL 推測風格 / 構圖 / 色調並融入：\n${input.referenceMediaUrls
          .slice(0, 6)
          .map((u, i) => `${i + 1}. ${u}`)
          .join("\n")}`
      : "";

  const result = await withTimeout(
    invokeLLM({
      runName: `director-generate-${input.type}-script`,
      model: input.brainConfig?.model,
      temperature: input.brainConfig?.temperature,
      topP: input.brainConfig?.topP,
      systemPrompt: input.brainConfig?.systemPrompt,
      messages: [
        {
          role: "system",
          content: `${persona.directorStyle}

你是一位專業的影片導演與編劇。使用者會給你一個 brief（創作概念），你要幫他從零生成一份完整的影片分鏡腳本。

【目標類型：${profile.label}】
${profile.guidance}

【本次目標】
- 目標總時長：約 ${targetDuration} 秒
- 目標段落數：${targetCount} 段
- 每段平均約 ${avgSegmentSec} 秒（可依場景需求微調）
${worldBlock}${referenceBlock}

【每段必須包含】
- sceneHeading: 場景標題（INT/EXT - 地點 - 時間，或自擬精準場景名）
- visualDescription: 詳細視覺描述（畫面內容、光影、構圖、色調）
- dialogue: 對白或旁白（多角色用「角色名：對白」格式；無對白時填「（無對白）」）
- soundDesign: 音效 / 環境音 / 配樂風格描述
- cameraDirection: 鏡頭運動與景別（必填，越具體越好）
- duration: 預估時長（如「8秒」「45秒」）
- mood: 情緒氛圍（2-3 個關鍵詞）
- rawText: 這段對應的簡述（可從 brief 與生成內容綜合）
- characters: 這段出現的角色名稱陣列（若有世界觀就引用其角色名）
- locations: 場景地點陣列

【輸出格式】JSON 物件，鍵為 segments，值為段落陣列。確保所有欄位填寫完整。`,
        },
        {
          role: "user",
          content: `請依照以下 brief 生成 ${profile.label} 的分鏡腳本：\n\n${input.brief}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "video_script_segments",
          strict: true,
          schema: {
            type: "object",
            properties: {
              segments: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    sceneHeading: { type: "string" },
                    visualDescription: { type: "string" },
                    dialogue: { type: "string" },
                    soundDesign: { type: "string" },
                    cameraDirection: { type: "string" },
                    duration: { type: "string" },
                    mood: { type: "string" },
                    rawText: { type: "string" },
                    characters: {
                      type: "array",
                      items: { type: "string" },
                    },
                    locations: {
                      type: "array",
                      items: { type: "string" },
                    },
                  },
                  required: [
                    "sceneHeading",
                    "visualDescription",
                    "dialogue",
                    "soundDesign",
                    "cameraDirection",
                    "duration",
                    "mood",
                    "rawText",
                    "characters",
                    "locations",
                  ],
                  additionalProperties: false,
                },
              },
            },
            required: ["segments"],
            additionalProperties: false,
          },
        },
      },
      maxTokens: 8192,
    }),
    120_000,
    `${profile.label}腳本生成`
  );

  const extracted = extractMessageJson(result.choices[0]?.message?.content);
  const parsed: {
    segments: Array<{
      sceneHeading: string;
      visualDescription: string;
      dialogue: string;
      soundDesign: string;
      cameraDirection: string;
      duration: string;
      mood: string;
      rawText: string;
      characters: string[];
      locations: string[];
    }>;
  } =
    extracted && typeof extracted === "object"
      ? (extracted as never)
      : { segments: [] };

  const segments = parsed.segments ?? [];

  return segments.map((seg, idx) => ({
    id: `gen-${Date.now()}-${idx}`,
    index: idx,
    rawText: seg.rawText || `段落 ${idx + 1}`,
    storyboard: {
      sceneHeading: seg.sceneHeading,
      visualDescription: seg.visualDescription,
      dialogue: seg.dialogue,
      soundDesign: seg.soundDesign,
      cameraDirection: seg.cameraDirection,
      duration: seg.duration,
      mood: seg.mood,
    },
    characters: seg.characters ?? [],
    locations: seg.locations ?? [],
  }));
}
