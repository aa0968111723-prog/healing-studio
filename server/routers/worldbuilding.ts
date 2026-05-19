/**
 * Worldbuilding Router — 導演 AI 的自訂世界觀架構器
 *
 * 提供 CRUD 端點，以及一個 `linkableModels` query
 * 回傳當前使用者已訓練完成（status = ready）的 LoRA 模型清單，
 * 供前端在角色卡 / 場景卡中下拉選擇。
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import {
  worldbuildingFrameworkInputSchema,
  summarizeFrameworkForPrompt,
  buildCharacterConsistencyPrompt,
  buildSceneConsistencyPrompt,
  buildGlobalNegativePrompt,
  type WorldbuildingFrameworkData,
} from "../../shared/worldbuilding-types";
import { VOICE_MODEL_REGISTRY } from "../../shared/voiceModelRegistry";

function rowToData(row: NonNullable<Awaited<ReturnType<typeof db.getWorldbuildingFramework>>>): WorldbuildingFrameworkData & {
  id: number;
  createdAt: Date;
  updatedAt: Date;
} {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    genre: row.genre ?? undefined,
    era: row.era ?? undefined,
    characters: (row.charactersJson ?? []) as WorldbuildingFrameworkData["characters"],
    scenes: (row.scenesJson ?? []) as WorldbuildingFrameworkData["scenes"],
    objects: (row.objectsJson ?? undefined) as
      | WorldbuildingFrameworkData["objects"]
      | undefined,
    linkedModelIds: (row.linkedModelIds ?? undefined) as number[] | undefined,
    styleProfiles:
      (row.styleProfilesJson ?? undefined) as
        | WorldbuildingFrameworkData["styleProfiles"]
        | undefined,
    musicThemes:
      (row.musicThemesJson ?? undefined) as
        | WorldbuildingFrameworkData["musicThemes"]
        | undefined,
    defaultStyleProfileId: row.defaultStyleProfileId ?? null,
    globalNegativePrompt: row.globalNegativePrompt ?? undefined,
    productionTargets:
      (row.productionTargetsJson ?? undefined) as
        | WorldbuildingFrameworkData["productionTargets"]
        | undefined,
    researchEntries:
      (row.researchEntriesJson ?? undefined) as
        | WorldbuildingFrameworkData["researchEntries"]
        | undefined,
    soundLibrary:
      (row.soundLibraryJson ?? undefined) as
        | WorldbuildingFrameworkData["soundLibrary"]
        | undefined,
    uploadedAssets:
      (row.uploadedAssetsJson ?? undefined) as
        | WorldbuildingFrameworkData["uploadedAssets"]
        | undefined,
    tags: (row.tags ?? undefined) as string[] | undefined,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const worldbuildingRouter = router({
  /** 列出當前使用者的所有世界觀 */
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db.getWorldbuildingFrameworksByUser(ctx.user.id);
    return rows.map(rowToData);
  }),

  /** 取得單一世界觀 */
  get: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const row = await db.getWorldbuildingFramework(input.id);
      if (!row || row.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return rowToData(row);
    }),

  /** 建立新世界觀 */
  create: protectedProcedure
    .input(worldbuildingFrameworkInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const id = await db.createWorldbuildingFramework({
          userId: ctx.user.id,
          name: input.name,
          description: input.description,
          genre: input.genre,
          era: input.era,
          charactersJson: input.characters,
          scenesJson: input.scenes,
          objectsJson: input.objects ?? [],
          linkedModelIds: input.linkedModelIds ?? [],
          styleProfilesJson: input.styleProfiles ?? [],
          musicThemesJson: input.musicThemes ?? [],
          defaultStyleProfileId: input.defaultStyleProfileId ?? null,
          globalNegativePrompt: input.globalNegativePrompt,
          productionTargetsJson: input.productionTargets ?? null,
          researchEntriesJson: input.researchEntries ?? [],
          soundLibraryJson: input.soundLibrary ?? [],
          uploadedAssetsJson: input.uploadedAssets ?? [],
          tags: input.tags ?? [],
          isActive: input.isActive ?? true,
        });
        return { id };
      } catch (error) {
        // Drizzle 的 DrizzleQueryError.message 只包含 SQL 與 params、不含
        // 底層 MySQL 錯誤原因（Unknown column / Data too long…）。把 cause
        // 拉出來重拋成 TRPCError，前端的 toast 才看得到真正的失敗原因。
        const cause = (error as { cause?: { code?: string; message?: string } })
          ?.cause;
        const reason = cause?.message ?? (error as Error).message;
        const code = cause?.code ? ` [${cause.code}]` : "";
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `建立世界觀失敗${code}：${reason}`,
          cause: error,
        });
      }
    }),

  /** 更新既有世界觀 */
  update: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        patch: worldbuildingFrameworkInputSchema.partial(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await db.getWorldbuildingFramework(input.id);
      if (!existing || existing.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const p = input.patch;
      await db.updateWorldbuildingFramework(input.id, {
        ...(p.name !== undefined ? { name: p.name } : {}),
        ...(p.description !== undefined ? { description: p.description } : {}),
        ...(p.genre !== undefined ? { genre: p.genre } : {}),
        ...(p.era !== undefined ? { era: p.era } : {}),
        ...(p.characters !== undefined
          ? { charactersJson: p.characters }
          : {}),
        ...(p.scenes !== undefined ? { scenesJson: p.scenes } : {}),
        ...(p.objects !== undefined ? { objectsJson: p.objects } : {}),
        ...(p.linkedModelIds !== undefined
          ? { linkedModelIds: p.linkedModelIds }
          : {}),
        ...(p.styleProfiles !== undefined
          ? { styleProfilesJson: p.styleProfiles }
          : {}),
        ...(p.musicThemes !== undefined
          ? { musicThemesJson: p.musicThemes }
          : {}),
        ...(p.defaultStyleProfileId !== undefined
          ? { defaultStyleProfileId: p.defaultStyleProfileId }
          : {}),
        ...(p.globalNegativePrompt !== undefined
          ? { globalNegativePrompt: p.globalNegativePrompt }
          : {}),
        ...(p.productionTargets !== undefined
          ? { productionTargetsJson: p.productionTargets }
          : {}),
        ...(p.researchEntries !== undefined
          ? { researchEntriesJson: p.researchEntries }
          : {}),
        ...(p.soundLibrary !== undefined
          ? { soundLibraryJson: p.soundLibrary }
          : {}),
        ...(p.uploadedAssets !== undefined
          ? { uploadedAssetsJson: p.uploadedAssets }
          : {}),
        ...(p.tags !== undefined ? { tags: p.tags } : {}),
        ...(p.isActive !== undefined ? { isActive: p.isActive } : {}),
      });
      return { ok: true };
    }),

  /** 刪除世界觀 */
  delete: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.getWorldbuildingFramework(input.id);
      if (!existing || existing.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await db.deleteWorldbuildingFramework(input.id);
      return { ok: true };
    }),

  /**
   * 列出當前使用者已訓練完成、可以被角色 / 場景連結的 LoRA 模型清單。
   * 從模型訓練中心（fine_tuned_models）撈出 status=ready 的條目。
   */
  linkableModels: protectedProcedure.query(async ({ ctx }) => {
    const models = await db.getFineTunedModelsByUser(ctx.user.id);
    return models
      .filter(m => m.status === "ready" || m.status === "training")
      .map(m => {
        const config = (m.configJson ?? {}) as Record<string, unknown>;
        return {
          id: m.id,
          name: m.name,
          modelType: m.modelType,
          status: m.status,
          triggerWord: (config.triggerWord as string | undefined) ?? null,
        };
      });
  }),

  /** 列出可繫結到角色 voiceProfile 的語音模型（給 select 用） */
  linkableVoices: protectedProcedure.query(() => {
    return VOICE_MODEL_REGISTRY.map(v => ({
      modelId: v.modelId,
      label: v.label,
      provider: v.provider,
      category: v.category ?? null,
      strengths: v.strengths,
    }));
  }),

  /**
   * 將一個世界觀壓縮成 LLM-friendly 純文字 —
   * 給導演 AI / Studio / 動畫管線在生成前注入 system prompt 用。
   * 同時回傳角色 / 場景的 consistency prefix 字典與全域 negative prompt。
   */
  summarizeForPrompt: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const row = await db.getWorldbuildingFramework(input.id);
      if (!row || row.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const data = rowToData(row);
      const characterPrefixes: Record<string, string> = {};
      for (const c of data.characters) {
        characterPrefixes[c.id] = buildCharacterConsistencyPrompt(c);
      }
      const scenePrefixes: Record<string, string> = {};
      for (const s of data.scenes) {
        const sp = data.styleProfiles?.find(
          p =>
            p.id === (s.styleProfileId ?? data.defaultStyleProfileId)
        );
        scenePrefixes[s.id] = buildSceneConsistencyPrompt(s, sp);
      }
      return {
        summary: summarizeFrameworkForPrompt(data),
        characterPrefixes,
        scenePrefixes,
        globalNegativePrompt: buildGlobalNegativePrompt(data),
      };
    }),

  /**
   * AI 代理可呼叫的「資料庫查詢」端點 ——
   * 跨角色 / 場景 / 物件 / 研究資料庫 / 真實參考做文字相似度比對，
   * 回傳 top-K 結果。
   *
   * 應用：光球代理（director / image-specialist / voice-specialist）在
   * 聊天時可問「主角的劍叫什麼？」「這場有哪些歷史參考？」直接查得到。
   */
  queryEntities: protectedProcedure
    .input(
      z.object({
        worldId: z.number().int().positive().optional(),
        query: z.string().min(1).max(500),
        entityTypes: z
          .array(
            z.enum([
              "character",
              "scene",
              "object",
              "research",
              "real_world_ref",
              "sound",
            ])
          )
          .optional(),
        limit: z.number().int().min(1).max(50).default(10),
      })
    )
    .query(async ({ ctx, input }) => {
      const rows = input.worldId
        ? [await db.getWorldbuildingFramework(input.worldId)].filter(
            (r): r is NonNullable<typeof r> => !!r && r.userId === ctx.user.id
          )
        : await db.getWorldbuildingFrameworksByUser(ctx.user.id);

      const wantedTypes = new Set(
        input.entityTypes ?? [
          "character",
          "scene",
          "object",
          "research",
          "real_world_ref",
          "sound",
        ]
      );
      const q = input.query.toLowerCase();

      type Hit = {
        type: string;
        worldId: number;
        worldName: string;
        entityId: string;
        title: string;
        snippet: string;
        score: number;
        raw: Record<string, unknown>;
      };
      const hits: Hit[] = [];

      function score(haystack: string): number {
        const h = haystack.toLowerCase();
        if (h.includes(q)) return 1 + Math.min(1, q.length / 30);
        // token overlap
        const tokens = q.split(/\s+/).filter(Boolean);
        let s = 0;
        for (const t of tokens) if (t && h.includes(t)) s += 0.4;
        return s;
      }

      function push(
        hit: Omit<Hit, "score">,
        haystack: string
      ) {
        const s = score(haystack);
        if (s > 0) hits.push({ ...hit, score: s });
      }

      for (const w of rows) {
        const data = rowToData(w);
        if (wantedTypes.has("character"))
          for (const c of data.characters) {
            const hay = [
              c.name,
              c.tagline,
              c.appearance,
              c.personality,
              c.backstory,
              c.outfit,
              ...(c.likes ?? []),
              ...(c.interests ?? []),
              c.notes,
            ]
              .filter(Boolean)
              .join(" ");
            push(
              {
                type: "character",
                worldId: w.id,
                worldName: w.name,
                entityId: c.id,
                title: c.name,
                snippet:
                  c.tagline ?? c.personality ?? c.appearance ?? "(未填)",
                raw: c as unknown as Record<string, unknown>,
              },
              hay
            );

            // 也搜尋角色內的 realWorldRefs
            if (wantedTypes.has("real_world_ref"))
              for (const r of c.realWorldRefs ?? []) {
                const refHay = [
                  r.label,
                  r.personName,
                  r.description,
                  r.citation,
                ]
                  .filter(Boolean)
                  .join(" ");
                push(
                  {
                    type: "real_world_ref",
                    worldId: w.id,
                    worldName: w.name,
                    entityId: `${c.id}:${r.id}`,
                    title: `${c.name} → ${r.label}`,
                    snippet: r.description ?? r.personName ?? "(未填)",
                    raw: r as unknown as Record<string, unknown>,
                  },
                  refHay
                );
              }
          }

        if (wantedTypes.has("scene"))
          for (const s of data.scenes) {
            const hay = [
              s.name,
              s.tagline,
              s.environment,
              s.mood,
              s.lighting,
              ...(s.flora ?? []),
              ...(s.fauna ?? []),
              ...(s.props ?? []),
              s.notes,
            ]
              .filter(Boolean)
              .join(" ");
            push(
              {
                type: "scene",
                worldId: w.id,
                worldName: w.name,
                entityId: s.id,
                title: s.name,
                snippet: s.tagline ?? s.environment ?? "(未填)",
                raw: s as unknown as Record<string, unknown>,
              },
              hay
            );

            // 場景內的 realWorldRefs
            if (wantedTypes.has("real_world_ref"))
              for (const r of s.realWorldRefs ?? []) {
                const refHay = [
                  r.label,
                  r.description,
                  r.citation,
                  r.yearOfReference,
                ]
                  .filter(Boolean)
                  .join(" ");
                push(
                  {
                    type: "real_world_ref",
                    worldId: w.id,
                    worldName: w.name,
                    entityId: `${s.id}:${r.id}`,
                    title: `${s.name} → ${r.label}`,
                    snippet: r.description ?? "(未填)",
                    raw: r as unknown as Record<string, unknown>,
                  },
                  refHay
                );
              }
          }

        if (wantedTypes.has("object"))
          for (const o of data.objects ?? []) {
            const hay = [
              o.name,
              o.category,
              o.description,
              o.visualTraits,
              o.notes,
            ]
              .filter(Boolean)
              .join(" ");
            push(
              {
                type: "object",
                worldId: w.id,
                worldName: w.name,
                entityId: o.id,
                title: o.name,
                snippet: o.description ?? o.category ?? "(未填)",
                raw: o as unknown as Record<string, unknown>,
              },
              hay
            );
          }

        if (wantedTypes.has("research"))
          for (const r of data.researchEntries ?? []) {
            const hay = [
              r.title,
              r.category,
              r.content,
              r.citation,
              ...(r.tags ?? []),
            ]
              .filter(Boolean)
              .join(" ");
            push(
              {
                type: "research",
                worldId: w.id,
                worldName: w.name,
                entityId: r.id,
                title: r.title,
                snippet: (r.content ?? "").slice(0, 200),
                raw: r as unknown as Record<string, unknown>,
              },
              hay
            );
          }

        if (wantedTypes.has("sound"))
          for (const sd of data.soundLibrary ?? []) {
            const hay = [
              sd.label,
              sd.category,
              sd.description,
              ...(sd.tags ?? []),
              ...(sd.triggers ?? []),
            ]
              .filter(Boolean)
              .join(" ");
            push(
              {
                type: "sound",
                worldId: w.id,
                worldName: w.name,
                entityId: sd.id,
                title: sd.label,
                snippet: `${sd.category ?? "—"} · ${sd.description ?? ""}`,
                raw: sd as unknown as Record<string, unknown>,
              },
              hay
            );
          }
      }

      hits.sort((a, b) => b.score - a.score);
      return hits.slice(0, input.limit);
    }),

  /**
   * 把世界觀完整匯出成 JSON —— 給離線備份、跨環境遷移、版本控管用。
   * 含所有 v2/v3/v4 欄位，但不含資產的實際檔案（只含 URL 引用）。
   */
  exportFull: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const row = await db.getWorldbuildingFramework(input.id);
      if (!row || row.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const data = rowToData(row);
      return {
        exportFormat: "worldbuilding/v4",
        exportedAt: new Date().toISOString(),
        framework: data,
      };
    }),

  /**
   * 匯入世界觀 JSON —— 從備份或他人分享的 JSON 還原為新的世界觀。
   * 不覆蓋既有世界，總是建立新的（id 由 DB 重新分配）。
   */
  importFull: protectedProcedure
    .input(
      z.object({
        framework: worldbuildingFrameworkInputSchema,
        renameSuffix: z.string().max(64).optional().default("（匯入）"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const fw = input.framework;
      const id = await db.createWorldbuildingFramework({
        userId: ctx.user.id,
        name: `${fw.name}${input.renameSuffix ?? ""}`,
        description: fw.description,
        genre: fw.genre,
        era: fw.era,
        charactersJson: fw.characters,
        scenesJson: fw.scenes,
        objectsJson: fw.objects ?? [],
        linkedModelIds: fw.linkedModelIds ?? [],
        styleProfilesJson: fw.styleProfiles ?? [],
        musicThemesJson: fw.musicThemes ?? [],
        defaultStyleProfileId: fw.defaultStyleProfileId ?? null,
        globalNegativePrompt: fw.globalNegativePrompt,
        productionTargetsJson: fw.productionTargets ?? null,
        researchEntriesJson: fw.researchEntries ?? [],
        soundLibraryJson: fw.soundLibrary ?? [],
        uploadedAssetsJson: fw.uploadedAssets ?? [],
        tags: fw.tags ?? [],
        isActive: fw.isActive ?? true,
      });
      return { id };
    }),
});
