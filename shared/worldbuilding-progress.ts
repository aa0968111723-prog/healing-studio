/**
 * shared/worldbuilding-progress.ts
 *
 * 動態計算世界觀的完成度。純函式，無 I/O 也無 DOM，伺服端與前端都可呼叫。
 *
 * 設計理念：
 *   - 「存在 = 100%」是錯的：使用者剛建立空白角色卡時不該被視為完成。
 *   - 每個類別有「資料豐富度」分數，依重點欄位是否填寫加權平均。
 *   - 整體完成度 = Σ(category.percent × category.weight) / Σ(weight)。
 *   - 同時回傳每個類別的子項目進度、缺失欄位與狀態，給 UI 直接顯示。
 *
 * 權重（合計 = 1.0）：
 *   - characters: 0.30
 *   - scenes:     0.30
 *   - style:      0.20
 *   - music:      0.10
 *   - voice:      0.10
 */

import type {
  WorldbuildingFrameworkData,
  WorldCharacter,
  WorldScene,
  WorldStyleProfile,
  WorldMusicTheme,
} from "./worldbuilding-types";

// ─── 公開型別 ───────────────────────────────────────────────────────────────

export type WorldProgressCategoryKey =
  | "characters"
  | "scenes"
  | "style"
  | "music"
  | "voice";

export type WorldProgressItemStatus = "empty" | "partial" | "complete";

/** 單一子項目的完成情況（用於 UI 細節顯示） */
export type WorldProgressSubItem = {
  key: string;
  label: string;
  done: boolean;
  /** 若該子項目尚未填寫且會影響生成品質，給使用者看的提示。 */
  warning?: string;
};

export type WorldProgressCategory = {
  key: WorldProgressCategoryKey;
  label: string;
  /** 此類別在整體中的權重（0-1） */
  weight: number;
  /** 此類別當前完成度（0-100） */
  percent: number;
  /** 完成的子項目數 */
  completedItems: number;
  /** 子項目總數 */
  totalItems: number;
  /** 三態狀態：完全空 / 部分填寫 / 全部完成 */
  status: WorldProgressItemStatus;
  /** 子項目細節，給 UI 列出已完成 / 待辦清單 */
  subItems: WorldProgressSubItem[];
  /** 此類別下實際被計入的「個體數」（例如有 3 個角色） */
  count: number;
  /** 若此類別空白或缺漏，給使用者的整體提示。 */
  warning?: string;
};

export type WorldProgressResult = {
  /** 總體完成度（0-100） */
  overall: number;
  /** 各類別細節 */
  categories: Record<WorldProgressCategoryKey, WorldProgressCategory>;
  /** UI 用：完成的總子項目數 */
  completedCount: number;
  /** UI 用：子項目總數 */
  totalCount: number;
  /** 整體狀態 */
  status: WorldProgressItemStatus;
  /** 影響生成品質的高優先級警告（給 ScriptEditor 的智能提醒用） */
  blockingWarnings: string[];
};

// ─── 權重表 ────────────────────────────────────────────────────────────────

export const CATEGORY_WEIGHTS: Record<WorldProgressCategoryKey, number> = {
  characters: 0.3,
  scenes: 0.3,
  style: 0.2,
  music: 0.1,
  voice: 0.1,
};

export const CATEGORY_LABELS: Record<WorldProgressCategoryKey, string> = {
  characters: "角色",
  scenes: "場景",
  style: "風格設定",
  music: "配樂主題",
  voice: "配音",
};

// ─── 內部 helpers ──────────────────────────────────────────────────────────

const hasText = (s: string | undefined | null): boolean =>
  !!s && s.trim().length > 0;

const hasArray = (a: readonly unknown[] | undefined | null): boolean =>
  !!a && a.length > 0;

const isCharacterRich = (c: WorldCharacter): WorldProgressSubItem[] => {
  const threeView = c.threeViewSheet;
  const hasThreeView = !!(
    threeView?.frontImageUrl ||
    threeView?.sideImageUrl ||
    threeView?.backImageUrl ||
    threeView?.threeQuarterImageUrl
  );
  return [
    {
      key: "appearance",
      label: "外觀描述",
      done: hasText(c.appearance) || hasText(c.outfit),
      warning: hasText(c.appearance) ? undefined : "尚缺角色外觀，可能導致生成錯誤",
    },
    {
      key: "personality",
      label: "性格 / 設定",
      done: hasText(c.personality) || hasText(c.backstory),
    },
    {
      key: "threeView",
      label: "三視圖",
      done: hasThreeView,
      warning: hasThreeView ? undefined : "缺三視圖，AI 生圖一致性會下降",
    },
    {
      key: "expressions",
      label: "表情包",
      done: hasArray(c.expressions),
    },
    {
      key: "outfits",
      label: "穿衣集",
      done: hasArray(c.outfits),
    },
  ];
};

