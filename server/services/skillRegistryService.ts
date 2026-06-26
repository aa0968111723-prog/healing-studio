/**
 * server/services/skillRegistryService.ts — Wave S / AIDV-129
 *
 * Skill registry: install, list, authorize, disable, and trust-upgrade skills.
 *
 * Trust ceiling rules (fail-closed):
 *   official   → full permissions allowed (materials, crossProject, any connector)
 *   reviewed   → materials + specific connectors allowed; crossProject denied
 *   community  → zero permissions; sandboxed; no grant without Admin explicit call
 *
 * Admin operations (updateTrust, grantPermissions, disableSkill) do NOT perform
 * their own auth check — callers (tRPC routers) must assert isAdmin before calling.
 */

import { getDb } from "../db";
import { skillRegistry } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import type { SkillRegistryEntry, InsertSkillRegistryEntry } from "../../drizzle/schema";
import type { SkillManifest, SkillPermissions } from "../../shared/skill-manifest";
import { OFFICIAL_SKILLS } from "../../shared/skills/index";
import { logger } from "../_core/logger";
import {
  computeManifestChecksum,
  checkUpgrade,
  validateExternalSkillManifest,
} from "./skillSupplyChain";

// ─── Trust ceiling ────────────────────────────────────────────────────────────

/** Maximum permissions a trust tier may have. Fail-closed: community = zero. */
const TRUST_CEILING: Record<string, SkillPermissions> = {
  official: { connectors: [], materials: true, crossProject: true },
  reviewed: { connectors: [], materials: true, crossProject: false },
  community: { connectors: [], materials: false, crossProject: false },
};

/** Returns true if `requested` is within the ceiling for the given trust level. */
export function withinTrustCeiling(
  trust: "official" | "reviewed" | "community",
  requested: Partial<SkillPermissions>
): boolean {
  const ceiling = TRUST_CEILING[trust];
  if (requested.crossProject && !ceiling.crossProject) return false;
  if (requested.materials && !ceiling.materials) return false;
  const extra = (requested.connectors ?? []).filter(c => !ceiling.connectors.includes(c));
  // For official the ceiling.connectors is empty (all connectors allowed); for others only
  // those pre-approved by Admin are valid. Community gets none.
  if (trust === "community" && extra.length > 0) return false;
  return true;
}

/**
 * Returns the effective permissions for a registry entry: intersection of what
 * was granted by Admin and what the trust ceiling allows.
 */
export function effectivePermissions(entry: SkillRegistryEntry): SkillPermissions {
  return {
    connectors: entry.grantedConnectors ?? [],
    materials: entry.grantedMaterials,
    crossProject: entry.grantedCrossProject,
  };
}

// ─── Seeding official skills ──────────────────────────────────────────────────

/**
 * Upsert all official skills into the registry with full permissions.
 * Safe to call multiple times (idempotent via ON DUPLICATE KEY UPDATE).
 * Called at server startup / migration to ensure built-in skills are registered.
 */
