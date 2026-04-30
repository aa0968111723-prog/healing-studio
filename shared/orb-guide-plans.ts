/**
 * shared/orb-guide-plans.ts — Phase 3e 到站接棒
 *
 * OrbGuide 每個意圖走完問答後會產生一份 `AgentAction[]` 計畫，
 * 透過 CustomEvent 送給 ProactiveOrbWidget，listener 再把這串動作
 * 丟進 PageAgent bus：目標頁還沒掛載就會被 `enqueueAction` 暫存，
 * 等頁面 `register()` 時 `drainActionsForPage` 自動接棒。
 *
 * 設計原則：
 *   - 純函式，無 React / DOM，vitest 直接測。
 *   - 只產生非破壞性動作（fillPrompt / setTab），避免使用者還沒看到頁面
 *     就被自動 submit / reset。
 *   - 未知 tabId 會被目標頁 handle() 回 `{ok:false, reason:"unknown tabId"}`，
 *     不會爆；但我們這邊儘量只用頁面真的有的 id（ImageStudio: t2i,
 *     VideoStudio: t2v, ProStudio: music/tts/clone…）。
 */

import type { AgentAction } from "./agent-actions";

export type OrbGuideIntentId =
  | "image"
  | "video"
  | "video2video"
  | "music"
  | "voice"
  | "script"
  | "lora"
  | "explore";

export interface OrbGuidePlanInput {
  intent: OrbGuideIntentId;
  /** 已回答的 questionId -> value */
  answers: Record<string, string>;
  /** 規則端算好的 promptHint（英文，餵進生成模型） */
  promptHint: string;
}

/**
 * 依 intent 產生到站要執行的 AgentAction[]。
 * 順序很重要：tab 先切、再填 prompt，使用者看到的動畫才自然。
 */
export function buildOrbGuideActions(
  input: OrbGuidePlanInput
): AgentAction[] {
  const actions: AgentAction[] = [];
  const hint = input.promptHint.trim();

  switch (input.intent) {
    case "image": {
      actions.push({ type: "setTab", tabId: "t2i" });
      if (hint) actions.push({ type: "fillPrompt", text: hint });
      break;
    }
    case "video": {
      actions.push({ type: "setTab", tabId: "t2v" });
      if (hint) actions.push({ type: "fillPrompt", text: hint });
      break;
    }
    case "video2video": {
      // 影生影：切到 v2v 分頁、填提詞；videoUrl 由使用者自行上傳
      actions.push({ type: "setTab", tabId: "v2v" });
      if (hint) actions.push({ type: "fillPrompt", text: hint });
      const sourceUrl = input.answers.videoUrl;
      if (sourceUrl) {
        actions.push({ type: "setParam", key: "videoUrl", value: sourceUrl });
      }
      break;
    }
    case "music": {
      actions.push({ type: "setTab", tabId: "music" });
      if (hint) actions.push({ type: "fillPrompt", text: hint });
      break;
    }
    case "voice": {
      // voice.type 答案：tts / clone / multilingual / emotional
      // ProStudio 目前實際 tab 只有 tts / clone，其他走 tts
      const t = input.answers.type;
      const tabId = t === "clone" ? "clone" : "tts";
      actions.push({ type: "setTab", tabId });
      if (hint) actions.push({ type: "fillPrompt", text: hint });
      break;
    }
    case "script": {
      // Director AI：填 prompt 進對話分頁
      if (hint) actions.push({ type: "fillPrompt", text: hint });
      break;
    }
    case "lora": {
      // LoRA 需要使用者上傳檔案，不自動做事
      break;
    }
    case "explore":
      // explore 刻意不自動做事，讓使用者自由瀏覽
      break;
  }

  return actions;
}

/** 給 UI 顯示用的繁中摘要，逐行一條 action */
export function summarizeOrbGuideActions(actions: AgentAction[]): string[] {
  const lines: string[] = [];
  for (const action of actions) {
    switch (action.type) {
      case "setTab":
        lines.push(`切到「${action.tabId}」分頁`);
        break;
      case "fillPrompt": {
        const preview = action.text.length > 36
          ? action.text.slice(0, 36) + "…"
          : action.text;
        lines.push(`填入提示詞：「${preview}」`);
        break;
      }
      case "setModel":
        lines.push(`把模型切到「${action.modelId}」`);
        break;
      case "setMode":
        lines.push(`切到「${action.modeId}」模式`);
        break;
      case "applyPreset":
        lines.push(`套用預設「${action.presetId}」`);
        break;
      case "setParam":
        lines.push(`設定 ${action.key} = ${JSON.stringify(action.value)}`);
        break;
      case "navigate":
        lines.push(`前往「${action.path}」`);
        break;
      case "search":
        lines.push(`搜尋「${action.query}」`);
        break;
      case "openDialog":
        lines.push(`打開「${action.dialogId}」面板`);
        break;
      case "toggleSetting":
        lines.push(`切換「${action.key}」設定`);
        break;
      case "runWorkflow":
        lines.push(`執行「${action.name}」（${action.steps.length} 步驟）`);
        break;
      default:
        // 其它動作用通用敘述
        lines.push(`執行 ${action.type}`);
    }
  }
  return lines;
}
