/**
 * shared/orb-clarification-memory.ts
 *
 * Pure helpers that turn the user's multi-dimension wizard picks
 * (style / platform / purpose / subject / etc.) into the
 * `recordOrbMemory(type='user_preference', metadata={...})` shape that the
 * existing `aggregatePreferenceProfile` already aggregates back into the
 * planner's `rememberedPreferences` block.
 *
 * Goal: once the user answers "電影感 / IG Reel 9:16 / 品牌行銷" once, the
 * orb stops asking those dimensions on the next request — instead it
 * pre-fills the brief with those preferences. No new aggregation logic.
 *
 * Pure / no I/O — both server (mutation handler) and unit tests can
 * import directly without spinning up any other module.
 */
import { z } from "zod";

export const CLARIFICATION_DIMENSION_SCHEMA = z.enum([
  "format",
  "duration",
  "style",
  "audience",
  "subject",
  "platform",
  "usecase",
  "purpose",
  "modalityBundle",
  "open",
]);
export type ClarificationDimension = z.infer<typeof CLARIFICATION_DIMENSION_SCHEMA>;

export const CLARIFICATION_PICK_SCHEMA = z.object({
  dimension: CLARIFICATION_DIMENSION_SCHEMA,
  value: z.string().min(1).max(160),
});
export type ClarificationPick = z.infer<typeof CLARIFICATION_PICK_SCHEMA>;

export interface ClarificationMemoryDraft {
  /** Compact one-line summary, ≤ 200 chars (memory schema cap is 600). */
  summary: string;
  /** Tags used by `aggregatePreferenceProfile` to extract style/platform/output. */
  tags: string[];
  /**
   * Structured metadata — `aggregatePreferenceProfile` reads
   * `metadata.styles / platforms / outputs` (each must be string[]).
   */
  metadata: Record<string, string[]>;
}

/**
 * Map a wizard pick dimension to the metadata key the preference aggregator
 * understands. `subject` is intentionally NOT mapped — it's a per-job topic
 * (e.g. "this week's brand campaign"), not a durable taste signal we want
 * the orb to keep applying for years.
 */
export function dimensionToMetadataKey(
  dim: ClarificationDimension
): "styles" | "platforms" | "outputs" | null {
  switch (dim) {
    case "style":
      return "styles";
    case "platform":
    case "audience":
      return "platforms";
    case "purpose":
    case "usecase":
    case "modalityBundle":
      return "outputs";
    default:
      return null;
  }
}

/**
 * Trim the raw chip text into a short tag-friendly form. Picks come back
 * verbose ("IG Reel（9:16）", "品牌行銷／業績轉換") — we strip parentheticals
 * and slashes so duplicates collapse and the planner sees stable strings.
 */
export function normalizePickValue(value: string): string {
  let v = value.trim();
  v = v.replace(/[（(].*?[)）]/g, "").trim();
  v = v.split(/[／/]/)[0]?.trim() ?? v;
  v = v.replace(/[，,。!?？！]+$/g, "").trim();
  return v.slice(0, 80);
}

/**
 * Build the memory draft from a batch of multi-dim picks. Returns null when
 * none of the picks are durable preferences (e.g. the user only answered
 * `subject`). The caller persists with `recordOrbMemory({ type:
 * "user_preference", ...draft })`.
 */
export function buildClarificationPickMemory(
  picks: ClarificationPick[]
): ClarificationMemoryDraft | null {
  const metadata: Record<string, Set<string>> = {};
  const tags: string[] = [];
  const summaryParts: string[] = [];

  for (const pick of picks) {
    const key = dimensionToMetadataKey(pick.dimension);
    if (!key) continue;
    const norm = normalizePickValue(pick.value);
    if (!norm) continue;
    if (!metadata[key]) metadata[key] = new Set();
    metadata[key].add(norm);

    // Tag prefix mirrors `aggregatePreferenceProfile`'s `style:` / `platform:`
    // / `output:` parsing so we feed the legacy path too.
    const tagPrefix =
      key === "styles" ? "style" : key === "platforms" ? "platform" : "output";
    const tag = `${tagPrefix}:${norm}`;
    if (!tags.includes(tag)) tags.push(tag);

    summaryParts.push(`${pick.dimension}=${norm}`);
  }

  if (Object.keys(metadata).length === 0) return null;

  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(metadata)) {
    out[k] = Array.from(v).slice(0, 6);
  }

  return {
    summary: `使用者澄清偏好：${summaryParts.join("、")}`.slice(0, 200),
    tags: tags.slice(0, 16),
    metadata: out,
  };
}

/**
 * Inverse of the persistence path: given a remembered preference profile,
 * decide whether each high-signal dimension is already covered. The
 * multi-dim wizard uses this to skip dimensions the user has answered
 * before — "if we already know styles=cinematic, don't re-ask style".
 */
export interface RememberedDimensionCoverage {
  hasStyle: boolean;
  hasPlatform: boolean;
  hasPurpose: boolean;
}

export interface RememberedPreferencesShape {
  styles?: string[];
  outputs?: string[];
  platforms?: string[];
  models?: string[];
  videoLengthHint?: "short" | "medium" | "long";
}

export function rememberedDimensionCoverage(
  prefs: RememberedPreferencesShape | null | undefined
): RememberedDimensionCoverage {
  return {
    hasStyle: Boolean(prefs?.styles && prefs.styles.length > 0),
    hasPlatform: Boolean(prefs?.platforms && prefs.platforms.length > 0),
    hasPurpose: Boolean(prefs?.outputs && prefs.outputs.length > 0),
  };
}
