/**
 * server/services/spiritTools/settingsDetailTools.ts
 *
 * Tools for the settings-detail spirit (細細).
 *
 * 細細 is the autonomous "fine-tuner" — it doesn't just navigate to /settings
 * and let the user click. It can read every editable preference on
 * `agent_preferences`, explain its side-effects, validate proposed values,
 * apply changes one-by-one or in bulk, run named presets, preview a diff
 * before persisting, detect conflicting choices (e.g. a tool that is both
 * auto-approved AND blocked), and recommend optimisations from the user's
 * current state.
 *
 * The historical surface (getPreferences / updatePreference / explainSetting /
 * getAllSettings / validatePreference) is preserved verbatim so existing
 * dispatcher callers keep working. New autonomous capabilities are exported
 * as additional named functions and registered in
 * `shared/global-agent-tools.ts` + `server/services/agentToolExecutor.ts`.
 */

import { logger } from "../../_core/logger";
import { getDb } from "../../db";
import { users, agentPreferences } from "../../../drizzle/schema";
import { eq } from "drizzle-orm";
import { DEFAULT_AGENT_PREFERENCES } from "../../../shared/agent-preferences";

// ─── Preference schema (single source of truth) ──────────────────────────

type PrefValueType =
  | "boolean"
  | "boolean-nullable"
  | "enum"
  | "number"
  | "string-array"
  | "string-nullable"
  | "object"
  | "object-nullable";

interface PreferenceMeta {
  /** Human-readable title used in chat explanations. */
  title: string;
  /** One-line description. */
  description: string;
  /** Per-value side-effects, voiced as if explaining to the user. */
  sideEffects: string[];
  /** Default recommendation tagline. */
  recommendations: string;
  /** Loose grouping for UI listing. */
  category:
    | "safety"
    | "automation"
    | "ui"
    | "voice"
    | "spirit"
    | "perception"
    | "cost"
    | "notifications"
    | "onboarding";
  /** Runtime shape. */
  type: PrefValueType;
  /** Allowed values for "enum" types. */
  enumValues?: readonly string[];
  /** Inclusive bounds for "number" types. */
  min?: number;
  max?: number;
  /** Server-side default if the user resets. */
  defaultValue: unknown;
  /** Keywords for natural-language search. */
  synonyms: string[];
}

