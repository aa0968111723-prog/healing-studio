/**
 * Carries context from the global orb chat (`/agent`) into 導演 AI (`/director`)
 * so the user doesn't land on an empty page after the orb says "我帶你過去".
 *
 * Lives in sessionStorage (not localStorage) so it expires with the tab.
 * Kept under its own key so the studio → director payload (`directorReturn`)
 * stays untouched and the two flows don't collide.
 */

export const DIRECTOR_HANDOFF_STORAGE_KEY = "directorHandoff";

export type DirectorHandoffTurn = {
  role: "user" | "orb";
  text: string;
};

export type DirectorHandoffPayload = {
  source: "agent_chat";
  /** Latest user-typed message that triggered the redirect — used to seed the director input. */
  userIntent: string;
  /** Latest orb reply right before the redirect — used to keep tone continuity. */
  orbReply?: string;
  /** Up to ~6 most recent turns (user + orb) to give the director a quick read. */
  recentTurns: DirectorHandoffTurn[];
  /** Free-form one-line summary the director banner can show. */
  topic?: string;
  /** Wall-clock at write time. Used to ignore stale payloads (>10 min). */
  at: number;
};

const MAX_RECENT_TURNS = 6;
const MAX_TURN_CHARS = 600;
const STALE_AFTER_MS = 10 * 60 * 1000;

function clip(text: string, max = MAX_TURN_CHARS): string {
  const trimmed = (text ?? "").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

/**
 * Build a handoff payload from the orb chat history. Pass the *latest*
 * messages array (including the user message that triggered the redirect).
 *
 * Accepts a structurally-typed message list so the helper doesn't import
 * from the chat context (which would create a circular dependency).
 */
export function buildDirectorHandoffPayload(
  messages: ReadonlyArray<{ role: string; text: string }>,
): DirectorHandoffPayload {
  const conversational = messages.filter(
    m => (m.role === "user" || m.role === "orb") && m.text?.trim(),
  );
  const lastUser = [...conversational].reverse().find(m => m.role === "user");
  const lastOrb = [...conversational].reverse().find(m => m.role === "orb");
  const recent = conversational.slice(-MAX_RECENT_TURNS).map(m => ({
    role: m.role as "user" | "orb",
    text: clip(m.text),
  }));

  const userIntent = clip(lastUser?.text ?? "", MAX_TURN_CHARS);
  const topic = userIntent
    ? userIntent.split(/[\n。！？!?]/)[0]?.slice(0, 80) || userIntent.slice(0, 80)
    : undefined;

  return {
    source: "agent_chat",
    userIntent,
    orbReply: lastOrb ? clip(lastOrb.text) : undefined,
    recentTurns: recent,
    topic,
    at: Date.now(),
  };
}

export function writeDirectorHandoff(payload: DirectorHandoffPayload): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(DIRECTOR_HANDOFF_STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn("[director-handoff] Failed to write payload:", err);
  }
}

export function readAndClearDirectorHandoff(): DirectorHandoffPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(DIRECTOR_HANDOFF_STORAGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(DIRECTOR_HANDOFF_STORAGE_KEY);
    const parsed = JSON.parse(raw) as DirectorHandoffPayload;
    if (parsed.source !== "agent_chat") return null;
    if (typeof parsed.at !== "number" || Date.now() - parsed.at > STALE_AFTER_MS) {
      return null;
    }
    return parsed;
  } catch (err) {
    console.warn("[director-handoff] Failed to read payload:", err);
    return null;
  }
}
