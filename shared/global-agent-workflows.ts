/*
 * shared/global-agent-workflows.ts
 * ───────────────────────────────────────────────────────────────
 * Workflow helpers for the true site-wide AI agent.
 *
 * The LLM may return a runWorkflow action with lightweight workflow steps:
 *   { path, actionType, payload, label }
 * This file converts those lightweight steps into strict AgentAction objects so
 * the orchestrator can navigate across pages and dispatch real actions.
 */

import type {
  AgentAction,
  AgentModality,
  AgentWorkflowStep,
  RunWorkflowAction,
} from "./agent-actions";

export interface ExpandedWorkflowStep {
  path?: string;
  label: string;
  action: AgentAction;
}

function isModality(value: string): value is AgentModality {
  return value === "image" || value === "video" || value === "audio" || value === "voice";
}

function parsePayloadValue(payload: string): unknown {
  const trimmed = payload.trim();
  if (!trimmed) return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  try {
    return JSON.parse(trimmed);
  } catch {
    return payload;
  }
}

function splitKeyValue(payload: string): { key: string; value: unknown } | null {
  const trimmed = payload.trim();
  const colonIndex = trimmed.indexOf(":");
  const equalsIndex = trimmed.indexOf("=");
  const splitIndex = colonIndex >= 0 ? colonIndex : equalsIndex;
  if (splitIndex <= 0) return null;
  const key = trimmed.slice(0, splitIndex).trim();
  const value = trimmed.slice(splitIndex + 1).trim();
  if (!key) return null;
  return { key, value: parsePayloadValue(value) };
}

export function workflowStepToAction(step: AgentWorkflowStep): AgentAction | null {
  const type = step.actionType.trim();
  const payload = step.payload ?? "";

  switch (type) {
    case "fillPrompt":
      return { type: "fillPrompt", text: payload };
    case "appendPrompt":
      return { type: "fillPrompt", text: payload, append: true };
    case "fillNegativePrompt":
      return { type: "fillPrompt", text: payload, slot: "negativePrompt" };
    case "fillLyrics":
      return { type: "fillPrompt", text: payload, slot: "lyrics" };
    case "setModel":
      return payload ? { type: "setModel", modelId: payload } : null;
    case "setTab":
      return payload ? { type: "setTab", tabId: payload } : null;
    case "setMode":
      return payload ? { type: "setMode", modeId: payload } : null;
    case "setModality":
      return isModality(payload) ? { type: "setModality", modality: payload } : null;
    case "applyPreset":
      return payload ? { type: "applyPreset", presetId: payload } : null;
    case "submit":
    case "generate":
      return { type: "submit" };
    case "reset":
      return { type: "reset" };
    case "search":
      return payload ? { type: "search", query: payload } : null;
    case "focusElement":
      return payload ? { type: "focusElement", elementId: payload, message: step.label } : null;
    case "openDialog":
      return payload ? { type: "openDialog", dialogId: payload } : null;
    case "toggleSetting": {
      const kv = splitKeyValue(payload);
      if (!kv) return payload ? { type: "toggleSetting", key: payload } : null;
      return { type: "toggleSetting", key: kv.key, value: typeof kv.value === "boolean" ? kv.value : undefined };
    }
    case "setParam": {
      const kv = splitKeyValue(payload);
      return kv ? { type: "setParam", key: kv.key, value: kv.value } : null;
    }
    case "navigate":
      return payload ? { type: "navigate", path: payload } : null;
    default:
      return null;
  }
}

export function expandWorkflowAction(action: RunWorkflowAction): ExpandedWorkflowStep[] {
  const expanded: ExpandedWorkflowStep[] = [];

  for (const step of action.steps) {
    const concrete = workflowStepToAction(step);
    if (!concrete) continue;

    expanded.push({
      ...(step.path ? { path: step.path } : {}),
      label: step.label,
      action: concrete,
    });
  }

  return expanded;
}

