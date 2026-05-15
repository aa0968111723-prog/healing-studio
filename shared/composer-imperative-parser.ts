/**
 * shared/composer-imperative-parser.ts
 *
 * 編編 (composer) 在對話框被 @ 時的「自然語言 → AgentAction[]」解析器。
 *
 * 設計目標：
 *   - 把使用者最常見的執行類指令 (送出 / 換模型 / 換比例 / 換秒數 /
 *     填提示詞 / 切到某個 tab / 套用某個預設) 直接翻成 AgentAction[]，
 *     不必燒一輪 LLM。
 *   - 沒命中任何規則 → 回傳 null，讓 caller fall through 到 LLM 流程。
 *   - 命中部分（例如有 setModel 但沒有 prompt）→ 回傳已能 dispatch 的
 *     部分 + missing 欄位，caller 可以「先做能做的，再反問缺的」或
 *     直接合併 fall through。
 *
 * 純函式：不 fetch、不 import 任何 React / DOM，client/server 兩邊都能用。
 *
 * 對齊 capability 才會 emit：給定 snapshot.capabilities，沒有對應 action
 * type 的指令一律不會被 emit (避免 dispatch 到不支援當頁的動作)。
 */

import type {
  AgentAction,
  AgentCapability,
  PageAgentSnapshot,
  SetModelAction,
  SetParamAction,
  FillPromptAction,
  SubmitAction,
  SetTabAction,
  SetModeAction,
  ApplyPresetAction,
} from "./agent-actions";

export interface ComposerParseResult {
  /** 已能直接 dispatch 的 actions（依 SOP 順序：setMode/Tab → setModel → setParam → fillPrompt → submit） */
  actions: AgentAction[];
  /**
   * 缺什麼 — 給 caller 渲染反問。例如沒給 prompt 但要 submit，會列 ["prompt"]。
   */
  missing: Array<"prompt" | "model" | "submit-confirm">;
  /** 觸發了哪幾條規則 — 給 telemetry / debug 用 */
  matchedRules: string[];
  /** 有沒有任何匹配 — false 時 caller 應 fall through 到 LLM */
  matched: boolean;
}

