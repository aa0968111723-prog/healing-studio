/**
 * orb-arc-state.ts — derive "where are we in the brainstorming arc?" from
 * conversation history.
 *
 * The planner system prompt (see `buildAgentPlanV3SystemPrompt`) describes a
 * 6-step arc for creative video / script projects:
 *
 *   1. Background grounding  — confirmed when prompt has a 【Context Lookup】
 *      block AND the orb's last assistant reply contains the acknowledgement
 *      sentence.
 *   2. Purpose / feel         — confirmed when 任一輪 has purpose hint.
 *   3. Modality bundle        — confirmed when user named 影片+海報 / 配樂 etc.
 *   4. Wizard dimensions      — duration / subject / style / platform.
 *   5. Script direction       — committed when the planner emitted plan.steps
 *      with toolName matching studio.* / director.* (decided downstream).
 *   6. Model recommendation   — last step the planner adds at end of
 *      summaryForUser.
 *
 * Without an explicit state hint, the LLM tends to skip ahead or re-ask. By
 * computing the state from message history and injecting it as a prompt
 * block, we give the planner a deterministic anchor: "you're at step 3,
 * ask about modality bundle".
 *
 * Pure module — no I/O, no LLM calls. Safe to import from both server and
 * client.
 */

import {
  type ClarificationModality,
  type ConversationDimensionSignals,
  type RememberedDimensionCoverage,
  inferConversationDimensions,
} from "./orb-clarification-options";

export type OrbBrainstormingStep = 1 | 2 | 3 | 4 | 5 | 6;

export interface OrbArcState {
  /** Modality the arc is operating against — same value the planner sees. */
  modality: ClarificationModality;
  /** Which step the planner should commit to NEXT. */
  currentStep: OrbBrainstormingStep;
  /** True when a 【Context Lookup】block was injected this turn. */
  hasContextBlock: boolean;
  /** True when the orb already opened with the topic acknowledgement. */
  topicAcknowledged: boolean;
  /** Purpose / feel / audience answered? */
  purposeAnswered: boolean;
  /** User confirmed which output bundle they want? */
  modalityBundleAnswered: boolean;
  /** Wizard-dimension coverage snapshot. */
  dimensions: {
    duration: boolean;
    subject: boolean;
    style: boolean;
    platform: boolean;
  };
  /**
   * Free-text reason — one short line the planner sees so it knows WHY
   * we picked this step. Helps with debugging when the state looks wrong.
   */
  rationale: string;
}

export interface OrbArcStateInput {
  /** Full message list, oldest-first. Same shape ai.chat receives. */
  messages: Array<{ role: "user" | "assistant" | "system"; content: unknown }>;
  /** Pre-detected modality; falls back to "unknown". */
  modality: ClarificationModality;
  /** True iff the current planner prompt has a 【Context Lookup】block. */
  hasContextBlock: boolean;
  /** Durable memory coverage (style/platform/purpose from prior sessions). */
  remembered?: RememberedDimensionCoverage;
  /** Prefilled signals from script-structure extractor. */
  prefilled?: ConversationDimensionSignals;
}

