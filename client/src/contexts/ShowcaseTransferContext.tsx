/**
 * ShowcaseTransferContext.tsx — Showcase → Studio 完全解構 JSON 傳遞
 *
 * 當使用者在首頁點擊 Showcase 卡片時：
 *   1. 水波紋動畫啟動
 *   2. 背景 prefetch 該作品的完整解構資料（getById LOD Level 2）
 *   3. 資料就緒後存入此 Context
 *   4. navigate('/studio') 後，Studio 從 Context 讀取並 100% 還原開局
 *
 * 使用 sessionStorage 作為備援，確保頁面重整也不遺失。
 */

import {
  createContext,
  useContext,
  useCallback,
  useState,
  type ReactNode,
} from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DeconstructedBlocks {
  modality: "image" | "video" | "audio" | "voice";
  vibeCards: string[];
  selectedBlocks: Array<{
    category: string;
    blockId: string;
    label: string;
    prompt: string;
  }>;
  customBlockIds: number[];
  freeformPrompt: string;
  negativePrompt: string;
  compiledPrompt: string;
  parameters: Record<string, unknown>;
}

export interface VibeParameters {
  warmth: number;
  energy: number;
  mystery: number;
  serenity: number;
  whimsy: number;
  intensity: number;
  dominantMood: string;
}

export interface ShowcaseTransferPayload {
  /** 展示作品 ID */
  showcaseId: number;
  /** 關聯的生成歷史紀錄 ID */
  generatedItemId: number | null;
  /** 作品標題 */
  title: string;
  /** 完全解構積木 JSON 組合 */
  deconstructedBlocks: DeconstructedBlocks | null;
  /** 情緒矩陣 */
  vibeParameters: VibeParameters | null;
  /** 原始提示詞 */
  originalPrompt: string | null;
  /** 作品圖片 URL（用於 style reference） */
  imageUrl: string;
  /** 作品模態 */
  modality: "image" | "video" | "audio" | "voice";
}

interface ShowcaseTransferContextValue {
  /** 當前待傳遞的 payload（null 表示無待傳遞資料） */
  payload: ShowcaseTransferPayload | null;
  /** 設定 payload（由 ShowcaseMasonry 在水波紋期間呼叫） */
  setPayload: (payload: ShowcaseTransferPayload) => void;
  /** 消費 payload（由 Studio 讀取後呼叫，清空 Context） */
  consumePayload: () => ShowcaseTransferPayload | null;
  /** 是否正在載入中 */
  isLoading: boolean;
  /** 設定載入狀態 */
  setIsLoading: (loading: boolean) => void;
}

// ─── Storage key ────────────────────────────────────────────────────────────

const STORAGE_KEY = "showcase-transfer-payload";

// ─── Context ────────────────────────────────────────────────────────────────

const ShowcaseTransferContext = createContext<ShowcaseTransferContextValue | null>(null);

// ─── Provider ───────────────────────────────────────────────────────────────

export function ShowcaseTransferProvider({ children }: { children: ReactNode }) {
  const [payload, setPayloadState] = useState<ShowcaseTransferPayload | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const setPayload = useCallback((p: ShowcaseTransferPayload) => {
    setPayloadState(p);
    // Backup to sessionStorage for page refresh resilience
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    } catch {
      // sessionStorage full or unavailable — Context still works
    }
  }, []);

  const consumePayload = useCallback((): ShowcaseTransferPayload | null => {
    // Try Context first
    if (payload) {
      setPayloadState(null);
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch { /* ignore */ }
      return payload;
    }

    // Fallback: try sessionStorage
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        sessionStorage.removeItem(STORAGE_KEY);
        return JSON.parse(stored) as ShowcaseTransferPayload;
      }
    } catch { /* ignore */ }

    return null;
  }, [payload]);

  return (
    <ShowcaseTransferContext.Provider
      value={{ payload, setPayload, consumePayload, isLoading, setIsLoading }}
    >
      {children}
    </ShowcaseTransferContext.Provider>
  );
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useShowcaseTransfer() {
  const ctx = useContext(ShowcaseTransferContext);
  if (!ctx) {
    throw new Error("useShowcaseTransfer must be used within ShowcaseTransferProvider");
  }
  return ctx;
}
