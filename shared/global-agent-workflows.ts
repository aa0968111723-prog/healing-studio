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
        actionType: "setModality",
        payload: "voice",
        label: "專業工作室：切換到語音/配音",
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

export type VideoIntentDetection =
  | { kind: "none" }
  | { kind: "ready"; workflow: RunWorkflowAction }
  | { kind: "needs-clarification"; message: string; options: string[] };

const VIDEO_KEYWORDS = ["短片", "影片", "video", "reel", "mv", "廣告"];
const BUILD_KEYWORDS = ["幫我做", "生成", "製作", "create", "make", "build"];

const LENGTH_HINT_RE =
  /(\d+\s*(秒|分鐘?|小時|second|minute|hour|min|sec|mins|secs)\b)|\d+s\b|短片|長片|長影片|長視頻/i;
const LONG_HINT_RE = /長片|長影片|長視頻|長.{0,4}的?(影片|video)/i;
const SHORT_HINT_RE = /短片|reel|30\s*秒|15\s*秒|\b(short|teaser)\b/i;
const SUBJECT_HINT_RE = /[:：]|主題|題目|關於|介紹|品牌|產品|內容是|story|theme|brand|product/i;

export function detectVideoIntent(text: string): VideoIntentDetection {
  const trimmed = text.trim();
  const q = trimmed.toLowerCase();
  const wantsVideo = VIDEO_KEYWORDS.some(token => q.includes(token));
  const wantsBuild = BUILD_KEYWORDS.some(token => q.includes(token));
  if (!(wantsVideo && wantsBuild)) return { kind: "none" };

  const hasLength = LENGTH_HINT_RE.test(trimmed);
  const wantsLong = LONG_HINT_RE.test(trimmed) || /\d+\s*分(?!之|秒)/.test(trimmed);
  const isShortHint = SHORT_HINT_RE.test(trimmed);
  const hasSubject = trimmed.length >= 25 || SUBJECT_HINT_RE.test(trimmed);

  if (wantsLong && !isShortHint) {
    return {
      kind: "needs-clarification",
      message:
        "你想做的是長影片，但我目前的自動流程預設是 30 秒短片。先聊清楚你想要的長度與內容方向，我再幫你規劃合適的步驟。",
      options: [
        "改做 30 秒短片就好",
        "1–3 分鐘的中片（請先告訴我主題）",
        "5 分鐘以上的長片（請先告訴我章節結構）",
        "我自己來，先帶我去 /director",
      ],
    };
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

  return { kind: "ready", workflow: buildShortVideoWorkflow(trimmed) };
}

export function maybeCreateWorkflowFromUserText(text: string): RunWorkflowAction | null {
  const detection = detectVideoIntent(text);
  return detection.kind === "ready" ? detection.workflow : null;
}