export function buildShortVideoWorkflow(brief: string): RunWorkflowAction {
  const basePrompt = brief.trim() || "30 秒電影感短片，清楚主題、三幕節奏、可生成分鏡";
  return {
    type: "runWorkflow",
    name: "AI Director 短片生成流程",
    steps: [
      {
        path: "/director",
        actionType: "fillPrompt",
        payload: `請把這個需求拆成 30 秒短片企劃、三幕腳本、3 個鏡頭分鏡、每鏡頭視覺提示詞：${basePrompt}`,
        label: "導演 AI：產生短片企劃與分鏡",
      },
      {
        path: "/studio",
        actionType: "setModality",
        payload: "image",
        label: "創作工作室：切換到圖像",
      },
      {
        path: "/studio",
        actionType: "fillPrompt",
        payload: `根據短片需求建立第一張電影感關鍵視覺：${basePrompt}`,
        label: "圖像工作室：填入第一張關鍵視覺提示詞",
      },
      {
        path: "/studio",
        actionType: "submit",
        payload: "",
        label: "圖像工作室：生成關鍵視覺",
      },
      {
        path: "/video-studio",
        actionType: "fillPrompt",
        payload: `把關鍵視覺延伸成 30 秒短片運鏡，包含鏡頭移動、情緒節奏、光影與剪輯感：${basePrompt}`,
        label: "影片工作室：填入影片生成提示詞",
      },
      {
        path: "/video-studio",
        actionType: "submit",
        payload: "",
        label: "影片工作室：生成影片",
      },
      {
        path: "/pro-studio",
        actionType: "setTab",
        payload: "tts",
        label: "音樂配音創作室：切換到語音合成",
      },
      {
        path: "/pro-studio",
        actionType: "fillPrompt",
        payload: `請生成適合這支短片的旁白稿與語氣：${basePrompt}`,
        label: "配音：填入旁白需求",
      },
    ],
  };
}

export function buildImageWorkflow(brief: string): RunWorkflowAction {
  const basePrompt = brief.trim() || "一張電影感的療癒風景圖，柔和光線、低噪、構圖留白";
  return {
    type: "runWorkflow",
    name: "圖片生成流程",
    steps: [
      {
        path: "/image-studio",
        actionType: "fillPrompt",
        payload: basePrompt,
        label: "圖片創作室：填入提示詞",
      },
      {
        path: "/image-studio",
        actionType: "submit",
        payload: "",
        label: "圖片創作室：生成圖片",
      },
    ],
  };
}

export function buildMusicWorkflow(brief: string): RunWorkflowAction {
  const basePrompt = brief.trim() || "請生成一段放鬆療癒的背景音樂，120 秒、舒緩節奏";
  return {
    type: "runWorkflow",
    name: "音樂生成流程",
    steps: [
      {
        path: "/pro-studio",
        actionType: "setTab",
        payload: "music",
        label: "音樂配音創作室：切換到音樂分頁",
      },
      {
        path: "/pro-studio",
        actionType: "fillPrompt",
        payload: basePrompt,
        label: "音樂配音創作室：填入音樂需求",
      },
      {
        path: "/pro-studio",
        actionType: "submit",
        payload: "",
        label: "音樂配音創作室：生成音樂",
      },
    ],
  };
}

export function buildVoiceWorkflow(brief: string): RunWorkflowAction {
  const basePrompt = brief.trim() || "請朗讀以下旁白稿，語速自然、情緒平穩";
  return {
    type: "runWorkflow",
    name: "語音合成流程",
    steps: [
      {
        path: "/pro-studio",
        actionType: "setTab",
        payload: "tts",
        label: "音樂配音創作室：切換到語音合成",
      },
      {
        path: "/pro-studio",
        actionType: "fillPrompt",
        payload: basePrompt,
        label: "音樂配音創作室：填入旁白稿",
      },
      {
        path: "/pro-studio",
        actionType: "submit",
        payload: "",
        label: "音樂配音創作室：生成語音",
      },
    ],
  };
}

