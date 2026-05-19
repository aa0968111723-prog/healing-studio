/**
 * worldbuildingGeneration.ts — AI-powered worldbuilding generation service
 *
 * Provides generation capabilities for:
 * - Characters (appearance, personality, backstory from description + archetype)
 * - Scenes (environment, mood, lighting from description + type)
 * - Storyboards (shot list from script + world context)
 *
 * Integrates with:
 * - LLM service (for structured generation)
 * - worldbuilding.ts (to persist generated entities)
 */

import { z } from "zod";
import { publicProcedure, router } from "../trpc";
import { db } from "../../db";
import { TRPCError } from "@trpc/server";
import type {
  WorldCharacter,
  WorldScene,
} from "../../shared/worldbuilding-types";
import type { WorldStoryboard } from "../../shared/worldbuilding-animation";

/**
 * Generate a character based on description and optional archetype.
 * Returns structured character data ready to be added to a world.
 */
async function generateCharacter(params: {
  worldId: number;
  description: string;
  archetype?: string;
}): Promise<WorldCharacter> {
  // TODO: Call LLM service with structured output schema
  // For now, return a basic template with the description
  const uid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id: uid,
    name: params.description.split(/[\s,]/)[0] || "新角色",
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

/**
 * Generate a scene based on description and optional environment type.
 * Returns structured scene data ready to be added to a world.
 */
async function generateScene(params: {
  worldId: number;
  description: string;
  environmentType?: string;
}): Promise<WorldScene> {
  // TODO: Call LLM service with structured output schema
  const uid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id: uid,
    name: params.description.split(/[\s,]/)[0] || "新場景",
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

/**
 * Generate a storyboard from script and world context.
 * Returns shot list with scene assignments and camera directions.
 */
async function generateStoryboard(params: {
  worldId: number;
  scriptId?: number;
  description: string;
}): Promise<Partial<WorldStoryboard>> {
  // TODO: Call LLM service to parse script and generate shot sequence
  return {
    name: params.description.substring(0, 30) || "新分鏡",
    description: params.description,
    scenes: [],
    aspectRatio: "16:9",
    fps: 24,
  };
}

export const worldbuildingGenerationRouter = router({
  /**
   * Generate a character and add it to the specified world
   */
  generateCharacter: publicProcedure
    .input(
      z.object({
        worldId: z.number(),
        description: z.string().min(1),
        archetype: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Verify world exists and user has access
      const world = await db
        .selectFrom("worldbuilding_framework")
        .where("id", "=", input.worldId)
        .where("userId", "=", ctx.userId)
        .selectAll()
        .executeTakeFirst();

      if (!world) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "World not found or access denied",
        });
      }

      // Generate character
      const character = await generateCharacter(input);

      // Add to world
      const data = world.data as any;
      const characters = data.characters || [];
      characters.push(character);

      await db
        .updateTable("worldbuilding_framework")
        .set({
          data: JSON.stringify({ ...data, characters }),
          updated_at: new Date(),
        })
        .where("id", "=", input.worldId)
        .execute();

      return { character };
    }),

  /**
   * Generate a scene and add it to the specified world
   */
  generateScene: publicProcedure
    .input(
      z.object({
        worldId: z.number(),
        description: z.string().min(1),
        environmentType: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const world = await db
        .selectFrom("worldbuilding_framework")
        .where("id", "=", input.worldId)
        .where("userId", "=", ctx.userId)
        .selectAll()
        .executeTakeFirst();

      if (!world) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "World not found or access denied",
        });
      }

      const scene = await generateScene(input);

      const data = world.data as any;
      const scenes = data.scenes || [];
      scenes.push(scene);

      await db
        .updateTable("worldbuilding_framework")
        .set({
          data: JSON.stringify({ ...data, scenes }),
          updated_at: new Date(),
        })
        .where("id", "=", input.worldId)
        .execute();

      return { scene };
    }),

  /**
   * Generate a storyboard from script or description
   */
  generateStoryboard: publicProcedure
    .input(
      z.object({
        worldId: z.number(),
        scriptId: z.number().optional(),
        description: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const world = await db
        .selectFrom("worldbuilding_framework")
        .where("id", "=", input.worldId)
        .where("userId", "=", ctx.userId)
        .selectAll()
        .executeTakeFirst();

      if (!world) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "World not found or access denied",
        });
      }

      const storyboardData = await generateStoryboard(input);

      // Create storyboard record
      const result = await db
        .insertInto("world_storyboard")
        .values({
          user_id: ctx.userId,
          world_id: input.worldId,
          name: storyboardData.name || "新分鏡",
          description: storyboardData.description,
          data: JSON.stringify(storyboardData),
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning("id")
        .executeTakeFirst();

      return { storyboardId: result?.id, storyboard: storyboardData };
    }),
});
