/**
 * workflowFailureMessages.ts — 把 orchestrator / page handler 丟回的英文錯誤
 * 和原始 actionType / pagePath 翻成使用者讀得懂的繁中。
 *
 * 為什麼放這裡而不是 inline：
 *   - 原本 WorkflowExecutionFloatingPanel 直接把 reason 印在「需要補充的欄位」
 *     pink box 裡，例如「unsupported action」對使用者是無意義字串，連工程師
 *     都得回去翻 DirectorAI.tsx 才知道哪個 case 觸發。
 *   - 把 reason 集中成 helpers，順便建立一張人話對照表，將來新增動作或頁面
 *     時只在這裡補一條，UI 那邊不用改。
 *   - 純函式、無 React，vitest 直接測，避免 Panel 改回某一條 mapping 時悄悄
 *     退化。
 */
import { getPageByPath } from "@/config/appRegistry";

/**
 * 把 orchestrator 的 sub-phase 翻成「使用者讀得懂」的當下狀態。
 *
 * Phase 對照：
 *   - navigating       → 正在跳到「{detail or label}」…
 *   - settling         → 等頁面切換完成…
 *   - awaiting_handler → 等「{label}」載入中…
 *   - dispatching      → 正在執行：{actionLabel}
 *   - observing        → 光球在檢查結果…
 *   - retrying         → 第 N 次嘗試…
 *
 * 沒對到的 phase 就回原 phase 字串，避免 UI 出現空字串。
 */
export function formatWorkflowPhaseLabel(
  phase: string | undefined | null,
  context: {
    /** orchestrator 帶過來的 detail（path / actionType / 第 N 次嘗試）*/
    detail?: string | null;
    /** Step.actionType — dispatching phase 用來組「正在執行：填入提示詞」 */
    actionType?: string;
    /** Step.path — navigating phase 沒帶 detail 時的 fallback */
    path?: string;
  } = {}
): string | null {
  if (!phase) return null;
  const detail = context.detail?.trim() ?? "";
  switch (phase) {
    case "navigating": {
      const target = formatWorkflowTargetLabel(detail || context.path);
      return `正在跳到「${target.display}」…`;
    }
    case "settling":
      return "等頁面切換完成…";
    case "awaiting_handler": {
      const target = formatWorkflowTargetLabel(detail || context.path);
      return `等「${target.display}」載入中…`;
    }
    case "dispatching": {
      // detail 對 tool 來說會是 "tool:<toolName>"，UI 顯示原樣比較好定位。
      if (detail.startsWith("tool:")) {
        return `呼叫工具「${detail.slice(5) || "（未命名）"}」…`;
      }
      const actionLabel = formatWorkflowActionTypeLabel(
        detail || context.actionType
      );
      return `正在執行：${actionLabel}…`;
    }
    case "observing":
      return "光球在檢查結果…";
    case "retrying":
      return detail || "重新嘗試這一步…";
    default:
      return phase;
  }
}

/** 把 actionType 翻成使用者看得懂的「動作類別」標籤 */
const ACTION_TYPE_LABELS: Record<string, string> = {
  fillPrompt: "填入提示詞",
  appendPrompt: "追加提示詞",
  fillNegativePrompt: "填入負面提示詞",
  fillLyrics: "填入歌詞",
  setTab: "切換分頁",
  setMode: "切換模式",
  setModel: "切換模型",
  setModality: "切換模態",
  setParam: "設定參數",
  applyPreset: "套用預設",
  submit: "送出生成",
  generate: "送出生成",
  reset: "重設表單",
  navigate: "跳轉頁面",
  openDialog: "打開面板",
  toggleSetting: "切換設定",
  search: "搜尋",
  focusElement: "標出元件",
  runWorkflow: "執行工作流",
  exportChatPdf: "匯出 PDF",
  shareViaLink: "建立分享連結",
};

export function formatWorkflowActionTypeLabel(actionType: string | undefined): string {
  if (!actionType) return "（未指定動作）";
  return ACTION_TYPE_LABELS[actionType] ?? actionType;
}

/**
 * 把 step.path 翻成「使用者讀得懂的頁面名 + 路徑」，給 Panel 顯示用。
 * 沒對應到 appRegistry 就退回原 path，不會回 undefined。
 */
export function formatWorkflowTargetLabel(path: string | undefined): {
  /** 顯示用主文字 — 有 label 就用 label，沒有就用 path */
  display: string;
  /** 原始 path（給副文字 / mono 字體顯示） */
  rawPath?: string;
  /** 是否有對應到 registry — 有的話 UI 可以顯示 label + path 雙層次 */
  hasLabel: boolean;
} {
  if (!path) return { display: "（未指定頁面）", hasLabel: false };
  const page = getPageByPath(path);
  if (page) {
    return { display: page.label, rawPath: path, hasLabel: true };
  }
  return { display: path, hasLabel: false };
}