export function buildSfxWorkflow(brief: string): RunWorkflowAction {
  const basePrompt = brief.trim() || "請產生一段環境音效，10 秒、清晰、可循環";
  return {
    type: "runWorkflow",
    name: "音效生成流程",
    steps: [
      {
        path: "/pro-studio",
        actionType: "setTab",
        payload: "sfx",
        label: "音樂配音創作室：切換到音效分頁",
      },
      {
        path: "/pro-studio",
        actionType: "fillPrompt",
        payload: basePrompt,
        label: "音樂配音創作室：填入音效描述",
      },
      {
        path: "/pro-studio",
        actionType: "submit",
        payload: "",
        label: "音樂配音創作室：生成音效",
      },
    ],
  };
}

export function buildScriptOnlyWorkflow(brief: string): RunWorkflowAction {
  const basePrompt = brief.trim() || "30 秒療癒短片企劃";
  return {
    type: "runWorkflow",
    name: "腳本規劃流程",
    steps: [
      {
        path: "/director",
        actionType: "fillPrompt",
        payload: `請幫我規劃：${basePrompt}`,
        label: "導演 AI：產生腳本與分鏡",
      },
    ],
  };
}

/**
 * Infer a sensible chapter count for a long-video workflow. Caps at 6 so the
 * workflow stays under ~30 steps.
 *
 * - explicit "N 章" / "N 章節" → N (clamped 2..6)
 * - X 分鐘 → 2 / 3 / 4 / 5 / 6 chapters by length tier
 * - fallback → 3
 */
export function inferLongVideoChapters(text: string): number {
  const chapterMatch = text.match(/(\d+)\s*章/);
  if (chapterMatch) {
    return Math.max(2, Math.min(6, Number.parseInt(chapterMatch[1], 10)));
  }
  const minutesMatch = text.match(/(\d+)\s*分(?!之|秒)/);
  if (minutesMatch) {
    const minutes = Number.parseInt(minutesMatch[1], 10);
    if (minutes <= 1) return 2;
    if (minutes <= 3) return 3;
    if (minutes <= 5) return 4;
    if (minutes <= 10) return 5;
    return 6;
  }
  return 3;
}

export interface LongVideoWorkflowOptions {
  chapters?: number;
}

