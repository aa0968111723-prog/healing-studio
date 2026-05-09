/**
 * orb-reasoning.ts — shared types + builders for the orb agent's
 * "思考步驟" (thinking steps) panel.
 *
 * The orb's `ai.chat` mutation runs a multi-step planner that already
 * produces structured artefacts (intent, plan steps, warnings, citations,
 * progress milestones). Without surfacing those, the user sees only the
 * final reply and assumes the orb "just guessed". This file gives both
 * sides a single source of truth for the panel payload so the client
 * doesn't have to reverse-engineer planner internals.
 *
 * Two complementary streams power the panel:
 *   - `sections`  — bold-titled "thought" cards (intent, limitations,
 *                   formulated response). Mirrors the screenshot the user
 *                   referenced from a Gemini-style "思考步驟" sheet.
 *   - `actions`   — the action / tool-use timeline (planning, calling
 *                   specialist, materializing task, …). Mirrors the
 *                   "Read 6 files, ran 4 commands" timeline screenshot.
 */

export interface OrbReasoningSection {
  /** Short heading — e.g. "Identifying the Context", "釐清限制". */
  title: string;
  /** 1–4 sentence body describing what the orb thought at this stage. */
  body: string;
}

export type OrbReasoningActionStage =
  | "received"
  | "sanitizing"
  | "guarding_attachments"
  | "extracting_pdf"
  | "selecting_provider"
  | "researching_web"
  | "planning"
  | "calling_specialist"
  | "materializing_task"
  | "finalizing"
  | "error";

export interface OrbReasoningAction {
  /** Pipeline stage id — matches `OrbChatProgressStage`. */
  stage: OrbReasoningActionStage;
  /** Short user-facing label, e.g. "規劃步驟中…" / "召喚圖像精靈". */
  label: string;
  /** Wall-clock time the event was emitted, ms-since-epoch. */
  at: number;
  /** Optional structured details (provider id, specialist role, etc.). */
  detail?: Record<string, unknown>;
}

export interface OrbReasoningChain {
  /** Bold-titled thought cards. 0–6 entries. */
  sections: OrbReasoningSection[];
  /** Action / tool-use timeline. 0–32 entries. */
  actions: OrbReasoningAction[];
  /** Human-readable engine label (e.g. "Anthropic · claude-opus-4-7"). */
  modelLabel?: string;
  /** End-to-end planner duration in ms (null when not measured). */
  durationMs?: number;
  /** 對應後端 plannerStatus，例如 "converted" / "fallback-llm" / "fallback-error". */
  plannerStatus?: string;
}

const SECTION_TITLES = {
  context: "Identifying the Context",
  contextZh: "辨識脈絡",
  clarify: "Clarifying the Limitations",
  clarifyZh: "釐清限制",
  formulate: "Formulating the Response",
  formulateZh: "整理回覆",
  plan: "Planning the Steps",
  planZh: "規劃步驟",
} as const;

interface BuildSectionsInput {
  /** Detected intent — short phrase. */
  intent?: string | null;
  /** What the planner is going to tell the user. */
  summaryForUser?: string | null;
  /** Plan steps (label + rationale). */
  steps?: Array<{ label: string; rationale?: string | null }>;
  /** Warnings / caveats surfaced by the planner. */
  warnings?: string[];
  /** Final reply string (used when there's no plan summary). */
  reply?: string | null;
}

const STAGE_ORDER: Record<OrbReasoningActionStage, number> = {
  received: 0,
  sanitizing: 1,
  guarding_attachments: 2,
  extracting_pdf: 3,
  selecting_provider: 4,
  researching_web: 5,
  planning: 6,
  calling_specialist: 7,
  materializing_task: 8,
  finalizing: 9,
  error: 10,
};

export function isOrbReasoningActionStage(
  value: unknown
): value is OrbReasoningActionStage {
  return typeof value === "string" && value in STAGE_ORDER;
}