export interface FormattedWorkflowFailure {
  /** Pink box 的 header，取代既有的「需要補充的欄位」 */
  headline: string;
  /** 一句話人話解釋，給使用者看 */
  summary: string;
  /** 接下來該怎麼做的建議；可能是 null（沒明確建議時就不顯示） */
  hint: string | null;
  /** 原始 reason — 給「技術細節」區塊保留 */
  rawReason: string;
}

interface FailureContext {
  actionType?: string;
  path?: string;
  label?: string;
}

/**
 * 把 orchestrator 的 reason 字串翻成使用者讀得懂的解釋。
 * 規則：
 *   - 比對通用前綴（unknown tabId、unknown key…）取 X，組成「找不到 X」這類句子。
 *   - 帶上動作 / 頁面 context（actionType / path / label）讓訊息明確指出
 *     「在哪一步、想做什麼」失敗，而不是孤立的英文片語。
 *   - 沒有 mapping 時就把 reason 原文當 summary，但 headline 仍然改寫成
 *     「卡在這一步」這種使用者能理解的措辭。
 */
export function formatWorkflowFailure(
  reason: string | undefined | null,
  context: FailureContext = {}
): FormattedWorkflowFailure {
  const rawReason = (reason ?? "").trim();
  const actionLabel = formatWorkflowActionTypeLabel(context.actionType);
  const pageLabel =
    context.label ?? formatWorkflowTargetLabel(context.path).display;

  // ── 先處理可以靠 prefix 抓出 X 的「unknown ___」家族 ──
  const unknownTab = rawReason.match(/^unknown tabId:\s*(.+)$/i);
  if (unknownTab) {
    return {
      headline: "找不到分頁",
      summary: `「${pageLabel}」沒有「${unknownTab[1].trim()}」這個分頁，可能名稱已改或我抓錯版本。`,
      hint: "你可以手動切到對應分頁後，再讓光球繼續下一步。",
      rawReason,
    };
  }
  const unknownKey = rawReason.match(/^unknown key:\s*(.+)$/i);
  if (unknownKey) {
    return {
      headline: "這頁不認得這個欄位",
      summary: `「${pageLabel}」沒有「${unknownKey[1].trim()}」這個參數可以設定。`,
      hint: "幫我看一下是不是欄位名打錯了，或這頁的版本還沒支援這個設定。",
      rawReason,
    };
  }
  const unknownPersonality = rawReason.match(/^unknown personality:\s*(.+)$/i);
  if (unknownPersonality) {
    return {
      headline: "找不到這位導演風格",
      summary: `「${unknownPersonality[1].trim()}」不是目前內建的導演個性。`,
      hint: "可以選 calm / creative / technical 其中一個，再讓光球繼續。",
      rawReason,
    };
  }
  const unknownPreset = rawReason.match(/^unknown presetId:\s*(.+)$/i);
  if (unknownPreset) {
    return {
      headline: "找不到這組預設",
      summary: `「${pageLabel}」沒有「${unknownPreset[1].trim()}」這組預設可以套用。`,
      hint: null,
      rawReason,
    };
  }
  const unknownFormat = rawReason.match(/^unknown format:\s*(.+)$/i);
  if (unknownFormat) {
    return {
      headline: "找不到這個回應格式",
      summary: `「${unknownFormat[1].trim()}」不是支援的回應格式（可選 co-star / sslcm / selcm / free）。`,
      hint: null,
      rawReason,
    };
  }
  const unknownTemplate = rawReason.match(/^unknown template:\s*(.+)$/i);
  if (unknownTemplate) {
    return {
      headline: "找不到這個模板",
      summary: `模板「${unknownTemplate[1].trim()}」不存在或已被刪除。`,
      hint: "可以打開模板庫挑一個現有的，再回來繼續。",
      rawReason,
    };
  }

  // ── 工具呼叫類 ──
  const toolMissing = rawReason.match(/^callTool hook missing for tool\s+(.+)$/i);
  if (toolMissing) {
    return {
      headline: "工具還沒接上",
      summary: `光球的工具呼叫器目前沒接上「${toolMissing[1].trim()}」。`,
      hint: "改用 UI 操作（按生成）通常一樣可以完成這一步。",
      rawReason,
    };
  }
  const toolFailed = rawReason.match(/^tool\s+(\S+)\s+failed$/i);
  if (toolFailed) {
    return {
      headline: "工具呼叫失敗",
      summary: `工具「${toolFailed[1].trim()}」沒有成功回應。`,
      hint: "再試一次，或改用頁面上的按鈕手動執行這一步。",
      rawReason,
    };
  }

  // ── orchestrator 結構性錯誤 ──
  if (/has neither toolName nor action/i.test(rawReason)) {
    return {
      headline: "工作流定義缺欄位",
      summary: `這一步既沒有 actionType 也沒有 toolName，光球不知道該怎麼執行。`,
      hint: "這通常是工作流模板的 bug，請回報給開發團隊。",
      rawReason,
    };
  }
  if (rawReason === "no matching page handler") {
    return {
      headline: "目標頁還沒準備好",
      summary: `「${pageLabel}」還沒掛載，無法接手「${actionLabel}」。`,
      hint: "重新點一次「執行」，或先手動進到那一頁再讓光球繼續。",
      rawReason,
    };
  }
  if (rawReason === "workflow disabled") {
    return {
      headline: "工作流功能暫時關閉",
      summary: "目前跨頁工作流程功能被站台暫停。",
      hint: "我可以先把每一步的手動操作步驟列給你，你照著按也能完成。",
      rawReason,
    };
  }
  if (rawReason === "no route found") {
    return {
      headline: "找不到對應頁面",
      summary: "我看懂你想做的事了，但暫時找不到能執行這個動作的工作室。",
      hint: "再多告訴我一句你想去哪一個工作室（圖片／影片／音樂／導演 AI）。",
      rawReason,
    };
  }
  if (rawReason === "empty text") {
    return {
      headline: "提示詞是空的",
      summary: `「${actionLabel}」拿到的文字是空的，無法填入。`,
      hint: "再補一句完整描述送過來，光球就能繼續。",
      rawReason,
    };
  }
  const aborted = rawReason.match(/^aborted at step\s+"?([^"]+)"?$/i);
  if (aborted) {
    return {
      headline: "你選擇中止這一步",
      summary: `工作流在「${aborted[1].trim()}」這一步被你終止。`,
      hint: "想接著做就重新送一次需求，光球會從頭安排。",
      rawReason,
    };
  }

  // ── 最常見也最讓使用者困惑的「unsupported action」家族 ──
  // 形式 1: 「unsupported action」（DirectorAI / Studio / VideoStudio /
  //         ImageStudio / ProStudio / LoraTrainer 都會回這串）
  // 形式 2: 「unsupported action: <type>」 / 「<page>: unsupported action "<type>"」
  //         （AccountSettings, AdminPage, Playground, ProcessViewer, Tutorial,
  //          AiBrainPipeline, CreationHub, AdminApiUsage, MyBrain）
  const unsupportedTyped = rawReason.match(/unsupported action(?:\s*:\s*"?(\S+?)"?)?$/i);
  const unsupportedQuoted = rawReason.match(/unsupported action\s+"([^"]+)"/i);
  const blockedActionType =
    unsupportedQuoted?.[1] ??
    unsupportedTyped?.[1] ??
    context.actionType;
  if (
    /unsupported action/i.test(rawReason)
  ) {
    const blockedLabel = formatWorkflowActionTypeLabel(blockedActionType);
    return {
      headline: "這頁不支援這個動作",
      summary: `「${pageLabel}」不認得「${blockedLabel}」這個動作，可能我抓錯頁面或工作流模板還沒對齊這頁的版本。`,
      hint: "點下方「我自己來」我可以陪你手動操作；或重新送一次需求，我會重新規劃路徑。",
      rawReason,
    };
  }

  // ── perception loop / handler throw ──
  const perception = rawReason.match(/^perception:\s*(.+)$/i);
  if (perception) {
    return {
      headline: "光球觀察到結果不對",
      summary: `這一步執行完，畫面看起來不像光球期待的樣子（${perception[1].trim()}）。`,
      hint: "可能是頁面還在載入，重新試一次通常就能成功。",
      rawReason,
    };
  }
  if (/^handler threw unknown error$/i.test(rawReason)) {
    return {
      headline: "頁面執行時出錯",
      summary: `「${pageLabel}」處理「${actionLabel}」時拋出例外。`,
      hint: "重新整理頁面後再試一次；如果還是不行，請把這個錯誤截圖回報。",
      rawReason,
    };
  }

  // ── 預設：保留原文，但 headline 至少改成中文 ──
  if (!rawReason) {
    return {
      headline: "卡在這一步",
      summary: `「${pageLabel}」執行「${actionLabel}」沒成功，但沒有給出原因。`,
      hint: "重新試一次，或手動操作這一頁。",
      rawReason: "",
    };
  }
  return {
    headline: "卡在這一步",
    summary: `「${pageLabel}」執行「${actionLabel}」失敗：${rawReason}`,
    hint: "可以重新送一次需求，或手動操作這一頁。",
    rawReason,
  };
}
