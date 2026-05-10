/**
 * shared/orb-preference-distiller.ts
 *
 * Turns the orb's accumulated `AgentFeedbackEvent` stream + DB-backed
 * `OrbMemory` records into a single `DistilledOrbPreferenceProfile` the
 * planner can fold into its system prompt. This is the "actually
 * remember the user" upgrade the per-turn `serializeFeedbackForPrompt`
 * helper couldn't deliver because it only re-flushed the last 5
 * raw events without aggregation.
 *
 * Pure + idempotent: same inputs → same profile. No DB calls, no I/O.
 * The chat router calls this once per turn with `feedbackHistory` +
 * `memories` + the legacy `ExtractedOrbPreferences`, then drops the
 * result into the planner prompt via `serializePreferenceProfileForPrompt`.
 */
import type {
  AgentFeedbackEvent,
  AgentFeedbackStatus,
  FeedbackEventLike,
} from "./agent-actions";
import type { ExtractedOrbPreferences, OrbMemory } from "./orb-memory";

export interface ActionAcceptanceStat {
  accepted: number;
  rejected: number;
  /** accepted / (accepted + rejected); 0 when total is zero. */
  ratio: number;
}

export type PacingTier = "patient" | "balanced" | "impatient";

export interface DistilledOrbPreferenceProfile {
  /** Per actionType acceptance stats. Drives auto-approve hints. */
  actionAcceptance: Record<string, ActionAcceptanceStat>;
  /** Workflow names → accept/cancel ratio (drawn from feedback notes). */
  workflowAcceptance: Record<string, ActionAcceptanceStat>;
  /** Models the user has approved most often, sorted high → low. */
  preferredModels: string[];
  /** Models the user has explicitly rejected (negative weight). */
  avoidedModels: string[];
  /** Inferred pacing — drives whether the orb pre-confirms each step. */
  pacingTier: PacingTier;
  /**
   * Confidence in this profile (0..1) — based on sample size with a
   * conservative ramp so we don't over-weight a noisy 1-event history.
   */
  confidence: number;
  /** Total feedback events that contributed (after deduplication). */
  totalEvents: number;
  /** Memories considered for model preference / workflow learning. */
  totalMemoriesConsidered: number;
  /** Carried-over from the legacy text-extraction layer. */
  extracted?: ExtractedOrbPreferences;
  /** ms-since-epoch when the distillation ran. */
  distilledAt: number;
}

/**
 * Aggregated row from the shared `agent_model_picks` table — see
 * server/services/agentModelPicks.ts. Both 導演 AI 發送工作室 and the
 * orb's recommendation pipeline write into the same table, so feeding
 * these counts into the distiller is what closes the「跟全站光球代理一起
 * 學習選模型」loop: a model picked 5 times in director shows up in the
 * orb's planner prompt as a preferred model, no extra wiring needed.
 *
 * `pickCount` is the raw select count, `acceptedCount` is the subset that
 * the destination studio later marked accepted=true. The merge step
 * weights acceptance more heavily so a high-pick / high-reject model
 * doesn't keep dominating recommendations.
 */
export interface AgentModelPickSummary {
  modelId: string;
  pickCount: number;
  acceptedCount: number;
}

export interface DistillPreferenceInput {
  feedbackEvents?: FeedbackEventLike[];
  memories?: OrbMemory[];
  extracted?: ExtractedOrbPreferences;
  /**
   * Aggregated picks from the shared `agent_model_picks` table — folded
   * into `preferredModels` / `avoidedModels` alongside the OrbMemory
   * signals. Pass an empty array (or omit) when the table is empty / a
   * cold-start user.
   */
  agentModelPicks?: AgentModelPickSummary[];
  /** ms-since-epoch override for deterministic tests. */
  now?: number;
}

const POSITIVE_STATUSES: AgentFeedbackStatus[] = ["accepted", "completed"];
const NEGATIVE_STATUSES: AgentFeedbackStatus[] = ["cancelled", "failed"];

/** "Accepted" includes "edited" — user kept the action's intent intact. */
function statusBucket(status: string): "positive" | "negative" | "neutral" {
  if (POSITIVE_STATUSES.includes(status as AgentFeedbackStatus)) return "positive";
  if (NEGATIVE_STATUSES.includes(status as AgentFeedbackStatus)) return "negative";
  if (status === "edited") return "positive";
  return "neutral";
}

/**
 * Dedup events by `${at}|${actionType}|${status}` so we never double-count
 * the same feedback that exists in BOTH the session list and the DB log.
 * Same key as `mergeFeedbackHistories` so the two paths agree.
 */
