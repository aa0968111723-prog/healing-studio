/**
 * studioHandoff.ts — 跨頁面 handoff（DirectorAI → ImageStudio/VideoStudio…）
 * ────────────────────────────────────────────────────────────────────────────
 * 設計：用 sessionStorage 一次性傳遞 payload，目標頁面 mount 時讀取後立刻
 *      清除。這比全域 store 更穩定（重整不會洩漏舊資料），也避免引入新依賴。
 *
 * 流程：
 *   1. 來源頁（例如 DirectorAI 段落卡片）呼叫 `sendStudioHandoff({...})`
 *      塞入 sessionStorage 並 navigate('/image-studio')
 *   2. 目標頁（例如 ImageStudio）在 mount 時呼叫 `consumeStudioHandoff()`
 *      取得 payload；若不為 null，就把 prompt 等內容 apply 到狀態
 *   3. consume 後 sessionStorage 自動清空，避免下次進入頁面又被觸發
 */

const STORAGE_KEY = "healing-studio.studio-handoff";

export type StudioHandoffTarget =
  | "image-studio"
  | "video-studio"
  | "pro-studio"
  | "animation-studio";

export interface StudioHandoffPayload {
  /** 目標 Studio 頁面 */
  target: StudioHandoffTarget;
  /** 預填的提示詞內容（必要） */
  prompt: string;
  /** 來源頁面識別（給目標頁顯示「來自 ...」） */
  sourcePage?: string;
  /** 來源段落 id（例如 director session 的 segment index） */
  sourceSegmentId?: string;
  /** 預期的世界觀框架 id（提示用戶切換到對應專案） */
  worldFrameworkId?: number;
  /** 預期的創作專案 id（提示用戶切換到對應專案） */
  creativeProjectId?: number;
  /** 其他要傳遞的鍵值（讓目標頁自行解讀） */
  extras?: Record<string, unknown>;
  /** 寫入時的時間戳記，目標頁可用來檢查過期（>5 分鐘的 payload 直接丟棄） */
  timestamp: number;
}

export interface SendStudioHandoffInput
  extends Omit<StudioHandoffPayload, "timestamp"> {}

const MAX_AGE_MS = 5 * 60_000;

/**
 * 由來源頁呼叫：寫入 handoff payload。回傳目標頁面的 URL path，方便來源頁
 * 用 useLocation()/Link 立即 navigate。
 */
export function sendStudioHandoff(input: SendStudioHandoffInput): string {
  if (typeof window === "undefined") {
    return `/${input.target}`;
  }
  const payload: StudioHandoffPayload = {
    ...input,
    timestamp: Date.now(),
  };
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore quota issues — handoff is "best effort"
  }
  return targetToPath(input.target);
}

/**
 * 由目標頁面 mount 時呼叫：取得 payload 並立即清除。回 null 表示沒有
 * 待處理的 handoff（一般 navigation）。
 */
export function consumeStudioHandoff(
  expectedTarget?: StudioHandoffTarget
): StudioHandoffPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StudioHandoffPayload;

    // 過期 payload 直接丟棄
    if (
      typeof parsed.timestamp !== "number" ||
      Date.now() - parsed.timestamp > MAX_AGE_MS
    ) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }

    // 目標不符（例如用戶手動 navigate 到其他頁面），保留 payload 給對的頁面
    if (expectedTarget && parsed.target !== expectedTarget) {
      return null;
    }

    window.sessionStorage.removeItem(STORAGE_KEY);
    return parsed;
  } catch {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    return null;
  }
}

/** 預覽當前 pending payload（不清除）— 給來源頁防止重複塞入用 */
export function peekStudioHandoff(): StudioHandoffPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StudioHandoffPayload) : null;
  } catch {
    return null;
  }
}

export function clearStudioHandoff() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function targetToPath(target: StudioHandoffTarget): string {
  switch (target) {
    case "image-studio":
      return "/image-studio";
    case "video-studio":
      return "/video-studio";
    case "pro-studio":
      return "/pro-studio";
    case "animation-studio":
      return "/animation";
  }
}
