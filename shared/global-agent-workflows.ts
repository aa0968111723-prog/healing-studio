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
import { APP_PAGE_REGISTRY } from "./appRegistry";
import { buildWizardClarification } from "./orb-clarification-options";

export interface ExpandedWorkflowStep {
  path?: string;
  label: string;
  /**
   * The concrete UI action when this step takes the dispatch path.
   * Undefined when the step is a server-side tool call (`toolName` set);
   * the orchestrator routes those through `ctx.callTool` instead.
   */
  action?: AgentAction;
  /** Stable id used by the DAG scheduler + perStepToolResults indexing. */
  id?: string;
  dependsOn?: string[];
  /** Set when the step is a server-side tool call. */
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResultBinding?: string;
  retryPolicy?: AgentWorkflowStep["retryPolicy"];
  /** Original step kept around so the orchestrator can replan / persist. */
  original?: AgentWorkflowStep;
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
    // Tool-call steps short-circuit the actionType conversion: the orchestrator
    // dispatches them via ctx.callTool with `${stepN.key}` placeholders resolved
    // against perStepToolResults. They can still declare a `path` so the
    // orchestrator pre-navigates (useful when the tool result later feeds a UI
    // step on the same page).
    if (step.toolName) {
      expanded.push({
        ...(step.path ? { path: step.path } : {}),
        label: step.label,
        toolName: step.toolName,
        ...(step.toolArgs ? { toolArgs: step.toolArgs } : {}),
        ...(step.toolResultBinding ? { toolResultBinding: step.toolResultBinding } : {}),
        ...(step.id ? { id: step.id } : {}),
        ...(step.dependsOn?.length ? { dependsOn: step.dependsOn } : {}),
        ...(step.retryPolicy ? { retryPolicy: step.retryPolicy } : {}),
        original: step,
      });
      continue;
    }

    const concrete = workflowStepToAction(step);
    if (!concrete) continue;

    expanded.push({
      ...(step.path ? { path: step.path } : {}),
      label: step.label,
      action: concrete,
      ...(step.id ? { id: step.id } : {}),
      ...(step.dependsOn?.length ? { dependsOn: step.dependsOn } : {}),
      ...(step.retryPolicy ? { retryPolicy: step.retryPolicy } : {}),
      original: step,
    });
  }

  return expanded;
}

