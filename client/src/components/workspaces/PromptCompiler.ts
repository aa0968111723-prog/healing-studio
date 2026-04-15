import type {
  StructuredBlock,
  PromptStrengthLevel,
  Modality,
  ThoughtIsland,
} from "@/stores/workspaceStore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PromptWarning = {
  level: "info" | "warning" | "error";
  message: string;
  field?: string;
};

export type PromptCompileResult = {
  compiledPrompt: string;
  summary: string;
  changedFields: string[];
  warnings: PromptWarning[];
};

// ---------------------------------------------------------------------------
// Modality-specific field orderings
// ---------------------------------------------------------------------------

const MODALITY_FIELD_ORDER: Record<Modality, string[]> = {
  image: ["composition", "lighting", "style", "subject_detail", "negative"],
  video: [
    "subject_action",
    "camera_movement",
    "pacing",
    "continuity",
    "negative_motion",
  ],
  music: ["use_case", "mood", "bpm", "instrumentation", "structure"],
  voice: ["script", "speaker_identity", "tone", "pace", "pronunciation_notes"],
};

// ---------------------------------------------------------------------------
// Conflict definitions per modality
// ---------------------------------------------------------------------------

type ConflictPair = [string, string];

const MODALITY_CONFLICTS: Record<Modality, ConflictPair[]> = {
  image: [["realistic photography", "flat illustration"]],
  video: [["fixed camera", "handheld shaking"]],
  music: [["calm piano", "intense battle drums"]],
  voice: [],
};