export function buildLongVideoWorkflow(
  brief: string,
  options: LongVideoWorkflowOptions = {}
): RunWorkflowAction {
  const trimmedBrief = brief.trim();
  const chapters = Math.max(
    2,
    Math.min(6, options.chapters ?? inferLongVideoChapters(trimmedBrief || ""))
  );
  const basePrompt =
    trimmedBrief || `${chapters} 章節長片，主題待定，請依使用者描述展開`;

  const steps: AgentWorkflowStep[] = [
    {
      path: "/director",
      actionType: "fillPrompt",
      payload:
        `請把這個需求拆成 ${chapters} 個章節的長片企劃，每章包含：` +
        `主題、核心訊息、視覺方向、節奏、配樂氛圍、旁白要點，` +
        `章節之間要能自然銜接：${basePrompt}`,
      label: `導演 AI：產生 ${chapters} 章節長片企劃`,
    },
  ];

  for (let i = 1; i <= chapters; i += 1) {
    steps.push(
      {
        path: "/image-studio",
        actionType: "fillPrompt",
        payload: `第 ${i} 章關鍵視覺（請延續導演 AI 該章主題與情緒方向）：${basePrompt}`,
        label: `第 ${i} 章：填入關鍵視覺提示詞`,
      },
      {
        path: "/image-studio",
        actionType: "submit",
        payload: "",
        label: `第 ${i} 章：生成關鍵視覺`,
      },
      {
        path: "/video-studio",
        actionType: "fillPrompt",
        payload:
          `第 ${i} 章運鏡（鏡頭移動、節奏、光感，與第 ${i} 章主題對齊）：${basePrompt}`,
        label: `第 ${i} 章：填入影片提示詞`,
      },
      {
        path: "/video-studio",
        actionType: "submit",
        payload: "",
        label: `第 ${i} 章：生成影片`,
      }
    );
  }

  steps.push(
    {
      path: "/pro-studio",
      actionType: "setTab",
      payload: "music",
      label: "音樂配音創作室：切換到音樂分頁",
    },
    {
      path: "/pro-studio",
      actionType: "fillPrompt",
      payload:
        `請為這支 ${chapters} 章節長片做一段連貫的背景音樂，` +
        `情緒隨章節推進變化、整體保持一致風格：${basePrompt}`,
      label: "全片配樂：填入音樂提示詞",
    },
    {
      path: "/pro-studio",
      actionType: "submit",
      payload: "",
      label: "全片配樂：生成音樂",
    },
    {
      path: "/pro-studio",
      actionType: "setTab",
      payload: "tts",
      label: "音樂配音創作室：切換到語音合成",
    },
    {
      path: "/pro-studio",
      actionType: "fillPrompt",
      payload:
        `請依 ${chapters} 章節結構生成旁白稿，每章一段、節奏與章節對齊：${basePrompt}`,
      label: "全片旁白：填入旁白稿",
    }
  );

  return {
    type: "runWorkflow",
    name: `${chapters} 章節長片生成流程`,
    steps,
  };
}

export type VideoIntentDetection =
  | { kind: "none" }
  | { kind: "ready"; workflow: RunWorkflowAction }
  | { kind: "needs-clarification"; message: string; options: string[] };

export type CreationIntentDetection = VideoIntentDetection;

/**
 * Subset of the server-side OrbUserPreferenceProfile that the keyword fallback
 * cares about. Keep the shape forward-compatible (all fields optional) so the
 * server can grow the profile without breaking the client.
 */
export interface RememberedCreationPreferences {
  name?: string;
  styles?: string[];
  outputs?: string[];
  platforms?: string[];
  models?: string[];
  videoLengthHint?: "short" | "medium" | "long";
}

function styleHint(prefs: RememberedCreationPreferences | undefined): string {
  if (!prefs?.styles?.length) return "";
  return `（風格傾向：${prefs.styles.slice(0, 2).join("、")}）`;
}

function platformHint(prefs: RememberedCreationPreferences | undefined): string {
  if (!prefs?.platforms?.length) return "";
  return `（投放：${prefs.platforms.slice(0, 2).join("、")}）`;
}

const VIDEO_KEYWORDS = [
  "短片",
  "影片",
  "長片",
  "長影片",
  "長視頻",
  "video",
  "reel",
  "mv",
  "廣告",
];
const IMAGE_KEYWORDS = ["圖片", "圖像", "海報", "插畫", "封面", "image", "picture", "illustration", "poster"];
const MUSIC_KEYWORDS = ["音樂", "配樂", "背景音樂", "歌曲", "歌", "曲子", "旋律", "music", "song", "bgm"];
const VOICE_KEYWORDS = ["旁白", "配音", "語音", "tts", "voice", "narration", "narrator"];
const SFX_KEYWORDS = ["音效", "foley", "sound effect", "sfx"];
const SCRIPT_KEYWORDS = ["腳本", "劇本", "分鏡", "故事大綱", "story outline", "script", "storyboard"];
const BUILD_KEYWORDS = [
  "幫我做",
  "幫我寫",
  "幫我生",
  "幫我產",
  "幫我製",
  "幫我做一",
  "想做",
  "想要做",
  "想生",
  "做一個",
  "做一支",
  "做一張",
  "做一首",
  "做一段",
  "生成",
  "製作",
  "create",
  "make",
  "build",
  "compose",
  "produce",
  "generate",
];