export function buildShortVideoWorkflow(brief: string): RunWorkflowAction {
  const basePrompt = brief.trim() || "30 秒電影感短片，清楚主題、三幕節奏、可生成分鏡";
  // Richer per-step prompts — each downstream step inlines an explicit
  // creative direction so the destination page receives an actually-runnable
  // prompt even when the user / LLM didn't customize the brief. The previous
  // version left the downstream studio pages with terse one-liners that the
  // user had to rewrite by hand, defeating the point of multi-step auto-fill.
  return {
    type: "runWorkflow",
    name: "AI Director 短片生成流程",
    steps: [
      {
        path: "/director",
        actionType: "fillPrompt",
        payload:
          `請把以下需求展開成 30 秒短片企劃，並在輸出內標明【企劃】【三幕腳本（起／承／轉合）】` +
          `【3 個鏡頭分鏡（含 shot type、運鏡、情緒、預估秒數）】【每鏡頭的視覺提示詞】` +
          `【一段 30 秒旁白稿】【BGM 風格建議】六個區塊，方便後續工作室直接接手：\n\n需求：${basePrompt}`,
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
        payload:
          `為這支短片建立第一張電影感關鍵視覺（key visual）：構圖留白、光影立體、` +
          `主體清楚、留出標題與字幕區。鏡頭可採中景或特寫，情緒呼應主題：${basePrompt}`,
        label: "圖像工作室：填入第一張關鍵視覺提示詞",
      },
      // Tool-first execution (with UI actions kept for visual traceability):
      // this workflow depends on resolveStepRefsInArgs resolving
      // `${step_image_keyvisual.image_url}` at runtime. Do not rename this id
      // unless you also update all dependent references.
      {
        id: "step_image_keyvisual",
        path: "/studio",
        actionType: "submit",
        payload: "",
        label: "圖像工作室：工具生成關鍵視覺",
        toolName: "studio.generateImage",
        toolArgs: {
          prompt:
            `為這支短片建立第一張電影感關鍵視覺（key visual）：構圖留白、光影立體、` +
            `主體清楚、留出標題與字幕區。鏡頭可採中景或特寫，情緒呼應主題：${basePrompt}`,
        },
      },
      {
        path: "/studio",
        actionType: "submit",
        payload: "",
        label: "圖像工作室：生成關鍵視覺（UI）",
      },
      {
        path: "/video-studio",
        actionType: "fillPrompt",
        payload:
          `把上一步的關鍵視覺延伸成 30 秒短片運鏡：包含 3 個鏡頭切換、` +
          `平滑運鏡（推軌／環繞／升降）、情緒節奏起承轉、電影感光影與淺景深、` +
          `符合社群平台的剪輯密度。請直接產出可送入影片模型的中文提示詞：${basePrompt}`,
        label: "影片工作室：填入影片生成提示詞",
      },
      {
        path: "/video-studio",
        actionType: "submit",
        payload: "",
        label: "影片工作室：工具生成影片",
        toolName: "studio.generateVideo",
        dependsOn: ["step_image_keyvisual"],
        toolArgs: {
          prompt:
            `把上一步的關鍵視覺延伸成 30 秒短片運鏡：包含 3 個鏡頭切換、` +
            `平滑運鏡（推軌／環繞／升降）、情緒節奏起承轉、電影感光影與淺景深、` +
            `符合社群平台的剪輯密度。請直接產出可送入影片模型的中文提示詞：${basePrompt}`,
          image_url: "${step_image_keyvisual.image_url}",
        },
      },
      {
        path: "/video-studio",
        actionType: "submit",
        payload: "",
        label: "影片工作室：生成影片（UI）",
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
          `請為這支 30 秒短片寫一段旁白稿（約 60–80 字，中文）：` +
          `語氣自然、情緒貼合主題、節奏切合 3 鏡頭分鏡、收尾留一句記憶點。` +
          `寫完後直接以朗讀格式輸出，不要附說明文字：${basePrompt}`,
        label: "配音：填入旁白需求",
      },
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
          `請生成 30 秒的影片配樂（BGM）：曲風與整支短片的情緒呼應、` +
          `不要搶過旁白、開頭 3 秒輕聲鋪墊、中段堆疊主題、最後 5 秒淡出。` +
          `請於提示詞中明確標出「曲風」「情緒」「BPM 區間」「主要樂器」` +
          `「結構」與「淡出」設定：${basePrompt}`,
        label: "配樂：填入 BGM 需求",
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
        payload:
          `請依以下需求生成一張高品質圖片：構圖留白、光線層次清楚、` +
          `主體聚焦、避免畸變肢體與雜訊。輸出時保持中文提示詞與英文關鍵字混合，` +
          `方便模型理解：${basePrompt}`,
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
        payload:
          `請生成一段配樂：請於提示詞中明確標出「曲風」「情緒」「BPM 區間」「主要樂器」` +
          `「結構（前奏／主題／結尾）」，並標明可循環或淡出收尾。需求：${basePrompt}`,
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
        payload:
          `請以下列旁白稿生成語音：語速自然、咬字清楚、情緒呼應內容、` +
          `句中換氣自然、不要突兀的機械感。如稿子較長請保留段落間的呼吸停頓：\n\n${basePrompt}`,
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
        payload:
          `請生成一段音效：明確標出「場景／物件」「動作」「持續秒數」「音色與層次」` +
          `「是否可循環」。輸出純音效不要加旁白，並避免明顯的剪接接縫：${basePrompt}`,
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
        payload:
          `請幫我把這個需求拆成完整短片企劃，輸出時請分成` +
          `【一句話 logline】【三幕腳本（起／承／轉合）】【3 個鏡頭分鏡（shot type／運鏡／情緒／秒數）】` +
          `【旁白稿（60–80 字）】四個區塊，方便後續直接送進影像／配音流程：\n\n需求：${basePrompt}`,
        label: "導演 AI：產生腳本與分鏡",
      },
    ],
  };
}

