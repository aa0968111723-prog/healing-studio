// ============================================================================
// components/continueResume.ts — 回訪「接著上次」引導卡的純狀態推導（AIDV-967）
// ----------------------------------------------------------------------------
// 依「新手路徑進度（localStorage learn:beginner-path:done）＋既有專案列表
// （ProjectsContext / trpc.creativeProject.list）」推導首頁引導卡該顯示什麼。
// 純函式、零 React 依賴 —— 方便窮盡單元測試；localStorage 讀寫全部 try/catch
// 包覆（私密模式 / quota 安全）。
// ============================================================================
import type { Project } from "@/types/projects";

/** BeginnerPathPanel（AIDV-811）的 5 步 id。該面板未匯出 STEPS，這裡鏡射
 *  id 清單以便把 localStorage 內容換算成「X/5」；若步驟 id 未來變動，測試
 *  只會少算進度（安全降級），不會壞頁。 */
export const BEGINNER_PATH_STEP_IDS = [
  "read-prompt",
  "first-image",
  "refine",
  "animate",
  "voice",
] as const;

export const BEGINNER_PATH_TOTAL = BEGINNER_PATH_STEP_IDS.length;

/** 與 shells/learn/panels/BeginnerPathPanel.tsx 的 LS_KEY 相同。 */
export const BEGINNER_PATH_DONE_KEY = "learn:beginner-path:done";

/** 卡片「不再顯示」的持久化 key（v1；改版想重新曝光時 bump 版號即可）。 */
export const CONTINUE_CARD_DISMISS_KEY = "home:continue-card:dismissed:v1";

export interface ResumePathSlot {
  /** 已完成步數（僅計入已知步驟 id，去重）。 */
  done: number;
  total: number;
}

export interface ResumeProjectSlot {
  id: string;
  title: string;
  nextAction: string;
  progress: number;
}

export interface ResumeState {
  /** false ＝ 真新手（無路徑進度、無可續編專案）→ 完全不渲染。 */
  visible: boolean;
  /** 新手路徑進度 slot；0 步或已全部完成（5/5）都不需要「接著上次」→ null。 */
  path: ResumePathSlot | null;
  /** 最近一個未完成（draft/active、非樂觀 pending 列）的專案；無 → null。 */
  project: ResumeProjectSlot | null;
}

/** 讀 BeginnerPathPanel 存的已完成步驟 id。壞 JSON／非陣列／私密模式 → []。 */
export function readBeginnerPathDoneIds(): string[] {
  try {
    const raw = window.localStorage.getItem(BEGINNER_PATH_DONE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

export function readContinueCardDismissed(): boolean {
  try {
    return window.localStorage.getItem(CONTINUE_CARD_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeContinueCardDismissed(): void {
  try {
    window.localStorage.setItem(CONTINUE_CARD_DISMISS_KEY, "1");
  } catch {
    /* 私密模式 / quota：本次 session 靠 state 隱藏即可 */
  }
}

/** 專案是否「可續編」：draft / active 且非樂觀臨時列（負數 id pending）。
 *  completed / archived 不需要「接著上次」。 */
function isResumable(p: Project): boolean {
  return !p.isPending && (p.status === "draft" || p.status === "active");
}

/**
 * 核心純函式：由「已完成步驟 id ＋ 專案清單」推導引導卡狀態。
 * - 路徑 slot：0 < done < 5 才顯示（0＝沒開始不用接、5＝已完成不用接）。
 * - 專案 slot：可續編專案中取 updatedAt 最新的一個。
 * - 兩者皆無 → visible=false（真新手完全不渲染）。
 * 不改動傳入陣列（filter 產生新陣列後才排序）。
 */
export function deriveResumeState(
  pathDoneIds: readonly string[],
  projects: readonly Project[],
): ResumeState {
  const doneSet = new Set(pathDoneIds);
  const done = BEGINNER_PATH_STEP_IDS.filter((id) => doneSet.has(id)).length;
  const path: ResumePathSlot | null =
    done > 0 && done < BEGINNER_PATH_TOTAL
      ? { done, total: BEGINNER_PATH_TOTAL }
      : null;

  const latest = projects
    .filter(isResumable)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const project: ResumeProjectSlot | null = latest
    ? {
        id: latest.id,
        title: latest.title,
        nextAction: latest.nextAction,
        progress: latest.progress,
      }
    : null;

  return { visible: Boolean(path || project), path, project };
}