const PREFERENCE_SCHEMA: Record<string, PreferenceMeta> = {
  // ── Safety / confirmation ─────────────────────────────────────────────
  confirmationPolicy: {
    title: "確認政策",
    description: "光球執行動作前要不要先問你",
    sideEffects: [
      "always_approve：全自動，不問你（適合熟手）",
      "confirm_high_risk：只有高風險動作才問（推薦）",
      "confirm_all：每個動作都問一次（最謹慎）",
      "manual：光球不會自己跑任何動作",
    ],
    recommendations: "建議 confirm_high_risk — 在效率與安全間取得平衡",
    category: "safety",
    type: "enum",
    enumValues: ["always_approve", "confirm_high_risk", "confirm_all", "manual"],
    defaultValue: DEFAULT_AGENT_PREFERENCES.confirmationPolicy,
    synonyms: ["確認", "確認模式", "approval", "confirmation", "授權", "詢問"],
  },
  allowedRiskLevels: {
    title: "允許的風險等級",
    description: "光球能自動執行的風險等級白名單",
    sideEffects: [
      "包含 low：低風險如查詢、估算可以直接跑",
      "包含 medium：中等風險如生成圖片可以直接跑",
      "包含 high：高風險如送出、扣費也直接跑（不建議）",
    ],
    recommendations: "建議只放 [low, medium]，高風險動作仍由你確認",
    category: "safety",
    type: "string-array",
    enumValues: ["low", "medium", "high"],
    defaultValue: DEFAULT_AGENT_PREFERENCES.allowedRiskLevels,
    synonyms: ["風險", "risk", "等級", "level"],
  },
  autoApproveTools: {
    title: "自動核准工具清單",
    description: "這些工具不會再彈出確認對話框",
    sideEffects: [
      "列在這的工具會被自動執行，不再二次確認",
      "用 \"*\" 萬用字元可以放行所有工具（極不建議）",
      "建議只列低風險工具，例如 research.deepSearch、inspiration.fetch",
    ],
    recommendations: "建議加入：research.deepSearch、inspiration.fetch",
    category: "safety",
    type: "string-array",
    defaultValue: DEFAULT_AGENT_PREFERENCES.autoApproveTools,
    synonyms: ["自動核准", "auto approve", "免確認", "allowlist", "白名單"],
  },
  blockedTools: {
    title: "封鎖工具清單",
    description: "光球永遠不會呼叫這些工具",
    sideEffects: [
      "被封鎖的工具完全失效",
      "可能讓某些 workflow 不完整（精靈會跳過）",
      "與 autoApproveTools 重疊時，封鎖優先",
    ],
    recommendations: "只封鎖確實不需要、或有安全疑慮的工具",
    category: "safety",
    type: "string-array",
    defaultValue: DEFAULT_AGENT_PREFERENCES.blockedTools,
    synonyms: ["封鎖", "禁用", "block", "deny", "黑名單"],
  },
  maxAutoStepsPerTask: {
    title: "單一任務最多自動跑幾步",
    description: "限制光球在沒問你的情況下能連續跑幾步",
    sideEffects: [
      "數字越大，光球越像「自動駕駛」",
      "達到上限後會停下來問你「要繼續嗎」",
    ],
    recommendations: "建議 5～10 步；長 workflow 用 10 起跳",
    category: "automation",
    type: "number",
    min: 1,
    max: 20,
    defaultValue: DEFAULT_AGENT_PREFERENCES.maxAutoStepsPerTask,
    synonyms: ["自動步數", "max steps", "auto steps", "連續步驟"],
  },
  // ── Notifications ─────────────────────────────────────────────────────
  notifyOnCompletion: {
    title: "完成時通知",
    description: "任務完成時送通知到通知中心",
    sideEffects: ["關掉後不會主動告訴你任務完成；你要自己進 /jobs 看"],
    recommendations: "建議保持開啟",
    category: "notifications",
    type: "boolean",
    defaultValue: DEFAULT_AGENT_PREFERENCES.notifyOnCompletion,
    synonyms: ["完成通知", "completion", "done notification"],
  },
  notifyOnError: {
    title: "失敗時通知",
    description: "任務失敗時送通知",
    sideEffects: ["關掉後遇到錯誤光球只會悄悄記 log，不會主動提醒你"],
    recommendations: "強烈建議開啟",
    category: "notifications",
    type: "boolean",
    defaultValue: DEFAULT_AGENT_PREFERENCES.notifyOnError,
    synonyms: ["失敗通知", "error notification", "錯誤提醒"],
  },
  // ── Voice ─────────────────────────────────────────────────────────────
  voiceEnabled: {
    title: "啟用語音回應",
    description: "光球用 TTS 唸出回覆",
    sideEffects: [
      "開啟後光球的訊息會用 TTS 朗讀",
      "需要先選一個聲音（preferredVoiceName）",
      "公共場合建議關閉",
    ],
    recommendations: "預設關閉；想要語音陪伴再開",
    category: "voice",
    type: "boolean",
    defaultValue: DEFAULT_AGENT_PREFERENCES.voiceEnabled,
    synonyms: ["語音", "voice", "TTS", "朗讀"],
  },
  preferredVoiceName: {
    title: "預設聲音",
    description: "光球 TTS 使用的聲音名稱",
    sideEffects: [
      "Puck：中性，預設值",
      "Charon：低沉穩重",
      "Kore：中性清亮",
      "Fenrir：男聲",
      "Aoede：女聲",
    ],
    recommendations: "Puck 是預設；可試試 Aoede 較柔和",
    category: "voice",
    type: "enum",
    enumValues: ["Puck", "Charon", "Kore", "Fenrir", "Aoede"],
    defaultValue: DEFAULT_AGENT_PREFERENCES.preferredVoiceName,
    synonyms: ["聲音", "voice name", "TTS voice"],
  },
  voiceAutoActivate: {
    title: "自動進入語音模式",
    description: "光球出現時直接打開語音輸入",
    sideEffects: ["每次喚出光球就會請求麥克風權限"],
    recommendations: "預設關閉；常用語音再開",
    category: "voice",
    type: "boolean",
    defaultValue: DEFAULT_AGENT_PREFERENCES.voiceAutoActivate,
    synonyms: ["語音自動", "voice auto", "麥克風"],
  },
  // ── Orb agent kill switches & overrides ──────────────────────────────
  orbAgentEnabled: {
    title: "光球功能總開關（覆蓋環境變數）",
    description: "true/false 強制覆蓋；null 跟隨環境設定",
    sideEffects: [
      "true：強制開啟光球（即使環境變數關閉）",
      "false：強制關閉所有光球功能",
      "null：跟隨 VITE_ENABLE_ORB_AGENT 環境變數（預設）",
    ],
    recommendations: "正常情境留 null，跟隨環境設定",
    category: "automation",
    type: "boolean-nullable",
    defaultValue: DEFAULT_AGENT_PREFERENCES.orbAgentEnabled,
    synonyms: ["光球", "orb", "total switch", "總開關"],
  },
  workflowsEnabled: {
    title: "Workflow 功能總開關",
    description: "true/false 覆蓋全域 workflow 開關",
    sideEffects: ["false 後跨頁 workflow 一律停用，只能單頁手動操作"],
    recommendations: "正常留 null",
    category: "automation",
    type: "boolean-nullable",
    defaultValue: DEFAULT_AGENT_PREFERENCES.workflowsEnabled,
    synonyms: ["workflow", "工作流", "跨頁"],
  },
  disabledPageAgents: {
    title: "停用 agent 的頁面",
    description: "在這些頁面光球完全不出現",
    sideEffects: ["列出的 pageId 上找不到光球", "可用於想完全安靜的頁面"],
    recommendations: "預設為空；只在真的不想被打擾的頁面加入",
    category: "automation",
    type: "string-array",
    defaultValue: DEFAULT_AGENT_PREFERENCES.disabledPageAgents,
    synonyms: ["停用頁面", "disable page", "靜音頁面"],
  },
  // ── Orb widget UI ─────────────────────────────────────────────────────
  orbWidgetCorner: {
    title: "光球停靠位置",
    description: "光球小工具預設停在哪個角落",
    sideEffects: ["位置改變會影響其他懸浮按鈕的視覺優先順序"],
    recommendations: "預設 bottom-right；左撇子可改 bottom-left",
    category: "ui",
    type: "enum",
    enumValues: ["bottom-right", "bottom-left", "top-right", "top-left"],
    defaultValue: DEFAULT_AGENT_PREFERENCES.orbWidgetCorner,
    synonyms: ["位置", "角落", "corner", "停靠"],
  },
  orbWelcomeMessage: {
    title: "光球歡迎訊息",
    description: "你打開光球時看到的第一句話",
    sideEffects: ["留空（null）會用預設歡迎詞"],
    recommendations: "想要個人化問候時填入；不要超過 280 字",
    category: "ui",
    type: "string-nullable",
    defaultValue: DEFAULT_AGENT_PREFERENCES.orbWelcomeMessage,
    synonyms: ["歡迎詞", "welcome", "greeting", "問候"],
  },
  orbShortcutEnabled: {
    title: "啟用鍵盤快捷鍵",
    description: "Cmd/Ctrl+K 喚出光球",
    sideEffects: ["關閉後只能用按鈕喚出光球"],
    recommendations: "建議保持開啟",
    category: "ui",
    type: "boolean",
    defaultValue: DEFAULT_AGENT_PREFERENCES.orbShortcutEnabled,
    synonyms: ["快捷鍵", "shortcut", "hotkey", "cmd k"],
  },
  orbProactiveSuggestions: {
    title: "主動建議",
    description: "光球會根據你的動作主動丟提示卡片",
    sideEffects: [
      "開啟時：主動精靈會在你停留某頁太久 / 卡關時跳出建議",
      "關閉時：完全不主動跳建議，需要你問才會回",
    ],
    recommendations: "新手建議開啟；想要安靜介面可關閉",
    category: "notifications",
    type: "boolean",
    defaultValue: DEFAULT_AGENT_PREFERENCES.orbProactiveSuggestions,
    synonyms: ["主動建議", "proactive", "suggestions", "tips", "提示"],
  },
  // ── Perception / critic / pacing ──────────────────────────────────────
  perceptionEnabled: {
    title: "感知模式",
    description: "光球執行完每步後檢查畫面變化是否符合預期",
    sideEffects: [
      "開啟時：每步多一次快照比對；偵測到「沒效果」會主動 replan",
      "關閉時：光球只信工具回傳的 ok=true，不會檢查視覺結果",
    ],
    recommendations: "建議開啟，可顯著降低「光球說做完了實際沒做」",
    category: "perception",
    type: "boolean",
    defaultValue: DEFAULT_AGENT_PREFERENCES.perceptionEnabled,
    synonyms: ["感知", "perception", "視覺檢查", "snapshot"],
  },
  perceptionStrictness: {
    title: "感知嚴格度",
    description: "感知模式偵測到異常時的反應",
    sideEffects: [
      "lenient：警告會忽略，只在明確失敗才 replan",
      "balanced：警告會 replan（預設）",
      "strict：任何畫面沒變都當失敗，replan 或 abort",
    ],
    recommendations: "預設 balanced；高精度任務換 strict",
    category: "perception",
    type: "enum",
    enumValues: ["lenient", "balanced", "strict"],
    defaultValue: DEFAULT_AGENT_PREFERENCES.perceptionStrictness,
    synonyms: ["嚴格", "strict", "perception", "感知嚴格"],
  },
  criticEnabled: {
    title: "評論家審核",
    description: "Planner 規劃後請評論家給分並決定要不要重規劃",
    sideEffects: [
      "開啟時：每次規劃多一次 LLM 評分，會增加延遲與 token 消耗",
      "可大幅提升複雜 workflow 的品質",
    ],
    recommendations: "預設關閉；做大專案時開啟",
    category: "perception",
    type: "boolean",
    defaultValue: DEFAULT_AGENT_PREFERENCES.criticEnabled,
    synonyms: ["評論", "critic", "review", "審核"],
  },
  criticRefineBelow: {
    title: "評論家重規劃門檻",
    description: "規劃分數低於這個值就強制 refine",
    sideEffects: ["門檻越高，光球越愛重做規劃（更慢但更精緻）"],
    recommendations: "預設 75；要求高品質拉到 85",
    category: "perception",
    type: "number",
    min: 0,
    max: 100,
    defaultValue: DEFAULT_AGENT_PREFERENCES.criticRefineBelow,
    synonyms: ["門檻", "threshold", "critic threshold", "重做"],
  },
  roleAutoSwitch: {
    title: "自動切換精靈角色",
    description: "光球根據意圖自動選對應的精靈接手",
    sideEffects: ["關閉後光球永遠用暖暖（companion）對話，不會找對應精靈"],
    recommendations: "建議開啟；除非你只想跟暖暖聊天",
    category: "spirit",
    type: "boolean",
    defaultValue: DEFAULT_AGENT_PREFERENCES.roleAutoSwitch,
    synonyms: ["角色切換", "auto switch", "精靈切換", "intent routing"],
  },
  pacingOverride: {
    title: "互動節奏",
    description: "光球回覆與動作的節奏快慢",
    sideEffects: [
      "auto：自動判斷（預設）",
      "patient：慢節奏，解釋多",
      "balanced：中庸",
      "impatient：快節奏，少廢話",
    ],
    recommendations: "預設 auto；急著做事換 impatient",
    category: "ui",
    type: "enum",
    enumValues: ["auto", "patient", "balanced", "impatient"],
    defaultValue: DEFAULT_AGENT_PREFERENCES.pacingOverride,
    synonyms: ["節奏", "pacing", "速度", "tempo"],
  },
  // ── Spirit relations ──────────────────────────────────────────────────
  mutedSpirits: {
    title: "靜音精靈",
    description: "這些精靈不會被自動 routing 觸發",
    sideEffects: ["即使意圖匹配也會被跳過", "下一個最佳精靈會接手"],
    recommendations: "不喜歡某位精靈的風格就加進來",
    category: "spirit",
    type: "string-array",
    defaultValue: DEFAULT_AGENT_PREFERENCES.mutedSpirits,
    synonyms: ["靜音", "mute", "屏蔽", "禁用精靈"],
  },
  favoriteSpirits: {
    title: "最愛精靈",
    description: "UI 高亮 + 主動通知會優先這些精靈",
    sideEffects: ["影響顯示優先序，不改變 routing 邏輯"],
    recommendations: "常用的 3～5 位加入即可",
    category: "spirit",
    type: "string-array",
    defaultValue: DEFAULT_AGENT_PREFERENCES.favoriteSpirits,
    synonyms: ["最愛", "favorite", "常用", "星號"],
  },
  // ── Execution mode ───────────────────────────────────────────────────
  stayOnPageMode: {
    title: "原地執行模式",
    description: "光球在背景跑生成任務，不把你帶到工作室頁",
    sideEffects: [
      "開啟：所有生成都在背景跑，你可以留在當前頁",
      "關閉（預設）：光球會把你導去對應工作室頁",
    ],
    recommendations: "想要不被打斷的多工流程時開啟",
    category: "automation",
    type: "boolean",
    defaultValue: DEFAULT_AGENT_PREFERENCES.stayOnPageMode,
    synonyms: ["原地", "背景", "stay on page", "後台", "background"],
  },
};

