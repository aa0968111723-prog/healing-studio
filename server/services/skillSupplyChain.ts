/**
 * server/services/skillSupplyChain.ts — Wave S / AIDV-131
 *
 * S-6 Supply chain guard for external/community Skill installs and upgrades.
 *
 * Attack surface defended:
 *   "Install-time benign, update-time malicious" — the manifest is inert on
 *   first install (community trust, zero permissions) but a later version
 *   silently requests new connectors / materials / crossProject access.
 *
 * Countermeasures:
 *   1. computeManifestChecksum — canonical SHA-256 of the approved manifest,
 *      stored in skill_registry.manifestChecksum at install/upgrade time.
 *   2. detectPermissionEscalation — compare new manifest permissions vs. what
 *      the Admin has already explicitly granted.
 *   3. checkUpgrade — if escalation detected → fail-closed: set status=disabled
 *      + needsReaudit=1 until Admin explicitly re-approves.
 *   4. verifyManifestIntegrity — optional; caller passes expected checksum.
 *
 * This module is pure functions (no DB calls); callers (skillRegistryService)
 * handle persistence.
 */

import { createHash } from "node:crypto";
import type { SkillManifest, SkillPermissions } from "../../shared/skill-manifest";

// ─── Checksum ─────────────────────────────────────────────────────────────────

/**
 * Canonical SHA-256 of the manifest object.
 * Keys are sorted for determinism — same manifest content always produces the
 * same checksum regardless of JSON serialisation order.
 */
export function computeManifestChecksum(manifest: SkillManifest): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(manifest).sort()) {
    sorted[key] = (manifest as Record<string, unknown>)[key];
  }
  return createHash("sha256").update(JSON.stringify(sorted), "utf8").digest("hex");
}

export interface ManifestIntegrityResult {
  valid: boolean;
  reason?: string;
}

/**
 * Verify a manifest matches an expected checksum recorded at install time.
 * If no expectedChecksum is provided the check is a no-op (returns valid=true).
 */
export function verifyManifestIntegrity(
  manifest: SkillManifest,
  expectedChecksum?: string | null
): ManifestIntegrityResult {
  if (!expectedChecksum) return { valid: true };
  const actual = computeManifestChecksum(manifest);
  if (actual !== expectedChecksum) {
    return {
      valid: false,
      reason: `Manifest checksum mismatch: expected ${expectedChecksum.slice(0, 12)}… got ${actual.slice(0, 12)}…`,
    };
  }
  return { valid: true };
}

// ─── Permission escalation ────────────────────────────────────────────────────

/**
 * Returns true when newRequested asks for permissions beyond existingGranted.
 * Fail-closed: any new connector/material/crossProject is escalation.
 */
export function detectPermissionEscalation(
  existingGranted: SkillPermissions,
  newRequested: SkillPermissions
): boolean {
  if (newRequested.materials && !existingGranted.materials) return true;
  if (newRequested.crossProject && !existingGranted.crossProject) return true;
  const newConnectors = newRequested.connectors.filter(
    c => !existingGranted.connectors.includes(c)
  );
  return newConnectors.length > 0;
}

export interface UpgradeCheckResult {
  /** True when the upgrade can proceed without Admin re-review. */
  safe: boolean;
  /** True when new manifest requests permissions beyond currently granted scope. */
  requiresReaudit: boolean;
  /** Human-readable reason when safe=false. */
  reason?: string;
}

/**
 * Determine whether upgrading a skill to a new manifest version is safe.
 *
 * Safe = new manifest does NOT request any permission beyond what Admin has
 * already granted. In that case: update version + checksum, keep status=active.
 *
 * Unsafe = escalation detected. Caller must set status=disabled + needsReaudit=1
 * so the skill cannot execute until Admin explicitly re-approves.
 */
export function checkUpgrade(
  currentGranted: SkillPermissions,
  newManifest: SkillManifest
): UpgradeCheckResult {
  if (detectPermissionEscalation(currentGranted, newManifest.permissions)) {
    return {
      safe: false,
      requiresReaudit: true,
      reason:
        "New version requests permissions beyond currently granted scope — " +
        "manual Admin re-audit required before the skill can execute",
    };
  }
  return { safe: true, requiresReaudit: false };
}

// ─── Install-time validation ──────────────────────────────────────────────────

export interface InstallValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Pre-install validation for external skills.
 * Official skills bypass this (seeded via seedOfficialSkills).
 */
export function validateExternalSkillManifest(
  manifest: SkillManifest
): InstallValidationResult {
  if (manifest.trust === "official") {
    return {
      valid: false,
      reason: 'External skills cannot self-declare trust="official"',
    };
  }
  if (manifest.kind === "sandboxed" && !manifest.code) {
    return {
      valid: false,
      reason: 'kind=sandboxed skills must include a "code" field',
    };
  }
  if (manifest.kind === "declarative" && manifest.code) {
    return {
      valid: false,
      reason: 'kind=declarative skills must not include a "code" field (no arbitrary code)',
    };
  }
  return { valid: true };
}
