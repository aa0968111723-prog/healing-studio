/**
 * ProjectsContext — Wave 1 Project SSOT.
 *
 * 兩條路徑、同一個介面（依 ENABLE_PROJECT_SSOT 在 build-time 選擇）：
 *
 *   RealProjectsProvider（SSOT=ON）
 *     - projects        ← trpc.creativeProject.list（TanStack Query 管 server state）
 *     - createProject   ← trpc.creativeProject.create（樂觀插入 list cache，失敗回滾）
 *     - activeProjectId ← 委派 WorldContext（healing-studio.current-project-id 是唯一
 *                          持久化位置；本檔不再有第二套 localStorage 暫存）
 *     - 伺服器列 → Project 的映射見 rowToProject（type/progress/currentStep/nextAction
 *       目前落在 creative_projects.metadata jsonb；待後端升格為欄位）
 *
 *   MockProjectsProvider（SSOT=OFF，線上預設）
 *     - 既有 MOCK_PROJECTS + localStorage 行為原封不動（零行為改變保證）。
 *
 * 介面差異 vs Step 3：createProject 改為 async（真實路徑是 server mutation）；
 * 新增 isLoading / error 供頁面畫載入／錯誤狀態（mock 路徑恆為 false / null）。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc } from "@/lib/trpc";
import { useWorldContext } from "@/contexts/WorldContextContext";
import { ENABLE_PROJECT_SSOT } from "@/config/projectFlags";
import { MOCK_PROJECTS } from "@/data/mockProjects";
import {
  PROJECT_TYPE_LABELS,
  type Project,
  type ProjectStatus,
  type ProjectType,
} from "@/types/projects";
import type { AppRouter } from "../../../server/routers";

/** Step 3 mock 路徑專用的 localStorage key；SSOT 路徑改委派 WorldContext，不再寫入。 */
const LEGACY_ACTIVE_PROJECT_KEY = "creation-hub-active-project-id";

export interface CreateProjectDraft {
  title: string;
  type: ProjectType;
  worldFramework?: string;
  storyboard?: string;
  directorSession?: string;
}

interface ProjectsContextValue {
  projects: Project[];
  activeProjectId: string | null;
  /** The latest-updated project among `projects`, regardless of status —
   *  used by the home's "繼續上次專案" card when no explicit active id is
   *  pinned. Returns null when there are no projects. */
  latestProject: Project | null;
  /** Either the explicitly pinned project (if its id is still present) or
   *  latestProject as a fallback. */
  activeProject: Project | null;
  setActiveProjectId: (id: string | null) => void;
  getProjectById: (id: string) => Project | undefined;
  /** 建立專案並釘為 active。SSOT 路徑打 creativeProject.create（樂觀更新）；
   *  mock 路徑同步寫本地 store 後 resolve。 */
  createProject: (draft: CreateProjectDraft) => Promise<Project>;
  /** 專案清單載入中（mock 路徑恆 false）。 */
  isLoading: boolean;
  /** 清單載入失敗訊息（mock 路徑恆 null）。 */
  error: string | null;
}

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

// ============================================================================
// 伺服器列 → 前端 Project 映射（creativeProject.list 的單列）
// ============================================================================

type CreativeProjectRow = inferRouterOutputs<AppRouter>["creativeProject"]["list"][number];

/** 伺服器 status（concept/production/review/complete）→ 前端 ProjectStatus。
 *  「review→active」是有損映射、「archived」無伺服器對應 —— 都列在待後端清單。 */
const SERVER_TO_CLIENT_STATUS: Record<CreativeProjectRow["status"], ProjectStatus> = {
  concept: "draft",
  production: "active",
  review: "active",
  complete: "completed",
};

function isProjectType(v: unknown): v is ProjectType {
  return typeof v === "string" && v in PROJECT_TYPE_LABELS;
}

function metaString(meta: Record<string, unknown>, key: string): string | undefined {
  const v = meta[key];
  return typeof v === "string" && v.trim() ? v : undefined;
}

function toIso(v: Date | string | number): string {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}