// Match an acknowledgement verb anywhere in the opening of the assistant
// reply. Sentence-anchored variants ("了解，這是…", "我聽到這是…") all collapse
// to the same set of verbs. We slice the reply to the first 120 chars at
// the call site so a verb later in the body (e.g. "你說的我了解了") doesn't
// fire a false-positive ack.
const TOPIC_ACK_HINTS_RE =
  /(?:我)?(?:理解|聽到|聽起來|聽得出|看起來|看得出|了解|明白|懂了)|got\s+it|i\s+(?:understand|see|hear)\b/i;

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map(part => {
      if (!part || typeof part !== "object") return "";
      const p = part as { type?: string; text?: unknown };
      if (p.type === "text" && typeof p.text === "string") return p.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * Derive the brainstorming arc state from the conversation. Pure function —
 * given the same inputs it returns the same OrbArcState.
 */
export function deriveOrbArcState(input: OrbArcStateInput): OrbArcState {
  const allUserText = input.messages
    .filter(m => m.role === "user")
    .map(m => extractText(m.content))
    .join("\n")
    .trim();
  const latestAssistantText = [...input.messages]
    .reverse()
    .find(m => m.role === "assistant");
  const latestAssistantBody = latestAssistantText
    ? extractText(latestAssistantText.content)
    : "";

  const sig = inferConversationDimensions(
    allUserText,
    input.modality,
    input.remembered,
    input.prefilled
  );
  // Restrict the ack scan to the opening of the assistant reply so a verb
  // that legitimately appears later in the body ("你說的部分我都了解了")
  // doesn't masquerade as a topic acknowledgement.
  const topicAcknowledged =
    input.hasContextBlock &&
    TOPIC_ACK_HINTS_RE.test(latestAssistantBody.slice(0, 120));
  const purposeAnswered = Boolean(sig.hasPurpose);
  const modalityBundleAnswered = Boolean(sig.hasModalityBundle);
  const dimensions = {
    duration: Boolean(sig.hasLength),
    subject: Boolean(sig.hasSubject),
    style: Boolean(sig.hasStyle),
    platform: Boolean(sig.hasPlatform),
  };
  const wizardSatisfied =
    dimensions.duration &&
    dimensions.subject &&
    dimensions.style &&
    dimensions.platform;

  // Step machine: walk the arc in order and stop at the first unmet gate.
  let currentStep: OrbBrainstormingStep;
  let rationale: string;
  if (input.hasContextBlock && !topicAcknowledged) {
    currentStep = 1;
    rationale = "context block present but orb has not yet acknowledged the subject";
  } else if (!purposeAnswered) {
    currentStep = 2;
    rationale = "purpose / 感覺 / target audience not yet confirmed";
  } else if (!modalityBundleAnswered) {
    currentStep = 3;
    rationale = "output bundle (video only / +poster / +bgm / +voice) not yet picked";
  } else if (!wizardSatisfied) {
    currentStep = 4;
    rationale = "wizard dimensions still missing (duration / subject / style / platform)";
  } else if (!planLandedInLastReply(latestAssistantBody)) {
    currentStep = 5;
    rationale = "dimensions complete; awaiting script-direction plan";
  } else {
    currentStep = 6;
    rationale = "script direction shipped; recommend modality models";
  }

  return {
    modality: input.modality,
    currentStep,
    hasContextBlock: input.hasContextBlock,
    topicAcknowledged,
    purposeAnswered,
    modalityBundleAnswered,
    dimensions,
    rationale,
  };
}

/**
 * Heuristic: does the orb's most recent assistant reply look like it already
 * shipped a script direction (numbered scenes, beats, opening/body/closing
 * framing)? Used to advance the arc from step 5 → 6.
 */
function planLandedInLastReply(text: string): boolean {
  if (!text || text.length < 80) return false;
  const sceneMarkers =
    (text.match(/(?:^|\n)\s*(?:場景|Scene|鏡頭|分鏡|Beat)\s*\d/g) ?? []).length;
  const tripletMarkers =
    /開場.{0,40}主體.{0,40}收尾|opening.{0,40}body.{0,40}closing/i.test(text);
  return sceneMarkers >= 2 || tripletMarkers;
}

/**
 * Serialize the arc state into a short prompt block the planner can read
 * verbatim. Kept terse so it doesn't bloat the context window.
 */
export function serializeArcStateForPrompt(state: OrbArcState): string {
  const stepLabels: Record<OrbBrainstormingStep, string> = {
    1: "step 1: acknowledge subject (echo the Context Lookup understanding)",
    2: "step 2: ask purpose / 感覺 / 目標觀眾 (clarification mode, 3-4 options)",
    3: "step 3: ask modality bundle (只要影片 / +海報 / +配樂 / +配音, clarification mode)",
    4: "step 4: ask the next missing wizard dimension (duration → subject → style → platform)",
    5: "step 5: commit decision.mode=tasked with script direction (opening / body / closing)",
    6: "step 6: append 2-3 modality model recommendations to summaryForUser",
  };
  const lines = [
    "【腦力激盪 arc 狀態 / Brainstorming Arc State】",
    `currentStep=${state.currentStep} — ${stepLabels[state.currentStep]}`,
    `rationale: ${state.rationale}`,
    `gates: contextAck=${state.topicAcknowledged} purpose=${state.purposeAnswered} bundle=${state.modalityBundleAnswered} duration=${state.dimensions.duration} subject=${state.dimensions.subject} style=${state.dimensions.style} platform=${state.dimensions.platform}`,
    "Drive the conversation to this step. Do NOT skip ahead unless the user explicitly answered the missing gate.",
  ];
  return lines.join("\n");
}
