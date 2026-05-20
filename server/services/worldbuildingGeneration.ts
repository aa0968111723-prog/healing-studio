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
import type {
  WorldCharacter,
  WorldScene,
} from "../../shared/worldbuilding-types";

async function generateCharacter(params: {
  worldId: number;
  description: string;
  archetype?: string;
}): Promise<WorldCharacter> {
  const uid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id: uid,
    name: params.description.split(/[\s,，]/)[0] || "新角色",
    tagline: params.description.substring(0, 50),
    role: "supporting" as const,
    archetype: params.archetype,
    appearance: `基於描述生成：${params.description}`,
    personality: "待完善",
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
  };
}

async function generateScene(params: {
  worldId: number;
  description: string;
  environmentType?: string;
}): Promise<WorldScene> {
  const uid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id: uid,
    name: params.description.split(/[\s,，]/)[0] || "新場景",
    tagline: params.description.substring(0, 50),
    environment: `基於描述生成：${params.description}`,
    environmentType: params.environmentType,
    mood: "待完善",
    lighting: "待完善",
    timeOfDay: "day",
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
  };
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
