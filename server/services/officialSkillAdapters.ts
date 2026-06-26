/**
 * server/services/officialSkillAdapters.ts — Wave S / AIDV-127
 *
 * Thin adapters that bridge the official Skill IDs (from shared/skills/index.ts)
 * to the underlying service calls. The S-3 orchestrator calls these; they do NOT
 * invoke tRPC directly — they call the same service-layer functions the routers use.
 *
 * Contracts (all enforced by SkillManifestSchema + instantiateSkillStep before
 * the adapter is ever called):
 *   - Permissions are already validated upstream — adapters trust the inputs.
 *   - Inputs are typed strictly; missing required keys throw before reaching here.
 *   - Every adapter returns a plain object matching the skill's `outputs` spec.
 */

import { searchTeachingArchive } from "./teachingArchiveSearch";
import type { TeachingSearchHit } from "./teachingArchiveSearch";

// ─── storyboard.breakdown ────────────────────────────────────────────────────

export interface StoryboardBreakdownInput {
  worldId: number;
  totalDurationSec: number;
  userId: number;
  sceneCount?: number;
  aspectRatio?: string;
  fps?: number;
  name?: string;
}

export interface StoryboardBreakdownOutput {
  /** DB row id of the saved storyboard, null if not auto-saved. */
  storyboardId: number | null;
  /** Scene objects with frames, timing, audio cues. */
  scenes: unknown[];
}

/**
 * Delegates to worldStoryboard.seedSkeleton via the service layer.
 * S-3: call trpc.worldStoryboard.seedSkeleton directly for now; this stub
 * records the contract and can be upgraded to a direct DB call later.
 */
export async function runStoryboardBreakdown(
  input: StoryboardBreakdownInput
): Promise<StoryboardBreakdownOutput> {
  // Stub — S-3 orchestrator will drive the tRPC procedure through the caller context.
  // This adapter defines the contract; the output shape matches skill `outputs`.
  return {
    storyboardId: null,
    scenes: [],
  };
}

// ─── world.styleinject ───────────────────────────────────────────────────────

export interface WorldStyleInjectInput {
  worldId: number;
  userId: number;
  styleDescriptor: string;
  globalNegativePrompt?: string;
}

export interface WorldStyleInjectOutput {
  ok: boolean;
}

/**
 * Delegates to worldbuilding.update — patches the framework's styleProfiles
 * and globalNegativePrompt from a plain descriptor string.
 */
export async function runWorldStyleInject(
  input: WorldStyleInjectInput
): Promise<WorldStyleInjectOutput> {
  // Stub — S-3 orchestrator will hydrate a style profile object from styleDescriptor
  // and call trpc.worldbuilding.update with the patch.
  return { ok: true };
}

// ─── materials.ground ────────────────────────────────────────────────────────

export interface MaterialsGroundInput {
  query: string;
  userId: number;
  scope?: string;
  maxResults?: number;
}

export interface MaterialsGroundOutput {
  materials: TeachingSearchHit[];
  /** Concatenated snippet text suitable for injecting into generation prompts. */
  groundingContext: string;
}

/**
 * Calls searchTeachingArchive directly — the only adapter that can run
 * entirely in the service layer without tRPC context.
 */
export async function runMaterialsGround(
  input: MaterialsGroundInput
): Promise<MaterialsGroundOutput> {
  const limit = input.maxResults ?? 5;
  const hits = await searchTeachingArchive({
    userId: input.userId,
    query: input.query,
    limit,
  });
  const groundingContext = hits
    .map((h, i) => `[${i + 1}] ${h.title}\n${h.snippet}`)
    .join("\n\n");
  return { materials: hits, groundingContext };
}

// ─── shot.generate ───────────────────────────────────────────────────────────

export interface SegmentJSON {
  id: string;
  index: number;
  rawText: string;
  storyboard: {
    sceneHeading: string;
    visualDescription: string;
    dialogue: string;
    soundDesign: string;
    cameraDirection: string;
    duration: string;
    mood: string;
  };
  discussion?: Array<{ role: "user" | "assistant"; content: string }>;
  characters?: string[];
  locations?: string[];
}

export interface CostarCard {
  context: string;
  situation: string;
  task: string;
  action: string;
  result: string;
  visualPrompt: string;
  audioScript: string;
  musicVibe: string;
  proactiveQuestion: string;
}

export interface ShotGenerateInput {
  segment: SegmentJSON;
  userId: number;
  personality?: "calm" | "creative" | "technical";
}

export interface ShotGenerateOutput {
  costarCard: CostarCard;
}

/**
 * Delegates to director.generateSegmentCostar. The actual LLM call is in the
 * director router; the adapter forwards inputs and wraps the output.
 * S-3 orchestrator provides the caller context needed to invoke the procedure.
 */
export async function runShotGenerate(
  input: ShotGenerateInput
): Promise<ShotGenerateOutput> {
  // Stub — S-3 drives trpc.director.generateSegmentCostar with the segment.
  return {
    costarCard: {
      context: "",
      situation: "",
      task: "",
      action: "",
      result: "",
      visualPrompt: "",
      audioScript: "",
      musicVibe: "",
      proactiveQuestion: "",
    },
  };
}

// ─── cut.rough ───────────────────────────────────────────────────────────────

export interface CutRoughInput {
  storyboardId: number;
  userId: number;
  selectFrames?: string;
  includeAudio?: boolean;
}

export interface CutRoughOutput {
  /** Background composition job ID. */
  jobId: number;
  estimatedCostUsd?: number;
}

/**
 * Delegates to the composition pipeline (AIDV-48). The procedure is not yet
 * fully tRPC-exposed; this stub records the contract for the S-3 implementation.
 */
export async function runCutRough(
  input: CutRoughInput
): Promise<CutRoughOutput> {
  // Stub — S-3 will dispatch via orchestration_runs when cut.rough is fully wired.
  return { jobId: 0, estimatedCostUsd: undefined };
}

// ─── Dispatch table (id → adapter fn) ───────────────────────────────────────

export type OfficialSkillInput =
  | ({ skillId: "storyboard.breakdown" } & StoryboardBreakdownInput)
  | ({ skillId: "world.styleinject" } & WorldStyleInjectInput)
  | ({ skillId: "materials.ground" } & MaterialsGroundInput)
  | ({ skillId: "shot.generate" } & ShotGenerateInput)
  | ({ skillId: "cut.rough" } & CutRoughInput);

export async function dispatchOfficialSkill(
  input: OfficialSkillInput
): Promise<unknown> {
  switch (input.skillId) {
    case "storyboard.breakdown":
      return runStoryboardBreakdown(input);
    case "world.styleinject":
      return runWorldStyleInject(input);
    case "materials.ground":
      return runMaterialsGround(input);
    case "shot.generate":
      return runShotGenerate(input);
    case "cut.rough":
      return runCutRough(input);
  }
}