function clampProgress(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/** creative_projects 沒有 type/progress/currentStep/nextAction 欄位（待後端），
 *  目前由 createProject 寫進 metadata jsonb；舊資料（如 /creative-projects 主控台
 *  建立的專案）沒有 metadata.type → 歸類 "other"。 */
function rowToProject(row: CreativeProjectRow): Project {
  const meta: Record<string, unknown> = row.metadata ?? {};
  const worldFramework =
    metaString(meta, "worldFrameworkLabel") ??
    (row.worldFrameworkId != null ? `世界觀框架 #${row.worldFrameworkId}` : undefined);
  const storyboard =
    metaString(meta, "storyboardLabel") ??
    (row.worldStoryboardId != null ? `分鏡板 #${row.worldStoryboardId}` : undefined);
  const directorSession =
    metaString(meta, "directorSessionLabel") ??
    (row.directorSessionId != null ? `導演對話 #${row.directorSessionId}` : undefined);
  const binding =
    worldFramework || storyboard || directorSession
      ? {
          ...(worldFramework ? { worldFramework } : {}),
          ...(storyboard ? { storyboard } : {}),
          ...(directorSession ? { directorSession } : {}),
        }
      : undefined;

  return {
    id: String(row.id),
    title: row.title,
    type: isProjectType(meta.type) ? meta.type : "other",
    status: SERVER_TO_CLIENT_STATUS[row.status],
    progress: clampProgress(meta.progress, row.status === "complete" ? 100 : 0),
    currentStep:
      metaString(meta, "currentStep") ?? (row.description || "尚未記錄目前步驟。"),
    nextAction: metaString(meta, "nextAction") ?? "打開專案繼續創作。",
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    ...(binding ? { binding } : {}),
    // 樂觀臨時列（onMutate 用負數 id 插入）→ 標 pending，消費端停用互動。
    ...(row.id <= 0 ? { isPending: true } : {}),
  };
}

/** 前端 string id ↔ WorldContext number id 的橋接：mock 時代的 "proj-…" 字串
 *  解析不出正整數 → 視為 null（與 WorldContext readStoredProjectId 同樣的驗證）。 */
function toNumericProjectId(id: string | null): number | null {
  if (id === null) return null;
  const n = Number.parseInt(id, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ============================================================================
// 共用 selector（兩條路徑同語意）
// ============================================================================

function pickLatest(projects: Project[]): Project | null {
  if (projects.length === 0) return null;
  return [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

function pickActive(
  projects: Project[],
  activeProjectId: string | null,
  latest: Project | null,
): Project | null {
  const pinned = activeProjectId
    ? projects.find(p => p.id === activeProjectId) ?? null
    : null;
  return pinned ?? latest;
}

// ============================================================================
// SSOT 路徑：真實 creativeProject.* + WorldContext active id
// ============================================================================

const NEW_PROJECT_CURRENT_STEP = "剛建立，待設定世界觀與腳本。";
const NEW_PROJECT_NEXT_ACTION = "到導演工作室為這個專案綁定世界觀與腳本。";

export function RealProjectsProvider({ children }: { children: ReactNode }) {
  const world = useWorldContext();
  const utils = trpc.useUtils();

  const listQuery = trpc.creativeProject.list.useQuery(undefined, {
    staleTime: 30_000,
  });

  // SSOT：active id 唯一持久化在 WorldContext 的 localStorage key；
  // mock 時代的舊 key 一次性清掉（"proj-…" 字串對真實 id 無遷移價值）。
  useEffect(() => {
    try {
      window.localStorage.removeItem(LEGACY_ACTIVE_PROJECT_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const createMutation = trpc.creativeProject.create.useMutation({
    onMutate: async input => {
      await utils.creativeProject.list.cancel();
      const previous = utils.creativeProject.list.getData();
      // 負數臨時 id：與真實正整數 PK 永不相撞；onSettled invalidate 後被真列取代。
      const tempId = -Date.now();
      const now = new Date();
      utils.creativeProject.list.setData(undefined, old => [
        ...(old ?? []),
        {
          id: tempId,
          title: input.title,
          description: input.description ?? undefined,
          directorSessionId: input.directorSessionId ?? null,
          worldFrameworkId: input.worldFrameworkId ?? null,
          worldStoryboardId: input.worldStoryboardId ?? null,
          worldviewId: input.worldviewId ?? null,
          scriptId: input.scriptId ?? null,
          status: input.status ?? "concept",
          coverImageUrl: input.coverImageUrl ?? undefined,
          tags: input.tags ?? [],
          metadata: input.metadata as Record<string, unknown> | undefined,
          createdAt: now,
          updatedAt: now,
        },
      ]);
      return { previous };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previous) {
        utils.creativeProject.list.setData(undefined, ctx.previous);
      }
    },
    // 回傳 promise → mutateAsync 等 refetch 完才 resolve：createProject 回來時
    // 真列已在 cache，臨時負數 id 不會殘留給呼叫端後續導頁。
    onSettled: () => utils.creativeProject.list.invalidate(),
  });

  const projects = useMemo<Project[]>(
    () => (listQuery.data ?? []).map(rowToProject),
    [listQuery.data],
  );

  const activeProjectId =
    world.currentProjectId === null ? null : String(world.currentProjectId);

  const setActiveProjectId = useCallback(
    (id: string | null) => {
      const numeric = toNumericProjectId(id);
      // 解析不出正整數的非 null id（mock 時代字串、樂觀臨時負數 id）→ no-op，
      // 不可誤清使用者既有的 active 釘選；只有顯式傳 null 才解除。
      if (id !== null && numeric === null) return;
      world.setCurrentProjectId(numeric);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- WorldContext 的 setter 每次 render 都是新函式；以 provider 身分穩定即可
    [world.setCurrentProjectId],
  );

  const getProjectById = useCallback(
    (id: string) => projects.find(p => p.id === id),
    [projects],
  );

  const createProject = useCallback(
    async (draft: CreateProjectDraft): Promise<Project> => {
      const title = draft.title.trim();
      const metadata: Record<string, unknown> = {
        type: draft.type,
        progress: 0,
        currentStep: NEW_PROJECT_CURRENT_STEP,
        nextAction: NEW_PROJECT_NEXT_ACTION,
        ...(draft.worldFramework ? { worldFrameworkLabel: draft.worldFramework } : {}),
        ...(draft.storyboard ? { storyboardLabel: draft.storyboard } : {}),
        ...(draft.directorSession
          ? { directorSessionLabel: draft.directorSession }
          : {}),
      };
      const { id } = await createMutation.mutateAsync({
        title,
        status: "concept",
        metadata,
      });
      world.setCurrentProjectId(id);
      const nowIso = new Date().toISOString();
      const binding =
        draft.worldFramework || draft.storyboard || draft.directorSession
          ? {
              ...(draft.worldFramework ? { worldFramework: draft.worldFramework } : {}),
              ...(draft.storyboard ? { storyboard: draft.storyboard } : {}),
              ...(draft.directorSession
                ? { directorSession: draft.directorSession }
                : {}),
            }
          : undefined;
      return {
        id: String(id),
        title,
        type: draft.type,
        status: "draft",
        progress: 0,
        currentStep: NEW_PROJECT_CURRENT_STEP,
        nextAction: NEW_PROJECT_NEXT_ACTION,
        createdAt: nowIso,
        updatedAt: nowIso,
        ...(binding ? { binding } : {}),
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 同上，setter 以 provider 身分穩定
    [createMutation.mutateAsync, world.setCurrentProjectId],
  );

  const latestProject = useMemo(() => pickLatest(projects), [projects]);
  const activeProject = useMemo(
    () => pickActive(projects, activeProjectId, latestProject),
    [projects, activeProjectId, latestProject],
  );

  const value = useMemo<ProjectsContextValue>(
    () => ({
      projects,
      activeProjectId,
      latestProject,
      activeProject,
      setActiveProjectId,
      getProjectById,
      createProject,
      isLoading: listQuery.isLoading,
      error: listQuery.error ? listQuery.error.message : null,
    }),
    [
      projects,
      activeProjectId,
      latestProject,
      activeProject,
      setActiveProjectId,
      getProjectById,
      createProject,
      listQuery.isLoading,
      listQuery.error,
    ],
  );

  return (
    <ProjectsContext.Provider value={value}>
      {children}
    </ProjectsContext.Provider>
  );
}

// ============================================================================
// Mock 路徑（線上預設；Step 3 行為原封不動）
// ============================================================================

function readStoredId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LEGACY_ACTIVE_PROJECT_KEY);
  } catch {
    return null;
  }
}

function writeStoredId(id: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (id === null) {
      window.localStorage.removeItem(LEGACY_ACTIVE_PROJECT_KEY);
    } else {
      window.localStorage.setItem(LEGACY_ACTIVE_PROJECT_KEY, id);
    }
  } catch {
    // ignore quota / privacy mode
  }
}

export function MockProjectsProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>(() => [...MOCK_PROJECTS]);
  const [activeProjectId, setActiveProjectIdState] = useState<string | null>(
    () => readStoredId(),
  );

  // Drop a stale stored id (e.g. mock data changed between releases).
  useEffect(() => {
    if (activeProjectId && !projects.some(p => p.id === activeProjectId)) {
      setActiveProjectIdState(null);
      writeStoredId(null);
    }
  }, [activeProjectId, projects]);

  const setActiveProjectId = useCallback((id: string | null) => {
    setActiveProjectIdState(id);
    writeStoredId(id);
  }, []);

  const getProjectById = useCallback(
    (id: string) => projects.find(p => p.id === id),
    [projects],
  );

  const createProject = useCallback(
    async (draft: CreateProjectDraft): Promise<Project> => {
      const now = new Date().toISOString();
      const id = `proj-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 7)}`;
      const binding =
        draft.worldFramework || draft.storyboard || draft.directorSession
          ? {
              ...(draft.worldFramework ? { worldFramework: draft.worldFramework } : {}),
              ...(draft.storyboard ? { storyboard: draft.storyboard } : {}),
              ...(draft.directorSession
                ? { directorSession: draft.directorSession }
                : {}),
            }
          : undefined;
      const project: Project = {
        id,
        title: draft.title.trim(),
        type: draft.type,
        status: "draft",
        progress: 0,
        currentStep: "剛建立，待設定世界觀與腳本。",
        nextAction: "到導演工作室為這個專案綁定世界觀與腳本。",
        createdAt: now,
        updatedAt: now,
        ...(binding ? { binding } : {}),
      };
      setProjects(prev => [...prev, project]);
      setActiveProjectIdState(id);
      writeStoredId(id);
      return project;
    },
    [],
  );

  const latestProject = useMemo(() => pickLatest(projects), [projects]);
  const activeProject = useMemo(
    () => pickActive(projects, activeProjectId, latestProject),
    [projects, activeProjectId, latestProject],
  );

  const value = useMemo<ProjectsContextValue>(
    () => ({
      projects,
      activeProjectId,
      latestProject,
      activeProject,
      setActiveProjectId,
      getProjectById,
      createProject,
      isLoading: false,
      error: null,
    }),
    [
      projects,
      activeProjectId,
      latestProject,
      activeProject,
      setActiveProjectId,
      getProjectById,
      createProject,
    ],
  );

  return (
    <ProjectsContext.Provider value={value}>
      {children}
    </ProjectsContext.Provider>
  );
}

// ============================================================================
// 對外入口：依旗標選路徑（build-time 常數，兩個元件都已定義 → 無條件式 hooks 問題）
// ============================================================================

export function ProjectsProvider({ children }: { children: ReactNode }) {
  return ENABLE_PROJECT_SSOT ? (
    <RealProjectsProvider>{children}</RealProjectsProvider>
  ) : (
    <MockProjectsProvider>{children}</MockProjectsProvider>
  );
}

export function useProjects(): ProjectsContextValue {
  const ctx = useContext(ProjectsContext);
  if (!ctx) {
    throw new Error("useProjects must be used within a ProjectsProvider");
  }
  return ctx;
}
