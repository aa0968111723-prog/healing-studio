/**
 * Director AI Router
 * ────────────────────────────────────────────────────────────────────────────
 * CO-STAR 導演 AI 協作路由 — 雙引擎 RAG（事實研究 + 創意編排）
 *
 * 功能：
 *   - 人格化聊天（沉穩 / 創意 / 技術）
 *   - RAG 記憶注入（利用用戶歷史偏好）
 *   - 對話 session 持久化（localStorage 為主，server 端筆記備份）
 *   - 預設模板庫
 *   - 偏好設定 CRUD
 *   - 長腳本匯入、分鏡分析、逐段多模態討論
 *   - 腳本匯出（JSON / CSV / Markdown / FDX / SRT / 自訂格式）
 */

import { z } from "zod";
import { gzipSync, gunzipSync } from "node:zlib";
import { router, brainProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { invokeLLM, extractMessageText } from "../_core/llm";
import * as db from "../db";
import { buildMemoryContext } from "../services/ragMemory";
import {
  parseLLMActions,
  type AgentAction,
} from "../../shared/agent-actions";
import { extractJsonObjectFromText } from "../../shared/agent-plan-adapter";
import {
  buildDirectorSystemPrompt,
  GENERATION_MODALITIES_KNOWLEDGE,
  WORKFLOW_KNOWLEDGE,
} from "../services/siteKnowledge";
import { DIRECTOR_PERSONALITY_PROMPTS as PERSONALITY_PROMPTS } from "../services/director/personality";
import {
  withTimeout,
  extractMessageJson,
  DIRECTOR_TEMPLATES,
  QUICK_ACTIONS,
} from "../services/director/templates";
import {
  generateExport,
  parseDurationToSeconds,
} from "../services/director/exportFormats";
import { runDirectorAI } from "../services/director/costarService";
import {
  parseScriptIntoSegments,
  discussSegmentWithAI,
} from "../services/director/scriptAnalysisService";
import {
  generateVideoScriptFromBrief,
  VIDEO_SCRIPT_TYPES,
  VIDEO_TYPE_PROFILES,
} from "../services/director/scriptGenerationService";
import { summarizeFrameworkForPrompt } from "../../shared/worldbuilding-types";
import {
  discussPlanningPhase,
  analyzeEmotionalDepth,
} from "../services/director/planningService";
import {
  getAllPricingByCategory,
  estimatePoints,
  getModelPricing,
  checkModelAvailability,
  type ModelCategory,
} from "../services/modelPricing";
import type {
  ScriptSegment,
  ScriptOverview,
  PlanningPhase,
  PlanningMessage,
  ScriptPlanningSession,
} from "../../shared/types";




/**
 * A director-AI session is stored as a `noteType="script"` row tagged
 * `"director-session"`. Both the type and tag are required so other
 * `noteType="script"` rows (long-form imports, generic scripts) can never
 * be returned, updated, or deleted through the session endpoints.
 */


const DIRECTOR_SESSION_COMPRESSION_PREFIX = "gz:";

export function encodeDirectorSessionData(sessionData: string): string {
  const compressed = gzipSync(Buffer.from(sessionData, "utf8"));
  const encoded = compressed.toString("base64");
  return `${DIRECTOR_SESSION_COMPRESSION_PREFIX}${encoded}`;
}

export function decodeDirectorSessionData(sessionData: string): string {
  if (!sessionData.startsWith(DIRECTOR_SESSION_COMPRESSION_PREFIX)) {
    return sessionData;
  }

  const base64Payload = sessionData.slice(
    DIRECTOR_SESSION_COMPRESSION_PREFIX.length
  );
  try {
    const inflated = gunzipSync(Buffer.from(base64Payload, "base64"));
    return inflated.toString("utf8");
  } catch {
    // Defensive fallback: return raw payload if decoding fails so older/bad
    // records never block loading in Director UI.
    return sessionData;
  }
}
export function isDirectorSessionNote(note: {
  noteType?: string | null;
  tags?: string[] | null;
}): boolean {
  if (note.noteType !== "script") return false;
  return Array.isArray(note.tags) && note.tags.includes("director-session");
}

/**
 * AIDV-152：Director chat 自動載入世界框架的伺服器端聚焦旗標。
 *
 * **預設 OFF**＝零行為改變：未開啟時，即使 chat 帶了 projectId 也不會載入
 * 世界框架、不會注入 system prompt，chat 行為與改動前位元相同。
 *
 * 不能重用 client 端的 `ENABLE_WORLD_STYLE_INJECTION`（`VITE_` 前綴、走
 * `import.meta.env`，server 讀不到；且語意是「圖像提示詞 prepend 視覺風格」，
 * 與「LLM 對話注入世界框架文字脈絡」不同）。故新增 server 端聚焦旗標，
 * 仿 perplexityThrottle 既有 `process.env` 慣例。
 *
 * 設 ENABLE_DIRECTOR_WORLD_CONTEXT=1（或 true/on/yes）開啟。
 */
function isDirectorWorldContextEnabled(): boolean {
  const raw = process.env.ENABLE_DIRECTOR_WORLD_CONTEXT;
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

/**
 * AIDV-152：best-effort 載入專案的世界框架摘要。
 *
 * 流程：projectId → getCreativeProject（擁有權比對）→ project.worldFrameworkId
 * → getWorldbuildingFramework（擁有權比對）→ summarizeFrameworkForPrompt。
 *
 * **絕不 throw**：任何環節查無/出錯一律回 undefined（吞錯＋log），讓 chat
 * 照常運作、不因脈絡載入失敗而 500。
 */
async function loadProjectWorldContext(
  userId: number,
  projectId: number
): Promise<string | undefined> {
  try {
    const project = await db.getCreativeProject(projectId);
    if (!project || project.userId !== userId) return undefined;
    if (!project.worldFrameworkId) return undefined;

    const wb = await db.getWorldbuildingFramework(project.worldFrameworkId);
    if (!wb || wb.userId !== userId) return undefined;

    return summarizeFrameworkForPrompt({
      name: wb.name,
      description: wb.description ?? undefined,
      genre: wb.genre ?? undefined,
      era: wb.era ?? undefined,
      characters: Array.isArray(wb.charactersJson)
        ? (wb.charactersJson as never)
        : [],
      scenes: Array.isArray(wb.scenesJson) ? (wb.scenesJson as never) : [],
      objects: Array.isArray(wb.objectsJson)
        ? (wb.objectsJson as never)
        : undefined,
      tags: Array.isArray(wb.tags) ? (wb.tags as string[]) : undefined,
      isActive: wb.isActive,
    });
  } catch (err) {
    // best-effort：載入/摘要失敗絕不阻擋 chat，吞錯並記錄。
    console.warn(
      "[director.chat] world context load failed; continuing without injection",
      err
    );
    return undefined;
  }
}

// ─── Router ─────────────────────────────────────────────────────────────────

export const directorRouter = router({
  /** Main chat endpoint — runs dual-engine Director AI */
  chat: brainProcedure
    .input(
      z.object({
        messages: z.array(
          z.object({
            role: z.string(),
            content: z.string(),
          })
        ),
        saveToNotes: z.boolean().default(false),
        personality: z
          .enum(["calm", "creative", "technical"])
          .default("creative"),
        /**
         * AIDV-152：可選的當前 active project id。向後相容（optional）—
         * 既有呼叫者不傳即行為與改動前位元相同。只有「有傳 projectId」且
         * 「ENABLE_DIRECTOR_WORLD_CONTEXT 旗標開啟」時，才會 best-effort
         * 載入該專案的世界框架摘要並注入 system prompt。
         */
        projectId: z.number().int().positive().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const director = ctx.brain.getBrain("director");

      // AIDV-152：旗標 gate ＋ best-effort 注入。旗標 OFF 或未傳 projectId
      // 時 worldContext 為 undefined，runDirectorAI 行為與改動前位元相同。
      let worldContext: string | undefined;
      if (isDirectorWorldContextEnabled() && input.projectId) {
        worldContext = await loadProjectWorldContext(
          ctx.user.id,
          input.projectId
        );
      }

      return runDirectorAI(
        input.messages,
        input.saveToNotes,
        ctx.user.id,
        input.personality,
        {
          model: director.model,
          temperature: director.temperature,
          topP: director.topP,
          systemPrompt: director.systemPrompt,
        },
        worldContext
      );
    }),

  /** Refine an existing script with follow-up instruction */
  refineScript: brainProcedure
    .input(
      z.object({
        script: z.object({
          context: z.string(),
          situation: z.string(),
          task: z.string(),
          action: z.string(),
          result: z.string(),
          visualPrompt: z.string(),
          audioScript: z.string(),
          musicVibe: z.string(),
          proactiveQuestion: z.string().optional(),
        }),
        instruction: z.string().min(1),
        personality: z
          .enum(["calm", "creative", "technical"])
          .default("creative"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const fullPrompt = buildDirectorSystemPrompt(input.personality);
      const director = ctx.brain.getBrain("director");

      const result = await withTimeout(
        invokeLLM({
          runName: "director-costar-refine",
          model: director.model,
          temperature: director.temperature,
          topP: director.topP,
          systemPrompt: director.systemPrompt,
          messages: [
            {
              role: "system",
              content: `${fullPrompt}

你收到一份已存在的 CO-STAR 腳本，以及使用者的修改指示。
請根據指示修改腳本，保留未被要求更動的部分。
輸出完整的 JSON 腳本。`,
            },
            {
              role: "user",
              content: `現有腳本：\n${JSON.stringify(input.script, null, 2)}\n\n修改指示：${input.instruction}`,
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "costar_script",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  context: { type: "string" },
                  situation: { type: "string" },
                  task: { type: "string" },
                  action: { type: "string" },
                  result: { type: "string" },
                  visualPrompt: { type: "string" },
                  audioScript: { type: "string" },
                  musicVibe: { type: "string" },
                  proactiveQuestion: { type: "string" },
                },
                required: [
                  "context",
                  "situation",
                  "task",
                  "action",
                  "result",
                  "visualPrompt",
                  "audioScript",
                  "musicVibe",
                  "proactiveQuestion",
                ],
                additionalProperties: false,
              },
            },
          },
        }),
        // Same rationale as `導演AI研究` above — bumped to 90s so
        // gemini-2.5-pro thinking has headroom.
        90_000,
        "腳本修改"
      );

      // Fence-tolerant — same rationale as generateSegmentCostar.
      const refinedScript = extractMessageJson(
        result.choices[0]?.message?.content
      );
      if (refinedScript && typeof refinedScript === "object") {
        return refinedScript as Record<string, unknown>;
      }
      return input.script;
    }),

  /** Get available templates */
  templates: brainProcedure.query(() => {
    return DIRECTOR_TEMPLATES;
  }),

  /**
   * Save a session snapshot to project notes. When `id` is provided and
   * resolves to a session owned by the caller, the row is updated in place
   * — re-saving an in-progress session no longer accumulates duplicate rows.
   */
  saveSession: brainProcedure
    .input(
      z.object({
        id: z.number().int().positive().optional(),
        title: z.string().min(1).max(255),
        // Cap at ~2 MB of stringified JSON. Larger payloads almost always
        // indicate a runaway message log and would push the TEXT column past
        // healthy limits; clients should trim or split.
        sessionData: z.string().max(2_000_000),
        personality: z
          .enum(["calm", "creative", "technical"])
          .default("creative"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const storedTitle = `[導演對話] ${input.title}`;
      const tags = ["director-session", input.personality];

      if (input.id !== undefined) {
        const existing = await db.getProjectNote(input.id);
        if (
          !existing ||
          existing.userId !== ctx.user.id ||
          !isDirectorSessionNote(existing)
        ) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "找不到要更新的對話",
          });
        }
        await db.updateProjectNote(input.id, {
          title: storedTitle,
          content: encodeDirectorSessionData(input.sessionData),
          tags,
        });
        return { id: input.id };
      }

      const id = await db.createProjectNote({
        userId: ctx.user.id,
        title: storedTitle,
        content: encodeDirectorSessionData(input.sessionData),
        noteType: "script",
        tags,
      });
      return { id };
    }),

  /** List saved director sessions */
  listSessions: brainProcedure.query(async ({ ctx }) => {
    const sessions = await db.getDirectorSessionsByUser(ctx.user.id);
    return sessions
      .filter(isDirectorSessionNote)
      .map(n => ({
        id: n.id,
        title: n.title.replace("[導演對話] ", ""),
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      }));
  }),

  /** Load a saved session */
  loadSession: brainProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const note = await db.getProjectNote(input.id);
      if (
        !note ||
        note.userId !== ctx.user.id ||
        !isDirectorSessionNote(note)
      ) {
        return null;
      }
      return {
        id: note.id,
        title: note.title.replace("[導演對話] ", ""),
        sessionData: decodeDirectorSessionData(note.content ?? ""),
        createdAt: note.createdAt,
      };
    }),

  /** Delete a saved session */
  deleteSession: brainProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const note = await db.getProjectNote(input.id);
      if (
        !note ||
        note.userId !== ctx.user.id ||
        !isDirectorSessionNote(note)
      ) {
        return { success: false };
      }
      await db.deleteProjectNote(input.id);
      return { success: true };
    }),

  /** Preferences CRUD */
  preferences: router({
    get: brainProcedure.query(async ({ ctx }) => {
      return db.getDirectorPreferences(ctx.user.id);
    }),
    update: brainProcedure
      .input(
        z.object({
          personality: z.enum(["calm", "creative", "technical"]).optional(),
          preferredFormat: z
            .enum(["co-star", "sslcm", "selcm", "free"])
            .optional(),
          customSystemPrompt: z.string().optional(),
          preferencesJson: z.record(z.string(), z.unknown()).optional(),
          onboardingSteps: z.array(z.string()).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const id = await db.upsertDirectorPreferences(ctx.user.id, input);
        return { id };
      }),
  }),

  // ─── Script Analysis & Discussion System ──────────────────────────────────

  /** Import and parse a long script into storyboard segments */
  importScript: brainProcedure
    .input(
      z.object({
        rawContent: z.string().min(1).max(100000),
        title: z.string().min(1).max(255),
        sourceFormat: z.string().default("plaintext"),
        personality: z
          .enum(["calm", "creative", "technical"])
          .default("creative"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const director = ctx.brain.getBrain("director");
      const segments = await parseScriptIntoSegments(
        input.rawContent,
        input.sourceFormat,
        input.personality,
        {
          model: director.model,
          temperature: director.temperature,
          topP: director.topP,
          systemPrompt: director.systemPrompt,
        }
      );
      const fullSegments: ScriptSegment[] = segments.map(seg => ({
        ...seg,
        discussion: [],
        status: "draft" as const,
      }));
      return {
        id: `script-${Date.now()}`,
        title: input.title,
        rawContent: input.rawContent,
        sourceFormat: input.sourceFormat,
        segments: fullSegments,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }),

  /**
   * Phase 2: 影片腳本類型分流
   *
   * 從一段 brief（創作概念）直接生成結構化分鏡腳本。與 importScript 不同的是：
   *   - importScript 解析既有長腳本 → 拆段
   *   - generateVideoScript 從零生成 → 依影片類型輸出
   *
   * 影片類型決定段落數、節奏、對白 vs 旁白的偏好。可選帶入 worldFrameworkId
   * 以自動把當前世界觀的角色 / 場景 / 風格設定注入系統提示，讓生成的腳本
   * 與既有世界觀保持一致。
   */
  generateVideoScript: brainProcedure
    .input(
      z.object({
        brief: z.string().min(1).max(20_000),
        title: z.string().min(1).max(255),
        type: z.enum(VIDEO_SCRIPT_TYPES),
        targetDurationSec: z.number().int().positive().max(7200).optional(),
        targetSegmentCount: z.number().int().min(1).max(50).optional(),
        worldFrameworkId: z.number().int().positive().optional(),
        referenceMediaUrls: z.array(z.string().url()).max(8).optional(),
        personality: z
          .enum(["calm", "creative", "technical"])
          .default("creative"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const director = ctx.brain.getBrain("director");

      // 拉取世界觀摘要（若使用者有指定且擁有該世界觀）
      let worldContext: string | undefined;
      if (input.worldFrameworkId) {
        const wb = await db.getWorldbuildingFramework(input.worldFrameworkId);
        if (wb && wb.userId === ctx.user.id) {
          try {
            worldContext = summarizeFrameworkForPrompt({
              name: wb.name,
              description: wb.description ?? undefined,
              genre: wb.genre ?? undefined,
              era: wb.era ?? undefined,
              characters: Array.isArray(wb.charactersJson)
                ? (wb.charactersJson as never)
                : [],
              scenes: Array.isArray(wb.scenesJson)
                ? (wb.scenesJson as never)
                : [],
              objects: Array.isArray(wb.objectsJson)
                ? (wb.objectsJson as never)
                : undefined,
              tags: Array.isArray(wb.tags)
                ? (wb.tags as string[])
                : undefined,
              isActive: wb.isActive,
            });
          } catch {
            // 世界觀摘要失敗不應該阻擋腳本生成
            worldContext = undefined;
          }
        }
      }

      const segments = await generateVideoScriptFromBrief({
        brief: input.brief,
        type: input.type,
        targetDurationSec: input.targetDurationSec,
        targetSegmentCount: input.targetSegmentCount,
        worldContext,
        referenceMediaUrls: input.referenceMediaUrls,
        personality: input.personality,
        brainConfig: {
          model: director.model,
          temperature: director.temperature,
          topP: director.topP,
          systemPrompt: director.systemPrompt,
        },
      });

      const fullSegments: ScriptSegment[] = segments.map(seg => ({
        ...seg,
        discussion: [],
        status: "draft" as const,
      }));

      return {
        id: `script-${Date.now()}`,
        title: input.title,
        rawContent: input.brief,
        sourceFormat: `generated:${input.type}`,
        type: input.type,
        typeLabel: VIDEO_TYPE_PROFILES[input.type].label,
        worldFrameworkId: input.worldFrameworkId ?? null,
        worldContextUsed: Boolean(worldContext),
        segments: fullSegments,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }),

  /** 取得所有支援的影片類型（給前端 UI 用） */
  videoScriptTypes: brainProcedure.query(() => {
    return VIDEO_SCRIPT_TYPES.map(t => ({
      id: t,
      label: VIDEO_TYPE_PROFILES[t].label,
      guidance: VIDEO_TYPE_PROFILES[t].guidance,
      defaultSegmentCount: VIDEO_TYPE_PROFILES[t].defaultSegmentCount,
      defaultTotalDurationSec: VIDEO_TYPE_PROFILES[t].defaultTotalDurationSec,
    }));
  }),

  /** Discuss a specific segment with AI — supports quick actions, image references, and adjacent segment context */
  discussSegment: brainProcedure
    .input(
      z.object({
        segment: z.object({
          id: z.string(),
          index: z.number(),
          rawText: z.string(),
          storyboard: z.object({
            sceneHeading: z.string(),
            visualDescription: z.string(),
            dialogue: z.string(),
            soundDesign: z.string(),
            cameraDirection: z.string(),
            duration: z.string(),
            mood: z.string(),
          }),
          costar: z
            .object({
              context: z.string(),
              situation: z.string(),
              task: z.string(),
              action: z.string(),
              result: z.string(),
              visualPrompt: z.string(),
              audioScript: z.string(),
              musicVibe: z.string(),
              proactiveQuestion: z.string().optional(),
            })
            .optional(),
          characters: z.array(z.string()).optional(),
          locations: z.array(z.string()).optional(),
          notes: z.string().optional(),
          // 2026-05 audit: both fields used to be required, but callers
          // hitting discussSegment for the first time on a brand-new segment
          // legitimately have no discussion yet — and the orb tool bridge
          // wouldn't either. Defaulting them keeps the existing UI flow
          // working while making the API forgiving for new callers.
          discussion: z
            .array(
              z.object({
                role: z.enum(["user", "assistant"]),
                content: z.string(),
                imageUrl: z.string().optional(),
                quickAction: z.string().optional(),
                timestamp: z.string(),
              })
            )
            .default([]),
          status: z
            .enum(["pending", "draft", "refined", "approved"])
            .default("pending"),
        }),
        message: z.string().min(1),
        personality: z
          .enum(["calm", "creative", "technical"])
          .default("creative"),
        quickActionId: z.string().optional(),
        imageUrl: z.string().optional(),
        /** Adjacent segments for continuity-aware discussion */
        prevSegment: z
          .object({
            index: z.number(),
            storyboard: z.object({
              sceneHeading: z.string(),
              visualDescription: z.string(),
              dialogue: z.string(),
              soundDesign: z.string(),
              cameraDirection: z.string(),
              duration: z.string(),
              mood: z.string(),
            }),
          })
          .optional(),
        nextSegment: z
          .object({
            index: z.number(),
            storyboard: z.object({
              sceneHeading: z.string(),
              visualDescription: z.string(),
              dialogue: z.string(),
              soundDesign: z.string(),
              cameraDirection: z.string(),
              duration: z.string(),
              mood: z.string(),
            }),
          })
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const director = ctx.brain.getBrain("director");
      const adjacentSegments = {
        prev: input.prevSegment
          ? ({
              ...input.prevSegment,
              id: "",
              rawText: "",
              discussion: [],
              status: "draft" as const,
            } as ScriptSegment)
          : undefined,
        next: input.nextSegment
          ? ({
              ...input.nextSegment,
              id: "",
              rawText: "",
              discussion: [],
              status: "draft" as const,
            } as ScriptSegment)
          : undefined,
      };
      const result = await discussSegmentWithAI(
        input.segment as ScriptSegment,
        input.message,
        input.personality,
        input.quickActionId,
        input.imageUrl,
        adjacentSegments,
        {
          model: director.model,
          temperature: director.temperature,
          topP: director.topP,
          systemPrompt: director.systemPrompt,
        }
      );
      return result;
    }),

  /** Get available quick actions for multi-modal discussion */
  quickActions: brainProcedure.query(() => {
    return QUICK_ACTIONS;
  }),

  /** Export segments in various formats */
  exportScript: brainProcedure
    .input(
      z.object({
        segments: z.array(
          z.object({
            id: z.string(),
            index: z.number(),
            rawText: z.string(),
            storyboard: z.object({
              sceneHeading: z.string(),
              visualDescription: z.string(),
              dialogue: z.string(),
              soundDesign: z.string(),
              cameraDirection: z.string(),
              duration: z.string(),
              mood: z.string(),
            }),
            costar: z
              .object({
                context: z.string(),
                situation: z.string(),
                task: z.string(),
                action: z.string(),
                result: z.string(),
                visualPrompt: z.string(),
                audioScript: z.string(),
                musicVibe: z.string(),
                proactiveQuestion: z.string().optional(),
              })
              .optional(),
            discussion: z.array(
              z.object({
                role: z.enum(["user", "assistant"]),
                content: z.string(),
                imageUrl: z.string().optional(),
                quickAction: z.string().optional(),
                timestamp: z.string(),
              })
            ),
            status: z.enum(["pending", "draft", "refined", "approved"]),
          })
        ),
        format: z.enum(["json", "csv", "markdown", "fdx", "srt", "custom"]),
        customColumns: z
          .array(
            z.object({
              header: z.string(),
              field: z.string(),
            })
          )
          .optional(),
        includeDiscussion: z.boolean().default(false),
        includeCostar: z.boolean().default(false),
        customTemplate: z.string().optional(),
      })
    )
    .mutation(({ input }) => {
      const content = generateExport(
        input.segments as ScriptSegment[],
        input.format,
        {
          customColumns: input.customColumns,
          includeDiscussion: input.includeDiscussion,
          includeCostar: input.includeCostar,
          customTemplate: input.customTemplate,
        }
      );
      return { content, format: input.format };
    }),

  /** Generate CO-STAR storyboard for a specific segment — enriched with discussion insights */
  generateSegmentCostar: brainProcedure
    .input(
      z.object({
        segment: z.object({
          id: z.string(),
          index: z.number(),
          rawText: z.string(),
          storyboard: z.object({
            sceneHeading: z.string(),
            visualDescription: z.string(),
            dialogue: z.string(),
            soundDesign: z.string(),
            cameraDirection: z.string(),
            duration: z.string(),
            mood: z.string(),
          }),
          /** Include discussion insights in CO-STAR generation for richer output */
          discussion: z
            .array(
              z.object({
                role: z.enum(["user", "assistant"]),
                content: z.string(),
              })
            )
            .optional(),
          characters: z.array(z.string()).optional(),
          locations: z.array(z.string()).optional(),
        }),
        personality: z
          .enum(["calm", "creative", "technical"])
          .default("creative"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const persona =
        PERSONALITY_PROMPTS[input.personality] ?? PERSONALITY_PROMPTS.creative;
      const fullPrompt = buildDirectorSystemPrompt(input.personality);
      const director = ctx.brain.getBrain("director");

      // Build discussion summary if available — informs CO-STAR with refinements discussed
      const discussionInsights =
        (input.segment.discussion ?? []).length > 0
          ? `\n\n【討論洞察摘要】以下是使用者與導演 AI 討論後的決策：\n${(
              input.segment.discussion ?? []
            )
              .slice(-8)
              .map(
                d => `${d.role === "user" ? "使用者" : "導演"}：${d.content}`
              )
              .join("\n")}\n請將討論中達成的共識融入 CO-STAR 腳本中。`
          : "";

      const characterInfo =
        (input.segment.characters ?? []).length > 0
          ? `\n角色：${input.segment.characters!.join("、")}`
          : "";
      const locationInfo =
        (input.segment.locations ?? []).length > 0
          ? `\n地點：${input.segment.locations!.join("、")}`
          : "";

      const result = await withTimeout(
        invokeLLM({
          runName: "director-segment-costar",
          model: director.model,
          temperature: director.temperature,
          topP: director.topP,
          systemPrompt: director.systemPrompt,
          messages: [
            {
              role: "system",
              content: `${fullPrompt}

根據以下分鏡段落資訊，生成完整的 CO-STAR 腳本結構。

分鏡資訊：
- 場景：${input.segment.storyboard.sceneHeading}
- 視覺：${input.segment.storyboard.visualDescription}
- 對白：${input.segment.storyboard.dialogue}
- 音效：${input.segment.storyboard.soundDesign}
- 鏡頭：${input.segment.storyboard.cameraDirection}
- 時長：${input.segment.storyboard.duration}
- 氛圍：${input.segment.storyboard.mood}${characterInfo}${locationInfo}

原始文本：${input.segment.rawText}
${discussionInsights}

${persona.proactiveHint}

生成要求：
1. visualPrompt 必須是高品質的英文提示詞，包含具體的風格、構圖、光線描述和品質標籤
2. audioScript 必須是完整的繁體中文語音腳本，包含語氣和節奏標註
3. musicVibe 必須是明確的英文音樂風格描述，包含推薦的音樂模型和參數
4. proactiveQuestion 必須根據當前分鏡缺少的元素提出具體且有建設性的問題`,
            },
            {
              role: "user",
              content: "請為這段分鏡生成完整的 CO-STAR 腳本。",
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "costar_script",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  context: { type: "string" },
                  situation: { type: "string" },
                  task: { type: "string" },
                  action: { type: "string" },
                  result: { type: "string" },
                  visualPrompt: { type: "string" },
                  audioScript: { type: "string" },
                  musicVibe: { type: "string" },
                  proactiveQuestion: { type: "string" },
                },
                required: [
                  "context",
                  "situation",
                  "task",
                  "action",
                  "result",
                  "visualPrompt",
                  "audioScript",
                  "musicVibe",
                  "proactiveQuestion",
                ],
                additionalProperties: false,
              },
            },
          },
        }),
        // 2026-05 audit: same root cause as 導演AI研究 (which I bumped
        // 30→90s in round 3). gemini-2.5-pro spends 25-50s thinking on a
        // CO-STAR structured-JSON generation; the 45s ceiling means
        // ~half the calls 500'd in production. Bumped to 90s, which still
        // sits comfortably under invokeLLM's env-driven LLM_TIMEOUT_SECONDS.
        90_000,
        "分鏡 CO-STAR 生成"
      );

      // Use the fence-tolerant extractor so Gemini wrapping the JSON in
      // ```json fences (a common json_object mode artefact) still produces
      // a usable CO-STAR card instead of falling through to all-empty.
      const extracted = extractMessageJson(
        result.choices[0]?.message?.content
      );
      if (extracted && typeof extracted === "object") {
        return extracted as Record<string, unknown>;
      }
      return {
        context: "",
        situation: "",
        task: "",
        action: "",
        result: "",
        visualPrompt: "",
        audioScript: "",
        musicVibe: "",
        proactiveQuestion: "",
      };
    }),

  /** Batch generate CO-STAR for multiple segments */
  batchGenerateCostar: brainProcedure
    .input(
      z.object({
        segments: z.array(
          z.object({
            id: z.string(),
            index: z.number(),
            rawText: z.string(),
            storyboard: z.object({
              sceneHeading: z.string(),
              visualDescription: z.string(),
              dialogue: z.string(),
              soundDesign: z.string(),
              cameraDirection: z.string(),
              duration: z.string(),
              mood: z.string(),
            }),
          })
        ),
        personality: z
          .enum(["calm", "creative", "technical"])
          .default("creative"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const persona =
        PERSONALITY_PROMPTS[input.personality] ?? PERSONALITY_PROMPTS.creative;
      const fullPrompt = buildDirectorSystemPrompt(input.personality);
      const director = ctx.brain.getBrain("director");

      // Build a combined prompt for all segments
      const segmentsList = input.segments
        .map(
          (seg, i) =>
            `【分鏡 #${seg.index + 1}】\n場景：${seg.storyboard.sceneHeading}\n視覺：${seg.storyboard.visualDescription}\n對白：${seg.storyboard.dialogue}\n音效：${seg.storyboard.soundDesign}\n鏡頭：${seg.storyboard.cameraDirection}\n時長：${seg.storyboard.duration}\n氛圍：${seg.storyboard.mood}\n原文：${seg.rawText.slice(0, 300)}`
        )
        .join("\n\n---\n\n");

      const result = await withTimeout(
        invokeLLM({
          runName: "director-batch-costar",
          model: director.model,
          temperature: director.temperature,
          topP: director.topP,
          systemPrompt: director.systemPrompt,
          messages: [
            {
              role: "system",
              content: `${fullPrompt}

你需要為以下所有分鏡段落批次生成 CO-STAR 腳本結構。
每個分鏡的 CO-STAR 應相互連貫，確保整體敘事流暢。

${segmentsList}

${persona.proactiveHint}

生成要求：
1. 每段 visualPrompt 必須是高品質英文提示詞
2. 每段 audioScript 必須是繁體中文語音腳本
3. 注意段落之間的情緒遞進和視覺風格統一`,
            },
            {
              role: "user",
              content: `請為以上 ${input.segments.length} 個分鏡批次生成 CO-STAR 腳本。`,
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "batch_costar",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  results: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        segmentId: { type: "string" },
                        context: { type: "string" },
                        situation: { type: "string" },
                        task: { type: "string" },
                        action: { type: "string" },
                        result: { type: "string" },
                        visualPrompt: { type: "string" },
                        audioScript: { type: "string" },
                        musicVibe: { type: "string" },
                        proactiveQuestion: { type: "string" },
                      },
                      required: [
                        "segmentId",
                        "context",
                        "situation",
                        "task",
                        "action",
                        "result",
                        "visualPrompt",
                        "audioScript",
                        "musicVibe",
                        "proactiveQuestion",
                      ],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["results"],
                additionalProperties: false,
              },
            },
          },
          maxTokens: 8192,
        }),
        120_000,
        "批次 CO-STAR 生成"
      );

      // Fence-tolerant parsing — see generateSegmentCostar comment.
      const parsed = extractMessageJson(
        result.choices[0]?.message?.content
      ) as { results?: unknown } | null;
      const resultMap: Record<string, Record<string, string>> = {};
      const results = Array.isArray(parsed?.results) ? parsed!.results : [];
      for (let i = 0; i < results.length; i++) {
        const r = results[i] as {
          segmentId?: string;
          [key: string]: unknown;
        };
        const segId =
          r.segmentId ||
          (i < input.segments.length ? input.segments[i].id : undefined);
        if (segId) {
          resultMap[segId] = r as Record<string, string>;
        }
      }
      return { results: resultMap };
    }),

  /** Analyze the full script holistically — themes, arcs, pacing, character/location distribution */
  analyzeScriptOverview: brainProcedure
    .input(
      z.object({
        segments: z.array(
          z.object({
            index: z.number(),
            storyboard: z.object({
              sceneHeading: z.string(),
              visualDescription: z.string(),
              dialogue: z.string(),
              soundDesign: z.string(),
              cameraDirection: z.string(),
              duration: z.string(),
              mood: z.string(),
            }),
            characters: z.array(z.string()).optional(),
            locations: z.array(z.string()).optional(),
          })
        ),
        personality: z
          .enum(["calm", "creative", "technical"])
          .default("creative"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const persona =
        PERSONALITY_PROMPTS[input.personality] ?? PERSONALITY_PROMPTS.creative;
      const director = ctx.brain.getBrain("director");

      const segmentSummaries = input.segments
        .map(
          seg =>
            `#${seg.index + 1} ${seg.storyboard.sceneHeading} | ${seg.storyboard.mood} | ${seg.storyboard.duration} | 角色：${(seg.characters ?? []).join(",")} | 地點：${(seg.locations ?? []).join(",")}`
        )
        .join("\n");

      const totalDurationSec = input.segments.reduce(
        (sum, seg) => sum + parseDurationToSeconds(seg.storyboard.duration),
        0
      );
      const totalMin = Math.floor(totalDurationSec / 60);
      const totalSec = Math.round(totalDurationSec % 60);

      const result = await withTimeout(
        invokeLLM({
          runName: "director-global-analysis",
          model: director.model,
          temperature: director.temperature,
          topP: director.topP,
          systemPrompt: director.systemPrompt,
          messages: [
            {
              role: "system",
              content: `${persona.directorStyle}

你是一位專業的腳本分析師。請對整部腳本進行全局分析。

分鏡列表：
${segmentSummaries}

總時長估算：${totalMin}分${totalSec}秒 / 共 ${input.segments.length} 個分鏡

請提供：
1. themes: 作品的核心主題（2-4 個）
2. characters: 出場角色列表及其出場分鏡索引
3. locations: 場景地點列表及其使用分鏡索引
4. moodDistribution: 各氛圍出現次數統計
5. pacingNotes: 節奏分析（哪些地方偏快/偏慢、張力曲線是否合理）
6. overallSuggestion: 整體改善建議（1-3 段，具體可執行）`,
            },
            {
              role: "user",
              content: "請分析整部腳本。",
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "script_overview",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  themes: { type: "array", items: { type: "string" } },
                  characters: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        segmentIndices: {
                          type: "array",
                          items: { type: "number" },
                        },
                      },
                      required: ["name", "segmentIndices"],
                      additionalProperties: false,
                    },
                  },
                  locations: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        segmentIndices: {
                          type: "array",
                          items: { type: "number" },
                        },
                      },
                      required: ["name", "segmentIndices"],
                      additionalProperties: false,
                    },
                  },
                  moodDistribution: {
                    type: "object",
                    additionalProperties: { type: "number" },
                  },
                  pacingNotes: { type: "string" },
                  overallSuggestion: { type: "string" },
                },
                required: [
                  "themes",
                  "characters",
                  "locations",
                  "moodDistribution",
                  "pacingNotes",
                  "overallSuggestion",
                ],
                additionalProperties: false,
              },
            },
          },
        }),
        45_000,
        "腳本全局分析"
      );

      const parsedOverview = extractMessageJson(
        result.choices[0]?.message?.content
      );
      if (parsedOverview && typeof parsedOverview === "object") {
        return {
          totalDuration: `${totalMin}分${totalSec}秒`,
          segmentCount: input.segments.length,
          ...(parsedOverview as Record<string, unknown>),
        } as ScriptOverview;
      }
      {
        return {
          totalDuration: `${totalMin}分${totalSec}秒`,
          segmentCount: input.segments.length,
          themes: [],
          characters: [],
          locations: [],
          moodDistribution: {},
          pacingNotes: "",
          overallSuggestion: "",
        } as ScriptOverview;
      }
    }),

  // ─── Quick Generation Pipeline ──────────────────────────────────────────

  /**
   * Get available generation models grouped by modality for the model picker.
   *
   * Also exposes the user's AI 大腦組態 preferred engine per modality so the
   * Director frontend can pre-select that as the default (instead of "first
   * available"). The brain context is loaded by brainProcedure middleware.
   */
  generationModels: brainProcedure.query(({ ctx }) => {
    const byCategory = getAllPricingByCategory();
    const relevantCategories: ModelCategory[] = [
      "text-to-image",
      "text-to-video",
      "text-to-audio",
      "text-to-speech",
    ];
    const models: Record<
      string,
      Array<{
        modelId: string;
        label: string;
        provider: string;
        tier: string;
        basePoints: number;
        unit: string;
        minPoints: number;
        maxPoints: number;
        pointsPerSecond?: number;
        pointsPer1kChars?: number;
        available: boolean;
      }>
    > = {};
    for (const cat of relevantCategories) {
      const list = byCategory[cat] ?? [];
      models[cat] = list.map(m => {
        const avail = checkModelAvailability(m.modelId);
        return {
          modelId: m.modelId,
          label: m.label,
          provider: m.provider,
          tier: m.tier,
          basePoints: m.basePoints,
          unit: m.unit,
          minPoints: m.minPoints,
          maxPoints: m.maxPoints,
          pointsPerSecond: m.pointsPerSecond,
          pointsPer1kChars: m.pointsPer1kChars,
          available: avail.available,
        };
      });
    }

    // Map each Director modality to the corresponding brain generation slot.
    // Director uses 4 modalities; brain.generation has 4 slots (imageEngine,
    // videoEngine, audioEngine, voiceEngine). Falls through to undefined if
    // brain is unavailable so the frontend default-selection still works.
    const brainDefaults: Record<string, string | undefined> = {
      "text-to-image": ctx.brain?.getEngine("imageEngine")?.engine,
      "text-to-video": ctx.brain?.getEngine("videoEngine")?.engine,
      "text-to-audio": ctx.brain?.getEngine("audioEngine")?.engine,
      "text-to-speech": ctx.brain?.getEngine("voiceEngine")?.engine,
    };

    return { models, brainDefaults };
  }),

  /** Estimate generation cost for a segment with user-selected models */
  estimateSegmentCost: brainProcedure
    .input(
      z.object({
        tasks: z.array(
          z.object({
            modality: z.enum(["image", "video", "audio", "voice"]),
            modelId: z.string(),
            durationSec: z.number().optional(),
            charCount: z.number().optional(),
          })
        ),
      })
    )
    .query(({ input }) => {
      return input.tasks.map(task => {
        const estimate = estimatePoints(task.modelId, {
          durationSec: task.durationSec,
          charCount: task.charCount,
        });
        const pricing = getModelPricing(task.modelId);
        const avail = checkModelAvailability(task.modelId);
        return {
          modality: task.modality,
          modelId: task.modelId,
          modelLabel: pricing?.label ?? task.modelId,
          points: estimate.totalPoints,
          breakdown: estimate.breakdown,
          available: avail.available,
          availabilityNote: avail.reason,
        };
      });
    }),

  // ─── Long Script Planning Mode ──────────────────────────────────────────

  /** Discuss within a specific planning phase with AI */
  planningDiscuss: brainProcedure
    .input(
      z.object({
        phase: z.enum([
          "concept",
          "outline",
          "scene-planning",
          "emotional-depth",
          "schedule",
        ]),
        message: z.string().min(1),
        personality: z
          .enum(["calm", "creative", "technical"])
          .default("creative"),
        previousMessages: z
          .array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string(),
              timestamp: z.string(),
              phase: z
                .enum([
                  "concept",
                  "outline",
                  "scene-planning",
                  "emotional-depth",
                  "schedule",
                ])
                .optional(),
            })
          )
          .default([]),
        sessionContext: z
          .object({
            concept: z
              .object({
                theme: z.string(),
                targetAudience: z.string(),
                coreEmotion: z.string(),
                vision: z.string(),
              })
              .optional(),
            outline: z
              .object({
                synopsis: z.string(),
                emotionalArc: z.string(),
                keyTurningPoints: z.array(z.string()),
                characters: z.array(
                  z.object({
                    name: z.string(),
                    role: z.string(),
                    emotionalJourney: z.string(),
                  })
                ),
              })
              .optional(),
            scenes: z
              .array(
                z.object({
                  id: z.string(),
                  title: z.string(),
                  description: z.string(),
                  mood: z.string(),
                  emotionalGoal: z.string(),
                  characters: z.array(z.string()),
                  location: z.string(),
                  duration: z.string(),
                  notes: z.string(),
                })
              )
              .optional(),
            emotionalBeats: z
              .array(
                z.object({
                  sceneIndex: z.number().optional(),
                  label: z.string(),
                  emotion: z.string(),
                  intensity: z.number(),
                  warmthNote: z.string(),
                })
              )
              .optional(),
          })
          .default({}),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const director = ctx.brain.getBrain("director");
      return discussPlanningPhase(
        input.phase,
        input.previousMessages as PlanningMessage[],
        input.message,
        input.personality,
        input.sessionContext,
        ctx.user.id,
        {
          model: director.model,
          temperature: director.temperature,
          topP: director.topP,
          systemPrompt: director.systemPrompt,
        }
      );
    }),

  /** Analyze emotional depth of the planned scenes */
  planningAnalyzeDepth: brainProcedure
    .input(
      z.object({
        scenes: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            description: z.string(),
            mood: z.string(),
            emotionalGoal: z.string(),
            characters: z.array(z.string()),
            location: z.string(),
            duration: z.string(),
            notes: z.string(),
          })
        ),
        concept: z
          .object({
            theme: z.string(),
            targetAudience: z.string(),
            coreEmotion: z.string(),
            vision: z.string(),
          })
          .optional(),
        outline: z
          .object({
            synopsis: z.string(),
            emotionalArc: z.string(),
            keyTurningPoints: z.array(z.string()),
            characters: z.array(
              z.object({
                name: z.string(),
                role: z.string(),
                emotionalJourney: z.string(),
              })
            ),
          })
          .optional(),
        personality: z
          .enum(["calm", "creative", "technical"])
          .default("creative"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const director = ctx.brain.getBrain("director");
      return analyzeEmotionalDepth(
        input.scenes,
        input.concept,
        input.outline,
        input.personality,
        {
          model: director.model,
          temperature: director.temperature,
          topP: director.topP,
          systemPrompt: director.systemPrompt,
        }
      );
    }),

  /** Save (or update) a planning session to project notes */
  savePlanningSession: brainProcedure
    .input(
      z.object({
        id: z.number().optional(),
        title: z.string().min(1).max(255),
        sessionData: z.string(), // JSON stringified ScriptPlanningSession
        personality: z
          .enum(["calm", "creative", "technical"])
          .default("creative"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.id) {
        const note = await db.getProjectNote(input.id);
        if (note && note.userId === ctx.user.id) {
          await db.updateProjectNote(input.id, {
            title: `[長腳本規劃] ${input.title}`,
            content: encodeDirectorSessionData(input.sessionData),
            tags: ["planning-session", input.personality, "long-script"],
          });
          return { id: input.id };
        }
        // 找不到或不是這個使用者的 → fall through 建立新的
      }
      const id = await db.createProjectNote({
        userId: ctx.user.id,
        title: `[長腳本規劃] ${input.title}`,
        content: encodeDirectorSessionData(input.sessionData),
        noteType: "script",
        tags: ["planning-session", input.personality, "long-script"],
      });
      return { id };
    }),

  /** List saved planning sessions */
  listPlanningSessions: brainProcedure.query(async ({ ctx }) => {
    const notes = await db.getProjectNotesByUser(ctx.user.id);
    return notes
      .filter(
        n => n.noteType === "script" && n.title.startsWith("[長腳本規劃]")
      )
      .map(n => ({
        id: n.id,
        title: n.title.replace("[長腳本規劃] ", ""),
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      }));
  }),

  /** Load a saved planning session */
  loadPlanningSession: brainProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const note = await db.getProjectNote(input.id);
      if (!note || note.userId !== ctx.user.id) return null;
      return {
        id: note.id,
        title: note.title.replace("[長腳本規劃] ", ""),
        sessionData: decodeDirectorSessionData(note.content ?? ""),
        createdAt: note.createdAt,
      };
    }),

  /** Delete a saved planning session */
  deletePlanningSession: brainProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const note = await db.getProjectNote(input.id);
      if (!note || note.userId !== ctx.user.id) return { success: false };
      await db.deleteProjectNote(input.id);
      return { success: true };
    }),

  /** Create calendar milestones from planning session */
  planningCreateMilestones: brainProcedure
    .input(
      z.object({
        milestones: z.array(
          z.object({
            title: z.string(),
            targetDate: z.number(), // timestamp
            phase: z.enum([
              "concept",
              "outline",
              "scene-planning",
              "emotional-depth",
              "schedule",
            ]),
          })
        ),
        planningTitle: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const ids: number[] = [];
      for (const m of input.milestones) {
        const id = await db.createProjectNote({
          userId: ctx.user.id,
          title: `[規劃里程碑] ${input.planningTitle} — ${m.title}`,
          content: `規劃階段：${m.phase}\n來自長腳本規劃：${input.planningTitle}`,
          noteType: "calendar_event",
          scheduledDate: new Date(m.targetDate),
          tags: ["planning-milestone", m.phase],
        });
        ids.push(id);
      }
      return { ids };
    }),

  // ─── Auto Script-to-Generation Pipeline ─────────────────────────────────────

  /**
   * Auto-generate multimodal content from script segments
   * 根據腳本分段自動分配生成任務到對應的 AI 模型
   */
  autoGenerateFromSegments: brainProcedure
    .input(
      z.object({
        segments: z.array(
          z.object({
            id: z.string(),
            index: z.number(),
            storyboard: z.object({
              sceneHeading: z.string(),
              visualDescription: z.string(),
              dialogue: z.string(),
              soundDesign: z.string(),
              cameraDirection: z.string(),
              duration: z.string(),
              mood: z.string(),
            }),
            costar: z
              .object({
                context: z.string(),
                situation: z.string(),
                task: z.string(),
                action: z.string(),
                result: z.string(),
                visualPrompt: z.string(),
                audioScript: z.string(),
                musicVibe: z.string(),
              })
              .optional(),
          })
        ),
        generationOptions: z.object({
          /** Which modalities to generate for each segment */
          modalities: z
            .array(z.enum(["image", "video", "audio", "voice", "sfx"]))
            .min(1),
          /** Image generation settings */
          imageSettings: z
            .object({
              aspectRatio: z.string().optional(),
              negativePrompt: z.string().optional(),
              modelId: z.string().optional(),
            })
            .optional(),
          /** Video generation settings */
          videoSettings: z
            .object({
              modelId: z.string().optional(),
              useImageAsFirstFrame: z.boolean().optional(), // Use generated image as video first frame
            })
            .optional(),
          /** Audio generation settings */
          audioSettings: z
            .object({
              modelId: z.string().optional(),
              isInstrumental: z.boolean().optional(),
            })
            .optional(),
          /** Voice generation settings */
          voiceSettings: z
            .object({
              modelId: z.string().optional(),
              voiceSpeed: z.number().optional(),
              voiceStability: z.number().optional(),
              /** ElevenLabs / Kling voice_id 或 Qwen speaker embedding URL（聲音克隆復用） */
              cloneVoiceId: z.string().optional(),
              cloneEmbeddingUrl: z.string().url().optional(),
            })
            .optional(),
          /** Generation mode for all tasks */
          mode: z.enum(["lightning", "deep_precision"]).default("lightning"),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const { segments, generationOptions } = input;

      // Import necessary dependencies
      const { getDb } = await import("../db");
      const { userAiBrain } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const {
        resolveFalEnginesFromRow,
      } = await import("../services/falDispatcher");
      const { estimatePoints } = await import("../services/modelPricing");
      const { isDemoMode } = await import("../_core/googleAuth");
      const { normalizeEngineModelId } = await import(
        "../../shared/engineModelIds"
      );

      // Fetch user AI brain config
      let brainRow: Record<string, unknown> | null = null;
      try {
        const database = await getDb();
        if (database) {
          const rows = await database
            .select()
            .from(userAiBrain)
            .where(eq(userAiBrain.userId, userId))
            .limit(1);
          brainRow = (rows[0] ?? null) as Record<string, unknown> | null;
        }
      } catch {
        /* use defaults */
      }
      const falEngines = resolveFalEnginesFromRow(brainRow);

      // Build generation tasks for each segment
      const generationTasks: Array<{
        segmentId: string;
        segmentIndex: number;
        modality: "image" | "video" | "audio" | "voice" | "sfx";
        modelId: string;
        prompt: string;
        voiceText?: string;
        params: Record<string, unknown>;
        estimatedPoints: number;
        dependsOn?: { segmentId: string; modality: string }; // For video depending on image
      }> = [];

      for (const segment of segments) {
        const visualPrompt = segment.costar?.visualPrompt ||
          segment.storyboard.visualDescription;
        const audioScript = segment.costar?.audioScript ||
          segment.storyboard.dialogue;
        const soundDesign = segment.storyboard.soundDesign ?? "";
        const musicVibe = segment.costar?.musicVibe ||
          segment.storyboard.soundDesign;

        // Parse duration from storyboard
        const durationStr = segment.storyboard.duration;
        const minMatch = durationStr.match(/(\d+)\s*分/);
        const secMatch = durationStr.match(/(\d+)\s*秒/);
        let durationSec = 0;
        if (minMatch) durationSec += parseInt(minMatch[1], 10) * 60;
        if (secMatch) durationSec += parseInt(secMatch[1], 10);
        if (durationSec === 0) durationSec = 5; // default 5 seconds

        for (const modality of generationOptions.modalities) {
          if (modality === "image") {
            const modelId =
              generationOptions.imageSettings?.modelId
                ? normalizeEngineModelId(
                    generationOptions.imageSettings.modelId
                  )
                : falEngines.textToImage;
            const estimate = estimatePoints(modelId, {});
            generationTasks.push({
              segmentId: segment.id,
              segmentIndex: segment.index,
              modality: "image",
              modelId,
              prompt: visualPrompt,
              params: {
                aspect_ratio:
                  generationOptions.imageSettings?.aspectRatio || "16:9",
                negative_prompt:
                  generationOptions.imageSettings?.negativePrompt || "",
              },
              estimatedPoints: estimate.totalPoints,
            });
          } else if (modality === "video") {
            const useImageFirst =
              generationOptions.videoSettings?.useImageAsFirstFrame ?? false;
            const modelId =
              generationOptions.videoSettings?.modelId
                ? normalizeEngineModelId(
                    generationOptions.videoSettings.modelId
                  )
                : useImageFirst
                  ? falEngines.imageToVideo
                  : falEngines.textToVideo;
            const estimate = estimatePoints(modelId, { durationSec });
            const task: (typeof generationTasks)[number] = {
              segmentId: segment.id,
              segmentIndex: segment.index,
              modality: "video",
              modelId,
              prompt: visualPrompt,
              params: {
                duration: String(durationSec),
              },
              estimatedPoints: estimate.totalPoints,
            };
            if (useImageFirst) {
              task.dependsOn = { segmentId: segment.id, modality: "image" };
            }
            generationTasks.push(task);
          } else if (modality === "audio") {
            const modelId =
              generationOptions.audioSettings?.modelId
                ? normalizeEngineModelId(
                    generationOptions.audioSettings.modelId
                  )
                : falEngines.textToAudio;
            const estimate = estimatePoints(modelId, { durationSec });
            // DEF-S2 / DEF-So1：fal.ai 音樂引擎的時長欄位名不一致 —
            //   - ace-step / musicgen → "duration"
            //   - stable-audio        → "seconds_total"
            //   - sonauto v2          → 不接受時長參數（自動產 1-3 分鐘完整歌曲），
            //                           且歌詞用 lyrics_prompt、tags 為陣列
            // 過去硬編碼成 "duration"，導致大腦選 stable-audio / sonauto 時時長被
            // 吃掉甚至送出無效欄位。依 modelId 動態決定 params 形狀。
            // 全模型皆不接受 instrumental flag — 改用 prompt 後綴表達
            // （與 proStudio.textToMusic 一致）。
            const isInstrumental = generationOptions.audioSettings?.isInstrumental ?? true;
            const audioPrompt = isInstrumental
              ? `${musicVibe}, instrumental, no vocals`
              : musicVibe;
            const isSonautoModel =
              modelId === "sonauto/v2/text-to-music" ||
              modelId === "fal-ai/sonauto";
            const audioDurationParams: Record<string, unknown> = isSonautoModel
              ? { output_format: "mp3", num_songs: 1 }
              : modelId.includes("stable-audio")
                ? { seconds_total: durationSec }
                : { duration: durationSec };
            generationTasks.push({
              segmentId: segment.id,
              segmentIndex: segment.index,
              modality: "audio",
              modelId,
              prompt: audioPrompt,
              params: audioDurationParams,
              estimatedPoints: estimate.totalPoints,
            });
          } else if (modality === "voice") {
            const modelId =
              generationOptions.voiceSettings?.modelId
                ? normalizeEngineModelId(
                    generationOptions.voiceSettings.modelId
                  )
                : falEngines.textToSpeech;
            const charCount = audioScript.length;
            const estimate = estimatePoints(modelId, { charCount });
            // 聲音克隆復用：若分鏡指定 cloneVoiceId（ElevenLabs/Kling）或 embedding url（Qwen），
            // 在 params 帶入對應欄位，executeGenerationTask 會優先傳給 fal API。
            // ElevenLabs 系列把 stability 放在 nested voice_settings（見
            // proStudio.elevenLabsTTS:686-690）；speed 為 fal.ai 接受的 top-level 別名。
            const voiceStability =
              generationOptions.voiceSettings?.voiceStability ?? 0.5;
            const voiceParams: Record<string, unknown> = {
              text: audioScript,
              speed: generationOptions.voiceSettings?.voiceSpeed ?? 1.0,
              voice_settings: { stability: voiceStability },
            };
            if (generationOptions.voiceSettings?.cloneVoiceId) {
              voiceParams.voice_id = generationOptions.voiceSettings.cloneVoiceId;
            }
            if (generationOptions.voiceSettings?.cloneEmbeddingUrl) {
              voiceParams.speaker_voice_embedding_file_url =
                generationOptions.voiceSettings.cloneEmbeddingUrl;
            }
            generationTasks.push({
              segmentId: segment.id,
              segmentIndex: segment.index,
              modality: "voice",
              modelId,
              prompt: audioScript,
              voiceText: audioScript,
              params: voiceParams,
              estimatedPoints: estimate.totalPoints,
            });
          } else if (modality === "sfx") {
            // 音效：用分鏡 soundDesign 為提示詞
            // 與 audio（音樂）區分：sfx 著重前景擬真音效；audio 著重背景配樂
            if (!soundDesign.trim()) {
              continue; // 沒有 soundDesign 描述就跳過
            }
            // DEF-SFX4 / DEF-EL3：SFX 接通大腦 audioEngine — 僅當大腦選了
            // SFX-capable 引擎時跟隨；否則退回安全預設 stable-audio，避免拿純
            // 音樂引擎（ace-step / sonauto / musicgen）去做 Foley 音效。
            // ElevenLabs SFX 額外要求 ELEVENLABS_API_KEY，缺 key 時也退回 stable-audio。
            const brainAudioEngine = ctx.brain.generation.audioEngine.engine;
            const sfxCapable = new Set([
              "fal-ai/stable-audio",
              "fal-ai/mmaudio-v2",
              "fal-ai/audioldm2",
              "fal-ai/elevenlabs/sound-effects/v2",
              "fal-ai/elevenlabs/sound-effects",
            ]);
            const requiresElevenLabsKey =
              brainAudioEngine === "fal-ai/elevenlabs/sound-effects/v2" ||
              brainAudioEngine === "fal-ai/elevenlabs/sound-effects";
            const elevenLabsKeyMissing =
              requiresElevenLabsKey && !process.env.ELEVENLABS_API_KEY;
            const modelId =
              sfxCapable.has(brainAudioEngine) && !elevenLabsKeyMissing
                ? brainAudioEngine
                : "fal-ai/stable-audio";
            const isElevenLabs =
              modelId === "fal-ai/elevenlabs/sound-effects/v2" ||
              modelId === "fal-ai/elevenlabs/sound-effects";
            // 三家 SFX 引擎欄位互斥：
            //   - stable-audio   → prompt + seconds_total
            //   - mmaudio/audioldm2 → prompt + duration
            //   - elevenlabs SFX → text + duration_seconds (≤22) + prompt_influence
            // ElevenLabs 有 22 秒硬上限，其他 SFX 慣用 30 秒上限。
            // ElevenLabs SFX v2 hard cap = 22 秒（per fal docs）；其他 SFX 引擎慣用 30 秒
            const sfxDuration = Math.min(durationSec, isElevenLabs ? 22 : 30);
            const estimate = estimatePoints(modelId, { durationSec: sfxDuration });
            const sfxParams: Record<string, unknown> = isElevenLabs
              ? { duration_seconds: sfxDuration, prompt_influence: 0.3 }
              : modelId === "fal-ai/stable-audio"
                ? { seconds_total: sfxDuration }
                : { duration: sfxDuration };
            generationTasks.push({
              segmentId: segment.id,
              segmentIndex: segment.index,
              modality: "sfx",
              modelId,
              prompt: soundDesign,
              params: sfxParams,
              estimatedPoints: estimate.totalPoints,
            });
          }
        }
      }

      // Calculate total points needed
      const totalPoints = generationTasks.reduce(
        (sum, t) => sum + t.estimatedPoints,
        0
      );

      // Check user has enough points
      if (!isDemoMode()) {
        const database = await getDb();
        if (database) {
          const { users } = await import("../../drizzle/schema");
          const { eq } = await import("drizzle-orm");
          const userRows = await database
            .select()
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
          const user = userRows[0];
          if (!user || (user.remainingGenerations ?? 0) < totalPoints) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: `積分不足。需要 ${totalPoints} pts，目前 ${user?.remainingGenerations ?? 0} pts`,
            });
          }
        }
      }

      return {
        tasks: generationTasks.map(t => ({
          segmentId: t.segmentId,
          segmentIndex: t.segmentIndex,
          modality: t.modality,
          modelId: t.modelId,
          prompt: t.prompt,
          voiceText: t.voiceText,
          params: t.params,
          estimatedPoints: t.estimatedPoints,
          dependsOn: t.dependsOn,
        })),
        totalPoints,
        totalTasks: generationTasks.length,
      };
    }),

  /**
   * Execute a single generation task from the auto-generation pipeline
   * 執行單個自動生成任務
   */
  executeGenerationTask: brainProcedure
    .input(
      z.object({
        segmentId: z.string(),
        segmentIndex: z.number(),
        modality: z.enum(["image", "video", "audio", "voice", "sfx"]),
        modelId: z.string(),
        prompt: z.string(),
        voiceText: z.string().optional(),
        params: z.record(z.string(), z.unknown()),
        mode: z.enum(["lightning", "deep_precision"]).default("lightning"),
        firstFrameUrl: z.string().optional(), // For video with image dependency (i2v)
        sourceVideoUrl: z.string().optional(), // For v2v / enhance pipeline (來源影片)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // Import dependencies — go through dispatchFalQueueTask so the
      // director's auto-generation pipeline gets the same fallback chain
      // protection as Studio (a stale modelId degrades to the category's
      // first valid choice instead of hard-failing the whole batch).
      const { dispatchFalQueueTask } = await import(
        "../services/falDispatcher"
      );
      const { estimatePoints } = await import("../services/modelPricing");
      const { isDemoMode } = await import("../_core/googleAuth");
      const db = await import("../db");

      // Estimate points
      const durationSec =
        input.modality === "video" || input.modality === "audio"
          ? Number(input.params.duration || input.params.seconds_total || 5)
          : undefined;
      const charCount =
        input.modality === "voice" ? input.voiceText?.length : undefined;
      const estimate = estimatePoints(input.modelId, { durationSec, charCount });

      // Deduct points
      if (!isDemoMode()) {
        const deductResult = await db.deductUserPoints(
          userId,
          estimate.totalPoints
        );
        if (!deductResult.success) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `積分不足（需要 ${estimate.totalPoints} pts）`,
          });
        }
      }

      // Create background job
      const modalityLabel =
        input.modality === "image"
          ? "圖像"
          : input.modality === "video"
            ? "影片"
            : input.modality === "audio"
              ? "音樂"
              : input.modality === "sfx"
                ? "音效"
                : "語音";
      const label = `${modalityLabel}生成 - 分鏡 #${input.segmentIndex + 1}`;
      // background_jobs.jobType 沒有 "sfx"；sfx 任務沿用 "audio" 儲存（內容是音檔）
      const persistedJobType = input.modality === "sfx" ? "audio" : input.modality;
      // 寫入 studioType / sourceStudio 讓完成時的 runPostGenForJob 能把成品
      // 統一灌進「我的資產 / 生成歷史 / 提示詞庫 / AI 監控室」— 沒有這兩個
      // 欄位，導演 AI 自動生成的內容會繞過 postGenActions，使用者永遠看不
      // 到自己的作品（這是「導演 AI 不走同一條儲存路線」的根因）。
      const studioType = persistedJobType;
      const jobId = await db.createBackgroundJob({
        userId,
        jobType: persistedJobType as any,
        status: "processing",
        progress: 5,
        progressMessage: label,
        resultJson: {
          segmentId: input.segmentId,
          segmentIndex: input.segmentIndex,
          prompt: input.prompt,
          modelId: input.modelId,
          studioType,
          sourceStudio: "director",
          label,
          ...input.params,
          // Persist the exact charged amount so pollGenerationTask's failure
          // path can refund the same number of points instead of recomputing
          // from a partial set of inputs (voice's charCount, for instance,
          // is not part of params and would be silently dropped on refund).
          chargedPoints: estimate.totalPoints,
        } as any,
      });

      try {
        // Build fal input based on modality
        let falInput: Record<string, unknown> = { ...input.params };

        if (input.modality === "image") {
          falInput.prompt = input.prompt;
        } else if (input.modality === "video") {
          falInput.prompt = input.prompt;
          // 三段影片管線：v2v / enhance 看 sourceVideoUrl，i2v 看 firstFrameUrl，
          // 純 t2v 不帶任何 URL。
          if (input.sourceVideoUrl) {
            falInput.video_url = input.sourceVideoUrl;
          } else if (input.firstFrameUrl) {
            falInput.image_url = input.firstFrameUrl;
          }
        } else if (input.modality === "audio") {
          falInput.prompt = input.prompt;
        } else if (input.modality === "sfx") {
          // DEF-EL3：SFX 引擎欄位名稱不一致 —
          //   - stable-audio / mmaudio-v2 / audioldm2 → "prompt"
          //   - elevenlabs/sound-effects/v2          → "text"
          // 並且 ElevenLabs proxy 需要 ELEVENLABS_API_KEY 透過 fal client credentials 注入。
          const isElevenLabsSfx =
            input.modelId === "fal-ai/elevenlabs/sound-effects/v2" ||
            input.modelId === "fal-ai/elevenlabs/sound-effects";
          if (isElevenLabsSfx) {
            falInput.text = input.prompt;
          } else {
            falInput.prompt = input.prompt;
          }
        } else if (input.modality === "voice") {
          falInput.text = input.voiceText || input.prompt;
          // DEF-V10：fal ElevenLabs proxy 必須在 body 裡帶 model_id（原生 ElevenLabs id），
          // 否則 V3 / Multilingual / Flash 會在 fal 端落到預設 Turbo。
          // 從 canonical fal 路徑回推（fal-ai/elevenlabs/tts/eleven-v3 → eleven_v3）。
          if (
            typeof input.modelId === "string" &&
            input.modelId.startsWith("fal-ai/elevenlabs/tts/") &&
            !falInput.model_id
          ) {
            const { nativeElevenLabsModelId } = await import(
              "../../shared/engineModelIds"
            );
            const nativeId = nativeElevenLabsModelId(input.modelId);
            if (nativeId) falInput.model_id = nativeId;
          }
        }

        // Map segment modality → fal task category for fallback chain lookup.
        // sfx 走 text-to-audio 同 catalog（stable-audio 是 audio 類別）。
        const queueCategory: string =
          input.modality === "image"
            ? "text-to-image"
            : input.modality === "video"
              ? input.sourceVideoUrl
                ? "video-to-video"
                : input.firstFrameUrl
                  ? "image-to-video"
                  : "text-to-video"
              : input.modality === "audio" || input.modality === "sfx"
                ? "text-to-audio"
                : "text-to-speech";
        // 若設定 VITE_SITE_URL，組出帶 jobId 的 webhook URL，
        // 完成時 fal.ai 主動推送結果到 /api/webhook/fal?jobId=<id>。
        const siteUrl = process.env.VITE_SITE_URL?.trim();
        const falWebhookUrl = siteUrl
          ? `${siteUrl}/api/webhook/fal?jobId=${jobId}`
          : undefined;
        const queueModalityForTrace =
          input.modality === "sfx" ? "audio" : input.modality;
        // DEF-EL3：ElevenLabs proxy 認證 — 任何 fal-ai/elevenlabs/* endpoint 都
        // 需把 ELEVENLABS_API_KEY 以 x-fal-client-credentials header 傳入。
        const needsElevenLabsCreds =
          typeof input.modelId === "string" &&
          input.modelId.startsWith("fal-ai/elevenlabs/");
        const extraHeaders = needsElevenLabsCreds && process.env.ELEVENLABS_API_KEY
          ? { "x-fal-client-credentials": process.env.ELEVENLABS_API_KEY }
          : undefined;
        const queueResult = await dispatchFalQueueTask({
          modelId: input.modelId,
          category: queueCategory,
          input: falInput,
          webhookUrl: falWebhookUrl,
          route: "trpc.director.executeGenerationTask",
          modality: queueModalityForTrace,
          userId,
          ...(extraHeaders ? { extraHeaders } : {}),
        });
        const submittedModelId = queueResult.modelId;

        // Update job with request_id（以實際送出的 modelId 為準，
        // 確保前端輪詢時能命中正確的 fal queue endpoint）
        await db.updateBackgroundJob(jobId, {
          status: "processing",
          progress: 10,
          resultJson: {
            ...(input.params as Record<string, unknown>),
            segmentId: input.segmentId,
            segmentIndex: input.segmentIndex,
            prompt: input.prompt,
            modelId: submittedModelId,
            studioType,
            sourceStudio: "director",
            label,
            request_id: queueResult.request_id,
            // Persist fal's own canonical tracking URLs so pollGenerationTask
            // can hit them directly and bypass the modelId-derived URL —
            // necessary for fal models whose submit path differs from the
            // queue tracking path (e.g. fal-ai/kling-video/v2.1/standard/text-to-video
            // submits OK but its queue tracking lives at fal-ai/kling-video/...).
            ...(queueResult.statusUrl ? { statusUrl: queueResult.statusUrl } : {}),
            ...(queueResult.responseUrl ? { responseUrl: queueResult.responseUrl } : {}),
            // Persist the exact charged amount so pollGenerationTask's failure
            // path can refund the same number of points instead of recomputing
            // from a partial set of inputs.
            chargedPoints: estimate.totalPoints,
            ...(queueResult.degraded && queueResult.originalModel
              ? { originalModel: queueResult.originalModel, degraded: true }
              : {}),
          } as any,
        });

        return {
          jobId,
          requestId: queueResult.request_id,
          modelId: submittedModelId,
          label,
          segmentId: input.segmentId,
          segmentIndex: input.segmentIndex,
          modality: input.modality,
          ...(queueResult.degraded && queueResult.originalModel
            ? { degraded: true, originalModel: queueResult.originalModel }
            : {}),
        };
      } catch (error) {
        // Refund points on error
        if (!isDemoMode()) {
          await db.refundUserPoints(userId, estimate.totalPoints);
        }
        await db.updateBackgroundJob(jobId, {
          status: "failed",
          errorMessage:
            error instanceof Error ? error.message : "生成任務失敗",
        });
        throw error;
      }
    }),

  /**
   * pollGenerationTask — 自動生成管線的統一輪詢端點。
   *
   * autoGenerateFromSegments 啟動的每個任務（image / video / audio / voice / sfx）
   * 都會透過此 query 輪詢進度。職責：
   *   1. 從 backgroundJob 讀回 request_id 與 modelId（resultJson 內）
   *   2. 呼叫 fal.ai queue status 確認任務狀態
   *   3. 若 COMPLETED：抓結果、本地化 URL、解析出 resultUrl、寫回 backgroundJob
   *   4. 若 FAILED：標記 backgroundJob 失敗，回傳錯誤訊息
   *   5. 否則保持 IN_PROGRESS
   *
   * 回傳統一形狀，讓前端可以對所有模態用同一個 useQuery（refetchInterval=3s）。
   */
  pollGenerationTask: brainProcedure
    .input(
      z.object({
        jobId: z.number(),
      })
    )
    .query(async ({ ctx, input }) => {
      const dbModule = await import("../db");
      const job = await dbModule.getBackgroundJob(input.jobId);
      if (!job || job.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "任務不存在或無權存取",
        });
      }

      // 終態（completed / failed / cancelled）— 直接回填結果
      // drizzle returns mysql JSON columns as strings (the underlying mysql2
      // driver hands back the raw bytes from the server). Older code cast
      // straight to Record<string,unknown>, leaving every field undefined
      // and breaking the polling path entirely — pollGenerationTask would
      // forever return IN_PROGRESS even though fal had completed the job.
      // Parse defensively: accept either a pre-parsed object or a JSON
      // string, and fall back to {} on any malformed value.
      const rawMeta = job.resultJson;
      let meta: Record<string, unknown> = {};
      if (rawMeta && typeof rawMeta === "object") {
        meta = rawMeta as Record<string, unknown>;
      } else if (typeof rawMeta === "string" && rawMeta.length > 0) {
        try {
          const parsed = JSON.parse(rawMeta);
          if (parsed && typeof parsed === "object") {
            meta = parsed as Record<string, unknown>;
          }
        } catch {
          /* malformed JSON in DB — fall through with empty meta */
        }
      }
      const cachedResultUrl =
        typeof meta.resultUrl === "string" ? meta.resultUrl : null;
      if (job.status === "completed") {
        return {
          status: "COMPLETED" as const,
          jobId: job.id,
          resultUrl: cachedResultUrl,
          progress: 100,
          errorMessage: null as string | null,
        };
      }
      if (job.status === "failed" || job.status === "cancelled") {
        return {
          status: "FAILED" as const,
          jobId: job.id,
          resultUrl: null as string | null,
          progress: job.progress ?? 0,
          errorMessage: job.errorMessage ?? "任務失敗",
        };
      }

      // 仍在處理中 — 透過 fal.ai queue API 輪詢狀態
      const requestId =
        typeof meta.request_id === "string"
          ? meta.request_id
          : typeof meta.requestId === "string"
            ? meta.requestId
            : null;
      const modelId = typeof meta.modelId === "string" ? meta.modelId : null;
      if (!requestId || !modelId) {
        // backgroundJob 還沒寫入 request_id（例如 dispatcher 還沒回傳）—
        // 回 IN_PROGRESS，前端繼續等待。
        return {
          status: "IN_PROGRESS" as const,
          jobId: job.id,
          resultUrl: null as string | null,
          progress: job.progress ?? 5,
          errorMessage: null as string | null,
        };
      }

      const falKey = process.env.FAL_API_KEY;
      if (!falKey) {
        // 缺少金鑰但任務還在跑 — 不要硬擋，把錯誤訊息透過 errorMessage 帶回去，
        // 由前端決定是否提示使用者。
        return {
          status: "IN_PROGRESS" as const,
          jobId: job.id,
          resultUrl: null as string | null,
          progress: job.progress ?? 10,
          errorMessage: "FAL_API_KEY 未設定，無法輪詢任務狀態",
        };
      }

      const { falQueueFetchWithPrefixFallback } = await import(
        "../services/falQueueClient"
      );
      // Prefer fal's own status_url / response_url when we persisted them at
      // submit time — fal sometimes routes the queue tracking URL to a path
      // that's NOT a simple prefix of the submit URL (e.g. kling-video t2v
      // submits to /v2.1/standard/text-to-video but tracks at /kling-video/),
      // and modelId-based reconstruction can't recover that.
      const persistedStatusUrl =
        typeof meta.statusUrl === "string" ? meta.statusUrl : null;
      const persistedResponseUrl =
        typeof meta.responseUrl === "string" ? meta.responseUrl : null;

      type FalStatus = { status?: string; error?: string } | null;
      let statusData: FalStatus = null;
      try {
        const statusRes = persistedStatusUrl
          ? await fetch(persistedStatusUrl, {
              headers: { Authorization: `Key ${falKey}` },
            })
          : await falQueueFetchWithPrefixFallback(
              modelId,
              requestId,
              "/status",
              falKey
            );
        if (statusRes.ok) {
          statusData = (await statusRes.json()) as FalStatus;
        }
      } catch {
        // fal.ai 暫時不可用，保持 IN_PROGRESS — 下一輪輪詢會再試
      }

      const s = statusData?.status;

      if (s === "COMPLETED") {
        const { localizeResultUrls } = await import(
          "../services/internalMedia"
        );
        let resultData: Record<string, unknown> | null = null;
        try {
          const resultRes = persistedResponseUrl
            ? await fetch(persistedResponseUrl, {
                headers: { Authorization: `Key ${falKey}` },
              })
            : await falQueueFetchWithPrefixFallback(
                modelId,
                requestId,
                "",
                falKey
              );
          if (resultRes.ok) {
            resultData = (await resultRes.json()) as Record<string, unknown>;
          }
        } catch {
          // 結果端點偶發失敗 — 回 IN_PROGRESS，下一輪重試
          return {
            status: "IN_PROGRESS" as const,
            jobId: job.id,
            resultUrl: null as string | null,
            progress: 90,
            errorMessage: null as string | null,
          };
        }

        // 統一前綴：generated/studio/<userId>/director/<modelId>。所有 AI
        // 生成（包含導演 AI）走同一個 prefix 樹，使用者的資產才不會散落在
        // generated/director / generated/image-studio / generated/pro-studio …
        // 等不同分支。
        const { unifiedAssetPrefix } = await import(
          "../services/postGenActions"
        );
        const localized = (await localizeResultUrls(
          resultData,
          unifiedAssetPrefix({
            userId: ctx.user.id,
            source: "director",
            modelId,
          })
        )) as Record<string, unknown> | null;
        const r = localized;

        // URL 抽取邏輯與 routers.ts 的 webhookFal 對齊（涵蓋所有模態）
        const resultUrl =
          ((r?.images as { url?: string }[] | undefined)?.[0]?.url) ??
          ((r?.image as { url?: string } | undefined)?.url) ??
          (r?.image_url as string | undefined) ??
          ((r?.video as { url?: string } | undefined)?.url) ??
          (r?.video_url as string | undefined) ??
          ((r?.videos as { url?: string }[] | undefined)?.[0]?.url) ??
          ((r?.audio as { url?: string } | undefined)?.url) ??
          (r?.audio_url as string | undefined) ??
          ((r?.audio_file as { url?: string } | undefined)?.url) ??
          ((r?.output as { url?: string } | undefined)?.url) ??
          null;

        await dbModule.updateBackgroundJob(job.id, {
          status: "completed",
          progress: 100,
          progressMessage: "生成完成",
          resultJson: { ...meta, resultUrl, result: localized } as any,
        });

        // 後置動作（與 webhookFal、checkStudioJob 共用）：寫入提示詞庫、
        // 數位資產庫、生成歷史、AI 監控室。idempotent — webhook 與輪詢同時
        // 抵達時靠 resultJson.postGenComplete 旗標短路。
        // 沒這一段，導演 AI 生成的作品永遠不會進「我的資產」/「生成歷史」。
        const { runPostGenForJob } = await import(
          "../services/postGenActions"
        );
        void runPostGenForJob(job.id);

        return {
          status: "COMPLETED" as const,
          jobId: job.id,
          resultUrl: typeof resultUrl === "string" ? resultUrl : null,
          progress: 100,
          errorMessage: null as string | null,
        };
      }

      if (s === "FAILED") {
        const errMsg = String(
          statusData?.error ?? "fal.ai 回報任務失敗"
        );
        // 退回扣除的點數，並標記 job 失敗
        const { isDemoMode } = await import("../_core/googleAuth");
        if (!isDemoMode()) {
          // Prefer the exact `chargedPoints` snapshot persisted at deduction
          // time — recomputing via estimatePoints here drops voice's
          // charCount (it isn't part of params), which would refund less than
          // was charged. Fall back to the recompute path only when the
          // snapshot isn't present (older jobs created before this field
          // existed).
          const params = (meta as Record<string, unknown>) ?? {};
          const chargedPoints =
            typeof params.chargedPoints === "number" && params.chargedPoints > 0
              ? params.chargedPoints
              : null;
          if (chargedPoints !== null) {
            try {
              await dbModule.refundUserPoints(ctx.user.id, chargedPoints);
            } catch {
              /* 退款失敗時不阻擋 — 主要訴求是把任務標記為失敗 */
            }
          } else {
            const { estimatePoints } = await import("../services/modelPricing");
            const durationSec =
              typeof params.duration === "number"
                ? params.duration
                : typeof params.seconds_total === "number"
                  ? params.seconds_total
                  : undefined;
            try {
              const refund = estimatePoints(modelId, { durationSec });
              await dbModule.refundUserPoints(ctx.user.id, refund.totalPoints);
            } catch {
              /* 退款失敗時不阻擋 */
            }
          }
        }
        await dbModule.updateBackgroundJob(job.id, {
          status: "failed",
          errorMessage: errMsg,
        });
        return {
          status: "FAILED" as const,
          jobId: job.id,
          resultUrl: null as string | null,
          progress: job.progress ?? 0,
          errorMessage: errMsg,
        };
      }

      // IN_QUEUE / IN_PROGRESS / 任何 fal.ai 暫定狀態都當作 IN_PROGRESS
      return {
        status: "IN_PROGRESS" as const,
        jobId: job.id,
        resultUrl: null as string | null,
        progress: job.progress ?? 25,
        errorMessage: null as string | null,
      };
    }),

  /**
   * askForStudioPlan — 創作工作室向導演 AI 徵詢「下一步建議」。
   *
   * 接收 Studio 當前完整上下文（4 模態 prompt、選中模型、tokenWeights、LoRA、
   * 已啟用功能），導演 LLM 回傳一組 AgentAction[]，前端用 PageAgent
   * dispatchMany 直接執行（例如：建議切換模態、調整 prompt、套用 preset）。
   *
   * 全站光球代理 / 光球助手亦可透過 `studio-tool-bridge` 的 director.suggestPlan
   * 工具呼叫此端點，達成「光球請導演規劃 → 規劃結果回到工作室」雙向迴路。
   */
  askForStudioPlan: brainProcedure
    .input(
      z.object({
        /** 當前活躍的模態 */
        activeModality: z.enum(["image", "video", "audio", "voice"]),
        /** 四模態各自的提示詞快照（rawPrompt + 是否有 token weight） */
        prompts: z.object({
          image: z.string().default(""),
          video: z.string().default(""),
          audio: z.string().default(""),
          voice: z.string().default(""),
        }),
        /** 使用者選定的 fal.ai 模型 ID */
        selectedFalModelId: z.string().nullable().optional(),
        /** 是否啟用了自注意力（token weights） */
        hasTokenWeights: z.boolean().default(false),
        /** 是否啟用了微調 LoRA 模型 */
        hasFineTunedModel: z.boolean().default(false),
        /** 圖片畫面比例（若 activeModality === "image"） */
        aspectRatio: z.string().optional(),
        /** 使用者用自然語言描述他想做什麼（可選） */
        userIntent: z.string().max(2000).optional(),
        /** 個性風格 */
        personality: z
          .enum(["calm", "creative", "technical"])
          .default("creative"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const director = ctx.brain.getBrain("director");

      const systemPrompt = `你是「導演 AI」，使用者正在創作工作室裡建立內容。
你的任務：根據使用者當前的工作室狀態，建議下一步行動。

回傳格式（嚴格）：
{
  "actions": [
    { "type": "navigate", "path": "/video-studio|/image-studio|/pro-studio" },
    { "type": "setModality", "modality": "image|video|audio|voice" },
    { "type": "setTab", "tabId": "t2v|i2v|v2v|t2i|i2i|music|voice" },
    { "type": "setMode", "modeId": "lightning|deep_precision|inspiration|standard|professional" },
    { "type": "setModel", "modelId": "fal-ai/..." },
    { "type": "fillPrompt", "text": "...", "slot": "prompt|negativePrompt|lyrics|voice", "append": false },
    { "type": "setParam", "key": "duration|aspectRatio|cfgScale|...", "value": "..." },
    { "type": "applyPreset", "presetId": "creative:simple|creative:standard|creative:pro" },
    { "type": "submit" }
  ],
  "rationale": "簡短中文說明為什麼這樣建議"
}

規範：
- 最多回 6 個 actions（含 submit 才算一次完整流程）
- 風格 = ${input.personality}
- 若使用者已輸入提示詞但模態錯了，建議切到正確模態
- 若使用者啟用了自注意力但選了不支援的模型，建議切到 SD 系列
- 影片創作室預設 t2v 引擎為 fal-ai/kling-video/v2.1/standard/text-to-video（中文語意理解最佳）；
  若使用者明確要求 720p 開源／多語言，可改用 fal-ai/wan-t2v；要求音訊同步輸出可用 fal-ai/veo3
- 編排 Kling 流程的標準順序：navigate → setModality(video) → setTab(t2v) → setModel(kling) → fillPrompt → setParam(duration/aspectRatio) →（使用者確認後）submit
- 在使用者尚未確認前不要直接送出 submit；只有 userIntent 明確要求「直接生成」「立即輸出」時才附上 submit
- 不要回多餘內容，只回 JSON

${director.systemPrompt ? `\n附加大腦指令：\n${director.systemPrompt}` : ""}`;

      const studioContext = `
當前活躍模態：${input.activeModality}
選中模型：${input.selectedFalModelId ?? "(未指定)"}
畫面比例：${input.aspectRatio ?? "未設定"}
啟用自注意力：${input.hasTokenWeights ? "是" : "否"}
使用微調 LoRA：${input.hasFineTunedModel ? "是" : "否"}

四模態提示詞快照：
- 圖片：${input.prompts.image.slice(0, 200) || "(空)"}
- 影片：${input.prompts.video.slice(0, 200) || "(空)"}
- 音樂：${input.prompts.audio.slice(0, 200) || "(空)"}
- 語音：${input.prompts.voice.slice(0, 200) || "(空)"}

使用者想做什麼：${input.userIntent || "(未說明，請根據上述狀態主動建議)"}
`.trim();

      const llmResponse = await invokeLLM({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: studioContext },
        ],
        model: director.model,
        temperature: director.temperature,
        topP: director.topP,
        responseFormat: { type: "json_object" },
      });

      const text = extractMessageText(
        llmResponse.choices[0]?.message?.content
      );

      const extracted = extractJsonObjectFromText(text);
      if (!extracted || typeof extracted !== "object") {
        const trimmed = text.trim();
        return {
          actions: [] as AgentAction[],
          rationale: trimmed
            ? trimmed.slice(0, 400)
            : "導演沒有回應，請稍後再試",
          rawResponse: text.slice(0, 1000),
        };
      }

      const parsed = extracted as { actions?: unknown; rationale?: string };
      const actions = parseLLMActions(parsed.actions);
      return {
        actions,
        rationale:
          typeof parsed.rationale === "string" ? parsed.rationale : "",
        rawResponse: undefined as string | undefined,
      };
    }),

  /**
   * fetchTrendingInspiration — 即時靈感 / 時事 / 社群偏好查詢
   * ────────────────────────────────────────────────────────────────────────
   * 給導演 AI 的「靈感卡片」UI 用：輸入主題 + 模態 + 視角，回傳一組
   * Perplexity Sonar 即時搜尋來的靈感卡片（每張附引用來源 URL）。
   *
   * 使用情境：
   *   - 導演 AI 對話前，使用者點「我想做最近流行的」按鈕
   *   - 圖像 / 影片 / 音樂工作室空白畫面顯示「今天的靈感」
   *   - 光球聊天中使用者問「最近大家在做什麼風格」直接 mutateAsync 後回傳
   *
   * 路由策略：原生 Perplexity API 優先（PERPLEXITY_API_KEY），失敗時降級到
   * OpenRouter Sonar（OPENROUTER_API_KEY）。兩個都缺時 ok=false。
   */
  fetchTrendingInspiration: brainProcedure
    .input(
      z.object({
        topic: z.string().min(2).max(200),
        modality: z
          .enum(["image", "video", "audio", "voice", "3d", "general"])
          .optional(),
        angle: z
          .enum(["trending", "community", "news", "seasonal", "model_release"])
          .optional(),
        format: z
          .enum([
            "visual_styles",
            "prompt_keywords",
            "mood_board",
            "quick_facts",
          ])
          .optional(),
        maxResults: z.number().int().min(1).max(8).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { fetchInspiration } = await import(
        "../services/inspirationFetcher"
      );
      // 帶 userId 進去讓 perplexityThrottle 計入 per-user hourly / daily 配額
      const result = await fetchInspiration({ ...input, userId: ctx.user.id });
      return result;
    }),

  /**
   * perplexityThrottleStatus — 給 UI 看當前 Perplexity 配額狀態
   * ────────────────────────────────────────────────────────────────────────
   * 回傳：
   *   - masterEnabled: 主開關是否打開
   *   - features: 5 個子功能個別是否啟用
   *   - limits: 環境變數設定的上限（per-user-hour / per-user-day / global-min）
   *   - user.usedLastHour / usedLastDay: 當前使用者已用次數
   *   - user.remainingHour / remainingDay: 剩餘配額（Infinity = 不限制）
   *   - globalUsedLastMinute: 全站最近一分鐘總用量
   *
   * UI 使用情境：
   *   - 導演 / 光球面板顯示「今日靈感查詢還剩 X 次」
   *   - 「即時趨勢」按鈕在配額用盡時 disable
   *   - 管理員後台監看是否需要調整 env 上限
   */
  perplexityThrottleStatus: brainProcedure.query(async ({ ctx }) => {
    const { getPerplexityThrottleStatus } = await import(
      "../services/perplexityThrottle"
    );
    const status = getPerplexityThrottleStatus(ctx.user.id);
    // Number.POSITIVE_INFINITY 不能直接 JSON 序列化（會變成 null），改回 -1
    // 表示「不限制」讓 client 可以判斷。
    const sanitize = (n: number): number =>
      Number.isFinite(n) ? n : -1;
    return {
      masterEnabled: status.masterEnabled,
      features: status.features,
      limits: status.limits,
      globalUsedLastMinute: status.globalUsedLastMinute,
      user: status.user
        ? {
            usedLastHour: status.user.usedLastHour,
            usedLastDay: status.user.usedLastDay,
            remainingHour: sanitize(status.user.remainingHour),
            remainingDay: sanitize(status.user.remainingDay),
          }
        : null,
    };
  }),
});
