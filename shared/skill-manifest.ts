/**
 * shared/skill-manifest.ts — Wave S / AIDV-126
 *
 * Single source of truth for the AI Skill manifest schema (skill.json).
 * Every installable Skill must conform to this contract.
 *
 * A Skill manifest describes:
 *   - Identity   (id, version, name, trust)
 *   - Capability (kind: declarative vs sandboxed)
 *   - I/O types  (inputs, outputs — aligned with ShotJSON etc.)
 *   - Providers  (which model/API backends are allowed)
 *   - Permissions (connectors, materials, crossProject — default zero)
 *   - Cost       (who is billed: the workflow or the skill itself)
 */

import { z } from "zod";

export const SkillKindSchema = z.enum(["declarative", "sandboxed"]);
export const SkillTrustSchema = z.enum(["official", "reviewed", "community"]);
export const CostAttributionSchema = z.enum(["workflow", "skill"]);

export const SkillPermissionsSchema = z.object({
  /** External connector IDs allowed (e.g. "s3", "notion"). Default: none. */
  connectors: z.array(z.string()).default([]),
  /** Whether the skill may read/write creative materials (scripts, shots, etc.). */
  materials: z.boolean().default(false),
  /** Whether the skill may access resources across projects. */
  crossProject: z.boolean().default(false),
});

export const SkillManifestSchema = z.object({
  /** Globally unique dot/slash-separated identifier, e.g. "storyboard.breakdown". */
  id: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_./:-]*$/, "Skill ID must be lowercase dot/slash-separated"),
  /** SemVer version string. External Skills must pin this. */
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, "Version must follow semver (MAJOR.MINOR.PATCH)"),
  /** Human-readable display name (may be in any language). */
  name: z.string().min(1),
  /** Execution model: "declarative" = prompt-only; "sandboxed" = restricted code (WASM/etc.). */
  kind: SkillKindSchema,
  /** Trust level assigned by the marketplace. "official" = first-party Healing Studio skills. */
  trust: SkillTrustSchema,
  /**
   * Declared input fields. Values are type annotations:
   *   "text" | "int" | "int?" | "ShotJSON[]" | ...
   * Trailing "?" marks a field as optional.
   */
  inputs: z.record(z.string()).default({}),
  /**
   * Declared output fields. Same type annotation syntax as inputs.
   * e.g. { "shots": "ShotJSON[]", "summary": "text" }
   */
  outputs: z.record(z.string()).default({}),
  /** Model/API providers this skill is allowed to invoke (e.g. "fal", "gemini"). */
  providers: z.array(z.string()).default([]),
  /** Permissions requested. Default = all false / empty = zero internal data access. */
  permissions: SkillPermissionsSchema.default({}),
  /** Cost attribution: "workflow" bills the parent workflow; "skill" bills at skill level. */
  cost: z.object({
    attributeTo: CostAttributionSchema,
  }),
});

export type SkillManifest = z.infer<typeof SkillManifestSchema>;
export type SkillKind = z.infer<typeof SkillKindSchema>;
export type SkillTrust = z.infer<typeof SkillTrustSchema>;
export type SkillPermissions = z.infer<typeof SkillPermissionsSchema>;

/** A Skill instantiated as a workflow step (stored in orb_workflow_step_executions). */
export interface SkillInstance {
  /** The skill.id from the manifest. */
  skillId: string;
  /** The pinned skill.version at instantiation time. */
  skillVersion: string;
  /** Actual input values passed at execution time (snapshot for audit). */
  inputSnapshot: Record<string, unknown>;
  /** Effective permissions granted to this instance (may be subset of manifest.permissions). */
  permissionSnapshot: SkillPermissions;
}

/** Manifest for the official S-2 Video Skill — used as a reference in DoD validation. */
export const OFFICIAL_VIDEO_SKILL_ID = "healing-studio.video.generate";
