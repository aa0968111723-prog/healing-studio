/**
 * shared/skills/index.ts — Wave S / AIDV-127
 *
 * Loads and validates all official Skill manifests at import time.
 * Import this to get a typed map of all first-party skills.
 */

import { parseSkillManifest } from "../../server/services/skillValidator";
import type { SkillManifest } from "../skill-manifest";

import storyboardBreakdown from "./official/storyboard.breakdown.skill.json";
import worldStyleInject from "./official/world.styleInject.skill.json";
import materialsGround from "./official/materials.ground.skill.json";
import shotGenerate from "./official/shot.generate.skill.json";
import cutRough from "./official/cut.rough.skill.json";

const rawManifests = [
  storyboardBreakdown,
  worldStyleInject,
  materialsGround,
  shotGenerate,
  cutRough,
];

function loadOfficialSkills(): Map<string, SkillManifest> {
  const map = new Map<string, SkillManifest>();
  for (const raw of rawManifests) {
    const result = parseSkillManifest(raw);
    if (!result.valid) {
      throw new Error(
        `Official skill manifest invalid (${(raw as { id?: string }).id ?? "unknown"}): ${result.errors.join("; ")}`
      );
    }
    map.set(result.manifest.id, result.manifest);
  }
  return map;
}

export const OFFICIAL_SKILLS: Map<string, SkillManifest> = loadOfficialSkills();

export function getOfficialSkill(id: string): SkillManifest | undefined {
  return OFFICIAL_SKILLS.get(id);
}

export const OFFICIAL_SKILL_IDS = {
  STORYBOARD_BREAKDOWN: "storyboard.breakdown",
  WORLD_STYLE_INJECT: "world.styleinject",
  MATERIALS_GROUND: "materials.ground",
  SHOT_GENERATE: "shot.generate",
  CUT_ROUGH: "cut.rough",
} as const;
