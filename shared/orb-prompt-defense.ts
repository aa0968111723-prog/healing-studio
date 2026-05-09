/**
 * shared/orb-prompt-defense.ts
 *
 * Lightweight prompt-injection guard for the orb agent. Runs before the user
 * message is appended to the LLM conversation; flags / strips well-known
 * injection patterns (system role overrides, jailbreak phrases, role
 * impersonation) so the schema-first planner can't be tricked into ignoring
 * its own constraints.
 *
 * Goal:
 *   - Detect & redact fake system / assistant role markers in user content.
 *   - Strip "ignore previous instructions" / DAN / role-flip phrases.
 *   - Cap the inputtable text length to a sane ceiling (defence in depth
 *     against context window flooding).
 *
 * Non-goal:
 *   - This is not a perfect defence — it complements (not replaces) the
 *     server-side schema validation and confirmation gates.
 */

const ROLE_MARKER_PATTERNS = [
  // Open + close angle markers: covers `<|system|>`, `<system>`, `</system>`,
  // and the closing-tag variant `<|/system|>` that earlier regexes missed.
  // The slash is allowed before AND after the pipe to catch every legal
  // closing-tag arrangement attackers can paste.
  /<\|?\/?(?:system|assistant|user|tool|function)\/?\|?\/?>/gi,
  /\[(?:system|assistant|user|tool|function)\]:?/gi,
  /^\s*(?:system|assistant|tool|function)\s*[:>]/gim,
  // OpenAI ChatML role markers — the official spec uses `<|im_start|>system`
  // / `<|im_end|>`, plus older `<|begin_of_text|>` and `<s>` from Llama.
  /<\|?\/?(?:im_start|im_end|begin_of_text|end_of_text|inst|sep|s)\|?\s*\/?>/gi,
  /<\|?im_start\|?>\s*(?:system|assistant|user|tool|function)/gi,
];

/**
 * Common injection / jailbreak phrases. Matches case-insensitively. We err on
 * the side of redacting (replacing with a marker) rather than rejecting so
 * legitimate quoting of these phrases still works in normal chat — the orb
 * just won't act on them.
 */
const JAILBREAK_PATTERNS = [
  // Word boundary `\b` + `[\s-]+` lets hyphenated bypasses
  // ("ignore-all-previous-instructions") match too.
  /\bignore[\s-]+(?:all[\s-]+)?(?:previous|prior|above|earlier)[\s-]+(?:instructions?|prompts?|rules?)/gi,
  /\bforget[\s-]+(?:all[\s-]+)?(?:previous|prior|earlier|above|everything)[\s-]+(?:instructions?|prompts?|context|that|above)/gi,
  /\bforget\s+everything\s+(?:above|before|i\s+(?:said|told))/gi,
  /\bdisregard\s+(?:all\s+|the\s+|any\s+)?(?:previous|prior|above|earlier|system)\s*(?:prompts?|instructions?|rules?|messages?)?/gi,
  /\boverride\s+(?:the\s+)?(?:system\s+)?(?:prompt|instructions)/gi,
  /\byou\s+are\s+now\s+(?:in\s+)?(?:dan|developer|jailbreak|admin|root)\s*mode/gi,
  /\bact\s+as\s+(?:a\s+)?(?:dan|developer mode|jailbreak|root|admin)\b/gi,
  /\bpretend\s+(?:you\s+are|to\s+be)\s+(?:a\s+)?(?:different|another)\s+(?:ai|assistant)/gi,
  /\bfrom\s+now\s+on[\s,]*(?:you|always)?\s*(?:must|will|should|always)?\s*(?:ignore|bypass|skip)/gi,
  // Chinese: covers 忽略 / 無視 alone + 跟著「以上」「前面」「規則」等
  /忽略(?:[之前以上面前後所有的]+|系統|系统)/g,
  /無視(?:[之前以上面所有的]+|系統|系统)/g,
  /無[視视][之前以上面所有的]+(?:指示|命令|指令|規則|规则|提示|限制)?/g,
  /(?:你|您)?(?:現在|从现在|從現在)?(?:开始|開始)?(?:是|扮演|當|当)\s*(?:dan|越獄|破解|管理員|管理员|root)\s*模式/gi,
];

