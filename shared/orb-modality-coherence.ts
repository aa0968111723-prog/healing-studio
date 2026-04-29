/**
 * shared/orb-modality-coherence.ts
 *
 * Lightweight check: does the planner's output match the modality the user
 * actually asked for? Catches the common failure mode where a vague prompt
 * gets routed to the wrong studio (e.g. user wants a video but the planner
 * dispatched fillPrompt+submit on /image-studio).
 *
 * Detection is keyword-based — same approach as inferUserMultimodalIntent on
 * the client. It's cheap and good enough for the obvious-mismatch cases that
 * users notice. Cross-language: covers Traditional Chinese + English.
 */

export type ModalityHint = "image" | "video" | "audio" | "voice" | "text" | null;

const MODALITY_KEYWORDS: Record<Exclude<ModalityHint, "text" | null>, string[]> = {
  image: [
    "圖片", "圖像", "圖", "插畫", "海報", "封面", "icon",
    "image", "photo", "picture", "illustration", "poster", "graphic",
  ],
  video: [
    "影片", "短片", "視頻", "運鏡", "分鏡", "片段",
    "video", "clip", "reel", "movie", "shot", "scene",
  ],
  audio: [
    "音樂", "配樂", "bgm", "音效", "節拍", "旋律",
    "music", "track", "song", "soundtrack", "score", "beat",
  ],
  voice: [
    "配音", "旁白", "語音", "朗讀", "tts", "聲音", "說話",
    "voice", "narration", "voiceover", "speech", "narrator",
  ],
};

function inferModalityFromText(text: string): ModalityHint {
  if (!text) return null;
  const lower = text.toLowerCase();
  // First match wins; ordering biases toward more specific signals.
  for (const modality of ["video", "voice", "audio", "image"] as const) {
    const keywords = MODALITY_KEYWORDS[modality];
    if (keywords.some(keyword => lower.includes(keyword.toLowerCase()))) {
      return modality;
    }
  }
  return null;
}

const PAGE_MODALITY: Record<string, Exclude<ModalityHint, "text" | null>> = {
  "/image-studio": "image",
  "/video-studio": "video",
  "/pro-studio": "audio",
  // /pro-studio also covers voice; leave as audio for the primary page hint
  // and let the action-level check catch voice-specific cases.
};

export interface ModalityCoherenceResult {
  /** Modality the user implied via their prompt (null = no signal). */
  declared: ModalityHint;
  /** Modality the planner actually targeted via navigate / setModality steps. */
  selected: ModalityHint;
  /** True if a clear declared signal disagrees with the planner's pick. */
  mismatch: boolean;
  /** Human-readable explanation when mismatch=true; otherwise empty. */
  message: string;
}

interface PlannerStepLike {
  action?: { type?: string; modality?: string; path?: string };
  pagePath?: string;
}

/**
 * Check coherence between user input modality and planner-selected modality.
 * Skips when either side is unknown — better to silence than to nag.
 */
export function checkModalityCoherence(args: {
  userText: string;
  steps: Array<PlannerStepLike>;
}): ModalityCoherenceResult {
  const declared = inferModalityFromText(args.userText);
  if (!declared) {
    return { declared: null, selected: null, mismatch: false, message: "" };
  }

  let selected: ModalityHint = null;
  for (const step of args.steps) {
    const action = step?.action;
    if (!action) continue;
    if (action.type === "setModality" && typeof action.modality === "string") {
      selected = action.modality as ModalityHint;
      break;
    }
    if (action.type === "navigate" && typeof action.path === "string") {
      const hint = PAGE_MODALITY[action.path];
      if (hint) {
        selected = hint;
        break;
      }
    }
    if (step.pagePath && PAGE_MODALITY[step.pagePath]) {
      selected = PAGE_MODALITY[step.pagePath];
      break;
    }
  }

  if (!selected) {
    return { declared, selected: null, mismatch: false, message: "" };
  }
  if (declared === selected) {
    return { declared, selected, mismatch: false, message: "" };
  }
  return {
    declared,
    selected,
    mismatch: true,
    message:
      `使用者似乎想做「${declared}」（依語意推斷），但計畫卻選了「${selected}」入口。` +
      `請改回 ${declared} 模態的對應頁，或先反問使用者確認。`,
  };
}
