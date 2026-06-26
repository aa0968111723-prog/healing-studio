/**
 * server/services/skillValidator.ts — Wave S / AIDV-126
 *
 * Skill manifest parser and contract validation.
 * Used at install-time and at execution-time to enforce:
 *   1. Manifest is schema-valid (parseSkillManifest)
 *   2. Requested permissions stay within granted scope (validatePermissionScope)
 *   3. Required inputs are present and the step can be instantiated (instantiateSkillStep)
 */

import {
  SkillManifestSchema,
  type SkillManifest,
  type SkillInstance,
  type SkillPermissions,
} from "../../shared/skill-manifest";

export type ManifestValidationResult =
  | { valid: true; manifest: SkillManifest }
  | { valid: false; errors: string[] };

/**
 * Parse and validate a raw skill.json payload.
 * Returns the typed manifest on success or a list of human-readable errors.
 */
export function parseSkillManifest(raw: unknown): ManifestValidationResult {
  const result = SkillManifestSchema.safeParse(raw);
  if (result.success) {
    return { valid: true, manifest: result.data };
  }
  const errors = result.error.issues.map(issue => {
    const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return `${path}${issue.message}`;
  });
  return { valid: false, errors };
}

export interface PermissionCheckResult {
  allowed: boolean;
  violations: string[];
}

/**
 * Verify that the permissions requested by a manifest do not exceed what
 * the runtime is willing to grant for this invocation.
 * Fail-closed: any ungranted permission is a violation.
 */
export function validatePermissionScope(
  requested: SkillPermissions,
  granted: SkillPermissions,
): PermissionCheckResult {
  const violations: string[] = [];

  for (const connector of requested.connectors) {
    if (!granted.connectors.includes(connector)) {
      violations.push(`connector "${connector}" not in granted scope`);
    }
  }
  if (requested.materials && !granted.materials) {
    violations.push("materials access not granted");
  }
  if (requested.crossProject && !granted.crossProject) {
    violations.push("crossProject access not granted");
  }

  return { allowed: violations.length === 0, violations };
}

export type InstantiateResult =
  | { ok: true; instance: SkillInstance }
  | { ok: false; error: string };

/**
 * Validate inputs and permissions, then produce a SkillInstance ready to
 * be persisted as a workflow step.
 *
 * @param manifest       Parsed + validated SkillManifest
 * @param inputs         Caller-supplied input values
 * @param grantedPerms   Permissions the runtime is willing to grant
 */
export function instantiateSkillStep(
  manifest: SkillManifest,
  inputs: Record<string, unknown>,
  grantedPerms: SkillPermissions,
): InstantiateResult {
  const missingRequired = Object.entries(manifest.inputs)
    .filter(([, typeAnnotation]) => !(typeAnnotation as string).endsWith("?"))
    .map(([key]) => key)
    .filter(key => !(key in inputs));

  if (missingRequired.length > 0) {
    return {
      ok: false,
      error: `Missing required inputs: ${missingRequired.join(", ")}`,
    };
  }

  const permCheck = validatePermissionScope(manifest.permissions, grantedPerms);
  if (!permCheck.allowed) {
    return {
      ok: false,
      error: `Permission violations: ${permCheck.violations.join("; ")}`,
    };
  }

  return {
    ok: true,
    instance: {
      skillId: manifest.id,
      skillVersion: manifest.version,
      inputSnapshot: inputs,
      permissionSnapshot: grantedPerms,
    },
  };
}
