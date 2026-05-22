/**
 * worldbuildingGeneration.ts — AI-powered worldbuilding generation service
 *
 * - generateCharacter / generateScene 都會呼叫 LLM 並回傳結構化結果，
 *   寫回 worldbuilding_frameworks 的 charactersJson / scenesJson。
 * - 生成範圍只涵蓋「敘事必填欄位」（名稱、角色定位、外觀、背景、氛圍…），
 *   不嘗試填動畫製作層的進階欄位（rigSpec、lipSyncSet、productionDesign…），
 *   那些留給使用者後續手動或專門工具補上。
 * - generateStoryboard 只建分鏡骨架（DB row），不在這層做 AI。
 */

import { z } from "zod";
import { brainProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import { invokeLLM } from "../_core/llm";
import { withTimeout, extractMessageJson } from "./director/templates";
import type {
  WorldCharacter,
  WorldScene,
} from "../../shared/worldbuilding-types";

const CHARACTER_ROLES = ["protagonist", "supporting", "antagonist", "npc"] as const;

const characterSchema = z.object({
  name: z.string().min(1),
  role: z.enum(CHARACTER_ROLES),
  tagline: z.string(),
  personality: z.string(),
  appearance: z.string(),
  backstory: z.string(),
  likes: z.array(z.string()),
  interests: z.array(z.string()),
  signatureItems: z.array(z.string()),
  notes: z.string(),
});

const sceneSchema = z.object({
  name: z.string().min(1),
  tagline: z.string(),
  environment: z.string(),
  mood: z.string(),
  lighting: z.string(),
  flora: z.array(z.string()),
  fauna: z.array(z.string()),
  props: z.array(z.string()),
  environmentChanges: z.array(z.string()),
  notes: z.string(),
});

function buildWorldContext(world: {
  name: string;
  description?: string | null;
  genre?: string | null;
  era?: string | null;
  charactersJson?: unknown;
  scenesJson?: unknown;
}): string {
  const lines = [`名稱：${world.name}`];
  if (world.description) lines.push(`描述：${world.description}`);
  if (world.genre) lines.push(`類型：${world.genre}`);
  if (world.era) lines.push(`時代：${world.era}`);

  const existingCharacters = Array.isArray(world.charactersJson)
    ? (world.charactersJson as Array<{ name?: string }>)
        .map(c => c?.name)
        .filter((n): n is string => Boolean(n))
    : [];
  if (existingCharacters.length) {
    lines.push(`已有角色（避免重名與重複設定）：${existingCharacters.join("、")}`);
  }

  const existingScenes = Array.isArray(world.scenesJson)
    ? (world.scenesJson as Array<{ name?: string }>)
        .map(s => s?.name)
        .filter((n): n is string => Boolean(n))
    : [];
  if (existingScenes.length) {
    lines.push(`已有場景（避免重複）：${existingScenes.join("、")}`);
  }

  return lines.join("\n");
}

const characterJsonSchema = {
  type: "object" as const,
  properties: {
    name: { type: "string" as const },
    role: { type: "string" as const, enum: [...CHARACTER_ROLES] },
    tagline: { type: "string" as const },
    personality: { type: "string" as const },
    appearance: { type: "string" as const },
    backstory: { type: "string" as const },
    likes: { type: "array" as const, items: { type: "string" as const } },
    interests: { type: "array" as const, items: { type: "string" as const } },
    signatureItems: { type: "array" as const, items: { type: "string" as const } },
    notes: { type: "string" as const },
  },
  required: [
    "name",
    "role",
    "tagline",
    "personality",
    "appearance",
    "backstory",
    "likes",
    "interests",
    "signatureItems",
    "notes",
  ],
  additionalProperties: false,
};

const sceneJsonSchema = {
  type: "object" as const,
  properties: {
    name: { type: "string" as const },
    tagline: { type: "string" as const },
    environment: { type: "string" as const },
    mood: { type: "string" as const },
    lighting: { type: "string" as const },
    flora: { type: "array" as const, items: { type: "string" as const } },
    fauna: { type: "array" as const, items: { type: "string" as const } },
    props: { type: "array" as const, items: { type: "string" as const } },
    environmentChanges: {
      type: "array" as const,
      items: { type: "string" as const },
    },
    notes: { type: "string" as const },
  },
  required: [
    "name",
    "tagline",
    "environment",
    "mood",
    "lighting",
    "flora",
    "fauna",
    "props",
    "environmentChanges",
    "notes",
  ],
  additionalProperties: false,
};

type BrainConfig = {
  model: string;
  temperature: number;
  topP: number;
  systemPrompt: string | null;
};

export async function generateCharacter(params: {
  world: {
    name: string;
    description?: string | null;
    genre?: string | null;
    era?: string | null;
    charactersJson?: unknown;
    scenesJson?: unknown;
  };
  description: string;
  archetype?: string;
  brainConfig?: BrainConfig;
}): Promise<WorldCharacter> {
  const contextBlock = buildWorldContext(params.world);
  const archetypeLine = params.archetype?.trim()
    ? `原型偏好：${params.archetype.trim()}`
    : "";

  const result = await withTimeout(
    invokeLLM({
      runName: "worldbuilding-generate-character",
      model: params.brainConfig?.model,
      temperature: params.brainConfig?.temperature ?? 0.8,
      topP: params.brainConfig?.topP,
      systemPrompt: params.brainConfig?.systemPrompt,
      messages: [
        {
          role: "system",
          content: `你是世界觀設計師，協助使用者擴充他們既有的世界。
你只負責「敘事必填欄位」：名稱、角色定位、tagline、個性、外觀、背景、喜好/興趣/隨身物件、額外備註。
動畫製作層欄位（rig、lipSync、actingNotes 等）不在你的工作範圍，會由使用者後續手動補上。

風格規則：
- name 控制在 8 字內，符合世界類型與時代。
- role 必須是 protagonist / supporting / antagonist / npc 其中之一，依描述判斷。
- tagline 不超過 30 字，給人一眼記住的角色印象。
- personality 1-2 句，呈現核心性格。
- appearance 1-2 句具體外貌（髮型、瞳色、身高、特徵），避免空泛形容詞。
- backstory 2-3 句，與世界設定咬合。
- likes / interests / signatureItems 各 1-3 項；若不適用則空陣列。
- notes 可空字串，但若有特別線索（例如與既有角色關係）建議寫進去。
- 整體要呼應世界已有角色但避免重複設定。`,
        },
        {
          role: "user",
          content: `【世界資料】
${contextBlock}

【使用者描述】
${params.description}
${archetypeLine ? "\n" + archetypeLine : ""}

請生成符合此世界的新角色。`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "worldbuilding_character",
          strict: true,
          schema: characterJsonSchema,
        },
      },
      maxTokens: 1024,
    }),
    60_000,
    "角色生成"
  );

  const extracted = extractMessageJson(result.choices[0]?.message?.content);
  const parsed = characterSchema.safeParse(extracted);
  if (!parsed.success) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `角色生成回應格式錯誤：${parsed.error.message}`,
    });
  }

  return {
    id: randomUUID(),
    name: parsed.data.name,
    role: parsed.data.role,
    tagline: parsed.data.tagline,
    personality: parsed.data.personality,
    appearance: parsed.data.appearance,
    backstory: parsed.data.backstory,
    likes: parsed.data.likes,
    interests: parsed.data.interests,
    signatureItems: parsed.data.signatureItems,
    notes: parsed.data.notes,
  };
}