const LENGTH_HINT_RE =
  /(\d+\s*(秒|分鐘?|小時|second|minute|hour|min|sec|mins|secs)\b)|\d+s\b|短片|長片|長影片|長視頻/i;
const LONG_HINT_RE = /長片|長影片|長視頻|長.{0,4}的?(影片|video)/i;
const SHORT_HINT_RE = /短片|reel|30\s*秒|15\s*秒|\b(short|teaser)\b/i;
const SUBJECT_HINT_RE = /[:：]|主題|題目|關於|介紹|品牌|產品|內容是|story|theme|brand|product/i;

interface ModalityHits {
  video: boolean;
  image: boolean;
  music: boolean;
  voice: boolean;
  sfx: boolean;
  script: boolean;
}

function matchAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some(token => haystack.includes(token));
}

function detectModalityHits(q: string): ModalityHits {
  return {
    video: matchAny(q, VIDEO_KEYWORDS),
    image: matchAny(q, IMAGE_KEYWORDS),
    music: matchAny(q, MUSIC_KEYWORDS),
    voice: matchAny(q, VOICE_KEYWORDS),
    sfx: matchAny(q, SFX_KEYWORDS),
    script: matchAny(q, SCRIPT_KEYWORDS),
  };
}

export function detectVideoIntent(
  text: string,
  preferences?: RememberedCreationPreferences
): VideoIntentDetection {
  const trimmed = text.trim();
  const q = trimmed.toLowerCase();
  const wantsVideo = matchAny(q, VIDEO_KEYWORDS);
  const wantsBuild = matchAny(q, BUILD_KEYWORDS);
  if (!(wantsVideo && wantsBuild)) return { kind: "none" };

  const hasLength = LENGTH_HINT_RE.test(trimmed);
  const wantsLong = LONG_HINT_RE.test(trimmed) || /\d+\s*分(?!之|秒)/.test(trimmed);
  const isShortHint = SHORT_HINT_RE.test(trimmed);
  const hasSubject = trimmed.length >= 25 || SUBJECT_HINT_RE.test(trimmed);

  // Style / platform we know about become hints embedded in the prompt so
  // generated work matches the user's usual taste without re-asking.
  const enrichedBrief = `${trimmed}${styleHint(preferences)}${platformHint(preferences)}`;

  if (wantsLong && !isShortHint) {
    if (hasSubject) {
      return { kind: "ready", workflow: buildLongVideoWorkflow(enrichedBrief) };
    }
    return {
      kind: "needs-clarification",
      message:
        "長影片我可以幫你拼成多章節流程，先告訴我主題或想表達的核心訊息，我再幫你展開章節步驟。",
      options: [
        "1–3 分鐘的中片（3 章節）",
        "5 分鐘的長片（4 章節）",
        "10 分鐘以上的深度長片（5–6 章節）",
        "改做 30 秒短片就好",
      ],
    };
  }

  // Use the remembered length tier when the user didn't specify one.
  // - long: kick off the long workflow if we also have subject hint
  // - medium: still go short for now (no medium builder); but inject hint
  // - short or unset: short workflow
  if (!hasLength) {
    if (preferences?.videoLengthHint === "long" && hasSubject) {
      return { kind: "ready", workflow: buildLongVideoWorkflow(enrichedBrief) };
    }
  }

  if (!hasLength && !hasSubject) {
    return {
      kind: "needs-clarification",
      message:
        "影片我可以幫你拼，先給我幾個關鍵點：長度、主題、風格、投放平台。回我一兩句就好，我再展開步驟。",
      options: [
        "30 秒短片，主題待定",
        "想要 1 分鐘以上的長影片",
        "風格傾向：電影感／品牌／敘事",
        "投放：IG／YouTube／官網",
      ],
    };
  }

  return { kind: "ready", workflow: buildShortVideoWorkflow(enrichedBrief) };
}

