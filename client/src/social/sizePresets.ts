// ============================================================================
// social/sizePresets.ts — 多尺寸匯出預設集（master → variants）
// ----------------------------------------------------------------------------
// 設計依據：AI-Director_社群圖文系統設計.md §3.4「多尺寸匯出預設（master → variants）」。
// 一次設計、一次匯出全平台：一張 master 合成 → 依預設集 re-frame/re-layout → 每尺寸一份資產。
//
// 與架構一致：架構 §2② 的基本三比例（1:1 / 9:16 / 16:9）是本集的「子集」；本集為其
// 「超集擴充」（加 4:5、海報 A 系列、LINE/小紅書），不牴觸（設計 §3.4）。
//
// 重構規則（不只縮放）：每個預設帶 reframe 策略（直式 vs 橫式標題位移、焦點裁切）。
// 比例變化大時（1:1↔9:16）由 composeLayout 依 orientation「重排版面」而非粗暴拉伸。
//
// 純資料 + 純函式，無任何執行期副作用；前後端皆可 import（被 composeLayout / 匯出格使用）。
// ============================================================================

/** 平台分組（UI 分頁與「一鍵匯出該組」用）。 */
export type PresetGroup = "social" | "story" | "messaging" | "print";

/** 版面方向（composeLayout 依此切換插槽排版）。 */
export type Orientation = "square" | "portrait" | "landscape";

/** 重構策略：縮放底圖時如何保住主體與安全區。 */
export type ReframeStrategy =
  | "cover-center" // 置中填滿（方形/接近方形）
  | "cover-subject" // 依主體偵測裁切（Gemini 感知，§4.1；mock 退回 center）
  | "fit-letterbox"; // 不裁切、留邊（印刷海報保完整版面）

export interface SizePreset {
  /** 穩定 ID（匯出資產的 ratioPreset 欄位、行事曆與貼文都引用它）。 */
  id: string;
  /** 平台／用途中文標籤。 */
  platform: string;
  /** 分組。 */
  group: PresetGroup;
  /** 比例顯示字串（UI 標籤）。 */
  ratioLabel: string;
  /** 像素寬高（印刷預設為 @dpi 換算後的像素）。 */
  width: number;
  height: number;
  /** 印刷預設標 dpi（螢幕預設為 72，不影響輸出像素）。 */
  dpi: number;
  /** 版面方向（composeLayout 排版分支）。 */
  orientation: Orientation;
  /** 重構策略。 */
  reframe: ReframeStrategy;
  /** 是否為印刷（影響匯出格式建議 PNG→PDF/300dpi）。 */
  print?: boolean;
}

const mm = (millimeters: number, dpi: number) => Math.round((millimeters / 25.4) * dpi);
const orient = (w: number, h: number): Orientation =>
  w === h ? "square" : w > h ? "landscape" : "portrait";

/**
 * 全平台尺寸預設（設計 §3.4 表）。涵蓋 Bruce 指定的 IG／FB／限動／X／海報／LINE，
 * 並含設計超集（4:5、小紅書、海報 A 系列）。
 */
export const SIZE_PRESETS: SizePreset[] = [
  // ── social 動態 ───────────────────────────────────────────────────────────
  { id: "ig_square", platform: "IG 貼文", group: "social", ratioLabel: "1:1", width: 1080, height: 1080, dpi: 72, orientation: "square", reframe: "cover-center" },
  { id: "ig_portrait", platform: "IG 貼文（直）", group: "social", ratioLabel: "4:5", width: 1080, height: 1350, dpi: 72, orientation: "portrait", reframe: "cover-subject" },
  { id: "fb_feed", platform: "FB 連結卡", group: "social", ratioLabel: "1.91:1", width: 1200, height: 630, dpi: 72, orientation: "landscape", reframe: "cover-subject" },
  { id: "x_card", platform: "X / Twitter", group: "social", ratioLabel: "16:9", width: 1600, height: 900, dpi: 72, orientation: "landscape", reframe: "cover-subject" },
  { id: "xhs_portrait", platform: "小紅書", group: "social", ratioLabel: "3:4", width: 1080, height: 1440, dpi: 72, orientation: "portrait", reframe: "cover-subject" },

  // ── story / reels 全螢幕直式 ────────────────────────────────────────────────
  { id: "ig_story", platform: "限動 Story", group: "story", ratioLabel: "9:16", width: 1080, height: 1920, dpi: 72, orientation: "portrait", reframe: "cover-subject" },
  { id: "reels_cover", platform: "Reels 封面", group: "story", ratioLabel: "9:16", width: 1080, height: 1920, dpi: 72, orientation: "portrait", reframe: "cover-subject" },

  // ── messaging ──────────────────────────────────────────────────────────────
  { id: "line_card", platform: "LINE 宣傳", group: "messaging", ratioLabel: "1:1", width: 1040, height: 1040, dpi: 72, orientation: "square", reframe: "cover-center" },

  // ── print 印刷海報（A 系列 @300dpi）─────────────────────────────────────────
  { id: "poster_a4", platform: "海報 A4", group: "print", ratioLabel: "√2:1", width: mm(210, 300), height: mm(297, 300), dpi: 300, orientation: "portrait", reframe: "fit-letterbox", print: true },
  { id: "poster_a3", platform: "海報 A3", group: "print", ratioLabel: "√2:1", width: mm(297, 300), height: mm(420, 300), dpi: 300, orientation: "portrait", reframe: "fit-letterbox", print: true },
  { id: "poster_a2", platform: "海報 A2", group: "print", ratioLabel: "√2:1", width: mm(420, 300), height: mm(594, 300), dpi: 300, orientation: "portrait", reframe: "fit-letterbox", print: true },
];

/** Bruce 指定的「核心匯出包」（一鍵全出時的預設勾選集）：IG／FB／限動／X／海報／LINE。 */
export const DEFAULT_EXPORT_BUNDLE: string[] = [
  "ig_square",
  "ig_portrait",
  "ig_story",
  "fb_feed",
  "x_card",
  "line_card",
  "poster_a4",
];

/** 分組中文標籤（UI 分頁）。 */
export const GROUP_LABEL: Record<PresetGroup, string> = {
  social: "社群動態",
  story: "限動 / 封面",
  messaging: "通訊軟體",
  print: "印刷海報",
};

const PRESET_BY_ID: Record<string, SizePreset> = Object.fromEntries(
  SIZE_PRESETS.map((p) => [p.id, p]),
);

/** 依 ID 取預設（找不到回 undefined）。 */
export function getPreset(id: string): SizePreset | undefined {
  return PRESET_BY_ID[id];
}

/** 依分組取預設清單（UI 分頁渲染）。 */
export function presetsByGroup(group: PresetGroup): SizePreset[] {
  return SIZE_PRESETS.filter((p) => p.group === group);
}

/** 數值比例（width/height），給縮圖容器 aspect-ratio 用。 */
export function aspectRatio(p: SizePreset): number {
  return p.width / p.height;
}

/** 確保 orient 與 width/height 一致（自我驗證，給測試用）。 */
export function presetOrientationConsistent(p: SizePreset): boolean {
  return p.orientation === orient(p.width, p.height);
}