/**
 * 品牌貼文工作流 — 一句話「我要做品牌貼文」就生出完整社群素材包：
 *   1. 文案（主貼文 + hashtag + CTA）
 *   2. 主視覺方圖（IG 1:1）
 *   3. 三張延伸／carousel（限動 9:16 + 內頁）
 *   4. 一段 15 秒 reel 短影音
 *
 * 設計上把 director 當成文案＋視覺方向產生器，再分流到 image / video，
 * 這樣使用者不需要在三個工作室之間反覆貼提示詞。
 */
export function buildBrandContentWorkflow(brief: string): RunWorkflowAction {
  const basePrompt =
    brief.trim() || "品牌週主題貼文，主視覺溫暖、文案有故事感、CTA 引導追蹤";
  return {
    type: "runWorkflow",
    name: "品牌貼文素材包流程",
    steps: [
      {
        path: "/director",
        actionType: "fillPrompt",
        payload:
          `請把以下品牌需求展開成「社群貼文素材包」企劃，輸出時請分成` +
          `【一句話定位】【主貼文文案（80–120 字、含 1 個記憶點）】` +
          `【3–5 個 hashtag（含品牌、主題、情緒）】【CTA 一句】` +
          `【主視覺風格與構圖建議（IG 方圖、留白給字、品牌色）】` +
          `【3 張延伸視覺主題與運用（限動／內頁／引言）】` +
          `【15 秒 reel 分鏡（3 鏡頭、節奏、字幕擺位）】` +
          `七個區塊，方便後續直接送進圖片／影片工作室：\n\n需求：${basePrompt}`,
        label: "導演 AI：產出貼文文案與視覺方向",
      },
      {
        path: "/image-studio",
        actionType: "fillPrompt",
        payload:
          `為品牌貼文生成主視覺方圖（1:1）：留白給標題與字幕、` +
          `光線溫暖、構圖中心對稱、避免邊角複雜元素。畫面情緒呼應：${basePrompt}`,
        label: "圖片創作室：填入主視覺提示詞",
      },
      {
        id: "step_image_main",
        path: "/image-studio",
        actionType: "submit",
        payload: "",
        label: "圖片創作室：工具生成主視覺",
        toolName: "studio.generateImage",
        toolArgs: {
          prompt:
            `為品牌貼文生成主視覺方圖（1:1）：留白給標題與字幕、` +
            `光線溫暖、構圖中心對稱、避免邊角複雜元素。畫面情緒呼應：${basePrompt}`,
        },
      },
      {
        path: "/image-studio",
        actionType: "fillPrompt",
        payload:
          `延伸 3 張內頁／限動視覺（9:16 與 4:5），與主視覺同色系、` +
          `各自聚焦一個情緒切片（場景／物件／人物特寫），` +
          `留出文案疊字區。需求：${basePrompt}`,
        label: "圖片創作室：填入延伸視覺",
      },
      {
        path: "/video-studio",
        actionType: "fillPrompt",
        payload:
          `把這套貼文素材延伸成 15 秒 reel 短影音：3 鏡頭切換、` +
          `平滑運鏡、字幕擺中下、節奏跟著貼文文案的記憶點起伏。` +
          `需求：${basePrompt}`,
        label: "影片工作室：填入 reel 提示詞",
      },
      {
        path: "/video-studio",
        actionType: "submit",
        payload: "",
        label: "影片工作室：工具生成 reel",
        toolName: "studio.generateVideo",
        dependsOn: ["step_image_main"],
        toolArgs: {
          prompt:
            `把這套貼文素材延伸成 15 秒 reel 短影音：3 鏡頭切換、` +
            `平滑運鏡、字幕擺中下、節奏跟著貼文文案的記憶點起伏。` +
            `需求：${basePrompt}`,
          image_url: "${step_image_main.image_url}",
        },
      },
    ],
  };
}

