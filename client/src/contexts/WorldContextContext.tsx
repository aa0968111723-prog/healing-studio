/**
 * WorldContextContext.tsx — 全站世界觀上下文
 * ────────────────────────────────────────────────────────────────────────────
 * 讓所有 Studio 頁面（Image / Video / Pro）與全站光球都能知道使用者目前
 * 正在哪個「創作專案」與「世界觀框架」中工作，並提供：
 *
 *   1. `currentProjectId` / `currentProject` — 當前選定的創作專案
 *   2. `worldFramework` — 從專案連結的 worldbuildingFrameworks 拉回的完整資料
 *   3. `consistencyPrefix` — 用 `worldbuilding.summarizeForPrompt` 取得的
 *      LLM 友善壓縮摘要，可直接前綴到提示詞
 *   4. `injectIntoPrompt(prompt)` — 若有世界觀，自動把一致性前綴接在最前面
 *
 * 設計原則：
 *   - 預設「停用」狀態（currentProjectId = null），各 Studio 行為與現在相同
 *   - 選定專案後存進 localStorage，重新整理頁面也能恢復
 *   - 不依賴任何 Provider 必須掛載；缺少時 fallback 為 noop
 *   - 不主動加值，等頁面實際呼叫 setCurrentProjectId 才開始抓資料
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { trpc } from "@/lib/trpc";

const LOCAL_STORAGE_KEY = "healing-studio.current-project-id";

export interface WorldContextValue {
  /** 當前選定的創作專案 id（null = 未選定，世界觀注入停用） */
  currentProjectId: number | null;

  /** 切換到不同的創作專案；傳 null 則停用世界觀注入 */
  setCurrentProjectId: (id: number | null) => void;

  /** 當前專案資料（從 server 取） */
  currentProject:
    | {
        id: number;
        title: string;
        directorSessionId: number | null;
        worldFrameworkId: number | null;
        worldStoryboardId: number | null;
        worldFrameworkName: string | null;
        status: "concept" | "production" | "review" | "complete";
      }
    | null;

  /** 連結的世界觀框架 id（從 currentProject 推得，方便其他 hook 用） */
  worldFrameworkId: number | null;

  /** 世界觀框架的 LLM 友善壓縮摘要（自動快取） */
  consistencyPrefix: string;

  /** 全域 negative prompt（image / video 生成可直接附加） */
  globalNegativePrompt: string;

  /** 把世界觀一致性前綴注入用戶提示詞 */
  injectIntoPrompt: (userPrompt: string) => string;

  /** 是否正在從 server 抓專案/世界觀資料 */
  isLoading: boolean;

  /** 是否啟用注入（有專案 + 有世界觀 + 摘要已抓回） */
  isActive: boolean;
}

const noopWorldContext: WorldContextValue = {
  currentProjectId: null,
  setCurrentProjectId: () => {},
  currentProject: null,
  worldFrameworkId: null,
  consistencyPrefix: "",
  globalNegativePrompt: "",
  injectIntoPrompt: prompt => prompt,
  isLoading: false,
  isActive: false,
};

const WorldContext = createContext<WorldContextValue>(noopWorldContext);

function readStoredProjectId(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredProjectId(id: number | null) {
  if (typeof window === "undefined") return;
  try {
    if (id === null) {
      window.localStorage.removeItem(LOCAL_STORAGE_KEY);
    } else {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, String(id));
    }
  } catch {
    // ignore quota / privacy mode
  }
}

export function WorldContextProvider({ children }: { children: ReactNode }) {
  const [currentProjectId, setCurrentProjectIdState] = useState<number | null>(
    () => readStoredProjectId()
  );

  const setCurrentProjectId = (id: number | null) => {
    setCurrentProjectIdState(id);
    writeStoredProjectId(id);
  };

  // 取得當前專案（含 worldFrameworkName 快捷欄位）
  const projectQuery = trpc.creativeProject.get.useQuery(
    { id: currentProjectId ?? 0 },
    {
      enabled: currentProjectId !== null,
      staleTime: 30_000,
    }
  );

  // 自動失效：若 server 端找不到（404）就清掉本地選擇，避免卡死
  useEffect(() => {
    if (
      currentProjectId !== null &&
      projectQuery.error &&
      projectQuery.error.data?.code === "NOT_FOUND"
    ) {
      setCurrentProjectId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectQuery.error, currentProjectId]);

  const worldFrameworkId = projectQuery.data?.worldFrameworkId ?? null;

  // 取得世界觀框架的 LLM 友善摘要
  const summaryQuery = trpc.worldbuilding.summarizeForPrompt.useQuery(
    { id: worldFrameworkId ?? 0 },
    {
      enabled: worldFrameworkId !== null,
      staleTime: 5 * 60_000,
    }
  );

  const consistencyPrefix = useMemo(() => {
    const raw = summaryQuery.data;
    return typeof raw?.summary === "string" ? raw.summary : "";
  }, [summaryQuery.data]);

  /** 全域 negative prompt（給 image / video 生成用） */
  const globalNegativePrompt = useMemo(() => {
    const raw = summaryQuery.data;
    return typeof raw?.globalNegativePrompt === "string"
      ? raw.globalNegativePrompt
      : "";
  }, [summaryQuery.data]);

  const isLoading = projectQuery.isLoading || summaryQuery.isLoading;
  const isActive =
    currentProjectId !== null &&
    worldFrameworkId !== null &&
    consistencyPrefix.length > 0;

  const injectIntoPrompt = (userPrompt: string): string => {
    if (!isActive) return userPrompt;
    const trimmedPrefix = consistencyPrefix.trim();
    if (!trimmedPrefix) return userPrompt;
    return `${trimmedPrefix}\n\n${userPrompt}`.trim();
  };

  const currentProject = projectQuery.data
    ? {
        id: projectQuery.data.id,
        title: projectQuery.data.title,
        directorSessionId: projectQuery.data.directorSessionId,
        worldFrameworkId: projectQuery.data.worldFrameworkId,
        worldStoryboardId: projectQuery.data.worldStoryboardId,
        worldFrameworkName: projectQuery.data.worldFrameworkName,
        status: projectQuery.data.status,
      }
    : null;

  const value: WorldContextValue = {
    currentProjectId,
    setCurrentProjectId,
    currentProject,
    worldFrameworkId,
    consistencyPrefix,
    globalNegativePrompt,
    injectIntoPrompt,
    isLoading,
    isActive,
  };

  return (
    <WorldContext.Provider value={value}>{children}</WorldContext.Provider>
  );
}

export function useWorldContext(): WorldContextValue {
  return useContext(WorldContext);
}
