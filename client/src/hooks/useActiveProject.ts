/**
 * useActiveProject — M1-A Active Project Context（統一入口）
 * ────────────────────────────────────────────────────────────────────────────
 * CreativeProject 是全站創作主幹。這個 hook 把「目前作用中的創作專案」整理成
 * 單一、清楚命名的 surface 給 `/create` 等創作頁面使用。它不另外持有狀態，而是
 * 委派給既有的 WorldContextContext（已 server-backed + localStorage 持久化，
 * 且全站光球與 Studio 頁面都讀它），再加上 M1-A 新增的 project context summary
 * 查詢。如此可避免出現第二套互相打架的 active-project 狀態。
 */

import { trpc } from "@/lib/trpc";
import { useWorldContext } from "@/contexts/WorldContextContext";

export function useActiveProject() {
  const world = useWorldContext();
  const activeProjectId = world.currentProjectId;

  const summaryQuery = trpc.creativeProject.getContextSummary.useQuery(
    { projectId: activeProjectId ?? 0 },
    {
      enabled: activeProjectId !== null,
      staleTime: 30_000,
      retry: false,
    },
  );

  return {
    /** 目前作用中的專案 id（null = 未選擇）。 */
    activeProjectId,
    /** 切換 / 清除作用中專案（傳 null 清除）。 */
    setActiveProjectId: world.setCurrentProjectId,
    /** 作用中專案的精簡資料（來自 WorldContext）。 */
    activeProject: world.currentProject,
    /** 是否已選擇作用中專案。 */
    hasActiveProject: activeProjectId !== null,
    /** `/create` 用的專案上下文摘要（未選專案時為 null）。 */
    summary: summaryQuery.data ?? null,
    isSummaryLoading: activeProjectId !== null && summaryQuery.isLoading,
    summaryError: summaryQuery.error ?? null,
    refetchSummary: summaryQuery.refetch,
  };
}

export type UseActiveProjectResult = ReturnType<typeof useActiveProject>;