/**
 * Podcast 集數工作流 — 一句話「幫我做一集 podcast」就把腳本、片頭片尾配樂、
 * 主旁白、章節音效全部串起來。輸出可直接放進剪輯軟體。
 *
 *   1. 導演：產出 logline + 三段大綱（intro / main / outro）+ 完整旁白稿
 *   2. 配樂：片頭 15 秒 + 過場 5 秒 + 結尾 15 秒
 *   3. 旁白：主稿 TTS（中段最長）
 */
export function buildPodcastEpisodeWorkflow(brief: string): RunWorkflowAction {
  const basePrompt =
    brief.trim() || "10 分鐘的療癒主題 podcast，溫暖、敘事性、有引言與結尾";
  return {
    type: "runWorkflow",
    name: "Podcast 集數製作流程",
    steps: [
      {
        path: "/director",
        actionType: "fillPrompt",
        payload:
          `請把這個 podcast 需求展開成完整集數企劃，輸出時請分成` +
          `【一句話 logline】【目標聽眾】【三段大綱（intro 1 分、main 7–8 分、outro 1 分）】` +
          `【完整旁白稿（含段落標記、換氣點、情緒提示，全長對應集數時長）】` +
          `【片頭 15 秒 BGM 風格】【過場 5 秒音效風格】【結尾 15 秒 BGM 風格】` +
          `七個區塊。旁白稿請直接以朗讀格式輸出，不要附說明：\n\n需求：${basePrompt}`,
        label: "導演 AI：產出 podcast 企劃與旁白稿",
      },
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
          `請生成 podcast 片頭 BGM（15 秒）：曲風溫暖、開頭 3 秒鋪墊、` +
          `中段堆疊主題、最後 3 秒漸弱接旁白。請於提示詞中標明` +
          `「曲風」「情緒」「BPM」「主要樂器」「結構」。需求：${basePrompt}`,
        label: "配樂：填入片頭 BGM 需求",
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
          `請以 podcast 旁白稿生成語音：語速自然、` +
          `咬字清楚、段落間留呼吸停頓、情緒呼應內容、` +
          `避免機械感。如稿子較長請保留段落停頓：\n\n${basePrompt}`,
        label: "配音：填入旁白稿",
      },
      {
        path: "/pro-studio",
        actionType: "setTab",
        payload: "music",
        label: "音樂配音創作室：切回音樂分頁",
      },
      {
        path: "/pro-studio",
        actionType: "fillPrompt",
        payload:
          `請生成 podcast 結尾 BGM（15 秒）：呼應片頭主題、` +
          `情緒平穩、最後 5 秒淡出。需求：${basePrompt}`,
        label: "配樂：填入結尾 BGM 需求",
      },
    ],
  };
}

/**
 * Single-step navigate workflow. Used for "take me to <feature>" intents
 * (training / tutorials / settings / asset library / etc.) so the keyword
 * fallback isn't limited to creative pipelines.
 *
 * The workflow executor pre-navigates via ctx.navigate() and then auto-resolves
 * the navigate uiAction without dispatching to a page handler — so this works
 * uniformly across every page in APP_PAGE_REGISTRY.
 */