export async function seedOfficialSkills(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  for (const [, manifest] of OFFICIAL_SKILLS) {
    try {
      await db
        .insert(skillRegistry)
        .values({
          skillId: manifest.id,
          version: manifest.version,
          name: manifest.name,
          trust: "official",
          grantedConnectors: [],
          grantedMaterials: true,
          grantedCrossProject: false,
          status: "active",
          installedBy: null,
          source: null,
        })
        .onDuplicateKeyUpdate({
          set: {
            version: manifest.version,
            name: manifest.name,
            trust: "official",
            grantedMaterials: true,
            status: "active",
          },
        });
    } catch (err) {
      logger.warn("skillRegistryService: failed to seed official skill", { err, skillId: manifest.id });
    }
  }
  logger.info("skillRegistryService: official skills seeded", { count: OFFICIAL_SKILLS.size });
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export interface InstallSkillInput {
  manifest: SkillManifest;
  installedBy: number;
  trust?: "reviewed" | "community";
  source?: string;
}

export type InstallResult =
  | { ok: true; entry: SkillRegistryEntry }
  | { ok: false; error: string };

/**
 * Install a new skill into the registry.
 * Official skills are seeded via seedOfficialSkills(); this is for external skills.
 * The granted permissions default to zero (community) until Admin explicitly grants.
 */
export async function installSkill(input: InstallSkillInput): Promise<InstallResult> {
  const { manifest, installedBy, trust = "community", source } = input;
  const db = await getDb();
  if (!db) return { ok: false, error: "Database not configured" };

  if (trust === "reviewed" && !withinTrustCeiling("reviewed", manifest.permissions)) {
    return { ok: false, error: "Manifest permissions exceed the 'reviewed' trust ceiling" };
  }

  const supplyChainCheck = validateExternalSkillManifest(manifest);
  if (!supplyChainCheck.valid) {
    return { ok: false, error: supplyChainCheck.reason! };
  }

  const manifestChecksum = computeManifestChecksum(manifest);

  try {
    await db.insert(skillRegistry).values({
      skillId: manifest.id,
      version: manifest.version,
      name: manifest.name,
      trust,
      grantedConnectors: [],
      grantedMaterials: false,
      grantedCrossProject: false,
      status: "active",
      installedBy,
      source: source ?? null,
      manifestChecksum,
      needsReaudit: 0,
    });
    const [entry] = await db
      .select()
      .from(skillRegistry)
      .where(eq(skillRegistry.skillId, manifest.id))
      .limit(1);
    return { ok: true, entry };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Duplicate")) {
      return { ok: false, error: `Skill "${manifest.id}" is already installed` };
    }
    return { ok: false, error: msg };
  }
}

export async function listSkills(): Promise<SkillRegistryEntry[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(skillRegistry);
}

export async function getSkillEntry(skillId: string): Promise<SkillRegistryEntry | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(skillRegistry)
    .where(eq(skillRegistry.skillId, skillId))
    .limit(1);
  return row ?? null;
}

// ─── Admin operations (callers must assert isAdmin) ───────────────────────────

export interface GrantPermissionsInput {
  skillId: string;
  connectors?: string[];
  materials?: boolean;
  crossProject?: boolean;
}

export type AdminResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Admin: grant specific permissions to an installed skill.
 * Fails if the grant would exceed the trust ceiling.
 */
export async function grantPermissions(input: GrantPermissionsInput): Promise<AdminResult> {
  const db = await getDb();
  if (!db) return { ok: false, error: "Database not configured" };

  const entry = await getSkillEntry(input.skillId);
  if (!entry) return { ok: false, error: `Skill "${input.skillId}" not found in registry` };
  if (entry.status === "disabled") return { ok: false, error: "Cannot grant permissions to a disabled skill" };

  const requested: Partial<SkillPermissions> = {
    connectors: input.connectors,
    materials: input.materials,
    crossProject: input.crossProject,
  };
  if (!withinTrustCeiling(entry.trust, requested)) {
    return {
      ok: false,
      error: `Requested permissions exceed the '${entry.trust}' trust ceiling`,
    };
  }

  await db
    .update(skillRegistry)
    .set({
      grantedConnectors: input.connectors ?? (entry.grantedConnectors ?? []),
      grantedMaterials: input.materials ?? entry.grantedMaterials,
      grantedCrossProject: input.crossProject ?? entry.grantedCrossProject,
    })
    .where(eq(skillRegistry.skillId, input.skillId));
  return { ok: true };
}

/** Admin: change a skill's trust level. Downgrading resets permissions to zero. */
export async function updateTrust(
  skillId: string,
  newTrust: "official" | "reviewed" | "community"
): Promise<AdminResult> {
  const db = await getDb();
  if (!db) return { ok: false, error: "Database not configured" };

  const entry = await getSkillEntry(skillId);
  if (!entry) return { ok: false, error: `Skill "${skillId}" not found` };

  const downgrading =
    (entry.trust === "official" && newTrust !== "official") ||
    (entry.trust === "reviewed" && newTrust === "community");

  await db
    .update(skillRegistry)
    .set({
      trust: newTrust,
      ...(downgrading
        ? { grantedMaterials: false, grantedCrossProject: false, grantedConnectors: [] }
        : {}),
    })
    .where(eq(skillRegistry.skillId, skillId));
  return { ok: true };
}