const SETTABLE_KEYS = new Set(Object.keys(PREFERENCE_SCHEMA));

// ─── Presets ──────────────────────────────────────────────────────────────

interface PresetDefinition {
  id: string;
  displayName: string;
  description: string;
  /** Diff against current state, applied with bulkUpdate semantics. */
  changes: Record<string, unknown>;
}

const PRESETS: PresetDefinition[] = [
  {
    id: "cautious",
    displayName: "謹慎模式",
    description: "每步都問你；critic 開啟；自動步數降到 3 — 適合處理重要任務",
    changes: {
      confirmationPolicy: "confirm_all",
      criticEnabled: true,
      criticRefineBelow: 85,
      maxAutoStepsPerTask: 3,
      perceptionStrictness: "strict",
      stayOnPageMode: false,
    },
  },
  {
    id: "balanced",
    displayName: "平衡模式",
    description: "回到全部預設值 — 高風險才問、感知開、評論關",
    changes: {
      confirmationPolicy: "confirm_high_risk",
      criticEnabled: false,
      criticRefineBelow: 75,
      maxAutoStepsPerTask: 5,
      perceptionStrictness: "balanced",
      perceptionEnabled: true,
      pacingOverride: "auto",
      stayOnPageMode: false,
    },
  },
  {
    id: "autopilot",
    displayName: "自動駕駛模式",
    description: "幾乎不打擾；最多自動 15 步；原地執行；只有送出/扣費才問 — 適合熟手",
    changes: {
      confirmationPolicy: "always_approve",
      maxAutoStepsPerTask: 15,
      stayOnPageMode: true,
      perceptionEnabled: true,
      perceptionStrictness: "lenient",
      pacingOverride: "impatient",
    },
  },
  {
    id: "quiet",
    displayName: "安靜模式",
    description: "關掉主動建議與完成通知，只留錯誤通知 — 適合專注工作",
    changes: {
      orbProactiveSuggestions: false,
      notifyOnCompletion: false,
      notifyOnError: true,
      voiceEnabled: false,
      voiceAutoActivate: false,
    },
  },
  {
    id: "focused",
    displayName: "專注創作模式",
    description: "關掉評論家、主動建議與感知告警，只在你問才回 — 適合 flow 狀態",
    changes: {
      orbProactiveSuggestions: false,
      criticEnabled: false,
      perceptionStrictness: "lenient",
      pacingOverride: "impatient",
      roleAutoSwitch: true,
    },
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────

async function ensurePreferencesRow(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const existing = await db
    .select({ userId: agentPreferences.userId })
    .from(agentPreferences)
    .where(eq(agentPreferences.userId, userId))
    .limit(1);
  if (existing[0]) return;
  await db.insert(agentPreferences).values({ userId, ...DEFAULT_AGENT_PREFERENCES });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ─── Existing API (kept stable) ───────────────────────────────────────────

/**
 * Get user preferences. Surfaces every key in PREFERENCE_SCHEMA plus a
 * `hasUserRecord` flag so the caller can detect bootstrap state.
 */
export async function getPreferences(userId: number): Promise<{
  success: boolean;
  preferences: Record<string, unknown>;
}> {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database is not configured");
    const [userRow] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const [agentPref] = await db
      .select()
      .from(agentPreferences)
      .where(eq(agentPreferences.userId, userId))
      .limit(1);

    const preferences: Record<string, unknown> = {
      hasUserRecord: Boolean(userRow),
    };
    for (const key of SETTABLE_KEYS) {
      const meta = PREFERENCE_SCHEMA[key];
      const raw = (agentPref as Record<string, unknown> | undefined)?.[key];
      preferences[key] = raw === undefined ? meta.defaultValue : raw;
    }

    logger.debug("preferences_retrieved", { userId, keys: Object.keys(preferences).length });

    return { success: true, preferences };
  } catch (error) {
    logger.error("get_preferences_failed", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, preferences: {} };
  }
}

/**
 * Update a single preference.
 */
export async function updatePreference(input: {
  userId: number;
  key: string;
  value: unknown;
}): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    if (!SETTABLE_KEYS.has(input.key)) {
      return {
        success: false,
        message: `設定鍵「${input.key}」目前不支援；可用的鍵：${Array.from(SETTABLE_KEYS).join("、")}`,
      };
    }
    const validation = validatePreference(input.key, input.value);
    if (!validation.valid) {
      return {
        success: false,
        message: validation.error ?? "驗證失敗",
      };
    }

    await ensurePreferencesRow(input.userId);
    const db = await getDb();
    if (!db) throw new Error("Database is not configured");

    const updateData: Record<string, unknown> = {
      [input.key]: input.value,
      updatedAt: new Date(),
    };
    await db
      .update(agentPreferences)
      .set(updateData)
      .where(eq(agentPreferences.userId, input.userId));

    logger.info("preference_updated", {
      userId: input.userId,
      key: input.key,
    });

    const meta = PREFERENCE_SCHEMA[input.key];
    return {
      success: true,
      message: `「${meta.title}」已更新為 ${JSON.stringify(input.value)}`,
    };
  } catch (error) {
    logger.error("update_preference_failed", {
      userId: input.userId,
      key: input.key,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      message: `更新失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Explain a setting with side effects and recommendations.
 */
export function explainSetting(settingKey: string): {
  found: boolean;
  explanation?: {
    title: string;
    description: string;
    sideEffects: string[];
    recommendations: string;
    category: string;
    type: string;
    enumValues?: readonly string[];
    defaultValue: unknown;
  };
} {
  const meta = PREFERENCE_SCHEMA[settingKey];
  if (!meta) {
    logger.debug("setting_explanation_not_found", { settingKey });
    return { found: false };
  }
  return {
    found: true,
    explanation: {
      title: meta.title,
      description: meta.description,
      sideEffects: meta.sideEffects,
      recommendations: meta.recommendations,
      category: meta.category,
      type: meta.type,
      ...(meta.enumValues ? { enumValues: meta.enumValues } : {}),
      defaultValue: meta.defaultValue,
    },
  };
}

/**
 * List every settable preference with a brief description and category.
 */
export function getAllSettings(): {
  settings: Array<{
    key: string;
    title: string;
    description: string;
    category: string;
    type: string;
    defaultValue: unknown;
  }>;
} {
  const settings = Object.entries(PREFERENCE_SCHEMA).map(([key, meta]) => ({
    key,
    title: meta.title,
    description: meta.description,
    category: meta.category,
    type: meta.type,
    defaultValue: meta.defaultValue,
  }));
  return { settings };
}

/**
 * Validate a preference value against the schema. Pure / sync — safe to call
 * before persisting and from bulkUpdate / applyPreset.
 */
export function validatePreference(key: string, value: unknown): {
  valid: boolean;
  error?: string;
  suggestion?: string;
} {
  const meta = PREFERENCE_SCHEMA[key];
  if (!meta) {
    return {
      valid: false,
      error: `未知設定鍵「${key}」`,
      suggestion: `可用的鍵：${Array.from(SETTABLE_KEYS).join("、")}`,
    };
  }
  switch (meta.type) {
    case "boolean":
      if (typeof value !== "boolean") {
        return { valid: false, error: `「${meta.title}」必須是 true/false` };
      }
      break;
    case "boolean-nullable":
      if (value !== null && typeof value !== "boolean") {
        return { valid: false, error: `「${meta.title}」必須是 true/false 或 null` };
      }
      break;
    case "enum":
      if (typeof value !== "string" || !meta.enumValues?.includes(value)) {
        return {
          valid: false,
          error: `「${meta.title}」必須是：${meta.enumValues?.join(", ")}`,
          suggestion: `建議：${meta.recommendations}`,
        };
      }
      break;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return { valid: false, error: `「${meta.title}」必須是數字` };
      }
      if (meta.min !== undefined && value < meta.min) {
        return { valid: false, error: `「${meta.title}」不能小於 ${meta.min}` };
      }
      if (meta.max !== undefined && value > meta.max) {
        return { valid: false, error: `「${meta.title}」不能大於 ${meta.max}` };
      }
      break;
    case "string-array":
      if (!Array.isArray(value) || value.some(v => typeof v !== "string")) {
        return {
          valid: false,
          error: `「${meta.title}」必須是字串陣列`,
          suggestion: meta.synonyms.length > 0 ? `例如：[]` : undefined,
        };
      }
      if (meta.enumValues) {
        const bad = (value as string[]).filter(v => !meta.enumValues!.includes(v));
        if (bad.length > 0) {
          return {
            valid: false,
            error: `「${meta.title}」陣列中有無效值：${bad.join(", ")}；允許：${meta.enumValues.join(", ")}`,
          };
        }
      }
      break;
    case "string-nullable":
      if (value !== null && typeof value !== "string") {
        return { valid: false, error: `「${meta.title}」必須是字串或 null` };
      }
      break;
    case "object":
      if (!isPlainObject(value)) {
        return { valid: false, error: `「${meta.title}」必須是物件` };
      }
      break;
    case "object-nullable":
      if (value !== null && !isPlainObject(value)) {
        return { valid: false, error: `「${meta.title}」必須是物件或 null` };
      }
      break;
  }
  return { valid: true };
}

// ─── New autonomous capabilities ─────────────────────────────────────────

export interface BulkUpdateItem {
  key: string;
  value: unknown;
}

/**
 * Validate every item up-front, then persist all of them atomically (or none
 * if any item fails). Used by applyPreset and by 細細's "幫我一次調好" flow.
 */
export async function bulkUpdatePreferences(input: {
  userId: number;
  items: ReadonlyArray<BulkUpdateItem>;
}): Promise<{
  success: boolean;
  applied: string[];
  failed: Array<{ key: string; error: string }>;
  message: string;
}> {
  const applied: string[] = [];
  const failed: Array<{ key: string; error: string }> = [];

  if (!Array.isArray(input.items) || input.items.length === 0) {
    return {
      success: false,
      applied,
      failed,
      message: "items 必須是非空陣列",
    };
  }

  // Validate every item first — all-or-nothing semantics.
  for (const item of input.items) {
    if (!SETTABLE_KEYS.has(item.key)) {
      failed.push({ key: item.key, error: `未知設定鍵「${item.key}」` });
      continue;
    }
    const v = validatePreference(item.key, item.value);
    if (!v.valid) failed.push({ key: item.key, error: v.error ?? "validation failed" });
  }
  if (failed.length > 0) {
    return {
      success: false,
      applied,
      failed,
      message: `${failed.length} 個項目驗證失敗；未寫入任何設定`,
    };
  }

  try {
    await ensurePreferencesRow(input.userId);
    const db = await getDb();
    if (!db) throw new Error("Database is not configured");

    const setPayload: Record<string, unknown> = { updatedAt: new Date() };
    for (const item of input.items) {
      setPayload[item.key] = item.value;
      applied.push(item.key);
    }
    await db
      .update(agentPreferences)
      .set(setPayload)
      .where(eq(agentPreferences.userId, input.userId));

    logger.info("preferences_bulk_updated", {
      userId: input.userId,
      keys: applied,
    });

    return {
      success: true,
      applied,
      failed,
      message: `已一次更新 ${applied.length} 個設定：${applied.join("、")}`,
    };
  } catch (error) {
    logger.error("preferences_bulk_update_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      applied: [],
      failed: input.items.map(i => ({
        key: i.key,
        error: error instanceof Error ? error.message : String(error),
      })),
      message: `批次更新失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Preview the effect of a bulk update without persisting. Returns the
 * before/after for each key so 細細 can show the user a diff card.
 */
export async function previewPreferenceDiff(input: {
  userId: number;
  items: ReadonlyArray<BulkUpdateItem>;
}): Promise<{
  success: boolean;
  diff: Array<{ key: string; title: string; before: unknown; after: unknown; changed: boolean }>;
  invalid: Array<{ key: string; error: string }>;
}> {
  const invalid: Array<{ key: string; error: string }> = [];
  const validated: BulkUpdateItem[] = [];
  for (const item of input.items) {
    if (!SETTABLE_KEYS.has(item.key)) {
      invalid.push({ key: item.key, error: `未知設定鍵「${item.key}」` });
      continue;
    }
    const v = validatePreference(item.key, item.value);
    if (!v.valid) invalid.push({ key: item.key, error: v.error ?? "validation failed" });
    else validated.push(item);
  }

  const current = await getPreferences(input.userId);
  const diff = validated.map(item => {
    const before = current.preferences[item.key];
    const meta = PREFERENCE_SCHEMA[item.key];
    return {
      key: item.key,
      title: meta.title,
      before,
      after: item.value,
      changed: JSON.stringify(before) !== JSON.stringify(item.value),
    };
  });

  return { success: current.success && invalid.length === 0, diff, invalid };
}

/**
 * Apply a named preset (cautious / balanced / autopilot / quiet / focused).
 * Internally calls bulkUpdatePreferences after validating every change.
 */
export async function applyPreset(input: {
  userId: number;
  presetId: string;
}): Promise<{
  success: boolean;
  preset?: { id: string; displayName: string; description: string };
  applied: string[];
  failed: Array<{ key: string; error: string }>;
  message: string;
}> {
  const preset = PRESETS.find(p => p.id === input.presetId);
  if (!preset) {
    return {
      success: false,
      applied: [],
      failed: [],
      message: `未知預設名稱「${input.presetId}」；可用：${PRESETS.map(p => p.id).join("、")}`,
    };
  }

  const items: BulkUpdateItem[] = Object.entries(preset.changes).map(([key, value]) => ({
    key,
    value,
  }));
  const result = await bulkUpdatePreferences({ userId: input.userId, items });

  return {
    success: result.success,
    preset: { id: preset.id, displayName: preset.displayName, description: preset.description },
    applied: result.applied,
    failed: result.failed,
    message: result.success
      ? `已套用「${preset.displayName}」— ${preset.description}`
      : result.message,
  };
}

/**
 * List every available preset for UI selection.
 */
export function listPresets(): {
  presets: Array<{
    id: string;
    displayName: string;
    description: string;
    changeKeys: string[];
  }>;
} {
  return {
    presets: PRESETS.map(p => ({
      id: p.id,
      displayName: p.displayName,
      description: p.description,
      changeKeys: Object.keys(p.changes),
    })),
  };
}

/**
 * Reset a single preference back to its schema default.
 */
export async function resetPreference(input: {
  userId: number;
  key: string;
}): Promise<{
  success: boolean;
  message: string;
  resetTo?: unknown;
}> {
  const meta = PREFERENCE_SCHEMA[input.key];
  if (!meta) {
    return {
      success: false,
      message: `未知設定鍵「${input.key}」`,
    };
  }
  const result = await updatePreference({
    userId: input.userId,
    key: input.key,
    value: meta.defaultValue,
  });
  return {
    success: result.success,
    message: result.success
      ? `「${meta.title}」已重設為預設值 ${JSON.stringify(meta.defaultValue)}`
      : result.message,
    resetTo: meta.defaultValue,
  };
}

/**
 * Natural-language search over settings. Matches against title, description,
 * synonyms, and the key itself, case-insensitively. Pure / sync.
 */
export function searchSettings(query: string): {
  query: string;
  matches: Array<{
    key: string;
    title: string;
    description: string;
    category: string;
    score: number;
  }>;
} {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) {
    return { query, matches: [] };
  }
  const matches: Array<{
    key: string;
    title: string;
    description: string;
    category: string;
    score: number;
  }> = [];

  for (const [key, meta] of Object.entries(PREFERENCE_SCHEMA)) {
    let score = 0;
    const haystackParts = [
      key,
      meta.title,
      meta.description,
      ...meta.synonyms,
      meta.category,
    ];
    for (const part of haystackParts) {
      if (!part) continue;
      const lower = part.toLowerCase();
      if (lower === q) score += 10;
      else if (lower.includes(q)) score += 4;
      else if (q.includes(lower) && lower.length >= 3) score += 2;
    }
    if (score > 0) {
      matches.push({
        key,
        title: meta.title,
        description: meta.description,
        category: meta.category,
        score,
      });
    }
  }
  matches.sort((a, b) => b.score - a.score);
  return { query, matches: matches.slice(0, 10) };
}

/**
 * Detect conflicting / suspicious preference combinations. Pure heuristics
 * over the user's current preference snapshot. Each issue carries a
 * `fixSuggestion` 細細 can offer to apply directly via updatePreference.
 */
export interface PreferenceInconsistency {
  severity: "warning" | "error";
  keys: string[];
  message: string;
  fixSuggestion?: BulkUpdateItem[];
}

export async function detectInconsistencies(userId: number): Promise<{
  success: boolean;
  inconsistencies: PreferenceInconsistency[];
}> {
  const { preferences, success } = await getPreferences(userId);
  if (!success) {
    return { success: false, inconsistencies: [] };
  }
  const issues: PreferenceInconsistency[] = [];

  const autoApprove = (preferences.autoApproveTools as string[] | undefined) ?? [];
  const blocked = (preferences.blockedTools as string[] | undefined) ?? [];
  const overlap = autoApprove.filter(t => blocked.includes(t));
  if (overlap.length > 0) {
    issues.push({
      severity: "error",
      keys: ["autoApproveTools", "blockedTools"],
      message: `工具同時在自動核准與封鎖清單裡：${overlap.join("、")}；封鎖會優先，等於名為自動核准但永遠跑不到。`,
      fixSuggestion: [
        {
          key: "autoApproveTools",
          value: autoApprove.filter(t => !overlap.includes(t)),
        },
      ],
    });
  }

  const muted = (preferences.mutedSpirits as string[] | undefined) ?? [];
  const favorites = (preferences.favoriteSpirits as string[] | undefined) ?? [];
  const mutedFavs = muted.filter(s => favorites.includes(s));
  if (mutedFavs.length > 0) {
    issues.push({
      severity: "warning",
      keys: ["mutedSpirits", "favoriteSpirits"],
      message: `精靈同時被靜音又被加入最愛：${mutedFavs.join("、")}；UI 會打星但不會被 routing 觸發。`,
      fixSuggestion: [
        {
          key: "mutedSpirits",
          value: muted.filter(s => !mutedFavs.includes(s)),
        },
      ],
    });
  }

  if (
    preferences.confirmationPolicy === "always_approve"
    && preferences.notifyOnError === false
  ) {
    issues.push({
      severity: "error",
      keys: ["confirmationPolicy", "notifyOnError"],
      message: "已開啟全自動執行（always_approve）但關閉了錯誤通知 — 出錯時你完全不會察覺。",
      fixSuggestion: [{ key: "notifyOnError", value: true }],
    });
  }

  if (
    preferences.criticEnabled === true
    && preferences.pacingOverride === "impatient"
  ) {
    issues.push({
      severity: "warning",
      keys: ["criticEnabled", "pacingOverride"],
      message: "啟用了評論家審核但節奏設成 impatient — 評論家會增加延遲，與快節奏需求衝突。",
      fixSuggestion: [{ key: "criticEnabled", value: false }],
    });
  }

  if (
    preferences.voiceEnabled === false
    && preferences.voiceAutoActivate === true
  ) {
    issues.push({
      severity: "warning",
      keys: ["voiceEnabled", "voiceAutoActivate"],
      message: "關閉語音回應卻打開了自動進入語音模式 — 麥克風會被請求權限但聽不到光球說話。",
      fixSuggestion: [{ key: "voiceAutoActivate", value: false }],
    });
  }

  if (
    preferences.perceptionEnabled === false
    && preferences.perceptionStrictness === "strict"
  ) {
    issues.push({
      severity: "warning",
      keys: ["perceptionEnabled", "perceptionStrictness"],
      message: "感知模式關閉了，但嚴格度仍是 strict — strict 不會生效。",
      fixSuggestion: [{ key: "perceptionStrictness", value: "balanced" }],
    });
  }

  const allowedRisk = (preferences.allowedRiskLevels as string[] | undefined) ?? [];
  if (
    preferences.confirmationPolicy === "always_approve"
    && allowedRisk.includes("high")
  ) {
    issues.push({
      severity: "error",
      keys: ["confirmationPolicy", "allowedRiskLevels"],
      message: "全自動執行 + 允許高風險 — 等於沒有任何安全護網，所有 publish / 扣費 / 帳號變更都會直接執行。",
      fixSuggestion: [
        { key: "allowedRiskLevels", value: allowedRisk.filter(r => r !== "high") },
      ],
    });
  }

  return { success: true, inconsistencies: issues };
}

/**
 * Heuristic recommendations from the current state. Used by 細細 to proactively
 * surface "你可能想試這個" cards. Each recommendation is one or more concrete
 * changes plus a one-line rationale.
 */
export interface PreferenceRecommendation {
  id: string;
  title: string;
  rationale: string;
  changes: BulkUpdateItem[];
}

export async function recommendOptimizations(userId: number): Promise<{
  success: boolean;
  recommendations: PreferenceRecommendation[];
}> {
  const { preferences, success } = await getPreferences(userId);
  if (!success) return { success: false, recommendations: [] };
  const recs: PreferenceRecommendation[] = [];

  if (preferences.notifyOnError === false) {
    recs.push({
      id: "enable-error-notification",
      title: "開啟錯誤通知",
      rationale: "目前關閉中 — 失敗時你不會被告知，建議至少留錯誤通知開啟。",
      changes: [{ key: "notifyOnError", value: true }],
    });
  }

  if (
    preferences.confirmationPolicy === "always_approve"
    && (preferences.maxAutoStepsPerTask as number) < 5
  ) {
    recs.push({
      id: "raise-auto-steps",
      title: "提高自動步數上限",
      rationale: "已開啟全自動但只允許跑很少步 — 拉高到 10 可以讓長 workflow 不被打斷。",
      changes: [{ key: "maxAutoStepsPerTask", value: 10 }],
    });
  }

  if (
    preferences.perceptionEnabled === false
    && preferences.confirmationPolicy === "always_approve"
  ) {
    recs.push({
      id: "enable-perception-with-autopilot",
      title: "全自動模式建議搭配感知",
      rationale: "你開了全自動但關了感知 — 開感知能在「光球以為做完了實際沒效果」時主動 replan。",
      changes: [{ key: "perceptionEnabled", value: true }],
    });
  }

  if (
    (preferences.autoApproveTools as string[] | undefined ?? []).length === 0
    && preferences.confirmationPolicy === "confirm_high_risk"
  ) {
    recs.push({
      id: "seed-auto-approve",
      title: "加入常用低風險工具到自動核准",
      rationale: "research.deepSearch / inspiration.fetch 都是低風險，加入後不會每次都跳確認。",
      changes: [
        {
          key: "autoApproveTools",
          value: ["research.deepSearch", "inspiration.fetch"],
        },
      ],
    });
  }

  if (
    preferences.orbProactiveSuggestions === true
    && preferences.pacingOverride === "impatient"
  ) {
    recs.push({
      id: "match-pacing-with-proactive",
      title: "節奏與主動建議不一致",
      rationale: "想要 impatient 快節奏卻又開了主動建議 — 通常會覺得吵；建議關掉主動建議。",
      changes: [{ key: "orbProactiveSuggestions", value: false }],
    });
  }

  if (
    preferences.onboardingCompletedAt == null
    && preferences.orbShortcutEnabled === false
  ) {
    recs.push({
      id: "enable-shortcut-onboarding",
      title: "新手期建議開啟 Cmd/Ctrl+K 快捷鍵",
      rationale: "尚未完成 onboarding 又關了快捷鍵 — 容易找不到光球；先開啟試試。",
      changes: [{ key: "orbShortcutEnabled", value: true }],
    });
  }

  return { success: true, recommendations: recs };
}