const isSceneRich = (s: WorldScene): WorldProgressSubItem[] => {
  return [
    {
      key: "environment",
      label: "場景說明",
      done: hasText(s.environment) || hasText(s.tagline),
      warning:
        hasText(s.environment) || hasText(s.tagline)
          ? undefined
          : "尚缺場景說明，AI 無法穩定取景",
    },
    {
      key: "establishingShot",
      label: "場景參考圖",
      done: hasText(s.establishingShotUrl),
    },
    {
      key: "mood",
      label: "氛圍 / 光線",
      done: hasText(s.mood) || hasText(s.lighting),
    },
  ];
};

const isStyleRich = (p: WorldStyleProfile): WorldProgressSubItem[] => {
  return [
    { key: "artStyle", label: "繪風", done: hasText(p.artStyle) },
    { key: "palette", label: "色票", done: hasArray(p.palette) },
    {
      key: "lighting",
      label: "燈光",
      done: hasText(p.lighting),
    },
  ];
};

const isMusicRich = (m: WorldMusicTheme): WorldProgressSubItem[] => {
  return [
    { key: "mood", label: "情緒", done: hasText(m.mood) },
    { key: "instruments", label: "樂器", done: hasArray(m.instruments) },
  ];
};

/**
 * 給定一組「子項目布林狀態」，回傳 (完成數, 總數, 0-100 百分比, 狀態)。
 * 全部空 → 0%；全部完成 → 100%；其他 → 部分完成。
 */
function tally(items: WorldProgressSubItem[]): {
  completed: number;
  total: number;
  percent: number;
  status: WorldProgressItemStatus;
} {
  const total = items.length;
  if (total === 0) {
    return { completed: 0, total: 0, percent: 0, status: "empty" };
  }
  const completed = items.filter(i => i.done).length;
  const percent = Math.round((completed / total) * 100);
  const status: WorldProgressItemStatus =
    completed === 0 ? "empty" : completed === total ? "complete" : "partial";
  return { completed, total, percent, status };
}

// ─── 各類別計算 ────────────────────────────────────────────────────────────

function computeCharacterCategory(
  characters: WorldCharacter[] | undefined
): WorldProgressCategory {
  const list = characters ?? [];
  // 沒有任何角色時，整個類別空。
  if (list.length === 0) {
    return {
      key: "characters",
      label: CATEGORY_LABELS.characters,
      weight: CATEGORY_WEIGHTS.characters,
      percent: 0,
      completedItems: 0,
      totalItems: 5,
      status: "empty",
      count: 0,
      subItems: [
        { key: "any", label: "尚未建立任何角色", done: false },
        { key: "appearance", label: "外觀描述", done: false },
        { key: "personality", label: "性格 / 設定", done: false },
        { key: "threeView", label: "三視圖", done: false },
        { key: "expressions", label: "表情包", done: false },
      ],
      warning: "尚未建立任何角色，AI 無法生成符合世界觀的人物",
    };
  }

  // 平均所有角色的「豐富度」當作此類別分數。
  const perCharSummaries = list.map(c => {
    const items = isCharacterRich(c);
    return tally(items);
  });
  const avgPercent =
    perCharSummaries.reduce((sum, s) => sum + s.percent, 0) /
    perCharSummaries.length;

  // 子項目顯示：跨角色 ANY 命中即視為完成（讓使用者一眼看到「至少一個角色有三視圖」）
  const aggregated = ["appearance", "personality", "threeView", "expressions", "outfits"].map(
    key => {
      const labelMap: Record<string, string> = {
        appearance: "外觀描述",
        personality: "性格 / 設定",
        threeView: "三視圖",
        expressions: "表情包",
        outfits: "穿衣集",
      };
      const someoneDone = list.some(c => {
        const items = isCharacterRich(c);
        return items.find(i => i.key === key)?.done ?? false;
      });
      const warningMap: Record<string, string> = {
        appearance: "尚缺角色外觀，可能導致生成錯誤",
        threeView: "缺三視圖，AI 生圖一致性會下降",
      };
      return {
        key,
        label: labelMap[key] ?? key,
        done: someoneDone,
        warning: someoneDone ? undefined : warningMap[key],
      };
    }
  );

  const summary = tally(aggregated);
  const percent = Math.round(avgPercent);
  return {
    key: "characters",
    label: CATEGORY_LABELS.characters,
    weight: CATEGORY_WEIGHTS.characters,
    percent,
    completedItems: summary.completed,
    totalItems: summary.total,
    status:
      percent === 0 ? "empty" : percent >= 100 ? "complete" : "partial",
    count: list.length,
    subItems: aggregated,
    warning:
      percent < 50
        ? "角色資訊偏少，建議補齊外觀與三視圖以提高一致性"
        : undefined,
  };
}

