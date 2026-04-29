/**
 * shared/orb-content-moderation.ts
 *
 * Lightweight, dependency-free content moderation for orb LLM output. Runs
 * after the planner returns and before the reply ships to the user. Triggers
 * are categorised so the orchestrator can choose to redact, prepend a warning,
 * or block the reply outright.
 *
 * This is intentionally pattern-based — not a substitute for a managed
 * moderation API (Anthropic / OpenAI / Llama Guard). It catches the
 * obvious-and-cheap cases so we never ship raw slurs / explicit content
 * back to a healing-studio user. For higher-fidelity moderation, swap in a
 * managed API at the moderateOrbContent call site.
 */

const VIOLENCE_PATTERNS = [
  /\b(?:kill|murder|stab|behead|massacre|slaughter)\s+(?:them|him|her|you|the)\b/i,
  /\b(?:how to (?:make|build))\s+(?:a\s+)?(?:bomb|grenade|pipe bomb|explosive)\b/i,
  /\b(?:how to (?:harm|hurt|attack))\s+(?:a\s+)?(?:person|child|woman)\b/i,
  /殺(?:掉|害|死)(?:他|她|你|那個人|這個人)/,
  /(?:如何|怎麼)(?:製作|做|組裝)(?:炸彈|爆裂物|武器)/,
];

const HATE_PATTERNS = [
  // English slurs — intentionally avoiding the literal terms here; these
  // catch common ASCII variants without baking the slur into source.
  /\bn[i1l!]+gg+[ae3r]+s?\b/i,
  /\bf[a4]gg+[oa0]+ts?\b/i,
  /\bk[i1l!]+kes?\b/i,
];

const EXPLICIT_PATTERNS = [
  /\b(?:cock|cunt|pussy)\s+(?:sucking|fucking|riding)/i,
  /\b(?:rape|raping|raped)\s+(?:her|him|them|the\s+\w+)/i,
];

const SELF_HARM_PATTERNS = [
  /\b(?:how to (?:cut|kill)\s+(?:yourself|myself))\b/i,
  /\b(?:best way to (?:end (?:your|my) life|commit suicide))\b/i,
  /(?:如何|怎麼)(?:自殺|自殘|了結自己)/,
];

export type ModerationCategory =
  | "violence"
  | "hate"
  | "explicit"
  | "self-harm";

export type ModerationAction = "block" | "warn" | "pass";

export interface ModerationFinding {
  category: ModerationCategory;
  pattern: string;
  excerpt: string;
}

export interface ModerationResult {
  action: ModerationAction;
  findings: ModerationFinding[];
  /** Replacement reply when action === "block". Otherwise the original text. */
  text: string;
}

const BLOCK_REPLY =
  "🌿 抱歉，這個回覆觸及我能協助的安全範圍之外。換個問法或聚焦在創作 / 學習主題我會更能幫上忙。";
const WARN_PREFIX = "⚠️ 以下內容可能包含敏感主題，僅供參考：\n\n";

function scan(
  text: string,
  category: ModerationCategory,
  patterns: RegExp[]
): ModerationFinding[] {
  const findings: ModerationFinding[] = [];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      findings.push({
        category,
        pattern: pattern.source,
        excerpt: match[0].slice(0, 80),
      });
    }
  }
  return findings;
}

/**
 * Moderate an LLM-generated reply. Violence / hate / explicit content with a
 * clear pattern match → block. Self-harm → warn (we still want to surface
 * crisis hotline / supportive resources, not silence the reply). Empty or
 * non-string input is treated as a pass.
 */
export function moderateOrbContent(text: string): ModerationResult {
  if (!text || typeof text !== "string") {
    return { action: "pass", findings: [], text: text ?? "" };
  }
  const findings: ModerationFinding[] = [];
  findings.push(...scan(text, "violence", VIOLENCE_PATTERNS));
  findings.push(...scan(text, "hate", HATE_PATTERNS));
  findings.push(...scan(text, "explicit", EXPLICIT_PATTERNS));
  findings.push(...scan(text, "self-harm", SELF_HARM_PATTERNS));

  if (findings.length === 0) {
    return { action: "pass", findings: [], text };
  }
  const blocking = findings.some(f =>
    f.category === "violence" || f.category === "hate" || f.category === "explicit"
  );
  if (blocking) {
    return { action: "block", findings, text: BLOCK_REPLY };
  }
  // Self-harm only → warn but keep the reply so users can still reach help.
  return {
    action: "warn",
    findings,
    text: `${WARN_PREFIX}${text}`,
  };
}