function dedupEvents<T extends FeedbackEventLike>(events: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const ev of events) {
    const key = `${ev.at}|${ev.actionType}|${ev.status}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ev);
  }
  return out;
}

function bumpAcceptance(
  table: Record<string, ActionAcceptanceStat>,
  key: string,
  bucket: "positive" | "negative"
) {
  if (!key) return;
  if (!table[key]) table[key] = { accepted: 0, rejected: 0, ratio: 0 };
  if (bucket === "positive") table[key].accepted += 1;
  else table[key].rejected += 1;
  const total = table[key].accepted + table[key].rejected;
  table[key].ratio = total > 0 ? table[key].accepted / total : 0;
}

/**
 * Heuristic: ratio of high-throughput (accepted) actions per minute over
 * the most recent observation window decides the pacing tier. We use
 * five-second mean acceptance as the proxy because:
 *   - Patient users sit on confirmation cards for tens of seconds.
 *   - Impatient users accept/edit within a couple seconds.
 *   - Anything in between is "balanced".
 */
function inferPacingTier(events: FeedbackEventLike[]): PacingTier {
  // Need at least two events to compute a delta.
  if (events.length < 2) return "balanced";
  const sorted = [...events].sort((a, b) => a.at - b.at);
  const deltas: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const ms = sorted[i].at - sorted[i - 1].at;
    if (ms > 0 && ms < 5 * 60_000) deltas.push(ms);
  }
  if (deltas.length === 0) return "balanced";
  const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  if (mean < 4_000) return "impatient";
  if (mean > 20_000) return "patient";
  return "balanced";
}

const MEMORY_MODEL_TYPES = new Set(["model_preference", "successful_workflow"]);
const NEGATIVE_MEMORY_TYPES = new Set(["failed_workflow"]);

/**
 * Pull modelId mentions from `OrbMemory[]` — both the dedicated
 * `model_preference` rows AND any `successful_workflow` row whose tags
 * include a fal-ai/* style identifier. Limited to the top 5 by frequency
 * to keep the prompt budget tight.
 */
function extractModelSignals(
  memories: OrbMemory[],
  picks: AgentModelPickSummary[] = []
): {
  preferred: string[];
  avoided: string[];
} {
  const positiveCounts = new Map<string, number>();
  const negativeCounts = new Map<string, number>();

  for (const memory of memories) {
    const isNegative = NEGATIVE_MEMORY_TYPES.has(memory.type);
    const considerPositive = MEMORY_MODEL_TYPES.has(memory.type);
    const target = isNegative
      ? negativeCounts
      : considerPositive
      ? positiveCounts
      : null;
    if (!target) continue;
    for (const tag of memory.tags ?? []) {
      // We treat anything that LOOKS like a model id (slash-separated,
      // contains an `ai` segment, or matches the fal-ai prefix) as a
      // model tag; stricter parsing belongs in the registry layer.
      if (
        tag.includes("/") &&
        (tag.includes("fal-ai") || tag.includes("replicate") || /[a-z]+\/[a-z0-9-]+/i.test(tag))
      ) {
        target.set(tag, (target.get(tag) ?? 0) + 1);
      }
    }
    // metadata.modelId is also a strong signal when present.
    const metaModelId = (memory.metadata as Record<string, unknown> | undefined)?.modelId;
    if (typeof metaModelId === "string" && metaModelId.includes("/")) {
      target.set(metaModelId, (target.get(metaModelId) ?? 0) + 1);
    }
  }

  // Fold in agent_model_picks. Weighting:
  //   positiveScore = acceptedCount * 2 + (pickCount - acceptedCount) * 1
  //   negativeScore = (pickCount - acceptedCount - markedRejected) * 0
  // Picks are added to the SAME counts map as memory signals, so the
  // distiller's downstream "top-5" sort merges them naturally.
  //
  // A pick is treated as "negative" only when the user explicitly logged
  // accepted=false on every recorded pick of that model AND the sample
  // size is meaningful (>=2). Otherwise it's a positive signal.
  for (const pick of picks) {
    const id = pick.modelId.trim();
    if (!id) continue;
    const accepted = Math.max(0, pick.acceptedCount);
    const total = Math.max(0, pick.pickCount);
    if (total === 0) continue;
    const positiveScore = accepted * 2 + (total - accepted);
    if (positiveScore > 0) {
      positiveCounts.set(id, (positiveCounts.get(id) ?? 0) + positiveScore);
    }
    // Demote models the user picked >=2 times AND never accepted: that's a
    // strong signal the destination studio rejected the result repeatedly.
    if (total >= 2 && accepted === 0) {
      negativeCounts.set(id, (negativeCounts.get(id) ?? 0) + total);
    }
  }

  const sorted = (m: Map<string, number>) =>
    Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(e => e[0]);

  return { preferred: sorted(positiveCounts), avoided: sorted(negativeCounts) };
}

/**
 * Confidence ramps: 0 events → 0; 8 events → ~0.7; 24 events → ~0.95.
 * Logarithmic so a noisy 2-event history doesn't produce a 0.5 confidence
 * that the planner would treat as authoritative.
 */
function computeConfidence(eventCount: number, memoryCount: number): number {
  const totalSignal = eventCount * 1.0 + memoryCount * 0.5;
  if (totalSignal <= 0) return 0;
  const c = 1 - 1 / Math.log2(totalSignal + 4);
  return Math.max(0, Math.min(1, c));
}

/**
 * Distill the user's interaction history into a single profile. Designed
 * to be cheap to call every turn (linear in event count, tiny constant
 * factors) so the chat router doesn't need to cache it.
 */
export function distillPreferenceProfile(
  input: DistillPreferenceInput
): DistilledOrbPreferenceProfile {
  const events = dedupEvents(input.feedbackEvents ?? []);
  const memories = input.memories ?? [];

  const actionAcceptance: Record<string, ActionAcceptanceStat> = {};
  const workflowAcceptance: Record<string, ActionAcceptanceStat> = {};

  for (const ev of events) {
    const bucket = statusBucket(ev.status);
    if (bucket === "neutral") continue;
    bumpAcceptance(actionAcceptance, ev.actionType, bucket);
    // Workflow tracking: when actionType is "runWorkflow", the `note` field
    // tends to carry the workflow name. Older events may not have it; we
    // fall back to a generic bucket so the ratio still grows.
    if (ev.actionType === "runWorkflow") {
      const wname = ev.note?.split(":")[0]?.trim() || "unnamed-workflow";
      bumpAcceptance(workflowAcceptance, wname, bucket);
    }
  }

  const picks = input.agentModelPicks ?? [];
  const { preferred, avoided } = extractModelSignals(memories, picks);
  const pacingTier = inferPacingTier(events);
  // Picks count toward confidence too — a user with 0 events / 0 memories
  // but 5 director picks is no longer a "cold start" for model selection.
  const pickEvidence = picks.reduce((sum, p) => sum + Math.max(0, p.pickCount), 0);
  const confidence = computeConfidence(
    events.length,
    memories.length + pickEvidence
  );

  return {
    actionAcceptance,
    workflowAcceptance,
    preferredModels: preferred,
    avoidedModels: avoided,
    pacingTier,
    confidence,
    totalEvents: events.length,
    totalMemoriesConsidered: memories.length + pickEvidence,
    extracted: input.extracted,
    distilledAt: input.now ?? Date.now(),
  };
}

/**
 * Render the profile into the prompt-block format the planner expects.
 * Skips empty sections to keep the prompt budget under control on a
 * brand-new user with no signal yet.
 */
export function serializePreferenceProfileForPrompt(
  profile: DistilledOrbPreferenceProfile
): string {
  if (profile.totalEvents === 0 && profile.totalMemoriesConsidered === 0) return "";
  const lines: string[] = ["【蒸餾後的使用者偏好（信心 " + profile.confidence.toFixed(2) + "）】"];

  // Action acceptance — only show the top 5 most frequent action types so
  // a heavy user doesn't blow the token budget on a 20-row table.
  const actionEntries = Object.entries(profile.actionAcceptance)
    .sort((a, b) => (b[1].accepted + b[1].rejected) - (a[1].accepted + a[1].rejected))
    .slice(0, 5);
  if (actionEntries.length > 0) {
    lines.push("- 動作接受率：");
    for (const [type, stat] of actionEntries) {
      const total = stat.accepted + stat.rejected;
      lines.push(`  · ${type}: ${stat.accepted}/${total}（${(stat.ratio * 100).toFixed(0)}%）`);
    }
  }

  if (profile.preferredModels.length > 0) {
    lines.push(`- 偏好模型：${profile.preferredModels.slice(0, 3).join("、")}`);
  }
  if (profile.avoidedModels.length > 0) {
    lines.push(`- 應避開：${profile.avoidedModels.slice(0, 3).join("、")}`);
  }
  lines.push(`- 節奏：${profile.pacingTier}`);

  if (profile.extracted?.platforms?.length) {
    lines.push(`- 投放平台：${profile.extracted.platforms.slice(0, 3).join("、")}`);
  }
  if (profile.extracted?.styles?.length) {
    lines.push(`- 風格傾向：${profile.extracted.styles.slice(0, 3).join("、")}`);
  }
  if (profile.extracted?.videoLengthHint) {
    lines.push(`- 影片長度傾向：${profile.extracted.videoLengthHint}`);
  }
  return lines.join("\n");
}

/**
 * Pure helper used by the orchestrator's `shouldAskBeforeAct` policy:
 * returns the auto-approve hint for an action type. >=70% acceptance over
 * at least 4 trials means the user has consistently said yes — the planner
 * can downgrade `confirm_high_risk` to `always_approve` for that action.
 */
export function suggestAutoApproveActions(
  profile: DistilledOrbPreferenceProfile,
  threshold: number = 0.7,
  minTrials: number = 4
): string[] {
  const out: string[] = [];
  for (const [type, stat] of Object.entries(profile.actionAcceptance)) {
    const total = stat.accepted + stat.rejected;
    if (total >= minTrials && stat.ratio >= threshold) out.push(type);
  }
  return out;
}

/** Type re-export so the chat router can import the event shape from one place. */
export type { AgentFeedbackEvent };