function computeSceneCategory(
  scenes: WorldScene[] | undefined
): WorldProgressCategory {
  const list = scenes ?? [];
  if (list.length === 0) {
    return {
      key: "scenes",
      label: CATEGORY_LABELS.scenes,
      weight: CATEGORY_WEIGHTS.scenes,
      percent: 0,
      completedItems: 0,
      totalItems: 3,
      status: "empty",
      count: 0,
      subItems: [
        { key: "any", label: "尚未建立任何場景", done: false },
        { key: "environment", label: "場景說明", done: false },
        { key: "establishingShot", label: "場景參考圖", done: false },
      ],
      warning: "尚未建立任何場景，AI 無法穩定生成背景",
    };
  }
  const perSceneSummaries = list.map(s => tally(isSceneRich(s)));
  const avgPercent =
    perSceneSummaries.reduce((sum, s) => sum + s.percent, 0) /
    perSceneSummaries.length;
  const aggregated = ["environment", "establishingShot", "mood"].map(key => {
    const labelMap: Record<string, string> = {
      environment: "場景說明",
      establishingShot: "場景參考圖",
      mood: "氛圍 / 光線",
    };
    const someoneDone = list.some(
      s => isSceneRich(s).find(i => i.key === key)?.done ?? false
    );
    const warningMap: Record<string, string> = {
      environment: "尚缺場景說明，AI 無法穩定取景",
    };
    return {
      key,
      label: labelMap[key] ?? key,
      done: someoneDone,
      warning: someoneDone ? undefined : warningMap[key],
    };
  });
  const summary = tally(aggregated);
  const percent = Math.round(avgPercent);
  return {
    key: "scenes",
    label: CATEGORY_LABELS.scenes,
    weight: CATEGORY_WEIGHTS.scenes,
    percent,
    completedItems: summary.completed,
    totalItems: summary.total,
    status:
      percent === 0 ? "empty" : percent >= 100 ? "complete" : "partial",
    count: list.length,
    subItems: aggregated,
    warning:
      percent < 50
        ? "場景資訊偏少，建議補上場景照片與氛圍敘述"
        : undefined,
  };
}

function computeStyleCategory(
  styles: WorldStyleProfile[] | undefined
): WorldProgressCategory {
  const list = styles ?? [];
  if (list.length === 0) {
    return {
      key: "style",
      label: CATEGORY_LABELS.style,
      weight: CATEGORY_WEIGHTS.style,
      percent: 0,
      completedItems: 0,
      totalItems: 3,
      status: "empty",
      count: 0,
      subItems: [
        { key: "any", label: "尚未設定畫面風格", done: false },
        { key: "artStyle", label: "繪風", done: false },
        { key: "palette", label: "色票", done: false },
      ],
      warning: "尚未設定畫面風格，生成結果可能風格不一致",
    };
  }
  const perStyleSummaries = list.map(s => tally(isStyleRich(s)));
  const avgPercent =
    perStyleSummaries.reduce((sum, s) => sum + s.percent, 0) /
    perStyleSummaries.length;
  const aggregated = ["artStyle", "palette", "lighting"].map(key => {
    const labelMap: Record<string, string> = {
      artStyle: "繪風",
      palette: "色票",
      lighting: "燈光",
    };
    const done = list.some(
      s => isStyleRich(s).find(i => i.key === key)?.done ?? false
    );
    return { key, label: labelMap[key] ?? key, done };
  });
  const summary = tally(aggregated);
  const percent = Math.round(avgPercent);
  return {
    key: "style",
    label: CATEGORY_LABELS.style,
    weight: CATEGORY_WEIGHTS.style,
    percent,
    completedItems: summary.completed,
    totalItems: summary.total,
    status:
      percent === 0 ? "empty" : percent >= 100 ? "complete" : "partial",
    count: list.length,
    subItems: aggregated,
  };
}