export async function generateScene(params: {
  world: {
    name: string;
    description?: string | null;
    genre?: string | null;
    era?: string | null;
    charactersJson?: unknown;
    scenesJson?: unknown;
  };
  description: string;
  environmentType?: string;
  brainConfig?: BrainConfig;
}): Promise<WorldScene> {
  const contextBlock = buildWorldContext(params.world);
  const environmentLine = params.environmentType?.trim()
    ? `環境類型偏好：${params.environmentType.trim()}`
    : "";

  const result = await withTimeout(
    invokeLLM({
      runName: "worldbuilding-generate-scene",
      model: params.brainConfig?.model,
      temperature: params.brainConfig?.temperature ?? 0.8,
      topP: params.brainConfig?.topP,
      systemPrompt: params.brainConfig?.systemPrompt,
      messages: [
        {
          role: "system",
          content: `你是世界觀設計師，協助使用者擴充世界中的場景。
你只負責「敘事必填欄位」：名稱、tagline、environment、mood、lighting、flora/fauna/props、environmentChanges、notes。
動畫製作層欄位（layout、productionDesign、atmospherics、soundDesign）不在你的工作範圍。

風格規則：
- name 8 字內，能傳達場景氛圍。
- tagline 不超過 30 字。
- environment 描述地點、季節、天氣，2-3 句。
- mood 1-2 句氛圍與情緒。
- lighting 1-2 句光線描述（時段、色溫、來源、陰影）。
- flora / fauna / props 各 1-4 項；不適用則空陣列。
- environmentChanges 0-3 個（晝夜變化、季節事件、突發變動）。
- notes 可空字串。
- 場景必須咬合世界類型與時代，避免與既有場景重複。`,
        },
        {
          role: "user",
          content: `【世界資料】
${contextBlock}

【使用者描述】
${params.description}
${environmentLine ? "\n" + environmentLine : ""}

請生成符合此世界的新場景。`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "worldbuilding_scene",
          strict: true,
          schema: sceneJsonSchema,
        },
      },
      maxTokens: 1024,
    }),
    60_000,
    "場景生成"
  );

  const extracted = extractMessageJson(result.choices[0]?.message?.content);
  const parsed = sceneSchema.safeParse(extracted);
  if (!parsed.success) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `場景生成回應格式錯誤：${parsed.error.message}`,
    });
  }

  return {
    id: randomUUID(),
    name: parsed.data.name,
    tagline: parsed.data.tagline,
    environment: parsed.data.environment,
    mood: parsed.data.mood,
    lighting: parsed.data.lighting,
    flora: parsed.data.flora,
    fauna: parsed.data.fauna,
    props: parsed.data.props,
    environmentChanges: parsed.data.environmentChanges,
    notes: parsed.data.notes,
  };
}