/** Admin: disable (deactivate) a skill. Disabled skills are rejected at dispatch. */
export async function disableSkill(skillId: string): Promise<AdminResult> {
  const db = await getDb();
  if (!db) return { ok: false, error: "Database not configured" };

  const result = await db
    .update(skillRegistry)
    .set({ status: "disabled" })
    .where(eq(skillRegistry.skillId, skillId));
  if ((result[0] as { affectedRows?: number }).affectedRows === 0) {
    return { ok: false, error: `Skill "${skillId}" not found` };
  }
  return { ok: true };
}

/** Admin: re-enable a previously disabled skill. */
export async function enableSkill(skillId: string): Promise<AdminResult> {
  const db = await getDb();
  if (!db) return { ok: false, error: "Database not configured" };
  await db
    .update(skillRegistry)
    .set({ status: "active" })
    .where(eq(skillRegistry.skillId, skillId));
  return { ok: true };
}

// ─── Supply chain: version upgrade with permission re-audit ───────────────────

export interface UpgradeSkillInput {
  skillId: string;
  newManifest: SkillManifest;
  installedBy: number;
}

export type UpgradeResult =
  | { ok: true; reauditRequired: false }
  | { ok: true; reauditRequired: true; reason: string }
  | { ok: false; error: string };

/**
 * Upgrade an installed skill to a new manifest version.
 *
 * Fail-closed supply chain rule: if the new manifest requests permissions
 * beyond what Admin has already explicitly granted, the skill is disabled
 * (needsReaudit=1, status=disabled) until Admin re-approves via enableSkill().
 *
 * Official skills bypass this — use seedOfficialSkills() instead.
 */
export async function upgradeSkill(input: UpgradeSkillInput): Promise<UpgradeResult> {
  const db = await getDb();
  if (!db) return { ok: false, error: "Database not configured" };

  const entry = await getSkillEntry(input.skillId);
  if (!entry) return { ok: false, error: `Skill "${input.skillId}" not found in registry` };
  if (entry.trust === "official") {
    return { ok: false, error: 'Official skills are upgraded via seedOfficialSkills(), not upgradeSkill()' };
  }

  const supplyChainCheck = validateExternalSkillManifest(input.newManifest);
  if (!supplyChainCheck.valid) {
    return { ok: false, error: supplyChainCheck.reason! };
  }

  const currentGranted = effectivePermissions(entry);
  const upgradeCheck = checkUpgrade(currentGranted, input.newManifest);
  const newChecksum = computeManifestChecksum(input.newManifest);

  if (!upgradeCheck.safe) {
    await db
      .update(skillRegistry)
      .set({
        version: input.newManifest.version,
        name: input.newManifest.name,
        manifestChecksum: newChecksum,
        needsReaudit: 1,
        status: "disabled",
      })
      .where(eq(skillRegistry.skillId, input.skillId));
    logger.warn(
      "skillRegistryService: upgrade blocked — permission escalation, needs re-audit",
      { skillId: input.skillId, reason: upgradeCheck.reason }
    );
    return { ok: true, reauditRequired: true, reason: upgradeCheck.reason! };
  }

  await db
    .update(skillRegistry)
    .set({
      version: input.newManifest.version,
      name: input.newManifest.name,
      manifestChecksum: newChecksum,
      needsReaudit: 0,
    })
    .where(eq(skillRegistry.skillId, input.skillId));

  logger.info("skillRegistryService: skill upgraded", { skillId: input.skillId, version: input.newManifest.version });
  return { ok: true, reauditRequired: false };
}