export function buildNavigateWorkflow(label: string, path: string): RunWorkflowAction {
  return {
    type: "runWorkflow",
    name: label,
    steps: [
      {
        path,
        actionType: "navigate",
        payload: path,
        label,
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



interface DirectorChapter {
  chapterTitle?: string;
  visualPrompt?: string;
  videoPrompt?: string;
  musicMood?: string;
  narrationText?: string;
}

function normalizeChapterField(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

function composeVisualPromptFromChapter(chapter: DirectorChapter, chapterIndex: number, basePrompt: string): string {
  const title = normalizeChapterField(chapter.chapterTitle, `第 ${chapterIndex} 章`);
  const mood = normalizeChapterField(chapter.musicMood, "電影感情緒推進");
  return `章節標題：${title}；請延續導演章節設定，提煉出電影感關鍵視覺，情緒氛圍：${mood}。整體主題：${basePrompt}`;
}

function composeVideoPromptFromChapter(chapter: DirectorChapter, chapterIndex: number, basePrompt: string): string {
  const title = normalizeChapterField(chapter.chapterTitle, `第 ${chapterIndex} 章`);
  const mood = normalizeChapterField(chapter.musicMood, "節奏漸進、敘事清楚");
  const narration = normalizeChapterField(chapter.narrationText, "以章節主題推進故事，保留清楚轉場");
  return `章節標題：${title}；請根據章節內容設計運鏡與剪輯節奏，情緒：${mood}；旁白重點：${narration}。整體主題：${basePrompt}`;
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
    {
      path: "/director",
      actionType: "setParam",
      payload: `chapterPlanJson={"chapters":[{"chapterTitle":"第 1 章","visualPrompt":"","videoPrompt":"","musicMood":"","narrationText":""}]}`,
      label: "導演 AI：接收章節 JSON（chapterTitle / visualPrompt / videoPrompt / musicMood / narrationText）",
    },
  ];

  for (let i = 1; i <= chapters; i += 1) {
    steps.push(
      {
        path: "/image-studio",
        actionType: "fillPrompt",
        payload:
          `{{chapter:${i}:visualPrompt|` +
          composeVisualPromptFromChapter({ chapterTitle: `第 ${i} 章` }, i, basePrompt) +
          `}}`,
        label: `第 ${i} 章：填入關鍵視覺提示詞（來自導演章節）`,
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
          `{{chapter:${i}:videoPrompt|` +
          composeVideoPromptFromChapter({ chapterTitle: `第 ${i} 章` }, i, basePrompt) +
          `}}`,
        label: `第 ${i} 章：填入影片提示詞（來自導演章節）`,
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

/**
 * Non-creative navigation intents — "where do I go to do X" requests that
 * just need a navigate action, not a generation pipeline. Each entry is
 * checked via simple substring match; first match wins so order matters
 * (specific keywords before generic ones).
 */
const NAV_INTENTS: Array<{ keywords: readonly string[]; label: string; path: string }> = [
  { keywords: ["lora", "訓練模型", "訓練自己的模型", "model training"], label: "前往模型訓練中心", path: "/models" },
  { keywords: ["新手教學", "教學中心", "怎麼開始", "tutorial"], label: "前往教學總覽", path: "/tutorial-overview" },
  { keywords: ["學習文件", "學習中心", "教學文件", "learn"], label: "前往學習文件中心", path: "/learn" },
  { keywords: ["代理設定", "光球設定", "光球助手設定", "agent settings"], label: "前往代理設定", path: "/settings/agent" },
  { keywords: ["個人設定", "帳戶設定", "我的設定", "user settings"], label: "前往個人設定", path: "/settings" },
  { keywords: ["大腦設定", "推理大腦", "ai 大腦", "brain settings"], label: "前往 AI 大腦組態", path: "/admin?section=brain" },
  { keywords: ["積分", "點數", "credits"], label: "前往積分說明", path: "/dashboard?section=credits" },
  { keywords: ["儀表板", "dashboard", "用量分析", "成本"], label: "前往儀表板", path: "/dashboard" },
  { keywords: ["背景任務", "task queue", "任務佇列"], label: "前往背景任務中心", path: "/assets?section=tasks" },
  { keywords: ["提示詞庫", "prompt library"], label: "前往提示詞庫", path: "/assets?section=prompts" },
  { keywords: ["一致性保險庫", "保險庫", "vault"], label: "前往一致性保險庫", path: "/assets?section=vault" },
  { keywords: ["共享空間", "團隊共享", "shared space"], label: "前往共享空間", path: "/assets?section=shared" },
  { keywords: ["生成歷史", "歷史紀錄", "history"], label: "前往生成歷史", path: "/assets?section=history" },
  { keywords: ["素材庫", "資產庫", "asset library"], label: "前往數位資產庫", path: "/assets" },
  { keywords: ["專注流", "心流", "focus flow"], label: "前往專注流", path: "/focus-flow" },
  { keywords: ["專案筆記", "我的筆記", "notes"], label: "前往專案筆記", path: "/notes" },
];

export function detectNavIntent(text: string): { label: string; path: string } | null {
  const q = text.toLowerCase();
  for (const intent of NAV_INTENTS) {
    if (intent.keywords.some(token => q.includes(token))) {
      return { label: intent.label, path: intent.path };
    }
  }
  return null;
}

/**
 * Static reply for the orb's 「功能詢問」 chip. Drawn straight from
 * APP_PAGE_REGISTRY so we never hallucinate a feature: the user always sees
 * exactly what is wired up in the SPA. Sorted by `agentEntryPriority` so
 * the most useful pages come first; capped to keep the message scrollable.
 */
export function buildFeatureSummaryReply(): string {
  const entries = APP_PAGE_REGISTRY
    .filter(page => page.showInAgentHome && page.path && page.path !== "/agent")
    .sort((a, b) => a.agentEntryPriority - b.agentEntryPriority)
    .slice(0, 14);

  const lines = entries.map(page => {
    const hint = page.orbHints[0] ?? page.quickActions[0]?.label ?? "";
    const hintSuffix = hint ? `（例如：${hint}）` : "";
    return `• ${page.label} — ${page.description}${hintSuffix}\n  路徑：${page.path}`;
  });

  return [
    "🧭 這個站目前能幫你做的事（取自實際註冊的功能列表）：",
    "",
    ...lines,
    "",
    "想直接過去任何一個功能，跟我說「帶我去 X」就行；想要一鍵流程，告訴我你要做的成品（圖片／影片／音樂／配音／腳本），我就會把跨頁工作流程拼好。",
  ].join("\n");
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
const BRAND_POST_KEYWORDS = [
  "品牌貼文",
  "社群貼文",
  "ig 貼文",
  "instagram 貼文",
  "fb 貼文",
  "facebook 貼文",
  "貼文素材",
  "貼文包",
  "social post",
  "brand post",
  "social content",
  "carousel post",
];
const PODCAST_KEYWORDS = [
  "podcast",
  "播客",
  "節目集",
  "podcast 集",
  "podcast 一集",
  "電台節目",
  "podcast episode",
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


const VIDEO_USE_CASE_HINT_RE = /(品牌廣告|故事敘事|教學解說|情緒短片|廣告|宣傳|教學|敘事|情緒|brand ad|story|tutorial|explainer|mood)/i;
const STYLE_HINT_RE = /(電影感|寫實|動畫|紀錄|插畫|極簡|cinematic|realistic|animated|documentary)/i;

function hasUseCaseHint(text: string): boolean {
  return VIDEO_USE_CASE_HINT_RE.test(text);
}

function hasStyleHint(text: string): boolean {
  return STYLE_HINT_RE.test(text);
}

export interface VideoSlotSummary {
  hasLength: boolean;
  hasSubject: boolean;
  hasStyle: boolean;
  hasUseCase: boolean;
}

export function summarizeVideoSlots(text: string): VideoSlotSummary {
  const trimmed = text.trim();
  return {
    hasLength: LENGTH_HINT_RE.test(trimmed),
    hasSubject: trimmed.length >= 25 || SUBJECT_HINT_RE.test(trimmed),
    hasStyle: hasStyleHint(trimmed),
    hasUseCase: hasUseCaseHint(trimmed),
  };
}
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

  const slotSummary = summarizeVideoSlots(trimmed);
  const hasLength = slotSummary.hasLength;
  const wantsLong = LONG_HINT_RE.test(trimmed) || /\d+\s*分(?!之|秒)/.test(trimmed);
  const isShortHint = SHORT_HINT_RE.test(trimmed);
  const hasSubject = slotSummary.hasSubject;

  // Style / platform we know about become hints embedded in the prompt so
  // generated work matches the user's usual taste without re-asking.
  const enrichedBrief = `${trimmed}${styleHint(preferences)}${platformHint(preferences)}`;

  if (wantsLong && !isShortHint) {
    if (hasSubject && slotSummary.hasStyle && slotSummary.hasUseCase) {
      return { kind: "ready", workflow: buildLongVideoWorkflow(enrichedBrief) };
    }
    return {
      kind: "needs-clarification",
      message:
        "長影片我可以幫你拼成多章節流程；目前還缺主題／風格／用途其中一些欄位，先補齊我再幫你展開章節步驟。",
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

  // Multi-round wizard — instead of asking "影片我可以幫你拼，先給我幾個關鍵點"
  // ONCE and then plowing ahead with whatever scraps came back, walk the
  // dimensions one at a time. `buildWizardClarification` finds the next
  // missing one (length → subject → style → platform) and returns null when
  // we have enough to commit. This keeps the orb from generating an 8-step
  // workflow on the first turn with placeholder text in every prompt slot.
  const wizard = buildWizardClarification(trimmed, "video");
  if (wizard) {
    return {
      kind: "needs-clarification",
      message: `影片我可以幫你跨頁跑完整套流程（導演 AI → 圖像 → 影片 → 配音）。${wizard.question}`,
      options: wizard.options,
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

  // Composite intents take priority over single-modality hits — a "品牌貼文"
  // request usually mentions both 圖 and 影片 / 文案, but the user actually
  // wants the bundled output, not three separate runs.
  const wantsBrandPost = matchAny(q, BRAND_POST_KEYWORDS);
  const wantsPodcast = matchAny(q, PODCAST_KEYWORDS);
  const enrichedBriefEarly = `${trimmed}${styleHint(preferences)}${platformHint(preferences)}`;
  if (wantsBrandPost && wantsBuild) {
    return { kind: "ready", workflow: buildBrandContentWorkflow(enrichedBriefEarly) };
  }
  if (wantsPodcast && wantsBuild) {
    return { kind: "ready", workflow: buildPodcastEpisodeWorkflow(enrichedBriefEarly) };
  }

  const anyHit = hits.video || hits.image || hits.music || hits.voice || hits.sfx || hits.script;
  if (!anyHit || !wantsBuild) return { kind: "none" };

  const enrichedBrief = enrichedBriefEarly;

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

/**
 * Top-level intent detection used by the chat fallback. Tries a non-creative
 * navigation intent first ("帶我去 X / 怎麼訓練 LoRA / 怎麼開始 / 設定在哪" …)
 * and falls back to detectCreationIntent for image / video / audio / script
 * pipelines. Returns:
 *   - "ready"               — workflow ready to dispatch
 *   - "needs-clarification" — ask the user before doing anything
 *   - "none"                — let the LLM handle it
 */
export function detectChatIntent(
  text: string,
  preferences?: RememberedCreationPreferences
): CreationIntentDetection {
  const trimmed = text.trim();
  if (!trimmed) return { kind: "none" };

  // Creative intents take precedence — when the user clearly wants to create
  // something, the navigation fallback shouldn't quietly steal the request.
  const creative = detectCreationIntent(trimmed, preferences);
  if (creative.kind !== "none") return creative;

  const nav = detectNavIntent(trimmed);
  if (nav) {
    return { kind: "ready", workflow: buildNavigateWorkflow(nav.label, nav.path) };
  }

  return { kind: "none" };
}

export function maybeCreateWorkflowFromUserText(
  text: string,
  preferences?: RememberedCreationPreferences
): RunWorkflowAction | null {
  const detection = detectCreationIntent(text, preferences);
  return detection.kind === "ready" ? detection.workflow : null;
}
