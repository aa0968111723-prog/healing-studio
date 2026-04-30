/*
 * shared/orb-reply-process-extractor.ts
 *
 * When the orb produces a how-to / process answer in chat, we want users to
 * see a real `/process?spec=…` link they can open in a new tab, share, or
 * tick off as they progress. Most LLMs cooperate when prompted, but some
 * paraphrase or skip the link. This module gives us a deterministic
 * server-side fallback: parse numbered steps out of the reply text and build
 * the spec automatically.
 *
 * Heuristics (lenient on purpose — false positives are cheap, the link is
 * additive and the user can ignore it):
 *
 *   - Look for at least 3 lines that start with `步驟 N`, `第 N 步`, `Step N`,
 *     or plain `N.` / `N、` / `N)`.
 *   - Treat the first sentence before the steps as the title (or fall back
 *     to "流程說明").
 *   - Accept up to PROCESS_SPEC_MAX_STEPS; ignore the rest.
 *
 * Skip when:
 *   - A `/process?spec=` link is already present (the LLM did the right
 *     thing).
 *   - There's a clear active runWorkflow plan (handled separately).
 */

import {
  buildProcessUrl,
  PROCESS_SPEC_MAX_STEPS,
  type ProcessSpec,
  type ProcessStep,
} from "./orb-process-link";

const MIN_STEPS_TO_EXTRACT = 3;
const STEP_LINE_PATTERNS: RegExp[] = [
  /^\s*步驟\s*(\d+)[.、:：．\s]?\s*(.*)$/,
  /^\s*第\s*(\d+)\s*步[:：.、．\s]?\s*(.*)$/,
  /^\s*Step\s*(\d+)[.:\s]+(.*)$/i,
  /^\s*(\d+)[.、)）．:：]\s+(.+)$/,
];

const ALREADY_HAS_LINK = /\/process\?spec=[A-Za-z0-9_-]+/;

interface RawStep {
  number: number;
  text: string;
}

function parseStepLine(line: string): RawStep | null {
  for (const pattern of STEP_LINE_PATTERNS) {
    const match = line.match(pattern);
    if (match) {
      const number = Number.parseInt(match[1], 10);
      const text = (match[2] ?? "").trim();
      if (Number.isFinite(number) && text.length > 0) {
        return { number, text };
      }
    }
  }
  return null;
}

/** Pure: detect step lines in the reply and return their texts in order. */
export function extractStepLines(reply: string): RawStep[] {
  if (!reply) return [];
  const out: RawStep[] = [];
  let lastNumber = 0;
  for (const rawLine of reply.split(/\r?\n/)) {
    const step = parseStepLine(rawLine);
    if (!step) continue;
    // Treat each step as a fresh entry — we don't enforce strict
    // sequential numbering (LLMs sometimes restart at 1 mid-reply); we just
    // keep the order they appeared in.
    out.push(step);
    lastNumber = step.number;
    if (out.length >= PROCESS_SPEC_MAX_STEPS) break;
  }
  // Avoid surfacing inflated counts when a non-list paragraph happens to
  // contain a stray numbered sentence.
  if (out.length < MIN_STEPS_TO_EXTRACT) return [];
  // Drop trailing duplicates (e.g. lists with a redundant summary line).
  const dedup: RawStep[] = [];
  for (const s of out) {
    if (
      dedup.length > 0 &&
      dedup[dedup.length - 1].text.trim() === s.text.trim()
    ) {
      continue;
    }
    dedup.push(s);
  }
  void lastNumber;
  return dedup;
}

/** Pure: pull a one-line title out of the reply (paragraph 1, ≤80 chars). */
export function extractProcessTitle(reply: string, fallback = "流程說明"): string {
  if (!reply) return fallback;
  for (const line of reply.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (parseStepLine(trimmed)) break;
    // Accept the first non-empty, non-step line as the title.
    return trimmed.length > 80 ? `${trimmed.slice(0, 79)}…` : trimmed;
  }
  return fallback;
}

export interface ExtractedProcess {
  spec: ProcessSpec;
  url: string;
}

/**
 * Build a `/process?spec=…` URL from a chat reply. Returns null when the
 * reply already contains a process link, when no usable step list was
 * detected, or when encoding fails.
 */
export function extractProcessFromReply(
  reply: string,
  options: {
    fallbackTitle?: string;
    summary?: string;
    source?: string;
    emoji?: string;
  } = {}
): ExtractedProcess | null {
  if (!reply || ALREADY_HAS_LINK.test(reply)) return null;
  const rawSteps = extractStepLines(reply);
  if (rawSteps.length === 0) return null;

  const steps: ProcessStep[] = rawSteps.map(s => ({ title: s.text }));
  const spec: ProcessSpec = {
    title: extractProcessTitle(reply, options.fallbackTitle),
    ...(options.summary ? { summary: options.summary } : {}),
    ...(options.source ? { source: options.source } : { source: "光球 / 自動整理" }),
    ...(options.emoji ? { emoji: options.emoji } : { emoji: "🧭" }),
    kind: "howto",
    steps,
  };

  try {
    const url = buildProcessUrl(spec);
    return { spec, url };
  } catch {
    return null;
  }
}

/**
 * Append a "想之後看或分享：<url>" line to the reply when an extracted
 * process URL is available. No-op if no process can be extracted.
 */
export function appendProcessLinkToReply(
  reply: string,
  options: Parameters<typeof extractProcessFromReply>[1] = {}
): { reply: string; url: string | null } {
  const extracted = extractProcessFromReply(reply, options);
  if (!extracted) return { reply, url: null };
  return {
    reply: `${reply}\n\n🔗 想之後看或分享：${extracted.url}`,
    url: extracted.url,
  };
}
