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
  /<\|?(?:system|assistant|user|tool|function)\|?>/gi,
  /\[(?:system|assistant|user|tool|function)\]:?/gi,
  /^\s*(?:system|assistant|tool|function)\s*[:>]/gim,
  /<\/?(?:s|im_start|im_end|inst|sep)\s*\/?>/gi,
];

/**
 * Common injection / jailbreak phrases. Matches case-insensitively. We err on
 * the side of redacting (replacing with a marker) rather than rejecting so
 * legitimate quoting of these phrases still works in normal chat — the orb
 * just won't act on them.
 */
const JAILBREAK_PATTERNS = [
  /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions/gi,
  /forget\s+(?:all\s+)?(?:previous|prior|earlier)\s+instructions/gi,
  /disregard\s+(?:all\s+)?(?:previous|prior|above)/gi,
  /override\s+(?:the\s+)?(?:system\s+)?(?:prompt|instructions)/gi,
  /you\s+are\s+now\s+(?:in\s+)?(?:dan|developer|jailbreak|admin|root)\s+mode/gi,
  /act\s+as\s+(?:a\s+)?(?:dan|developer mode|jailbreak|root|admin)\b/gi,
  /pretend\s+(?:you\s+are|to\s+be)\s+(?:a\s+)?(?:different|another)\s+(?:ai|assistant)/gi,
  /from\s+now\s+on\s+(?:you|always)\s+(?:must|will|should)\s+(?:ignore|bypass|skip)/gi,
  /忽略(?:之前|以上|上面)?(?:的)?(?:所有)?(?:指示|命令|指令|規則|限制)/g,
  /無視(?:之前|以上)?(?:的)?(?:系統)?(?:提示|指令|規則)/g,
  /你?(?:現在|從現在開始)?(?:是|扮演|當)?(?:dan|越獄|破解|管理員|root)模式/gi,
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
 * Sanitize a single user-provided string. Returns the cleaned text along with
 * a list of trigger names so the caller can log / surface telemetry.
 */
export function sanitizeOrbUserText(input: string): PromptDefenseResult {
  if (!input || typeof input !== "string") {
    return { sanitized: "", blocked: false, triggers: [], truncated: false };
  }

  const triggers = new Set<string>();
  let working = input;

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