function computeMusicCategory(
  themes: WorldMusicTheme[] | undefined
): WorldProgressCategory {
  const list = themes ?? [];
  if (list.length === 0) {
    return {
      key: "music",
      label: CATEGORY_LABELS.music,
      weight: CATEGORY_WEIGHTS.music,
      percent: 0,
      completedItems: 0,
      totalItems: 2,
      status: "empty",
      count: 0,
      subItems: [
        { key: "any", label: "尚未設定配樂主題", done: false },
        { key: "mood", label: "情緒 / 樂器", done: false },
      ],
    };
  }
  const perThemeSummaries = list.map(t => tally(isMusicRich(t)));
  const avgPercent =
    perThemeSummaries.reduce((sum, s) => sum + s.percent, 0) /
    perThemeSummaries.length;
  const aggregated = ["mood", "instruments"].map(key => {
    const labelMap: Record<string, string> = {
      mood: "情緒",
      instruments: "樂器",
    };
    const done = list.some(
      t => isMusicRich(t).find(i => i.key === key)?.done ?? false
    );
    return { key, label: labelMap[key] ?? key, done };
  });
  const summary = tally(aggregated);
  const percent = Math.round(avgPercent);
  return {
    key: "music",
    label: CATEGORY_LABELS.music,
    weight: CATEGORY_WEIGHTS.music,
    percent,
    completedItems: summary.completed,
    totalItems: summary.total,
    status:
      percent === 0 ? "empty" : percent >= 100 ? "complete" : "partial",
    count: list.length,
    subItems: aggregated,
  };
}

function computeVoiceCategory(
  characters: WorldCharacter[] | undefined
): WorldProgressCategory {
  const list = characters ?? [];
  const withVoice = list.filter(
    c => c.voiceProfile?.voiceId || c.voiceProfile?.engine
  );
  // 沒有角色 → 配音也視為空。
  if (list.length === 0) {
    return {
      key: "voice",
      label: CATEGORY_LABELS.voice,
      weight: CATEGORY_WEIGHTS.voice,
      percent: 0,
      completedItems: 0,
      totalItems: 2,
      status: "empty",
      count: 0,
      subItems: [
        { key: "any", label: "尚未建立角色 → 無法配音", done: false },
        { key: "engine", label: "配音引擎", done: false },
      ],
    };
  }
  const subItems: WorldProgressSubItem[] = [
    {
      key: "anyVoice",
      label: "至少一個角色有語音",
      done: withVoice.length > 0,
      warning:
        withVoice.length === 0
          ? "未指定任何配音引擎，將無法生成對白音檔"
          : undefined,
    },
    {
      key: "allVoiced",
      label: "全部角色都有配音",
      done: withVoice.length === list.length,
    },
  ];
  const summary = tally(subItems);
  // 配音的百分比就是「有配音的角色比例」
  const percent = Math.round((withVoice.length / list.length) * 100);
  return {
    key: "voice",
    label: CATEGORY_LABELS.voice,
    weight: CATEGORY_WEIGHTS.voice,
    percent,
    completedItems: summary.completed,
    totalItems: summary.total,
    status:
      percent === 0 ? "empty" : percent >= 100 ? "complete" : "partial",
    count: withVoice.length,
    subItems,
    warning:
      percent < 50 && list.length > 0
        ? `${list.length - withVoice.length} 個角色尚未指定配音`
        : undefined,
  };
}

// ─── 公開 API ──────────────────────────────────────────────────────────────

/**
 * 動態計算世界觀的完成度。回傳整體百分比 + 各類別細節。
 *
 * 若僅有部分欄位資料（例如 framework partial），未提供的類別會視為 empty。
 */
export function calculateWorldbuildingProgress(
  world: Partial<WorldbuildingFrameworkData> | null | undefined
): WorldProgressResult {
  const characters = computeCharacterCategory(world?.characters);
  const scenes = computeSceneCategory(world?.scenes);
  const style = computeStyleCategory(world?.styleProfiles);
  const music = computeMusicCategory(world?.musicThemes);
  const voice = computeVoiceCategory(world?.characters);

  const categories: Record<WorldProgressCategoryKey, WorldProgressCategory> = {
    characters,
    scenes,
    style,
    music,
    voice,
  };

  // 加權平均（權重已標準化為 sum = 1.0）
  const weightedSum =
    characters.percent * characters.weight +
    scenes.percent * scenes.weight +
    style.percent * style.weight +
    music.percent * music.weight +
    voice.percent * voice.weight;
  const overall = Math.round(weightedSum);

  const blockingWarnings: string[] = [];
  for (const cat of Object.values(categories)) {
    if (cat.warning) blockingWarnings.push(`【${cat.label}】${cat.warning}`);
    for (const sub of cat.subItems) {
      if (!sub.done && sub.warning) {
        blockingWarnings.push(`【${cat.label} · ${sub.label}】${sub.warning}`);
      }
    }
  }

  const completedCount = Object.values(categories).reduce(
    (n, c) => n + c.completedItems,
    0
  );
  const totalCount = Object.values(categories).reduce(
    (n, c) => n + c.totalItems,
    0
  );

  const status: WorldProgressItemStatus =
    overall === 0 ? "empty" : overall >= 100 ? "complete" : "partial";

  return {
    overall,
    categories,
    completedCount,
    totalCount,
    status,
    blockingWarnings,
  };
}
