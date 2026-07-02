/**
 * continueWhereYouLeftOff.ts — AIDV-967「接著上次繼續」引導卡的純邏輯層。
 *
 * 回訪使用者在首頁 hero 下方看到一張可關閉的卡，最多兩個 slot：
 *   ① 新手路徑進度 X/5 → 深連結 /learn?sub=start（AIDV-811 BeginnerPathPanel
 *      的 localStorage key `learn:beginner-path:done`，同 try/catch 私密模式安全）。
 *   ② 最近未完成專案 → /projects/:id。目的地對齊 AIDV-961（#1274）：
 *      ProjectDetailPage 已補上 context-aware「下一步」主按鈕（世界觀→
 *      /worldbuilding、分鏡→/animation、生成→/director），是可續編 surface，
 *      也與 /create ContinueProjectSection 的「繼續這個專案」同目的地。
 *
 * 全空（真新手：無路徑進度、無未完成專案）→ visible=false，元件完全不渲染。
 * 純函式 + 純 localStorage 讀寫，零後端、無 React 依賴，供窮盡單元測試。
 */
import type { Project } from "@/types/projects";

/** AIDV-811 BeginnerPathPanel 的進度 key（唯讀重用，本卡不寫入）。 */
export const BEGINNER_PATH_LS_KEY = "learn:beginner-path:done";
/** 本卡「已關閉、不再重彈」的記憶 key。 */
export const DISMISS_LS_KEY = "home:continue-where-left-off:dismissed";
/** 新手路徑總步數（BeginnerPathPanel STEPS 為 5 步）。 */
export const BEGINNER_PATH_TOTAL = 5;
/** 路徑 slot 深連結（LearnHome TabsContent value="start"）。 */
export const BEGINNER_PATH_HREF = "/learn?sub=start";

/** 讀取新手路徑已完成步數。壞資料／私密模式（getItem 擲例外）一律回 0。 */
export function readBeginnerPathDoneCount(): number {
  try {
    const raw = window.localStorage.getItem(BEGINNER_PATH_LS_KEY);
    if (!raw) return 0;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return 0;
    const ids = new Set(parsed.filter((v): v is string => typeof v === "string"));
    return Math.min(ids.size, BEGINNER_PATH_TOTAL);
  } catch {
    return 0; // 私密模式 / 壞 JSON → 視同無進度，靜默降級
  }
}

/** 是否已被使用者關閉（私密模式安全：讀不到視同未關閉）。 */
export function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_LS_KEY) === "1";
  } catch {
    return false;
  }
}

/** 記住「已關閉」。寫入失敗（私密模式）靜默忽略——本次 session 仍以 state 關閉。 */
export function writeDismissed(): void {
  try {
    window.localStorage.setItem(DISMISS_LS_KEY, "1");
  } catch {
    /* 私密模式忽略 */
  }
}

export interface ResumePathSlot {
  doneCount: number;
  total: number;
  href: string;
}

export interface ResumeProjectSlot {
  id: string;
  title: string;
  nextAction: string;
  href: string;
}

export interface ResumeState {
  /** 新手路徑進度 slot；無進度或已全部完成 → null。 */
  path: ResumePathSlot | null;
  /** 最近未完成專案 slot；無未完成專案 → null。 */
  project: ResumeProjectSlot | null;
  /** 兩個 slot 都空（真新手）→ false，元件完全不渲染。 */
  visible: boolean;
}

/** 未完成 = 草稿或進行中（completed / archived 不算「接著上次」）。 */
function isUnfinished(p: Project): boolean {
  return p.status === "draft" || p.status === "active";
}

/**
 * 由（路徑完成步數, 專案列表）導出引導卡狀態。
 *
 * - 路徑 slot：0 < doneCount < 5 才顯示。0＝沒開始（不是「接著上次」）；
 *   5＝已完成（沒有可接續的下一步）。doneCount 夾在 [0, 5]。
 * - 專案 slot：排除樂觀臨時列（isPending，負數 id 導頁會 404），取
 *   updatedAt 最新的未完成專案。
 */
export function deriveResumeState(
  pathDoneCount: number,
  projects: readonly Project[],
): ResumeState {
  const clamped = Number.isFinite(pathDoneCount)
    ? Math.min(Math.max(Math.floor(pathDoneCount), 0), BEGINNER_PATH_TOTAL)
    : 0;
  const path: ResumePathSlot | null =
    clamped > 0 && clamped < BEGINNER_PATH_TOTAL
      ? { doneCount: clamped, total: BEGINNER_PATH_TOTAL, href: BEGINNER_PATH_HREF }
      : null;

  const latestUnfinished = projects
    .filter(p => !p.isPending && isUnfinished(p))
    .reduce<Project | null>(
      (best, p) => (best === null || p.updatedAt.localeCompare(best.updatedAt) > 0 ? p : best),
      null,
    );
  const project: ResumeProjectSlot | null = latestUnfinished
    ? {
        id: latestUnfinished.id,
        title: latestUnfinished.title,
        nextAction: latestUnfinished.nextAction,
        href: `/projects/${latestUnfinished.id}`,
      }
    : null;

  return { path, project, visible: path !== null || project !== null };
}
