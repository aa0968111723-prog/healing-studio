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
  | "videoEnhance"
  | "videoCameraControl"
  | "videoReference"
  | "videoDepthMap"
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
 * 跳頁到目標頁後，需要使用者親自完成的手動步驟。
 * 自動的（setTab / fillPrompt …）由 buildOrbGuideActions 負責；
 * 這裡只列「程式無法替使用者做」的事，例如上傳檔案、按下生成。
 */
export interface OrbGuideManualStep {
  id: string;
  label: string;
  hint?: string;
}

/**
 * 依 intent 產生到站要執行的 AgentAction[]。
 * 順序很重要：tab 先切、setModel 次之、setParam 再次、最後 fillPrompt。
 * 進階控制（control）三細分意圖會自動 setModel 鎖定到對應 ModelCard。
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
    case "videoEnhance": {
      // 畫質優化：切到 enhance 分頁；operation 子問答決定走 upscale / interpolate / enhance
      actions.push({ type: "setTab", tabId: "enhance" });
      const sourceUrl = input.answers.videoUrl;
      if (sourceUrl) {
        actions.push({ type: "setParam", key: "videoUrl", value: sourceUrl });
      }
      const op = input.answers.operation; // upscale / interpolate / enhance
      if (op) actions.push({ type: "setParam", key: "operation", value: op });
      break;
    }
    case "videoCameraControl": {
      // 進階控制 — 鏡頭運動控制（CamMaster）
      actions.push({ type: "setTab", tabId: "control" });
      actions.push({ type: "setModel", modelId: "cam-master" });
      if (hint) actions.push({ type: "fillPrompt", text: hint });
      const imageUrl = input.answers.imageUrl;
      if (imageUrl) {
        actions.push({ type: "setParam", key: "imageUrl", value: imageUrl });
      }
      const motion = input.answers.cameraMotion;
      if (motion) {
        actions.push({ type: "setParam", key: "cameraMotion", value: motion });
      }
      break;
    }
    case "videoReference": {
      // 進階控制 — 角色一致性 reference-to-video（Vidu Q1）
      actions.push({ type: "setTab", tabId: "control" });
      actions.push({ type: "setModel", modelId: "vidu-ref" });
      if (hint) actions.push({ type: "fillPrompt", text: hint });
      const imageUrl = input.answers.imageUrl;
      if (imageUrl) {
        actions.push({ type: "setParam", key: "imageUrl", value: imageUrl });
      }
      break;
    }
    case "videoDepthMap": {
      // 進階控制 — 深度感知（DepthCrafter）
      actions.push({ type: "setTab", tabId: "control" });
      actions.push({ type: "setModel", modelId: "depth-crafter" });
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

/**
 * 依 intent 產生到站後使用者要親自完成的步驟。
 * 設計原則：列出「程式無法替使用者代勞」的事情；像填提詞、切分頁這類已被
 * buildOrbGuideActions 自動執行的，就不要重覆放進來。
 */
export function buildOrbGuideManualSteps(
  input: OrbGuidePlanInput
): OrbGuideManualStep[] {
  const steps: OrbGuideManualStep[] = [];
  const hasPrompt = input.promptHint.trim().length > 0;

  switch (input.intent) {
    case "image":
    case "video":
    case "music": {
      if (hasPrompt) {
        steps.push({
          id: "review-prompt",
          label: "看一下幫你準備的提示詞，覺得不夠味就直接改",
        });
      }
      steps.push({
        id: "click-generate",
        label: "按下「生成」，等成品出來",
      });
      break;
    }
    case "video2video":
    case "videoDepthMap": {
      steps.push({
        id: "upload-video",
        label: "上傳要轉換 / 處理的影片檔",
        hint: "MP4、MOV 都可以",
      });
      if (hasPrompt) {
        steps.push({
          id: "review-prompt",
          label: "看一下提示詞，需要的話就改",
        });
      }
      steps.push({ id: "click-generate", label: "按下「生成」" });
      break;
    }
    case "videoEnhance": {
      steps.push({
        id: "upload-video",
        label: "上傳要優化的影片",
      });
      steps.push({
        id: "click-generate",
        label: "確認操作後按下「執行」",
      });
      break;
    }
    case "videoCameraControl":
    case "videoReference": {
      steps.push({
        id: "upload-image",
        label: "上傳一張參考用的圖片",
      });
      if (hasPrompt) {
        steps.push({
          id: "review-prompt",
          label: "看一下提示詞，需要的話就改",
        });
      }
      steps.push({ id: "click-generate", label: "按下「生成」" });
      break;
    }
    case "voice": {
      steps.push({
        id: "enter-text",
        label: "把要轉成語音的文字填進去（或改一下範例）",
      });
      if (input.answers.type === "clone") {
        steps.push({
          id: "upload-voice",
          label: "上傳一段參考音檔（10–30 秒最佳）",
        });
      }
      steps.push({ id: "click-generate", label: "按下「生成語音」" });
      break;
    }
    case "script": {
      steps.push({
        id: "send-message",
        label: "把詳細想法送出，導演 AI 會幫你寫腳本",
      });
      break;
    }
    case "lora": {
      steps.push({
        id: "upload-images",
        label: "上傳訓練用的圖片（建議 10 張以上）",
      });
      steps.push({
        id: "name-model",
        label: "幫這份模型取個名字",
      });
      steps.push({
        id: "start-training",
        label: "按下「開始訓練」",
      });
      break;
    }
    case "explore": {
      steps.push({
        id: "browse",
        label: "隨意逛逛，看到喜歡的就點進去",
      });
      break;
    }
  }

  return steps;
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