const EMPTY: ComposerParseResult = {
  actions: [],
  missing: [],
  matchedRules: [],
  matched: false,
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function capabilityFor(
  snapshot: PageAgentSnapshot | null | undefined,
  type: AgentCapability["action"],
): AgentCapability | null {
  if (!snapshot) return null;
  return snapshot.capabilities.find(c => c.action === type) ?? null;
}

function lower(s: string): string {
  return s.trim().toLowerCase();
}

/** 找一段文字裡的 fal model id（出現完整 fal-ai/... 路徑就採用） */
function extractFalModelId(text: string): string | null {
  const m = text.match(/fal-ai\/[A-Za-z0-9._/-]+/);
  return m ? m[0] : null;
}

/**
 * 從友善別名（"flux pro" / "schnell" / "kling" / "wan" / "seedream" /
 * "imagen" / "pixverse" / "runway" / "ltx" / "minimax"）猜 fal model id。
 * 命中後會交叉比對 snapshot.availableModels — 沒在當頁可用清單裡就回 null。
 *
 * 別名 → 模型對照採用 orb-agent-roles.ts 與 spiritPromptEnhancer.ts 中
 * 多次出現的「使用者最常用的 ID」清單，作為共識真相。
 */
function guessModelIdFromAlias(
  text: string,
  available: string[] = [],
): string | null {
  const t = lower(text);
  const ALIASES: Array<{ keyword: RegExp; modelId: string }> = [
    // 圖
    { keyword: /flux\s*pro|寫實|商業/, modelId: "fal-ai/flux-pro/v1.1" },
    { keyword: /schnell|快草稿|快速草稿|快稿/, modelId: "fal-ai/flux/schnell" },
    { keyword: /seedream|插畫|海報/, modelId: "fal-ai/bytedance/seedream/v4/text-to-image" },
    { keyword: /imagen|品牌乾淨/, modelId: "fal-ai/imagen4/preview" },
    // 影
    { keyword: /kling\s*pro|電影感|運鏡/, modelId: "fal-ai/kling-video/v2.1/pro/image-to-video" },
    { keyword: /kling\s*standard|首尾幀/, modelId: "fal-ai/kling-video/v2.1/standard/image-to-video" },
    { keyword: /pixverse|特效|動漫/, modelId: "fal-ai/pixverse/v4.5/image-to-video" },
    { keyword: /runway|teaser|商業 ?5s|商業 ?10s/, modelId: "fal-ai/runway-gen4-turbo/image-to-video" },
    { keyword: /\bwan\b|高 ?cp|草稿影/, modelId: "fal-ai/wan-i2v" },
    { keyword: /minimax|hailuo/, modelId: "fal-ai/minimax/hailuo-02/pro/image-to-video" },
    { keyword: /\bltx\b/, modelId: "fal-ai/ltx-video/image-to-video" },
  ];
  for (const { keyword, modelId } of ALIASES) {
    if (keyword.test(t)) {
      // 如果 caller 給了 availableModels（snapshot 有），只回傳當頁真的支援的 id
      if (available.length === 0 || available.includes(modelId)) return modelId;
    }
  }
  return null;
}

const ASPECT_PATTERNS: Array<{ re: RegExp; value: string }> = [
  { re: /(?:比例|aspect|ratio)[^0-9]*9\s*[:：x×]\s*16|9\s*[:：x×]\s*16(?!.*0)|\b9x16\b|直式|直立|portrait|reels?|tiktok|抖音|stor(?:y|ies)/i, value: "9:16" },
  { re: /(?:比例|aspect|ratio)[^0-9]*16\s*[:：x×]\s*9|16\s*[:：x×]\s*9|\b16x9\b|橫式|landscape|youtube/i, value: "16:9" },
  { re: /(?:比例|aspect|ratio)[^0-9]*1\s*[:：x×]\s*1|1\s*[:：x×]\s*1|\b1x1\b|正方|方形|square|ig\s*post|貼文/i, value: "1:1" },
  { re: /(?:比例|aspect|ratio)[^0-9]*3\s*[:：x×]\s*4|3\s*[:：x×]\s*4|\b3x4\b/i, value: "3:4" },
  { re: /(?:比例|aspect|ratio)[^0-9]*4\s*[:：x×]\s*3|4\s*[:：x×]\s*3|\b4x3\b/i, value: "4:3" },
];

function extractAspect(text: string): string | null {
  for (const { re, value } of ASPECT_PATTERNS) {
    if (re.test(text)) return value;
  }
  return null;
}

/** "5 秒" / "10s" / "30 second" → 數字秒數 */
function extractDurationSec(text: string): number | null {
  const m =
    text.match(/(\d+(?:\.\d+)?)\s*(?:秒|s\b|sec|second)/i) ??
    text.match(/(\d+(?:\.\d+)?)\s*分(?:鐘)?/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0 || n > 600) return null;
  return /分/.test(m[0]) ? Math.round(n * 60) : n;
}

/** "seed 12345" / "種子 999" */
function extractSeed(text: string): number | null {
  const m = text.match(/\bseed\b\s*[:：=]?\s*(\d{1,12})|種子\s*[:：=]?\s*(\d{1,12})/i);
  if (!m) return null;
  const n = Number(m[1] ?? m[2]);
  return Number.isFinite(n) ? n : null;
}

/** 是否包含「送出 / 生成 / 開始 / 跑」這類觸發詞 */
function hasSubmitIntent(text: string): boolean {
  return /送出|生成|出圖|出影|開始(?:跑)?|跑(?:看看|起來|起跑)?|run\b|start\b|generate|產生|做出來/i.test(text);
}

/** 是否「明確只是要送出，沒要改參數」 */
function isPureSubmit(text: string): boolean {
  const t = text.trim();
  if (t.length > 12) return false;
  return /^(送出|生成|跑|跑起來|開始|go|start|run|做|生)\s*[!！.。]?$/i.test(t);
}

/** 抓「填提示詞 …」/「prompt 設成 …」/「提示詞改成 …」後面那段 */
function extractFillPrompt(text: string): string | null {
  const m =
    text.match(/(?:填提示詞|填入提示詞|提示詞填|提示詞改成|提示詞換成|prompt\s*[:：=]\s*|prompt\s*改成|prompt\s*設成)\s*[「『"']?(.+?)[」』"']?\s*$/i) ??
    text.match(/(?:幫我寫|幫我填|寫個提示詞|寫提示詞|fill\s+prompt)\s*[:：]?\s*(.+?)\s*$/i);
  if (!m) return null;
  const v = m[1].trim();
  if (v.length < 2 || v.length > 500) return null;
  return v;
}

/** 把已知 tabId / modeId / presetId 從 capability options 裡反查出來 */
function findOptionId(cap: AgentCapability | null, text: string): string | null {
  if (!cap?.options) return null;
  const t = lower(text);
  // 優先精確 label match
  const exact = cap.options.find(o => t.includes(lower(o.label)) || t.includes(lower(o.id)));
  return exact?.id ?? null;
}

// ─── Main ──────────────────────────────────────────────────────────────────

/**
 * 主入口：把使用者一句話 (`text`) 配合當頁 `snapshot.capabilities` 翻成
 * 可直接 dispatch 的 AgentAction[]。
 *
 * 動作排序：setMode → setTab → applyPreset → setModel → setParam(s) →
 * fillPrompt → submit (與 composer 系統提示詞的 SOP 對齊)。
 */
export function parseComposerImperatives(
  text: string,
  snapshot: PageAgentSnapshot | null | undefined,
): ComposerParseResult {
  if (!text || text.trim().length === 0) return EMPTY;

  const actions: AgentAction[] = [];
  const missing: ComposerParseResult["missing"] = [];
  const matchedRules: string[] = [];

  // ── setMode ──
  const modeCap = capabilityFor(snapshot, "setMode");
  const modeId = findOptionId(modeCap, text);
  if (modeId) {
    actions.push({ type: "setMode", modeId } satisfies SetModeAction);
    matchedRules.push("setMode");
  }

  // ── setTab ──
  const tabCap = capabilityFor(snapshot, "setTab");
  const tabId = findOptionId(tabCap, text);
  if (tabId) {
    actions.push({ type: "setTab", tabId } satisfies SetTabAction);
    matchedRules.push("setTab");
  }

  // ── applyPreset ──
  const presetCap = capabilityFor(snapshot, "applyPreset");
  const presetId = findOptionId(presetCap, text);
  if (presetId) {
    actions.push({ type: "applyPreset", presetId } satisfies ApplyPresetAction);
    matchedRules.push("applyPreset");
  }

  // ── setModel ──
  const modelCap = capabilityFor(snapshot, "setModel");
  if (modelCap) {
    const explicit = extractFalModelId(text);
    const guessed =
      explicit ?? guessModelIdFromAlias(text, snapshot?.availableModels ?? []);
    if (guessed) {
      // 比對當頁實際支援清單；不在清單裡就放棄這條規則 (避免 dispatch 失敗)
      const ok =
        !snapshot?.availableModels?.length ||
        snapshot.availableModels.includes(guessed);
      if (ok) {
        actions.push({ type: "setModel", modelId: guessed } satisfies SetModelAction);
        matchedRules.push("setModel");
      }
    }
  }

  // ── setParam: aspect / duration / seed ──
  const paramCap = capabilityFor(snapshot, "setParam");
  if (paramCap) {
    const aspect = extractAspect(text);
    if (aspect) {
      actions.push({ type: "setParam", key: "aspect", value: aspect } satisfies SetParamAction);
      matchedRules.push("setParam:aspect");
    }
    const duration = extractDurationSec(text);
    if (duration !== null) {
      actions.push({ type: "setParam", key: "durationSec", value: duration } satisfies SetParamAction);
      matchedRules.push("setParam:durationSec");
    }
    const seed = extractSeed(text);
    if (seed !== null) {
      actions.push({ type: "setParam", key: "seed", value: seed } satisfies SetParamAction);
      matchedRules.push("setParam:seed");
    }
  }

  // ── fillPrompt ──
  const promptCap = capabilityFor(snapshot, "fillPrompt");
  if (promptCap) {
    const explicitPrompt = extractFillPrompt(text);
    if (explicitPrompt) {
      actions.push({ type: "fillPrompt", text: explicitPrompt } satisfies FillPromptAction);
      matchedRules.push("fillPrompt:explicit");
    }
  }

  // ── submit ──
  const submitCap = capabilityFor(snapshot, "submit");
  if (submitCap) {
    if (isPureSubmit(text)) {
      // 純粹要送出 — 但如果頁面上沒填 prompt 又沒在這輪填，提示 caller 反問
      const haveFilledPrompt = actions.some(a => a.type === "fillPrompt");
      const pageHasPrompt = (snapshot?.currentPrompt ?? "").trim().length > 0;
      if (!haveFilledPrompt && !pageHasPrompt) {
        missing.push("prompt");
      } else {
        actions.push({ type: "submit" } satisfies SubmitAction);
        matchedRules.push("submit:explicit");
      }
    } else if (hasSubmitIntent(text) && actions.length > 0) {
      // 「設好參數後也要跑」這種句型 — 例如「換成 flux pro 然後送出」
      actions.push({ type: "submit" } satisfies SubmitAction);
      matchedRules.push("submit:trailing");
    }
  }

  return {
    actions,
    missing,
    matchedRules,
    matched: actions.length > 0 || missing.length > 0,
  };
}

/**
 * Render a one-line user-facing summary of what got dispatched. Used in
 * the chat reply so 編編 reports each action ("✅ 模型已切到 X / 已填提示詞
 * / 🚀 已送出").
 */
export function describeComposerActions(actions: AgentAction[]): string {
  if (actions.length === 0) return "";
  const lines: string[] = [];
  for (const a of actions) {
    switch (a.type) {
      case "setMode":
        lines.push(`✅ 模式切到 \`${a.modeId}\``);
        break;
      case "setTab":
        lines.push(`✅ 分頁切到 \`${a.tabId}\``);
        break;
      case "applyPreset":
        lines.push(`✅ 套用預設 \`${a.presetId}\``);
        break;
      case "setModel":
        lines.push(`✅ 模型切到 \`${a.modelId}\``);
        break;
      case "setParam":
        lines.push(`✅ ${a.key} = ${JSON.stringify(a.value)}`);
        break;
      case "fillPrompt":
        lines.push(`✅ 提示詞已填${a.append ? "（附加）" : ""}`);
        break;
      case "submit":
        lines.push("🚀 送出生成");
        break;
      default:
        // Other action types are not produced by this parser; ignore.
        break;
    }
  }
  return lines.join(" · ");
}

/**
 * Render a one-line user-facing summary of what's missing — for 編編 to
 * politely ask back. Caller appends this to the reply when `missing` is
 * non-empty.
 */
export function describeComposerMissing(
  missing: ComposerParseResult["missing"],
): string {
  if (missing.length === 0) return "";
  const messages: string[] = [];
  for (const m of missing) {
    if (m === "prompt") {
      messages.push("提示詞還沒填 — 你想出什麼？一句話描述就好");
    } else if (m === "model") {
      messages.push("還沒選模型 — 要快草稿、寫實首選、還是電影感？");
    } else if (m === "submit-confirm") {
      messages.push("這次大約要花點數，要我直接送嗎？");
    }
  }
  return messages.join("；");
}