// Field keys that are only valid for a given modality – used for mismatch detection.
const MODALITY_EXCLUSIVE_FIELDS: Record<string, Modality> = {
  camera_movement: "video",
  subject_action: "video",
  continuity: "video",
  negative_motion: "video",
  pacing: "video",
  composition: "image",
  lighting: "image",
  subject_detail: "image",
  bpm: "music",
  instrumentation: "music",
  use_case: "music",
  speaker_identity: "voice",
  pronunciation_notes: "voice",
  script: "voice",
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function applyStrengthModifier(
  value: string,
  category: StructuredBlock["category"],
  strength: PromptStrengthLevel
): string {
  switch (strength) {
    case "low":
      return value;

    case "medium":
      return category === "required" ? `(important: ${value})` : value;

    case "high":
      if (category === "required") return `((strictly: ${value}))`;
      if (category === "control") return `(important: ${value})`;
      return value;

    case "locked":
      if (category === "required") return `((strictly: ${value}))`;
      if (category === "control") return `(important: ${value})`;
      return value;

    default:
      return value;
  }
}

function buildThoughtIslandContext(islands: ThoughtIsland[]): string {
  const parts: string[] = [];
  for (const island of islands) {
    if (!island.content) continue;
    const label =
      island.category.charAt(0).toUpperCase() + island.category.slice(1);
    parts.push(`${label}: ${island.content}.`);
  }
  return parts.length > 0 ? `Context: ${parts.join(" ")}` : "";
}

function sortBlocksByModality(
  blocks: StructuredBlock[],
  modality: Modality
): StructuredBlock[] {
  const order = MODALITY_FIELD_ORDER[modality];
  return [...blocks].sort((a, b) => {
    const ai = order.indexOf(a.fieldKey);
    const bi = order.indexOf(b.fieldKey);
    // Unknown fields go to the end, preserving their relative order.
    const aIndex = ai === -1 ? order.length : ai;
    const bIndex = bi === -1 ? order.length : bi;
    return aIndex - bIndex;
  });
}

// ---------------------------------------------------------------------------
// diffBlocks
// ---------------------------------------------------------------------------

export function diffBlocks(
  current: StructuredBlock[],
  previous: StructuredBlock[]
): string[] {
  const prevMap = new Map<string, StructuredBlock>();
  for (const b of previous) {
    prevMap.set(b.fieldKey, b);
  }

  const changed: string[] = [];
  for (const block of current) {
    const prev = prevMap.get(block.fieldKey);
    if (!prev) {
      changed.push(block.fieldKey);
      continue;
    }
    if (
      prev.value !== block.value ||
      prev.enabled !== block.enabled ||
      prev.category !== block.category
    ) {
      changed.push(block.fieldKey);
    }
  }

  // Detect blocks present in previous but removed from current.
  for (const prev of previous) {
    if (!current.some(b => b.fieldKey === prev.fieldKey)) {
      changed.push(prev.fieldKey);
    }
  }

  return changed;
}

// ---------------------------------------------------------------------------
// lintPrompt
// ---------------------------------------------------------------------------

export function lintPrompt(
  modality: Modality,
  blocks: StructuredBlock[],
  negativePrompt: string
): PromptWarning[] {
  const warnings: PromptWarning[] = [];

  // 1. Missing required fields
  for (const block of blocks) {
    if (block.category === "required" && block.enabled && !block.value.trim()) {
      warnings.push({
        level: "error",
        message: `Required field "${block.label}" is empty.`,
        field: block.fieldKey,
      });
    }
  }

  // 2. Conflict detection
  const enabledValues = blocks
    .filter(b => b.enabled && b.value.trim())
    .map(b => b.value.toLowerCase());

  const allText = [...enabledValues, negativePrompt.toLowerCase()].join(" | ");

  for (const [termA, termB] of MODALITY_CONFLICTS[modality]) {
    if (allText.includes(termA) && allText.includes(termB)) {
      warnings.push({
        level: "warning",
        message: `Possible conflict: "${termA}" and "${termB}" may produce unexpected results.`,
      });
    }
  }

  // 3. Too many high-impact conditions
  const enabledCount = blocks.filter(b => b.enabled).length;
  if (enabledCount > 8) {
    warnings.push({
      level: "warning",
      message: `${enabledCount} blocks are enabled. Consider reducing to 8 or fewer for more predictable results.`,
    });
  }

  // 4. Modality mismatch
  for (const block of blocks) {
    if (!block.enabled) continue;
    const expectedModality = MODALITY_EXCLUSIVE_FIELDS[block.fieldKey];
    if (expectedModality && expectedModality !== modality) {
      warnings.push({
        level: "warning",
        message: `Field "${block.label}" is typically used in ${expectedModality} workspaces, not ${modality}.`,
        field: block.fieldKey,
      });
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// compilePrompt
// ---------------------------------------------------------------------------

export function compilePrompt(
  modality: Modality,
  blocks: StructuredBlock[],
  thoughtIslands: ThoughtIsland[],
  promptStrength: PromptStrengthLevel,
  advancedPrompt: string,
  advancedPromptOverride: boolean,
  negativePrompt: string,
  previousBlocks?: StructuredBlock[]
): PromptCompileResult {
  const warnings = lintPrompt(modality, blocks, negativePrompt);
  const changedFields = previousBlocks
    ? diffBlocks(blocks, previousBlocks)
    : [];

  // --- Advanced override short-circuit ---
  if (advancedPromptOverride && advancedPrompt.trim()) {
    return {
      compiledPrompt: advancedPrompt.trim(),
      summary: "Advanced prompt override active.",
      changedFields,
      warnings,
    };
  }

  const parts: string[] = [];

  // ThoughtIslands context
  const context = buildThoughtIslandContext(thoughtIslands);
  if (context) {
    parts.push(context);
  }

  // Locked-mode prefix
  if (promptStrength === "locked") {
    parts.push("MUST follow these instructions exactly:");
  }

  // Sort & compile enabled blocks
  const sorted = sortBlocksByModality(blocks, modality);
  const blockParts: string[] = [];
  for (const block of sorted) {
    if (!block.enabled || !block.value.trim()) continue;
    blockParts.push(
      applyStrengthModifier(block.value.trim(), block.category, promptStrength)
    );
  }
  if (blockParts.length > 0) {
    parts.push(blockParts.join(", "));
  }

  // Negative prompt
  if (negativePrompt.trim()) {
    parts.push(`Negative: ${negativePrompt.trim()}`);
  }

  // Append (not override) advanced prompt
  if (!advancedPromptOverride && advancedPrompt.trim()) {
    parts.push(advancedPrompt.trim());
  }

  const compiledPrompt = parts.join("\n");

  // Build summary
  const enabledCount = blocks.filter(b => b.enabled).length;
  const summarySegments = [`${enabledCount} block(s) for ${modality}`];
  if (negativePrompt.trim()) summarySegments.push("with negative prompt");
  if (advancedPrompt.trim() && !advancedPromptOverride)
    summarySegments.push("+ advanced prompt");
  const summary = summarySegments.join(", ");

  return { compiledPrompt, summary, changedFields, warnings };
}