const REDACTION_MARKER = "[REDACTED:INJECTION]";
const MAX_USER_TEXT_LENGTH = 12_000;

export interface PromptDefenseResult {
  sanitized: string;
  blocked: boolean;
  triggers: string[];
  truncated: boolean;
}

/**
 * Strip zero-width and bidirectional control characters that attackers use
 * to splice invisible breaks inside otherwise-blocked phrases — e.g.
 * "i​gnore previous instructions" (U+200B between i and g) passes the
 * `ignore` regex if we don't drop them first. We deliberately do NOT
 * apply NFKC normalisation here: it converts full-width Chinese colons
 * (`：` U+FF1A) and other legitimate CJK punctuation to ASCII variants,
 * which corrupts the user's actual content.
 */
function normaliseInjectionInput(raw: string): string {
  // ZWSP (U+200B), ZWNJ (U+200C), ZWJ (U+200D), BOM (U+FEFF), and the bidi
  // controls U+202A-202E / U+2066-2069 that copy-paste attacks abuse.
  return raw
    .replace(/[​-‍﻿]/g, "")
    .replace(/[‪-‮⁦-⁩]/g, "");
}

/**
 * Sanitize a single user-provided string. Returns the cleaned text along with
 * a list of trigger names so the caller can log / surface telemetry.
 */
export function sanitizeOrbUserText(input: string): PromptDefenseResult {
  if (!input || typeof input !== "string") {
    return { sanitized: "", blocked: false, triggers: [], truncated: false };
  }

  const triggers = new Set<string>();
  // Strip invisible characters FIRST so zero-width / bidi-control bypasses
  // can't slip past the literal patterns below. The trigger is only fired
  // when stripping actually changed something — benign text passes silent.
  let working = normaliseInjectionInput(input);
  if (working !== input) triggers.add("invisible-chars");

  for (const pattern of ROLE_MARKER_PATTERNS) {
    if (pattern.test(working)) {
      triggers.add("role-marker");
      working = working.replace(pattern, REDACTION_MARKER);
    }
  }

  for (const pattern of JAILBREAK_PATTERNS) {
    if (pattern.test(working)) {
      triggers.add("jailbreak-phrase");
      working = working.replace(pattern, REDACTION_MARKER);
    }
  }

  let truncated = false;
  if (working.length > MAX_USER_TEXT_LENGTH) {
    truncated = true;
    triggers.add("over-length");
    working = working.slice(0, MAX_USER_TEXT_LENGTH);
  }

  // We never hard-block on pure pattern matches — over-blocking legitimate
  // messages is worse than redacting. The "blocked" flag is reserved for
  // future content-policy hooks (e.g. CSAM / violence detectors).
  return {
    sanitized: working,
    blocked: false,
    triggers: Array.from(triggers),
    truncated,
  };
}

/**
 * Apply the same defence to an array of OpenAI-style messages. Only `user`
 * role content is sanitized — assistant / system messages come from us and
 * shouldn't be touched.
 */
export function sanitizeOrbMessages<
  T extends { role: string; content: unknown }
>(messages: T[]): { messages: T[]; triggers: string[] } {
  const allTriggers = new Set<string>();
  const next = messages.map(message => {
    if (message.role !== "user") return message;
    if (typeof message.content === "string") {
      const result = sanitizeOrbUserText(message.content);
      result.triggers.forEach(t => allTriggers.add(t));
      return { ...message, content: result.sanitized };
    }
    if (Array.isArray(message.content)) {
      const cleaned = message.content.map(part => {
        if (
          part &&
          typeof part === "object" &&
          (part as { type?: unknown }).type === "text" &&
          typeof (part as { text?: unknown }).text === "string"
        ) {
          const result = sanitizeOrbUserText((part as { text: string }).text);
          result.triggers.forEach(t => allTriggers.add(t));
          return { ...(part as object), text: result.sanitized };
        }
        return part;
      });
      return { ...message, content: cleaned };
    }
    return message;
  });
  return { messages: next, triggers: Array.from(allTriggers) };
}
