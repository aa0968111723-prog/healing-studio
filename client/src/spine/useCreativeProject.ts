// ============================================================================
// spine/useCreativeProject.ts — 跨 shell 取用 active CreativeProject 的統一入口
// ----------------------------------------------------------------------------
// 【為什麼用「橋接」而非新狀態】real repo 的 active-project 唯一真實來源是
//   useActiveProject()（client/src/hooks/useActiveProject.ts），它委派給 WorldContextContext
//  （server-backed + localStorage 持久化，全站光球/Studio 都讀它）。其檔頭明言：
//   「避免出現第二套互相打架的 active-project 狀態」。
//
//   因此 SpineProvider **不**自建 active-project state；shell 統一從這個橋接 hook 取用，
//   底層仍是同一個 WorldContext。這就是整合指南 §3「包覆，不取代」「active-project 仍由
//   既有 ProjectsProvider/WorldContext 當唯一真實來源」的落地。
//
// 用法（shell 內）：
//   const { activeProjectId, activeProject, setActiveProjectId } = useCreativeProject();
//
// 必須在 WorldContextProvider 之內呼叫（所有 shell 都在其內 → 成立）。
// ============================================================================
import { useActiveProject } from "@/hooks/useActiveProject";

/**
 * 取得目前作用中的創作專案（委派 useActiveProject → WorldContext）。
 * 回傳形狀直接沿用既有 useActiveProject，shell 不需學新 API。
 */
export function useCreativeProject() {
  return useActiveProject();
}

export type UseCreativeProjectResult = ReturnType<typeof useCreativeProject>;