/**
 * Multi-modal intent detection for the keyword fallback. Tries to figure out
 * whether the user wants an image, video, music, voice, sfx, or script-only
 * deliverable, and either returns the matching workflow, asks a clarifying
 * question, or leaves the request alone.
 *
 * The video branch is delegated to detectVideoIntent so the existing
 * length/subject heuristics keep working unchanged.
 */
export function detectCreationIntent(
  text: string,
  preferences?: RememberedCreationPreferences
): CreationIntentDetection {
  const trimmed = text.trim();
  if (!trimmed) return { kind: "none" };
  const q = trimmed.toLowerCase();

  const hits = detectModalityHits(q);
  const wantsBuild = matchAny(q, BUILD_KEYWORDS);
  const anyHit = hits.video || hits.image || hits.music || hits.voice || hits.sfx || hits.script;
  if (!anyHit || !wantsBuild) return { kind: "none" };

  const enrichedBrief = `${trimmed}${styleHint(preferences)}${platformHint(preferences)}`;

  // Explicit "寫/規劃/設計 腳本/劇本/分鏡" — the user wants the script as a
  // text deliverable, not the actual film. Beat the video branch even when
  // 短片/影片 is mentioned alongside.
  const wantsScriptOnly =
    hits.script &&
    /(寫|規劃|設計).{0,8}(腳本|劇本|分鏡|故事大綱|story outline|script|storyboard)/i.test(trimmed) &&
    !hits.image && !hits.music && !hits.voice && !hits.sfx;
  if (wantsScriptOnly) {
    return { kind: "ready", workflow: buildScriptOnlyWorkflow(enrichedBrief) };
  }

  // Video usually subsumes the other modalities (a short film naturally
  // includes images / voice / music). Defer to the existing video heuristics
  // unless the user asked for a non-video deliverable.
  if (hits.video) {
    return detectVideoIntent(trimmed, preferences);
  }

  // Pure script / planning request — script is structured text, not a media
  // generation, so we never ask follow-up questions here.
  if (hits.script && !hits.image && !hits.music && !hits.voice && !hits.sfx) {
    return { kind: "ready", workflow: buildScriptOnlyWorkflow(enrichedBrief) };
  }

  // Audio cluster — music vs voice vs sfx. If the user mixed multiple audio
  // categories, ask which one to start with.
  const audioCount = [hits.music, hits.voice, hits.sfx].filter(Boolean).length;
  if (audioCount >= 2) {
    return {
      kind: "needs-clarification",
      message: "你提到了多個音訊類型，先確認這次主要要哪一個，我再幫你帶到對應的分頁。",
      options: [
        ...(hits.music ? ["先做音樂"] : []),
        ...(hits.voice ? ["先做配音/旁白"] : []),
        ...(hits.sfx ? ["先做音效"] : []),
        "三個都要，先帶我去 /pro-studio",
      ].slice(0, 4),
    };
  }

  if (hits.music) return { kind: "ready", workflow: buildMusicWorkflow(enrichedBrief) };
  if (hits.voice) return { kind: "ready", workflow: buildVoiceWorkflow(enrichedBrief) };
  if (hits.sfx) return { kind: "ready", workflow: buildSfxWorkflow(enrichedBrief) };

  // Image — last because audio/video keywords are more specific.
  if (hits.image) return { kind: "ready", workflow: buildImageWorkflow(enrichedBrief) };

  // Script alongside another non-audio modality is rare; treat as script-only.
  if (hits.script) return { kind: "ready", workflow: buildScriptOnlyWorkflow(enrichedBrief) };

  return { kind: "none" };
}

export function maybeCreateWorkflowFromUserText(
  text: string,
  preferences?: RememberedCreationPreferences
): RunWorkflowAction | null {
  const detection = detectCreationIntent(text, preferences);
  return detection.kind === "ready" ? detection.workflow : null;
}
