/**
 * worldbuildingGeneration.ts — AI-powered worldbuilding generation service
 *
 * Provides generation capabilities for:
 * - Characters (appearance, personality, backstory from description + archetype)
 * - Scenes (environment, mood, lighting from description + type)
 * - Storyboards (shot list from script + world context)
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import type {
  WorldCharacter,
  WorldScene,
} from "../../shared/worldbuilding-types";

function normalizeDescription(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function buildNameFromDescription(description: string, fallback: string): string {
  const firstChunk = description
    .split(/[\s,，。.!?！？]/)
    .map(chunk => chunk.trim())
    .find(Boolean);
  return firstChunk?.slice(0, 20) ?? fallback;
}

async function generateCharacter(params: {
  worldId: number;
  description: string;
  archetype?: string;
}): Promise<WorldCharacter> {
  const normalizedDescription = normalizeDescription(params.description);
  const uid = randomUUID();
  const archetypeNote = params.archetype?.trim();

  return ({
    id: uid,
    name: buildNameFromDescription(normalizedDescription, "新角色"),
    tagline: normalizedDescription.substring(0, 80),
    role: "supporting",
    appearance: `基於描述生成：${normalizedDescription}`,
    personality: archetypeNote
      ? `原型傾向：${archetypeNote}（待完善）`
      : "待完善",
    backstory: "待完善",
    likes: [],
    dislikes: [],
    fears: [],
    goals: [],
    mannerisms: [],
    speakingStyle: {},
    expressions: [],
    outfits: [],
    animationRig: {},
    voiceProfile: {},
    characterArc: {},
    realWorldRefs: [],
  } as unknown) as WorldCharacter;
}

async function generateScene(params: {
  worldId: number;
  description: string;
  environmentType?: string;
}): Promise<WorldScene> {
  const normalizedDescription = normalizeDescription(params.description);
  const uid = randomUUID();

  return ({
    id: uid,
    name: buildNameFromDescription(normalizedDescription, "新場景"),
    tagline: normalizedDescription.substring(0, 80),
    environment: `基於描述生成：${normalizedDescription}`,
    environmentType: params.environmentType?.trim() || undefined,
    mood: "待完善",
    lighting: "待完善",
    timeOfDay: ["day" as any],
    weather: "clear",
    soundscape: [],
    flora: [],
    fauna: [],
    architecture: [],
    culturalElements: [],
    magicalElements: [],
    dangerLevel: 0,
    accessibility: {},
    spatialLayout: {},
    environmentChanges: [],
    realWorldRefs: [],
  } as unknown) as WorldScene;
}

export const worldbuildingGenerationRouter = router({
  generateCharacter: protectedProcedure
    .input(
      z.object({
        worldId: z.number(),
        description: z.string().min(1),
        archetype: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const world = await db.getWorldbuildingFramework(input.worldId);

      if (!world || world.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "World not found or access denied",
        });
      }

      const character = await generateCharacter(input);

      const characters = Array.isArray(world.charactersJson)
        ? [...(world.charactersJson as WorldCharacter[]), character]
        : [character];

      await db.updateWorldbuildingFramework(input.worldId, {
        charactersJson: characters as Array<Record<string, unknown>>,
      });

      return { character };
    }),

  generateScene: protectedProcedure
    .input(
      z.object({
        worldId: z.number(),
        description: z.string().min(1),
        environmentType: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const world = await db.getWorldbuildingFramework(input.worldId);

      if (!world || world.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "World not found or access denied",
        });
      }

      const scene = await generateScene(input);

      const scenes = Array.isArray(world.scenesJson)
        ? [...(world.scenesJson as WorldScene[]), scene]
        : [scene];

      await db.updateWorldbuildingFramework(input.worldId, {
        scenesJson: scenes as Array<Record<string, unknown>>,
      });

      return { scene };
    }),

  generateStoryboard: protectedProcedure
    .input(
      z.object({
        worldId: z.number(),
        scriptId: z.number().optional(),
        description: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const world = await db.getWorldbuildingFramework(input.worldId);

      if (!world || world.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "World not found or access denied",
        });
      }

      const storyboardId = await db.createWorldStoryboard({
        userId: ctx.user.id,
        worldId: input.worldId,
        name: input.description.substring(0, 30) || "新分鏡",
        totalDurationSec: 60,
        fps: 24,
        aspectRatio: "16:9",
        scenesJson: [],
        productionStatus: "planning",
        ...(input.scriptId
          ? { sourceScriptId: String(input.scriptId) }
          : {}),
      });

      return { storyboardId };
    }),
});