/**
 * Compose 2–4 bold-titled "thought" cards from planner artefacts.
 * Falls back to a single "Formulating the Response" card when the
 * planner result is sparse (e.g. legacy / fallback path).
 */
export function buildReasoningSectionsFromPlan(
  input: BuildSectionsInput
): OrbReasoningSection[] {
  const sections: OrbReasoningSection[] = [];

  const intent = (input.intent ?? "").trim();
  if (intent) {
    sections.push({
      title: `${SECTION_TITLES.contextZh} · ${SECTION_TITLES.context}`,
      body: intent.length > 280 ? `${intent.slice(0, 277)}…` : intent,
    });
  }

  const warnings = (input.warnings ?? [])
    .map(w => (typeof w === "string" ? w.trim() : ""))
    .filter(Boolean);
  if (warnings.length > 0) {
    sections.push({
      title: `${SECTION_TITLES.clarifyZh} · ${SECTION_TITLES.clarify}`,
      body: warnings.slice(0, 4).join("\n• "),
    });
  }

  const planSteps = (input.steps ?? [])
    .map(step => {
      const label = step.label?.trim();
      if (!label) return null;
      const rationale = step.rationale?.trim();
      return rationale ? `${label} — ${rationale}` : label;
    })
    .filter((s): s is string => Boolean(s));
  if (planSteps.length > 0) {
    sections.push({
      title: `${SECTION_TITLES.planZh} · ${SECTION_TITLES.plan}`,
      body: planSteps
        .slice(0, 6)
        .map((line, idx) => `${idx + 1}. ${line}`)
        .join("\n"),
    });
  }

  const summary = (input.summaryForUser ?? input.reply ?? "").trim();
  if (summary) {
    sections.push({
      title: `${SECTION_TITLES.formulateZh} · ${SECTION_TITLES.formulate}`,
      body: summary.length > 320 ? `${summary.slice(0, 317)}…` : summary,
    });
  }

  return sections;
}

/**
 * Normalise progress-bus events into the panel-friendly `actions` shape.
 * Drops malformed entries silently — the panel renders best-effort.
 */
export function normalizeReasoningActions(
  events: ReadonlyArray<{
    stage?: unknown;
    label?: unknown;
    at?: unknown;
    detail?: unknown;
  }>
): OrbReasoningAction[] {
  const out: OrbReasoningAction[] = [];
  for (const event of events) {
    if (!isOrbReasoningActionStage(event.stage)) continue;
    if (typeof event.label !== "string" || !event.label.trim()) continue;
    const at = typeof event.at === "number" && Number.isFinite(event.at)
      ? event.at
      : Date.now();
    const detail =
      event.detail && typeof event.detail === "object"
        ? (event.detail as Record<string, unknown>)
        : undefined;
    out.push({
      stage: event.stage,
      label: event.label.trim().slice(0, 160),
      at,
      detail,
    });
    if (out.length >= 32) break;
  }
  return out;
}

/**
 * Convenience shorthand for callers that have planner result + progress
 * events already in hand. Skips empty chains so the client can omit the
 * "思考步驟" button when there's nothing meaningful to show.
 */
export function buildOrbReasoningChain(args: {
  plan?: BuildSectionsInput;
  events?: ReadonlyArray<{
    stage?: unknown;
    label?: unknown;
    at?: unknown;
    detail?: unknown;
  }>;
  modelLabel?: string;
  durationMs?: number | null;
  plannerStatus?: string | null;
}): OrbReasoningChain | null {
  const sections = args.plan ? buildReasoningSectionsFromPlan(args.plan) : [];
  const actions = normalizeReasoningActions(args.events ?? []);
  if (sections.length === 0 && actions.length === 0) return null;
  return {
    sections,
    actions,
    modelLabel: args.modelLabel,
    durationMs:
      typeof args.durationMs === "number" && args.durationMs >= 0
        ? args.durationMs
        : undefined,
    plannerStatus: args.plannerStatus ?? undefined,
  };
}