export const worldbuildingGenerationRouter = router({
  generateCharacter: brainProcedure
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

      const storyteller = ctx.brain.getBrain("storyteller");
      const character = await generateCharacter({
        world,
        description: input.description,
        archetype: input.archetype,
        brainConfig: {
          model: storyteller.model,
          temperature: storyteller.temperature,
          topP: storyteller.topP,
          systemPrompt: storyteller.systemPrompt,
        },
      });

      const characters = Array.isArray(world.charactersJson)
        ? [...(world.charactersJson as WorldCharacter[]), character]
        : [character];

      await db.updateWorldbuildingFramework(input.worldId, {
        charactersJson: characters as Array<Record<string, unknown>>,
      });

      return { character };
    }),

  generateScene: brainProcedure
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

      const storyteller = ctx.brain.getBrain("storyteller");
      const scene = await generateScene({
        world,
        description: input.description,
        environmentType: input.environmentType,
        brainConfig: {
          model: storyteller.model,
          temperature: storyteller.temperature,
          topP: storyteller.topP,
          systemPrompt: storyteller.systemPrompt,
        },
      });

      const scenes = Array.isArray(world.scenesJson)
        ? [...(world.scenesJson as WorldScene[]), scene]
        : [scene];

      await db.updateWorldbuildingFramework(input.worldId, {
        scenesJson: scenes as Array<Record<string, unknown>>,
      });

      return { scene };
    }),

  generateStoryboard: brainProcedure
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
